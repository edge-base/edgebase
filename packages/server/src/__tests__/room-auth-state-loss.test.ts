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

  it('persists alarm-backed room deadlines but NOT the socket heartbeat timer', async () => {
    const { RoomRuntimeBaseDO } = await import('../durable-objects/room-runtime-base.js');

    const pending: Promise<unknown>[] = [];
    const putSpy = vi.fn().mockResolvedValue(undefined);
    const room: any = Object.create(RoomRuntimeBaseDO.prototype);
    room.pendingAuth = new Map([['conn-1', 11_111]]);
    room.disconnectTimers = new Map([['user-1', { fireAt: 22_222, connectionId: 'conn-1' }]]);
    room._stateSaveAt = 33_333;
    room._emptyRoomCleanupAt = 44_444;
    room._stateTTLAlarmAt = 55_555;
    room._socketHeartbeatCheckAt = 66_666;
    room.ctx = {
      storage: {
        put: putSpy,
        delete: vi.fn(),
      },
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        pending.push(promise);
      }),
    };

    room.syncEphemeralTimersToStorage();
    await Promise.allSettled(pending);

    // socketHeartbeatCheckAt is reconstructed from live sockets on recovery, so
    // it must not appear in the persisted blob (persisting it caused per-room
    // heartbeat-frequency storage writes).
    expect(putSpy).toHaveBeenCalledWith('roomEphemeralTimers', {
      pendingAuth: { 'conn-1': 11_111 },
      disconnects: { 'user-1': { fireAt: 22_222, connectionId: 'conn-1' } },
      stateSaveAt: 33_333,
      emptyRoomCleanupAt: 44_444,
      stateTTLAlarmAt: 55_555,
    });
    const persisted = putSpy.mock.calls[0][1];
    expect(persisted).not.toHaveProperty('socketHeartbeatCheckAt');
  });

  it('does not re-persist ephemeral timers when only the heartbeat timer advances', async () => {
    const { RoomRuntimeBaseDO } = await import('../durable-objects/room-runtime-base.js');

    const pending: Promise<unknown>[] = [];
    const putSpy = vi.fn().mockResolvedValue(undefined);
    const room: any = Object.create(RoomRuntimeBaseDO.prototype);
    room.pendingAuth = new Map([['conn-1', 11_111]]);
    room.disconnectTimers = new Map();
    room._stateSaveAt = 33_333;
    room._emptyRoomCleanupAt = null;
    room._stateTTLAlarmAt = null;
    room._socketHeartbeatCheckAt = 1_000;
    room.ctx = {
      storage: {
        put: putSpy,
        delete: vi.fn(),
      },
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        pending.push(promise);
      }),
    };

    // First sync writes once.
    room.syncEphemeralTimersToStorage();
    // Simulate several heartbeat reschedules: only the (non-persisted) heartbeat
    // timer advances; the durable content is unchanged.
    room._socketHeartbeatCheckAt = 6_000;
    room.syncEphemeralTimersToStorage();
    room._socketHeartbeatCheckAt = 11_000;
    room.syncEphemeralTimersToStorage();
    await Promise.allSettled(pending);

    // The dedup guard collapses the redundant heartbeat-driven calls to a single
    // storage write — this is what stopped the per-room ~5s write storm.
    expect(putSpy).toHaveBeenCalledTimes(1);

    // A real durable change (a new pending-auth deadline) still writes.
    room.pendingAuth = new Map([['conn-2', 99_999]]);
    room.syncEphemeralTimersToStorage();
    await Promise.allSettled(pending);
    expect(putSpy).toHaveBeenCalledTimes(2);
  });

  it('does not rewrite ephemeral timer storage when state is already dirty', async () => {
    const { RoomRuntimeBaseDO } = await import('../durable-objects/room-runtime-base.js');

    const room: any = Object.create(RoomRuntimeBaseDO.prototype);
    room.dirty = false;
    room._stateSaveAt = 33_333;
    room.namespaceConfig = {};
    room.syncEphemeralTimersToStorage = vi.fn();
    room._scheduleNextAlarm = vi.fn();

    room.markDirty();

    expect(room.dirty).toBe(true);
    expect(room._stateSaveAt).toBe(33_333);
    expect(room.syncEphemeralTimersToStorage).not.toHaveBeenCalled();
    expect(room._scheduleNextAlarm).toHaveBeenCalledTimes(1);
  });

  it('recovers persisted timers before alarm processing after a cold wake without sockets', async () => {
    const { RoomRuntimeBaseDO } = await import('../durable-objects/room-runtime-base.js');

    const room: any = Object.create(RoomRuntimeBaseDO.prototype);
    room.stateRecoveryNeeded = false;
    room.roomCreated = false;
    room.sharedState = {};
    room.playerStates = new Map();
    room.serverState = {};
    room.players = new Map();
    room.userToConnections = new Map();
    room.pendingAuth = new Map();
    room.disconnectTimers = new Map();
    room._timers = new Map();
    room._stateSaveAt = null;
    room._emptyRoomCleanupAt = null;
    room._stateTTLAlarmAt = null;
    room._metadata = {};
    room.config = {};
    room.env = {};
    room.ctx = {
      getWebSockets: vi.fn(() => []),
    };
    room.ensureRuntimeReady = vi.fn(async () => {});
    room.recoverFromStorage = vi.fn(async () => {});
    room.findWebSocketByConnectionId = vi.fn(() => null);
    room.finalizePlayerLeave = vi.fn(async () => {});
    room.syncEphemeralTimersToStorage = vi.fn();
    room._scheduleNextAlarm = vi.fn();

    await room.alarm();

    expect(room.recoverFromStorage).toHaveBeenCalledTimes(1);
  });

  it('marks websocket metadata rebuilt from hibernation tags as auth-state-lost', async () => {
    const { RoomRuntimeBaseDO } = await import('../durable-objects/room-runtime-base.js');

    const room: any = Object.create(RoomRuntimeBaseDO.prototype);
    room._metaCache = new Map();
    room._attachmentExtraCache = new Map();
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
    room._attachmentExtraCache = new Map();
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
    room._attachmentExtraCache = new Map();
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
