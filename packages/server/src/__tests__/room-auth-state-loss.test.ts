import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {},
}));

describe('room auth-state loss recovery', () => {
  it('treats ephemeral timer persistence failures as non-fatal', async () => {
    const { RoomRuntimeBaseDO } = await import('../durable-objects/room-runtime-base.js');

    const room: any = Object.create(RoomRuntimeBaseDO.prototype);
    const pending: Promise<unknown>[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    room.pendingAuth = new Map([['conn-1', Date.now() + 5_000]]);
    room.disconnectTimers = new Map();
    room.namespace = 'game';
    room.roomId = 'room-1';
    room.ctx = {
      storage: {
        put: vi.fn().mockRejectedValue(new Error('Exceeded allowed rows written in Durable Objects free tier.')),
        delete: vi.fn(),
      },
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        pending.push(promise);
      }),
    };

    expect(() => room.syncEphemeralTimersToStorage()).not.toThrow();
    await Promise.allSettled(pending);

    expect(warnSpy).toHaveBeenCalledWith(
      '[Room] Ephemeral timer persistence skipped',
      expect.objectContaining({
        room: 'game::room-1',
        pendingAuthCount: 1,
        disconnectCount: 0,
        message: 'Exceeded allowed rows written in Durable Objects free tier.',
      }),
    );

    warnSpy.mockRestore();
  });

  it('marks websocket metadata rebuilt from hibernation tags as auth-state-lost', async () => {
    const { RoomRuntimeBaseDO } = await import('../durable-objects/room-runtime-base.js');

    const room: any = Object.create(RoomRuntimeBaseDO.prototype);
    room._metaCache = new Map();
    room.ctx = {
      getTags: vi.fn(() => [
        'conn:conn-1',
        'ip:127.0.0.1',
        'room:test-signals::room-1',
      ]),
    };
    room.config = {
      rooms: {
        'test-signals': {},
      },
    };
    room.namespace = null;
    room.roomId = null;
    room.namespaceConfig = null;

    const ws = {} as WebSocket;
    const meta = room.getWSMeta(ws);

    expect(meta).toMatchObject({
      authenticated: false,
      authStateLost: true,
      connectionId: 'conn-1',
      ip: '127.0.0.1',
    });
    expect(room.namespace).toBe('test-signals');
    expect(room.roomId).toBe('room-1');
  });

  it('keeps normal pre-auth protocol errors as NOT_AUTHENTICATED without closing the socket', async () => {
    const { RoomRuntimeBaseDO } = await import('../durable-objects/room-runtime-base.js');

    const room: any = Object.create(RoomRuntimeBaseDO.prototype);
    const ws = { close: vi.fn() } as unknown as WebSocket;
    room._metaCache = new Map([[ws, {
      authenticated: false,
      authStateLost: false,
      connectionId: 'conn-1',
    }]]);
    room.safeSend = vi.fn();

    await room.webSocketMessage(ws, JSON.stringify({ type: 'ping' }));

    expect(room.safeSend).toHaveBeenCalledWith(ws, {
      type: 'error',
      code: 'NOT_AUTHENTICATED',
      message: 'Authenticate first',
    });
    expect(ws.close).not.toHaveBeenCalled();
  });

  it('closes stale sockets after auth-state loss in the shared room runtime guard', async () => {
    const { RoomRuntimeBaseDO } = await import('../durable-objects/room-runtime-base.js');

    const room: any = Object.create(RoomRuntimeBaseDO.prototype);
    const ws = { close: vi.fn() } as unknown as WebSocket;
    room._metaCache = new Map([[ws, {
      authenticated: false,
      authStateLost: true,
      connectionId: 'conn-1',
    }]]);
    room.safeSend = vi.fn();

    await room.webSocketMessage(ws, JSON.stringify({ type: 'ping' }));

    expect(room.safeSend).toHaveBeenCalledWith(ws, {
      type: 'error',
      code: 'AUTH_STATE_LOST',
      message: 'Room authentication state lost. Reconnect required.',
    });
    expect(ws.close).toHaveBeenCalledWith(4006, 'Room authentication state lost');
  });

  it('closes stale sockets for room-specific signal and member-state messages too', async () => {
    const { RoomsDO } = await import('../durable-objects/rooms-do.js');

    const room: any = Object.create(RoomsDO.prototype);
    const ws = { close: vi.fn() } as unknown as WebSocket;
    room._metaCache = new Map([[ws, {
      authenticated: false,
      authStateLost: true,
      connectionId: 'conn-1',
    }]]);
    room.safeSend = vi.fn();

    await room.webSocketMessage(ws, JSON.stringify({
      type: 'signal',
      event: 'chat.message',
      payload: { text: 'hello' },
      requestId: 'signal-1',
    }));

    await room.webSocketMessage(ws, JSON.stringify({
      type: 'member_state',
      state: { mood: 'awake' },
      requestId: 'member-1',
    }));

    expect(room.safeSend).toHaveBeenNthCalledWith(1, ws, {
      type: 'error',
      code: 'AUTH_STATE_LOST',
      message: 'Room authentication state lost. Reconnect required.',
    });
    expect(room.safeSend).toHaveBeenNthCalledWith(2, ws, {
      type: 'error',
      code: 'AUTH_STATE_LOST',
      message: 'Room authentication state lost. Reconnect required.',
    });
    expect(ws.close).toHaveBeenNthCalledWith(1, 4006, 'Room authentication state lost');
    expect(ws.close).toHaveBeenNthCalledWith(2, 4006, 'Room authentication state lost');
  });
});
