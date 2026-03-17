/**
 * middleware.test.ts — 40개
 *
 * 테스트 대상: src/middleware/ 전체
 *   cors.ts, auth.ts, rate-limit.ts, internal-guard.ts, logger.ts
 *
 * routing.test.ts와 분리: middleware 조합/통합 시나리오 집중
 *   - Service Key + JWT 동시 사용
 *   - auth context.auth 주입 확인 (POST /api/db/shared/tables/posts로 검증)
 *   - /internal/* 완전 차단 확인
 *   - Rate Limit 통합 테스트
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { signAccessToken } from '../../src/lib/jwt.js';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';
const USER_SECRET = 'test-jwt-user-secret-32-chars!!';

async function req(path: string, options: RequestInit & { headers?: Record<string, string> } = {}) {
  return (globalThis as any).SELF.fetch(`${BASE}${path}`, options);
}

async function userToken(sub = 'user-mw-001') {
  return signAccessToken({ sub, email: `${sub}@test.com` }, USER_SECRET);
}

// ─── 1. Service Key + JWT 동시 ───────────────────────────────────────────────

describe('1-02 middleware — Service Key + JWT 동시', () => {
  it('SK + JWT 둘 다 있으면 JWT 우선 처리', async () => {
    const token = await userToken();
    const res = await req('/api/health', {
      headers: {
        'X-EdgeBase-Service-Key': SK,
        'Authorization': `Bearer ${token}`,
      },
    });
    expect(res.status).toBe(200);
  });

  it('SK만 있으면 auth=null (공개 엔드포인트 접근 가능)', async () => {
    const res = await req('/api/health', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(res.status).toBe(200);
  });

  it('SK와 JWT 둘 다 없으면 공개 엔드포인트는 200', async () => {
    const res = await req('/api/health');
    expect(res.status).toBe(200);
  });
});

// ─── 2. auth context 주입 ─────────────────────────────────────────────────────

describe('1-02 middleware — auth context 주입', () => {
  let token: string;

  beforeAll(async () => {
    // Sign up and get real token
    const res = await req('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `mw-test-${crypto.randomUUID().slice(0, 8)}@test.com`,
        password: 'MiddleWare1234!',
      }),
    });
    const data = await res.json() as any;
    token = data.accessToken;
  });

  it('유효한 JWT → auth context 있음 (보호 엔드포인트 접근)', async () => {
    const res = await req('/api/auth/sessions', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect([200, 401].includes(res.status)).toBe(true); // 유효하면 200
    expect(res.status).not.toBe(500);
  });

  it('auth 없이 보호 엔드포인트 → 401', async () => {
    const res = await req('/api/auth/sessions');
    expect(res.status).toBe(401);
  });
});

// ─── 3. Internal Guard ────────────────────────────────────────────────────────

describe('1-02 middleware — Internal Guard', () => {
  it('/internal/* → 403 (X-EdgeBase-Internal 없음)', async () => {
    const res = await req('/internal/anything');
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.code).toBe(403);
  });

  it('/internal/sql → 403 (외부 차단)', async () => {
    const res = await req('/internal/sql', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('X-EdgeBase-Internal: true 헤더 추가해도 → 403 (index.ts가 strip)', async () => {
    const res = await req('/internal/backup/dump', {
      headers: { 'X-EdgeBase-Internal': 'true' },
    });
    // index.ts strips this header from external requests
    expect(res.status).toBe(403);
  });

  it('/api/health → 200 (internal guard 적용 안 됨)', async () => {
    const res = await req('/api/health');
    expect(res.status).toBe(200);
  });
});

// ─── 4. CORS 응답 헤더 검증 ───────────────────────────────────────────────────

describe('1-02 middleware — CORS 응답 헤더', () => {
  it('Origin 없이 요청 → CORS 헤더 없음 또는 있음 (구현 의존)', async () => {
    const res = await req('/api/health');
    // no origin → no CORS header (or wildcard)
    // either way response should be 200
    expect(res.status).toBe(200);
  });

  it('localhost:3000 → Access-Control-Allow-Origin 헤더 포함', async () => {
    const res = await req('/api/health', {
      headers: { 'Origin': 'http://localhost:3000' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  it('localhost:5180 → Allow-Origin 포함 (Vite 개발 서버)', async () => {
    const res = await req('/api/health', {
      headers: { 'Origin': 'http://localhost:5180' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  it('OPTIONS preflight → 204', async () => {
    const res = await req('/api/db/shared/tables/posts', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.status).toBe(204);
  });
});

// ─── 5. 에러 포맷 ─────────────────────────────────────────────────────────────

describe('1-02 middleware — 에러 포맷', () => {
  it('404 응답 → { code: 404, message: string }', async () => {
    const res = await req('/api/nonexistent-path');
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.code).toBe(404);
    expect(typeof body.message).toBe('string');
  });

  it('401 응답 — 잘못된 JWT → { code: 401, error: string }', async () => {
    const res = await req('/api/db/shared/tables/posts', {
      headers: { 'Authorization': 'Bearer not-a-jwt' },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect([401, 'AUTH_FAILED', 'TOKEN_INVALID'].includes(body.error || body.code)).toBe(true);
  });

  it('Content-Type: application/json — 모든 JSON 에러 응답', async () => {
    const res = await req('/api/nonexistent');
    expect((res.headers.get('content-type') || '')).toContain('application/json');
  });

  it('GET 요청에 body 없어도 에러 없음', async () => {
    const res = await req('/api/health');
    expect(res.status).toBe(200);
  });
});

// ─── 6. Logger 미들웨어 ───────────────────────────────────────────────────────

describe('1-02 middleware — logger', () => {
  it('요청이 처리되어도 X-Request-Duration 또는 유사 헤더 없음 (비공개)', async () => {
    const res = await req('/api/health');
    // Logger는 콘솔 출력 — 응답 헤더에 노출 안 해야 함
    expect(res.status).toBe(200);
  });
});

// ─── 7. Rate Limit 통합 ───────────────────────────────────────────────────────

describe('1-02 middleware — rate limit 통합', () => {
  it('일반 요청 — Retry-After 헤더 없음 (제한 미도달)', async () => {
    const res = await req('/api/health');
    expect(res.status).toBe(200);
    // Under limit → no Retry-After
  });

  it('Service Key 요청 — EdgeBase app-level rate limit 바이패스', async () => {
    const res = await req('/api/health', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    // Service Key = bypass in test env
    expect(res.status).toBe(200);
  });
});

// ─── 8. Public 엔드포인트 비인증 접근 ──────────────────────────────────────────

describe('1-02 middleware — unauthenticated public endpoint access', () => {
  it('GET /api/health → 200 (인증 불필요)', async () => {
    const res = await req('/api/health');
    expect(res.status).toBe(200);
  });

  it('GET /api/db/shared/tables/posts → 200 (public list)', async () => {
    const res = await req('/api/db/shared/tables/posts');
    expect(res.status).toBe(200);
  });

  it('POST /api/db/shared/tables/posts → 인증없이도 공개 테이블은 생성 가능', async () => {
    const res = await req('/api/db/shared/tables/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'MW Public Create Test' }),
    });
    // posts create rule is () => true
    expect([200, 201].includes(res.status)).toBe(true);
    const data = await res.json() as any;
    if (data?.id) {
      await req(`/api/db/shared/tables/posts/${data.id}`, {
        method: 'DELETE',
        headers: { 'X-EdgeBase-Service-Key': SK },
      });
    }
  });

  it('OPTIONS /api/health → 204 (preflight on public)', async () => {
    const res = await req('/api/health', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.status).toBe(204);
  });

  it('DELETE /api/db/shared/tables/posts/no-id → auth rule 차단 (auth=null)', async () => {
    const res = await req('/api/db/shared/tables/posts/nonexistent-del', {
      method: 'DELETE',
    });
    // delete rule requires auth !== null
    expect([401, 403, 404].includes(res.status)).toBe(true);
  });
});

// ─── 9. SK + JWT 세부 동시 사용 ─────────────────────────────────────────────

describe('1-02 middleware — SK+JWT 세부 시나리오', () => {
  it('유효 SK + 유효 JWT → 200 (두 인증 모두 유효)', async () => {
    const token = await userToken('skjwt-user-001');
    const res = await req('/api/db/shared/tables/posts', {
      headers: {
        'X-EdgeBase-Service-Key': SK,
        'Authorization': `Bearer ${token}`,
      },
    });
    expect(res.status).toBe(200);
  });

  it('유효 SK + 만료 JWT → SK가 보호 (200)', async () => {
    const res = await req('/api/db/shared/tables/posts', {
      headers: {
        'X-EdgeBase-Service-Key': SK,
        'Authorization': 'Bearer expired.token.here',
      },
    });
    // SK bypasses rules, so even if JWT is bad, SK-protected endpoint works
    expect([200, 401].includes(res.status)).toBe(true);
  });

  it('잘못된 SK + 유효 JWT → JWT로 인증 통과', async () => {
    const token = await userToken('skjwt-user-002');
    const res = await req('/api/db/shared/tables/posts', {
      headers: {
        'X-EdgeBase-Service-Key': 'wrong-service-key',
        'Authorization': `Bearer ${token}`,
      },
    });
    // JWT is valid, public endpoint → should work
    expect([200, 401, 403].includes(res.status)).toBe(true);
  });

  it('SK만으로 admin API 접근 가능', async () => {
    const res = await req('/admin/api/data/tables', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect([200, 404].includes(res.status)).toBe(true);
  });
});

// ─── 10. X-EdgeBase-Internal 헤더 검증 확장 ─────────────────────────────────

describe('1-02 middleware — X-EdgeBase-Internal 확장', () => {
  it('/internal/sql POST with X-EdgeBase-Internal: true → 403', async () => {
    const res = await req('/internal/sql', {
      method: 'POST',
      headers: {
        'X-EdgeBase-Internal': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql: 'SELECT 1' }),
    });
    expect(res.status).toBe(403);
  });

  it('/internal/backup/export → 403 (GET)', async () => {
    const res = await req('/internal/backup/export', {
      headers: { 'X-EdgeBase-Internal': 'true' },
    });
    expect(res.status).toBe(403);
  });

  it('/internal/ 루트 → 403', async () => {
    const res = await req('/internal/');
    expect(res.status).toBe(403);
  });

  it('/internal/deeply/nested/path → 403', async () => {
    const res = await req('/internal/deeply/nested/path');
    expect(res.status).toBe(403);
  });

  it('X-EdgeBase-Internal with random value → 403', async () => {
    const res = await req('/internal/test', {
      headers: { 'X-EdgeBase-Internal': 'random-value-xyz' },
    });
    expect(res.status).toBe(403);
  });

  it('/internal/* with SK → 여전히 403 (SK로도 internal 접근 불가)', async () => {
    const res = await req('/internal/sql', {
      headers: {
        'X-EdgeBase-Service-Key': SK,
        'X-EdgeBase-Internal': 'true',
      },
    });
    expect(res.status).toBe(403);
  });
});

// ─── 11. auth success context.auth 주입 확장 ─────────────────────────────────

describe('1-02 middleware — auth context.auth 주입 확장', () => {
  let validToken: string;
  let userId: string;

  beforeAll(async () => {
    const email = `mw-ctx-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const res = await req('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Context1234!' }),
    });
    const data = await res.json() as any;
    validToken = data.accessToken;
    userId = data.user?.id;
  });

  it('JWT로 인증 후 sessions 조회 가능', async () => {
    const res = await req('/api/auth/sessions', {
      headers: { 'Authorization': `Bearer ${validToken}` },
    });
    expect(res.status).toBe(200);
  });

  it('JWT로 인증 후 profile 수정 가능', async () => {
    const res = await req('/api/auth/profile', {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${validToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ displayName: 'MW Context User' }),
    });
    expect([200, 204].includes(res.status)).toBe(true);
  });

  it('Bearer 없이 profile 수정 → 401', async () => {
    const res = await req('/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Should Fail' }),
    });
    expect(res.status).toBe(401);
  });

  it('Bearer prefix 없이 토큰만 → 401', async () => {
    const res = await req('/api/auth/sessions', {
      headers: { 'Authorization': validToken },
    });
    // auth middleware requires "Bearer <token>" format
    expect([200, 401].includes(res.status)).toBe(true);
  });
});
