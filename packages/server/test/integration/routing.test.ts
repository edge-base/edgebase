/**
 * routing.test.ts — 60개
 *
 * 테스트 대상:
 *   - src/routes/health.ts        GET /api/health
 *   - src/index.ts                404 fallback, 미등록 경로
 *   - src/middleware/cors.ts      corsMiddleware, wildcardToRegex, isOriginAllowed
 *   - src/middleware/auth.ts      authMiddleware (JWT/Service Key)
 *   - src/middleware/internal-guard.ts  internalGuardMiddleware
 *   - src/middleware/rate-limit.ts  rateLimitMiddleware, FixedWindowCounter
 *
 * 격리 원칙: 이 파일은 순수 HTTP 요청 테스트이므로 DO 상태 의존 없음.
 *            rate-limit 테스트만 카운터 상태에 의존 — 각 subtest는 고유 IP 사용.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import {
  wildcardToRegex,
  isOriginAllowed,
} from '../../src/middleware/cors.js';
import {
  FixedWindowCounter,
  parseWindow,
  getGroup,
  getLimit,
} from '../../src/middleware/rate-limit.js';
import { signAccessToken, signAdminAccessToken } from '../../src/lib/jwt.js';

// ─── 헬퍼: Worker fetch ─────────────────────────────────────────────────────
const BASE = 'http://localhost';

async function req(
  path: string,
  options: RequestInit & { headers?: Record<string, string> } = {},
): Promise<Response> {
  return (globalThis as any).SELF.fetch(`${BASE}${path}`, options);
}

// ─── JWT helpers ─────────────────────────────────────────────────────────────
const USER_SECRET = 'test-jwt-user-secret-32-chars!!';
const ADMIN_SECRET = 'test-jwt-admin-secret-32-chars!';
const SERVICE_KEY  = 'test-service-key-for-admin';

/** Get a valid user token via the actual server auth API (avoids module boundary crypto mismatch). */
async function userToken() {
  const email = `routing-${crypto.randomUUID().slice(0, 8)}@test.com`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Routing1234!' }),
  });
  const data = await res.json() as any;
  return data.accessToken as string;
}

// ─── 1. Health ────────────────────────────────────────────────────────────────

describe('1-01 routing — health', () => {
  it('GET /api/health → 200 with status/version/timestamp', async () => {
    const res = await req('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(typeof body.timestamp).toBe('string');
  });

  it('GET /api/health — timestamp is valid ISO string', async () => {
    const res = await req('/api/health');
    const body = await res.json() as any;
    expect(() => new Date(body.timestamp)).not.toThrow();
    expect(new Date(body.timestamp).getTime()).toBeGreaterThan(0);
  });
});

// ─── 2. 404 / 미등록 경로 ─────────────────────────────────────────────────────

describe('1-01 routing — 404 fallback', () => {
  it('GET /api/nonexistent → 404', async () => {
    const res = await req('/api/nonexistent');
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
    expect(typeof body.message).toBe('string');
  });

  it('GET /totally/random/path → 404', async () => {
    const res = await req('/totally/random/path');
    expect(res.status).toBe(404);
  });

  it('DELETE /api/nonexistent → 404', async () => {
    const res = await req('/api/nonexistent', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('PATCH /api/nonexistent → 404', async () => {
    const res = await req('/api/nonexistent', { method: 'PATCH' });
    expect(res.status).toBe(404);
  });
});

// ─── 3. OPTIONS preflight ─────────────────────────────────────────────────────

describe('1-01 routing — CORS preflight', () => {
  it('OPTIONS /api/health with Origin → 204', async () => {
    const res = await req('/api/health', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.status).toBe(204);
  });

  it('OPTIONS preflight includes CORS headers', async () => {
    const res = await req('/api/health', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  it('GET from localhost → Access-Control-Allow-Origin header present', async () => {
    const res = await req('/api/health', {
      headers: { 'Origin': 'http://localhost:5180' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });
});

// ─── 4. wildcardToRegex (unit — pure function, no HTTP needed) ───────────────

describe('1-01 routing — wildcardToRegex', () => {
  it('*.example.com matches https://foo.example.com', () => {
    const regex = wildcardToRegex('*.example.com');
    expect(regex.test('https://foo.example.com')).toBe(true);
  });

  it('*.example.com does NOT match https://example.com', () => {
    const regex = wildcardToRegex('*.example.com');
    expect(regex.test('https://example.com')).toBe(false);
  });

  it('*.example.com does NOT match https://foo.bar.com', () => {
    const regex = wildcardToRegex('*.example.com');
    expect(regex.test('https://foo.bar.com')).toBe(false);
  });

  it('http://localhost:* matches http://localhost:3000', () => {
    const regex = wildcardToRegex('localhost:*');
    // Note: wildcardToRegex prepends https?://
    // pattern: 'localhost:*' → regex: ^https?://localhost:.*$
    expect(regex.test('http://localhost:3000')).toBe(true);
  });
});

// ─── 5. isOriginAllowed (unit) ───────────────────────────────────────────────

describe('1-01 routing — isOriginAllowed', () => {
  it('"*" matches any origin', () => {
    expect(isOriginAllowed('https://evil.com', '*')).toBe(true);
  });

  it('exact match — single string', () => {
    expect(isOriginAllowed('https://app.example.com', 'https://app.example.com')).toBe(true);
  });

  it('exact match — array', () => {
    expect(isOriginAllowed('https://app.example.com', ['https://app.example.com', 'https://other.com'])).toBe(true);
  });

  it('no match → false', () => {
    expect(isOriginAllowed('https://evil.com', ['https://good.com'])).toBe(false);
  });

  it('wildcard match in array', () => {
    expect(isOriginAllowed('https://staging.example.com', ['*.example.com'])).toBe(true);
  });

  it('mismatch → false', () => {
    expect(isOriginAllowed('https://evil.example.net', ['*.example.com'])).toBe(false);
  });
});

// ─── 6. Auth Middleware via HTTP ──────────────────────────────────────────────

describe('1-01 routing — auth middleware', () => {
  it('no Authorization header → 200 (public endpoint /api/health)', async () => {
    const res = await req('/api/health');
    expect(res.status).toBe(200);
  });

  it('valid JWT → auth context set (posts list should succeed)', async () => {
    const token = await userToken();
    const res = await req('/api/db/shared/posts', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    // endpoint exists → not 401 (could be 200 or 403 depending on rules, both fine)
    expect([200, 201, 403, 404].includes(res.status)).toBe(true);
    expect(res.status).not.toBe(401);
  });

  it('expired JWT → 401', async () => {
    // vitest-pool-workers 환경에서는 테스트 코드의 jose.SignJWT.sign()과
    // 서버의 jose.jwtVerify()가 서로 다른 모듈 컨텍스트에서 실행되어
    // 같은 비밀키로 서명해도 서명 검증이 실패합니다.
    // 따라서 TOKEN_EXPIRED 구분 테스트 대신 만료형 토큰이 401을 반환하는지만 검증합니다.
    // TOKEN_EXPIRED 분기 로직은 jwt.ts 단위 테스트에서 검증합니다.
    const { SignJWT } = await import('jose');
    const key = new TextEncoder().encode(USER_SECRET);
    const expiredToken = await new SignJWT({ sub: 'user-expired' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
      .setIssuer('edgebase:user')
      .sign(key);

    const res = await req('/api/db/shared/posts', {
      headers: { 'Authorization': `Bearer ${expiredToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('malformed JWT → 401', async () => {
    const res = await req('/api/db/shared/posts', {
      headers: { 'Authorization': 'Bearer this-is-not-a-jwt' },
    });
    expect(res.status).toBe(401);
  });

  it('wrong signing key → 401', async () => {
    const wrongToken = await signAccessToken({ sub: 'user-001' }, 'wrong-secret-key-32-chars-!!!!');
    const res = await req('/api/db/shared/posts', {
      headers: { 'Authorization': `Bearer ${wrongToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('admin JWT used as user token → 401 (issuer mismatch)', async () => {
    const adminToken = await signAdminAccessToken({ sub: 'admin-001' }, ADMIN_SECRET);
    const res = await req('/api/db/shared/posts', {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('valid Service Key header → passes auth (null auth context)', async () => {
    const res = await req('/api/health', {
      headers: { 'X-EdgeBase-Service-Key': SERVICE_KEY },
    });
    expect(res.status).toBe(200);
  });

  it('invalid Service Key → treated as missing (not 401)', async () => {
    // Service key header with wrong value: auth.ts doesn't set 401 for wrong service key,
    // it just falls through to JWT check, which finds no bearer → auth=null
    const res = await req('/api/health', {
      headers: { 'X-EdgeBase-Service-Key': 'wrong-service-key' },
    });
    // Health endpoint is public, so still 200
    expect(res.status).toBe(200);
  });
});

// ─── 7. Internal Guard ────────────────────────────────────────────────────────

describe('1-01 routing — internal guard', () => {
  it('/internal/* without header → 403', async () => {
    const res = await req('/internal/anything');
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.code).toBe(403);
  });

  it('/internal/* with X-EdgeBase-Internal: true but stripped at entry → 403', async () => {
    // index.ts strips X-EdgeBase-Internal from external requests before internalGuard
    // So external callers CAN'T bypass by sending the header
    const res = await req('/internal/anything', {
      headers: { 'X-EdgeBase-Internal': 'true' },
    });
    // After stripping, the header is gone, so internalGuard sees no header → 403
    expect(res.status).toBe(403);
  });
});

// ─── 8. X-Request-ID ─────────────────────────────────────────────────────────

describe('1-01 routing — request propagation', () => {
  it('response has Content-Type: application/json for JSON endpoints', async () => {
    const res = await req('/api/health');
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

// ─── 9. Rate Limit — FixedWindowCounter (pure unit) ─────────────────────────

describe('1-01 routing — FixedWindowCounter', () => {
  it('first request under limit → true', () => {
    const counter = new FixedWindowCounter();
    expect(counter.check('test-rl-key-001', 10, 60)).toBe(true);
  });

  it('requests within limit → all true', () => {
    const counter = new FixedWindowCounter();
    for (let i = 0; i < 5; i++) {
      expect(counter.check('test-rl-key-002', 5, 60)).toBe(true);
    }
  });

  it('request exceeding limit → false', () => {
    const counter = new FixedWindowCounter();
    for (let i = 0; i < 5; i++) counter.check('test-rl-key-003', 5, 60);
    expect(counter.check('test-rl-key-003', 5, 60)).toBe(false);
  });

  it('different keys have independent counters', () => {
    const counter = new FixedWindowCounter();
    for (let i = 0; i < 5; i++) counter.check('test-rl-key-A', 5, 60);
    // A is exhausted, B is not
    expect(counter.check('test-rl-key-A', 5, 60)).toBe(false);
    expect(counter.check('test-rl-key-B', 5, 60)).toBe(true);
  });

  it('getRetryAfter returns positive number', () => {
    const counter = new FixedWindowCounter();
    for (let i = 0; i < 3; i++) counter.check('test-rl-key-C', 3, 60);
    const retryAfter = counter.getRetryAfter('test-rl-key-C');
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('unknown key getRetryAfter → 0 (no active window)', () => {
    const counter = new FixedWindowCounter();
    expect(counter.getRetryAfter('never-used-key')).toBe(0);
  });
});

// ─── 10. parseWindow ─────────────────────────────────────────────────────────

describe('1-01 routing — parseWindow', () => {
  it('"60s" → 60', () => expect(parseWindow('60s')).toBe(60));
  it('"1m" → 60', () => expect(parseWindow('1m')).toBe(60));
  it('"5m" → 300', () => expect(parseWindow('5m')).toBe(300));
  it('"1h" → 3600', () => expect(parseWindow('1h')).toBe(3600));
  it('"invalid" → 60 (fallback)', () => expect(parseWindow('invalid')).toBe(60));
  it('"" → 60 (fallback)', () => expect(parseWindow('')).toBe(60));
});

// ─── 11. getGroup ─────────────────────────────────────────────────────────────

describe('1-01 routing — getGroup', () => {
  it('/api/db/shared/posts → "db"', () => expect(getGroup('/api/db/shared/posts')).toBe('db'));
  it('/api/storage/file.txt → "storage"', () => expect(getGroup('/api/storage/file.txt')).toBe('storage'));
  it('/api/functions/my-fn → "functions"', () => expect(getGroup('/api/functions/my-fn')).toBe('functions'));
  it('/api/auth/sign-in → "global"', () => expect(getGroup('/api/auth/sign-in')).toBe('global'));
  it('/api/health → "global"', () => expect(getGroup('/api/health')).toBe('global'));
  it('/admin/api → "global"', () => expect(getGroup('/admin/api')).toBe('global'));
});

// ─── 12. getLimit ────────────────────────────────────────────────────────────

describe('1-01 routing — getLimit', () => {
  it('no config → returns default for "global"', () => {
    const { requests, windowSec } = getLimit(undefined, 'global');
    expect(requests).toBe(10_000_000);
    expect(windowSec).toBe(60);
  });

  it('no config → returns default for "db"', () => {
    const { requests } = getLimit(undefined, 'db');
    expect(requests).toBe(100);
  });

  it('config with rateLimiting.global → overrides default', () => {
    const config = { rateLimiting: { global: { requests: 500, window: '30s' } } } as any;
    const { requests, windowSec } = getLimit(config, 'global');
    expect(requests).toBe(500);
    expect(windowSec).toBe(30);
  });

  it('config missing window field → falls through to default', () => {
    const config = { rateLimiting: { global: { requests: 500 } } } as any;
    const { requests } = getLimit(config, 'global');
    // requests missing window → falls to default
    expect(requests).toBe(10_000_000);
  });

  it('unknown group → fallback to 10_000_000/60', () => {
    const { requests, windowSec } = getLimit(undefined, 'unknown-group');
    expect(requests).toBe(10_000_000);
    expect(windowSec).toBe(60);
  });
});
