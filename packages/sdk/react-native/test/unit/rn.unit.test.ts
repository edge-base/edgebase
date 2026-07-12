/**
 * @edge-base/react-native — 단위 테스트
 *
 * 테스트 대상:
 *   - src/token-manager.ts (RN TokenManager)
 *   - src/client.ts (ClientEdgeBase, createClient)
 *   - src/auth.ts (AuthClient)
 *   - src/database-live.ts (DatabaseLiveClient)
 *   - src/room.ts (RoomClient)
 *   - src/push.ts (PushClient)
 *   - src/lifecycle.ts (LifecycleManager)
 *   - src/match-filter.ts (matchesFilter)
 *   - @edge-base/core: TableRef, OrBuilder, StorageBucket, EdgeBaseError, FieldOps
 *
 * 실행: cd packages/sdk/react-native && npx vitest run
 *
 * 원칙: 서버 불필요 — AsyncStorage mock + 순수 로직 검증
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenManager } from '../../src/token-manager';
import type { AsyncStorageAdapter } from '../../src/token-manager';
import { AuthClient } from '../../src/auth';
import { DatabaseLiveClient } from '../../src/database-live';
import { RoomClient } from '../../src/room';
import { PushClient } from '../../src/push';
import { LifecycleManager } from '../../src/lifecycle';
import { matchesFilter } from '../../src/match-filter';
import { EdgeBaseError, increment, deleteField, OrBuilder } from '@edge-base/core';
import { createClient, ClientEdgeBase } from '../../src/client';
import { _turnstileTest } from '../../src/turnstile';
import * as api from '../../src/index';

const OAUTH_REDIRECT_URL = 'https://app.example.com/auth/callback';
const TEST_AUTH_PREFIX = `edgebase:${encodeURIComponent('http://localhost:8688')}`;
const TEST_REFRESH_TOKEN_KEY = `${TEST_AUTH_PREFIX}:refresh-token`;
const TEST_PENDING_OAUTH_KEY = `${TEST_AUTH_PREFIX}:oauth-pending-recoveries`;
const TEST_PENDING_OAUTH_COMPLETIONS_KEY = `${TEST_AUTH_PREFIX}:oauth-pending-completions`;
const TEST_AUTH_EPOCH_KEY = `${TEST_AUTH_PREFIX}:auth-epoch`;
const TEST_PENDING_SIGNOUT_KEY = `${TEST_AUTH_PREFIX}:pending-signout`;

// ─── In-memory AsyncStorage mock ─────────────────────────────────────────────

function createMockStorage(): AsyncStorageAdapter & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => { store.set(key, value); },
    removeItem: async (key) => { store.delete(key); },
  };
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

function makeValidJwt(userId = 'u-rn-1', extra: Record<string, unknown> = {}) {
  return makeJwt({
    sub: userId,
    email: 'rn@test.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...extra,
  });
}

function makeExpiredJwt(userId = 'u-expired') {
  return makeJwt({
    sub: userId,
    email: 'expired@test.com',
    exp: Math.floor(Date.now() / 1000) - 3600,
  });
}

describe('RN hosted Turnstile challenge', () => {
  it('binds createClient secureRandom and hook WebView options to the mounted challenge on Hermes', async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', undefined);
    try {
      const secureRandom = vi.fn(async (length: number) => new Uint8Array(length).fill(0x5a));
      const client = createClient('https://captcha-client.example.com', {
        storage: createMockStorage(),
        secureStorage: createMockStorage(),
        secureRandom,
      });
      const WebViewComponent = (() => null) as any;
      const hookOptions = client.turnstileOptions({
        action: 'signin',
        WebViewComponent,
      });
      expect(hookOptions).toMatchObject({
        baseUrl: 'https://captcha-client.example.com',
        action: 'signin',
        WebViewComponent,
        secureRandom,
      });

      const channel = await _turnstileTest.resolveChallengeChannel(
        hookOptions.getRandomValues,
        hookOptions.secureCrypto,
        hookOptions.secureRandom,
      );
      expect(channel).toBe('5a'.repeat(32));
      const mounted = _turnstileTest.createTurnstileWebViewElement({
        baseUrl: hookOptions.baseUrl,
        action: hookOptions.action,
        WebViewComponent,
        challengeChannel: channel,
        onToken: vi.fn(),
      });
      expect(mounted.props).toMatchObject({
        baseUrl: 'https://captcha-client.example.com',
        action: 'signin',
        WebViewComponent,
        challengeChannel: '5a'.repeat(32),
      });
      expect(secureRandom).toHaveBeenCalledWith(32);
      client.destroy();
    } finally {
      vi.stubGlobal('crypto', originalCrypto);
    }
  });

  it('does not permanently negative-cache transient config HTTP failures or timeouts', async () => {
    const httpOrigin = 'https://captcha-transient-http.example.com';
    const timeoutOrigin = 'https://captcha-transient-timeout.example.com';
    _turnstileTest.resetSiteKeyCache();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ captcha: { siteKey: 'recovered-http-key' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ captcha: { siteKey: 'recovered-timeout-key' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(_turnstileTest.fetchSiteKey(httpOrigin)).rejects.toMatchObject({
      name: 'TurnstileError',
      reason: 'config_fetch_failed',
    });
    await expect(_turnstileTest.fetchSiteKey(httpOrigin)).resolves.toBe('recovered-http-key');
    await expect(_turnstileTest.fetchSiteKey(timeoutOrigin)).rejects.toMatchObject({
      name: 'TurnstileError',
      reason: 'config_fetch_failed',
    });
    await expect(_turnstileTest.fetchSiteKey(timeoutOrigin)).resolves.toBe('recovered-timeout-key');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('rejects malformed or invalid CAPTCHA config without caching it', async () => {
    const origin = 'https://captcha-invalid-config.example.com';
    _turnstileTest.resetSiteKeyCache(origin);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ captcha: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        captcha: { siteKey: 42 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        captcha: { siteKey: 'invalid site key!' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        captcha: { siteKey: 'recovered-valid-key' },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(_turnstileTest.fetchSiteKey(origin)).rejects.toMatchObject({
        name: 'TurnstileError',
        reason: 'config_invalid_response',
      });
    }
    await expect(_turnstileTest.fetchSiteKey(origin)).resolves.toBe('recovered-valid-key');
    await expect(_turnstileTest.fetchSiteKey(origin)).resolves.toBe('recovered-valid-key');
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('treats explicit captcha null as disabled without caching it', async () => {
    const origin = 'https://captcha-disabled.example.com';
    _turnstileTest.resetSiteKeyCache(origin);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ captcha: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        captcha: { siteKey: 'enabled-after-null' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(_turnstileTest.fetchSiteKey(origin)).resolves.toBeNull();
    await expect(_turnstileTest.fetchSiteKey(origin)).resolves.toBe('enabled-after-null');
    await expect(_turnstileTest.fetchSiteKey(origin)).resolves.toBe('enabled-after-null');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes a positive site key after the bounded rotation cache TTL', async () => {
    const origin = 'https://captcha-rotation.example.com';
    _turnstileTest.resetSiteKeyCache(origin);
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        captcha: { siteKey: 'site-key-before-rotation' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        captcha: { siteKey: 'site-key-after-rotation' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(_turnstileTest.fetchSiteKey(origin)).resolves.toBe('site-key-before-rotation');
    now += 5 * 60 * 1000 - 1;
    await expect(_turnstileTest.fetchSiteKey(origin)).resolves.toBe('site-key-before-rotation');
    now += 2;
    await expect(_turnstileTest.fetchSiteKey(origin)).resolves.toBe('site-key-after-rotation');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('builds the channel-bound JSON-v1 bridge URL on the exact HTTPS backend origin', () => {
    const channel = 'ab'.repeat(32);
    const result = _turnstileTest.buildChallengeUrl(
      'https://api.example.com/',
      'oauth',
      'interaction-only',
      'normal',
      channel,
    );
    const url = new URL(result.url);

    expect(result.origin).toBe('https://api.example.com');
    expect(url.pathname).toBe('/api/captcha/challenge');
    expect(url.searchParams.get('action')).toBe('oauth');
    expect(url.searchParams.get('channel')).toBe(channel);
    expect(url.searchParams.get('bridge')).toBe('rn');
    expect(url.searchParams.get('appearance')).toBe('interaction-only');
    expect(url.searchParams.get('size')).toBe('normal');
  });

  it('rejects custom schemes and public HTTP while retaining loopback development', () => {
    expect(() => _turnstileTest.normalizeCaptchaOrigin('myapp://captcha'))
      .toThrow('requires HTTPS');
    expect(() => _turnstileTest.normalizeCaptchaOrigin('http://api.example.com'))
      .toThrow('requires HTTPS');
    expect(_turnstileTest.normalizeCaptchaOrigin('http://127.0.0.1:8787/'))
      .toBe('http://127.0.0.1:8787');
  });

  it('fails closed when a secure channel cannot be generated', () => {
    vi.stubGlobal('crypto', undefined);
    try {
      expect(() => _turnstileTest.generateChallengeChannel())
        .toThrow('Secure random generation is required');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('accepts explicit secure providers, validates their output, and gives direct injection precedence', () => {
    const secureCrypto = {
      getRandomValues: vi.fn((bytes: Uint8Array) => {
        bytes.fill(0x11);
        return bytes;
      }),
    };
    const injected = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0x22);
      return bytes;
    });

    expect(_turnstileTest.generateChallengeChannel(undefined, secureCrypto)).toBe('11'.repeat(32));
    expect(_turnstileTest.generateChallengeChannel(injected, secureCrypto)).toBe('22'.repeat(32));
    expect(injected).toHaveBeenCalledTimes(1);
    expect(secureCrypto.getRandomValues).toHaveBeenCalledTimes(1);
    expect(() => _turnstileTest.generateChallengeChannel(() => new Uint8Array(31)))
      .toThrow('invalid Turnstile channel');
  });

  it('parses only bounded JSON-v1 messages for the exact channel and URI fallback', () => {
    const channel = 'cd'.repeat(32);
    const tokenMessage = JSON.stringify({ v: 1, channel, type: 'token', value: 'captcha-token' });
    expect(_turnstileTest.parseChallengeMessage(tokenMessage, channel)).toEqual({
      type: 'token',
      value: 'captcha-token',
    });
    expect(_turnstileTest.parseChallengeMessage(JSON.stringify(tokenMessage), channel)).toEqual({
      type: 'token',
      value: 'captcha-token',
    });
    expect(_turnstileTest.parseChallengeMessageUrl(
      `edgebase://message/${encodeURIComponent(tokenMessage)}`,
      channel,
    )).toEqual({ type: 'token', value: 'captcha-token' });
    expect(_turnstileTest.parseChallengeMessage(
      JSON.stringify({ v: 1, channel: 'ef'.repeat(32), type: 'token', value: 'captcha-token' }),
      channel,
    )).toBeNull();
    expect(_turnstileTest.parseChallengeMessage(
      JSON.stringify({ v: 1, channel, type: 'ready', value: 'not-ready' }),
      channel,
    )).toBeNull();
    expect(_turnstileTest.parseChallengeMessage(
      JSON.stringify({ v: 1, channel, type: 'interactive', value: 'open-url' }),
      channel,
    )).toBeNull();
    expect(_turnstileTest.parseChallengeMessage(`"${'한'.repeat(1400)}"`, channel)).toBeNull();
  });

  it('allows only the exact top-level challenge and Cloudflare descendant frames', () => {
    const challenge = _turnstileTest.buildChallengeUrl(
      'https://api.example.com',
      'signin',
      'interaction-only',
      'normal',
      'ab'.repeat(32),
    );
    expect(_turnstileTest.shouldAllowChallengeNavigation({
      url: challenge.url,
      isTopFrame: true,
    }, challenge)).toBe(true);
    expect(_turnstileTest.shouldAllowChallengeNavigation({
      url: challenge.url,
      isTopFrame: false,
    }, challenge)).toBe(false);
    expect(_turnstileTest.shouldAllowChallengeNavigation({
      url: 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/frame',
      isTopFrame: false,
      mainDocumentURL: challenge.url,
    }, challenge)).toBe(true);
    expect(_turnstileTest.shouldAllowChallengeNavigation({
      url: 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/frame',
      isTopFrame: true,
      mainDocumentURL: challenge.url,
    }, challenge)).toBe(false);
    expect(_turnstileTest.shouldAllowChallengeNavigation({
      url: 'https://evil.example/challenge',
      isTopFrame: false,
      mainDocumentURL: challenge.url,
    }, challenge)).toBe(false);
  });

  it('builds hardened WebView props and remounts when the channel changes', () => {
    const first = _turnstileTest.buildChallengeUrl(
      'https://api.example.com',
      'signup',
      'interaction-only',
      'normal',
      '01'.repeat(32),
    );
    const firstProps = _turnstileTest.baseWebViewProps(first, '01'.repeat(32));
    const secondProps = _turnstileTest.baseWebViewProps(first, '02'.repeat(32));

    expect(firstProps).toMatchObject({
      source: { uri: first.url },
      javaScriptEnabled: true,
      domStorageEnabled: true,
      sharedCookiesEnabled: true,
      thirdPartyCookiesEnabled: true,
      scrollEnabled: false,
    });
    expect(firstProps.originWhitelist).toEqual([
      'https://api.example.com',
      'https://challenges.cloudflare.com',
      'edgebase://message/*',
    ]);
    expect(firstProps.key).not.toBe(secondProps.key);
  });

  it('accepts one terminal event per channel and ignores a stale WebView generation', () => {
    const channel = '12'.repeat(32);
    const state = { channel, done: false };
    expect(_turnstileTest.dispatchChallengeMessage(state, channel, {
      type: 'interactive',
      value: 'show',
    })).toEqual({ type: 'interactive', value: 'show' });
    expect(_turnstileTest.dispatchChallengeMessage(state, channel, {
      type: 'token',
      value: 'first-token',
    })).toEqual({ type: 'token', value: 'first-token' });
    expect(_turnstileTest.dispatchChallengeMessage(state, channel, {
      type: 'error',
      value: 'late-error',
    })).toBeNull();

    const resetState = { channel: '34'.repeat(32), done: false };
    expect(_turnstileTest.dispatchChallengeMessage(resetState, channel, {
      type: 'token',
      value: 'stale-token',
    })).toBeNull();
    expect(_turnstileTest.dispatchChallengeMessage(resetState, resetState.channel, {
      type: 'error',
      value: 'page_load_failed',
    })).toEqual({ type: 'error', value: 'page_load_failed' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PART A — TokenManager (기존 22 + 추가)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── A. 초기 상태 ──────────────────────────────────────────────────────────────

describe('RN TokenManager — 초기 상태', () => {
  it('초기 getCurrentUser() === null', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    expect(tm.getCurrentUser()).toBeNull();
    tm.destroy();
  });

  it('초기 getRefreshToken() === null', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    expect(await tm.getRefreshToken()).toBeNull();
    tm.destroy();
  });

  it('onAuthStateChange → 즉시 null 호출', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const calls: unknown[] = [];
    const unsub = tm.onAuthStateChange(user => calls.push(user));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeNull();
    unsub();
    tm.destroy();
  });
});

// ─── B. setTokens ─────────────────────────────────────────────────────────────

describe('RN TokenManager — setTokens', () => {
  it('setTokens → getCurrentUser().id 반영', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('user-rn-42');
    await tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.id).toBe('user-rn-42');
    tm.destroy();
  });

  it('setTokens → getRefreshToken() 반영', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-rn-2');
    const rt = makeValidJwt('u-rn-2');
    await tm.setTokens({ accessToken: at, refreshToken: rt });
    // getRefreshToken is async (reads from AsyncStorage)
    const stored = await tm.getRefreshToken();
    expect(stored).toBe(rt);
    tm.destroy();
  });

  it('setTokens → onAuthStateChange 호출', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const calls: unknown[] = [];
    const unsub = tm.onAuthStateChange(user => calls.push(user));
    // initial call = 1
    const at = makeValidJwt('u-rn-3');
    await tm.setTokens({ accessToken: at, refreshToken: at });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect((calls[calls.length - 1] as { id: string })?.id).toBe('u-rn-3');
    unsub();
    tm.destroy();
  });

  it('setTokens email 반영', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-rn-email', { email: 'rn-specific@test.com' });
    await tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.email).toBe('rn-specific@test.com');
    tm.destroy();
  });

  it('setTokens displayName 반영', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-rn-display', { displayName: 'TestUser' });
    await tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.displayName).toBe('TestUser');
    tm.destroy();
  });

  it('setTokens 한글 displayName 반영', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-rn-ko', { displayName: '준규' });
    await tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.displayName).toBe('준규');
    tm.destroy();
  });

  it('setTokens role 반영', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-rn-role', { role: 'admin' });
    await tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.role).toBe('admin');
    tm.destroy();
  });

  it('setTokens isAnonymous 반영', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-rn-anon', { isAnonymous: true });
    await tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.isAnonymous).toBe(true);
    tm.destroy();
  });

  it('setTokens overwrites previous user', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    await tm.setTokens({ accessToken: makeValidJwt('user-A'), refreshToken: makeValidJwt('user-A') });
    expect(tm.getCurrentUser()?.id).toBe('user-A');
    await tm.setTokens({ accessToken: makeValidJwt('user-B'), refreshToken: makeValidJwt('user-B') });
    expect(tm.getCurrentUser()?.id).toBe('user-B');
    tm.destroy();
  });

  it('setTokens keeps memory and listeners signed out until secure persistence succeeds', async () => {
    const storage = createMockStorage();
    let releaseRefreshWrite!: () => void;
    const refreshWrite = new Promise<void>((resolve) => { releaseRefreshWrite = resolve; });
    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = vi.fn(async (key: string, value: string) => {
      if (key === TEST_REFRESH_TOKEN_KEY) await refreshWrite;
      await originalSetItem(key, value);
    });
    const tm = new TokenManager('http://localhost:8688', storage);
    await tm.ready();
    const observed: Array<string | null> = [];
    tm.onAuthStateChange((user) => observed.push(user?.id ?? null));
    const accessToken = makeValidJwt('persist-first-user');

    const pending = tm.setTokens({ accessToken, refreshToken: accessToken });
    await vi.waitFor(() => {
      expect(storage.setItem).toHaveBeenCalledWith(TEST_REFRESH_TOKEN_KEY, accessToken);
    });
    expect(tm.getCurrentUser()).toBeNull();
    expect(tm.getRefreshToken()).toBeNull();
    expect(observed).toEqual([null]);

    releaseRefreshWrite();
    await pending;
    expect(tm.getCurrentUser()?.id).toBe('persist-first-user');
    expect(tm.getRefreshToken()).toBe(accessToken);
    expect(observed).toEqual([null, 'persist-first-user']);
    tm.destroy();
  });

  it('setTokens rejects atomically when persistence fails after a partial write', async () => {
    const storage = createMockStorage();
    const originalSetItem = storage.setItem.bind(storage);
    let failRefreshWrite = true;
    storage.setItem = vi.fn(async (key: string, value: string) => {
      await originalSetItem(key, value);
      if (key === TEST_REFRESH_TOKEN_KEY && failRefreshWrite) {
        failRefreshWrite = false;
        throw new Error('synthetic secure storage failure after write');
      }
    });
    const tm = new TokenManager('http://localhost:8688', storage);
    await tm.ready();
    const observed: Array<string | null> = [];
    tm.onAuthStateChange((user) => observed.push(user?.id ?? null));
    const accessToken = makeValidJwt('must-not-be-exposed');

    await expect(tm.setTokens({ accessToken, refreshToken: accessToken })).rejects.toMatchObject({
      slug: 'auth-token-persistence-failed',
    });
    expect(tm.getCurrentUser()).toBeNull();
    expect(tm.getRefreshToken()).toBeNull();
    expect(observed.every((user) => user === null)).toBe(true);
    expect(storage.store.has(TEST_REFRESH_TOKEN_KEY)).toBe(false);
    expect(storage.store.has(TEST_PENDING_SIGNOUT_KEY)).toBe(true);

    const restored = new TokenManager('http://localhost:8688', storage);
    await restored.ready();
    expect(restored.getCurrentUser()).toBeNull();
    restored.destroy();
    tm.destroy();
  });

  it('setTokens advances durable auth authority and invalidates older OAuth work', async () => {
    const storage = createMockStorage();
    const tm = new TokenManager('http://localhost:8688', storage);
    await tm.ready();
    const pendingNonce = await tm.markPendingOAuthRecovery(OAUTH_REDIRECT_URL);
    const oldEpoch = await tm.captureAuthEpoch();
    const accessToken = makeValidJwt('authoritative-set-tokens');

    await tm.setTokens({ accessToken, refreshToken: accessToken });

    expect(Number(storage.store.get(TEST_AUTH_EPOCH_KEY))).toBeGreaterThan(oldEpoch);
    expect(await tm.consumePendingOAuthRecovery(
      pendingNonce,
      oldEpoch,
      OAUTH_REDIRECT_URL,
    )).toBe(false);
    tm.destroy();
  });
});

// ─── C. clearTokens ──────────────────────────────────────────────────────────

describe('RN TokenManager — clearTokens', () => {
  it('clearTokens → getCurrentUser() === null', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-clr');
    await tm.setTokens({ accessToken: at, refreshToken: at });
    tm.clearTokens();
    expect(tm.getCurrentUser()).toBeNull();
    tm.destroy();
  });

  it('clearTokens → 스토리지 refreshToken 삭제', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-clr2');
    await tm.setTokens({ accessToken: at, refreshToken: at });
    tm.clearTokens();
    // async removal
    await new Promise(r => setTimeout(r, 10));
    const stored = await tm.getRefreshToken();
    expect(stored).toBeNull();
    tm.destroy();
  });

  it('clearTokens → onAuthStateChange(null)', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const calls: unknown[] = [];
    const at = makeValidJwt('u-clr3');
    await tm.setTokens({ accessToken: at, refreshToken: at });
    const unsub = tm.onAuthStateChange(user => calls.push(user));
    tm.clearTokens();
    expect(calls[calls.length - 1]).toBeNull();
    unsub();
    tm.destroy();
  });

  it('clearTokens 호출 후 다시 setTokens 가능', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    await tm.setTokens({ accessToken: makeValidJwt('u-first'), refreshToken: makeValidJwt('u-first') });
    tm.clearTokens();
    expect(tm.getCurrentUser()).toBeNull();
    await tm.setTokens({ accessToken: makeValidJwt('u-second'), refreshToken: makeValidJwt('u-second') });
    expect(tm.getCurrentUser()?.id).toBe('u-second');
    tm.destroy();
  });

  it('다른 RN client가 올린 persisted auth epoch도 오래된 OAuth flow를 무효화', async () => {
    const storage = createMockStorage();
    const first = new TokenManager('http://localhost:8688', storage);
    const second = new TokenManager('http://localhost:8688', storage);
    await Promise.all([first.ready(), second.ready()]);
    const nonce = await second.markPendingOAuthRecovery();

    await first.clearTokens();
    const callbackEpoch = await second.captureAuthEpoch();

    expect(callbackEpoch).toBe(1);
    expect(await second.consumePendingOAuthRecovery(nonce, callbackEpoch)).toBe(false);
    expect(storage.store.has(TEST_PENDING_OAUTH_KEY)).toBe(false);
    first.destroy();
    second.destroy();
  });

  it('serializes concurrent OAuth registry mutations across TokenManager peers', async () => {
    const storage = createMockStorage();
    const first = new TokenManager('http://localhost:8688', storage);
    const second = new TokenManager('http://localhost:8688', storage);
    await Promise.all([first.ready(), second.ready()]);

    const [firstNonce, secondNonce] = await Promise.all([
      first.markPendingOAuthRecovery(OAUTH_REDIRECT_URL),
      second.markPendingOAuthRecovery(OAUTH_REDIRECT_URL),
    ]);
    const entries = JSON.parse(storage.store.get(TEST_PENDING_OAUTH_KEY)!) as {
      entries: Array<{ nonce: string }>;
    };
    expect(entries.entries.map((entry) => entry.nonce).sort()).toEqual(
      [firstNonce, secondNonce].sort(),
    );

    const epoch = await first.captureAuthEpoch();
    const accepted = await Promise.all([
      first.consumePendingOAuthRecovery(firstNonce, epoch, OAUTH_REDIRECT_URL),
      second.consumePendingOAuthRecovery(firstNonce, epoch, OAUTH_REDIRECT_URL),
    ]);
    expect(accepted.sort()).toEqual([false, true]);
    first.destroy();
    second.destroy();
  });

  it('isolates durable credentials by base URL and never imports the unbound legacy key', async () => {
    const storage = createMockStorage();
    storage.store.set('edgebase:refresh-token', makeValidJwt('legacy-user'));
    const first = new TokenManager('https://one.example.com', storage);
    const second = new TokenManager('https://two.example.com', storage);
    await Promise.all([first.ready(), second.ready()]);
    expect(first.getCurrentUser()).toBeNull();
    expect(second.getCurrentUser()).toBeNull();

    await first.setTokensPersisted({
      accessToken: makeValidJwt('one-user'),
      refreshToken: makeValidJwt('one-user'),
    });
    await second.setTokensPersisted({
      accessToken: makeValidJwt('two-user'),
      refreshToken: makeValidJwt('two-user'),
    });
    const restoredFirst = new TokenManager('https://one.example.com', storage);
    const restoredSecond = new TokenManager('https://two.example.com', storage);
    await Promise.all([restoredFirst.ready(), restoredSecond.ready()]);
    expect(restoredFirst.getCurrentUser()?.id).toBe('one-user');
    expect(restoredSecond.getCurrentUser()?.id).toBe('two-user');
    first.destroy();
    second.destroy();
    restoredFirst.destroy();
    restoredSecond.destroy();
  });
});

// ─── D. onAuthStateChange unsubscribe ────────────────────────────────────────

describe('RN TokenManager — unsubscribe', () => {
  it('unsub 후 더 이상 호출 안 됨', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    let count = 0;
    const unsub = tm.onAuthStateChange(() => count++);
    const before = count;
    unsub();
    await tm.setTokens({ accessToken: makeValidJwt('u-unsub'), refreshToken: makeValidJwt('u-unsub') });
    expect(count).toBe(before);
    tm.destroy();
  });

  it('여러 리스너 등록 가능', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    let c1 = 0, c2 = 0;
    const u1 = tm.onAuthStateChange(() => c1++);
    const u2 = tm.onAuthStateChange(() => c2++);
    expect(c1).toBeGreaterThanOrEqual(1);
    expect(c2).toBeGreaterThanOrEqual(1);
    u1(); u2();
    tm.destroy();
  });

  it('하나의 리스너를 해제해도 다른 리스너는 동작', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    let c1 = 0, c2 = 0;
    const u1 = tm.onAuthStateChange(() => c1++);
    const u2 = tm.onAuthStateChange(() => c2++);
    u1(); // unsubscribe first
    const before2 = c2;
    await tm.setTokens({ accessToken: makeValidJwt('u-partial'), refreshToken: makeValidJwt('u-partial') });
    expect(c2).toBeGreaterThan(before2);
    u2();
    tm.destroy();
  });
});

// ─── E. destroy ──────────────────────────────────────────────────────────────

describe('RN TokenManager — destroy', () => {
  it('destroy() 에러 없음', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    expect(() => tm.destroy()).not.toThrow();
  });

  it('destroy() 여러번 호출 가능', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    expect(() => { tm.destroy(); tm.destroy(); }).not.toThrow();
  });

  it('destroy() 후 리스너 호출 안 됨', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    let count = 0;
    tm.onAuthStateChange(() => count++);
    const afterInit = count;
    tm.destroy();
    await tm.setTokens({ accessToken: makeValidJwt('u-post-destroy'), refreshToken: makeValidJwt('u-post-destroy') });
    expect(count).toBe(afterInit);
  });
});

// ─── F. ready() ──────────────────────────────────────────────────────────────

describe('RN TokenManager — ready()', () => {
  it('ready()는 Promise<void> 반환', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await expect(tm.ready()).resolves.toBeUndefined();
    tm.destroy();
  });

  it('기존 refresh token 있으면 ready 후 user 복원', async () => {
    const storage = createMockStorage();
    const at = makeValidJwt('u-restore');
    // Simulate already-stored refresh token
    await storage.setItem(TEST_REFRESH_TOKEN_KEY, at);
    const tm = new TokenManager('http://localhost:8688', storage);
    await tm.ready();
    // If JWT not expired, user should be restored
    const user = tm.getCurrentUser();
    expect(user?.id).toBe('u-restore');
    tm.destroy();
  });

  it('expired refresh token → ready 후 user null', async () => {
    const storage = createMockStorage();
    const expired = makeExpiredJwt('u-expired-restore');
    await storage.setItem(TEST_REFRESH_TOKEN_KEY, expired);
    const tm = new TokenManager('http://localhost:8688', storage);
    await tm.ready();
    expect(tm.getCurrentUser()).toBeNull();
    tm.destroy();
  });

  it('ready() 여러번 호출해도 동일', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    await tm.ready();
    expect(tm.getCurrentUser()).toBeNull();
    tm.destroy();
  });
});

// ─── G. getAccessToken ───────────────────────────────────────────────────────

describe('RN TokenManager — getAccessToken', () => {
  it('토큰 없으면 null 반환', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const token = await tm.getAccessToken(async () => { throw new Error('should not call'); });
    expect(token).toBeNull();
    tm.destroy();
  });

  it('유효한 accessToken → 바로 반환', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-valid-at');
    await tm.setTokens({ accessToken: at, refreshToken: at });
    const result = await tm.getAccessToken(async () => { throw new Error('should not call'); });
    expect(result).toBe(at);
    tm.destroy();
  });

  it('invalidateAccessToken은 refresh token을 유지한 채 access token만 제거한다', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-refresh');
    const rt = makeValidJwt('u-refresh', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });
    await tm.setTokens({ accessToken: at, refreshToken: rt });

    tm.invalidateAccessToken();

    expect(tm.currentAccessToken).toBeNull();
    expect(tm.getRefreshToken()).toBe(rt);
    expect(tm.getCurrentUser()?.id).toBe('u-refresh');
    tm.destroy();
  });

  it('invalidateAccessToken은 refresh token이 없으면 사용자 상태도 비운다', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    (tm as any).accessToken = makeValidJwt('u-access-only');
    (tm as any).cachedUser = { id: 'u-access-only' };

    tm.invalidateAccessToken();

    expect(tm.currentAccessToken).toBeNull();
    expect(tm.getCurrentUser()).toBeNull();
    tm.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PART B — AuthClient (단위 테스트)
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN AuthClient — 구조 검증', () => {

  function createMockHttpClient() {
    return {
      getBaseUrl: () => 'http://localhost:8688',
      postPublic: vi.fn().mockResolvedValue({
        user: { id: 'u-mock', email: 'mock@test.com' },
        accessToken: makeValidJwt('u-mock'),
        refreshToken: makeValidJwt('u-mock'),
      }),
      post: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockResolvedValue({ sessions: [] }),
      patch: vi.fn().mockResolvedValue({
        user: { id: 'u-mock', email: 'mock@test.com' },
        accessToken: makeValidJwt('u-mock'),
        refreshToken: makeValidJwt('u-mock'),
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    } as any;
  }

  /** Mock GeneratedDbApi — AuthClient uses core/corePublic for API calls */
  function createMockCore() {
    const jwt = makeValidJwt('u-mock');
    const authResult = { user: { id: 'u-mock', email: 'mock@test.com' }, accessToken: jwt, refreshToken: jwt };
    return {
      authSignup: vi.fn().mockResolvedValue(authResult),
      authSignin: vi.fn().mockResolvedValue(authResult),
      authRefresh: vi.fn().mockResolvedValue(authResult),
      authSignout: vi.fn().mockResolvedValue({}),
      authSigninAnonymous: vi.fn().mockResolvedValue(authResult),
      authSigninMagicLink: vi.fn().mockResolvedValue({}),
      authVerifyMagicLink: vi.fn().mockResolvedValue(authResult),
      authSigninPhone: vi.fn().mockResolvedValue({}),
      authVerifyPhone: vi.fn().mockResolvedValue(authResult),
      authLinkPhone: vi.fn().mockResolvedValue({}),
      authVerifyLinkPhone: vi.fn().mockResolvedValue({}),
      authLinkEmail: vi.fn().mockResolvedValue(authResult),
      authGetSessions: vi.fn().mockResolvedValue({ sessions: [] }),
      authDeleteSession: vi.fn().mockResolvedValue({}),
      authUpdateProfile: vi.fn().mockResolvedValue(authResult),
      authVerifyEmail: vi.fn().mockResolvedValue({}),
      authRequestPasswordReset: vi.fn().mockResolvedValue({}),
      authResetPassword: vi.fn().mockResolvedValue({}),
      authChangePassword: vi.fn().mockResolvedValue(authResult),
      authChangeEmail: vi.fn().mockResolvedValue({}),
      authVerifyEmailChange: vi.fn().mockResolvedValue({}),
      authMfaTotpEnroll: vi.fn().mockResolvedValue({}),
      authMfaTotpVerify: vi.fn().mockResolvedValue({}),
      authMfaVerify: vi.fn().mockResolvedValue({}),
      authMfaRecovery: vi.fn().mockResolvedValue({}),
      authMfaFactors: vi.fn().mockResolvedValue({ factors: [] }),
      authMfaTotpDelete: vi.fn().mockResolvedValue({}),
      authGetMe: vi.fn().mockResolvedValue({ user: { id: 'u-mock' } }),
      authSigninEmailOtp: vi.fn().mockResolvedValue({}),
      authVerifyEmailOtp: vi.fn().mockResolvedValue(authResult),
      oauthLinkStart: vi.fn().mockResolvedValue({
        redirectUrl: 'https://provider.example.com/authorize',
      }),
    } as any;
  }

  function createMockTokenManager() {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    return tm;
  }

  it('signUp은 함수', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore());
    expect(typeof auth.signUp).toBe('function');
    tm.destroy();
  });

  it('signIn은 함수', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore());
    expect(typeof auth.signIn).toBe('function');
    tm.destroy();
  });

  it('signOut은 함수', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore());
    expect(typeof auth.signOut).toBe('function');
    tm.destroy();
  });

  it('signInAnonymously은 함수', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore());
    expect(typeof auth.signInAnonymously).toBe('function');
    tm.destroy();
  });

  it('onAuthStateChange은 함수', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore());
    expect(typeof auth.onAuthStateChange).toBe('function');
    tm.destroy();
  });

  it('currentUser 초기값은 null', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore());
    expect(auth.currentUser).toBeNull();
    tm.destroy();
  });

  it('signUp → corePublic.authSignup 호출 + tokenManager.setTokens', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const corePublic = createMockCore();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), corePublic);
    await auth.signUp({ email: 'test@test.com', password: 'Pass1234!' });
    expect(corePublic.authSignup).toHaveBeenCalledWith(expect.objectContaining({
      email: 'test@test.com',
      password: 'Pass1234!',
    }));
    expect(tm.getCurrentUser()).not.toBeNull();
    tm.destroy();
  });

  it('does not expose a new auth session until its refresh token is durable', async () => {
    const store = new Map<string, string>();
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const storage: AsyncStorageAdapter = {
      getItem: async (key) => store.get(key) ?? null,
      setItem: async (key, value) => {
        if (key === TEST_REFRESH_TOKEN_KEY) await writeGate;
        store.set(key, value);
      },
      removeItem: async (key) => { store.delete(key); },
    };
    const tm = new TokenManager('http://localhost:8688', storage);
    await tm.ready();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore());
    const signIn = auth.signIn({ email: 'durable@test.com', password: 'Pass1234!' });
    await Promise.resolve();
    expect(auth.currentUser).toBeNull();
    releaseWrite();
    await expect(signIn).resolves.toMatchObject({ user: { id: 'u-mock' } });
    expect(auth.currentUser?.id).toBe('u-mock');
    tm.destroy();
  });

  it('does not let a delayed sign-in response supersede sign-out', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const core = createMockCore();
    const corePublic = createMockCore();
    let resolveSignIn!: (value: unknown) => void;
    corePublic.authSignin.mockImplementation(() => new Promise((resolve) => {
      resolveSignIn = resolve;
    }));
    const auth = new AuthClient(createMockHttpClient(), tm, core, corePublic);
    const signIn = auth.signIn({ email: 'late@test.com', password: 'Pass1234!' });
    await vi.waitFor(() => expect(corePublic.authSignin).toHaveBeenCalledTimes(1));
    await auth.signOut();
    resolveSignIn({
      user: { id: 'late-user' },
      accessToken: makeValidJwt('late-user'),
      refreshToken: makeValidJwt('late-user'),
    });
    await expect(signIn).rejects.toMatchObject({ slug: 'auth-state-changed' });
    expect(auth.currentUser).toBeNull();
    tm.destroy();
  });

  it('serializes sign-ins and lets the last-started request reach the server after the stale one', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const corePublic = createMockCore();
    const resolvers: Array<(value: unknown) => void> = [];
    corePublic.authSignin.mockImplementation(() => new Promise((resolve) => {
      resolvers.push(resolve);
    }));
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), corePublic);
    const first = auth.signIn({ email: 'first@test.com', password: 'Pass1234!' });
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));
    const second = auth.signIn({ email: 'second@test.com', password: 'Pass1234!' });
    expect(resolvers).toHaveLength(1);
    resolvers[0]({
      user: { id: 'first-user' },
      accessToken: makeValidJwt('first-user'),
      refreshToken: makeValidJwt('first-user'),
    });
    await expect(first).rejects.toMatchObject({ slug: 'auth-state-changed' });
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[1]({
      user: { id: 'second-user' },
      accessToken: makeValidJwt('second-user'),
      refreshToken: makeValidJwt('second-user'),
    });
    await expect(second).resolves.toMatchObject({ user: { id: 'second-user' } });
    expect(auth.currentUser?.id).toBe('second-user');
    tm.destroy();
  });

  it('fails closed when a rotated refresh token cannot be persisted', async () => {
    const store = new Map<string, string>();
    let failRefreshWrite = false;
    const storage: AsyncStorageAdapter = {
      getItem: async (key) => store.get(key) ?? null,
      setItem: async (key, value) => {
        if (key === TEST_REFRESH_TOKEN_KEY && failRefreshWrite) throw new Error('disk full');
        store.set(key, value);
      },
      removeItem: async (key) => { store.delete(key); },
    };
    const tm = new TokenManager('http://localhost:8688', storage);
    await tm.ready();
    await tm.setTokensPersisted({
      accessToken: makeValidJwt('old-user'),
      refreshToken: makeValidJwt('old-user'),
    });
    failRefreshWrite = true;
    const corePublic = createMockCore();
    corePublic.authRefresh.mockResolvedValue({
      user: { id: 'new-user' },
      accessToken: makeValidJwt('new-user'),
      refreshToken: makeValidJwt('new-user'),
    });
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), corePublic);
    await expect(auth.refreshSession()).rejects.toMatchObject({
      slug: 'auth-token-persistence-failed',
    });
    expect(auth.currentUser).toBeNull();
    tm.destroy();
  });

  it('surfaces durable sign-out failure after attempting server revocation and stays signed out on restart', async () => {
    const store = new Map<string, string>();
    let failTombstone = false;
    const storage: AsyncStorageAdapter = {
      getItem: async (key) => store.get(key) ?? null,
      setItem: async (key, value) => {
        if (key === TEST_PENDING_SIGNOUT_KEY && failTombstone) throw new Error('write failed');
        store.set(key, value);
      },
      removeItem: async (key) => { store.delete(key); },
    };
    const tm = new TokenManager('http://localhost:8688', storage);
    await tm.ready();
    await tm.setTokensPersisted({
      accessToken: makeValidJwt('signed-in-user'),
      refreshToken: makeValidJwt('signed-in-user'),
    });
    failTombstone = true;
    const core = createMockCore();
    const http = createMockHttpClient();
    const auth = new AuthClient(http, tm, core, createMockCore());
    await expect(auth.signOut()).rejects.toMatchObject({ slug: 'signout-persistence-failed' });
    await vi.waitFor(() => expect(http.postPublic).toHaveBeenCalledWith(
      '/api/auth/signout',
      { refreshToken: makeValidJwt('signed-in-user') },
    ));
    expect(auth.currentUser).toBeNull();

    failTombstone = false;
    const restored = new TokenManager('http://localhost:8688', storage);
    await restored.ready();
    expect(restored.getCurrentUser()).toBeNull();
    tm.destroy();
    restored.destroy();
  });

  it('signUp with data → data 포함', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const corePublic = createMockCore();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), corePublic);
    await auth.signUp({ email: 'test@test.com', password: 'Pass1234!', data: { displayName: 'Test' } });
    expect(corePublic.authSignup).toHaveBeenCalledWith(expect.objectContaining({
      data: { displayName: 'Test' },
    }));
    tm.destroy();
  });

  it('signUp with captchaToken → captchaToken 포함', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const corePublic = createMockCore();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), corePublic);
    await auth.signUp({ email: 'test@test.com', password: 'Pass1234!', captchaToken: 'tok-123' });
    expect(corePublic.authSignup).toHaveBeenCalledWith(expect.objectContaining({
      captchaToken: 'tok-123',
    }));
    tm.destroy();
  });

  it('signIn → corePublic.authSignin 호출 + tokenManager.setTokens', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const corePublic = createMockCore();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), corePublic);
    await auth.signIn({ email: 'test@test.com', password: 'Pass1234!' });
    expect(corePublic.authSignin).toHaveBeenCalledWith(expect.objectContaining({
      email: 'test@test.com',
      password: 'Pass1234!',
    }));
    expect(tm.getCurrentUser()).not.toBeNull();
    tm.destroy();
  });

  it('signOut → clearTokens', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const http = createMockHttpClient();
    const auth = new AuthClient(http, tm, createMockCore(), createMockCore());
    // sign in first
    await tm.setTokens({ accessToken: makeValidJwt('u-signout-test'), refreshToken: makeValidJwt('u-signout-test') });
    expect(tm.getCurrentUser()).not.toBeNull();
    await auth.signOut();
    expect(tm.getCurrentUser()).toBeNull();
    tm.destroy();
  });

  it('signInAnonymously → corePublic.authSigninAnonymous 호출', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const corePublic = createMockCore();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), corePublic);
    await auth.signInAnonymously();
    expect(corePublic.authSigninAnonymous).toHaveBeenCalled();
    tm.destroy();
  });

  it('signInAnonymously with captchaToken', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const corePublic = createMockCore();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), corePublic);
    await auth.signInAnonymously({ captchaToken: 'cap-456' });
    expect(corePublic.authSigninAnonymous).toHaveBeenCalledWith(expect.objectContaining({ captchaToken: 'cap-456' }));
    tm.destroy();
  });

  it('signInWithPhone with captchaToken → captchaToken 포함', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const corePublic = createMockCore();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), corePublic);
    await auth.signInWithPhone({ phone: '+821012345678', captchaToken: 'cap-789' });
    expect(corePublic.authSigninPhone).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+821012345678',
      captchaToken: 'cap-789',
    }));
    tm.destroy();
  });

  it('invalidates stale CAPTCHA config without replaying the caller-owned token', async () => {
    const origin = 'http://localhost:8688';
    _turnstileTest.resetSiteKeyCache(origin);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ captcha: { siteKey: 'old-site-key' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ captcha: { siteKey: 'new-site-key' } })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(_turnstileTest.fetchSiteKey(origin)).resolves.toBe('old-site-key');

    const rejected = new EdgeBaseError(
      403,
      'Captcha verification failed.',
      { captcha_required: true } as never,
    );
    const corePublic = createMockCore();
    corePublic.authSigninPhone.mockRejectedValueOnce(rejected);
    const tm = createMockTokenManager();
    await tm.ready();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), corePublic);

    await expect(auth.signInWithPhone({
      phone: '+821055501234',
      captchaToken: 'single-use-token',
    })).rejects.toBe(rejected);
    expect(corePublic.authSigninPhone).toHaveBeenCalledOnce();
    await expect(_turnstileTest.fetchSiteKey(origin)).resolves.toBe('new-site-key');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    tm.destroy();
    vi.unstubAllGlobals();
  });

  it('verifyLinkPhone adopts the replacement session returned for an anonymous upgrade', async () => {
    const storage = createMockStorage();
    const tm = new TokenManager('http://localhost:8688', storage);
    await tm.ready();
    const core = createMockCore();
    const upgraded = {
      user: { id: 'phone-upgraded-user', isAnonymous: false },
      accessToken: makeValidJwt('phone-upgraded-user', { isAnonymous: false }),
      refreshToken: makeValidJwt('phone-upgraded-user', { isAnonymous: false }),
    };
    core.authVerifyLinkPhone.mockResolvedValue(upgraded);
    const auth = new AuthClient(createMockHttpClient(), tm, core, createMockCore());

    await expect(auth.verifyLinkPhone({ phone: '+821012345678', code: '123456' }))
      .resolves.toMatchObject({ user: { id: 'phone-upgraded-user' } });
    expect(core.authVerifyLinkPhone).toHaveBeenCalledWith({ phone: '+821012345678', code: '123456' });
    expect(auth.currentUser?.id).toBe('phone-upgraded-user');
    expect(storage.store.get(TEST_REFRESH_TOKEN_KEY)).toBe(upgraded.refreshToken);
    tm.destroy();
  });

  it('verifyLinkPhone preserves backward-compatible void for a permanent account', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    await tm.setTokensPersisted({
      accessToken: makeValidJwt('permanent-phone-user'),
      refreshToken: makeValidJwt('permanent-phone-user'),
    });
    const core = createMockCore();
    core.authVerifyLinkPhone.mockResolvedValue({ ok: true });
    const auth = new AuthClient(createMockHttpClient(), tm, core, createMockCore());

    await expect(auth.verifyLinkPhone({ phone: '+821055555555', code: '654321' }))
      .resolves.toBeUndefined();
    expect(auth.currentUser?.id).toBe('permanent-phone-user');
    tm.destroy();
  });

  it('verifyLinkPhone adopts the exact replacement session recovered after response loss', async () => {
    const storage = createMockStorage();
    const tm = new TokenManager('http://localhost:8688', storage);
    await tm.ready();
    await tm.setTokensPersisted({
      accessToken: makeValidJwt('rn-anonymous-phone', { isAnonymous: true }),
      refreshToken: 'rn-anonymous-phone-refresh',
    });
    const core = createMockCore();
    const recovered = {
      user: { id: 'rn-phone-recovered', isAnonymous: false },
      accessToken: makeValidJwt('rn-phone-recovered', { isAnonymous: false }),
      refreshToken: 'rn-phone-recovered-refresh',
      sessionId: 'rn-phone-recovered-session',
    };
    core.authVerifyLinkPhone
      .mockRejectedValueOnce(new Error('response lost after commit'))
      .mockResolvedValueOnce(recovered);
    const auth = new AuthClient(createMockHttpClient(), tm, core, createMockCore());
    const input = { phone: '+821077777777', code: '888888' };

    await expect(auth.verifyLinkPhone(input)).rejects.toThrow('response lost after commit');
    await expect(auth.verifyLinkPhone(input)).resolves.toEqual(recovered);
    expect(core.authVerifyLinkPhone).toHaveBeenNthCalledWith(1, input);
    expect(core.authVerifyLinkPhone).toHaveBeenNthCalledWith(2, input);
    expect(auth.currentUser?.id).toBe('rn-phone-recovered');
    expect(storage.store.get(TEST_REFRESH_TOKEN_KEY)).toBe(recovered.refreshToken);
    tm.destroy();
  });

  it('onAuthStateChange → unsub 함수 반환', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore());
    const unsub = auth.onAuthStateChange(() => {});
    expect(typeof unsub).toBe('function');
    unsub();
    tm.destroy();
  });

  it('handleOAuthCallback → fragment nonce를 소비하고 one-shot ticket 결과만 저장', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const corePublic = createMockCore();
    const http = createMockHttpClient();
    const rotatedAccess = makeValidJwt('u-oauth');
    const rotatedRefresh = makeValidJwt('u-oauth');
    http.postPublic.mockResolvedValue({
      user: { id: 'u-oauth' },
      accessToken: rotatedAccess,
      refreshToken: rotatedRefresh,
    });
    const auth = new AuthClient(http, tm, createMockCore(), corePublic);
    const start = await auth.signInWithOAuth('google', { redirectUrl: OAUTH_REDIRECT_URL });
    const nonce = new URL(start.url).searchParams.get('oauth_recovery_nonce')!;
    const ticket = 'ab'.repeat(32);
    const url = `${OAUTH_REDIRECT_URL}#oauth_exchange_ticket=${ticket}&auth_transport=body&oauth_recovery_nonce=${nonce}`;
    const result = await auth.handleOAuthCallback(url);
    expect(result).not.toBeNull();
    expect(result!.user.id).toBe('u-oauth');
    expect(result!.accessToken).toBe(rotatedAccess);
    expect(tm.getRefreshToken()).toBe(rotatedRefresh);
    expect(http.postPublic).toHaveBeenCalledWith('/api/auth/oauth/exchange', {
      ticket,
      oauthRecoveryNonce: nonce,
    });
    tm.destroy();
  });

  it('retains a consumed completion ticket in memory and makes no request when secure storage fails', async () => {
    const store = new Map<string, string>();
    let failCompletionPersistence = false;
    const storage: AsyncStorageAdapter = {
      getItem: async (key) => store.get(key) ?? null,
      setItem: async (key, value) => {
        if (failCompletionPersistence && key === TEST_PENDING_OAUTH_COMPLETIONS_KEY) {
          throw new Error('secure storage full');
        }
        store.set(key, value);
      },
      removeItem: async (key) => { store.delete(key); },
    };
    const tm = new TokenManager('http://localhost:8688', storage);
    await tm.ready();
    const http = createMockHttpClient();
    http.postPublic.mockResolvedValue({
      user: { id: 'rn-ticket-retry' },
      accessToken: makeValidJwt('rn-ticket-retry'),
      refreshToken: makeValidJwt('rn-ticket-retry'),
    });
    const auth = new AuthClient(http, tm, createMockCore(), createMockCore());
    const start = await auth.signInWithOAuth('google', { redirectUrl: OAUTH_REDIRECT_URL });
    const nonce = new URL(start.url).searchParams.get('oauth_recovery_nonce')!;
    const ticket = '56'.repeat(32);
    failCompletionPersistence = true;

    await expect(auth.handleOAuthCallback(
      `${OAUTH_REDIRECT_URL}#oauth_exchange_ticket=${ticket}&oauth_recovery_nonce=${nonce}`,
    )).rejects.toMatchObject({ slug: 'oauth-completion-persist-failed' });
    expect(http.postPublic).not.toHaveBeenCalled();
    await expect(tm.getPendingOAuthCompletion()).resolves.toMatchObject({ ticket });

    failCompletionPersistence = false;
    await expect(auth.handleOAuthCallback()).resolves.toMatchObject({
      user: { id: 'rn-ticket-retry' },
    });
    expect(http.postPublic).toHaveBeenCalledTimes(1);
    await expect(tm.getPendingOAuthCompletion()).resolves.toBeNull();
    tm.destroy();
  });

  it('retries the same server completion result after refresh-token persistence recovers', async () => {
    const store = new Map<string, string>();
    let failRefreshPersistence = false;
    const storage: AsyncStorageAdapter = {
      getItem: async (key) => store.get(key) ?? null,
      setItem: async (key, value) => {
        if (failRefreshPersistence && key === TEST_REFRESH_TOKEN_KEY) throw new Error('keychain full');
        store.set(key, value);
      },
      removeItem: async (key) => { store.delete(key); },
    };
    const tm = new TokenManager('http://localhost:8688', storage);
    await tm.ready();
    const http = createMockHttpClient();
    const ticket = '67'.repeat(32);
    http.postPublic.mockResolvedValue({
      user: { id: 'rn-cached-completion' },
      accessToken: makeValidJwt('rn-cached-completion'),
      refreshToken: makeValidJwt('rn-cached-completion'),
    });
    const auth = new AuthClient(http, tm, createMockCore(), createMockCore());
    const start = await auth.signInWithOAuth('google', { redirectUrl: OAUTH_REDIRECT_URL });
    const nonce = new URL(start.url).searchParams.get('oauth_recovery_nonce')!;
    failRefreshPersistence = true;

    await expect(auth.handleOAuthCallback(
      `${OAUTH_REDIRECT_URL}#oauth_exchange_ticket=${ticket}&oauth_recovery_nonce=${nonce}`,
    )).rejects.toMatchObject({ slug: 'auth-token-persistence-failed' });
    expect(auth.currentUser).toBeNull();
    await expect(tm.getPendingOAuthCompletion()).resolves.toMatchObject({ ticket });

    failRefreshPersistence = false;
    await expect(auth.handleOAuthCallback()).resolves.toMatchObject({
      user: { id: 'rn-cached-completion' },
    });
    const exchangeBodies = http.postPublic.mock.calls
      .filter((call: unknown[]) => call[0] === '/api/auth/oauth/exchange')
      .map((call: unknown[]) => call[1]);
    expect(exchangeBodies).toEqual([
      { ticket, oauthRecoveryNonce: nonce },
      { ticket, oauthRecoveryNonce: nonce },
    ]);
    expect(auth.currentUser?.id).toBe('rn-cached-completion');
    tm.destroy();
  });

  it('uses the last-started RN completion as winner and leaves no cold-start sibling', async () => {
    const storage = createMockStorage();
    const tm = new TokenManager('http://localhost:8688', storage);
    await tm.ready();
    const http = createMockHttpClient();
    const ticketA = '78'.repeat(32);
    const ticketB = '89'.repeat(32);
    let resolveA!: (value: unknown) => void;
    http.postPublic.mockImplementation(async (path: string, body: { ticket?: string }) => {
      if (path === '/api/auth/oauth/exchange' && body?.ticket === ticketA) {
        return await new Promise((resolve) => { resolveA = resolve; });
      }
      if (path === '/api/auth/oauth/exchange' && body?.ticket === ticketB) {
        return {
          user: { id: 'rn-winner-b' },
          accessToken: makeValidJwt('rn-winner-b'),
          refreshToken: makeValidJwt('rn-winner-b'),
        };
      }
      return { ok: true };
    });
    const auth = new AuthClient(http, tm, createMockCore(), createMockCore());
    const startA = await auth.signInWithOAuth('google', { redirectUrl: OAUTH_REDIRECT_URL });
    const startB = await auth.signInWithOAuth('github', { redirectUrl: OAUTH_REDIRECT_URL });
    const nonceA = new URL(startA.url).searchParams.get('oauth_recovery_nonce')!;
    const nonceB = new URL(startB.url).searchParams.get('oauth_recovery_nonce')!;
    const callbackA = auth.handleOAuthCallback(
      `${OAUTH_REDIRECT_URL}#oauth_exchange_ticket=${ticketA}&oauth_recovery_nonce=${nonceA}`,
    );
    await vi.waitFor(() => expect(http.postPublic).toHaveBeenCalledWith(
      '/api/auth/oauth/exchange',
      { ticket: ticketA, oauthRecoveryNonce: nonceA },
    ));
    const callbackB = auth.handleOAuthCallback(
      `${OAUTH_REDIRECT_URL}#oauth_exchange_ticket=${ticketB}&oauth_recovery_nonce=${nonceB}`,
    );
    await vi.waitFor(() => expect(storage.store.get(TEST_PENDING_OAUTH_COMPLETIONS_KEY))
      .toContain(ticketB));
    resolveA({
      user: { id: 'rn-superseded-a' },
      accessToken: makeValidJwt('rn-superseded-a'),
      refreshToken: makeValidJwt('rn-superseded-a'),
    });

    await expect(callbackA).rejects.toMatchObject({ slug: 'auth-state-changed' });
    await vi.waitFor(() => expect(storage.store.get(TEST_AUTH_EPOCH_KEY)).toBe('2'));
    await expect(callbackB).resolves.toMatchObject({ user: { id: 'rn-winner-b' } });
    expect(auth.currentUser?.id).toBe('rn-winner-b');
    expect(storage.store.has(TEST_PENDING_OAUTH_KEY)).toBe(false);
    expect(storage.store.has(TEST_PENDING_OAUTH_COMPLETIONS_KEY)).toBe(false);

    tm.destroy();
    const reloaded = new TokenManager('http://localhost:8688', storage);
    await reloaded.ready();
    expect(reloaded.getCurrentUser()?.id).toBe('rn-winner-b');
    await expect(reloaded.getPendingOAuthCompletion()).resolves.toBeNull();
    reloaded.destroy();
  });

  it('handleOAuthCallback → 토큰 없는 URL은 null 반환', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore());
    const result = await auth.handleOAuthCallback(`${OAUTH_REDIRECT_URL}?code=abc`);
    expect(result).toBeNull();
    tm.destroy();
  });

  it('handleOAuthCallback → 잘못된 URL은 null 반환', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore());
    const result = await auth.handleOAuthCallback('not-a-url');
    expect(result).toBeNull();
    tm.destroy();
  });

  it('signInWithOAuth → URL 생성', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore());
    const result = await auth.signInWithOAuth('google', { redirectUrl: OAUTH_REDIRECT_URL });
    expect(result.url).toContain('/api/auth/oauth/google');
    expect(new URL(result.url).searchParams.get('oauth_recovery_nonce')).toMatch(/^[0-9a-f]{64}$/);
    tm.destroy();
  });

  it('signInWithOAuth → redirectUrl 포함', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore());
    const result = await auth.signInWithOAuth('github', { redirectUrl: OAUTH_REDIRECT_URL });
    expect(result.url).toContain('redirect_url=');
    tm.destroy();
  });

  it('signInWithOAuth → Linking.openURL 호출', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const mockLinking = {
      openURL: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn().mockReturnValue({ remove: () => {} }),
      getInitialURL: vi.fn().mockResolvedValue(null),
    };
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore(), mockLinking);
    await auth.signInWithOAuth('google', { redirectUrl: OAUTH_REDIRECT_URL });
    expect(mockLinking.openURL).toHaveBeenCalled();
    tm.destroy();
  });

  it('linkWithOAuth → generated core에 redirectUrl body 전달', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const core = createMockCore();
    const auth = new AuthClient(createMockHttpClient(), tm, core, createMockCore());

    await expect(auth.linkWithOAuth('google', {
      redirectUrl: OAUTH_REDIRECT_URL,
    })).resolves.toEqual({
      redirectUrl: 'https://provider.example.com/authorize',
    });
    expect(core.oauthLinkStart).toHaveBeenCalledWith('google', expect.objectContaining({
      redirectUrl: OAUTH_REDIRECT_URL,
      oauthRecoveryNonce: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    tm.destroy();
  });

  it('OAuth callback은 unsolicited/mismatch/replay를 거부하고 query fallback도 1회만 허용', async () => {
    const storage = createMockStorage();
    const tm = new TokenManager('http://localhost:8688', storage);
    await tm.ready();
    const corePublic = createMockCore();
    const http = createMockHttpClient();
    const rotatedAccess = makeValidJwt('secure-oauth-user');
    const rotatedRefresh = makeValidJwt('secure-oauth-user');
    http.postPublic.mockResolvedValue({
      user: { id: 'secure-oauth-user' },
      accessToken: rotatedAccess,
      refreshToken: rotatedRefresh,
    });
    const auth = new AuthClient(http, tm, createMockCore(), corePublic);
    const ticket = 'cd'.repeat(32);

    await expect(auth.handleOAuthCallback(
      `${OAUTH_REDIRECT_URL}#oauth_exchange_ticket=${ticket}`,
    )).resolves.toBeNull();
    expect(http.postPublic).not.toHaveBeenCalled();

    const start = await auth.signInWithOAuth('github', { redirectUrl: OAUTH_REDIRECT_URL });
    const nonce = new URL(start.url).searchParams.get('oauth_recovery_nonce')!;
    const pendingKey = TEST_PENDING_OAUTH_KEY;
    expect(storage.store.has(pendingKey)).toBe(true);
    const wrongNonce = nonce === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
    await expect(auth.handleOAuthCallback(
      `${OAUTH_REDIRECT_URL}?oauth_exchange_ticket=${ticket}&oauth_recovery_nonce=${wrongNonce}`,
    )).resolves.toBeNull();
    expect(storage.store.has(pendingKey)).toBe(true);
    expect(http.postPublic).not.toHaveBeenCalled();

    const callbackUrl = `${OAUTH_REDIRECT_URL}?oauth_exchange_ticket=${ticket}&auth_transport=body&oauth_recovery_nonce=${nonce}`;
    await expect(auth.handleOAuthCallback(callbackUrl)).resolves.toMatchObject({
      user: { id: 'secure-oauth-user' },
    });
    expect(http.postPublic).toHaveBeenCalledTimes(1);
    expect(storage.store.has(pendingKey)).toBe(false);
    await expect(auth.handleOAuthCallback(callbackUrl)).resolves.toBeNull();
    expect(http.postPublic).toHaveBeenCalledTimes(1);
    tm.destroy();
  });

  it('서버 회전 응답의 access token이 잘못되면 RN 세션을 부분 적용하지 않음', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const corePublic = createMockCore();
    const http = createMockHttpClient();
    http.postPublic.mockResolvedValue({
      user: { id: 'invalid-server-user' },
      accessToken: 'not-a-jwt',
      refreshToken: makeValidJwt('invalid-server-user'),
    });
    const auth = new AuthClient(http, tm, createMockCore(), corePublic);
    const start = await auth.signInWithOAuth('google', { redirectUrl: OAUTH_REDIRECT_URL });
    const nonce = new URL(start.url).searchParams.get('oauth_recovery_nonce')!;

    await expect(auth.handleOAuthCallback(
      `${OAUTH_REDIRECT_URL}#oauth_exchange_ticket=${'ef'.repeat(32)}&auth_transport=body&oauth_recovery_nonce=${nonce}`,
    )).resolves.toBeNull();

    expect(auth.currentUser).toBeNull();
    expect(tm.getRefreshToken()).toBeNull();
    tm.destroy();
  });

  it('OAuth validation response that sign-out supersedes cannot restore RN auth state', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const core = createMockCore();
    const corePublic = createMockCore();
    const http = createMockHttpClient();
    let resolveExchange!: (value: unknown) => void;
    http.postPublic.mockImplementation(() => new Promise((resolve) => {
      resolveExchange = resolve;
    }));
    const auth = new AuthClient(http, tm, core, corePublic);
    await tm.setTokens({
      accessToken: makeValidJwt('existing-user'),
      refreshToken: makeValidJwt('existing-user'),
    });
    const start = await auth.signInWithOAuth('google', { redirectUrl: OAUTH_REDIRECT_URL });
    const nonce = new URL(start.url).searchParams.get('oauth_recovery_nonce')!;
    const callback = auth.handleOAuthCallback(
      `${OAUTH_REDIRECT_URL}#oauth_exchange_ticket=${'12'.repeat(32)}&auth_transport=body&oauth_recovery_nonce=${nonce}`,
    );
    await vi.waitFor(() => expect(http.postPublic).toHaveBeenCalledTimes(1));
    await auth.signOut();
    resolveExchange({
      user: { id: 'late-user' },
      accessToken: makeValidJwt('late-user'),
      refreshToken: makeValidJwt('late-user'),
    });
    await expect(callback).rejects.toMatchObject({ slug: 'auth-state-changed' });
    expect(auth.currentUser).toBeNull();
    tm.destroy();
  });

  it('OAuth browser-open failures remove only the flow nonce', async () => {
    const storage = createMockStorage();
    const tm = new TokenManager('http://localhost:8688', storage);
    await tm.ready();
    const linking = {
      openURL: vi.fn().mockRejectedValue(new Error('cannot open browser')),
      addEventListener: vi.fn().mockReturnValue({ remove: () => {} }),
      getInitialURL: vi.fn().mockResolvedValue(null),
    };
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore(), linking);
    await expect(auth.signInWithOAuth('google', { redirectUrl: OAUTH_REDIRECT_URL })).rejects.toThrow('cannot open browser');
    expect(storage.store.has(TEST_PENDING_OAUTH_KEY)).toBe(false);
    tm.destroy();
  });

  it('RN OAuth fails closed before opening when secure randomness is unavailable', async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', undefined);
    try {
      const tm = createMockTokenManager();
      await tm.ready();
      const linking = {
        openURL: vi.fn().mockResolvedValue(undefined),
        addEventListener: vi.fn().mockReturnValue({ remove: () => {} }),
        getInitialURL: vi.fn().mockResolvedValue(null),
      };
      const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore(), linking);
      await expect(auth.signInWithOAuth('google', { redirectUrl: OAUTH_REDIRECT_URL })).rejects.toThrow(
        'Secure random generation is required to start OAuth.',
      );
      expect(linking.openURL).not.toHaveBeenCalled();
      tm.destroy();
    } finally {
      vi.stubGlobal('crypto', originalCrypto);
    }
  });

  it('RN OAuth fails closed before opening when the nonce cannot be persisted', async () => {
    const store = new Map<string, string>();
    const storage: AsyncStorageAdapter = {
      getItem: async (key) => store.get(key) ?? null,
      setItem: async (key, value) => {
        if (key === TEST_PENDING_OAUTH_KEY) {
          throw new Error('AsyncStorage unavailable');
        }
        store.set(key, value);
      },
      removeItem: async (key) => { store.delete(key); },
    };
    const tm = new TokenManager('http://localhost:8688', storage);
    await tm.ready();
    const linking = {
      openURL: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn().mockReturnValue({ remove: () => {} }),
      getInitialURL: vi.fn().mockResolvedValue(null),
    };
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore(), linking);

    await expect(auth.signInWithOAuth('google', { redirectUrl: OAUTH_REDIRECT_URL })).rejects.toThrow('AsyncStorage unavailable');
    expect(linking.openURL).not.toHaveBeenCalled();
    tm.destroy();
  });

  it('requires a claimed HTTPS callback before persisting a nonce or opening the browser', async () => {
    const storage = createMockStorage();
    const tm = new TokenManager('http://localhost:8688', storage);
    await tm.ready();
    const linking = {
      openURL: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn().mockReturnValue({ remove: () => {} }),
      getInitialURL: vi.fn().mockResolvedValue(null),
    };
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore(), linking);

    await expect(auth.signInWithOAuth({ provider: 'google', redirectUrl: '' }))
      .rejects.toThrow('requires a claimed HTTPS');
    await expect(auth.signInWithOAuth('google', { redirectUrl: 'myapp://auth/callback' }))
      .rejects.toThrow('must be an absolute claimed HTTPS');
    expect(linking.openURL).not.toHaveBeenCalled();
    expect(storage.store.has(TEST_PENDING_OAUTH_KEY)).toBe(false);
    tm.destroy();
  });

  it('uses an injected CSPRNG on Hermes when global crypto is unavailable', async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', undefined);
    try {
      const tm = new TokenManager('http://localhost:8688', createMockStorage(), {
        secureRandom: async (length) => new Uint8Array(length).fill(0xab),
      });
      await tm.ready();
      const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore());
      const start = await auth.signInWithOAuth('google', { redirectUrl: OAUTH_REDIRECT_URL });
      expect(new URL(start.url).searchParams.get('oauth_recovery_nonce')).toBe('ab'.repeat(32));
      tm.destroy();
    } finally {
      vi.stubGlobal('crypto', originalCrypto);
    }
  });

  it('handles an exact cold-start Universal Link callback', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const corePublic = createMockCore();
    const http = createMockHttpClient();
    http.postPublic.mockResolvedValue({
      user: { id: 'cold-start-user' },
      accessToken: makeValidJwt('cold-start-user'),
      refreshToken: makeValidJwt('cold-start-user'),
    });
    let initialUrl: string | null = null;
    const linking = {
      openURL: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn().mockReturnValue({ remove: () => {} }),
      getInitialURL: vi.fn(async () => initialUrl),
    };
    const auth = new AuthClient(http, tm, createMockCore(), corePublic, linking);
    const start = await auth.signInWithOAuth('google', { redirectUrl: OAUTH_REDIRECT_URL });
    const nonce = new URL(start.url).searchParams.get('oauth_recovery_nonce')!;
    initialUrl = `${OAUTH_REDIRECT_URL}#oauth_exchange_ticket=${'34'.repeat(32)}&auth_transport=body&oauth_recovery_nonce=${nonce}`;

    await expect(auth.handleInitialOAuthCallback()).resolves.toMatchObject({
      user: { id: 'cold-start-user' },
    });
    expect(linking.getInitialURL).toHaveBeenCalledTimes(1);
    tm.destroy();
  });

  it('consumes a nonce but rejects a callback delivered on a different route', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const corePublic = createMockCore();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), corePublic);
    const start = await auth.signInWithOAuth('google', { redirectUrl: OAUTH_REDIRECT_URL });
    const nonce = new URL(start.url).searchParams.get('oauth_recovery_nonce')!;
    await expect(auth.handleOAuthCallback(
      `https://evil.example/callback#access_token=raw&refresh_token=raw&oauth_recovery_nonce=${nonce}`,
    )).resolves.toBeNull();
    expect(corePublic.authRefresh).not.toHaveBeenCalled();
    tm.destroy();
  });

  it('listSessions → core.authGetSessions 호출', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const core = createMockCore();
    const auth = new AuthClient(createMockHttpClient(), tm, core, createMockCore());
    const sessions = await auth.listSessions();
    expect(core.authGetSessions).toHaveBeenCalled();
    expect(Array.isArray(sessions)).toBe(true);
    tm.destroy();
  });

  it('revokeSession → core.authDeleteSession 호출', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const core = createMockCore();
    const auth = new AuthClient(createMockHttpClient(), tm, core, createMockCore());
    await auth.revokeSession('sess-123');
    expect(core.authDeleteSession).toHaveBeenCalledWith('sess-123');
    tm.destroy();
  });

  it('updateProfile → core.authUpdateProfile 호출', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const core = createMockCore();
    const auth = new AuthClient(createMockHttpClient(), tm, core, createMockCore());
    await auth.updateProfile({ displayName: 'NewName' });
    expect(core.authUpdateProfile).toHaveBeenCalledWith({ displayName: 'NewName' });
    tm.destroy();
  });

  it('verifyEmail → corePublic.authVerifyEmail 호출', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const corePublic = createMockCore();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), corePublic);
    await auth.verifyEmail('verify-token-abc');
    expect(corePublic.authVerifyEmail).toHaveBeenCalledWith({ token: 'verify-token-abc' });
    tm.destroy();
  });

  it('requestPasswordReset → corePublic.authRequestPasswordReset 호출', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const corePublic = createMockCore();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), corePublic);
    await auth.requestPasswordReset('user@test.com');
    expect(corePublic.authRequestPasswordReset).toHaveBeenCalledWith({ email: 'user@test.com' });
    tm.destroy();
  });

  it('resetPassword → corePublic.authResetPassword 호출', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const corePublic = createMockCore();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), corePublic);
    await auth.resetPassword('reset-tok', 'NewPass1234!');
    expect(corePublic.authResetPassword).toHaveBeenCalledWith({ token: 'reset-tok', newPassword: 'NewPass1234!' });
    tm.destroy();
  });

  it('changePassword → core.authChangePassword 호출', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const core = createMockCore();
    const auth = new AuthClient(createMockHttpClient(), tm, core, createMockCore());
    await auth.changePassword({ currentPassword: 'OldPass1!', newPassword: 'NewPass1!' });
    expect(core.authChangePassword).toHaveBeenCalledWith({
      currentPassword: 'OldPass1!',
      newPassword: 'NewPass1!',
    });
    tm.destroy();
  });

  it('linkWithEmail → core.authLinkEmail 호출', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const core = createMockCore();
    const auth = new AuthClient(createMockHttpClient(), tm, core, createMockCore());
    await auth.linkWithEmail({ email: 'link@test.com', password: 'Link1234!' });
    expect(core.authLinkEmail).toHaveBeenCalledWith({
      email: 'link@test.com',
      password: 'Link1234!',
    });
    tm.destroy();
  });

  it('linkWithEmail은 응답 유실 뒤 기존 자격을 보존하고 재시도에서 동일 replacement pair를 채택', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const initiatingRefreshToken = makeValidJwt('rn-anonymous-email', {
      isAnonymous: true,
      exp: Math.floor(Date.now() / 1000) + 7_200,
    });
    await tm.setTokensPersisted({
      accessToken: makeValidJwt('rn-anonymous-email', { isAnonymous: true }),
      refreshToken: initiatingRefreshToken,
    });
    const recovered = {
      user: { id: 'rn-email-recovered', email: 'recovered@example.com', isAnonymous: false },
      accessToken: makeValidJwt('rn-email-recovered', { isAnonymous: false }),
      refreshToken: makeValidJwt('rn-email-recovered', {
        isAnonymous: false,
        exp: Math.floor(Date.now() / 1000) + 7_200,
      }),
      sessionId: 'rn-email-recovered-session',
    };
    const core = createMockCore();
    core.authLinkEmail
      .mockRejectedValueOnce(new Error('response lost after commit'))
      .mockResolvedValueOnce(recovered);
    const auth = new AuthClient(createMockHttpClient(), tm, core, createMockCore());
    const input = { email: 'Recovered@Example.com', password: 'EmailRecovery1234!' };

    await expect(auth.linkWithEmail(input)).rejects.toThrow('response lost after commit');
    expect(auth.currentUser?.id).toBe('rn-anonymous-email');
    expect(tm.getRefreshToken()).toBe(initiatingRefreshToken);
    await expect(auth.linkWithEmail(input)).resolves.toEqual(recovered);
    expect(core.authLinkEmail).toHaveBeenNthCalledWith(1, input);
    expect(core.authLinkEmail).toHaveBeenNthCalledWith(2, input);
    expect(auth.currentUser?.id).toBe('rn-email-recovered');
    expect(tm.getRefreshToken()).toBe(recovered.refreshToken);
    tm.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PART C — (removed: legacy RealtimeClient tests — now DatabaseLiveClient)
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// PART D — RoomClient (단위 테스트)
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN RoomClient — 구조 검증', () => {

  function createRoomClient(roomId = 'test-room', opts?: any) {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    return { room: new RoomClient('http://localhost:8688', 'default', roomId, tm, opts), tm };
  }

  it('생성 시 에러 없음', () => {
    const { room, tm } = createRoomClient();
    expect(room).toBeDefined();
    expect(room.roomId).toBe('test-room');
    expect(room.namespace).toBe('default');
    tm.destroy();
  });

  it('초기 getSharedState() === {}', () => {
    const { room, tm } = createRoomClient();
    expect(room.getSharedState()).toEqual({});
    tm.destroy();
  });

  it('나중에 auth가 생기면 pending join을 다시 연결', async () => {
    const { room, tm } = createRoomClient();
    const establishConnection = vi.fn().mockResolvedValue(undefined);

    (room as any).joinRequested = true;
    (room as any).establishConnection = establishConnection;

    await tm.setTokens({
      accessToken: makeValidJwt('room-rn-user'),
      refreshToken: makeValidJwt('room-rn-user'),
    });

    await Promise.resolve();

    expect(establishConnection).toHaveBeenCalledTimes(1);
    tm.destroy();
  });

  it('join() 두 번 호출 시 진행 중인 room 연결을 재사용', async () => {
    const { room, tm } = createRoomClient();
    await tm.setTokens({
      accessToken: makeValidJwt('rn-room-flight'),
      refreshToken: makeValidJwt('rn-room-flight'),
    });
    let resolveConnection: (() => void) | undefined;
    const establishConnection = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConnection = resolve;
        }),
    );

    (room as any).establishConnection = establishConnection;

    const first = room.join();
    const second = room.join();

    expect(establishConnection).toHaveBeenCalledTimes(1);

    resolveConnection?.();
    await Promise.all([first, second]);
    tm.destroy();
  });

  it('소켓이 CONNECTING 상태면 auth change가 새 room 연결을 만들지 않음', async () => {
    const { room, tm } = createRoomClient();
    const establishConnection = vi.fn().mockResolvedValue(undefined);

    (room as any).joinRequested = true;
    (room as any).ws = { readyState: 0 } as WebSocket;
    (room as any).establishConnection = establishConnection;

    await tm.setTokens({
      accessToken: makeValidJwt('rn-room-connecting'),
      refreshToken: makeValidJwt('rn-room-connecting'),
    });

    await Promise.resolve();

    expect(establishConnection).not.toHaveBeenCalled();
    tm.destroy();
  });

  it('refresh token만 있어도 room auth 전에 access token을 새로 받아온다', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    const nextAccessToken = makeValidJwt('rn-room-refresh-user');
    const nextRefreshToken = makeValidJwt('rn-room-refresh-user', { exp: Math.floor(Date.now() / 1000) + 7200 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        accessToken: nextAccessToken,
        refreshToken: nextRefreshToken,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const send = vi.fn();
    const ws = { send, onmessage: null as ((event: MessageEvent) => void) | null } as unknown as WebSocket;

    await tm.setTokens({
      accessToken: makeValidJwt('rn-room-refresh-user'),
      refreshToken: makeValidJwt('rn-room-refresh-user', { exp: Math.floor(Date.now() / 1000) + 7200 }),
    });
    (tm as any).accessToken = null;
    (room as any).ws = ws;
    (room as any).connected = true;

    const authPromise = (room as any).authenticate();
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8688/api/auth/refresh',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(send).toHaveBeenCalledWith(JSON.stringify({ type: 'auth', token: nextAccessToken }));

    ws.onmessage?.({ data: JSON.stringify({ type: 'auth_success' }) } as MessageEvent);
    await authPromise;

    fetchSpy.mockRestore();
    tm.destroy();
  });

  it('auth send와 같은 틱에 auth_success가 와도 room join이 성공한다', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    const originalOnMessage = vi.fn();
    const ws = {
      onmessage: originalOnMessage as ((event: MessageEvent) => void) | null,
      send: vi.fn((raw: string) => {
        const message = JSON.parse(raw) as Record<string, unknown>;
        if (message.type === 'auth') {
          expect(message).toMatchObject({ type: 'auth', token: expect.any(String) });
          ws.onmessage?.({ data: JSON.stringify({ type: 'auth_success' }) } as MessageEvent);
        }
      }),
    } as unknown as WebSocket;

    await tm.setTokens({
      accessToken: makeValidJwt('rn-room-race-user'),
      refreshToken: makeValidJwt('rn-room-race-user'),
    });
    (room as any).ws = ws;
    (room as any).connected = true;

    await (room as any).authenticate();

    expect(originalOnMessage).not.toHaveBeenCalled();
    expect((room as any).authenticated).toBe(true);
    expect((room as any).joined).toBe(true);
    tm.destroy();
  });

  it('초기 getPlayerState() === {}', () => {
    const { room, tm } = createRoomClient();
    expect(room.getPlayerState()).toEqual({});
    tm.destroy();
  });

  it('getSharedState()는 읽기 전용 스냅샷 반환', () => {
    const { room, tm } = createRoomClient();
    const s1 = room.getSharedState();
    const s2 = room.getSharedState();
    expect(s1).toEqual(s2);
    expect(s1).not.toBe(s2); // different object reference (snapshot)
    tm.destroy();
  });

  it('getPlayerState()는 읽기 전용 스냅샷 반환', () => {
    const { room, tm } = createRoomClient();
    const s1 = room.getPlayerState();
    const s2 = room.getPlayerState();
    expect(s1).toEqual(s2);
    expect(s1).not.toBe(s2); // different object reference (snapshot)
    tm.destroy();
  });

  it('onSharedState 함수 존재', () => {
    const { room, tm } = createRoomClient();
    expect(typeof room.onSharedState).toBe('function');
    tm.destroy();
  });

  it('onPlayerState 함수 존재', () => {
    const { room, tm } = createRoomClient();
    expect(typeof room.onPlayerState).toBe('function');
    tm.destroy();
  });

  it('onMessage 함수 존재', () => {
    const { room, tm } = createRoomClient();
    expect(typeof room.onMessage).toBe('function');
    tm.destroy();
  });

  it('onAnyMessage 함수 존재', () => {
    const { room, tm } = createRoomClient();
    expect(typeof room.onAnyMessage).toBe('function');
    tm.destroy();
  });

  it('onError 함수 존재', () => {
    const { room, tm } = createRoomClient();
    expect(typeof room.onError).toBe('function');
    tm.destroy();
  });

  it('onKicked 함수 존재', () => {
    const { room, tm } = createRoomClient();
    expect(typeof room.onKicked).toBe('function');
    tm.destroy();
  });

  it('send 함수 존재', () => {
    const { room, tm } = createRoomClient();
    expect(typeof room.send).toBe('function');
    tm.destroy();
  });

  it('getMetadata 함수 존재', () => {
    const { room, tm } = createRoomClient();
    expect(typeof room.getMetadata).toBe('function');
    tm.destroy();
  });

  it('join 함수 존재', () => {
    const { room, tm } = createRoomClient();
    expect(typeof room.join).toBe('function');
    tm.destroy();
  });

  it('leave 함수 존재', () => {
    const { room, tm } = createRoomClient();
    expect(typeof room.leave).toBe('function');
    tm.destroy();
  });

  it('leave() 호출 시 에러 없음', () => {
    const { room, tm } = createRoomClient();
    expect(() => room.leave()).not.toThrow();
    tm.destroy();
  });

  it('leave()는 명시적 room leave close code로 소켓을 닫는다', () => {
    vi.useFakeTimers();
    const { room, tm } = createRoomClient();
    const send = vi.fn();
    const close = vi.fn();

    (room as any).ws = { close, send };
    (room as any).connected = true;
    room.leave();

    expect(send).toHaveBeenCalledWith(JSON.stringify({ type: 'leave' }));
    expect(close).toHaveBeenCalledWith(4005, 'Client left room');
    tm.destroy();
    vi.useRealTimers();
  });

  it('leave() 후 state 초기화', () => {
    const { room, tm } = createRoomClient();
    room.leave();
    expect(room.getSharedState()).toEqual({});
    expect(room.getPlayerState()).toEqual({});
    tm.destroy();
  });

  it('onSharedState → { unsubscribe } 반환', () => {
    const { room, tm } = createRoomClient();
    const sub = room.onSharedState(() => {});
    expect(typeof sub.unsubscribe).toBe('function');
    sub.unsubscribe();
    tm.destroy();
  });

  it('onPlayerState → { unsubscribe } 반환', () => {
    const { room, tm } = createRoomClient();
    const sub = room.onPlayerState(() => {});
    expect(typeof sub.unsubscribe).toBe('function');
    sub.unsubscribe();
    tm.destroy();
  });

  it('onMessage → { unsubscribe } 반환', () => {
    const { room, tm } = createRoomClient();
    const sub = room.onMessage('my-event', () => {});
    expect(typeof sub.unsubscribe).toBe('function');
    sub.unsubscribe();
    tm.destroy();
  });

  it('onAnyMessage → { unsubscribe } 반환', () => {
    const { room, tm } = createRoomClient();
    const sub = room.onAnyMessage(() => {});
    expect(typeof sub.unsubscribe).toBe('function');
    sub.unsubscribe();
    tm.destroy();
  });

  it('onError → { unsubscribe } 반환', () => {
    const { room, tm } = createRoomClient();
    const sub = room.onError(() => {});
    expect(typeof sub.unsubscribe).toBe('function');
    sub.unsubscribe();
    tm.destroy();
  });

  it('onKicked → { unsubscribe } 반환', () => {
    const { room, tm } = createRoomClient();
    const sub = room.onKicked(() => {});
    expect(typeof sub.unsubscribe).toBe('function');
    sub.unsubscribe();
    tm.destroy();
  });

  it('여러 핸들러 등록 및 해제', () => {
    const { room, tm } = createRoomClient();
    const u1 = room.onSharedState(() => {});
    const u2 = room.onSharedState(() => {});
    const u3 = room.onPlayerState(() => {});
    u1.unsubscribe(); u2.unsubscribe(); u3.unsubscribe();
    tm.destroy();
  });

  it('send → 연결 없으면 에러', async () => {
    const { room, tm } = createRoomClient();
    await expect(room.send('TEST_ACTION', { data: 1 })).rejects.toThrow(
      "Room connection required before sending action 'TEST_ACTION'",
    );
    tm.destroy();
  });

  it('RoomClient.getMetadata static 함수 존재', () => {
    expect(typeof RoomClient.getMetadata).toBe('function');
  });
});

describe('RN RoomClient — rooms adapter APIs', () => {
  async function createConnectedRoom(roomId = 'adapter-room') {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.setTokens({
      accessToken: makeValidJwt(`rn-${roomId}`),
      refreshToken: makeValidJwt(`rn-${roomId}`),
    });
    const room = new RoomClient('http://localhost:8688', 'default', roomId, tm);
    const send = vi.fn();

    (room as any).ws = { send } as WebSocket;
    (room as any).connected = true;
    (room as any).authenticated = true;

    return { room, tm, send };
  }

  it('state/meta wrapper가 기존 메서드에 위임한다', async () => {
    const { room, tm } = await createConnectedRoom('state-meta');
    const sendSpy = vi.spyOn(room, 'send').mockResolvedValue({ ok: true });
    const metadataSpy = vi.spyOn(room, 'getMetadata').mockResolvedValue({ stage: 'lobby' });

    (room as any)._sharedState = { score: 1 };
    (room as any)._playerState = { ready: true };

    expect(room.state.getShared()).toEqual({ score: 1 });
    expect(room.state.getMine()).toEqual({ ready: true });
    await expect(room.state.send('SET_READY', { ready: true })).resolves.toEqual({ ok: true });
    await expect(room.meta.get()).resolves.toEqual({ stage: 'lobby' });

    expect(sendSpy).toHaveBeenCalledWith('SET_READY', { ready: true });
    expect(metadataSpy).toHaveBeenCalledTimes(1);
    tm.destroy();
  });

  it('signals adapter가 outbound/inbound signal 프레임을 처리한다', async () => {
    const { room, tm, send } = await createConnectedRoom('signals');
    const specificHandler = vi.fn();
    const anyHandler = vi.fn();

    room.signals.on('chat.ping', specificHandler);
    room.signals.onAny(anyHandler);

    (room as any).handleMessage(JSON.stringify({
      type: 'signal',
      event: 'chat.ping',
      payload: { body: 'hello' },
      meta: {
        memberId: 'member-2',
        userId: 'user-2',
        connectionId: 'conn-2',
        sentAt: 123,
      },
    }));

    expect(specificHandler).toHaveBeenCalledWith(
      { body: 'hello' },
      expect.objectContaining({
        memberId: 'member-2',
        userId: 'user-2',
        connectionId: 'conn-2',
        sentAt: 123,
      }),
    );
    expect(anyHandler).toHaveBeenCalledWith(
      'chat.ping',
      { body: 'hello' },
      expect.objectContaining({ memberId: 'member-2' }),
    );

    const sendPromise = room.signals.send('chat.announce', { body: 'broadcast' }, { includeSelf: true });
    const outbound = JSON.parse(send.mock.calls[0][0]) as Record<string, unknown>;
    expect(outbound).toMatchObject({
      type: 'signal',
      event: 'chat.announce',
      payload: { body: 'broadcast' },
      includeSelf: true,
    });

    (room as any).handleMessage(JSON.stringify({
      type: 'signal_sent',
      requestId: outbound.requestId,
    }));
    await sendPromise;
    tm.destroy();
  });

  it('members adapter가 sync/join/leave/state 흐름을 유지한다', async () => {
    const { room, tm, send } = await createConnectedRoom('members');
    const syncHandler = vi.fn();
    const joinHandler = vi.fn();
    const leaveHandler = vi.fn();
    const stateHandler = vi.fn();

    room.members.onSync(syncHandler);
    room.members.onJoin(joinHandler);
    room.members.onLeave(leaveHandler);
    room.members.onStateChange(stateHandler);

    (room as any).currentUserId = 'member-1';
    (room as any).handleMessage(JSON.stringify({
      type: 'members_sync',
      members: [
        {
          memberId: 'member-1',
          userId: 'member-1',
          connectionId: 'conn-1',
          connectionCount: 1,
          role: 'owner',
          state: { ready: true },
        },
      ],
    }));
    expect(syncHandler).toHaveBeenCalledWith([
      expect.objectContaining({ memberId: 'member-1', state: { ready: true } }),
    ]);

    const listed = room.members.list();
    listed[0]!.state.ready = false;
    expect(room.members.list()).toEqual([
      expect.objectContaining({ memberId: 'member-1', state: { ready: true } }),
    ]);

    const setStatePromise = room.members.setState({ ready: false });
    const outbound = JSON.parse(send.mock.calls[0][0]) as Record<string, unknown>;
    expect(outbound).toMatchObject({ type: 'member_state', state: { ready: false } });

    (room as any).handleMessage(JSON.stringify({
      type: 'member_state',
      requestId: outbound.requestId,
      member: {
        memberId: 'member-1',
        userId: 'member-1',
        connectionId: 'conn-1',
        connectionCount: 1,
        state: { ready: false },
      },
      state: { ready: false },
    }));
    await setStatePromise;
    expect(stateHandler).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'member-1', state: { ready: false } }),
      { ready: false },
    );

    (room as any).handleMessage(JSON.stringify({
      type: 'member_join',
      member: {
        memberId: 'member-2',
        userId: 'member-2',
        connectionId: 'conn-2',
        connectionCount: 1,
        state: { ready: false },
      },
    }));
    expect(joinHandler).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'member-2' }));

    (room as any).handleMessage(JSON.stringify({
      type: 'member_leave',
      reason: 'timeout',
      member: {
        memberId: 'member-2',
        userId: 'member-2',
        connectionId: 'conn-2',
        connectionCount: 0,
        state: { ready: false },
      },
    }));
    expect(leaveHandler).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'member-2' }),
      'timeout',
    );
    tm.destroy();
  });

  it('admin adapter가 admin_result로 resolve된다', async () => {
    const { room, tm, send } = await createConnectedRoom('admin');

    const kickPromise = room.admin.kick('member-2');
    const outbound = JSON.parse(send.mock.calls[0][0]) as Record<string, unknown>;
    expect(outbound).toMatchObject({
      type: 'admin',
      operation: 'kick',
      memberId: 'member-2',
      payload: {},
    });

    (room as any).handleMessage(JSON.stringify({
      type: 'admin_result',
      requestId: outbound.requestId,
    }));
    await kickPromise;

    tm.destroy();
  });

  it('session adapter가 connection state와 reconnect 콜백을 방출한다', async () => {
    vi.useFakeTimers();
    const { room, tm } = await createConnectedRoom('session');
    const states: string[] = [];
    const reconnectHandler = vi.fn();

    room.session.onConnectionStateChange((state) => states.push(state));
    room.session.onReconnect(reconnectHandler);

    (room as any).setConnectionState('connecting');
    (room as any).scheduleReconnect();
    expect(states).toEqual(['connecting', 'reconnecting']);

    (room as any).handleMessage(JSON.stringify({
      type: 'sync',
      sharedState: {},
      sharedVersion: 1,
      playerState: {},
      playerVersion: 1,
    }));

    expect(states).toEqual(['connecting', 'reconnecting', 'connected']);
    expect(reconnectHandler).toHaveBeenCalledWith({ attempt: 1 });

    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    tm.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PART E — PushClient (단위 테스트)
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN PushClient — 구조 검증', () => {

  function createMockHttpForPush() {
    return {
      post: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockResolvedValue({}),
    } as any;
  }

  it('생성 시 에러 없음', () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    expect(push).toBeDefined();
  });

  it('setTokenProvider 함수 존재', () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    expect(typeof push.setTokenProvider).toBe('function');
  });

  it('setPermissionProvider 함수 존재', () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    expect(typeof push.setPermissionProvider).toBe('function');
  });

  it('register 함수 존재', () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    expect(typeof push.register).toBe('function');
  });

  it('unregister 함수 존재', () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    expect(typeof push.unregister).toBe('function');
  });

  it('onMessage 함수 존재', () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    expect(typeof push.onMessage).toBe('function');
  });

  it('onMessageOpenedApp 함수 존재', () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    expect(typeof push.onMessageOpenedApp).toBe('function');
  });

  it('register → tokenProvider 없으면 에러', async () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    await expect(push.register()).rejects.toThrow('No token provider set');
  });

  it('register → tokenProvider 있으면 POST 호출', async () => {
    const http = createMockHttpForPush();
    const push = new PushClient(http, createMockStorage());
    push.setTokenProvider(async () => ({ token: 'fcm-token-123', platform: 'android' as const }));
    await push.register();
    expect(http.post).toHaveBeenCalledWith('/api/push/register', expect.objectContaining({
      token: 'fcm-token-123',
      platform: 'android',
    }));
  });

  it('register → 같은 토큰 두번째 호출 시 캐시 히트 (스킵)', async () => {
    const http = createMockHttpForPush();
    const storage = createMockStorage();
    const push = new PushClient(http, storage);
    push.setTokenProvider(async () => ({ token: 'same-token', platform: 'ios' as const }));
    await push.register();
    expect(http.post).toHaveBeenCalledTimes(1);
    // Second call with same token — should skip
    await push.register();
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent first registration into exactly one server mutation', async () => {
    const http = createMockHttpForPush();
    const storage = createMockStorage();
    const push = new PushClient(
      http,
      storage,
      undefined,
      'https://api-a.example.com',
      async () => new Uint8Array(16).fill(0x11),
    );
    push.setTokenProvider(async () => ({ token: 'concurrent-token', platform: 'android' as const }));

    await Promise.all([push.register(), push.register()]);

    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it('isolates identical tokens and device registrations across API namespaces', async () => {
    const http = createMockHttpForPush();
    const storage = createMockStorage();
    let randomByte = 0x21;
    const secureRandom = async () => new Uint8Array(16).fill(randomByte++);
    const pushA = new PushClient(http, storage, undefined, 'https://api-a.example.com', secureRandom);
    const pushB = new PushClient(http, storage, undefined, 'https://api-b.example.com', secureRandom);
    for (const push of [pushA, pushB]) {
      push.setTokenProvider(async () => ({ token: 'shared-native-token', platform: 'ios' as const }));
    }

    await pushA.register();
    await pushB.register();

    const registrations = http.post.mock.calls
      .filter(([path]: [string]) => path === '/api/push/register')
      .map(([, body]: [string, { deviceId: string }]) => body);
    expect(registrations).toHaveLength(2);
    expect(registrations[0].deviceId).not.toBe(registrations[1].deviceId);
    await pushA.unregister();
    expect(await pushA.hasCachedRegistration()).toBe(false);
    expect(await pushB.hasCachedRegistration()).toBe(true);
  });

  it('fails closed before registration when no CSPRNG is available or its output length is invalid', async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', undefined);
    try {
      const noCryptoHttp = createMockHttpForPush();
      const noCrypto = new PushClient(noCryptoHttp, createMockStorage(), undefined, 'api-no-crypto');
      noCrypto.setTokenProvider(async () => ({ token: 'token', platform: 'android' as const }));
      await expect(noCrypto.register()).rejects.toThrow('cryptographically secure random');
      expect(noCryptoHttp.post).not.toHaveBeenCalled();

      const invalidHttp = createMockHttpForPush();
      const invalid = new PushClient(
        invalidHttp,
        createMockStorage(),
        undefined,
        'api-invalid-random',
        async () => new Uint8Array(15),
      );
      invalid.setTokenProvider(async () => ({ token: 'token', platform: 'android' as const }));
      await expect(invalid.register()).rejects.toThrow('exactly 16 bytes');
      expect(invalidHttp.post).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal('crypto', originalCrypto);
    }
  });

  it('register with metadata → metadata 포함', async () => {
    const http = createMockHttpForPush();
    const push = new PushClient(http, createMockStorage());
    push.setTokenProvider(async () => ({ token: 'meta-tok', platform: 'android' as const }));
    await push.register({ metadata: { appVersion: '1.0' } });
    expect(http.post).toHaveBeenCalledWith('/api/push/register', expect.objectContaining({
      metadata: { appVersion: '1.0' },
    }));
  });

  it('unregister → POST /api/push/unregister 호출', async () => {
    const http = createMockHttpForPush();
    const push = new PushClient(http, createMockStorage());
    await push.unregister('device-123');
    expect(http.post).toHaveBeenCalledWith('/api/push/unregister', { deviceId: 'device-123' });
  });

  it('onMessage → unsub 함수 반환', () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    const unsub = push.onMessage(() => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('onMessageOpenedApp → unsub 함수 반환', () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    const unsub = push.onMessageOpenedApp(() => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('_dispatchForegroundMessage → onMessage 리스너 호출', () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    const received: any[] = [];
    push.onMessage((msg) => received.push(msg));
    push._dispatchForegroundMessage({ title: 'Hello', body: 'World' });
    expect(received).toHaveLength(1);
    expect(received[0].title).toBe('Hello');
  });

  it('_dispatchOpenedAppMessage → onMessageOpenedApp 리스너 호출', () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    const received: any[] = [];
    push.onMessageOpenedApp((msg) => received.push(msg));
    push._dispatchOpenedAppMessage({ title: 'Tapped', data: { key: 'val' } });
    expect(received).toHaveLength(1);
    expect(received[0].data.key).toBe('val');
  });

  // ─── Permission: built-in defaults (no provider) ───

  it('getPermissionStatus → provider 없이 내장 기본값 사용 (에러 아님)', async () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    // Built-in default should not throw — returns a valid status
    const status = await push.getPermissionStatus();
    expect(['granted', 'denied', 'not-determined', 'provisional']).toContain(status);
  });

  it('requestPermission → provider 없이 내장 기본값 사용 (에러 아님)', async () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    // Built-in default should not throw — returns a valid status
    const status = await push.requestPermission();
    expect(['granted', 'denied', 'not-determined', 'provisional']).toContain(status);
  });

  // ─── Permission: custom provider override ───

  it('getPermissionStatus → provider 있으면 provider 우선 호출', async () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    const mockProvider = {
      getPermissionStatus: vi.fn().mockResolvedValue('granted'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
    };
    push.setPermissionProvider(mockProvider);
    const status = await push.getPermissionStatus();
    expect(status).toBe('granted');
    expect(mockProvider.getPermissionStatus).toHaveBeenCalledTimes(1);
  });

  it('requestPermission → provider 있으면 provider 우선 호출', async () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    const mockProvider = {
      getPermissionStatus: vi.fn().mockResolvedValue('not-determined'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
    };
    push.setPermissionProvider(mockProvider);
    const status = await push.requestPermission();
    expect(status).toBe('granted');
    expect(mockProvider.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('getPermissionStatus → provider가 denied 반환', async () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    push.setPermissionProvider({
      getPermissionStatus: vi.fn().mockResolvedValue('denied'),
      requestPermission: vi.fn().mockResolvedValue('denied'),
    });
    const status = await push.getPermissionStatus();
    expect(status).toBe('denied');
  });

  it('requestPermission → provider가 denied 반환', async () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    push.setPermissionProvider({
      getPermissionStatus: vi.fn().mockResolvedValue('not-determined'),
      requestPermission: vi.fn().mockResolvedValue('denied'),
    });
    const status = await push.requestPermission();
    expect(status).toBe('denied');
  });

  // ─── Permission: register() auto-permission flow ───

  it('register → 권한 denied 시 서버 호출 없이 조기 반환', async () => {
    const http = createMockHttpForPush();
    const push = new PushClient(http, createMockStorage());
    push.setTokenProvider(async () => ({ token: 'tok', platform: 'android' as const }));
    push.setPermissionProvider({
      getPermissionStatus: vi.fn().mockResolvedValue('denied'),
      requestPermission: vi.fn().mockResolvedValue('denied'),
    });
    await push.register();
    // Permission denied → should NOT call POST /api/push/register
    expect(http.post).not.toHaveBeenCalled();
  });

  it('register → 권한 granted 시 정상 등록', async () => {
    const http = createMockHttpForPush();
    const push = new PushClient(http, createMockStorage());
    push.setTokenProvider(async () => ({ token: 'tok-perm', platform: 'ios' as const }));
    push.setPermissionProvider({
      getPermissionStatus: vi.fn().mockResolvedValue('granted'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
    });
    await push.register();
    expect(http.post).toHaveBeenCalledWith('/api/push/register', expect.objectContaining({
      token: 'tok-perm',
      platform: 'ios',
    }));
  });

  it('register → 내장 기본값으로 권한 자동 처리 (provider 없이)', async () => {
    const http = createMockHttpForPush();
    const push = new PushClient(http, createMockStorage());
    push.setTokenProvider(async () => ({ token: 'tok-default', platform: 'android' as const }));
    // No setPermissionProvider — uses built-in defaults
    await push.register();
    // Built-in default returns 'granted' (in test env with mocked react-native)
    // so register should proceed
    expect(http.post).toHaveBeenCalledWith('/api/push/register', expect.objectContaining({
      token: 'tok-default',
    }));
  });

  it('onMessage unsub 후 dispatch 무시', () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    let count = 0;
    const unsub = push.onMessage(() => count++);
    push._dispatchForegroundMessage({ title: 'First' });
    expect(count).toBe(1);
    unsub();
    push._dispatchForegroundMessage({ title: 'Second' });
    expect(count).toBe(1);
  });

  it('여러 onMessage 리스너', () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    let c1 = 0, c2 = 0;
    push.onMessage(() => c1++);
    push.onMessage(() => c2++);
    push._dispatchForegroundMessage({ title: 'Test' });
    expect(c1).toBe(1);
    expect(c2).toBe(1);
  });

  // ─── Topic Provider (FCM 일원화) ───

  it('setTopicProvider 함수 존재', () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    expect(typeof push.setTopicProvider).toBe('function');
  });

  it('subscribeTopic → topicProvider 없으면 에러', async () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    await expect(push.subscribeTopic('news')).rejects.toThrow('No topic provider set');
  });

  it('unsubscribeTopic → topicProvider 없으면 에러', async () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    await expect(push.unsubscribeTopic('news')).rejects.toThrow('No topic provider set');
  });

  it('subscribeTopic → provider에 위임', async () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    const mockSubscribe = vi.fn().mockResolvedValue(undefined);
    const mockUnsubscribe = vi.fn().mockResolvedValue(undefined);
    push.setTopicProvider({
      subscribeTopic: mockSubscribe,
      unsubscribeTopic: mockUnsubscribe,
    });
    await push.subscribeTopic('news');
    expect(mockSubscribe).toHaveBeenCalledWith('news');
  });

  it('unsubscribeTopic → provider에 위임', async () => {
    const push = new PushClient(createMockHttpForPush(), createMockStorage());
    const mockSubscribe = vi.fn().mockResolvedValue(undefined);
    const mockUnsubscribe = vi.fn().mockResolvedValue(undefined);
    push.setTopicProvider({
      subscribeTopic: mockSubscribe,
      unsubscribeTopic: mockUnsubscribe,
    });
    await push.unsubscribeTopic('sports');
    expect(mockUnsubscribe).toHaveBeenCalledWith('sports');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PART F — LifecycleManager (단위 테스트)
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN LifecycleManager — 구조 검증', () => {

  function createMockAppState(initial = 'active') {
    let handler: ((state: string) => void) | null = null;
    return {
      currentState: initial,
      addEventListener: vi.fn((_type: string, cb: (state: string) => void) => {
        handler = cb;
        return { remove: () => { handler = null; } };
      }),
      _emit: (state: string) => { handler?.(state); },
    };
  }

  function createMockDatabaseLive() {
    return {
      disconnect: vi.fn(),
      reconnect: vi.fn(),
    };
  }

  it('생성 시 에러 없음', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const lm = new LifecycleManager(tm, createMockDatabaseLive(), createMockAppState());
    expect(lm).toBeDefined();
    tm.destroy();
  });

  it('start() 호출 시 에러 없음', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const appState = createMockAppState();
    const lm = new LifecycleManager(tm, createMockDatabaseLive(), appState);
    expect(() => lm.start()).not.toThrow();
    expect(appState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    lm.stop();
    tm.destroy();
  });

  it('stop() 호출 시 에러 없음', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const lm = new LifecycleManager(tm, createMockDatabaseLive(), createMockAppState());
    lm.start();
    expect(() => lm.stop()).not.toThrow();
    tm.destroy();
  });

  it('start() 여러번 호출 → addEventListener 한번만', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const appState = createMockAppState();
    const lm = new LifecycleManager(tm, createMockDatabaseLive(), appState);
    lm.start();
    lm.start();
    expect(appState.addEventListener).toHaveBeenCalledTimes(1);
    lm.stop();
    tm.destroy();
  });

  it('background → disconnect 호출', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const appState = createMockAppState('active');
    const databaseLive = createMockDatabaseLive();
    const lm = new LifecycleManager(tm, databaseLive, appState);
    lm.start();
    appState._emit('background');
    expect(databaseLive.disconnect).toHaveBeenCalled();
    lm.stop();
    tm.destroy();
  });

  it('background → inactive도 disconnect', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const appState = createMockAppState('active');
    const databaseLive = createMockDatabaseLive();
    const lm = new LifecycleManager(tm, databaseLive, appState);
    lm.start();
    appState._emit('inactive');
    expect(databaseLive.disconnect).toHaveBeenCalled();
    lm.stop();
    tm.destroy();
  });

  it('foreground → reconnect 호출', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const appState = createMockAppState('background');
    const databaseLive = createMockDatabaseLive();
    const lm = new LifecycleManager(tm, databaseLive, appState);
    lm.start();
    appState._emit('active');
    expect(databaseLive.reconnect).toHaveBeenCalled();
    lm.stop();
    tm.destroy();
  });

  it('같은 상태 반복 → 무시', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const appState = createMockAppState('active');
    const databaseLive = createMockDatabaseLive();
    const lm = new LifecycleManager(tm, databaseLive, appState);
    lm.start();
    appState._emit('active'); // same state → no-op
    expect(databaseLive.disconnect).not.toHaveBeenCalled();
    expect(databaseLive.reconnect).not.toHaveBeenCalled();
    lm.stop();
    tm.destroy();
  });

  it('databaseLive null → background에서 에러 없음', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const appState = createMockAppState('active');
    const lm = new LifecycleManager(tm, null, appState);
    lm.start();
    expect(() => appState._emit('background')).not.toThrow();
    lm.stop();
    tm.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PART G — Core: TableRef, OrBuilder, EdgeBaseError, FieldOps (단위 테스트)
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN Core — EdgeBaseError', () => {

  it('code + message 포함', () => {
    const err = new EdgeBaseError(404, 'Not found');
    expect(err.code).toBe(404);
    expect(err.message).toBe('Not found');
  });

  it('status === code', () => {
    const err = new EdgeBaseError(500, 'Server error');
    expect(err.status).toBe(500);
  });

  it('data 필드 포함 가능', () => {
    const err = new EdgeBaseError(400, 'Validation failed', { email: { code: 'invalid', message: 'Bad email' } });
    expect(err.data?.email.code).toBe('invalid');
  });

  it('name === "EdgeBaseError"', () => {
    const err = new EdgeBaseError(0, 'test');
    expect(err.name).toBe('EdgeBaseError');
  });

  it('instanceof Error', () => {
    const err = new EdgeBaseError(0, 'test');
    expect(err instanceof Error).toBe(true);
  });

  it('toJSON()', () => {
    const err = new EdgeBaseError(422, 'Invalid', { name: { code: 'required', message: 'Required' } });
    const json = err.toJSON();
    expect(json.code).toBe(422);
    expect(json.message).toBe('Invalid');
    expect(json.data?.name.code).toBe('required');
  });
});

describe('RN Core — FieldOps', () => {

  it('increment(1) → { $op: "increment", value: 1 }', () => {
    const op = increment(1);
    expect(op.$op).toBe('increment');
    expect(op.value).toBe(1);
  });

  it('increment(-5) → value: -5', () => {
    const op = increment(-5);
    expect(op.value).toBe(-5);
  });

  it('increment(0) → value: 0', () => {
    const op = increment(0);
    expect(op.value).toBe(0);
  });

  it('deleteField() → { $op: "deleteField" }', () => {
    const op = deleteField();
    expect(op.$op).toBe('deleteField');
  });
});

describe('RN Core — OrBuilder', () => {

  it('생성 시 에러 없음', () => {
    const ob = new OrBuilder();
    expect(ob).toBeDefined();
  });

  it('where → 체이닝 가능', () => {
    const ob = new OrBuilder();
    const result = ob.where('status', '==', 'draft').where('status', '==', 'archived');
    expect(result).toBe(ob);
  });

  it('getFilters → 필터 배열 반환', () => {
    const ob = new OrBuilder();
    ob.where('a', '==', 1).where('b', '>', 2);
    const filters = ob.getFilters();
    expect(filters).toHaveLength(2);
    expect(filters[0]).toEqual(['a', '==', 1]);
    expect(filters[1]).toEqual(['b', '>', 2]);
  });

  it('getFilters → 복사본 반환', () => {
    const ob = new OrBuilder();
    ob.where('x', '==', 1);
    const f1 = ob.getFilters();
    const f2 = ob.getFilters();
    expect(f1).not.toBe(f2);
    expect(f1).toEqual(f2);
  });

  it('빈 OrBuilder → 빈 배열', () => {
    const ob = new OrBuilder();
    expect(ob.getFilters()).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PART H — ClientEdgeBase (단위 테스트)
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN ClientEdgeBase — 구조 검증', () => {

  function makeClientOptions() {
    return { storage: createMockStorage(), secureStorage: createMockStorage() };
  }

  it('createClient → ClientEdgeBase 인스턴스', () => {
    const client = createClient('http://localhost:8688', makeClientOptions());
    expect(client).toBeInstanceOf(ClientEdgeBase);
    client.destroy();
  });

  it('client.auth 존재', () => {
    const client = createClient('http://localhost:8688', makeClientOptions());
    expect(client.auth).toBeDefined();
    client.destroy();
  });

  it('client.storage 존재', () => {
    const client = createClient('http://localhost:8688', makeClientOptions());
    expect(client.storage).toBeDefined();
    client.destroy();
  });

  it('client.push 존재', () => {
    const client = createClient('http://localhost:8688', makeClientOptions());
    expect(client.push).toBeDefined();
    client.destroy();
  });

  it('signOut clears auth locally first, then combines scoped push cleanup with session revocation', async () => {
    const storage = createMockStorage();
    const secureStorage = createMockStorage();
    let resolveSignOut!: (response: Response) => void;
    const signOutResponse = new Promise<Response>((resolve) => {
      resolveSignOut = resolve;
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/push/register')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/api/auth/signout')) return signOutResponse;
      throw new Error(`Unexpected request: ${url} ${init?.method ?? 'GET'}`);
    });
    const client = createClient('https://api-signout.example.com', {
      storage,
      secureStorage,
      secureRandom: async () => new Uint8Array(16).fill(0x42),
    });
    await client._tokenManager.ready();
    await client._tokenManager.setTokensPersisted({
      accessToken: makeValidJwt('push-signout-user'),
      refreshToken: 'push-signout-refresh-token',
    });
    client.push.setPermissionProvider({
      getPermissionStatus: async () => 'granted',
      requestPermission: async () => 'granted',
    });
    client.push.setTokenProvider(async () => ({ token: 'push-signout-token', platform: 'android' }));
    await client.push.register();
    expect(await client.push.hasCachedRegistration()).toBe(true);

    await client.auth.signOut();
    expect(client._tokenManager.currentAccessToken).toBeNull();
    expect(client._tokenManager.getRefreshToken()).toBeNull();
    await vi.waitFor(() => {
      expect(fetchSpy.mock.calls.some(([input]) => String(input).endsWith('/api/auth/signout'))).toBe(true);
    });
    const signOutCall = fetchSpy.mock.calls.find(([input]) => String(input).endsWith('/api/auth/signout'))!;
    const signOutBody = JSON.parse(String(signOutCall[1]?.body)) as {
      refreshToken: string;
      pushDeviceId?: string;
    };
    expect(signOutBody).toEqual({
      refreshToken: 'push-signout-refresh-token',
      pushDeviceId: `rn-${'42'.repeat(16)}`,
    });
    expect(await client.push.hasCachedRegistration()).toBe(true);

    resolveSignOut(new Response(JSON.stringify({ ok: true, pushUnregistered: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await vi.waitFor(async () => {
      expect(await client.push.hasCachedRegistration()).toBe(false);
    });
    client.destroy();
  });

  it('signOut retains push cache and durable combined cleanup authority while offline', async () => {
    const storage = createMockStorage();
    const secureStorage = createMockStorage();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/push/register')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/api/auth/signout')) throw new Error('offline');
      throw new Error(`Unexpected request: ${url}`);
    });
    const client = createClient('https://api-signout-offline.example.com', {
      storage,
      secureStorage,
      secureRandom: async () => new Uint8Array(16).fill(0x43),
    });
    await client._tokenManager.ready();
    await client._tokenManager.setTokensPersisted({
      accessToken: makeValidJwt('push-signout-offline-user'),
      refreshToken: 'push-signout-offline-refresh',
    });
    client.push.setPermissionProvider({
      getPermissionStatus: async () => 'granted',
      requestPermission: async () => 'granted',
    });
    client.push.setTokenProvider(async () => ({ token: 'push-signout-offline-token', platform: 'android' }));
    await client.push.register();

    await client.auth.signOut();
    expect(client._tokenManager.currentAccessToken).toBeNull();
    expect(await client.push.hasCachedRegistration()).toBe(true);
    await vi.waitFor(async () => {
      expect(await client._tokenManager.getPendingSessionRevocations()).toEqual([
        expect.objectContaining({
          refreshToken: 'push-signout-offline-refresh',
          pushDeviceId: `rn-${'43'.repeat(16)}`,
        }),
      ]);
    });
    await vi.waitFor(() => {
      expect(fetchSpy.mock.calls.filter(([input]) => String(input).endsWith('/api/auth/signout')).length)
        .toBeGreaterThanOrEqual(1);
    });
    expect(await client.push.hasCachedRegistration()).toBe(true);
    client.destroy();
  });

  it('client._tokenManager 존재', () => {
    const client = createClient('http://localhost:8688', makeClientOptions());
    expect(client._tokenManager).toBeDefined();
    client.destroy();
  });

  it('client._httpClient 존재', () => {
    const client = createClient('http://localhost:8688', makeClientOptions());
    expect(client._httpClient).toBeDefined();
    client.destroy();
  });

  it('db() → DbRef 반환', () => {
    const client = createClient('http://localhost:8688', makeClientOptions());
    const dbRef = client.db('shared');
    expect(dbRef).toBeDefined();
    expect(typeof dbRef.table).toBe('function');
    client.destroy();
  });

  it('db("shared").table("posts") → TableRef 반환', () => {
    const client = createClient('http://localhost:8688', makeClientOptions());
    const tableRef = client.db('shared').table('posts');
    expect(tableRef).toBeDefined();
    expect(typeof tableRef.where).toBe('function');
    expect(typeof tableRef.orderBy).toBe('function');
    expect(typeof tableRef.limit).toBe('function');
    expect(typeof tableRef.getList).toBe('function');
    client.destroy();
  });

  it('db().table() → database-live filter matcher 연결', () => {
    const client = createClient('http://localhost:8688', makeClientOptions());
    const tableRef = client.db('shared').table('posts') as { filterMatchFn?: unknown };
    expect(typeof tableRef.filterMatchFn).toBe('function');
    client.destroy();
  });

  it('db().table() → DatabaseLiveClient 사용', () => {
    const client = createClient('http://localhost:8688', makeClientOptions());
    const tableRef = client.db('shared').table('posts') as { databaseLiveClient?: unknown };
    expect(tableRef.databaseLiveClient).toBeTruthy();
    expect((tableRef.databaseLiveClient as { constructor?: { name?: string } }).constructor?.name).toBe('DatabaseLiveClient');
    client.destroy();
  });

  it('db() with instanceId', () => {
    const client = createClient('http://localhost:8688', makeClientOptions());
    const dbRef = client.db('workspace', 'ws-123');
    expect(dbRef).toBeDefined();
    client.destroy();
  });

  it('room() → RoomClient 반환', () => {
    const client = createClient('http://localhost:8688', makeClientOptions());
    const room = client.room('default', 'test-room-1');
    expect(room).toBeDefined();
    expect(room.namespace).toBe('default');
    expect(room.roomId).toBe('test-room-1');
    client.destroy();
  });

  it('destroy() 에러 없음', () => {
    const client = createClient('http://localhost:8688', makeClientOptions());
    expect(() => client.destroy()).not.toThrow();
  });

  it('URL trailing slash 제거', () => {
    const client = createClient('http://localhost:8688/', makeClientOptions());
    expect(client._httpClient.getBaseUrl()).toBe('http://localhost:8688');
    client.destroy();
  });

  it('appState 옵션 → LifecycleManager 시작', () => {
    const mockAppState = {
      currentState: 'active',
      addEventListener: vi.fn().mockReturnValue({ remove: () => {} }),
    };
    const client = createClient('http://localhost:8688', {
      ...makeClientOptions(),
      appState: mockAppState,
    });
    expect(mockAppState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    client.destroy();
  });

  it('DatabaseLiveClient → /api/db/subscribe URL 생성', async () => {
    const { DatabaseLiveClient } = await import('../../src/database-live');
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const live = new DatabaseLiveClient('http://localhost:8688', tm) as { buildWsUrl: (channel: string) => string; disconnect: () => void };
    expect(live.buildWsUrl('dblive:shared:posts')).toBe(
      'ws://localhost:8688/api/db/subscribe?channel=dblive%3Ashared%3Aposts',
    );
    live.disconnect();
    tm.destroy();
  });

  it('DatabaseLiveClient auth failure는 세션이 없을 때만 waiting 상태로 남는다', async () => {
    const channel = 'dblive:shared:posts';

    const tmNoSession = new TokenManager('http://localhost:8688', createMockStorage());
    await tmNoSession.ready();
    const liveNoSession = new DatabaseLiveClient('http://localhost:8688', tmNoSession) as {
      connectedChannels: Set<string>;
      disconnect: () => void;
      handleAuthenticationFailure: (error: unknown) => void;
      scheduleReconnect: (channel: string) => void;
      waitingForAuth: boolean;
      ws: WebSocket | null;
    };
    liveNoSession.connectedChannels.add(channel);
    liveNoSession.ws = { close: vi.fn() } as unknown as WebSocket;
    const noSessionReconnect = vi.spyOn(liveNoSession, 'scheduleReconnect');
    liveNoSession.handleAuthenticationFailure(new EdgeBaseError(401, 'Auth failed'));
    expect(liveNoSession.waitingForAuth).toBe(true);
    expect(noSessionReconnect).not.toHaveBeenCalled();
    liveNoSession.disconnect();
    tmNoSession.destroy();

    const tmWithSession = new TokenManager('http://localhost:8688', createMockStorage());
    await tmWithSession.ready();
    const token = makeValidJwt('u-rn-db-live');
    await tmWithSession.setTokens({ accessToken: token, refreshToken: token });
    const liveWithSession = new DatabaseLiveClient('http://localhost:8688', tmWithSession) as {
      connectedChannels: Set<string>;
      disconnect: () => void;
      handleAuthenticationFailure: (error: unknown) => void;
      scheduleReconnect: (channel: string) => void;
      waitingForAuth: boolean;
      ws: WebSocket | null;
    };
    liveWithSession.connectedChannels.add(channel);
    liveWithSession.ws = { close: vi.fn() } as unknown as WebSocket;
    const withSessionReconnect = vi.spyOn(liveWithSession, 'scheduleReconnect');
    liveWithSession.handleAuthenticationFailure(new EdgeBaseError(401, 'Auth failed'));
    expect(liveWithSession.waitingForAuth).toBe(false);
    expect(withSessionReconnect).not.toHaveBeenCalled();
    liveWithSession.disconnect();
    tmWithSession.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PART I — TableRef immutable chaining (단위 테스트)
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN Core — TableRef immutable chaining', () => {

  function makeClient() {
    return createClient('http://localhost:8688', {
      storage: createMockStorage(),
      secureStorage: createMockStorage(),
    });
  }

  it('where → 새 TableRef 반환', () => {
    const client = makeClient();
    const ref1 = client.db('shared').table('posts');
    const ref2 = ref1.where('status', '==', 'published');
    expect(ref2).not.toBe(ref1);
    client.destroy();
  });

  it('orderBy → 새 TableRef 반환', () => {
    const client = makeClient();
    const ref1 = client.db('shared').table('posts');
    const ref2 = ref1.orderBy('createdAt', 'desc');
    expect(ref2).not.toBe(ref1);
    client.destroy();
  });

  it('limit → 새 TableRef 반환', () => {
    const client = makeClient();
    const ref1 = client.db('shared').table('posts');
    const ref2 = ref1.limit(10);
    expect(ref2).not.toBe(ref1);
    client.destroy();
  });

  it('offset → 새 TableRef 반환', () => {
    const client = makeClient();
    const ref1 = client.db('shared').table('posts');
    const ref2 = ref1.offset(5);
    expect(ref2).not.toBe(ref1);
    client.destroy();
  });

  it('page → 새 TableRef 반환', () => {
    const client = makeClient();
    const ref1 = client.db('shared').table('posts');
    const ref2 = ref1.page(2);
    expect(ref2).not.toBe(ref1);
    client.destroy();
  });

  it('search → 새 TableRef 반환', () => {
    const client = makeClient();
    const ref1 = client.db('shared').table('posts');
    const ref2 = ref1.search('hello');
    expect(ref2).not.toBe(ref1);
    client.destroy();
  });

  it('after → 새 TableRef 반환', () => {
    const client = makeClient();
    const ref1 = client.db('shared').table('posts');
    const ref2 = ref1.after('cursor-abc');
    expect(ref2).not.toBe(ref1);
    client.destroy();
  });

  it('before → 새 TableRef 반환', () => {
    const client = makeClient();
    const ref1 = client.db('shared').table('posts');
    const ref2 = ref1.before('cursor-xyz');
    expect(ref2).not.toBe(ref1);
    client.destroy();
  });

  it('체이닝 조합 → 새 TableRef 반환', () => {
    const client = makeClient();
    const ref = client.db('shared').table('posts')
      .where('status', '==', 'published')
      .orderBy('createdAt', 'desc')
      .limit(10);
    expect(ref).toBeDefined();
    expect(typeof ref.getList).toBe('function');
    client.destroy();
  });

  it('or() → 새 TableRef 반환', () => {
    const client = makeClient();
    const ref1 = client.db('shared').table('posts');
    const ref2 = ref1.or(q => q.where('status', '==', 'draft').where('status', '==', 'archived'));
    expect(ref2).not.toBe(ref1);
    client.destroy();
  });

  it('doc() → DocRef 반환', () => {
    const client = makeClient();
    const docRef = client.db('shared').table('posts').doc('post-123');
    expect(docRef).toBeDefined();
    expect(typeof docRef.get).toBe('function');
    expect(typeof docRef.update).toBe('function');
    expect(typeof docRef.delete).toBe('function');
    client.destroy();
  });
});

describe('RN matchesFilter — client-side filtering', () => {
  it('contains-any match', () => {
    expect(matchesFilter({ tags: ['draft', 'featured'] }, [['tags', 'contains-any', ['archived', 'featured']]])).toBe(true);
  });

  it('contains-any mismatch', () => {
    expect(matchesFilter({ tags: ['draft', 'featured'] }, [['tags', 'contains-any', ['archived', 'private']]])).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PART J — (removed: BroadcastChannel / PresenceChannel — replaced by RoomsDO)
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// PART K — Exports / Public API 검증
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN Public API — index exports', () => {

  it('createClient export', () => { expect(typeof api.createClient).toBe('function'); });
  it('ClientEdgeBase export', () => { expect(typeof api.ClientEdgeBase).toBe('function'); });
  it('ClientAnalytics export', () => { expect(typeof api.ClientAnalytics).toBe('function'); });
  it('TokenManager export', () => { expect(typeof api.TokenManager).toBe('function'); });
  it('AuthClient export', () => { expect(typeof api.AuthClient).toBe('function'); });
  it('DatabaseLiveClient export', () => { expect(typeof api.DatabaseLiveClient).toBe('function'); });
  it('RoomClient export', () => { expect(typeof api.RoomClient).toBe('function'); });
  it('PushClient export', () => { expect(typeof api.PushClient).toBe('function'); });
  it('LifecycleManager export', () => { expect(typeof api.LifecycleManager).toBe('function'); });
  it('isPlatformWeb export', () => { expect(typeof api.isPlatformWeb).toBe('function'); });
  it('TurnstileError export', () => {
    expect(new api.TurnstileError('config_fetch_failed', 'failed')).toMatchObject({
      name: 'TurnstileError',
      reason: 'config_fetch_failed',
    });
  });
});

describe('RN Client surface — functions / analytics / passkeys', () => {
  it('client exposes functions and analytics helpers', () => {
    const client = createClient('http://localhost:8688', {
      storage: createMockStorage(), secureStorage: createMockStorage(),
    });
    expect(typeof client.functions.get).toBe('function');
    expect(typeof client.functions.post).toBe('function');
    expect(typeof client.analytics.track).toBe('function');
    expect(typeof client.analytics.flush).toBe('function');
    client.destroy();
  });

  it('auth exposes passkeys REST methods', () => {
    const client = createClient('http://localhost:8688', {
      storage: createMockStorage(), secureStorage: createMockStorage(),
    });
    expect(typeof client.auth.passkeysRegisterOptions).toBe('function');
    expect(typeof client.auth.passkeysRegister).toBe('function');
    expect(typeof client.auth.passkeysAuthOptions).toBe('function');
    expect(typeof client.auth.passkeysAuthenticate).toBe('function');
    expect(typeof client.auth.passkeysList).toBe('function');
    expect(typeof client.auth.passkeysDelete).toBe('function');
    client.destroy();
  });
});
