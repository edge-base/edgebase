/**
 * auth-disable.test.ts — User Disable/Ban integration tests
 *
 * Tests: disabled flag behavior
 *   Admin sets disabled=true → user cannot signin/refresh
 *   Admin sets disabled=false → user can signin again
 *   Disabling a user deletes all their sessions
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

async function authApi(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function adminApi(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {
    'X-EdgeBase-Service-Key': SK,
    'Content-Type': 'application/json',
  };
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/admin${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

function randomEmail() {
  return `disable-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

// ─── 1. disabled 유저 로그인 차단 ────────────────────────────────────────

describe('auth-disable — signin blocked', () => {
  const email = randomEmail();
  const password = 'Disable1234!';
  let userId: string;

  beforeAll(async () => {
    // Create user
    const { data } = await authApi('POST', '/signup', { email, password });
    userId = data.user.id;

    // Admin: disable user
    await adminApi('PATCH', `/users/${userId}`, { disabled: true });
  });

  it('disabled 유저 비밀번호 로그인 → 403', async () => {
    const { status, data } = await authApi('POST', '/signin', { email, password });
    expect(status).toBe(403);
    expect(data.message).toContain('disabled');
  });
});

// ─── 2. disabled 유저 토큰 갱신 차단 ─────────────────────────────────────

describe('auth-disable — refresh blocked', () => {
  it('disable 전 발급된 refreshToken으로 refresh → 403', async () => {
    const email = randomEmail();
    const password = 'DisRefresh1!';
    const { data: signupData } = await authApi('POST', '/signup', { email, password });
    const userId = signupData.user.id;
    const refreshToken = signupData.refreshToken;

    // Admin: disable user
    await adminApi('PATCH', `/users/${userId}`, { disabled: true });

    // Try refresh — should be blocked (403 or 401 because sessions were deleted)
    const { status } = await authApi('POST', '/refresh', { refreshToken });
    expect([401, 403].includes(status)).toBe(true);
  });
});

// ─── 3. disable 시 세션 전체 삭제 ─────────────────────────────────────────

describe('auth-disable — sessions deleted on disable', () => {
  it('disable 설정 시 기존 세션 전체 삭제', async () => {
    const email = randomEmail();
    const password = 'DelSess1234!';

    // Create user + 2 sessions
    const { data: d1 } = await authApi('POST', '/signup', { email, password });
    const { data: d2 } = await authApi('POST', '/signin', { email, password });

    // Admin: disable user
    await adminApi('PATCH', `/users/${d1.user.id}`, { disabled: true });

    // Both refresh tokens should fail
    const { status: s1 } = await authApi('POST', '/refresh', { refreshToken: d1.refreshToken });
    const { status: s2 } = await authApi('POST', '/refresh', { refreshToken: d2.refreshToken });
    expect([401, 403].includes(s1)).toBe(true);
    expect([401, 403].includes(s2)).toBe(true);
  });
});

// ─── 4. re-enable → 로그인 다시 가능 ─────────────────────────────────────

describe('auth-disable — re-enable', () => {
  it('disabled=false 후 로그인 가능', async () => {
    const email = randomEmail();
    const password = 'Reenable1234!';
    const { data: signupData } = await authApi('POST', '/signup', { email, password });
    const userId = signupData.user.id;

    // Disable
    await adminApi('PATCH', `/users/${userId}`, { disabled: true });

    // Verify blocked
    const { status: s1 } = await authApi('POST', '/signin', { email, password });
    expect(s1).toBe(403);

    // Re-enable
    await adminApi('PATCH', `/users/${userId}`, { disabled: false });

    // Should work again
    const { status: s2 } = await authApi('POST', '/signin', { email, password });
    expect(s2).toBe(200);
  });
});

// ─── 5. disabled 유저 비밀번호 변경 차단 ──────────────────────────────────

describe('auth-disable — change-password blocked', () => {
  it('disabled 유저 비밀번호 변경 → 403', async () => {
    const email = randomEmail();
    const password = 'DisChange1234!';
    const { data: signupData } = await authApi('POST', '/signup', { email, password });
    const userId = signupData.user.id;
    const token = signupData.accessToken;

    // Admin: disable user
    await adminApi('PATCH', `/users/${userId}`, { disabled: true });

    // Try change-password (token still valid, but user is disabled)
    const { status, data } = await authApi('POST', '/change-password', {
      currentPassword: password,
      newPassword: 'NewPass1234!',
    }, token);
    expect(status).toBe(403);
    expect(data.message).toContain('disabled');
  });
});

// ─── 6. disabled 필드 user 객체에 포함 ──────────────────────────────────

describe('auth-disable — user object includes disabled', () => {
  it('signup 후 disabled=false', async () => {
    const { data } = await authApi('POST', '/signup', {
      email: randomEmail(),
      password: 'DisField1234!',
    });
    expect(data.user.disabled).toBe(false);
  });
});
