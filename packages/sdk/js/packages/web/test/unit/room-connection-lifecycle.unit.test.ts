import { describe, expect, it } from 'vitest';
import { RoomConnectionLifecycle } from '../../src/room-connection-lifecycle.js';

describe('RoomConnectionLifecycle', () => {
  it('makes transport, auth, join and sync distinct checkpoints', () => {
    const lifecycle = new RoomConnectionLifecycle();

    lifecycle.beginTransport();
    expect(lifecycle.snapshot()).toMatchObject({
      phase: 'transport_connecting',
      transportOpen: false,
      authenticated: false,
      joined: false,
      synchronized: false,
    });

    lifecycle.markTransportOpen();
    expect(lifecycle.phase).toBe('transport_open');
    lifecycle.beginAuthentication();
    expect(lifecycle.phase).toBe('authenticating');
    lifecycle.markAuthenticated();
    expect(lifecycle.phase).toBe('authenticated');
    lifecycle.beginJoin();
    expect(lifecycle.phase).toBe('joining');
    lifecycle.markJoinSent();
    expect(lifecycle.phase).toBe('syncing');
    expect(lifecycle.synchronized).toBe(false);
    lifecycle.markSynchronized();
    expect(lifecycle.snapshot()).toMatchObject({
      phase: 'ready',
      transportOpen: true,
      authenticated: true,
      joined: true,
      synchronized: true,
    });
  });

  it('cascades a transport loss through auth, join and sync ownership', () => {
    const lifecycle = new RoomConnectionLifecycle();
    lifecycle.markSynchronized();

    lifecycle.setTransportOpen(false);

    expect(lifecycle.snapshot()).toEqual({
      phase: 'disconnected',
      transportOpen: false,
      authenticated: false,
      joined: false,
      synchronized: false,
    });
  });

  it('keeps reconnect and terminal auth loss explicit', () => {
    const lifecycle = new RoomConnectionLifecycle();
    lifecycle.markSynchronized();
    lifecycle.waitForReconnect();
    expect(lifecycle.phase).toBe('reconnect_wait');
    expect(lifecycle.transportOpen).toBe(false);

    lifecycle.stop('auth_lost');
    expect(lifecycle.phase).toBe('auth_lost');
    expect(lifecycle.authenticated).toBe(false);
  });
});
