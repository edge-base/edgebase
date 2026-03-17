/**
 * auth-email-change.test.ts — Email Change integration tests
 *
 * Tests: email change flow
 *   1. Request email change with correct password → get token
 *   2. Verify email change token → email updated
 *   3. Old email can no longer signin
 *   4. New email can signin
 *   5. Wrong password → 401
 *   6. Duplicate email → 409
 *   7. Invalid token → 400
 *   8. Token is single-use → second verify fails
 *   9. OAuth user (no password) → 403
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setConfig } from '../../src/lib/do-router.js';
import testConfig from '../../edgebase.test.config.ts';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

beforeAll(() => {
  setConfig({
    ...testConfig,
    release: false,
  });
});

afterAll(() => {
  setConfig(testConfig);
});

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

function randomEmail() {
  return `emailchange-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

// ─── 1. 이메일 변경 요청 + 검증 전체 플로우 ──────────────────────────────────

describe('auth-email-change — full flow', () => {
  const oldEmail = randomEmail();
  const newEmail = randomEmail();
  const password = 'EmailChange1234!';
  let accessToken: string;
  let changeToken: string;

  beforeAll(async () => {
    // Create user with old email
    const { data } = await authApi('POST', '/signup', { email: oldEmail, password });
    accessToken = data.accessToken;
  });

  it('POST /change-email with correct password → returns token', async () => {
    const { status, data } = await authApi('POST', '/change-email', {
      newEmail,
      password,
    }, accessToken);
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.token).toBeDefined();
    changeToken = data.token;
  });

  it('POST /verify-email-change with valid token → email updated', async () => {
    const { status, data } = await authApi('POST', '/verify-email-change', {
      token: changeToken,
    });
    expect(status).toBe(200);
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe(newEmail);
  });

  it('old email can no longer signin', async () => {
    const { status } = await authApi('POST', '/signin', {
      email: oldEmail,
      password,
    });
    expect(status).toBe(401); // email not found → invalid credentials
  });

  it('new email can signin', async () => {
    const { status, data } = await authApi('POST', '/signin', {
      email: newEmail,
      password,
    });
    expect(status).toBe(200);
    expect(data.user.email).toBe(newEmail);
  });
});

// ─── 2. 잘못된 비밀번호 ─────────────────────────────────────────────────────

describe('auth-email-change — wrong password', () => {
  it('POST /change-email with wrong password → 401', async () => {
    const email = randomEmail();
    const password = 'CorrectPass1234!';
    const { data } = await authApi('POST', '/signup', { email, password });

    const { status } = await authApi('POST', '/change-email', {
      newEmail: randomEmail(),
      password: 'WrongPassword999!',
    }, data.accessToken);
    expect(status).toBe(401);
  });
});

// ─── 3. 중복 이메일 ──────────────────────────────────────────────────────────

describe('auth-email-change — duplicate email', () => {
  it('POST /change-email with already registered email → 409', async () => {
    const email1 = randomEmail();
    const email2 = randomEmail();
    const password = 'DupEmailTest1234!';

    // Create two users
    const { data: d1 } = await authApi('POST', '/signup', { email: email1, password });
    await authApi('POST', '/signup', { email: email2, password });

    // Try to change email1 → email2
    const { status, data } = await authApi('POST', '/change-email', {
      newEmail: email2,
      password,
    }, d1.accessToken);
    expect(status).toBe(409);
    expect(data.message).toContain('already registered');
  });
});

// ─── 4. 유효하지 않은 토큰 ──────────────────────────────────────────────────

describe('auth-email-change — invalid token', () => {
  it('POST /verify-email-change with invalid token → 400', async () => {
    const { status, data } = await authApi('POST', '/verify-email-change', {
      token: 'non-existent-token-12345',
    });
    expect(status).toBe(400);
    expect(data.message).toContain('Invalid or expired');
  });
});

// ─── 5. 토큰 단일 사용 ──────────────────────────────────────────────────────

describe('auth-email-change — token single-use', () => {
  it('second verify with same token → 400', async () => {
    const email = randomEmail();
    const newEmail = randomEmail();
    const password = 'SingleUse1234!';

    const { data: signupData } = await authApi('POST', '/signup', { email, password });

    // Request email change
    const { data: changeData } = await authApi('POST', '/change-email', {
      newEmail,
      password,
    }, signupData.accessToken);

    const token = changeData.token;

    // First verify — should succeed
    const { status: s1 } = await authApi('POST', '/verify-email-change', { token });
    expect(s1).toBe(200);

    // Second verify — should fail
    const { status: s2 } = await authApi('POST', '/verify-email-change', { token });
    expect(s2).toBe(400);
  });
});

// ─── 6. 인증 없이 요청 ──────────────────────────────────────────────────────

describe('auth-email-change — unauthenticated', () => {
  it('POST /change-email without auth → 401', async () => {
    const { status } = await authApi('POST', '/change-email', {
      newEmail: randomEmail(),
      password: 'Test1234!',
    });
    expect(status).toBe(401);
  });
});

// ─── 7. 필수 필드 누락 ──────────────────────────────────────────────────────

describe('auth-email-change — missing fields', () => {
  it('POST /change-email without newEmail → 400', async () => {
    const email = randomEmail();
    const password = 'MissingField1234!';
    const { data } = await authApi('POST', '/signup', { email, password });

    const { status } = await authApi('POST', '/change-email', {
      password,
    }, data.accessToken);
    expect(status).toBe(400);
  });

  it('POST /change-email without password → 400', async () => {
    const email = randomEmail();
    const password = 'MissingField1234!';
    const { data } = await authApi('POST', '/signup', { email, password });

    const { status } = await authApi('POST', '/change-email', {
      newEmail: randomEmail(),
    }, data.accessToken);
    expect(status).toBe(400);
  });

  it('POST /verify-email-change without token → 400', async () => {
    const { status } = await authApi('POST', '/verify-email-change', {});
    expect(status).toBe(400);
  });
});

// ─── 8. 이메일 변경 후 user 객체 확인 ───────────────────────────────────────

describe('auth-email-change — user object after change', () => {
  it('GET /me returns new email after email change', async () => {
    const email = randomEmail();
    const newEmail = randomEmail();
    const password = 'UserObj1234!';

    const { data: signupData } = await authApi('POST', '/signup', { email, password });
    const accessToken = signupData.accessToken;

    // Request + verify email change
    const { data: changeData } = await authApi('POST', '/change-email', {
      newEmail,
      password,
    }, accessToken);

    await authApi('POST', '/verify-email-change', { token: changeData.token });

    // Get user with the original token (still valid since we don't revoke sessions on email change)
    const { status, data } = await authApi('GET', '/me', undefined, accessToken);
    expect(status).toBe(200);
    expect(data.user.email).toBe(newEmail);
  });
});

// ─── 9. 같은 이메일로 변경 시도 ─────────────────────────────────────────────

describe('auth-email-change — same email', () => {
  it('POST /change-email to same email → 409 (already registered)', async () => {
    const email = randomEmail();
    const password = 'SameEmail1234!';
    const { data } = await authApi('POST', '/signup', { email, password });

    // Try to change to the same email
    const { status } = await authApi('POST', '/change-email', {
      newEmail: email,
      password,
    }, data.accessToken);
    expect(status).toBe(409);
  });
});
