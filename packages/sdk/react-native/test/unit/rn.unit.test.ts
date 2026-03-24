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
import * as api from '../../src/index';

// ─── In-memory AsyncStorage mock ─────────────────────────────────────────────

function createMockStorage(): AsyncStorageAdapter {
  const store = new Map<string, string>();
  return {
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
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.id).toBe('user-rn-42');
    tm.destroy();
  });

  it('setTokens → getRefreshToken() 반영', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-rn-2');
    const rt = makeValidJwt('u-rn-2');
    tm.setTokens({ accessToken: at, refreshToken: rt });
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
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect((calls[calls.length - 1] as { id: string })?.id).toBe('u-rn-3');
    unsub();
    tm.destroy();
  });

  it('setTokens email 반영', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-rn-email', { email: 'rn-specific@test.com' });
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.email).toBe('rn-specific@test.com');
    tm.destroy();
  });

  it('setTokens displayName 반영', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-rn-display', { displayName: 'TestUser' });
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.displayName).toBe('TestUser');
    tm.destroy();
  });

  it('setTokens 한글 displayName 반영', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-rn-ko', { displayName: '준규' });
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.displayName).toBe('준규');
    tm.destroy();
  });

  it('setTokens role 반영', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-rn-role', { role: 'admin' });
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.role).toBe('admin');
    tm.destroy();
  });

  it('setTokens isAnonymous 반영', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-rn-anon', { isAnonymous: true });
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.isAnonymous).toBe(true);
    tm.destroy();
  });

  it('setTokens overwrites previous user', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    tm.setTokens({ accessToken: makeValidJwt('user-A'), refreshToken: makeValidJwt('user-A') });
    expect(tm.getCurrentUser()?.id).toBe('user-A');
    tm.setTokens({ accessToken: makeValidJwt('user-B'), refreshToken: makeValidJwt('user-B') });
    expect(tm.getCurrentUser()?.id).toBe('user-B');
    tm.destroy();
  });
});

// ─── C. clearTokens ──────────────────────────────────────────────────────────

describe('RN TokenManager — clearTokens', () => {
  it('clearTokens → getCurrentUser() === null', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-clr');
    tm.setTokens({ accessToken: at, refreshToken: at });
    tm.clearTokens();
    expect(tm.getCurrentUser()).toBeNull();
    tm.destroy();
  });

  it('clearTokens → 스토리지 refreshToken 삭제', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    const at = makeValidJwt('u-clr2');
    tm.setTokens({ accessToken: at, refreshToken: at });
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
    tm.setTokens({ accessToken: at, refreshToken: at });
    const unsub = tm.onAuthStateChange(user => calls.push(user));
    tm.clearTokens();
    expect(calls[calls.length - 1]).toBeNull();
    unsub();
    tm.destroy();
  });

  it('clearTokens 호출 후 다시 setTokens 가능', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    tm.setTokens({ accessToken: makeValidJwt('u-first'), refreshToken: makeValidJwt('u-first') });
    tm.clearTokens();
    expect(tm.getCurrentUser()).toBeNull();
    tm.setTokens({ accessToken: makeValidJwt('u-second'), refreshToken: makeValidJwt('u-second') });
    expect(tm.getCurrentUser()?.id).toBe('u-second');
    tm.destroy();
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
    tm.setTokens({ accessToken: makeValidJwt('u-unsub'), refreshToken: makeValidJwt('u-unsub') });
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
    tm.setTokens({ accessToken: makeValidJwt('u-partial'), refreshToken: makeValidJwt('u-partial') });
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
    tm.setTokens({ accessToken: makeValidJwt('u-post-destroy'), refreshToken: makeValidJwt('u-post-destroy') });
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
    await storage.setItem('edgebase:refresh-token', at);
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
    await storage.setItem('edgebase:refresh-token', expired);
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
    tm.setTokens({ accessToken: at, refreshToken: at });
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
    tm.setTokens({ accessToken: at, refreshToken: rt });

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
    tm.setTokens({ accessToken: makeValidJwt('u-signout-test'), refreshToken: makeValidJwt('u-signout-test') });
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

  it('onAuthStateChange → unsub 함수 반환', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore());
    const unsub = auth.onAuthStateChange(() => {});
    expect(typeof unsub).toBe('function');
    unsub();
    tm.destroy();
  });

  it('handleOAuthCallback → 유효한 URL에서 토큰 추출', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore());
    const at = makeValidJwt('u-oauth');
    const rt = makeValidJwt('u-oauth');
    const url = `myapp://auth/callback?access_token=${encodeURIComponent(at)}&refresh_token=${encodeURIComponent(rt)}`;
    const result = await auth.handleOAuthCallback(url);
    expect(result).not.toBeNull();
    expect(result!.user.id).toBe('u-oauth');
    expect(result!.accessToken).toBe(at);
    tm.destroy();
  });

  it('handleOAuthCallback → 토큰 없는 URL은 null 반환', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore());
    const result = await auth.handleOAuthCallback('myapp://auth/callback?code=abc');
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
    const result = auth.signInWithOAuth('google');
    expect(result.url).toContain('/api/auth/oauth/google');
    tm.destroy();
  });

  it('signInWithOAuth → redirectUrl 포함', async () => {
    const tm = createMockTokenManager();
    await tm.ready();
    const auth = new AuthClient(createMockHttpClient(), tm, createMockCore(), createMockCore());
    const result = auth.signInWithOAuth('github', { redirectUrl: 'myapp://callback' });
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
    auth.signInWithOAuth('google');
    expect(mockLinking.openURL).toHaveBeenCalled();
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

    tm.setTokens({
      accessToken: makeValidJwt('room-rn-user'),
      refreshToken: makeValidJwt('room-rn-user'),
    });

    await Promise.resolve();

    expect(establishConnection).toHaveBeenCalledTimes(1);
    tm.destroy();
  });

  it('join() 두 번 호출 시 진행 중인 room 연결을 재사용', async () => {
    const { room, tm } = createRoomClient();
    tm.setTokens({
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

    tm.setTokens({
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

    tm.setTokens({
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

    tm.setTokens({
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
    expect(close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40);
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
    await expect(room.send('TEST_ACTION', { data: 1 })).rejects.toThrow('Not connected to room');
    tm.destroy();
  });

  it('RoomClient.getMetadata static 함수 존재', () => {
    expect(typeof RoomClient.getMetadata).toBe('function');
  });
});

describe('RN RoomClient — rooms adapter APIs', () => {
  function createConnectedRoom(roomId = 'adapter-room') {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    tm.setTokens({
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
    const { room, tm } = createConnectedRoom('state-meta');
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
    const { room, tm, send } = createConnectedRoom('signals');
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
    const { room, tm, send } = createConnectedRoom('members');
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
    const { room, tm, send } = createConnectedRoom('admin');

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

  it('media adapter가 media sync와 control-plane 이벤트를 유지한다', async () => {
    const { room, tm, send } = createConnectedRoom('media');
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

  it('cloudflareRealtimeKit session create가 provider endpoint를 호출한다', async () => {
    const tm = new TokenManager('http://localhost:8688', createMockStorage());
    await tm.ready();
    tm.setTokens({
      accessToken: makeValidJwt('rn-room-cloudflare'),
      refreshToken: makeValidJwt('rn-room-cloudflare'),
    });

    const room = new RoomClient('http://localhost:8688', 'media', 'room-cloudflare', tm);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        sessionId: 'session-1',
        meetingId: 'meeting-1',
        participantId: 'participant-1',
        authToken: 'auth-token-1',
        presetName: 'default',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await room.media.cloudflareRealtimeKit.createSession({
      name: 'React Native User',
      customParticipantId: 'rn-user-1',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8688/api/room/media/cloudflare_realtimekit/session?namespace=media&id=room-cloudflare',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Bearer /),
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(result).toMatchObject({
      sessionId: 'session-1',
      meetingId: 'meeting-1',
      participantId: 'participant-1',
      authToken: 'auth-token-1',
      presetName: 'default',
    });

    fetchSpy.mockRestore();
    tm.destroy();
  });

  it('session adapter가 connection state와 reconnect 콜백을 방출한다', () => {
    vi.useFakeTimers();
    const { room, tm } = createConnectedRoom('session');
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
    return { storage: createMockStorage() };
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
});

// ═══════════════════════════════════════════════════════════════════════════════
// PART I — TableRef immutable chaining (단위 테스트)
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN Core — TableRef immutable chaining', () => {

  function makeClient() {
    return createClient('http://localhost:8688', { storage: createMockStorage() });
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
});

describe('RN Client surface — functions / analytics / passkeys', () => {
  it('client exposes functions and analytics helpers', () => {
    const client = createClient('http://localhost:8688', { storage: createMockStorage() });
    expect(typeof client.functions.get).toBe('function');
    expect(typeof client.functions.post).toBe('function');
    expect(typeof client.analytics.track).toBe('function');
    expect(typeof client.analytics.flush).toBe('function');
    client.destroy();
  });

  it('auth exposes passkeys REST methods', () => {
    const client = createClient('http://localhost:8688', { storage: createMockStorage() });
    expect(typeof client.auth.passkeysRegisterOptions).toBe('function');
    expect(typeof client.auth.passkeysRegister).toBe('function');
    expect(typeof client.auth.passkeysAuthOptions).toBe('function');
    expect(typeof client.auth.passkeysAuthenticate).toBe('function');
    expect(typeof client.auth.passkeysList).toBe('function');
    expect(typeof client.auth.passkeysDelete).toBe('function');
    client.destroy();
  });
});
