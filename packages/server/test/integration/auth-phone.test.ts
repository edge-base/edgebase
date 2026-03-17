/**
 * auth-phone.test.ts — Phone/SMS OTP authentication integration tests
 *
 * 테스트 대상: src/routes/auth.ts → auth-do.ts
 *   POST /api/auth/signin/phone        (OTP SMS 발송)
 *   POST /api/auth/verify-phone         (OTP 검증 → 세션 생성)
 *   POST /api/auth/link/phone           (기존 계정에 전화번호 연결)
 *   POST /api/auth/verify-link-phone    (연결 OTP 검증)
 *
 * 격리 원칙: 매 테스트마다 unique phone number 사용 (랜덤 생성)
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
  return `phone-test-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

function randomPhone() {
  // Generate random E.164 phone number: +1 followed by 10 digits
  const digits = Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('');
  return `+1${digits}`;
}

// ─── 1. POST /signin/phone — OTP 요청 ─────────────────────────────────────────

describe('auth-phone — signin/phone', () => {
  it('유효한 전화번호로 OTP 요청 → 200, ok: true, dev mode에서 code 반환', async () => {
    const phone = randomPhone();
    const { status, data } = await api('POST', '/signin/phone', { phone });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    // In dev mode (no SMS provider), code is returned for testing
    expect(typeof data.code).toBe('string');
    expect(data.code.length).toBe(6);
  });

  it('phone 누락 → 400', async () => {
    const { status } = await api('POST', '/signin/phone', {});
    expect(status).toBe(400);
  });

  it('잘못된 전화번호 형식 → 400', async () => {
    const { status } = await api('POST', '/signin/phone', { phone: '12345' });
    expect(status).toBe(400);
  });

  it('E.164 형식 아닌 번호 → 400', async () => {
    const { status } = await api('POST', '/signin/phone', { phone: '(555) 123-4567' });
    expect(status).toBe(400);
  });

  it('기존 유저 전화번호로 재요청 → 200, 새 OTP 발급', async () => {
    const phone = randomPhone();

    // First request (auto-creates user)
    const { status: s1, data: d1 } = await api('POST', '/signin/phone', { phone });
    expect(s1).toBe(200);
    const code1 = d1.code;

    // Verify to confirm phone
    if (code1) {
      await api('POST', '/verify-phone', { phone, code: code1 });
    }

    // Second request (existing user)
    const { status: s2, data: d2 } = await api('POST', '/signin/phone', { phone });
    expect(s2).toBe(200);
    expect(d2.ok).toBe(true);
    // New code should be generated
    if (d2.code && code1) {
      // Code may be different (but doesn't have to be since it's random)
      expect(typeof d2.code).toBe('string');
    }
  });
});

// ─── 2. POST /verify-phone — OTP 검증 ─────────────────────────────────────────

describe('auth-phone — verify-phone', () => {
  it('유효한 OTP → 200, user/accessToken/refreshToken 반환', async () => {
    const phone = randomPhone();
    const { data: otpData } = await api('POST', '/signin/phone', { phone });
    const code = otpData.code;

    if (code) {
      const { status, data } = await api('POST', '/verify-phone', { phone, code });
      expect(status).toBe(200);
      expect(typeof data.accessToken).toBe('string');
      expect(typeof data.refreshToken).toBe('string');
      expect(data.user?.phone).toBe(phone);
      expect(data.user?.phoneVerified).toBe(true);
    }
  });

  it('자동 생성된 유저 → verified=true, isAnonymous=false', async () => {
    const phone = randomPhone();
    const { data: otpData } = await api('POST', '/signin/phone', { phone });
    const code = otpData.code;

    if (code) {
      const { status, data } = await api('POST', '/verify-phone', { phone, code });
      expect(status).toBe(200);
      expect(data.user?.verified).toBe(true);
      expect(data.user?.isAnonymous).toBe(false);
    }
  });

  it('phone/code 누락 → 400', async () => {
    const { status } = await api('POST', '/verify-phone', {});
    expect(status).toBe(400);
  });

  it('잘못된 OTP → 401', async () => {
    const phone = randomPhone();
    await api('POST', '/signin/phone', { phone });

    const { status } = await api('POST', '/verify-phone', { phone, code: '000000' });
    expect(status).toBe(401);
  });

  it('OTP 1회용 — 재사용 불가', async () => {
    const phone = randomPhone();
    const { data: otpData } = await api('POST', '/signin/phone', { phone });
    const code = otpData.code;

    if (code) {
      // First use — success
      const { status: s1 } = await api('POST', '/verify-phone', { phone, code });
      expect(s1).toBe(200);

      // Second use — should fail (OTP deleted after first use)
      const { status: s2 } = await api('POST', '/verify-phone', { phone, code });
      expect(s2).toBe(400); // Invalid or expired OTP
    }
  });

  it('존재하지 않는 OTP → 400', async () => {
    const phone = randomPhone();
    const { status } = await api('POST', '/verify-phone', { phone, code: '123456' });
    expect(status).toBe(400);
  });

  it('OTP 시도 횟수 초과 (5회) → 429', async () => {
    const phone = randomPhone();
    await api('POST', '/signin/phone', { phone });

    // 5 wrong attempts
    for (let i = 0; i < 5; i++) {
      await api('POST', '/verify-phone', { phone, code: '000000' });
    }

    // 6th attempt — should be locked
    const { status } = await api('POST', '/verify-phone', { phone, code: '000000' });
    expect(status).toBe(429);
  });
});

// ─── 3. Phone 로그인 후 인증된 요청 ─────────────────────────────────────────────

describe('auth-phone — authenticated requests', () => {
  it('Phone 로그인 후 세션으로 인증된 요청 가능', async () => {
    const phone = randomPhone();
    const { data: otpData } = await api('POST', '/signin/phone', { phone });
    const code = otpData.code;

    if (code) {
      const { data } = await api('POST', '/verify-phone', { phone, code });
      const accessToken = data.accessToken;

      // Use the access token for an authenticated request
      const { status, data: sessData } = await api('GET', '/sessions', undefined, accessToken);
      expect(status).toBe(200);
      expect(Array.isArray(sessData.sessions)).toBe(true);
    }
  });
});

// ─── 4. POST /link/phone — 전화번호 연결 ─────────────────────────────────────

describe('auth-phone — link/phone', () => {
  it('이메일 유저에 전화번호 연결 요청 → 200, ok: true', async () => {
    const email = randomEmail();
    const { data: signup } = await api('POST', '/signup', { email, password: 'Test1234!' });
    const phone = randomPhone();

    const { status, data } = await api('POST', '/link/phone', { phone }, signup.accessToken);
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    // Dev mode: code returned for testing
    expect(typeof data.code).toBe('string');
  });

  it('미인증 → 401', async () => {
    const phone = randomPhone();
    const { status } = await api('POST', '/link/phone', { phone });
    expect(status).toBe(401);
  });

  it('phone 누락 → 400', async () => {
    const email = randomEmail();
    const { data: signup } = await api('POST', '/signup', { email, password: 'Test1234!' });

    const { status } = await api('POST', '/link/phone', {}, signup.accessToken);
    expect(status).toBe(400);
  });

  it('이미 등록된 전화번호 → 409', async () => {
    const phone = randomPhone();

    // Create phone user first
    const { data: otpData } = await api('POST', '/signin/phone', { phone });
    if (otpData.code) {
      await api('POST', '/verify-phone', { phone, code: otpData.code });
    }

    // Try to link same phone to email user
    const email = randomEmail();
    const { data: signup } = await api('POST', '/signup', { email, password: 'Test1234!' });
    const { status } = await api('POST', '/link/phone', { phone }, signup.accessToken);
    expect(status).toBe(409);
  });
});

// ─── 5. POST /verify-link-phone — 연결 OTP 검증 ──────────────────────────────

describe('auth-phone — verify-link-phone', () => {
  it('유효한 OTP로 전화번호 연결 → 200', async () => {
    const email = randomEmail();
    const { data: signup } = await api('POST', '/signup', { email, password: 'Test1234!' });
    const phone = randomPhone();

    // Request link OTP
    const { data: linkData } = await api('POST', '/link/phone', { phone }, signup.accessToken);
    const code = linkData.code;

    if (code) {
      // Verify link
      const { status, data } = await api('POST', '/verify-link-phone', { phone, code }, signup.accessToken);
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
    }
  });

  it('연결 후 Phone으로 로그인 가능', async () => {
    const email = randomEmail();
    const { data: signup } = await api('POST', '/signup', { email, password: 'Test1234!' });
    const phone = randomPhone();

    // Link phone
    const { data: linkData } = await api('POST', '/link/phone', { phone }, signup.accessToken);
    const linkCode = linkData.code;

    if (linkCode) {
      await api('POST', '/verify-link-phone', { phone, code: linkCode }, signup.accessToken);

      // Now sign in with phone
      const { data: phoneData } = await api('POST', '/signin/phone', { phone });
      const otpCode = phoneData.code;

      if (otpCode) {
        const { status, data } = await api('POST', '/verify-phone', { phone, code: otpCode });
        expect(status).toBe(200);
        expect(data.user?.email).toBe(email);
        expect(data.user?.phone).toBe(phone);
      }
    }
  });

  it('phone/code 누락 → 400', async () => {
    const email = randomEmail();
    const { data: signup } = await api('POST', '/signup', { email, password: 'Test1234!' });

    const { status } = await api('POST', '/verify-link-phone', {}, signup.accessToken);
    expect(status).toBe(400);
  });

  it('잘못된 OTP → 401', async () => {
    const email = randomEmail();
    const { data: signup } = await api('POST', '/signup', { email, password: 'Test1234!' });
    const phone = randomPhone();

    await api('POST', '/link/phone', { phone }, signup.accessToken);

    const { status } = await api('POST', '/verify-link-phone', {
      phone,
      code: '000000',
    }, signup.accessToken);
    expect(status).toBe(401);
  });

  it('미인증 → 401', async () => {
    const phone = randomPhone();
    const { status } = await api('POST', '/verify-link-phone', { phone, code: '123456' });
    expect(status).toBe(401);
  });
});

// ─── 6. 익명 → Phone 연결 ─────────────────────────────────────────────────────

describe('auth-phone — anonymous upgrade', () => {
  it('익명 유저가 Phone 연결 → isAnonymous 해제', async () => {
    // Create anonymous user
    const { data: anonData } = await api('POST', '/signin/anonymous', {});
    expect(anonData.user?.isAnonymous).toBe(true);

    const phone = randomPhone();

    // Link phone
    const { data: linkData } = await api('POST', '/link/phone', { phone }, anonData.accessToken);
    const code = linkData.code;

    if (code) {
      const { status } = await api('POST', '/verify-link-phone', { phone, code }, anonData.accessToken);
      expect(status).toBe(200);

      // Verify: sign in with phone — should have isAnonymous=false
      const { data: otpData } = await api('POST', '/signin/phone', { phone });
      if (otpData.code) {
        const { data: verifyData } = await api('POST', '/verify-phone', { phone, code: otpData.code });
        expect(verifyData.user?.isAnonymous).toBe(false);
        expect(verifyData.user?.phone).toBe(phone);
      }
    }
  });
});

// ─── 7. Admin 유저 삭제 시 Phone 인덱스 정리 ──────────────────────────────────

describe('auth-phone — admin cleanup', () => {
  it('Phone 유저 삭제 → D1 phone index 정리됨', async () => {
    const phone = randomPhone();

    // Create phone user
    const { data: otpData } = await api('POST', '/signin/phone', { phone });
    const code = otpData.code;

    if (code) {
      const { data: verifyData } = await api('POST', '/verify-phone', { phone, code });
      const userId = verifyData.user?.id;

      // Admin delete user
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': 'test-service-key-for-admin',
      };
      const delRes = await (globalThis as any).SELF.fetch(
        `${BASE}/api/auth/admin/users/${userId}`,
        { method: 'DELETE', headers },
      );
      expect(delRes.status).toBe(200);

      // After deletion, same phone should be available for new user
      const { status, data: newOtp } = await api('POST', '/signin/phone', { phone });
      expect(status).toBe(200);
      expect(newOtp.ok).toBe(true);
    }
  });
});
