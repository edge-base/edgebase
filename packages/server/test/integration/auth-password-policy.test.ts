/**
 * auth-password-policy.test.ts — Password Policy integration tests
 *
 * Tests: Password validation in signup, change-password, and reset-password.
 * Test config uses default policy (minLength: 8 only) — no additional requirements.
 * Tests verify:
 *   - Short passwords are rejected
 *   - Passwords at exactly min length are accepted
 *   - Policy validation applies to signup (create-user)
 *   - Policy validation applies to change-password
 *   - Policy errors include descriptive messages
 */
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost';

async function api(
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
  return `pw-policy-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

// ─── 1. Signup — Password Policy ──────────────────────────────────────────

describe('auth-password-policy — signup', () => {
  it('짧은 비밀번호(7자) → 400', async () => {
    const { status, data } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Abc123!', // 7 chars
    });
    expect(status).toBe(400);
    expect(data.message).toContain('at least');
  });

  it('빈 비밀번호 → 400', async () => {
    const { status } = await api('POST', '/signup', {
      email: randomEmail(),
      password: '',
    });
    expect(status).toBe(400);
  });

  it('정확히 8자 비밀번호 → 201 (성공)', async () => {
    const { status } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Abcd1234', // exactly 8 chars
    });
    expect(status).toBe(201);
  });

  it('충분한 길이의 비밀번호 → 201 (성공)', async () => {
    const { status } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'StrongPassword123!',
    });
    expect(status).toBe(201);
  });
});

// ─── 2. Change Password — Password Policy ────────────────────────────────

describe('auth-password-policy — change-password', () => {
  it('짧은 새 비밀번호로 변경 시도 → 400', async () => {
    const email = randomEmail();
    const { data } = await api('POST', '/signup', { email, password: 'Original1234!' });
    const { status } = await api('POST', '/change-password', {
      currentPassword: 'Original1234!',
      newPassword: 'short', // too short
    }, data.accessToken);
    expect(status).toBe(400);
  });

  it('유효한 새 비밀번호로 변경 → 200', async () => {
    const email = randomEmail();
    const { data } = await api('POST', '/signup', { email, password: 'Original1234!' });
    const { status } = await api('POST', '/change-password', {
      currentPassword: 'Original1234!',
      newPassword: 'ValidNew1234!',
    }, data.accessToken);
    expect(status).toBe(200);
  });

  it('에러 메시지에 정책 위반 내용 포함', async () => {
    const email = randomEmail();
    const { data } = await api('POST', '/signup', { email, password: 'Original1234!' });
    const { status, data: errData } = await api('POST', '/change-password', {
      currentPassword: 'Original1234!',
      newPassword: 'a', // way too short
    }, data.accessToken);
    expect(status).toBe(400);
    expect(errData.message).toContain('at least');
  });
});

// ─── 3. Reset Password — Password Policy ─────────────────────────────────

describe('auth-password-policy — reset-password', () => {
  it('짧은 새 비밀번호로 리셋 시도 → 400', async () => {
    const email = randomEmail();
    await api('POST', '/signup', { email, password: 'Original1234!' });

    // Request password reset
    const { status: reqStatus, data: reqData } = await api('POST', '/request-password-reset', { email });
    expect(reqStatus).toBe(200);

    // In dev mode, the reset token is returned
    const token = reqData?.token;
    if (!token) return; // Skip if token not returned (email provider configured)

    // Try resetting with short password
    const { status } = await api('POST', '/reset-password', {
      token,
      newPassword: 'short', // too short
    });
    expect(status).toBe(400);
  });

  it('유효한 새 비밀번호로 리셋 → 200', async () => {
    const email = randomEmail();
    await api('POST', '/signup', { email, password: 'Original1234!' });

    const { data: reqData } = await api('POST', '/request-password-reset', { email });
    const token = reqData?.token;
    if (!token) return;

    const { status } = await api('POST', '/reset-password', {
      token,
      newPassword: 'ValidNew1234!',
    });
    expect(status).toBe(200);
  });
});

// ─── 4. Policy validation applies consistently ───────────────────────────

describe('auth-password-policy — consistency', () => {
  it('signup과 change-password 모두 동일한 정책 적용', async () => {
    const email = randomEmail();

    // Signup with exactly 8 chars should pass
    const { status: s1, data } = await api('POST', '/signup', {
      email,
      password: 'Abcd1234',
    });
    expect(s1).toBe(201);

    // Change to exactly 8 chars should also pass
    const { status: s2 } = await api('POST', '/change-password', {
      currentPassword: 'Abcd1234',
      newPassword: 'Wxyz5678',
    }, data.accessToken);
    expect(s2).toBe(200);

    // Change to 7 chars should fail
    const { data: newTokens } = await api('POST', '/signin', { email, password: 'Wxyz5678' });
    const { status: s3 } = await api('POST', '/change-password', {
      currentPassword: 'Wxyz5678',
      newPassword: 'Ab12345', // 7 chars
    }, newTokens.accessToken);
    expect(s3).toBe(400);
  });
});
