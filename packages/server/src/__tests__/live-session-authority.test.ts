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
