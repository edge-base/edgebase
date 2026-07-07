/**
 * auth-hooks-signup.test.ts — beforeSignUp 훅 실행 순서 통합 테스트
 *
 * 테스트 대상: src/routes/auth.ts
 *   POST /api/auth/signup             (password signup)
 *   POST /api/auth/signin/magic-link  (autoCreate)
 *   POST /api/auth/signin/phone       (autoCreate)
 *   POST /api/auth/signin/email-otp   (autoCreate)
 *
 * blocking beforeSignUp 훅은 registerEmailPending/registerPhonePending 보다
 * 먼저 실행되어야 한다. 훅 거부 시 pending email/phone 인덱스 엔트리가
 * 남지 않아야 하며 — 같은 email/phone으로 재시도(훅 허용 시)하면
 * 가입이 성공해야 한다 (stale pending 재발 방지 회귀 테스트).
 *
 * 훅 정의: edgebase.test.config.ts → 'test-signup-gate' 플러그인
 *   - email에 'gate-reject-always' 포함 → 항상 거부
 *   - email에 'gate-reject-once' 포함 / phone이 '+1999999'로 시작 → 첫 시도만 거부
 *
 * 격리: 매 테스트마다 unique email/phone 사용
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

// 'gate-reject-once' — 훅이 첫 시도만 거부, 이후 허용
function rejectOnceEmail() {
  return `gate-reject-once-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

// 'gate-reject-always' — 훅이 항상 거부
function rejectAlwaysEmail() {
  return `gate-reject-always-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

// 훅이 항상 허용하는 일반 email
function normalEmail() {
  return `hook-order-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

// '+1999999' prefix — 훅이 첫 시도만 거부하는 phone (E.164: +1 + 10 digits)
function rejectOncePhone() {
  const digits = Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join('');
  return `+1999999${digits}`;
}

// D1 email/phone index 직접 조회 — pending 엔트리 잔존 여부 확인용
async function emailIndexRow(email: string) {
  return (globalThis as any).env.AUTH_DB
    .prepare('SELECT email, status FROM _email_index WHERE email = ?')
    .bind(email)
    .first();
}

async function phoneIndexRow(phone: string) {
  return (globalThis as any).env.AUTH_DB
    .prepare('SELECT phone, status FROM _phone_index WHERE phone = ?')
    .bind(phone)
    .first();
}

// ─── 1. POST /signup — password signup ────────────────────────────────────────

describe('auth-hooks-signup — signup (password)', () => {
  it('훅 거부 → 403 hook-rejected, 유저/인덱스 엔트리 생성 안 됨', async () => {
    const email = rejectAlwaysEmail();
    const { status, data } = await api('POST', '/signup', { email, password: 'Gate1234!' });
    expect(status).toBe(403);
    expect(data.slug).toBe('hook-rejected');

    // pending email 인덱스 엔트리가 남지 않아야 함
    const row = await emailIndexRow(email);
    expect(row).toBeNull();

    // 유저도 생성되지 않았어야 함 → signin 401
    const { status: signinStatus } = await api('POST', '/signin', { email, password: 'Gate1234!' });
    expect(signinStatus).toBe(401);
  });

  it('훅 거부 후 같은 email 재가입(훅 허용) → 201 (stale pending 없음)', async () => {
    const email = rejectOnceEmail();

    // 첫 시도 — 훅 거부 → 403
    const { status: s1 } = await api('POST', '/signup', { email, password: 'Gate1234!' });
    expect(s1).toBe(403);

    // 같은 email 재시도 — 훅 허용 → 정상 가입
    const { status: s2, data } = await api('POST', '/signup', { email, password: 'Gate1234!' });
    expect(s2).toBe(201);
    expect(typeof data.accessToken).toBe('string');
    expect(data.user?.email).toBe(email);

    // 가입 완료 후 세 번째 시도 → 중복 409
    const { status: s3 } = await api('POST', '/signup', { email, password: 'Gate1234!' });
    expect(s3).toBe(409);
  });

  it('훅 허용 → 201 정상 가입 (end-to-end)', async () => {
    const email = normalEmail();
    const { status, data } = await api('POST', '/signup', { email, password: 'Gate1234!' });
    expect(status).toBe(201);
    expect(typeof data.accessToken).toBe('string');
    expect(typeof data.refreshToken).toBe('string');
    expect(data.user?.email).toBe(email);
  });

  it('중복 email → 409 (lookupEmail 선행 체크)', async () => {
    const email = normalEmail();
    const { status: s1 } = await api('POST', '/signup', { email, password: 'Gate1234!' });
    expect(s1).toBe(201);

    const { status: s2, data } = await api('POST', '/signup', { email, password: 'Gate1234!' });
    expect(s2).toBe(409);
    expect(data.slug).toBe('email-already-exists');
  });
});

// ─── 2. POST /signin/magic-link — autoCreate ──────────────────────────────────

describe('auth-hooks-signup — signin/magic-link autoCreate', () => {
  it('훅 거부 → 403, pending 엔트리/유저 생성 안 됨', async () => {
    const email = rejectAlwaysEmail();
    const { status, data } = await api('POST', '/signin/magic-link', { email });
    expect(status).toBe(403);
    expect(data.slug).toBe('hook-rejected');

    const row = await emailIndexRow(email);
    expect(row).toBeNull();
  });

  it('훅 거부 후 같은 email 재요청(훅 허용) → 200, verify로 세션 생성', async () => {
    const email = rejectOnceEmail();

    // 첫 시도 — 훅 거부 → 403
    const { status: s1 } = await api('POST', '/signin/magic-link', { email });
    expect(s1).toBe(403);

    // 같은 email 재시도 — 훅 허용 → auto-create 성공
    const { status: s2, data: linkData } = await api('POST', '/signin/magic-link', { email });
    expect(s2).toBe(200);
    expect(linkData.ok).toBe(true);
    expect(typeof linkData.token).toBe('string');

    // 토큰 검증 → 세션 정상 생성
    const { status: s3, data } = await api('POST', '/verify-magic-link', { token: linkData.token });
    expect(s3).toBe(200);
    expect(typeof data.accessToken).toBe('string');
    expect(data.user?.email).toBe(email);
  });

  it('훅 허용 → 200 ok, auto-create end-to-end', async () => {
    const email = normalEmail();
    const { status, data: linkData } = await api('POST', '/signin/magic-link', { email });
    expect(status).toBe(200);
    expect(linkData.ok).toBe(true);
    expect(typeof linkData.token).toBe('string');

    const { status: s2, data } = await api('POST', '/verify-magic-link', { token: linkData.token });
    expect(s2).toBe(200);
    expect(data.user?.email).toBe(email);
  });

  it('기존 등록 email → 200 ok:true (enumeration-safe)', async () => {
    const email = normalEmail();
    await api('POST', '/signup', { email, password: 'Gate1234!' });

    const { status, data } = await api('POST', '/signin/magic-link', { email });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });
});

// ─── 3. POST /signin/phone — autoCreate ───────────────────────────────────────

describe('auth-hooks-signup — signin/phone autoCreate', () => {
  it('훅 거부 → 403, pending phone 엔트리 생성 안 됨', async () => {
    const phone = rejectOncePhone();

    // 첫 시도 — 훅 거부 → 403
    const { status, data } = await api('POST', '/signin/phone', { phone });
    expect(status).toBe(403);
    expect(data.slug).toBe('hook-rejected');

    const row = await phoneIndexRow(phone);
    expect(row).toBeNull();
  });

  it('훅 거부 후 같은 phone 재요청(훅 허용) → 200, verify로 세션 생성', async () => {
    const phone = rejectOncePhone();

    // 첫 시도 — 훅 거부 → 403
    const { status: s1 } = await api('POST', '/signin/phone', { phone });
    expect(s1).toBe(403);

    // 같은 phone 재시도 — 훅 허용 → auto-create + OTP 발급
    const { status: s2, data: otpData } = await api('POST', '/signin/phone', { phone });
    expect(s2).toBe(200);
    expect(otpData.ok).toBe(true);
    expect(typeof otpData.code).toBe('string');

    // OTP 검증 → 세션 정상 생성
    const { status: s3, data } = await api('POST', '/verify-phone', { phone, code: otpData.code });
    expect(s3).toBe(200);
    expect(typeof data.accessToken).toBe('string');
    expect(data.user?.phone).toBe(phone);
  });

  it('기존 등록 phone → 200 ok:true (enumeration-safe)', async () => {
    const phone = rejectOncePhone();

    // 첫 시도 소진(403) 후 가입 완료
    await api('POST', '/signin/phone', { phone });
    const { data: otpData } = await api('POST', '/signin/phone', { phone });
    await api('POST', '/verify-phone', { phone, code: otpData.code });

    // 기존 유저 phone으로 재요청 — 훅 미실행(record 존재) → ok:true
    const { status, data } = await api('POST', '/signin/phone', { phone });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });
});

// ─── 4. POST /signin/email-otp — autoCreate ───────────────────────────────────

describe('auth-hooks-signup — signin/email-otp autoCreate', () => {
  it('훅 거부 → 403, pending 엔트리 생성 안 됨', async () => {
    const email = rejectAlwaysEmail();
    const { status, data } = await api('POST', '/signin/email-otp', { email });
    expect(status).toBe(403);
    expect(data.slug).toBe('hook-rejected');

    const row = await emailIndexRow(email);
    expect(row).toBeNull();
  });

  it('훅 거부 후 같은 email 재요청(훅 허용) → 200, verify로 세션 생성', async () => {
    const email = rejectOnceEmail();

    // 첫 시도 — 훅 거부 → 403
    const { status: s1 } = await api('POST', '/signin/email-otp', { email });
    expect(s1).toBe(403);

    // 같은 email 재시도 — 훅 허용 → auto-create + OTP 발급
    const { status: s2, data: otpData } = await api('POST', '/signin/email-otp', { email });
    expect(s2).toBe(200);
    expect(otpData.ok).toBe(true);
    expect(typeof otpData.code).toBe('string');

    // OTP 검증 → 세션 정상 생성
    const { status: s3, data } = await api('POST', '/verify-email-otp', { email, code: otpData.code });
    expect(s3).toBe(200);
    expect(typeof data.accessToken).toBe('string');
    expect(data.user?.email).toBe(email);
  });

  it('훅 허용 → 200 ok, auto-create end-to-end', async () => {
    const email = normalEmail();
    const { status, data: otpData } = await api('POST', '/signin/email-otp', { email });
    expect(status).toBe(200);
    expect(otpData.ok).toBe(true);
    expect(typeof otpData.code).toBe('string');

    const { status: s2, data } = await api('POST', '/verify-email-otp', { email, code: otpData.code });
    expect(s2).toBe(200);
    expect(data.user?.email).toBe(email);
  });

  it('기존 등록 email → 200 ok:true (enumeration-safe, lookupEmail 선행)', async () => {
    const email = normalEmail();
    await api('POST', '/signup', { email, password: 'Gate1234!' });

    // 기존 유저 email로 OTP 요청 — 훅 미실행(record 존재) → ok:true
    const { status, data } = await api('POST', '/signin/email-otp', { email });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });
});
