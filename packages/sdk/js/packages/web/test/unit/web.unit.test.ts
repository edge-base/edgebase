/**
 * @edge-base/web — 단위 테스트
 *
 * 테스트 대상: src/token-manager.ts (TokenManager), src/match-filter.ts
 *
 * 실행: cd packages/sdk/js/packages/web && npx vitest run
 *
 * 원칙: 서버 불필요 — 순수 로직 (JWT decode, storage, auth state) 검증
 */

import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenManager } from '../../src/token-manager.js';

// ─── JWT Helper ───────────────────────────────────────────────────────────────

/** Create a fake JWT with given payload (for testing only) */
function encodeBase64UrlJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = encodeBase64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const body = encodeBase64UrlJson(payload);
  return `${header}.${body}.fakesig`;
}

function makeValidJwt(userId = 'u-123', extra: Record<string, unknown> = {}) {
  return makeJwt({
    sub: userId,
    email: 'test@example.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...extra,
  });
}

function makeExpiredJwt(userId = 'u-expired') {
  return makeJwt({
    sub: userId,
    email: 'expired@example.com',
    exp: Math.floor(Date.now() / 1000) - 3600,
  });
}

type MockMessageEvent = { data: unknown };

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  static messages: Array<{ name: string; data: unknown }> = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  private listeners = new Set<(event: MessageEvent) => void>();

  constructor(public name: string) {
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    MockBroadcastChannel.messages.push({ name: this.name, data });
    for (const instance of MockBroadcastChannel.instances) {
      if (instance === this || instance.name !== this.name) continue;
      const event = { data } as MockMessageEvent as MessageEvent;
      instance.onmessage?.(event);
      for (const listener of instance.listeners) listener(event);
    }
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (type === 'message') this.listeners.delete(listener);
  }

  close(): void {
    MockBroadcastChannel.instances = MockBroadcastChannel.instances.filter((instance) => instance !== this);
  }

  static reset(): void {
    MockBroadcastChannel.instances = [];
    MockBroadcastChannel.messages = [];
  }
}

function installBrowserMocks(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel as unknown as typeof BroadcastChannel);
}

function installInvalidBrowserStorageMocks(): void {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    localStorage: { broken: true },
  });
  vi.stubGlobal('localStorage', { broken: true });
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel as unknown as typeof BroadcastChannel);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  MockBroadcastChannel.reset();
});

// ─── A. TokenManager 초기 상태 ─────────────────────────────────────────────

describe('TokenManager — 초기 상태', () => {
  it('초기 getCurrentUser() === null', () => {
    const tm = new TokenManager('http://localhost:8688');
    expect(tm.getCurrentUser()).toBeNull();
    tm.destroy();
  });

  it('초기 getRefreshToken() === null', () => {
    const tm = new TokenManager('http://localhost:8688');
    expect(tm.getRefreshToken()).toBeNull();
    tm.destroy();
  });

  it('onAuthStateChange — 즉시 null로 호출', () => {
    const tm = new TokenManager('http://localhost:8688');
    const calls: (null | unknown)[] = [];
    const unsub = tm.onAuthStateChange((user) => calls.push(user));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeNull();
    unsub();
    tm.destroy();
  });

  it('invalid localStorage shape falls back to memory storage', () => {
    installInvalidBrowserStorageMocks();
    const tm = new TokenManager('http://localhost:8688');
    const token = makeValidJwt('u-fallback');
    expect(() => tm.setTokens({ accessToken: token, refreshToken: token })).not.toThrow();
    expect(tm.getRefreshToken()).toBe(token);
    tm.destroy();
  });
});

// ─── B. setTokens / clearTokens ─────────────────────────────────────────────

describe('TokenManager — setTokens', () => {
  it('setTokens → getCurrentUser().id 반영', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeValidJwt('user-42');
    const rt = makeValidJwt('user-42');
    tm.setTokens({ accessToken: at, refreshToken: rt });
    expect(tm.getCurrentUser()?.id).toBe('user-42');
    tm.destroy();
  });

  it('setTokens → getCurrentUser().email 반영', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeValidJwt('user-email', { email: 'hello@world.com' });
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.email).toBe('hello@world.com');
    tm.destroy();
  });

  it('setTokens → getRefreshToken() 반영', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeValidJwt('u-1');
    const rt = makeValidJwt('u-1');
    tm.setTokens({ accessToken: at, refreshToken: rt });
    expect(tm.getRefreshToken()).toBe(rt);
    tm.destroy();
  });

  it('setTokens → onAuthStateChange 호출', () => {
    const tm = new TokenManager('http://localhost:8688');
    const calls: unknown[] = [];
    const unsub = tm.onAuthStateChange((user) => calls.push(user));
    // initial call = 1
    const at = makeValidJwt('u-2');
    tm.setTokens({ accessToken: at, refreshToken: at });
    // should have been called again after setTokens
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect((calls[calls.length - 1] as { id: string })?.id).toBe('u-2');
    unsub();
    tm.destroy();
  });
});

describe('TokenManager — clearTokens', () => {
  it('clearTokens → getCurrentUser() === null', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeValidJwt('u-clear');
    tm.setTokens({ accessToken: at, refreshToken: at });
    tm.clearTokens();
    expect(tm.getCurrentUser()).toBeNull();
    tm.destroy();
  });

  it('clearTokens → getRefreshToken() === null', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeValidJwt('u-clear2');
    tm.setTokens({ accessToken: at, refreshToken: at });
    tm.clearTokens();
    expect(tm.getRefreshToken()).toBeNull();
    tm.destroy();
  });

  it('clearTokens → onAuthStateChange(null) 호출', () => {
    const tm = new TokenManager('http://localhost:8688');
    const calls: unknown[] = [];
    const at = makeValidJwt('u-clr');
    tm.setTokens({ accessToken: at, refreshToken: at });
    const unsub = tm.onAuthStateChange((user) => calls.push(user));
    tm.clearTokens();
    // Last call should be null
    expect(calls[calls.length - 1]).toBeNull();
    unsub();
    tm.destroy();
  });
});

describe('TokenManager — cross-tab sign-out', () => {
  it('clears peer tabs without rebroadcast loops', () => {
    installBrowserMocks();

    const accessToken = makeValidJwt('u-broadcast');
    const refreshToken = makeValidJwt('u-broadcast', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });

    const leader = new TokenManager('http://localhost:8688');
    const follower = new TokenManager('http://localhost:8688');

    leader.setTokens({ accessToken, refreshToken });
    follower.setTokens({ accessToken, refreshToken });

    leader.clearTokens();

    expect(follower.getCurrentUser()).toBeNull();
    const signedOutMessages = MockBroadcastChannel.messages.filter(
      (message) => (message.data as { type?: string })?.type === 'signed-out',
    );
    expect(signedOutMessages).toHaveLength(1);

    leader.destroy();
    follower.destroy();
  });

  it('fails waiting refresh requests immediately when another tab signs out', async () => {
    installBrowserMocks();

    const accessToken = makeExpiredJwt('u-broadcast');
    const refreshToken = makeValidJwt('u-broadcast', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });

    const leader = new TokenManager('http://localhost:8688');
    const follower = new TokenManager('http://localhost:8688');

    leader.setTokens({ accessToken, refreshToken });
    follower.setTokens({ accessToken, refreshToken });
    localStorage.setItem('edgebase:refresh-lock', Date.now().toString());

    const pending = follower.getAccessToken(async () => {
      throw new Error('follower should wait for another tab');
    });

    leader.clearTokens();

    await expect(pending).rejects.toMatchObject({ code: 401 });

    leader.destroy();
    follower.destroy();
  });
});

describe('TokenManager — invalidateAccessToken', () => {
  it('drops only the access token when a refresh token still exists', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeValidJwt('u-refresh');
    const rt = makeValidJwt('u-refresh', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });
    tm.setTokens({ accessToken: at, refreshToken: rt });

    tm.invalidateAccessToken();

    expect(tm.currentAccessToken).toBeNull();
    expect(tm.getRefreshToken()).toBe(rt);
    expect(tm.getCurrentUser()?.id).toBe('u-refresh');
    tm.destroy();
  });

  it('clears cached user state when no refresh token remains', () => {
    const tm = new TokenManager('http://localhost:8688');
    tm.setAccessToken(makeValidJwt('u-access-only'));

    tm.invalidateAccessToken();

    expect(tm.currentAccessToken).toBeNull();
    expect(tm.getCurrentUser()).toBeNull();
    tm.destroy();
  });
});

// ─── C. onAuthStateChange — unsubscribe ───────────────────────────────────────

describe('TokenManager — onAuthStateChange unsubscribe', () => {
  it('unsub 후 → 더 이상 호출 안 됨', () => {
    const tm = new TokenManager('http://localhost:8688');
    let count = 0;
    const unsub = tm.onAuthStateChange(() => count++);
    const before = count;
    unsub();
    tm.setTokens({ accessToken: makeValidJwt('u-notsub'), refreshToken: makeValidJwt('u-notsub') });
    expect(count).toBe(before); // no more calls after unsub
    tm.destroy();
  });

  it('여러 리스너 등록 가능', () => {
    const tm = new TokenManager('http://localhost:8688');
    let count1 = 0;
    let count2 = 0;
    const unsub1 = tm.onAuthStateChange(() => count1++);
    const unsub2 = tm.onAuthStateChange(() => count2++);
    expect(count1).toBe(1);
    expect(count2).toBe(1);
    unsub1();
    unsub2();
    tm.destroy();
  });
});

// ─── D. destroy ───────────────────────────────────────────────────────────────

describe('TokenManager — destroy', () => {
  it('destroy() 후 authStateListeners 비워짐 (에러 없음)', () => {
    const tm = new TokenManager('http://localhost:8688');
    tm.onAuthStateChange(() => {});
    expect(() => tm.destroy()).not.toThrow();
  });

  it('destroy() 여러번 호출 가능', () => {
    const tm = new TokenManager('http://localhost:8688');
    expect(() => {
      tm.destroy();
      tm.destroy();
    }).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Phase 2 additions below
// ═══════════════════════════════════════════════════════════════════════════════

import { AuthClient } from '../../src/auth.js';
import { RoomClient, type RoomOptions } from '../../src/room.js';
import { matchesFilter } from '../../src/match-filter.js';
import { ClientAnalytics } from '../../src/analytics.js';
import { refreshAccessToken } from '../../src/auth-refresh.js';
import { ApiPaths, HttpClient, ContextManager, EdgeBaseError } from '@edge-base/core';

// ─── E. TokenManager — expired token handling ────────────────────────────────

describe('TokenManager — expired token', () => {
  it('expired JWT → getCurrentUser still returns user (decode only, no verify)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeExpiredJwt('u-expired');
    tm.setTokens({ accessToken: at, refreshToken: at });
    // TokenManager decodes without verifying expiry for currentUser
    const user = tm.getCurrentUser();
    expect(user?.id).toBe('u-expired');
    tm.destroy();
  });

  it('setTokens with expired token fires onAuthStateChange', () => {
    const tm = new TokenManager('http://localhost:8688');
    const calls: unknown[] = [];
    const unsub = tm.onAuthStateChange((u) => calls.push(u));
    const at = makeExpiredJwt('u-exp2');
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    unsub();
    tm.destroy();
  });
});

// ─── F. TokenManager — token properties ──────────────────────────────────────

describe('TokenManager — token properties', () => {
  it('displayName from JWT payload', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeJwt({
      sub: 'u-dn',
      email: 'a@b.com',
      displayName: 'Alice',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.displayName).toBe('Alice');
    tm.destroy();
  });

  it('UTF-8 displayName from JWT payload', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeJwt({
      sub: 'u-ko',
      email: 'ko@example.com',
      displayName: '준강',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.displayName).toBe('준강');
    tm.destroy();
  });

  it('isAnonymous from JWT payload', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeJwt({
      sub: 'u-anon',
      isAnonymous: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.isAnonymous).toBe(true);
    tm.destroy();
  });

  it('role from JWT payload', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeJwt({
      sub: 'u-role',
      role: 'admin',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.role).toBe('admin');
    tm.destroy();
  });

  it('custom claims from JWT payload', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeJwt({
      sub: 'u-custom',
      custom: { tier: 'premium' },
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.custom?.tier).toBe('premium');
    tm.destroy();
  });

  it('overwriting tokens replaces user', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at1 = makeValidJwt('u-first');
    tm.setTokens({ accessToken: at1, refreshToken: at1 });
    expect(tm.getCurrentUser()?.id).toBe('u-first');

    const at2 = makeValidJwt('u-second');
    tm.setTokens({ accessToken: at2, refreshToken: at2 });
    expect(tm.getCurrentUser()?.id).toBe('u-second');
    tm.destroy();
  });
});

// ─── G. TokenManager — multiple listeners ────────────────────────────────────

describe('TokenManager — multiple listeners', () => {
  it('each listener receives its own initial call', () => {
    const tm = new TokenManager('http://localhost:8688');
    const calls1: unknown[] = [];
    const calls2: unknown[] = [];
    const unsub1 = tm.onAuthStateChange((u) => calls1.push(u));
    const unsub2 = tm.onAuthStateChange((u) => calls2.push(u));
    expect(calls1).toHaveLength(1);
    expect(calls2).toHaveLength(1);
    unsub1();
    unsub2();
    tm.destroy();
  });

  it('setTokens notifies all active listeners', () => {
    const tm = new TokenManager('http://localhost:8688');
    let count1 = 0;
    let count2 = 0;
    const unsub1 = tm.onAuthStateChange(() => count1++);
    const unsub2 = tm.onAuthStateChange(() => count2++);
    const at = makeValidJwt('u-multi');
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(count1).toBeGreaterThanOrEqual(2);
    expect(count2).toBeGreaterThanOrEqual(2);
    unsub1();
    unsub2();
    tm.destroy();
  });

  it('unsubscribing one does not affect the other', () => {
    const tm = new TokenManager('http://localhost:8688');
    let count1 = 0;
    let count2 = 0;
    const unsub1 = tm.onAuthStateChange(() => count1++);
    const unsub2 = tm.onAuthStateChange(() => count2++);
    unsub1();
    const at = makeValidJwt('u-partial');
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(count1).toBe(1); // only initial
    expect(count2).toBeGreaterThanOrEqual(2); // initial + setTokens
    unsub2();
    tm.destroy();
  });
});

// ─── H. AuthClient — method existence ────────────────────────────────────────

describe('AuthClient — method signatures', () => {
  it('signUp is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.signUp).toBe('function');
    tm.destroy();
  });

  it('signIn is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.signIn).toBe('function');
    tm.destroy();
  });

  it('signOut is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.signOut).toBe('function');
    tm.destroy();
  });

  it('signInAnonymously is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.signInAnonymously).toBe('function');
    tm.destroy();
  });

  it('listSessions is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.listSessions).toBe('function');
    tm.destroy();
  });

  it('revokeSession is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.revokeSession).toBe('function');
    tm.destroy();
  });

  it('updateProfile is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.updateProfile).toBe('function');
    tm.destroy();
  });

  it('verifyEmail is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.verifyEmail).toBe('function');
    tm.destroy();
  });

  it('changePassword is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.changePassword).toBe('function');
    tm.destroy();
  });

  it('onAuthStateChange is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.onAuthStateChange).toBe('function');
    tm.destroy();
  });

  it('currentUser is null initially', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(auth.currentUser).toBeNull();
    tm.destroy();
  });

  it('signInWithOAuth is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.signInWithOAuth).toBe('function');
    tm.destroy();
  });

  it('linkWithEmail is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.linkWithEmail).toBe('function');
    tm.destroy();
  });

  it('requestPasswordReset is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.requestPasswordReset).toBe('function');
    tm.destroy();
  });

  it('resetPassword is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.resetPassword).toBe('function');
    tm.destroy();
  });
});

describe('AuthClient — OAuth flow helpers', () => {
  it('signInWithOAuth adds redirect_url and uses the browser callback route by default', () => {
    const store = new Map<string, string>();
    const location = {
      href: 'http://localhost:4173/login',
      origin: 'http://localhost:4173',
    };
    vi.stubGlobal('window', {
      location,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });

    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm, {} as any, {} as any);

    const result = auth.signInWithOAuth('google');

    expect(result.url).toBe(
      'http://localhost:8688/api/auth/oauth/google?redirect_url=http%3A%2F%2Flocalhost%3A4173%2Fauth%2Fcallback',
    );
    expect(location.href).toBe(result.url);
    tm.destroy();
  });

  it('signInWithOAuth supports redirectUrl and captchaToken together', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm, {} as any, {} as any);

    const result = auth.signInWithOAuth('google', {
      redirectUrl: 'http://localhost:4173/custom-callback',
      captchaToken: 'captcha-token-123',
    });

    const url = new URL(result.url);
    expect(url.pathname).toBe('/api/auth/oauth/google');
    expect(url.searchParams.get('captcha_token')).toBe('captcha-token-123');
    expect(url.searchParams.get('redirect_url')).toBe('http://localhost:4173/custom-callback');
    tm.destroy();
  });

  it('signInWithOAuth supports redirectTo alias and can skip browser navigation', () => {
    const location = {
      href: 'http://localhost:4173/login',
      origin: 'http://localhost:4173',
    };
    vi.stubGlobal('window', {
      location,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm, {} as any, {} as any);

    const result = auth.signInWithOAuth('github', {
      redirectTo: 'http://localhost:4173/custom-callback',
      navigate: false,
    });

    expect(result.url).toBe(
      'http://localhost:8688/api/auth/oauth/github?redirect_url=http%3A%2F%2Flocalhost%3A4173%2Fcustom-callback',
    );
    expect(location.href).toBe('http://localhost:4173/login');
    tm.destroy();
  });

  it('signInWithPhone forwards explicit captchaToken', async () => {
    const corePublic = {
      authSigninPhone: vi.fn().mockResolvedValue({}),
    };
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm, {} as any, corePublic as any);

    await auth.signInWithPhone({
      phone: '+821012345678',
      captchaToken: 'captcha-token-123',
    });

    expect(corePublic.authSigninPhone).toHaveBeenCalledWith({
      phone: '+821012345678',
      captchaToken: 'captcha-token-123',
    });
    tm.destroy();
  });

  it('handleOAuthCallback persists tokens and scrubs callback params from browser URL', async () => {
    const accessToken = makeValidJwt('oauth-user', { displayName: 'OAuth User' });
    const refreshToken = makeValidJwt('oauth-user', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });
    const replaceState = vi.fn();
    const store = new Map<string, string>();

    vi.stubGlobal('window', {
      location: {
        href: `http://localhost:4173/auth/callback?access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}`,
        origin: 'http://localhost:4173',
      },
      history: { replaceState },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    vi.stubGlobal('document', { title: 'OAuth Callback Test' });

    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm, {} as any, {} as any);

    const result = await auth.handleOAuthCallback();

    expect(result?.accessToken).toBe(accessToken);
    expect(result?.refreshToken).toBe(refreshToken);
    expect(result?.user.id).toBe('oauth-user');
    expect(auth.currentUser?.id).toBe('oauth-user');
    expect(auth.currentUser?.displayName).toBe('OAuth User');
    expect(tm.getRefreshToken()).toBe(refreshToken);
    expect(replaceState).toHaveBeenCalledWith({}, 'OAuth Callback Test', '/auth/callback');
    tm.destroy();
  });
});

describe('AuthClient — profile state sync', () => {
  it('updateProfile applies accessToken-only responses and keeps UTF-8 display names', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const initialToken = makeValidJwt('u-profile', { email: 'profile@test.com' });
    tm.setTokens({ accessToken: initialToken, refreshToken: initialToken });

    const updatedToken = makeJwt({
      sub: 'u-profile',
      email: 'profile@test.com',
      displayName: '준강',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const core = {
      authUpdateProfile: vi.fn().mockResolvedValue({
        user: {
          id: 'u-profile',
          email: 'profile@test.com',
          displayName: '준강',
          avatarUrl: 'https://example.com/avatar.png',
          emailVisibility: 'private',
        },
        accessToken: updatedToken,
      }),
    };
    const auth = new AuthClient(http, tm, core as any, {} as any);

    const user = await auth.updateProfile({ displayName: '준강' });

    expect(core.authUpdateProfile).toHaveBeenCalledWith({ displayName: '준강' });
    expect(user.displayName).toBe('준강');
    expect(user.avatarUrl).toBe('https://example.com/avatar.png');
    expect(auth.currentUser?.displayName).toBe('준강');
    expect(auth.currentUser?.avatarUrl).toBe('https://example.com/avatar.png');
    tm.destroy();
  });

  it('updateProfile applies user-only responses for non-token fields', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const initialToken = makeValidJwt('u-avatar', { email: 'avatar@test.com', displayName: 'Avatar User' });
    tm.setTokens({ accessToken: initialToken, refreshToken: initialToken });

    const core = {
      authUpdateProfile: vi.fn().mockResolvedValue({
        user: {
          id: 'u-avatar',
          email: 'avatar@test.com',
          displayName: 'Avatar User',
          avatarUrl: 'https://example.com/fresh-avatar.png',
        },
      }),
    };
    const auth = new AuthClient(http, tm, core as any, {} as any);

    const user = await auth.updateProfile({ avatarUrl: 'https://example.com/fresh-avatar.png' });

    expect(user.avatarUrl).toBe('https://example.com/fresh-avatar.png');
    expect(auth.currentUser?.avatarUrl).toBe('https://example.com/fresh-avatar.png');
    tm.destroy();
  });
});

// ─── J. RoomClient — construction & properties ──────────────────────────────

function createConnectedRoom(roomId = 'room-1') {
  const tm = new TokenManager('http://localhost:8688');
  tm.setTokens({
    accessToken: makeValidJwt(`room-${roomId}`),
    refreshToken: makeValidJwt(`room-${roomId}`),
  });
  const room = new RoomClient('http://localhost:8688', 'default', roomId, tm);
  const send = vi.fn();
  const close = vi.fn();

  (room as any).ws = { send, close, readyState: 1 } as WebSocket;
  (room as any).connected = true;
  (room as any).authenticated = true;

  return { room, tm, send, close };
}

describe('RoomClient — construction', () => {
  it('creation with roomId', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'test-room', tm);
    expect(room.roomId).toBe('test-room');
    tm.destroy();
  });

  it('initial shared state is empty object (v2: getSharedState)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    expect(room.getSharedState()).toEqual({});
    tm.destroy();
  });

  it('initial player state is empty object (v2: getPlayerState)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    expect(room.getPlayerState()).toEqual({});
    tm.destroy();
  });

  it('namespace is stored (v2: namespace + roomId identification)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'game', 'room-1', tm);
    expect(room.namespace).toBe('game');
    tm.destroy();
  });

  it('getSharedState returns a snapshot (not a reference)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    const s1 = room.getSharedState();
    const s2 = room.getSharedState();
    expect(s1).toEqual(s2);
    expect(s1).not.toBe(s2); // different object references
    tm.destroy();
  });

  it('getPlayerState returns a snapshot (not a reference)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    const p1 = room.getPlayerState();
    const p2 = room.getPlayerState();
    expect(p1).toEqual(p2);
    expect(p1).not.toBe(p2); // different object references
    tm.destroy();
  });

  it('reconnects a pending join after auth arrives later', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    const establishConnection = vi.fn().mockResolvedValue(undefined);

    (room as any).joinRequested = true;
    (room as any).establishConnection = establishConnection;

    tm.setTokens({
      accessToken: makeValidJwt('room-user'),
      refreshToken: makeValidJwt('room-user'),
    });

    await Promise.resolve();

    expect(establishConnection).toHaveBeenCalledTimes(1);
    tm.destroy();
  });

  it('reuses an in-flight room join when join() is called twice', async () => {
    const tm = new TokenManager('http://localhost:8688');
    tm.setTokens({
      accessToken: makeValidJwt('room-flight'),
      refreshToken: makeValidJwt('room-flight'),
    });
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
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

  it('does not start a second room connection while a socket is already connecting', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    const establishConnection = vi.fn().mockResolvedValue(undefined);

    (room as any).joinRequested = true;
    (room as any).ws = { readyState: 0 } as WebSocket;
    (room as any).establishConnection = establishConnection;

    tm.setTokens({
      accessToken: makeValidJwt('room-connecting'),
      refreshToken: makeValidJwt('room-connecting'),
    });

    await Promise.resolve();

    expect(establishConnection).not.toHaveBeenCalled();
    tm.destroy();
  });

  it('refreshes the access token before room auth when only a refresh token is cached', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    const nextAccessToken = makeValidJwt('room-refresh-user');
    const nextRefreshToken = makeValidJwt('room-refresh-user', { exp: Math.floor(Date.now() / 1000) + 7200 });
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

    tm.setTokens({
      accessToken: makeValidJwt('room-refresh-user'),
      refreshToken: makeValidJwt('room-refresh-user', { exp: Math.floor(Date.now() / 1000) + 7200 }),
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

  it('handles auth success that arrives in the same tick as the auth send', async () => {
    const tm = new TokenManager('http://localhost:8688');
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

    tm.setTokens({
      accessToken: makeValidJwt('room-race-user'),
      refreshToken: makeValidJwt('room-race-user'),
    });
    (room as any).ws = ws;
    (room as any).connected = true;

    await (room as any).authenticate();

    expect(originalOnMessage).not.toHaveBeenCalled();
    expect((room as any).authenticated).toBe(true);
    expect((room as any).joined).toBe(true);
    tm.destroy();
  });

  it('onSharedState emits fresh snapshots after shared deltas', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    const handler = vi.fn();

    room.onSharedState(handler);

    (room as any).handleMessage(
      JSON.stringify({
        type: 'sync',
        sharedState: { readyCount: 0 },
        sharedVersion: 1,
        playerState: {},
        playerVersion: 0,
      }),
    );
    (room as any).handleMessage(
      JSON.stringify({
        type: 'shared_delta',
        delta: { readyCount: 1 },
        version: 2,
      }),
    );

    const firstState = handler.mock.calls[0]?.[0];
    const secondState = handler.mock.calls[1]?.[0];

    expect(firstState).toEqual({ readyCount: 0 });
    expect(secondState).toEqual({ readyCount: 1 });
    expect(secondState).not.toBe(firstState);
    tm.destroy();
  });

  it('onPlayerState emits fresh snapshots after player deltas', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    const handler = vi.fn();

    room.onPlayerState(handler);

    (room as any).handleMessage(
      JSON.stringify({
        type: 'sync',
        sharedState: {},
        sharedVersion: 0,
        playerState: { ready: false },
        playerVersion: 1,
      }),
    );
    (room as any).handleMessage(
      JSON.stringify({
        type: 'player_delta',
        delta: { ready: true },
        version: 2,
      }),
    );

    const firstState = handler.mock.calls[0]?.[0];
    const secondState = handler.mock.calls[1]?.[0];

    expect(firstState).toEqual({ ready: false });
    expect(secondState).toEqual({ ready: true });
    expect(secondState).not.toBe(firstState);
    tm.destroy();
  });
});

describe('RoomClient — method signatures', () => {
  it('join is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.join).toBe('function');
    tm.destroy();
  });

  it('leave is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.leave).toBe('function');
    tm.destroy();
  });

  it('leave closes the socket with the explicit room leave code', () => {
    vi.useFakeTimers();
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    const send = vi.fn();
    const close = vi.fn();

    (room as any).ws = { close, send };
    (room as any).connected = true;
    room.leave();

    expect(send).toHaveBeenCalledWith(JSON.stringify({ type: 'leave' }));
    expect(close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40);
    expect(close).toHaveBeenCalledWith(4005, 'Client left room');
    tm.destroy();
    vi.useRealTimers();
  });

  it('send is a function (v2: replaces setState/patchState/sendAction)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.send).toBe('function');
    tm.destroy();
  });

  it('getSharedState is a function (v2: read-only state accessor)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.getSharedState).toBe('function');
    tm.destroy();
  });

  it('getPlayerState is a function (v2: per-player state accessor)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.getPlayerState).toBe('function');
    tm.destroy();
  });

  it('onSharedState is a function (v2: replaces onSync)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.onSharedState).toBe('function');
    tm.destroy();
  });

  it('onPlayerState is a function (v2: replaces onDelta)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.onPlayerState).toBe('function');
    tm.destroy();
  });

  it('onMessage is a function (v2: replaces onEvent, type-specific)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.onMessage).toBe('function');
    tm.destroy();
  });

  it('onAnyMessage is a function (v2: all messages regardless of type)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.onAnyMessage).toBe('function');
    tm.destroy();
  });

  it('onError is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.onError).toBe('function');
    tm.destroy();
  });

  it('onKicked is a function (v2: replaces onWarning)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.onKicked).toBe('function');
    tm.destroy();
  });

  it('getMetadata is a function (v2: HTTP metadata without joining)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.getMetadata).toBe('function');
    expect(typeof room.getSummary).toBe('function');
    expect(typeof room.checkConnection).toBe('function');
    tm.destroy();
  });
});

describe('RoomClient — rooms adapter APIs', () => {
  it('state/meta wrappers delegate to the underlying room methods', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'adapter-room', tm);
    const sendSpy = vi.spyOn(room, 'send').mockResolvedValue({ ok: true });
    const metadataSpy = vi.spyOn(room, 'getMetadata').mockResolvedValue({ stage: 'lobby' });
    const summarySpy = vi.spyOn(room, 'getSummary').mockResolvedValue({
      namespace: 'default',
      roomId: 'adapter-room',
      metadata: { stage: 'lobby' },
      occupancy: { activeMembers: 2, activeConnections: 3 },
      updatedAt: '2026-03-27T00:00:00.000Z',
    });

    (room as any)._sharedState = { score: 1 };
    (room as any)._playerState = { ready: true };

    expect(room.state.getShared()).toEqual({ score: 1 });
    expect(room.state.getMine()).toEqual({ ready: true });
    await expect(room.state.send('SET_READY', { ready: true })).resolves.toEqual({ ok: true });
    await expect(room.meta.get()).resolves.toEqual({ stage: 'lobby' });
    await expect(room.meta.summary()).resolves.toEqual({
      namespace: 'default',
      roomId: 'adapter-room',
      metadata: { stage: 'lobby' },
      occupancy: { activeMembers: 2, activeConnections: 3 },
      updatedAt: '2026-03-27T00:00:00.000Z',
    });

    expect(sendSpy).toHaveBeenCalledWith('SET_READY', { ready: true });
    expect(metadataSpy).toHaveBeenCalledTimes(1);
    expect(summarySpy).toHaveBeenCalledTimes(1);
    tm.destroy();
  });

  it('room summary and connect-check helpers call the expected public endpoints', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'adapter-room', tm);
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          namespace: 'default',
          roomId: 'adapter-room',
          metadata: { stage: 'lobby' },
          occupancy: { activeMembers: 2, activeConnections: 3 },
          updatedAt: '2026-03-27T00:00:00.000Z',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          ok: true,
          type: 'room_connect_ready',
          category: 'ready',
          message: 'Room WebSocket preflight passed',
          namespace: 'default',
          roomId: 'adapter-room',
          runtime: 'rooms',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await expect(room.getSummary()).resolves.toEqual({
      namespace: 'default',
      roomId: 'adapter-room',
      metadata: { stage: 'lobby' },
      occupancy: { activeMembers: 2, activeConnections: 3 },
      updatedAt: '2026-03-27T00:00:00.000Z',
    });
    await expect(room.checkConnection()).resolves.toEqual({
      ok: true,
      type: 'room_connect_ready',
      category: 'ready',
      message: 'Room WebSocket preflight passed',
      namespace: 'default',
      roomId: 'adapter-room',
      runtime: 'rooms',
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8688/api/room/summary?namespace=default&id=adapter-room',
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8688/api/room/connect-check?namespace=default&id=adapter-room',
    );
    tm.destroy();
  });

  it('room summary network failures explain which server was unreachable', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'adapter-room', tm);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8688'));

    await expect(room.getSummary()).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('Failed to get room summary. Could not reach http://localhost:8688.'),
    });
    tm.destroy();
  });

  it('batch room summary helpers call the expected public endpoint', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        namespace: 'default',
        items: [
          {
            namespace: 'default',
            roomId: 'room-1',
            metadata: { stage: 'lobby' },
            occupancy: { activeMembers: 2, activeConnections: 3 },
            updatedAt: '2026-03-27T00:00:00.000Z',
          },
        ],
        deniedIds: ['room-2'],
        updatedAt: '2026-03-27T00:00:00.000Z',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(client.getRoomSummaries('default', ['room-1', 'room-2'])).resolves.toEqual({
      namespace: 'default',
      items: [
        {
          namespace: 'default',
          roomId: 'room-1',
          metadata: { stage: 'lobby' },
          occupancy: { activeMembers: 2, activeConnections: 3 },
          updatedAt: '2026-03-27T00:00:00.000Z',
        },
      ],
      deniedIds: ['room-2'],
      updatedAt: '2026-03-27T00:00:00.000Z',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8688/api/room/summaries',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace: 'default', ids: ['room-1', 'room-2'] }),
      },
    );
    client.destroy();
  });

  it('connect-check reports incompatible payloads clearly', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'adapter-room', tm);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(room.checkConnection()).rejects.toMatchObject({
      status: 200,
      message: expect.stringContaining('may be out of sync'),
    });
    tm.destroy();
  });

  it('room media requests without a signed-in session explain how to recover', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'adapter-room', tm);

    await expect(room.media.realtime.iceServers()).rejects.toMatchObject({
      status: 401,
      message: 'Authentication required before calling room media APIs. Sign in and join the room first.',
    });
    tm.destroy();
  });

  it('media.checkReadiness delegates to the selected transport capabilities', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'adapter-room', tm);
    const getCapabilities = vi.fn(async () => ({
      provider: 'p2p',
      canConnect: true,
      issues: [],
      room: {
        ok: true,
        type: 'room_connect_ready',
        category: 'ready',
        message: 'Room WebSocket preflight passed',
      },
      joined: true,
      currentMemberId: 'member-1',
      sessionId: null,
      browser: {
        mediaDevices: true,
        getUserMedia: true,
        getDisplayMedia: true,
        enumerateDevices: false,
        rtcPeerConnection: true,
      },
      turn: {
        requested: true,
        available: true,
        iceServerCount: 2,
      },
    }));
    const transportSpy = vi.spyOn(room.media, 'transport').mockReturnValue({
      connect: vi.fn(),
      getCapabilities,
      enableAudio: vi.fn(),
      enableVideo: vi.fn(),
      startScreenShare: vi.fn(),
      disableAudio: vi.fn(),
      disableVideo: vi.fn(),
      stopScreenShare: vi.fn(),
      setMuted: vi.fn(),
      switchDevices: vi.fn(),
      onRemoteTrack: vi.fn(),
      getSessionId: vi.fn(() => null),
      getPeerConnection: vi.fn(() => null),
      destroy: vi.fn(),
    } as any);

    await expect(room.media.checkReadiness({ provider: 'p2p' })).resolves.toMatchObject({
      provider: 'p2p',
      canConnect: true,
      currentMemberId: 'member-1',
    });

    expect(transportSpy).toHaveBeenCalledWith({ provider: 'p2p' });
    expect(getCapabilities).toHaveBeenCalledTimes(1);
    tm.destroy();
  });

  it('signals adapters send frames and fan out inbound signal events', async () => {
    const { room, tm, send } = createConnectedRoom('signals-room');
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
      event: 'chat.announce',
      requestId: outbound.requestId,
    }));
    await sendPromise;

    const directPromise = room.signals.sendTo('member-2', 'chat.direct', { body: 'private' });
    const directOutbound = JSON.parse(send.mock.calls[1][0]) as Record<string, unknown>;
    expect(directOutbound).toMatchObject({
      type: 'signal',
      event: 'chat.direct',
      payload: { body: 'private' },
      memberId: 'member-2',
      includeSelf: false,
    });

    (room as any).handleMessage(JSON.stringify({
      type: 'signal_sent',
      event: 'chat.direct',
      requestId: directOutbound.requestId,
    }));
    await directPromise;
    tm.destroy();
  });

  it('treats generic NOT_AUTHENTICATED signal failures as auth loss and forces reconnect recovery', async () => {
    const { room, tm, send, close } = createConnectedRoom('signals-auth-loss');
    const states: string[] = [];
    room.session.onConnectionStateChange((state) => states.push(state));

    const sendPromise = room.signals.send('chat.announce', { body: 'broadcast' });
    const outbound = JSON.parse(send.mock.calls[0][0]) as Record<string, unknown>;
    expect(outbound.type).toBe('signal');

    (room as any).handleMessage(JSON.stringify({
      type: 'error',
      code: 'NOT_AUTHENTICATED',
      message: 'Authenticate first',
    }));

    await expect(sendPromise).rejects.toMatchObject({
      code: 401,
      message: 'Room authentication lost: Authenticate first',
    });
    expect(close).toHaveBeenCalledWith(4006, 'Room authentication lost: Authenticate first');
    expect(states).toContain('auth_lost');
    tm.destroy();
  });

  it('members adapters track sync/join/leave/state events with snapshot semantics', async () => {
    const { room, tm, send } = createConnectedRoom('members-room');
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
      expect.objectContaining({
        memberId: 'member-1',
        state: { ready: true },
      }),
    ]);

    const listed = room.members.list();
    listed[0]!.state.ready = false;
    expect(room.members.list()).toEqual([
      expect.objectContaining({
        memberId: 'member-1',
        state: { ready: true },
      }),
    ]);

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

    const setStatePromise = room.members.setState({ ready: false });
    const stateOutbound = JSON.parse(send.mock.calls[0][0]) as Record<string, unknown>;
    expect(stateOutbound).toMatchObject({
      type: 'member_state',
      state: { ready: false },
    });

    (room as any).handleMessage(JSON.stringify({
      type: 'member_state',
      requestId: stateOutbound.requestId,
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

    const clearPromise = room.members.clearState();
    const clearOutbound = JSON.parse(send.mock.calls[1][0]) as Record<string, unknown>;
    expect(clearOutbound).toMatchObject({ type: 'member_state_clear' });

    (room as any).handleMessage(JSON.stringify({
      type: 'member_state',
      requestId: clearOutbound.requestId,
      member: {
        memberId: 'member-1',
        userId: 'member-1',
        connectionId: 'conn-1',
        connectionCount: 1,
        state: {},
      },
      state: {},
    }));
    await clearPromise;

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
    expect(room.members.list()).toEqual([
      expect.objectContaining({ memberId: 'member-1', state: {} }),
    ]);
    tm.destroy();
  });

  it('tracks providerSessionId on inbound media frames', () => {
    const { room, tm } = createConnectedRoom('media-provider-room');

    (room as any).handleMessage(JSON.stringify({
      type: 'members_sync',
      members: [
        {
          memberId: 'member-2',
          userId: 'member-2',
          connectionId: 'conn-2',
          connectionCount: 1,
          state: {},
        },
      ],
    }));

    (room as any).handleMessage(JSON.stringify({
      type: 'media_track',
      member: {
        memberId: 'member-2',
        userId: 'member-2',
        connectionId: 'conn-2',
      },
      track: {
        kind: 'audio',
        trackId: 'mic-track',
        providerSessionId: 'cf-session-1',
        muted: false,
      },
    }));

    expect(room.media.list()).toEqual([
      expect.objectContaining({
        tracks: [
          expect.objectContaining({
            kind: 'audio',
            trackId: 'mic-track',
            providerSessionId: 'cf-session-1',
          }),
        ],
      }),
    ]);
    tm.destroy();
  });

  it('admin adapters send operations and resolve on admin_result', async () => {
    const { room, tm, send } = createConnectedRoom('admin-room');

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

    const disableVideoPromise = room.admin.disableVideo('member-2');
    const disableVideoOutbound = JSON.parse(send.mock.calls[1][0]) as Record<string, unknown>;
    expect(disableVideoOutbound).toMatchObject({
      type: 'admin',
      operation: 'disableVideo',
      memberId: 'member-2',
    });

    (room as any).handleMessage(JSON.stringify({
      type: 'admin_result',
      requestId: disableVideoOutbound.requestId,
    }));
    await disableVideoPromise;

    const stopScreenPromise = room.admin.stopScreenShare('member-2');
    const stopScreenOutbound = JSON.parse(send.mock.calls[2][0]) as Record<string, unknown>;
    expect(stopScreenOutbound).toMatchObject({
      type: 'admin',
      operation: 'stopScreenShare',
      memberId: 'member-2',
    });

    (room as any).handleMessage(JSON.stringify({
      type: 'admin_result',
      requestId: stopScreenOutbound.requestId,
    }));
    await stopScreenPromise;
    tm.destroy();
  });

  it('media adapters track media sync and control-plane events', async () => {
    const { room, tm, send } = createConnectedRoom('media-room');
    const trackHandler = vi.fn();
    const removedHandler = vi.fn();
    const stateHandler = vi.fn();
    const deviceHandler = vi.fn();

    room.media.onTrack(trackHandler);
    room.media.onTrackRemoved(removedHandler);
    room.media.onStateChange(stateHandler);
    room.media.onDeviceChange(deviceHandler);

    (room as any).handleMessage(JSON.stringify({
      type: 'media_sync',
      members: [
        {
          member: {
            memberId: 'member-2',
            userId: 'member-2',
            connectionId: 'conn-2',
            connectionCount: 1,
            role: 'host',
            state: { ready: true },
          },
          state: {
            audio: {
              published: true,
              muted: false,
              trackId: 'audio-1',
              deviceId: 'mic-1',
            },
          },
          tracks: [
            {
              kind: 'audio',
              trackId: 'audio-1',
              deviceId: 'mic-1',
              muted: false,
            },
          ],
        },
      ],
    }));
    expect(room.media.list()).toEqual([
      expect.objectContaining({
        member: expect.objectContaining({ memberId: 'member-2' }),
        tracks: [expect.objectContaining({ kind: 'audio', trackId: 'audio-1' })],
      }),
    ]);

    const listed = room.media.list();
    listed[0]!.tracks[0]!.trackId = 'mutated';
    expect(room.media.list()[0]!.tracks[0]!.trackId).toBe('audio-1');

    const enablePromise = room.media.audio.enable({ deviceId: 'mic-1' });
    const publishOutbound = JSON.parse(send.mock.calls[0][0]) as Record<string, unknown>;
    expect(publishOutbound).toMatchObject({
      type: 'media',
      operation: 'publish',
      kind: 'audio',
      payload: { deviceId: 'mic-1' },
    });
    (room as any).handleMessage(JSON.stringify({
      type: 'media_result',
      requestId: publishOutbound.requestId,
    }));
    await enablePromise;

    const switchPromise = room.media.devices.switch({ audioInputId: 'mic-2' });
    const switchOutbound = JSON.parse(send.mock.calls[1][0]) as Record<string, unknown>;
    expect(switchOutbound).toMatchObject({
      type: 'media',
      operation: 'device',
      kind: 'audio',
      payload: { deviceId: 'mic-2' },
    });
    (room as any).handleMessage(JSON.stringify({
      type: 'media_result',
      requestId: switchOutbound.requestId,
    }));
    await switchPromise;

    (room as any).handleMessage(JSON.stringify({
      type: 'media_track',
      member: {
        memberId: 'member-2',
        userId: 'member-2',
        connectionId: 'conn-2',
        connectionCount: 1,
        role: 'host',
        state: { ready: true },
      },
      track: {
        kind: 'video',
        trackId: 'video-1',
        deviceId: 'cam-1',
        muted: false,
        publishedAt: 99,
      },
    }));
    expect(trackHandler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'video', trackId: 'video-1' }),
      expect.objectContaining({ memberId: 'member-2' }),
    );

    (room as any).handleMessage(JSON.stringify({
      type: 'media_state',
      member: {
        memberId: 'member-2',
        userId: 'member-2',
        connectionId: 'conn-2',
        connectionCount: 1,
        role: 'host',
        state: { ready: true },
      },
      state: {
        video: {
          published: true,
          muted: true,
          trackId: 'video-1',
          deviceId: 'cam-1',
        },
      },
    }));
    expect(stateHandler).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'member-2' }),
      expect.objectContaining({
        video: expect.objectContaining({ muted: true }),
      }),
    );

    (room as any).handleMessage(JSON.stringify({
      type: 'media_device',
      member: {
        memberId: 'member-2',
        userId: 'member-2',
        connectionId: 'conn-2',
        connectionCount: 1,
        role: 'host',
        state: { ready: true },
      },
      kind: 'video',
      deviceId: 'cam-2',
    }));
    expect(deviceHandler).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'member-2' }),
      { kind: 'video', deviceId: 'cam-2' },
    );

    (room as any).handleMessage(JSON.stringify({
      type: 'media_track_removed',
      member: {
        memberId: 'member-2',
        userId: 'member-2',
        connectionId: 'conn-2',
        connectionCount: 1,
        role: 'host',
        state: { ready: true },
      },
      track: {
        kind: 'video',
        trackId: 'video-1',
        deviceId: 'cam-2',
        muted: true,
      },
    }));
    expect(removedHandler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'video', trackId: 'video-1' }),
      expect.objectContaining({ memberId: 'member-2' }),
    );
    tm.destroy();
  });

  it('session adapters emit connection state and reconnect callbacks', () => {
    vi.useFakeTimers();
    const { room, tm } = createConnectedRoom('session-room');
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

describe('refreshAccessToken', () => {
  it('includes the refresh URL when the auth server is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8688'));

    await expect(refreshAccessToken('http://localhost:8688', 'refresh-token')).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('Auth session refresh could not reach http://localhost:8688/api/auth/refresh'),
    });
  });

  it('explains when the refresh response is missing tokens', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ accessToken: 'only-access-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(refreshAccessToken('http://localhost:8688', 'refresh-token')).rejects.toMatchObject({
      status: 500,
      message: 'Auth refresh succeeded but did not return both accessToken and refreshToken. Check the server auth configuration.',
    });
  });
});

// ─── K. RoomClient — options defaults ────────────────────────────────────────

describe('RoomClient — options defaults', () => {
  it('custom options accepted', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r-opts', tm, {
      autoReconnect: false,
      maxReconnectAttempts: 5,
      reconnectBaseDelay: 2000,
    });
    expect(room.roomId).toBe('r-opts');
    tm.destroy();
  });
});

// ─── L. matchesFilter ────────────────────────────────────────────────────────

describe('matchesFilter — client-side filtering', () => {
  it('== match', () => {
    expect(matchesFilter({ status: 'active' }, [['status', '==', 'active']])).toBe(true);
  });

  it('== mismatch', () => {
    expect(matchesFilter({ status: 'inactive' }, [['status', '==', 'active']])).toBe(false);
  });

  it('!= match', () => {
    expect(matchesFilter({ status: 'active' }, [['status', '!=', 'inactive']])).toBe(true);
  });

  it('!= mismatch', () => {
    expect(matchesFilter({ status: 'active' }, [['status', '!=', 'active']])).toBe(false);
  });

  it('> match', () => {
    expect(matchesFilter({ count: 10 }, [['count', '>', 5]])).toBe(true);
  });

  it('> mismatch', () => {
    expect(matchesFilter({ count: 3 }, [['count', '>', 5]])).toBe(false);
  });

  it('>= exact', () => {
    expect(matchesFilter({ count: 5 }, [['count', '>=', 5]])).toBe(true);
  });

  it('< match', () => {
    expect(matchesFilter({ count: 3 }, [['count', '<', 5]])).toBe(true);
  });

  it('<= exact', () => {
    expect(matchesFilter({ count: 5 }, [['count', '<=', 5]])).toBe(true);
  });

  it('contains match', () => {
    expect(matchesFilter({ title: 'Hello World' }, [['title', 'contains', 'World']])).toBe(true);
  });

  it('contains mismatch', () => {
    expect(matchesFilter({ title: 'Hello' }, [['title', 'contains', 'World']])).toBe(false);
  });

  it('contains-any match', () => {
    expect(matchesFilter({ tags: ['draft', 'featured'] }, [['tags', 'contains-any', ['archived', 'featured']]])).toBe(true);
  });

  it('contains-any mismatch', () => {
    expect(matchesFilter({ tags: ['draft', 'featured'] }, [['tags', 'contains-any', ['archived', 'private']]])).toBe(false);
  });

  it('in match', () => {
    expect(matchesFilter({ status: 'draft' }, [['status', 'in', ['draft', 'archived']]])).toBe(true);
  });

  it('in mismatch', () => {
    expect(matchesFilter({ status: 'published' }, [['status', 'in', ['draft', 'archived']]])).toBe(false);
  });

  it('not in match', () => {
    expect(matchesFilter({ status: 'published' }, [['status', 'not in', ['draft', 'archived']]])).toBe(true);
  });

  it('not in mismatch', () => {
    expect(matchesFilter({ status: 'draft' }, [['status', 'not in', ['draft', 'archived']]])).toBe(false);
  });

  it('multiple filters — AND logic', () => {
    const doc = { status: 'active', count: 10 };
    expect(matchesFilter(doc, [
      ['status', '==', 'active'],
      ['count', '>', 5],
    ])).toBe(true);
  });

  it('multiple filters — one fails', () => {
    const doc = { status: 'active', count: 2 };
    expect(matchesFilter(doc, [
      ['status', '==', 'active'],
      ['count', '>', 5],
    ])).toBe(false);
  });

  it('empty filter array → true', () => {
    expect(matchesFilter({ any: 'thing' }, [])).toBe(true);
  });

  it('missing field → false for ==', () => {
    expect(matchesFilter({}, [['status', '==', 'active']])).toBe(false);
  });

  it('unknown tuple operator fails closed instead of throwing', () => {
    expect(matchesFilter({ status: 'active' }, [['status', 'startsWith', 'act']])).toBe(false);
  });
});

// ─── M. ClientEdgeBase — construction ────────────────────────────────────────

describe('ClientEdgeBase (createClient) — construction', () => {
  // Need to import createClient
  it('createClient returns ClientEdgeBase', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    expect(client).toBeTruthy();
    expect(client.auth).toBeTruthy();
    expect(client.storage).toBeTruthy();
    client.destroy();
  });

  it('db() returns DbRef', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    const db = client.db('shared');
    expect(db).toBeTruthy();
    client.destroy();
  });

  it('db().table() wires matchesFilter for database-live query subscriptions', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    const table = client.db('shared').table('posts') as { filterMatchFn?: unknown };
    expect(typeof table.filterMatchFn).toBe('function');
    client.destroy();
  });

  it('db().table() uses DatabaseLiveClient for database-live subscriptions', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    const table = client.db('shared').table('posts') as { databaseLiveClient?: unknown };
    expect(table.databaseLiveClient).toBeTruthy();
    expect((table.databaseLiveClient as { constructor?: { name?: string } }).constructor?.name).toBe('DatabaseLiveClient');
    client.destroy();
  });

  it('DatabaseLiveClient builds /api/db/subscribe WebSocket URLs', async () => {
    const { DatabaseLiveClient } = await import('../../src/database-live.js');
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const live = new DatabaseLiveClient('http://localhost:8688', tm, undefined, cm) as { buildWsUrl: (channel: string) => string; disconnect: () => void };
    expect(live.buildWsUrl('dblive:shared:posts')).toBe(
      'ws://localhost:8688/api/db/subscribe?channel=dblive%3Ashared%3Aposts',
    );
    live.disconnect();
    tm.destroy();
  });

  it('DatabaseLiveClient only waits for auth when no session is available', async () => {
    installBrowserMocks();
    const { DatabaseLiveClient } = await import('../../src/database-live.js');
    const { EdgeBaseError } = await import('@edge-base/core');
    const channel = 'dblive:shared:posts';

    const tmNoSession = new TokenManager('http://localhost:8688');
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

    const tmWithSession = new TokenManager('http://localhost:8688');
    const token = makeValidJwt('u-db-live');
    tmWithSession.setTokens({ accessToken: token, refreshToken: token });
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

  it('room() returns RoomClient (v2: namespace + roomId)', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    const room = client.room('default', 'test-room');
    expect(room).toBeInstanceOf(RoomClient);
    expect(room.namespace).toBe('default');
    expect(room.roomId).toBe('test-room');
    client.destroy();
  });

  it('push.getPermissionStatus returns valid status', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    const status = client.push.getPermissionStatus();
    expect(['granted', 'denied', 'notDetermined']).toContain(status);
    client.destroy();
  });

  it('push.requestPermission is a function', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    expect(typeof client.push.requestPermission).toBe('function');
    client.destroy();
  });

  it('push.getPermissionStatus returns notDetermined when Notification API unavailable', async () => {
    // In vitest (node) env, global.Notification is undefined
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    const status = client.push.getPermissionStatus();
    // Without browser Notification API, should return 'notDetermined'
    expect(status).toBe('notDetermined');
    client.destroy();
  });

  it('push.setTokenProvider is a function', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    expect(typeof client.push.setTokenProvider).toBe('function');
    client.destroy();
  });

  it('push.register throws without tokenProvider', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    await expect(client.push.register()).rejects.toThrow('Token provider not set');
    client.destroy();
  });

  it('push.onMessage and onMessageOpenedApp are functions', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    expect(typeof client.push.onMessage).toBe('function');
    expect(typeof client.push.onMessageOpenedApp).toBe('function');
    client.destroy();
  });

  it('analytics is a ClientAnalytics instance', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    expect(client.analytics).toBeTruthy();
    expect(client.analytics).toBeInstanceOf(ClientAnalytics);
    client.destroy();
  });

  it('destroy does not throw', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    expect(() => client.destroy()).not.toThrow();
  });

  it('createClient tolerates malformed browser localStorage', async () => {
    installInvalidBrowserStorageMocks();
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    expect(client.storage).toBeTruthy();
    client.destroy();
  });
});

// ─── N. ClientAnalytics — method signatures & behavior ────────────────────────

describe('ClientAnalytics — method signatures', () => {
  function makeAnalytics() {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const analytics = new ClientAnalytics(http, 'http://localhost:8688');
    return { analytics, tm };
  }

  it('track is a function', () => {
    const { analytics, tm } = makeAnalytics();
    expect(typeof analytics.track).toBe('function');
    analytics.destroy();
    tm.destroy();
  });

  it('flush is a function', () => {
    const { analytics, tm } = makeAnalytics();
    expect(typeof analytics.flush).toBe('function');
    analytics.destroy();
    tm.destroy();
  });

  it('destroy is a function', () => {
    const { analytics, tm } = makeAnalytics();
    expect(typeof analytics.destroy).toBe('function');
    analytics.destroy();
    tm.destroy();
  });

  it('track does not throw', () => {
    const { analytics, tm } = makeAnalytics();
    expect(() => analytics.track('test_event')).not.toThrow();
    analytics.destroy();
    tm.destroy();
  });

  it('track with properties does not throw', () => {
    const { analytics, tm } = makeAnalytics();
    expect(() => analytics.track('test_event', { key: 'value', num: 42, flag: true })).not.toThrow();
    analytics.destroy();
    tm.destroy();
  });

  it('flush on empty queue resolves immediately', async () => {
    const { analytics, tm } = makeAnalytics();
    await expect(analytics.flush()).resolves.toBeUndefined();
    analytics.destroy();
    tm.destroy();
  });

  it('destroy after track does not throw', () => {
    const { analytics, tm } = makeAnalytics();
    analytics.track('event_1');
    analytics.track('event_2');
    expect(() => analytics.destroy()).not.toThrow();
    tm.destroy();
  });

  it('destroy multiple times does not throw', () => {
    const { analytics, tm } = makeAnalytics();
    expect(() => {
      analytics.destroy();
      analytics.destroy();
    }).not.toThrow();
    tm.destroy();
  });

  it('track after destroy does not throw', () => {
    const { analytics, tm } = makeAnalytics();
    analytics.destroy();
    // track after destroy should still work (queue only, no crash)
    expect(() => analytics.track('late_event')).not.toThrow();
    tm.destroy();
  });
});

describe('ClientAnalytics — lifecycle behavior', () => {
  function makeAnalyticsHarness() {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({
      baseUrl: 'http://localhost:8688',
      tokenManager: tm,
      contextManager: cm,
    });
    const analytics = new ClientAnalytics(http, 'http://localhost:8688');
    return { analytics, http, tm };
  }

  it('flushes immediately when the batch threshold is reached', async () => {
    const { analytics, http, tm } = makeAnalyticsHarness();
    const postSpy = vi.spyOn(http, 'post').mockResolvedValue(undefined as never);

    for (let i = 0; i < 20; i++) {
      analytics.track(`event-${i}`, { idx: i });
    }
    await Promise.resolve();

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(ApiPaths.TRACK_EVENTS, {
      events: expect.arrayContaining([
        expect.objectContaining({ name: 'event-0', properties: { idx: 0 } }),
      ]),
    });

    analytics.destroy();
    tm.destroy();
  });

  it('flushes queued events when the timer expires', async () => {
    vi.useFakeTimers();
    const { analytics, http, tm } = makeAnalyticsHarness();
    const postSpy = vi.spyOn(http, 'post').mockResolvedValue(undefined as never);

    analytics.track('timer-event', { source: 'timer' });
    await vi.advanceTimersByTimeAsync(5000);

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(ApiPaths.TRACK_EVENTS, {
      events: [
        expect.objectContaining({ name: 'timer-event', properties: { source: 'timer' } }),
      ],
    });

    analytics.destroy();
    tm.destroy();
    vi.useRealTimers();
  });

  it('requeues failed flushes and retries on the next timer tick', async () => {
    vi.useFakeTimers();
    const { analytics, http, tm } = makeAnalyticsHarness();
    const postSpy = vi.spyOn(http, 'post')
      .mockRejectedValueOnce(new Error('temporary analytics failure'))
      .mockResolvedValue(undefined as never);

    analytics.track('retry-event');
    await analytics.flush();
    expect(postSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(postSpy).toHaveBeenCalledTimes(2);

    analytics.destroy();
    tm.destroy();
    vi.useRealTimers();
  });

  it('destroy sends the remaining queue with navigator.sendBeacon', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('window', { addEventListener, removeEventListener });
    vi.stubGlobal('document', { visibilityState: 'visible' });
    vi.stubGlobal('navigator', { sendBeacon });

    const { analytics, tm } = makeAnalyticsHarness();
    analytics.track('destroy-event', { path: '/pricing' });
    analytics.destroy();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon).toHaveBeenCalledWith(
      'http://localhost:8688' + ApiPaths.TRACK_EVENTS,
      expect.any(Blob),
    );
    expect(removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('pagehide', expect.any(Function));

    tm.destroy();
  });

  it('visibilitychange hidden triggers a beacon flush', () => {
    const listeners = new Map<string, () => void>();
    const addEventListener = vi.fn((type: string, listener: () => void) => {
      listeners.set(type, listener);
    });
    const removeEventListener = vi.fn();
    const sendBeacon = vi.fn(() => true);
    const documentMock = { visibilityState: 'visible' };
    vi.stubGlobal('window', { addEventListener, removeEventListener });
    vi.stubGlobal('document', documentMock);
    vi.stubGlobal('navigator', { sendBeacon });

    const { analytics, tm } = makeAnalyticsHarness();
    analytics.track('hidden-event');
    documentMock.visibilityState = 'hidden';
    listeners.get('visibilitychange')?.();

    expect(sendBeacon).toHaveBeenCalledTimes(1);

    analytics.destroy();
    tm.destroy();
  });
});
