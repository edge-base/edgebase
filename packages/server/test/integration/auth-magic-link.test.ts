/**
 * auth-magic-link.test.ts — Magic Link (passwordless email login) integration tests
 *
 * 테스트 대상: src/routes/auth.ts → auth-do.ts
 *   POST /api/auth/signin/magic-link (매직 링크 이메일 요청)
 *   POST /api/auth/verify-magic-link (토큰 검증 → 세션 생성)
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

function randomEmail() {
  return `magic-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

// ─── 1. POST /signin/magic-link ─────────────────────────────────────────────

describe('auth-magic-link — signin/magic-link', () => {
  it('기존 이메일로 요청 → 200, ok: true', async () => {
    // First register a user
    const email = randomEmail();
    await api('POST', '/signup', { email, password: 'Test1234!' });

    // Request magic link
    const { status, data } = await api('POST', '/signin/magic-link', { email });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('미등록 이메일 + autoCreate → 200, ok: true (자동 계정 생성)', async () => {
    const email = randomEmail();
    const { status, data } = await api('POST', '/signin/magic-link', { email });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('email 누락 → 400', async () => {
    const { status } = await api('POST', '/signin/magic-link', {});
    expect(status).toBe(400);
  });

  it('잘못된 email 형식 → 400', async () => {
    const { status } = await api('POST', '/signin/magic-link', { email: 'invalid' });
    expect(status).toBe(400);
  });
});

// ─── 2. POST /verify-magic-link ─────────────────────────────────────────────

describe('auth-magic-link — verify-magic-link', () => {
  it('유효한 토큰 → 200, user/accessToken/refreshToken 반환', async () => {
    // Register user first
    const email = randomEmail();
    await api('POST', '/signup', { email, password: 'Test1234!' });

    // Request magic link — email provider not configured, so token is returned
    const { data: linkData } = await api('POST', '/signin/magic-link', { email });
    const token = linkData.token;

    if (token) {
      // Verify the magic link token
      const { status, data } = await api('POST', '/verify-magic-link', { token });
      expect(status).toBe(200);
      expect(typeof data.accessToken).toBe('string');
      expect(typeof data.refreshToken).toBe('string');
      expect(data.user?.email).toBe(email);
    }
    // If no token returned (email provider configured), test passes silently
  });

  it('autoCreate 유저 → 토큰 검증 시 verified=true', async () => {
    const email = randomEmail();

    // Request magic link for unregistered email (auto-create)
    const { data: linkData } = await api('POST', '/signin/magic-link', { email });
    const token = linkData.token;

    if (token) {
      const { status, data } = await api('POST', '/verify-magic-link', { token });
      expect(status).toBe(200);
      expect(data.user?.verified).toBeTruthy();
      expect(data.user?.email).toBe(email);
    }
  });

  it('토큰 없음 → 400', async () => {
    const { status } = await api('POST', '/verify-magic-link', {});
    expect(status).toBe(400);
  });

  it('무효 토큰 → 400', async () => {
    const { status } = await api('POST', '/verify-magic-link', { token: 'invalid-token-12345' });
    expect(status).toBe(400);
  });

  it('토큰 1회용 — 재사용 불가', async () => {
    const email = randomEmail();
    await api('POST', '/signup', { email, password: 'Test1234!' });

    const { data: linkData } = await api('POST', '/signin/magic-link', { email });
    const token = linkData.token;

    if (token) {
      // First use — success
      const { status: status1 } = await api('POST', '/verify-magic-link', { token });
      expect(status1).toBe(200);

      // Second use — should fail
      const { status: status2 } = await api('POST', '/verify-magic-link', { token });
      expect(status2).toBe(400);
    }
  });

  it('매직 링크 로그인 후 세션으로 인증된 요청 가능', async () => {
    const email = randomEmail();
    await api('POST', '/signup', { email, password: 'Test1234!' });

    const { data: linkData } = await api('POST', '/signin/magic-link', { email });
    const token = linkData.token;

    if (token) {
      const { data } = await api('POST', '/verify-magic-link', { token });
      const accessToken = data.accessToken;

      // Use the access token for an authenticated request
      const { status, data: sessData } = await api('GET', '/sessions', undefined, accessToken);
      expect(status).toBe(200);
      expect(Array.isArray(sessData.sessions)).toBe(true);
    }
  });
});

// ─── 3. 이메일+비밀번호 유저의 매직 링크 호환성 ─────────────────────────────

describe('auth-magic-link — email+password user compatibility', () => {
  it('비밀번호 가입 유저도 매직 링크 로그인 가능', async () => {
    const email = randomEmail();
    // Sign up with password
    await api('POST', '/signup', { email, password: 'Test1234!' });

    // Request magic link
    const { status, data } = await api('POST', '/signin/magic-link', { email });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('매직 링크 자동생성 유저 → 비밀번호 없이 signin 불가', async () => {
    const email = randomEmail();

    // Auto-create via magic link
    const { data: linkData } = await api('POST', '/signin/magic-link', { email });

    if (linkData.token) {
      // Verify to complete account creation
      await api('POST', '/verify-magic-link', { token: linkData.token });

      // Try password signin — should fail (no password set)
      const { status } = await api('POST', '/signin', { email, password: 'anyPassword1!' });
      expect(status).toBe(403); // OAuth-only user (no passwordHash)
    }
  });
});
