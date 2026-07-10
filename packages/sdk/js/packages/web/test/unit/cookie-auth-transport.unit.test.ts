import { afterEach, describe, expect, it, vi } from 'vitest';
import { EdgeBaseError } from '@edge-base/core';
import { createClient } from '../../src/client.js';
import { isAuthResult } from '../../src/auth.js';
import { DatabaseLiveClient } from '../../src/database-live.js';
import { refreshAccessToken } from '../../src/auth-refresh.js';
import { RoomClient } from '../../src/room.js';
import { TokenManager } from '../../src/token-manager.js';

function encodeBase64UrlJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function makeJwt(userId: string, extra: Record<string, unknown> = {}): string {
  const header = encodeBase64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeBase64UrlJson({
    sub: userId,
    email: `${userId}@example.com`,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...extra,
  });
  return `${header}.${payload}.signature`;
}

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  static messages: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  private listeners = new Set<(event: MessageEvent) => void>();

  constructor(public name: string) {
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    MockBroadcastChannel.messages.push(data);
    for (const peer of MockBroadcastChannel.instances) {
      if (peer === this || peer.name !== this.name) continue;
      const event = { data } as MessageEvent;
      peer.onmessage?.(event);
      for (const listener of peer.listeners) listener(event);
    }
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (type === 'message') this.listeners.delete(listener);
  }

  close(): void {
    MockBroadcastChannel.instances = MockBroadcastChannel.instances.filter((item) => item !== this);
  }

  static reset(): void {
    MockBroadcastChannel.instances = [];
    MockBroadcastChannel.messages = [];
  }
}

interface BrowserHarness {
  store: Map<string, string>;
  listeners: Map<string, Set<(event?: Event) => void>>;
  dispatch(type: string, event?: Event): void;
}

function installBrowserMocks(withBroadcastChannel = true): BrowserHarness {
  const store = new Map<string, string>();
  const listeners = new Map<string, Set<(event?: Event) => void>>();
  const windowMock = {
    location: {
      origin: 'https://app.example.com',
      href: 'https://app.example.com/auth/callback',
    },
    history: { replaceState: vi.fn() },
    addEventListener: vi.fn((type: string, listener: (event?: Event) => void) => {
      const entries = listeners.get(type) ?? new Set();
      entries.add(listener);
      listeners.set(type, entries);
    }),
    removeEventListener: vi.fn((type: string, listener: (event?: Event) => void) => {
      listeners.get(type)?.delete(listener);
    }),
  };
  vi.stubGlobal('window', windowMock);
  vi.stubGlobal('document', { title: 'Test' });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  if (withBroadcastChannel) {
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel as unknown as typeof BroadcastChannel);
  } else {
    vi.stubGlobal('BroadcastChannel', undefined);
  }
  return {
    store,
    listeners,
    dispatch(type: string, event?: Event) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  MockBroadcastChannel.reset();
});

describe('HttpOnly-cookie TokenManager', () => {
  it('stores only a non-secret session marker and never broadcasts credentials', async () => {
    const { store } = installBrowserMocks();
    const staleAccess = makeJwt('cookie-user', { exp: 1 });
    const freshAccess = makeJwt('cookie-user');
    const manager = new TokenManager('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });

    manager.setTokens({ accessToken: staleAccess, refreshToken: 'must-not-persist' });
    await expect(manager.getAccessToken(async () => ({
      accessToken: freshAccess,
      refreshToken: 'must-not-broadcast',
    }))).resolves.toBe(freshAccess);

    expect(store.has('edgebase:refresh-token')).toBe(false);
    const marker = store.get('edgebase:cookie-session') ?? '';
    expect(marker).toBe(JSON.stringify({ version: 1, userId: 'cookie-user' }));
    expect(marker).not.toContain(staleAccess);
    expect(marker).not.toContain(freshAccess);
    const signal = store.get('edgebase:refresh-result') ?? '';
    expect(signal).toContain('nonce');
    expect(signal).not.toContain(freshAccess);
    expect(JSON.stringify(MockBroadcastChannel.messages)).not.toContain(freshAccess);
    expect(JSON.stringify(MockBroadcastChannel.messages)).not.toContain('must-not-broadcast');
    const persistedValues = JSON.stringify([...store.values()]);
    expect(persistedValues).not.toContain(staleAccess);
    expect(persistedValues).not.toContain(freshAccess);
    expect(persistedValues).not.toContain('must-not-persist');
    expect(persistedValues).not.toContain('must-not-broadcast');

    manager.destroy();
  });

  it('restores no online identity from a forged marker and only an id hint while explicitly offline', async () => {
    const { store } = installBrowserMocks();
    vi.stubGlobal('navigator', { onLine: true });
    store.set('edgebase:cookie-session', JSON.stringify({
      version: 1,
      userId: 'marker-user',
      email: 'must-not-restore@example.com',
      role: 'admin',
      custom: { elevated: true },
      accessToken: 'forged-access-token',
      refreshToken: 'forged-refresh-token',
    }));
    const online = new TokenManager('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });

    expect(online.getCurrentUser()).toBeNull();
    const verifiedAccess = makeJwt('verified-user', {
      email: 'verified@example.com',
      custom: { plan: 'pro' },
    });
    await online.forceRefresh(async () => ({
      accessToken: verifiedAccess,
      refreshToken: '',
    }));
    expect(online.getCurrentUser()).toMatchObject({
      id: 'verified-user',
      email: 'verified@example.com',
    });
    expect(store.get('edgebase:cookie-session')).toBe(
      JSON.stringify({ version: 1, userId: 'verified-user' }),
    );
    online.destroy();

    vi.stubGlobal('navigator', { onLine: false });
    const offline = new TokenManager('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    expect(offline.getCurrentUser()).toEqual({ id: 'verified-user' });
    expect(offline.getCurrentUser()).not.toHaveProperty('email');
    expect(offline.getCurrentUser()).not.toHaveProperty('custom');
    offline.destroy();
  });

  it('keeps a verified in-memory user and promotes only its id after an online reload network failure', async () => {
    const { store } = installBrowserMocks();
    vi.stubGlobal('navigator', { onLine: true });
    const manager = new TokenManager('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    manager.setTokens({
      accessToken: makeJwt('network-user', {
        exp: 1,
        email: 'network@example.com',
        custom: { privateClaim: 'not-persisted' },
      }),
      refreshToken: '',
    });

    await expect(manager.getAccessToken(async () => {
      throw new EdgeBaseError(0, 'offline', undefined, 'network-error');
    })).rejects.toMatchObject({ code: 0 });
    expect(manager.getCurrentUser()?.id).toBe('network-user');
    expect(JSON.stringify([...store.values()])).not.toContain('network@example.com');
    expect(JSON.stringify([...store.values()])).not.toContain('privateClaim');
    manager.destroy();

    const reloaded = new TokenManager('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    expect(reloaded.getCurrentUser()).toBeNull();
    const states: Array<{ id: string } | null> = [];
    const unsubscribe = reloaded.onAuthStateChange((user) => {
      states.push(user ? { id: user.id } : null);
    });
    await expect(reloaded.getAccessToken(async () => {
      throw new EdgeBaseError(0, 'still offline', undefined, 'network-error');
    })).rejects.toMatchObject({ code: 0 });
    expect(reloaded.getCurrentUser()).toEqual({ id: 'network-user' });
    expect(states).toEqual([null, { id: 'network-user' }]);
    unsubscribe();
    reloaded.destroy();
  });

  it('promotes the id-only marker after a transient 5xx refresh failure', async () => {
    const { store } = installBrowserMocks();
    vi.stubGlobal('navigator', { onLine: true });
    store.set('edgebase:cookie-session', JSON.stringify({ version: 1, userId: 'server-error-user' }));
    const manager = new TokenManager('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });

    expect(manager.getCurrentUser()).toBeNull();
    await expect(manager.getAccessToken(async () => {
      throw new EdgeBaseError(503, 'temporarily unavailable');
    })).rejects.toMatchObject({ code: 503 });
    expect(manager.getCurrentUser()).toEqual({ id: 'server-error-user' });
    expect(store.get('edgebase:cookie-session')).toBe(
      JSON.stringify({ version: 1, userId: 'server-error-user' }),
    );
    manager.destroy();
  });

  it('removes a stale online marker after the server definitively rejects the cookie session', async () => {
    const { store } = installBrowserMocks();
    vi.stubGlobal('navigator', { onLine: true });
    store.set('edgebase:cookie-session', JSON.stringify({ version: 1, userId: 'stale-user' }));
    const manager = new TokenManager('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });

    expect(manager.getCurrentUser()).toBeNull();
    await expect(manager.getAccessToken(async () => {
      throw new EdgeBaseError(401, 'expired cookie');
    })).rejects.toMatchObject({ code: 401 });
    expect(manager.getCurrentUser()).toBeNull();
    expect(store.has('edgebase:cookie-session')).toBe(false);
    manager.destroy();
  });

  it('migrates a legacy refresh token only after a successful cookie exchange', async () => {
    const { store } = installBrowserMocks();
    const legacyRefresh = makeJwt('legacy-user', { type: 'refresh' });
    store.set('edgebase:refresh-token', legacyRefresh);
    const manager = new TokenManager('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    const received: string[] = [];

    await manager.getAccessToken(async (token) => {
      received.push(token);
      return { accessToken: makeJwt('legacy-user'), refreshToken: '' };
    });

    expect(received).toEqual([legacyRefresh]);
    expect(store.has('edgebase:refresh-token')).toBe(false);
    expect(store.has('edgebase:cookie-session')).toBe(true);
    manager.destroy();
  });

  it('invalidates an old principal, closes realtime sockets, then safely revalidates the new account', async () => {
    const { store, listeners } = installBrowserMocks();
    vi.stubGlobal('navigator', { onLine: true });
    const oldManager = new TokenManager('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    oldManager.setTokens({ accessToken: makeJwt('account-a'), refreshToken: '' });
    const authStates: Array<string | null> = [];
    oldManager.onAuthStateChange((user) => authStates.push(user?.id ?? null));
    const revalidate = vi.fn(async () => ({
      accessToken: makeJwt('account-b'),
      refreshToken: '',
    }));
    oldManager.setCookieRevalidationHandler(revalidate);

    const room = new RoomClient(
      'https://api.example.com',
      'workspace',
      'room-1',
      oldManager,
    );
    const roomClose = vi.fn();
    (room as unknown as Record<string, unknown>).ws = {
      readyState: 1,
      send: vi.fn(),
      close: roomClose,
    };
    (room as unknown as Record<string, unknown>).connected = true;
    (room as unknown as Record<string, unknown>).authenticated = true;
    (room as unknown as Record<string, unknown>).joined = true;
    (room as unknown as Record<string, unknown>).currentUserId = 'account-a';

    const live = new DatabaseLiveClient('https://api.example.com', oldManager);
    const liveClose = vi.fn();
    (live as unknown as Record<string, unknown>).ws = { close: liveClose };
    (live as unknown as Record<string, unknown>).connected = true;
    (live as unknown as Record<string, unknown>).authenticated = true;

    const markerB = JSON.stringify({ version: 1, userId: 'account-b' });
    store.set('edgebase:cookie-session', markerB);
    const oldTabStorageListener = [...(listeners.get('storage') ?? [])][0];
    oldTabStorageListener?.({
      key: 'edgebase:cookie-session',
      oldValue: JSON.stringify({ version: 1, userId: 'account-a' }),
      newValue: markerB,
    } as StorageEvent);

    expect(oldManager.getCurrentUser()).toBeNull();
    expect(oldManager.currentAccessToken).toBeNull();
    expect(room.getConnectionState()).toBe('auth_lost');
    expect(roomClose).toHaveBeenCalledWith(4005, 'Signed out');
    expect(liveClose).toHaveBeenCalledWith(1000, 'Signed out');

    await vi.waitFor(() => {
      expect(oldManager.getCurrentUser()?.id).toBe('account-b');
    });
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(authStates).toEqual(['account-a', null, 'account-b']);

    room.destroy();
    live.disconnect();
    oldManager.destroy();
  });

  it('validates a peer login before propagating it into a signed-out online tab', async () => {
    const { store, listeners } = installBrowserMocks();
    vi.stubGlobal('navigator', { onLine: true });
    const manager = new TokenManager('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    const states: Array<string | null> = [];
    manager.onAuthStateChange((user) => states.push(user?.id ?? null));
    const revalidate = vi.fn(async () => ({
      accessToken: makeJwt('peer-login-user'),
      refreshToken: '',
    }));
    manager.setCookieRevalidationHandler(revalidate);

    const marker = JSON.stringify({ version: 1, userId: 'peer-login-user' });
    store.set('edgebase:cookie-session', marker);
    const storageListener = [...(listeners.get('storage') ?? [])][0];
    storageListener?.({
      key: 'edgebase:cookie-session',
      oldValue: null,
      newValue: marker,
    } as StorageEvent);

    expect(manager.getCurrentUser()).toBeNull();
    await vi.waitFor(() => expect(manager.getCurrentUser()?.id).toBe('peer-login-user'));
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(states).toEqual([null, null, 'peer-login-user']);
    manager.destroy();
  });

  it('rejects a late old-principal refresh without deleting the new account marker', async () => {
    const { store, listeners } = installBrowserMocks();
    vi.stubGlobal('navigator', { onLine: true });
    const manager = new TokenManager('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    manager.setTokens({ accessToken: makeJwt('account-a', { exp: 1 }), refreshToken: '' });

    let resolveRefresh!: (tokens: { accessToken: string; refreshToken: string }) => void;
    const refresh = manager.getAccessToken(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    const markerB = JSON.stringify({ version: 1, userId: 'account-b' });
    store.set('edgebase:cookie-session', markerB);
    const storageListener = [...(listeners.get('storage') ?? [])][0];
    storageListener?.({
      key: 'edgebase:cookie-session',
      oldValue: JSON.stringify({ version: 1, userId: 'account-a' }),
      newValue: markerB,
    } as StorageEvent);
    resolveRefresh({ accessToken: makeJwt('account-a'), refreshToken: '' });

    await expect(refresh).rejects.toMatchObject({
      code: 401,
      slug: 'auth-state-changed',
    });
    expect(store.get('edgebase:cookie-session')).toBe(markerB);
    expect(manager.getCurrentUser()).toBeNull();
    expect(MockBroadcastChannel.messages).not.toContainEqual({ type: 'signed-out' });
    manager.destroy();
  });

  it('rejects a peer success that arrives after another tab definitively loses cookie auth', async () => {
    const { store } = installBrowserMocks();
    const lateManager = new TokenManager('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    const rejectedManager = new TokenManager('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    lateManager.setTokens({ accessToken: makeJwt('revoked-user', { exp: 1 }), refreshToken: '' });
    rejectedManager.setTokens({ accessToken: makeJwt('revoked-user', { exp: 1 }), refreshToken: '' });

    let resolveLate!: (tokens: { accessToken: string; refreshToken: string }) => void;
    const lateRefresh = lateManager.getAccessToken(() => new Promise((resolve) => {
      resolveLate = resolve;
    }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    // Simulate the first tab becoming unreachable immediately after its fetch
    // was sent, allowing the peer to acquire the shared lock and receive the
    // server's definitive denial first.
    store.delete('edgebase:refresh-lock');
    await expect(rejectedManager.getAccessToken(async () => {
      throw new EdgeBaseError(401, 'Cookie session revoked.', undefined, 'invalid-refresh-token');
    })).rejects.toMatchObject({ code: 401 });
    expect(store.has('edgebase:cookie-session')).toBe(false);

    resolveLate({ accessToken: makeJwt('revoked-user'), refreshToken: '' });
    await expect(lateRefresh).rejects.toMatchObject({
      code: 401,
      slug: 'auth-state-changed',
    });
    expect(lateManager.getCurrentUser()).toBeNull();
    expect(rejectedManager.getCurrentUser()).toBeNull();
    expect(store.has('edgebase:cookie-session')).toBe(false);
    lateManager.destroy();
    rejectedManager.destroy();
  });

  it('keeps the legacy migration token on network failure and removes it on definitive 401/403', async () => {
    for (const code of [0, 401, 403]) {
      const { store } = installBrowserMocks();
      const namespace = `migration-${code}`;
      const key = `edgebase:${namespace}:refresh-token`;
      const legacyRefresh = makeJwt(`legacy-${code}`, { type: 'refresh' });
      store.set(key, legacyRefresh);
      const manager = new TokenManager('https://api.example.com', {
        authNamespace: namespace,
        refreshTokenTransport: 'httpOnlyCookie',
      });

      await expect(manager.getAccessToken(async () => {
        throw new EdgeBaseError(code, 'refresh failed', undefined, code === 0 ? 'network-error' : undefined);
      })).rejects.toMatchObject({ code });

      expect(store.get(key)).toBe(code === 0 ? legacyRefresh : undefined);
      manager.destroy();
      vi.unstubAllGlobals();
      MockBroadcastChannel.reset();
    }
  });

  it('uses a nonce in the no-BroadcastChannel fallback and makes the follower self-refresh', async () => {
    const { store } = installBrowserMocks(false);
    const leader = new TokenManager('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    const follower = new TokenManager('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    leader.setTokens({ accessToken: makeJwt('leader', { exp: 1 }), refreshToken: '' });
    follower.setTokens({ accessToken: makeJwt('follower', { exp: 1 }), refreshToken: '' });
    const leaderAccess = makeJwt('leader-fresh');
    const followerAccess = makeJwt('follower-fresh');
    const leaderRefresh = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { accessToken: leaderAccess, refreshToken: '' };
    });
    const followerRefresh = vi.fn(async () => ({
      accessToken: followerAccess,
      refreshToken: '',
    }));

    const leaderResult = leader.getAccessToken(leaderRefresh);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const followerResult = follower.getAccessToken(followerRefresh);

    await expect(leaderResult).resolves.toBe(leaderAccess);
    await expect(followerResult).resolves.toBe(followerAccess);
    expect(leaderRefresh).toHaveBeenCalledTimes(1);
    expect(followerRefresh).toHaveBeenCalledTimes(1);
    const signal = store.get('edgebase:refresh-result') ?? '';
    expect(signal).toContain('nonce');
    expect(signal).not.toContain(leaderAccess);
    expect(signal).not.toContain(followerAccess);

    leader.destroy();
    follower.destroy();
  });

  it('does not wait for a second signal when the winning tab releases the lock before verification', async () => {
    installBrowserMocks(false);
    const manager = new TokenManager('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    manager.setTokens({ accessToken: makeJwt('race-user', { exp: 1 }), refreshToken: '' });
    const originalSetItem = localStorage.setItem.bind(localStorage);
    const originalRemoveItem = localStorage.removeItem.bind(localStorage);
    let intercepted = false;
    vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      originalSetItem(key, value);
      if (key !== 'edgebase:refresh-lock' || intercepted) return;
      intercepted = true;
      originalSetItem(key, JSON.stringify({ ownerId: 'peer', timestamp: Date.now() }));
      originalSetItem('edgebase:refresh-result', JSON.stringify({
        nonce: 'peer-finished',
        timestamp: Date.now(),
      }));
      originalRemoveItem(key);
    });
    const freshAccess = makeJwt('race-user-fresh');
    const refresh = vi.fn(async () => ({ accessToken: freshAccess, refreshToken: '' }));

    await expect(manager.getAccessToken(refresh)).resolves.toBe(freshAccess);
    expect(refresh).toHaveBeenCalledTimes(1);
    manager.destroy();
  });
});

describe('HttpOnly-cookie AuthClient', () => {
  it('signs in without exposing a refresh token and persists only the non-secret marker', async () => {
    const { store } = installBrowserMocks();
    const accessToken = makeJwt('signin-cookie-user', { sid: 'signin-session' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      user: { id: 'signin-cookie-user', email: 'signin@example.com' },
      accessToken,
      refreshToken: 'server-must-not-expose-this',
      sessionTransport: 'cookie',
      sessionId: 'signin-session',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });

    const result = await client.auth.signIn({
      email: 'signin@example.com',
      password: 'password',
      captchaToken: 'captcha-token',
    });

    expect(result).toMatchObject({
      user: { id: 'signin-cookie-user' },
      accessToken,
      sessionTransport: 'cookie',
      sessionId: 'signin-session',
    });
    expect(result.refreshToken).toBe('');
    expect(store.has('edgebase:refresh-token')).toBe(false);
    expect(store.get('edgebase:cookie-session')).toBe(
      JSON.stringify({ version: 1, userId: 'signin-cookie-user' }),
    );
    const persisted = JSON.stringify([...store.values()]);
    expect(persisted).not.toContain(accessToken);
    expect(persisted).not.toContain('signin@example.com');
    expect(persisted).not.toContain('server-must-not-expose-this');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('X-EdgeBase-Auth-Transport')).toBe('cookie');

    client.destroy();
  });

  it('sends cookie auth options, accepts a tokenless refresh result, and recovers OAuth without URL tokens', async () => {
    installBrowserMocks();
    (window as unknown as { location: { href: string } }).location.href =
      'https://app.example.com/auth/callback?keep=query&auth_transport=stale#auth_transport=cookie&state=keep-fragment';
    const accessToken = makeJwt('oauth-cookie-user', { sid: 'session-1' });
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/refresh')) {
        return new Response(JSON.stringify({
          user: { id: 'oauth-cookie-user', email: 'oauth@example.com' },
          accessToken,
          sessionTransport: 'cookie',
          sessionId: 'session-1',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });

    const start = client.auth.signInWithOAuth('github', { navigate: false });
    expect(start.url).toContain('auth_transport=cookie');
    const result = await client.auth.handleOAuthCallback();

    expect(result).toMatchObject({
      user: { id: 'oauth-cookie-user' },
      accessToken,
      sessionTransport: 'cookie',
      sessionId: 'session-1',
    });
    expect(result?.refreshToken).toBe('');
    const refreshInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(refreshInit.credentials).toBe('include');
    expect(new Headers(refreshInit.headers).get('X-EdgeBase-Auth-Transport')).toBe('cookie');
    expect(refreshInit.body).toBe('{}');
    expect(window.history.replaceState).toHaveBeenCalledWith(
      {},
      'Test',
      '/auth/callback?keep=query#state=keep-fragment',
    );

    // Query callbacks remain compatible with older servers/redirect handlers.
    await expect(client.auth.handleOAuthCallback(
      'https://app.example.com/auth/callback?auth_transport=cookie',
    )).resolves.toMatchObject({ user: { id: 'oauth-cookie-user' } });

    const callsAfterSuccess = fetchMock.mock.calls.length;
    (window as unknown as { location: { href: string } }).location.href =
      'https://app.example.com/auth/callback?keep=query&error_description=Denied#auth_transport=cookie&error=access_denied&state=keep-fragment';
    await expect(client.auth.handleOAuthCallback()).resolves.toBeNull();
    expect(window.history.replaceState).toHaveBeenLastCalledWith(
      {},
      'Test',
      '/auth/callback?keep=query#state=keep-fragment',
    );
    await expect(client.auth.handleOAuthCallback(
      'https://app.example.com/auth/callback',
    )).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterSuccess);

    client.destroy();
  });

  it('keeps AuthResult.refreshToken required but empty across every cookie-mode auth result', async () => {
    installBrowserMocks();
    const accessToken = makeJwt('compat-user', { sid: 'compat-session' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      user: { id: 'compat-user', email: 'compat@example.com' },
      accessToken,
      refreshToken: 'must-never-reach-cookie-callers',
      sessionTransport: 'cookie',
      sessionId: 'compat-session',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });

    const results = await Promise.all([
      client.auth.signUp({ email: 'compat@example.com', password: 'password', captchaToken: 'captcha' }),
      client.auth.signIn({ email: 'compat@example.com', password: 'password', captchaToken: 'captcha' }),
      client.auth.signInAnonymously({ captchaToken: 'captcha' }),
      client.auth.verifyMagicLink('magic-token'),
      client.auth.verifyPhone({ phone: '+15555550123', code: '123456' }),
      client.auth.linkWithEmail({ email: 'compat@example.com', password: 'password' }),
      client.auth.changePassword({ currentPassword: 'password', newPassword: 'new-password' }),
      client.auth.verifyEmailOtp({ email: 'compat@example.com', code: '123456' }),
      client.auth.passkeysAuthenticate({ assertion: true }),
      client.auth.mfa.verifyTotp('mfa-ticket', '123456'),
      client.auth.mfa.useRecoveryCode('mfa-ticket', 'recovery-code'),
      client.auth.refreshSession(),
    ]);

    for (const result of results) {
      expect(isAuthResult(result)).toBe(true);
      if (isAuthResult(result)) {
        expect(result).toHaveProperty('refreshToken', '');
        expect(result.sessionTransport).toBe('cookie');
      }
    }
    expect(JSON.stringify(results)).not.toContain('must-never-reach-cookie-callers');
    client.destroy();
  });

  it('recovers a cookie OAuth callback after the first refresh fails transiently and the URL is scrubbed', async () => {
    const { store } = installBrowserMocks();
    (window as unknown as { location: { href: string } }).location.href =
      'https://app.example.com/auth/callback#auth_transport=cookie';
    let refreshAttempts = 0;
    const recoveredAccess = makeJwt('oauth-recovered-user', { sid: 'oauth-recovered-session' });
    const fetchMock = vi.fn(async (input: string | URL) => {
      if (!String(input).endsWith('/api/auth/refresh')) {
        throw new Error(`Unexpected request: ${String(input)}`);
      }
      refreshAttempts += 1;
      if (refreshAttempts <= 3) {
        throw new TypeError('network offline');
      }
      return new Response(JSON.stringify({
        user: { id: 'oauth-recovered-user' },
        accessToken: recoveredAccess,
        sessionTransport: 'cookie',
        sessionId: 'oauth-recovered-session',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = createClient('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    await expect(first.auth.handleOAuthCallback()).resolves.toBeNull();
    expect(window.history.replaceState).toHaveBeenCalledWith({}, 'Test', '/auth/callback');
    expect(store.has('edgebase:cookie-oauth-recovery')).toBe(true);
    expect(store.has('edgebase:cookie-session')).toBe(false);
    first.destroy();

    (window as unknown as { location: { href: string } }).location.href =
      'https://app.example.com/auth/callback';
    const reloaded = createClient('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    await expect(reloaded.auth.handleOAuthCallback()).resolves.toMatchObject({
      user: { id: 'oauth-recovered-user' },
      accessToken: recoveredAccess,
      sessionTransport: 'cookie',
    });
    expect(store.has('edgebase:cookie-oauth-recovery')).toBe(false);
    expect(store.get('edgebase:cookie-session')).toBe(
      JSON.stringify({ version: 1, userId: 'oauth-recovered-user' }),
    );
    reloaded.destroy();
  });

  it('fails closed and scrubs legacy OAuth bearer tokens in a cookie-mode rolling upgrade', async () => {
    const { store } = installBrowserMocks();
    (window as unknown as { location: { href: string } }).location.href =
      'https://app.example.com/auth/callback?keep=query&access_token=stale-query#access_token=legacy-access&refresh_token=legacy-refresh&state=keep-fragment';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });

    await expect(client.auth.handleOAuthCallback()).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.auth.currentUser).toBeNull();
    expect(store.has('edgebase:cookie-session')).toBe(false);
    expect(store.has('edgebase:refresh-token')).toBe(false);
    expect(window.history.replaceState).toHaveBeenCalledWith(
      {},
      'Test',
      '/auth/callback?keep=query#state=keep-fragment',
    );
    client.destroy();
  });

  it('preserves a server-provided current session flag', async () => {
    installBrowserMocks();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      sessions: [{ id: 'server-current', createdAt: '2026-01-01T00:00:00Z', current: true }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    const manager = (client as unknown as { tokenManager: TokenManager }).tokenManager;
    manager.setTokens({ accessToken: makeJwt('session-user'), refreshToken: '' });

    await expect(client.auth.listSessions()).resolves.toEqual([
      expect.objectContaining({ id: 'server-current', current: true }),
    ]);
    client.destroy();
  });

  it('routes current-session revocation through POST sign-out and clears local state', async () => {
    const { store } = installBrowserMocks();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    const manager = (client as unknown as { tokenManager: TokenManager }).tokenManager;
    manager.setTokens({
      accessToken: makeJwt('current-session-user', { sid: 'current-session' }),
      refreshToken: '',
    });

    await client.auth.revokeSession('current-session');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.example.com/api/auth/signout');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('X-EdgeBase-Auth-Transport')).toBe('cookie');
    expect(client.auth.currentUser).toBeNull();
    expect(store.has('edgebase:cookie-session')).toBe(false);
    expect(store.has('edgebase:pending-signout')).toBe(false);
    client.destroy();
  });

  it('keeps non-current session revocation as a bearer DELETE without cookie transport', async () => {
    installBrowserMocks();
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    const manager = (client as unknown as { tokenManager: TokenManager }).tokenManager;
    manager.setTokens({
      accessToken: makeJwt('other-session-user', { sid: 'current-session' }),
      refreshToken: '',
    });

    await client.auth.revokeSession('other-session');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.example.com/api/auth/sessions/other-session',
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('DELETE');
    expect(init.credentials).toBeUndefined();
    expect(new Headers(init.headers).has('X-EdgeBase-Auth-Transport')).toBe(false);
    expect(new Headers(init.headers).get('Authorization')).toBeTruthy();
    expect(client.auth.currentUser?.id).toBe('other-session-user');
    client.destroy();
  });

  it('revokes a legacy migration session while clearing the persisted token immediately', async () => {
    const { store } = installBrowserMocks();
    const legacyRefreshToken = makeJwt('legacy-signout-user', { type: 'refresh' });
    store.set('edgebase:refresh-token', legacyRefreshToken);
    let finishSignOut!: () => void;
    const signOutGate = new Promise<void>((resolve) => {
      finishSignOut = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await signOutGate;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });

    const signOut = client.auth.signOut();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(client.auth.currentUser).toBeNull();
    expect(store.has('edgebase:refresh-token')).toBe(false);
    expect(store.has('edgebase:cookie-session')).toBe(false);
    expect(store.has('edgebase:pending-signout')).toBe(true);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({ refreshToken: legacyRefreshToken }));

    finishSignOut();
    await signOut;
    expect(store.has('edgebase:pending-signout')).toBe(false);
    client.destroy();
  });

  it('keeps the in-memory legacy revoke credential across a repeated sign-out', async () => {
    const { store } = installBrowserMocks();
    const legacyRefreshToken = makeJwt('legacy-double-signout', { type: 'refresh' });
    store.set('edgebase:refresh-token', legacyRefreshToken);
    let attempts = 0;
    const bodies: string[] = [];
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      attempts += 1;
      bodies.push(String(init?.body));
      if (attempts === 1) {
        return new Response(JSON.stringify({ message: 'temporary failure' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });

    await client.auth.signOut();
    expect(store.has('edgebase:refresh-token')).toBe(false);
    expect(store.has('edgebase:pending-signout')).toBe(true);
    await client.auth.signOut();

    expect(bodies).toEqual([
      JSON.stringify({ refreshToken: legacyRefreshToken }),
      JSON.stringify({ refreshToken: legacyRefreshToken }),
    ]);
    expect(store.has('edgebase:pending-signout')).toBe(false);
    client.destroy();
  });

  it('serializes a new sign-in behind a retry after transient sign-out failure', async () => {
    const { store } = installBrowserMocks();
    const calls: string[] = [];
    const signedInAccess = makeJwt('new-account', { sid: 'new-session' });
    let signOutAttempts = 0;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/signout')) {
        signOutAttempts += 1;
        calls.push(`signout-${signOutAttempts}`);
        if (signOutAttempts === 1) {
          return new Response(JSON.stringify({ message: 'temporary failure' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/api/auth/signin')) {
        calls.push('signin');
        return new Response(JSON.stringify({
          user: { id: 'new-account' },
          accessToken: signedInAccess,
          sessionTransport: 'cookie',
          sessionId: 'new-session',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    const manager = (client as unknown as { tokenManager: TokenManager }).tokenManager;
    manager.setTokens({ accessToken: makeJwt('old-account'), refreshToken: '' });

    await client.auth.signOut();
    expect(store.has('edgebase:pending-signout')).toBe(true);
    const result = await client.auth.signIn({
      email: 'new@example.com',
      password: 'password',
      captchaToken: 'captcha',
    });

    expect(calls).toEqual(['signout-1', 'signout-2', 'signin']);
    expect(result).toMatchObject({ user: { id: 'new-account' } });
    expect(client.auth.currentUser?.id).toBe('new-account');
    expect(store.has('edgebase:pending-signout')).toBe(false);
    client.destroy();
  });

  it('surfaces a 403 sign-out policy denial and keeps the server-revocation tombstone', async () => {
    const { store } = installBrowserMocks();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 403,
      slug: 'hook-rejected',
      message: 'beforeSignOut rejected the operation.',
    }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    const manager = (client as unknown as { tokenManager: TokenManager }).tokenManager;
    manager.setTokens({ accessToken: makeJwt('policy-user'), refreshToken: '' });

    await expect(client.auth.signOut()).rejects.toMatchObject({
      code: 403,
      slug: 'hook-rejected',
    });
    expect(client.auth.currentUser).toBeNull();
    expect(manager.currentAccessToken).toBeNull();
    expect(store.has('edgebase:cookie-session')).toBe(false);
    expect(store.has('edgebase:pending-signout')).toBe(true);
    client.destroy();
  });

  it('keeps an offline sign-out tombstone, retries it on boot, and blocks refresh until revoke finishes', async () => {
    const { store } = installBrowserMocks();
    const legacyRefreshToken = makeJwt('signed-out-user', { type: 'refresh' });
    store.set('edgebase:refresh-token', legacyRefreshToken);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('offline');
    }));
    const first = createClient('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    const firstManager = (first as unknown as { tokenManager: TokenManager }).tokenManager;
    firstManager.setAccessToken(makeJwt('signed-out-user'));
    await first.auth.signOut();

    expect(store.has('edgebase:pending-signout')).toBe(true);
    expect(store.has('edgebase:refresh-token')).toBe(false);
    expect(first.auth.currentUser).toBeNull();
    first.destroy();

    let finishRevoke!: () => void;
    const revokeGate = new Promise<void>((resolve) => {
      finishRevoke = resolve;
    });
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/signout')) {
        await revokeGate;
        return new Response(null, { status: 204 });
      }
      if (url.endsWith('/api/auth/refresh')) {
        return new Response(JSON.stringify({ message: 'Session revoked' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const booted = createClient('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    expect(booted.auth.currentUser).toBeNull();
    const bootedManager = (booted as unknown as { tokenManager: TokenManager }).tokenManager;
    const automaticRefresh = vi.fn(async () => ({
      accessToken: makeJwt('unexpected-auto-refresh'),
      refreshToken: '',
    }));
    const automaticAccess = bootedManager.getAccessToken(automaticRefresh);
    const refresh = booted.auth.refreshSession();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/api/auth/refresh'))).toHaveLength(0);
    finishRevoke();
    await expect(automaticAccess).resolves.toBeNull();
    expect(automaticRefresh).not.toHaveBeenCalled();
    await expect(refresh).rejects.toMatchObject({ code: 401 });
    expect(store.has('edgebase:pending-signout')).toBe(false);
    expect(store.has('edgebase:refresh-token')).toBe(false);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/api/auth/refresh'))).toHaveLength(1);

    const signOutInit = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/api/auth/signout'))?.[1] as RequestInit;
    expect(signOutInit.credentials).toBe('include');
    expect(new Headers(signOutInit.headers).get('X-EdgeBase-Auth-Transport')).toBe('cookie');
    expect(signOutInit.body).toBe('{}');
    booted.destroy();
  });

  it('orders sign-out after an already in-flight refresh and never resurrects local auth state', async () => {
    const { store } = installBrowserMocks();
    let finishRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const requests: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/refresh')) {
        requests.push('refresh-start');
        await refreshGate;
        requests.push('refresh-finish');
        return new Response(JSON.stringify({
          user: { id: 'race-signout-user' },
          accessToken: makeJwt('race-signout-user', { sid: 'race-session' }),
          sessionTransport: 'cookie',
          sessionId: 'race-session',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/auth/signout')) {
        requests.push('signout');
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createClient('https://api.example.com', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    const manager = (client as unknown as { tokenManager: TokenManager }).tokenManager;
    manager.setTokens({
      accessToken: makeJwt('race-signout-user', { exp: 1 }),
      refreshToken: '',
    });

    const refresh = client.auth.refreshSession();
    while (!requests.includes('refresh-start')) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const signOut = client.auth.signOut();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requests).toEqual(['refresh-start']);

    finishRefresh();
    await expect(refresh).rejects.toMatchObject({ code: 401 });
    await signOut;

    expect(requests).toEqual(['refresh-start', 'refresh-finish', 'signout']);
    expect(client.auth.currentUser).toBeNull();
    expect(store.has('edgebase:cookie-session')).toBe(false);
    expect(store.has('edgebase:refresh-token')).toBe(false);
    expect(store.has('edgebase:pending-signout')).toBe(false);
    client.destroy();
  });

  it('keeps sign-out behind a heartbeating peer refresh beyond the old lock timeout', async () => {
    vi.useFakeTimers();
    try {
      const { store } = installBrowserMocks();
      const requests: string[] = [];
      let finishRefresh!: () => void;
      const refreshGate = new Promise<void>((resolve) => {
        finishRefresh = resolve;
      });
      const fetchMock = vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/api/auth/refresh')) {
          requests.push('refresh-start');
          await refreshGate;
          requests.push('refresh-finish');
          return new Response(JSON.stringify({
            user: { id: 'slow-refresh-user' },
            accessToken: makeJwt('slow-refresh-user', { sid: 'slow-session' }),
            sessionTransport: 'cookie',
            sessionId: 'slow-session',
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.endsWith('/api/auth/signout')) {
          requests.push('signout');
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);
      const refreshingClient = createClient('https://api.example.com', {
        authNamespace: 'slow-signout',
        refreshTokenTransport: 'httpOnlyCookie',
      });
      const signOutClient = createClient('https://api.example.com', {
        authNamespace: 'slow-signout',
        refreshTokenTransport: 'httpOnlyCookie',
      });
      const refreshingManager = (
        refreshingClient as unknown as { tokenManager: TokenManager }
      ).tokenManager;
      refreshingManager.setTokens({
        accessToken: makeJwt('slow-refresh-user', { exp: 1 }),
        refreshToken: '',
      });

      const refresh = refreshingClient.auth.refreshSession();
      const refreshOutcome = refresh.then(
        () => null,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(20);
      expect(requests).toEqual(['refresh-start']);
      const signOut = signOutClient.auth.signOut();

      await vi.advanceTimersByTimeAsync(12_000);
      expect(requests).toEqual(['refresh-start']);
      expect(store.has('edgebase:slow-signout:pending-signout')).toBe(true);

      finishRefresh();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(100);
      await expect(refreshOutcome).resolves.toMatchObject({
        code: 401,
        slug: 'auth-state-changed',
      });
      await signOut;

      expect(requests).toEqual(['refresh-start', 'refresh-finish', 'signout']);
      expect(refreshingClient.auth.currentUser).toBeNull();
      expect(signOutClient.auth.currentUser).toBeNull();
      expect(store.has('edgebase:slow-signout:cookie-session')).toBe(false);
      expect(store.has('edgebase:slow-signout:pending-signout')).toBe(false);
      refreshingClient.destroy();
      signOutClient.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a hung cookie refresh and lets sign-out revoke without leaking the lock', async () => {
    vi.useFakeTimers();
    try {
      const { store } = installBrowserMocks();
      const requests: string[] = [];
      const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/auth/refresh')) {
          requests.push('refresh-start');
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              requests.push('refresh-abort');
              reject(new DOMException('Aborted', 'AbortError'));
            }, { once: true });
          });
        }
        if (url.endsWith('/api/auth/signout')) {
          requests.push('signout');
          return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }));
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient('https://api.example.com', {
        authNamespace: 'hung-refresh',
        refreshTokenTransport: 'httpOnlyCookie',
      });
      const manager = (client as unknown as { tokenManager: TokenManager }).tokenManager;
      manager.setTokens({
        accessToken: makeJwt('hung-refresh-user', { exp: 1 }),
        refreshToken: '',
      });

      const refreshOutcome = client.auth.refreshSession().then(
        () => null,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(20);
      expect(requests).toEqual(['refresh-start']);
      const signOut = client.auth.signOut();

      await vi.advanceTimersByTimeAsync(14_900);
      expect(requests).toEqual(['refresh-start']);
      await vi.advanceTimersByTimeAsync(101);
      await expect(refreshOutcome).resolves.toMatchObject({ code: 0 });
      await signOut;

      expect(requests).toEqual(['refresh-start', 'refresh-abort', 'signout']);
      expect(store.has('edgebase:hung-refresh:refresh-lock')).toBe(false);
      expect(store.has('edgebase:hung-refresh:pending-signout')).toBe(false);
      expect(client.auth.currentUser).toBeNull();
      client.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the sign-out tombstone until a deadline-bypassing custom refresh is revoked again', async () => {
    vi.useFakeTimers();
    try {
      const { store } = installBrowserMocks();
      let finishRefresh!: (pair: { accessToken: string; refreshToken: string }) => void;
      const refreshGate = new Promise<{ accessToken: string; refreshToken: string }>((resolve) => {
        finishRefresh = resolve;
      });
      const requests: string[] = [];
      const fetchMock = vi.fn(async (input: string | URL) => {
        if (!String(input).endsWith('/api/auth/signout')) {
          throw new Error(`Unexpected request: ${String(input)}`);
        }
        requests.push('signout');
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', fetchMock);
      const client = createClient('https://api.example.com', {
        authNamespace: 'deadline-refresh',
        refreshTokenTransport: 'httpOnlyCookie',
      });
      const manager = (client as unknown as { tokenManager: TokenManager }).tokenManager;
      manager.setTokens({
        accessToken: makeJwt('deadline-user', { exp: 1 }),
        refreshToken: '',
      });

      const refreshOutcome = manager.forceRefresh(() => refreshGate).then(
        () => null,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(20);
      const signOut = client.auth.signOut();
      await vi.advanceTimersByTimeAsync(20_001);
      await signOut;

      expect(requests).toEqual(['signout']);
      expect(store.has('edgebase:deadline-refresh:pending-signout')).toBe(true);

      finishRefresh({
        accessToken: makeJwt('deadline-user', { sid: 'late-session' }),
        refreshToken: '',
      });
      await expect(refreshOutcome).resolves.toMatchObject({ code: 401, slug: 'auth-state-changed' });
      await vi.advanceTimersByTimeAsync(251);

      expect(requests).toEqual(['signout', 'signout']);
      expect(store.has('edgebase:deadline-refresh:pending-signout')).toBe(false);
      expect(client.auth.currentUser).toBeNull();
      client.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('cookie refresh helper', () => {
  it('uses credentials and no refresh-token body for room/database-live recovery', async () => {
    installBrowserMocks();
    const accessToken = makeJwt('realtime-user');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      accessToken,
      sessionTransport: 'cookie',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshAccessToken(
      'https://api.example.com',
      '',
      'httpOnlyCookie',
    )).resolves.toEqual({ accessToken, refreshToken: '' });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe('include');
    expect(init.body).toBe('{}');
    expect(new Headers(init.headers).get('X-EdgeBase-Auth-Transport')).toBe('cookie');
  });

  it('aborts a hung raw cookie refresh at the session timeout', async () => {
    vi.useFakeTimers();
    try {
      let requestSignal: AbortSignal | null = null;
      const fetchMock = vi.fn((_input: string | URL, init?: RequestInit) => {
        requestSignal = init?.signal ?? null;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      });
      vi.stubGlobal('fetch', fetchMock);
      const refresh = refreshAccessToken(
        'https://api.example.com',
        '',
        'httpOnlyCookie',
      ).then(
        () => null,
        (error: unknown) => error,
      );

      await vi.advanceTimersByTimeAsync(14_999);
      expect(requestSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(refresh).resolves.toMatchObject({ code: 0 });
      expect(requestSignal?.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
