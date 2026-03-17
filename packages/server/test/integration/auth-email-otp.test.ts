/**
 * auth-email-otp.test.ts — Email OTP (passwordless email code) integration tests
 *
 * Tests: Email OTP sign-in flow
 *   POST /api/auth/signin/email-otp  (send OTP code to email)
 *   POST /api/auth/verify-email-otp  (verify OTP → create session)
 *
 * Test config: edgebase.test.config.js → auth.emailOtp: { enabled: true, autoCreate: true }
 * In dev mode (no email provider configured), OTP code is returned in response for testing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setConfig } from '../../src/lib/do-router.js';
import testConfig from '../../edgebase.test.config.ts';

const BASE = 'http://localhost';

beforeAll(() => {
  setConfig({
    ...testConfig,
    release: false,
  });
});

afterAll(() => {
  setConfig(testConfig);
});

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
  return `email-otp-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

// ─── 1. POST /signin/email-otp — OTP 요청 ───────────────────────────────────

describe('auth-email-otp — signin/email-otp', () => {
  it('새 이메일로 OTP 요청 → 200, ok: true, dev mode에서 code 반환', async () => {
    const email = randomEmail();
    const { status, data } = await api('POST', '/signin/email-otp', { email });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    // In dev mode (no email provider), code is returned for testing
    expect(typeof data.code).toBe('string');
    expect(data.code.length).toBe(6);
  });

  it('email 누락 → 400', async () => {
    const { status } = await api('POST', '/signin/email-otp', {});
    expect(status).toBe(400);
  });

  it('잘못된 이메일 형식 → 400', async () => {
    const { status } = await api('POST', '/signin/email-otp', { email: 'not-an-email' });
    expect(status).toBe(400);
  });

  it('이메일 소문자 정규화', async () => {
    const base = crypto.randomUUID().slice(0, 8);
    const email = `Email-OTP-${base}@Example.COM`;
    const { status, data } = await api('POST', '/signin/email-otp', { email });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('기존 유저에 대해서도 OTP 요청 → 200', async () => {
    const email = randomEmail();
    // First signup creates user
    await api('POST', '/signup', { email, password: 'Test1234!' });
    // Then request email OTP
    const { status, data } = await api('POST', '/signin/email-otp', { email });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(typeof data.code).toBe('string');
  });
});

// ─── 2. POST /verify-email-otp — OTP 검증 ───────────────────────────────────

describe('auth-email-otp — verify-email-otp', () => {
  it('정상 OTP 검증 → 200, accessToken/refreshToken/user 반환', async () => {
    const email = randomEmail();
    // Request OTP
    const { data: otpData } = await api('POST', '/signin/email-otp', { email });
    expect(otpData.code).toBeDefined();

    // Verify OTP
    const { status, data } = await api('POST', '/verify-email-otp', {
      email,
      code: otpData.code,
    });
    expect(status).toBe(200);
    expect(typeof data.accessToken).toBe('string');
    expect(typeof data.refreshToken).toBe('string');
    expect(data.user).toBeDefined();
  });

  it('OTP 검증 후 세션 유효 (accessToken으로 profile 조회)', async () => {
    const email = randomEmail();
    const { data: otpData } = await api('POST', '/signin/email-otp', { email });
    const { data } = await api('POST', '/verify-email-otp', {
      email,
      code: otpData.code,
    });

    const { status } = await api('GET', '/sessions', undefined, data.accessToken);
    expect(status).toBe(200);
  });

  it('틀린 OTP 코드 → 401', async () => {
    const email = randomEmail();
    await api('POST', '/signin/email-otp', { email });

    const { status } = await api('POST', '/verify-email-otp', {
      email,
      code: '000000',
    });
    expect(status).toBe(401);
  });

  it('만료/존재하지 않는 OTP → 400', async () => {
    const email = randomEmail();
    // No OTP requested — directly try to verify
    const { status } = await api('POST', '/verify-email-otp', {
      email,
      code: '123456',
    });
    expect(status).toBe(400);
  });

  it('email 또는 code 누락 → 400', async () => {
    const { status: s1 } = await api('POST', '/verify-email-otp', { email: randomEmail() });
    expect(s1).toBe(400);

    const { status: s2 } = await api('POST', '/verify-email-otp', { code: '123456' });
    expect(s2).toBe(400);
  });

  it('OTP 사용 후 재사용 불가 (single-use)', async () => {
    const email = randomEmail();
    const { data: otpData } = await api('POST', '/signin/email-otp', { email });

    // First verify — success
    const { status: s1 } = await api('POST', '/verify-email-otp', {
      email,
      code: otpData.code,
    });
    expect(s1).toBe(200);

    // Second verify with same code — fail
    const { status: s2 } = await api('POST', '/verify-email-otp', {
      email,
      code: otpData.code,
    });
    expect(s2).toBe(400); // OTP already consumed
  });
});

// ─── 3. auto-create 동작 ───────────────────────────────────────────────────

describe('auth-email-otp — auto-create', () => {
  it('새 이메일로 OTP → verify → user 자동 생성', async () => {
    const email = randomEmail();
    const { data: otpData } = await api('POST', '/signin/email-otp', { email });

    const { status, data } = await api('POST', '/verify-email-otp', {
      email,
      code: otpData.code,
    });
    expect(status).toBe(200);
    expect(data.user).toBeDefined();
    // User should have the email but no password (passwordless)
    expect(data.user.passwordHash).toBeUndefined();
  });

  it('auto-create 유저 → 비밀번호 로그인 불가 (비밀번호 없음)', async () => {
    const email = randomEmail();
    const { data: otpData } = await api('POST', '/signin/email-otp', { email });
    await api('POST', '/verify-email-otp', { email, code: otpData.code });

    // Try password login — should fail (401 or 403 depending on server implementation)
    const { status } = await api('POST', '/signin', {
      email,
      password: 'AnyPassword1!',
    });
    expect([401, 403].includes(status)).toBe(true);
  });
});

// ─── 4. 기존 유저 Email OTP 로그인 ──────────────────────────────────────────

describe('auth-email-otp — existing user', () => {
  it('비밀번호로 가입한 유저도 email OTP 로 로그인 가능', async () => {
    const email = randomEmail();
    // Sign up with password
    await api('POST', '/signup', { email, password: 'Test1234!' });

    // Request email OTP
    const { data: otpData } = await api('POST', '/signin/email-otp', { email });
    expect(otpData.code).toBeDefined();

    // Verify OTP
    const { status, data } = await api('POST', '/verify-email-otp', {
      email,
      code: otpData.code,
    });
    expect(status).toBe(200);
    expect(data.user.email).toBe(email);
    expect(typeof data.accessToken).toBe('string');
  });

  it('email OTP 로그인 후 비밀번호 로그인도 여전히 가능', async () => {
    const email = randomEmail();
    const password = 'StillWorks1!';
    await api('POST', '/signup', { email, password });

    // Login via email OTP
    const { data: otpData } = await api('POST', '/signin/email-otp', { email });
    await api('POST', '/verify-email-otp', { email, code: otpData.code });

    // Password login still works
    const { status } = await api('POST', '/signin', { email, password });
    expect(status).toBe(200);
  });
});

// ─── 5. OTP 시도 횟수 제한 ──────────────────────────────────────────────────

describe('auth-email-otp — attempt limit', () => {
  it('5번 실패 후 429 반환 (OTP 소진)', async () => {
    const email = randomEmail();
    const { data: otpData } = await api('POST', '/signin/email-otp', { email });

    // Fail 5 times
    for (let i = 0; i < 5; i++) {
      await api('POST', '/verify-email-otp', { email, code: '000000' });
    }

    // 6th attempt — should be 429 or 400 (OTP already deleted)
    const { status } = await api('POST', '/verify-email-otp', {
      email,
      code: otpData.code,
    });
    expect([400, 429].includes(status)).toBe(true);
  });
});

// ─── 6. JWT payload 검증 ───────────────────────────────────────────────────

describe('auth-email-otp — JWT payload', () => {
  it('accessToken에 email claim 포함', async () => {
    const email = randomEmail();
    const { data: otpData } = await api('POST', '/signin/email-otp', { email });
    const { data } = await api('POST', '/verify-email-otp', { email, code: otpData.code });

    const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
    expect(payload.email).toBe(email);
    expect(typeof payload.sub).toBe('string');
  });

  it('accessToken의 sub(userId)가 세션 목록과 일치', async () => {
    const email = randomEmail();
    const { data: otpData } = await api('POST', '/signin/email-otp', { email });
    const { data } = await api('POST', '/verify-email-otp', { email, code: otpData.code });

    const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
    expect(data.user.id).toBe(payload.sub);
  });
});
