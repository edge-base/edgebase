/**
 * auth-mfa.test.ts — MFA/TOTP integration tests
 *
 * 테스트 대상: src/routes/auth.ts + src/routes/admin-auth.ts → auth-do.ts
 *   POST /api/auth/mfa/totp/enroll    (TOTP 등록)
 *   POST /api/auth/mfa/totp/verify    (등록 확정)
 *   POST /api/auth/mfa/verify         (로그인 시 MFA 검증)
 *   POST /api/auth/mfa/recovery       (리커버리 코드)
 *   DELETE /api/auth/mfa/totp         (MFA 비활성화)
 *   GET /api/auth/mfa/factors         (팩터 목록)
 *   DELETE /api/admin/auth/users/:id/mfa (관리자 MFA 비활성화)
 *
 * 격리 원칙: 매 테스트마다 unique email 사용 (uuid 포함)
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

async function adminApi(
  method: string,
  path: string,
  body?: unknown,
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-EdgeBase-Service-Key': 'test-service-key-for-admin',
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
  return `mfa-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

/**
 * Generate a valid TOTP code from a secret (using Web Crypto API).
 * Mirrors the server-side TOTP generation for testing.
 */
async function generateTestTOTPCode(secret: string): Promise<string> {
  const base32Decode = (encoded: string): Uint8Array => {
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const cleaned = encoded.toUpperCase().replace(/[^A-Z2-7]/g, '');
    const bytes: number[] = [];
    let bits = 0;
    let buffer = 0;
    for (const char of cleaned) {
      const val = CHARS.indexOf(char);
      if (val === -1) continue;
      buffer = (buffer << 5) | val;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
      }
    }
    return new Uint8Array(bytes);
  };

  const key = base32Decode(secret);
  const now = Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / 30);

  const counterBytes = new Uint8Array(8);
  const view = new DataView(counterBytes.buffer);
  view.setBigUint64(0, BigInt(counter));

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  const hmac = new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, counterBytes),
  );

  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 10 ** 6;
  return otp.toString().padStart(6, '0');
}

/** Helper: create user, enroll + verify TOTP, return everything needed for MFA tests */
async function setupMfaUser() {
  const email = randomEmail();
  const password = 'Test1234!';

  // Sign up
  const { data: signupData } = await api('POST', '/signup', { email, password });
  const accessToken = signupData.accessToken;
  const userId = signupData.user.id;

  // Enroll TOTP
  const { data: enrollData } = await api('POST', '/mfa/totp/enroll', {}, accessToken);
  const { factorId, secret, recoveryCodes } = enrollData;

  // Generate valid TOTP code and verify enrollment
  const code = await generateTestTOTPCode(secret);
  await api('POST', '/mfa/totp/verify', { factorId, code }, accessToken);

  return { email, password, accessToken, userId, factorId, secret, recoveryCodes };
}

// ─── 1. TOTP Enrollment ─────────────────────────────────────────────────────

describe('auth-mfa — TOTP enrollment', () => {
  it('인증된 유저 → enroll 성공, secret/qrCodeUri/recoveryCodes 반환', async () => {
    const email = randomEmail();
    const { data: signup } = await api('POST', '/signup', { email, password: 'Test1234!' });

    const { status, data } = await api('POST', '/mfa/totp/enroll', {}, signup.accessToken);
    expect(status).toBe(200);
    expect(typeof data.factorId).toBe('string');
    expect(typeof data.secret).toBe('string');
    expect(data.secret.length).toBeGreaterThan(10);
    expect(data.qrCodeUri).toContain('otpauth://totp/');
    expect(Array.isArray(data.recoveryCodes)).toBe(true);
    expect(data.recoveryCodes.length).toBe(8);
  });

  it('미인증 → 401', async () => {
    const { status } = await api('POST', '/mfa/totp/enroll', {});
    expect(status).toBe(401);
  });

  it('이미 등록된 TOTP → 409', async () => {
    const { accessToken, secret, factorId } = await setupMfaUser();

    // Try enrolling again
    const { status, data } = await api('POST', '/mfa/totp/enroll', {}, accessToken);
    expect(status).toBe(409);
    expect(data.message).toContain('already enrolled');
  });
});

// ─── 2. TOTP Enrollment Verification ────────────────────────────────────────

describe('auth-mfa — TOTP enrollment verification', () => {
  it('유효한 TOTP 코드 → 등록 확정', async () => {
    const email = randomEmail();
    const { data: signup } = await api('POST', '/signup', { email, password: 'Test1234!' });

    const { data: enrollData } = await api('POST', '/mfa/totp/enroll', {}, signup.accessToken);
    const code = await generateTestTOTPCode(enrollData.secret);

    const { status, data } = await api('POST', '/mfa/totp/verify', {
      factorId: enrollData.factorId,
      code,
    }, signup.accessToken);

    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('잘못된 TOTP 코드 → 400', async () => {
    const email = randomEmail();
    const { data: signup } = await api('POST', '/signup', { email, password: 'Test1234!' });
    const { data: enrollData } = await api('POST', '/mfa/totp/enroll', {}, signup.accessToken);

    const { status } = await api('POST', '/mfa/totp/verify', {
      factorId: enrollData.factorId,
      code: '000000',
    }, signup.accessToken);

    expect(status).toBe(400);
  });

  it('factorId/code 누락 → 400', async () => {
    const email = randomEmail();
    const { data: signup } = await api('POST', '/signup', { email, password: 'Test1234!' });

    const { status } = await api('POST', '/mfa/totp/verify', {}, signup.accessToken);
    expect(status).toBe(400);
  });
});

// ─── 3. MFA Login Flow ──────────────────────────────────────────────────────

describe('auth-mfa — MFA login flow', () => {
  it('MFA 활성화 유저 로그인 → mfaRequired + mfaTicket 반환', async () => {
    const { email, password } = await setupMfaUser();

    // Try to sign in
    const { status, data } = await api('POST', '/signin', { email, password });
    expect(status).toBe(200);
    expect(data.mfaRequired).toBe(true);
    expect(typeof data.mfaTicket).toBe('string');
    expect(Array.isArray(data.factors)).toBe(true);
    expect(data.factors.length).toBeGreaterThan(0);
    // Should NOT have accessToken/refreshToken yet
    expect(data.accessToken).toBeUndefined();
    expect(data.refreshToken).toBeUndefined();
  });

  it('MFA 검증 (mfaTicket + TOTP 코드) → 세션 발급', async () => {
    const { email, password, secret } = await setupMfaUser();

    // Sign in → get mfaTicket
    const { data: signinData } = await api('POST', '/signin', { email, password });
    const mfaTicket = signinData.mfaTicket;

    // Generate valid TOTP code
    const code = await generateTestTOTPCode(secret);

    // Verify MFA
    const { status, data } = await api('POST', '/mfa/verify', { mfaTicket, code });
    expect(status).toBe(200);
    expect(typeof data.accessToken).toBe('string');
    expect(typeof data.refreshToken).toBe('string');
    expect(data.user?.email).toBe(email);
  });

  it('잘못된 TOTP 코드 → 401', async () => {
    const { email, password } = await setupMfaUser();

    const { data: signinData } = await api('POST', '/signin', { email, password });

    const { status } = await api('POST', '/mfa/verify', {
      mfaTicket: signinData.mfaTicket,
      code: '000000',
    });
    expect(status).toBe(401);
  });

  it('잘못된/만료된 mfaTicket → 400', async () => {
    const { status } = await api('POST', '/mfa/verify', {
      mfaTicket: 'invalid-ticket-12345',
      code: '123456',
    });
    expect(status).toBe(400);
  });

  it('mfaTicket/code 누락 → 400', async () => {
    const { status } = await api('POST', '/mfa/verify', {});
    expect(status).toBe(400);
  });
});

// ─── 4. Recovery Code ───────────────────────────────────────────────────────

describe('auth-mfa — recovery code', () => {
  it('리커버리 코드로 MFA 인증 성공', async () => {
    const { email, password, recoveryCodes } = await setupMfaUser();

    // Sign in → get mfaTicket
    const { data: signinData } = await api('POST', '/signin', { email, password });

    // Use first recovery code
    const { status, data } = await api('POST', '/mfa/recovery', {
      mfaTicket: signinData.mfaTicket,
      recoveryCode: recoveryCodes[0],
    });
    expect(status).toBe(200);
    expect(typeof data.accessToken).toBe('string');
    expect(typeof data.refreshToken).toBe('string');
  });

  it('리커버리 코드 1회용 — 재사용 불가', async () => {
    const { email, password, recoveryCodes } = await setupMfaUser();

    // First use
    const { data: signin1 } = await api('POST', '/signin', { email, password });
    const { status: status1 } = await api('POST', '/mfa/recovery', {
      mfaTicket: signin1.mfaTicket,
      recoveryCode: recoveryCodes[0],
    });
    expect(status1).toBe(200);

    // Second use of same code
    const { data: signin2 } = await api('POST', '/signin', { email, password });
    const { status: status2 } = await api('POST', '/mfa/recovery', {
      mfaTicket: signin2.mfaTicket,
      recoveryCode: recoveryCodes[0],
    });
    expect(status2).toBe(401);
  });

  it('잘못된 리커버리 코드 → 401', async () => {
    const { email, password } = await setupMfaUser();

    const { data: signinData } = await api('POST', '/signin', { email, password });

    const { status } = await api('POST', '/mfa/recovery', {
      mfaTicket: signinData.mfaTicket,
      recoveryCode: 'wrongcode',
    });
    expect(status).toBe(401);
  });
});

// ─── 5. MFA Factor Listing ──────────────────────────────────────────────────

describe('auth-mfa — factor listing', () => {
  it('등록된 팩터 목록 반환', async () => {
    const { accessToken } = await setupMfaUser();

    const { status, data } = await api('GET', '/mfa/factors', undefined, accessToken);
    expect(status).toBe(200);
    expect(Array.isArray(data.factors)).toBe(true);
    expect(data.factors.length).toBe(1);
    expect(data.factors[0].type).toBe('totp');
    expect(data.factors[0].verified).toBe(true);
  });

  it('MFA 미등록 유저 → 빈 배열', async () => {
    const email = randomEmail();
    const { data: signup } = await api('POST', '/signup', { email, password: 'Test1234!' });

    const { status, data } = await api('GET', '/mfa/factors', undefined, signup.accessToken);
    expect(status).toBe(200);
    expect(data.factors).toEqual([]);
  });
});

// ─── 6. MFA Disable ─────────────────────────────────────────────────────────

describe('auth-mfa — disable TOTP', () => {
  it('비밀번호로 MFA 비활성화', async () => {
    const { email, password, accessToken } = await setupMfaUser();

    const { status, data } = await api('DELETE', '/mfa/totp', { password }, accessToken);
    expect(status).toBe(200);
    expect(data.ok).toBe(true);

    // Verify: signin should now return tokens directly (no MFA)
    const { data: signinData } = await api('POST', '/signin', { email, password });
    expect(signinData.mfaRequired).toBeUndefined();
    expect(typeof signinData.accessToken).toBe('string');
  });

  it('TOTP 코드로 MFA 비활성화', async () => {
    const { accessToken, secret } = await setupMfaUser();

    const code = await generateTestTOTPCode(secret);
    const { status, data } = await api('DELETE', '/mfa/totp', { code }, accessToken);
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('비밀번호/코드 없이 비활성화 시도 → 400', async () => {
    const { accessToken } = await setupMfaUser();

    const { status } = await api('DELETE', '/mfa/totp', {}, accessToken);
    expect(status).toBe(400);
  });

  it('잘못된 비밀번호 → 401', async () => {
    const { accessToken } = await setupMfaUser();

    const { status } = await api('DELETE', '/mfa/totp', { password: 'WrongPass!' }, accessToken);
    expect(status).toBe(401);
  });
});

// ─── 7. Admin MFA Disable ───────────────────────────────────────────────────

describe('auth-mfa — admin disable', () => {
  it('Admin이 유저 MFA 강제 비활성화', async () => {
    const { email, password, userId } = await setupMfaUser();

    // Admin disable MFA
    const { status, data } = await adminApi('DELETE', `/users/${userId}/mfa`);
    expect(status).toBe(200);
    expect(data.ok).toBe(true);

    // Verify: signin should now return tokens directly
    const { data: signinData } = await api('POST', '/signin', { email, password });
    expect(signinData.mfaRequired).toBeUndefined();
    expect(typeof signinData.accessToken).toBe('string');
  });
});

// ─── 8. MFA 없는 기존 유저 영향 없음 ────────────────────────────────────────

describe('auth-mfa — backwards compatibility', () => {
  it('MFA 미등록 유저는 기존대로 로그인 가능', async () => {
    const email = randomEmail();
    const password = 'Test1234!';
    await api('POST', '/signup', { email, password });

    const { status, data } = await api('POST', '/signin', { email, password });
    expect(status).toBe(200);
    expect(data.mfaRequired).toBeUndefined();
    expect(typeof data.accessToken).toBe('string');
    expect(typeof data.refreshToken).toBe('string');
  });
});

// ─── 9. MFA + 세션 후 인증된 요청 ────────────────────────────────────────────

describe('auth-mfa — authenticated requests after MFA', () => {
  it('MFA 로그인 후 세션으로 인증된 요청 가능', async () => {
    const { email, password, secret } = await setupMfaUser();

    // Full MFA login flow
    const { data: signinData } = await api('POST', '/signin', { email, password });
    const code = await generateTestTOTPCode(secret);
    const { data: verifyData } = await api('POST', '/mfa/verify', {
      mfaTicket: signinData.mfaTicket,
      code,
    });

    // Use the session token for an authenticated request
    const { status, data } = await api('GET', '/sessions', undefined, verifyData.accessToken);
    expect(status).toBe(200);
    expect(Array.isArray(data.sessions)).toBe(true);
  });
});
