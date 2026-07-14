import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

interface MockWebSocket extends WebSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function createWebSocket(): MockWebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    serializeAttachment: vi.fn(),
  } as unknown as MockWebSocket;
}

function createAuthDb(activeSessions: Set<string> | 'unavailable'): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn((sessionId: string, userId: string) => ({
        first: vi.fn(async () => {
          if (activeSessions === 'unavailable') {
            throw new Error('session database unavailable');
          }
          return activeSessions.has(`${userId}:${sessionId}`) ? { id: sessionId } : null;
        }),
      })),
    })),
  } as unknown as D1Database;
}

function parseFrames(ws: MockWebSocket): Array<Record<string, unknown>> {
  return ws.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as Record<string, unknown>);
}

function databaseLiveMeta(userId: string, sessionId: string) {
  return {
    authenticated: true,
    userId,
    sessionId,
    role: 'user',
    connectionId: `connection-${sessionId}`,
    subscribedChannels: ['dblive:shared:posts'],
    channelFilters: new Map(),
    channelOrFilters: new Map(),
    supportsBatch: true,
  };
}

describe('live websocket session authority', () => {
  it('does not query session authority for database-live events with no matching subscription', async () => {
    const { DatabaseLiveDO } = await import('../durable-objects/database-live-do.js');
    const ws = createWebSocket();
    const authDb = createAuthDb(new Set(['user-1:session-current'])) as any;
    const ctx = {
      getWebSockets: vi.fn(() => [ws]),
      getTags: vi.fn(() => []),
      acceptWebSocket: vi.fn(),
    } as any;
    const live = new DatabaseLiveDO(ctx, { AUTH_DB: authDb } as any) as any;
    live.setWSMeta(ws, {
      ...databaseLiveMeta('user-1', 'session-current'),
      subscribedChannels: ['dblive:shared:comments'],
    });

    await Promise.all([
      live.handleInternalEvent(new Request('http://internal/internal/event', {
        method: 'POST',
        body: JSON.stringify({
          deliveryId: 'unmatched-event',
          type: 'added',
          channel: 'dblive:shared:posts',
          table: 'posts',
          docId: 'post-1',
          data: { id: 'post-1' },
          timestamp: '2026-07-14T00:00:00.000Z',
        }),
      })),
      live.handleInternalBatchEvent(new Request('http://internal/internal/batch-event', {
        method: 'POST',
        body: JSON.stringify({
          deliveryId: 'unmatched-batch',
          type: 'batch_changes',
          channel: 'dblive:shared:posts',
          table: 'posts',
          changes: [{
            type: 'added',
            docId: 'post-2',
            data: { id: 'post-2' },
            timestamp: '2026-07-14T00:00:00.000Z',
          }],
          total: 1,
        }),
      })),
      live.handleInternalBroadcast(new Request('http://internal/internal/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          deliveryId: 'unmatched-broadcast',
          channel: 'dblive:shared:posts',
          event: 'refresh',
        }),
      })),
    ]);

    expect(authDb.prepare).not.toHaveBeenCalled();
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('coalesces concurrent database-live checks for the same session', async () => {
    const { DatabaseLiveDO } = await import('../durable-objects/database-live-do.js');
    const ws = createWebSocket();
    let releaseAuthority!: () => void;
    const authorityGate = new Promise<void>((resolve) => {
      releaseAuthority = resolve;
    });
    const first = vi.fn(async () => {
      await authorityGate;
      return { id: 'session-current' };
    });
    const authDb = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first })),
      })),
    } as unknown as D1Database;
    const ctx = {
      getWebSockets: vi.fn(() => [ws]),
      getTags: vi.fn(() => []),
      acceptWebSocket: vi.fn(),
    } as any;
    const live = new DatabaseLiveDO(ctx, { AUTH_DB: authDb } as any) as any;
    live.setWSMeta(ws, databaseLiveMeta('user-1', 'session-current'));

    const deliveries = [1, 2].map((index) => live.handleInternalEvent(new Request(
      'http://internal/internal/event',
      {
        method: 'POST',
        body: JSON.stringify({
          deliveryId: `concurrent-event-${index}`,
          type: 'added',
          channel: 'dblive:shared:posts',
          table: 'posts',
          docId: `post-${index}`,
          data: { id: `post-${index}` },
          timestamp: '2026-07-14T00:00:00.000Z',
        }),
      },
    )));

    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    releaseAuthority();
    await Promise.all(deliveries);

    expect(first).toHaveBeenCalledTimes(1);
    expect(ws.send).toHaveBeenCalledTimes(2);
  });

  it('bounds database-live fanout concurrency while still reaching every subscribed session', async () => {
    const { DatabaseLiveDO } = await import('../durable-objects/database-live-do.js');
    const sockets = Array.from({ length: 18 }, () => createWebSocket());
    let releaseAuthority!: () => void;
    const authorityGate = new Promise<void>((resolve) => {
      releaseAuthority = resolve;
    });
    let activeChecks = 0;
    let maxActiveChecks = 0;
    let startedChecks = 0;
    const authDb = {
      prepare: vi.fn(() => ({
        bind: vi.fn((sessionId: string) => ({
          first: vi.fn(async () => {
            startedChecks += 1;
            activeChecks += 1;
            maxActiveChecks = Math.max(maxActiveChecks, activeChecks);
            await authorityGate;
            activeChecks -= 1;
            return { id: sessionId };
          }),
        })),
      })),
    } as unknown as D1Database;
    const ctx = {
      getWebSockets: vi.fn(() => sockets),
      getTags: vi.fn(() => []),
      acceptWebSocket: vi.fn(),
    } as any;
    const live = new DatabaseLiveDO(ctx, { AUTH_DB: authDb } as any) as any;
    sockets.forEach((ws, index) => {
      live.setWSMeta(ws, databaseLiveMeta(`user-${index}`, `session-${index}`));
    });

    const delivery = live.handleInternalBroadcast(new Request('http://internal/internal/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'dblive:shared:posts',
        event: 'refresh',
      }),
    }));

    await vi.waitFor(() => expect(startedChecks).toBe(16));
    expect(maxActiveChecks).toBe(16);
    releaseAuthority();
    await delivery;

    expect(startedChecks).toBe(18);
    expect(maxActiveChecks).toBe(16);
    for (const ws of sockets) {
      expect(parseFrames(ws)).toEqual([expect.objectContaining({ type: 'broadcast_event' })]);
    }
  });

  it('shares the first filter recovery broadcast across concurrent socket messages', async () => {
    const { DatabaseLiveDO } = await import('../durable-objects/database-live-do.js');
    const firstSocket = createWebSocket();
    const secondSocket = createWebSocket();
    const ctx = {
      getWebSockets: vi.fn(() => [firstSocket, secondSocket]),
      getTags: vi.fn(() => []),
      acceptWebSocket: vi.fn(),
    } as any;
    const live = new DatabaseLiveDO(ctx, {} as any) as any;
    live.ensureRuntimeReady = vi.fn(async () => {});
    live.ensureLiveSessionAuthority = vi.fn(async () => true);
    live.setWSMeta(firstSocket, databaseLiveMeta('user-1', 'session-1'));
    live.setWSMeta(secondSocket, databaseLiveMeta('user-2', 'session-2'));
    let releaseRecovery!: () => void;
    const recoveryGate = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    live.broadcastToAuthenticated = vi.fn(async () => {
      await recoveryGate;
    });

    const firstMessage = live.webSocketMessage(firstSocket, JSON.stringify({ type: 'ping' }));
    const secondMessage = live.webSocketMessage(secondSocket, JSON.stringify({ type: 'ping' }));
    await vi.waitFor(() => expect(live.broadcastToAuthenticated).toHaveBeenCalledTimes(1));
    releaseRecovery();
    await Promise.all([firstMessage, secondMessage]);

    expect(live.broadcastToAuthenticated).toHaveBeenCalledTimes(1);
    expect(parseFrames(firstSocket)).toEqual([{ type: 'pong' }]);
    expect(parseFrames(secondSocket)).toEqual([{ type: 'pong' }]);
  });

  it('disconnects the revoked Database Live client while continuing delivery to the replacement client', async () => {
    const { DatabaseLiveDO } = await import('../durable-objects/database-live-do.js');
    const revoked = createWebSocket();
    const replacement = createWebSocket();
    const ctx = {
      getWebSockets: vi.fn(() => [revoked, replacement]),
      getTags: vi.fn(() => []),
      acceptWebSocket: vi.fn(),
    } as any;
    const live = new DatabaseLiveDO(ctx, {
      AUTH_DB: createAuthDb(new Set(['user-1:session-new'])),
    } as any) as any;
    live.setWSMeta(revoked, databaseLiveMeta('user-1', 'session-old'));
    live.setWSMeta(replacement, databaseLiveMeta('user-1', 'session-new'));

    const response = await live.handleInternalBroadcast(new Request('http://internal/internal/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'dblive:shared:posts',
        event: 'refresh',
        payload: { source: 'anonymous-upgrade' },
      }),
    }));

    expect(response.status).toBe(200);
    expect(parseFrames(revoked)).toEqual([expect.objectContaining({
      type: 'error',
      code: 'SESSION_REVOKED',
    })]);
    expect(revoked.close).toHaveBeenCalledWith(4002, 'Authentication session revoked');
    expect(parseFrames(replacement)).toEqual([{
      type: 'broadcast_event',
      channel: 'dblive:shared:posts',
      event: 'refresh',
      payload: { source: 'anonymous-upgrade' },
    }]);
    expect(replacement.close).not.toHaveBeenCalled();
  });

  it('disconnects the revoked Room client while continuing delivery to the replacement client', async () => {
    const { RoomRuntimeBaseDO } = await import('../durable-objects/room-runtime-base.js');
    const revoked = createWebSocket();
    const replacement = createWebSocket();
    const pending: Promise<unknown>[] = [];
    const room: any = Object.create(RoomRuntimeBaseDO.prototype);
    room.env = { AUTH_DB: createAuthDb(new Set(['user-1:session-new'])) };
    room.ctx = {
      waitUntil: vi.fn((promise: Promise<unknown>) => pending.push(promise)),
    };
    room._metaCache = new Map([
      [revoked, {
        authenticated: true,
        userId: 'user-1',
        sessionId: 'session-old',
        connectionId: 'connection-old',
      }],
      [replacement, {
        authenticated: true,
        userId: 'user-1',
        sessionId: 'session-new',
        connectionId: 'connection-new',
      }],
    ]);
    room._attachmentExtraCache = new Map();

    room.safeSendRaw(revoked, JSON.stringify({ type: 'room_event', value: 1 }));
    room.safeSendRaw(replacement, JSON.stringify({ type: 'room_event', value: 1 }));
    await Promise.all(pending);

    expect(parseFrames(revoked)).toEqual([expect.objectContaining({
      type: 'error',
      code: 'SESSION_REVOKED',
    })]);
    expect(revoked.close).toHaveBeenCalledWith(4002, 'Authentication session revoked');
    expect(parseFrames(replacement)).toEqual([{ type: 'room_event', value: 1 }]);
    expect(replacement.close).not.toHaveBeenCalled();
  });

  it('applies the session guard to RoomsDO-specific signal messages before their handler runs', async () => {
    const { RoomsDO } = await import('../durable-objects/rooms-do.js');
    const revoked = createWebSocket();
    const room: any = Object.create(RoomsDO.prototype);
    room.env = { AUTH_DB: createAuthDb(new Set()) };
    room.ctx = { waitUntil: vi.fn() };
    room._metaCache = new Map([[revoked, {
      authenticated: true,
      userId: 'user-1',
      sessionId: 'session-old',
      connectionId: 'connection-old',
    }]]);
    room._attachmentExtraCache = new Map();
    room.joinedConnectionIds = new Set();
    room.members = new Map();
    room.blockedMembers = new Set();
    room.memberRoles = new Map();
    room.ensureRuntimeReady = vi.fn(async () => {});
    room.recoverStateIfNeeded = vi.fn(async () => {});
    room.handleSignal = vi.fn(async () => {});

    await room.webSocketMessage(revoked, JSON.stringify({
      type: 'signal',
      event: 'chat.message',
      payload: { text: 'must not be delivered' },
    }));

    expect(room.handleSignal).not.toHaveBeenCalled();
    expect(parseFrames(revoked)).toEqual([expect.objectContaining({ code: 'SESSION_REVOKED' })]);
    expect(revoked.close).toHaveBeenCalledWith(4002, 'Authentication session revoked');
  });

  it('checks RoomsDO base messages exactly once before delegating', async () => {
    const { RoomsDO } = await import('../durable-objects/rooms-do.js');
    const ws = createWebSocket();
    const room: any = Object.create(RoomsDO.prototype);
    room.ctx = { waitUntil: vi.fn() };
    room._metaCache = new Map([[ws, {
      authenticated: true,
      userId: 'user-1',
      sessionId: 'session-current',
      connectionId: 'connection-current',
    }]]);
    room._attachmentExtraCache = new Map();
    room.joinedConnectionIds = new Set();
    room.members = new Map();
    room.blockedMembers = new Set();
    room.memberRoles = new Map();
    room.ensureRuntimeReady = vi.fn(async () => {});
    room.recoverStateIfNeeded = vi.fn(async () => {});
    room.ensureLiveSessionAuthority = vi.fn(async () => true);
    room.safeSend = vi.fn();

    await room.processWebSocketMessage(ws, JSON.stringify({ type: 'unknown-base-message' }));

    expect(room.ensureLiveSessionAuthority).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent Room sockets and same-socket bursts without caching settlement', async () => {
    const { RoomRuntimeBaseDO } = await import('../durable-objects/room-runtime-base.js');
    const firstSocket = createWebSocket();
    const secondSocket = createWebSocket();
    let active = true;
    let releaseAuthority!: () => void;
    const authorityGate = new Promise<void>((resolve) => {
      releaseAuthority = resolve;
    });
    const first = vi.fn(async () => {
      await authorityGate;
      return active ? { id: 'session-current' } : null;
    });
    const authDb = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first })),
      })),
    } as unknown as D1Database;
    const pending: Promise<unknown>[] = [];
    const room: any = Object.create(RoomRuntimeBaseDO.prototype);
    room.env = { AUTH_DB: authDb };
    room.ctx = { waitUntil: vi.fn((promise: Promise<unknown>) => pending.push(promise)) };
    const meta = (connectionId: string) => ({
      authenticated: true,
      userId: 'user-1',
      sessionId: 'session-current',
      connectionId,
    });
    room._metaCache = new Map([
      [firstSocket, meta('connection-1')],
      [secondSocket, meta('connection-2')],
    ]);
    room._attachmentExtraCache = new Map();

    room.safeSendRaw(firstSocket, JSON.stringify({ type: 'room_event', value: 1 }));
    room.safeSendRaw(firstSocket, JSON.stringify({ type: 'room_event', value: 2 }));
    room.safeSendRaw(secondSocket, JSON.stringify({ type: 'room_event', value: 1 }));
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    releaseAuthority();
    await Promise.all(pending.splice(0));

    expect(first).toHaveBeenCalledTimes(1);
    expect(parseFrames(firstSocket)).toEqual([
      { type: 'room_event', value: 1 },
      { type: 'room_event', value: 2 },
    ]);
    expect(parseFrames(secondSocket)).toEqual([{ type: 'room_event', value: 1 }]);

    active = false;
    room.safeSendRaw(firstSocket, JSON.stringify({ type: 'room_event', value: 3 }));
    await Promise.all(pending.splice(0));

    expect(first).toHaveBeenCalledTimes(2);
    expect(parseFrames(firstSocket)).toEqual([
      { type: 'room_event', value: 1 },
      { type: 'room_event', value: 2 },
      expect.objectContaining({ type: 'error', code: 'SESSION_REVOKED' }),
    ]);
    expect(firstSocket.close).toHaveBeenCalledWith(4002, 'Authentication session revoked');
  });

  it('fails closed without disconnecting Database Live when session authority is temporarily unavailable', async () => {
    const { DatabaseLiveDO } = await import('../durable-objects/database-live-do.js');
    const ws = createWebSocket();
    const ctx = {
      getWebSockets: vi.fn(() => [ws]),
      getTags: vi.fn(() => []),
      acceptWebSocket: vi.fn(),
    } as any;
    const live = new DatabaseLiveDO(ctx, {
      AUTH_DB: createAuthDb('unavailable'),
    } as any) as any;
    live.ensureRuntimeReady = vi.fn(async () => {});
    live.setWSMeta(ws, databaseLiveMeta('user-1', 'session-current'));

    await live.webSocketMessage(ws, JSON.stringify({ type: 'ping' }));

    expect(parseFrames(ws)).toEqual([expect.objectContaining({
      type: 'error',
      code: 'AUTH_AUTHORITY_UNAVAILABLE',
    })]);
    expect(ws.close).not.toHaveBeenCalled();
  });

  it('forces pre-deployment signed socket attachments without sid metadata to reconnect', async () => {
    const { DatabaseLiveDO } = await import('../durable-objects/database-live-do.js');
    const ws = createWebSocket();
    const ctx = {
      getWebSockets: vi.fn(() => [ws]),
      getTags: vi.fn(() => []),
      acceptWebSocket: vi.fn(),
    } as any;
    const live = new DatabaseLiveDO(ctx, {
      AUTH_DB: createAuthDb(new Set()),
    } as any) as any;
    live.ensureRuntimeReady = vi.fn(async () => {});
    live.setWSMeta(ws, {
      ...databaseLiveMeta('user-1', 'unused'),
      sessionId: undefined,
    });

    await live.webSocketMessage(ws, JSON.stringify({ type: 'ping' }));

    expect(parseFrames(ws)).toEqual([expect.objectContaining({
      type: 'error',
      code: 'SESSION_REVOKED',
      message: 'Authentication session metadata is missing.',
    })]);
    expect(ws.close).toHaveBeenCalledWith(4002, 'Authentication session revoked');
  });

  it('keeps explicitly marked tokenless anonymous Room actors independent of session rows', async () => {
    const { RoomRuntimeBaseDO } = await import('../durable-objects/room-runtime-base.js');
    const ws = createWebSocket();
    const room: any = Object.create(RoomRuntimeBaseDO.prototype);
    room.env = {};
    room.ctx = { waitUntil: vi.fn() };
    room._metaCache = new Map([[ws, {
      authenticated: true,
      userId: 'share-viewer-1',
      sessionAuthority: 'tokenless-anonymous',
      connectionId: 'connection-share-viewer',
    }]]);
    room._attachmentExtraCache = new Map();

    room.safeSendRaw(ws, JSON.stringify({ type: 'room_event', value: 1 }));

    expect(parseFrames(ws)).toEqual([{ type: 'room_event', value: 1 }]);
    expect(ws.close).not.toHaveBeenCalled();
    expect(room.ctx.waitUntil).not.toHaveBeenCalled();
  });
});
