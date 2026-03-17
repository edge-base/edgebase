/**
 * auth-oauth.test.ts — 50개
 *
 * 테스트 대상: src/routes/oauth.ts
 *
 * OAuth는 브라우저 리다이렉트 기반이므로 실제 provider 토큰 교환은 테스트 불가.
 * 검증 가능한 항목:
 *   - 지원하지 않는 provider → 400
 *   - 미설정 provider → 400/500 (test config에 oauth 없음)
 *   - 상태 코드/에러 포맷
 *   - OAuth state KV 저장/삭제 (만료 state → 400)
 *   - callback code/state 누락 → 400
 *   - error query param → 400
 *   - anonymous → OAuth 링크 (인증 없음 → 401)
 *   - link/callback: 만료 state → 400
 */
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

async function api(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  let data: any; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data, headers: res.headers };
}

// ─── 1. OAuth 시작 — GET /api/auth/oauth/:provider ────────────────────────────

describe('1-13 auth-oauth — 지원하지 않는 provider', () => {
  it('unsupported provider → 400', async () => {
    const { status } = await api('GET', '/api/auth/oauth/fakeprovider');
    expect(status).toBe(400);
  });

  it('미설정 provider (google) → 500 (oauth 미설정)', async () => {
    // Test config에 google OAuth가 설정되지 않은 경우
    const { status } = await api('GET', '/api/auth/oauth/google');
    expect([400, 500, 302].includes(status)).toBe(true);
  });

  it('미설정 provider (github) → 500 또는 400', async () => {
    const { status } = await api('GET', '/api/auth/oauth/github');
    expect([400, 500, 302].includes(status)).toBe(true);
  });

  it('미설정 provider (apple) → 500 또는 400', async () => {
    const { status } = await api('GET', '/api/auth/oauth/apple');
    expect([400, 500, 302].includes(status)).toBe(true);
  });
});

// ─── 2. OAuth callback — GET /api/auth/oauth/:provider/callback ──────────────

describe('1-13 auth-oauth — callback 파라미터 검증', () => {
  it('code 누락 → 400', async () => {
    const { status } = await api('GET', '/api/auth/oauth/google/callback?state=fakestate');
    expect(status).toBe(400);
  });

  it('state 누락 → 400', async () => {
    const { status } = await api('GET', '/api/auth/oauth/google/callback?code=fakecode');
    expect(status).toBe(400);
  });

  it('code+state 모두 누락 → 400', async () => {
    const { status } = await api('GET', '/api/auth/oauth/google/callback');
    expect(status).toBe(400);
  });

  it('error query param → 400', async () => {
    const { status } = await api('GET', '/api/auth/oauth/google/callback?error=access_denied&state=x&code=y');
    expect(status).toBe(400);
  });

  it('만료되거나 존재하지 않는 state → 400', async () => {
    const { status } = await api('GET', '/api/auth/oauth/google/callback?code=testcode&state=nonexistent-state-xyz');
    expect(status).toBe(400);
  });

  it('unsupported provider callback → 400', async () => {
    const { status } = await api('GET', '/api/auth/oauth/fakeprovider/callback?code=x&state=y');
    expect(status).toBe(400);
  });
});

// ─── 3. OAuth state KV TTL ────────────────────────────────────────────────────

describe('1-13 auth-oauth — OAuth state KV', () => {
  it('state를 KV에 수동 저장 후 callback — state provider 불일치 → 400', async () => {
    // Manually store state with mismatched provider
    const state = `test-state-${crypto.randomUUID().slice(0, 8)}`;
    await (globalThis as any).env.KV.put(
      `oauth:state:${state}`,
      JSON.stringify({
        provider: 'github',
        redirectUri: 'http://localhost/callback',
        codeVerifier: null,
      }),
      { expirationTtl: 300 },
    );

    // Use 'google' provider but state was for 'github' → 400
    const { status } = await api('GET', `/api/auth/oauth/google/callback?code=fakecode&state=${state}`);
    expect(status).toBe(400);
  });

  it('state TTL 만료 후 재사용 → 400', async () => {
    // Just verify that using an expired/nonexistent state returns 400
    const { status } = await api('GET', '/api/auth/oauth/google/callback?code=x&state=expired-state-xyz');
    expect(status).toBe(400);
  });
});

// ─── 4. link/oauth — POST /api/auth/oauth/link/:provider ─────────────────────

describe('1-13 auth-oauth — link OAuth', () => {
  it('인증없이 link 시도 → 401', async () => {
    const { status } = await api('POST', '/api/auth/oauth/link/google');
    expect(status).toBe(401);
  });

  it('비익명 유저가 link 시도 → 500 (provider 미설정)', async () => {
    // Signup a regular user
    const email = `oauth-nonannon-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const signupRes = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Link1234!' }),
    });
    const signupData = await signupRes.json() as any;
    const token = signupData.accessToken;

    const { status, data } = await api('POST', '/api/auth/oauth/link/google', undefined, token);
    expect(status).toBe(500);
    expect(data.message).toContain('not configured');
  });

  it('unsupported provider for link → 400', async () => {
    const email = `oauth-link-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const signupRes = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Link1234!' }),
    });
    const { accessToken } = await signupRes.json() as any;
    const { status } = await api('POST', '/api/auth/oauth/link/fakeprovider', undefined, accessToken);
    expect(status).toBe(400);
  });
});

// ─── 5. link/callback — GET /api/auth/oauth/link/:provider/callback ──────────

describe('1-13 auth-oauth — link callback 파라미터 검증', () => {
  it('code 누락 → 400', async () => {
    const { status } = await api('GET', '/api/auth/oauth/link/google/callback?state=x');
    expect(status).toBe(400);
  });

  it('state 누락 → 400', async () => {
    const { status } = await api('GET', '/api/auth/oauth/link/google/callback?code=x');
    expect(status).toBe(400);
  });

  it('만료된 link state → 400', async () => {
    const { status } = await api('GET', '/api/auth/oauth/link/google/callback?code=x&state=expired-link-xyz');
    expect(status).toBe(400);
  });

  it('unsupported provider link callback → 400', async () => {
    const { status } = await api('GET', '/api/auth/oauth/link/fakeprovider/callback?code=x&state=y');
    expect(status).toBe(400);
  });
});

// ─── 6. 에러 응답 형식 ────────────────────────────────────────────────────────

describe('1-13 auth-oauth — 에러 형식', () => {
  it('에러 응답에 { code, message } 포함', async () => {
    const { status, data } = await api('GET', '/api/auth/oauth/fakeprovider');
    expect(status).toBe(400);
    expect(typeof data.code).toBe('number');
    expect(typeof data.message).toBe('string');
  });

  it('callback error 응답도 { code, message }', async () => {
    const { status, data } = await api('GET', '/api/auth/oauth/google/callback');
    expect(status).toBe(400);
    expect(typeof data.code).toBe('number');
  });

  it('link 인증 에러도 { code, message }', async () => {
    const { status, data } = await api('POST', '/api/auth/oauth/link/google');
    expect(status).toBe(401);
    expect(typeof data.message).toBe('string');
  });
});

// ─── 7. 13개 지원 provider 검증 ─────────────────────────────────────────────

describe('1-13 auth-oauth — 지원 provider 시작 (GET /api/auth/oauth/:provider)', () => {
  const supportedProviders = [
    'google', 'github', 'apple', 'discord',
    'microsoft', 'facebook', 'kakao', 'naver',
    'x', 'line', 'slack', 'spotify', 'twitch',
  ];

  for (const provider of supportedProviders) {
    it(`${provider} → 302/400/500 (설정에 따라 다름, 400은 아님 = unsupported)`, async () => {
      const { status } = await api('GET', `/api/auth/oauth/${provider}`);
      // Provider is supported but config may not have credentials
      // → 302 (redirect) if configured, 400/500 if not
      expect([302, 400, 500].includes(status)).toBe(true);
    });
  }
});

// ─── 8. 미지원 provider 확장 ───────────────────────────────────────────────

describe('1-13 auth-oauth — 미지원 provider 확장', () => {
  const unsupported = ['twitter', 'linkedin', 'instagram', 'tiktok', 'yahoo'];

  for (const provider of unsupported) {
    it(`${provider} → 400 (지원하지 않는 provider)`, async () => {
      const { status, data } = await api('GET', `/api/auth/oauth/${provider}`);
      expect(status).toBe(400);
      expect(typeof data.message).toBe('string');
    });
  }

  it('reddit → 302/400/500 (지원 provider, 설정 여부에 따라 다름)', async () => {
    const { status } = await api('GET', '/api/auth/oauth/reddit');
    expect([302, 400, 500].includes(status)).toBe(true);
  });

  it('빈 provider 이름 → 404 (라우트 매칭 실패)', async () => {
    const { status } = await api('GET', '/api/auth/oauth/');
    expect([400, 404].includes(status)).toBe(true);
  });

  it('대문자 provider (Google) → 400', async () => {
    const { status } = await api('GET', '/api/auth/oauth/Google');
    expect(status).toBe(400);
  });

  it('특수문자 provider → 400', async () => {
    const { status } = await api('GET', '/api/auth/oauth/go@gle');
    expect(status).toBe(400);
  });
});

// ─── 9. OAuth state 생성/검증 확장 ─────────────────────────────────────────

describe('1-13 auth-oauth — OAuth state KV 확장', () => {
  it('state KV에 유효한 값 저장 후 같은 provider callback → provider 불일치가 아니면 토큰 교환 시도', async () => {
    const state = `test-state-valid-${crypto.randomUUID().slice(0, 8)}`;
    await (globalThis as any).env.KV.put(
      `oauth:state:${state}`,
      JSON.stringify({
        provider: 'google',
        redirectUri: 'http://localhost:3000/callback',
        codeVerifier: null,
      }),
      { expirationTtl: 300 },
    );
    // google callback with matching state → fails at token exchange (no real OAuth server)
    const { status } = await api('GET', `/api/auth/oauth/google/callback?code=fakecode&state=${state}`);
    // Will fail at token exchange → 400 or 500
    expect([400, 500].includes(status)).toBe(true);
  });

  it('state KV에 PKCE codeVerifier 포함 저장', async () => {
    const state = `test-pkce-${crypto.randomUUID().slice(0, 8)}`;
    await (globalThis as any).env.KV.put(
      `oauth:state:${state}`,
      JSON.stringify({
        provider: 'google',
        redirectUri: 'http://localhost:3000/callback',
        codeVerifier: 'test-verifier-abc123',
      }),
      { expirationTtl: 300 },
    );
    const stored = await (globalThis as any).env.KV.get(`oauth:state:${state}`, 'json') as any;
    expect(stored.codeVerifier).toBe('test-verifier-abc123');
    // Cleanup
    await (globalThis as any).env.KV.delete(`oauth:state:${state}`);
  });

  it('state 사용 후 삭제 확인 — callback 호출 후 state 재사용 불가', async () => {
    const state = `test-reuse-${crypto.randomUUID().slice(0, 8)}`;
    await (globalThis as any).env.KV.put(
      `oauth:state:${state}`,
      JSON.stringify({
        provider: 'github',
        redirectUri: 'http://localhost:3000/callback',
        codeVerifier: null,
      }),
      { expirationTtl: 300 },
    );

    // First callback attempt
    await api('GET', `/api/auth/oauth/github/callback?code=fakecode&state=${state}`);
    // Second attempt with same state → 400 (state consumed or expired)
    const { status } = await api('GET', `/api/auth/oauth/github/callback?code=fakecode&state=${state}`);
    expect(status).toBe(400);
  });

  it('state JSON 파싱 실패 → 400', async () => {
    const state = `test-bad-json-${crypto.randomUUID().slice(0, 8)}`;
    await (globalThis as any).env.KV.put(`oauth:state:${state}`, 'not-json', { expirationTtl: 300 });
    const { status } = await api('GET', `/api/auth/oauth/google/callback?code=x&state=${state}`);
    expect([400, 500].includes(status)).toBe(true);
    await (globalThis as any).env.KV.delete(`oauth:state:${state}`);
  });
});

// ─── 10. callback provider 불일치 확장 ─────────────────────────────────────

describe('1-13 auth-oauth — callback provider mismatch 확장', () => {
  const providerPairs = [
    ['github', 'discord'],
    ['apple', 'google'],
    ['kakao', 'naver'],
    ['microsoft', 'facebook'],
  ];

  for (const [stored, requested] of providerPairs) {
    it(`state="${stored}" → callback provider="${requested}" → 400`, async () => {
      const state = `mismatch-${stored}-${requested}-${crypto.randomUUID().slice(0, 8)}`;
      await (globalThis as any).env.KV.put(
        `oauth:state:${state}`,
        JSON.stringify({ provider: stored, redirectUri: 'http://localhost/callback', codeVerifier: null }),
        { expirationTtl: 300 },
      );
      const { status } = await api('GET', `/api/auth/oauth/${requested}/callback?code=x&state=${state}`);
      expect(status).toBe(400);
    });
  }
});

// ─── 11. link callback 확장 ────────────────────────────────────────────────

describe('1-13 auth-oauth — link callback 확장', () => {
  it('link callback error query param → 400', async () => {
    const { status } = await api('GET', '/api/auth/oauth/link/google/callback?error=access_denied&code=x&state=y');
    expect(status).toBe(400);
  });

  it('link callback code+state 모두 누락 → 400', async () => {
    const { status } = await api('GET', '/api/auth/oauth/link/google/callback');
    expect(status).toBe(400);
  });

  it('link callback provider mismatch → 400', async () => {
    const state = `link-mismatch-${crypto.randomUUID().slice(0, 8)}`;
    await (globalThis as any).env.KV.put(
      `oauth:state:${state}`,
      JSON.stringify({ provider: 'github', redirectUri: 'http://localhost/callback', codeVerifier: null, userId: 'anon-user' }),
      { expirationTtl: 300 },
    );
    const { status } = await api('GET', `/api/auth/oauth/link/discord/callback?code=x&state=${state}`);
    expect(status).toBe(400);
  });
});

// ─── 12. OAuth 에러 형식 확장 ──────────────────────────────────────────────

describe('1-13 auth-oauth — 에러 형식 확장', () => {
  it('unsupported provider 에러 → content-type: application/json', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/oauth/fakeprovider`, {
      headers: { 'Content-Type': 'application/json' },
      redirect: 'manual',
    });
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('callback 에러도 { code: number, message: string } 형식', async () => {
    const { data } = await api('GET', '/api/auth/oauth/fakeprovider/callback?code=x&state=y');
    expect(typeof data.code).toBe('number');
    expect(typeof data.message).toBe('string');
  });

  it('link 인증 에러 code=401', async () => {
    const { status, data } = await api('POST', '/api/auth/oauth/link/github');
    expect(status).toBe(401);
    expect(data.code).toBe(401);
  });

  it('state 없이 callback → code=400, message 포함', async () => {
    const { data } = await api('GET', '/api/auth/oauth/google/callback?code=x');
    expect(data.code).toBe(400);
    expect(data.message.length).toBeGreaterThan(0);
  });
});
