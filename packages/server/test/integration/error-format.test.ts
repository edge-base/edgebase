/**
 * error-format.test.ts — 40개
 *
 * 테스트 대상: src/lib/errors.ts, src/middleware/error-handler.ts (또는 각 route onError)
 *
 * 모든 에러 응답이 { code, message, error? } 형식임을 확인
 * EdgeBaseError.toJSON() → { code, message, error }
 *
 * 에러 카테고리:
 *   - 400: 잘못된 요청
 *   - 401: 인증 실패
 *   - 403: 접근 거부
 *   - 404: 리소스 없음
 *   - 409: 충돌
 *   - 429: 속도 제한
 *   - 500: 서버 오류
 */
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

async function req(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const h: Record<string, string> = { ...headers };
  if (body) h['Content-Type'] = 'application/json';
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

// ─── 1. 400 에러 형식 ─────────────────────────────────────────────────────────

describe('1-26 error-format — 400', () => {
  it('잘못된 JSON body → 400, { code, message }', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const data = await res.json() as any;
    expect(res.status).toBe(400);
    expect(typeof data.code).toBe('number');
    expect(typeof data.message).toBe('string');
  });

  it('signup email 누락 → 400', async () => {
    const { status, data } = await req('POST', '/api/auth/signup', { password: 'P1234!' });
    expect(status).toBe(400);
    expect(data.code).toBe(400);
  });

  it('storage upload file 누락 → 400', async () => {
    const form = new FormData();
    form.append('key', 'test.txt');
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/storage/avatars/upload`, {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: form,
    });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.code).toBe(400);
    expect(typeof data.message).toBe('string');
  });
});

// ─── 2. 401 에러 형식 ─────────────────────────────────────────────────────────

describe('1-26 error-format — 401', () => {
  it('인증 필요 엔드포인트 인증없이 → 401, { code: 401, message }', async () => {
    const { status, data } = await req('GET', '/api/auth/sessions');
    expect(status).toBe(401);
    expect(data.code).toBe(401);
    expect(typeof data.message).toBe('string');
  });

  it('만료된 토큰 → 401', async () => {
    const { status, data } = await req('GET', '/api/auth/sessions', undefined, {
      'Authorization': 'Bearer invalid.token.here',
    });
    expect(status).toBe(401);
    expect(data.code).toBe(401);
  });

  it('auth signin 잘못된 비밀번호 → 401', async () => {
    // First signup
    const email = `errfmt-${crypto.randomUUID().slice(0, 8)}@test.com`;
    await req('POST', '/api/auth/signup', { email, password: 'Right1234!' });
    const { status, data } = await req('POST', '/api/auth/signin', { email, password: 'WrongPass' });
    expect(status).toBe(401);
    expect(data.code).toBe(401);
  });
});

// ─── 3. 403 에러 형식 ─────────────────────────────────────────────────────────

describe('1-26 error-format — 403', () => {
  it('SK없이 categories 쓰기 → 401/403', async () => {
    const { status, data } = await req('POST', '/api/db/shared/tables/categories', {
      name: 'No Auth Category',
    });
    expect([401, 403].includes(status)).toBe(true);
    expect(typeof data?.message).toBe('string');
  });

  it('SK없이 admin API → 401', async () => {
    const { status, data } = await req('GET', '/admin/api/data/tables');
    expect(status).toBe(401);
    expect(typeof data.message).toBe('string');
  });
});

// ─── 4. 404 에러 형식 ─────────────────────────────────────────────────────────

describe('1-26 error-format — 404', () => {
  it('존재하지 않는 게시글 → 404, { code: 404, message }', async () => {
    const { status, data } = await req('GET', `/api/db/shared/tables/posts/nonexistent-id-xyz`, undefined, {
      'X-EdgeBase-Service-Key': SK,
    });
    expect(status).toBe(404);
    expect(data.code).toBe(404);
    expect(typeof data.message).toBe('string');
  });

  it('존재하지 않는 경로 → 404', async () => {
    const { status, data } = await req('GET', '/api/nonexistent-route');
    expect(status).toBe(404);
    expect(data).not.toBeNull();
  });

  it('미등록 storage bucket → 404', async () => {
    const { status, data } = await req('GET', `/api/storage/undefined_bucket`, undefined, {
      'X-EdgeBase-Service-Key': SK,
    });
    expect(status).toBe(404);
    expect(data.code).toBe(404);
  });

  it('기능 없음 function → 404', async () => {
    const { status, data } = await req('GET', '/api/functions/ghost-fn', undefined, {
      'X-EdgeBase-Service-Key': SK,
    });
    expect(status).toBe(404);
    expect(data.code).toBe(404);
  });
});

// ─── 5. 409 에러 형식 ─────────────────────────────────────────────────────────

describe('1-26 error-format — 409', () => {
  it('중복 email 가입 → 409, { code: 409, message }', async () => {
    const email = `conflict-${crypto.randomUUID().slice(0, 8)}@test.com`;
    await req('POST', '/api/auth/signup', { email, password: 'Conflict1234!' });
    const { status, data } = await req('POST', '/api/auth/signup', { email, password: 'Conflict1234!' });
    expect(status).toBe(409);
    expect(data.code).toBe(409);
    expect(typeof data.message).toBe('string');
  });
});

// ─── 6. 에러 응답 구조 일관성 ─────────────────────────────────────────────────

describe('1-26 error-format — 구조 일관성', () => {
  it('모든 에러 응답에 code와 message 포함', async () => {
    const errorCases = [
      req('GET', '/api/auth/sessions'),
      req('POST', '/api/auth/signup', { password: 'only-pass' }),
      req('GET', '/api/db/shared/tables/posts/nonexistent-xyz', undefined, {
        'X-EdgeBase-Service-Key': SK,
      }),
    ];
    const results = await Promise.all(errorCases);
    for (const { data } of results) {
      expect(typeof data?.code).toBe('number');
      expect(typeof data?.message).toBe('string');
    }
  });

  it('code는 HTTP 상태코드와 일치', async () => {
    const { status, data } = await req('GET', '/api/auth/sessions');
    expect(data.code).toBe(status);
  });

  it('Content-Type은 항상 application/json', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/nonexistent-route`);
    const ct = res.headers.get('content-type');
    expect(ct).toContain('application/json');
  });
});

// ─── 7. 400 에러 확장 ───────────────────────────────────────────────────────

describe('1-26 error-format — 400 확장', () => {
  it('signup password 누락 → 400', async () => {
    const { status, data } = await req('POST', '/api/auth/signup', { email: 'nopass@test.com' });
    expect(status).toBe(400);
    expect(data.code).toBe(400);
    expect(typeof data.message).toBe('string');
  });

  it('signup 잘못된 email 형식 → 400', async () => {
    const { status, data } = await req('POST', '/api/auth/signup', { email: 'not-an-email', password: 'P123456!' });
    expect(status).toBe(400);
    expect(data.code).toBe(400);
  });

  it('빈 body POST → 400', async () => {
    const { status, data } = await req('POST', '/api/auth/signup', {});
    expect(status).toBe(400);
    expect(data.code).toBe(400);
  });

  it('잘못된 field op $op → 400', async () => {
    const { status, data } = await req('PATCH', '/api/db/shared/tables/posts/fake-id', {
      views: { $op: 'badop', value: 1 },
    }, { 'X-EdgeBase-Service-Key': SK });
    expect([400, 404].includes(status)).toBe(true);
    expect(typeof data.message).toBe('string');
  });

  it('posts title 유효성 실패 (max 초과) → 400', async () => {
    const { status, data } = await req('POST', '/api/db/shared/tables/posts', { title: 'a'.repeat(201) }, {
      'X-EdgeBase-Service-Key': SK,
    });
    expect(status).toBe(400);
    expect(data.code).toBe(400);
  });

  it('posts title 누락 → 400', async () => {
    const { status, data } = await req('POST', '/api/db/shared/tables/posts', { content: 'no title' }, {
      'X-EdgeBase-Service-Key': SK,
    });
    expect(status).toBe(400);
    expect(data.code).toBe(400);
  });
});

// ─── 8. 401 에러 확장 ───────────────────────────────────────────────────────

describe('1-26 error-format — 401 확장', () => {
  it('잘못된 형식 Authorization 헤더 → 401', async () => {
    const { status, data } = await req('GET', '/api/auth/sessions', undefined, {
      'Authorization': 'NotBearer token',
    });
    expect(status).toBe(401);
    expect(data.code).toBe(401);
  });

  it('빈 Bearer 토큰 → 401', async () => {
    const { status, data } = await req('GET', '/api/auth/sessions', undefined, {
      'Authorization': 'Bearer ',
    });
    expect(status).toBe(401);
    expect(data.code).toBe(401);
  });

  it('admin API SK 없이 접근 → 401', async () => {
    const { status, data } = await req('GET', '/admin/api/data/tables');
    expect(status).toBe(401);
    expect(typeof data.message).toBe('string');
  });
});

// ─── 9. 403 에러 확장 ───────────────────────────────────────────────────────

describe('1-26 error-format — 403 확장', () => {
  it('/internal/* 외부 접근 → 403, { code: 403, message }', async () => {
    const { status, data } = await req('GET', '/internal/sql');
    expect(status).toBe(403);
    expect(data.code).toBe(403);
    expect(typeof data.message).toBe('string');
  });

  it('/internal/backup/dump → 403 (POST)', async () => {
    const { status, data } = await req('POST', '/internal/backup/dump');
    expect(status).toBe(403);
    expect(data.code).toBe(403);
  });

  it('/internal/* with X-EdgeBase-Internal → 여전히 403', async () => {
    const { status, data } = await req('GET', '/internal/test', undefined, {
      'X-EdgeBase-Internal': 'true',
    });
    expect(status).toBe(403);
    expect(data.code).toBe(403);
  });
});

// ─── 10. 404 에러 확장 ──────────────────────────────────────────────────────

describe('1-26 error-format — 404 확장', () => {
  it('존재하지 않는 table → 404', async () => {
    const { status, data } = await req('GET', '/api/db/shared/tables/nonexistent_table_xyz', undefined, {
      'X-EdgeBase-Service-Key': SK,
    });
    expect(status).toBe(404);
    expect(data.code).toBe(404);
  });

  it('UUID 형식이지만 없는 ID → 404', async () => {
    const fakeId = '01900000-0000-7000-8000-000000000000';
    const { status, data } = await req('GET', `/api/db/shared/tables/posts/${fakeId}`, undefined, {
      'X-EdgeBase-Service-Key': SK,
    });
    expect(status).toBe(404);
    expect(data.code).toBe(404);
  });

  it('DELETE 존재하지 않는 ID → 404', async () => {
    const { status, data } = await req('DELETE', '/api/db/shared/tables/posts/nonexistent-del-xyz', undefined, {
      'X-EdgeBase-Service-Key': SK,
    });
    expect(status).toBe(404);
    expect(typeof data.message).toBe('string');
  });

  it('PATCH 존재하지 않는 ID → 404', async () => {
    const { status, data } = await req('PATCH', '/api/db/shared/tables/posts/nonexistent-upd-xyz',
      { title: 'nope' },
      { 'X-EdgeBase-Service-Key': SK },
    );
    expect(status).toBe(404);
    expect(data.code).toBe(404);
  });
});

// ─── 11. 스택 트레이스 비노출 ─────────────────────────────────────────────────

describe('1-26 error-format — 보안 (stack trace 비노출)', () => {
  it('400 에러 응답에 stack 필드 없음', async () => {
    const { data } = await req('POST', '/api/auth/signup', { email: 'nopass@test.com' });
    expect(data.stack).toBeUndefined();
  });

  it('401 에러 응답에 stack 필드 없음', async () => {
    const { data } = await req('GET', '/api/auth/sessions');
    expect(data.stack).toBeUndefined();
  });

  it('403 에러 응답에 stack 필드 없음', async () => {
    const { data } = await req('GET', '/internal/sql');
    expect(data.stack).toBeUndefined();
  });

  it('404 에러 응답에 stack 필드 없음', async () => {
    const { data } = await req('GET', '/api/nonexistent-route');
    expect(data.stack).toBeUndefined();
  });

  it('에러 응답에 내부 파일 경로 포함되지 않음', async () => {
    const { data } = await req('POST', '/api/auth/signup', {});
    const json = JSON.stringify(data);
    expect(json).not.toContain('.ts');
    expect(json).not.toContain('node_modules');
  });
});

// ─── 12. EdgeBaseError 직접 검증 ────────────────────────────────────────────

describe('1-26 error-format — EdgeBaseError 구조', () => {
  // Import EdgeBaseError from shared
  it('EdgeBaseError toJSON 형식 확인 (via error response)', async () => {
    // All error responses should follow EdgeBaseError.toJSON() shape
    const { data } = await req('GET', '/api/auth/sessions');
    // { code: number, message: string, data?: {...} }
    expect(typeof data.code).toBe('number');
    expect(typeof data.message).toBe('string');
  });

  it('data 필드 per-field 에러 (schema validation)', async () => {
    const { status, data } = await req('POST', '/api/db/shared/tables/posts', { title: 'a'.repeat(201) }, {
      'X-EdgeBase-Service-Key': SK,
    });
    // title max=200, so 201 chars fails validation → 400 with data field
    expect(status).toBe(400);
    if (data.data) {
      // data field contains per-field errors
      expect(typeof data.data).toBe('object');
    }
  });

  it('409 Conflict 에러 JSON 형식', async () => {
    const email = `err-409-${crypto.randomUUID().slice(0, 8)}@test.com`;
    await req('POST', '/api/auth/signup', { email, password: 'Duplicate1!' });
    const { status, data } = await req('POST', '/api/auth/signup', { email, password: 'Duplicate1!' });
    expect(status).toBe(409);
    expect(data.code).toBe(409);
    expect(data.stack).toBeUndefined();
  });

  it('다양한 에러 응답 모두 { code, message } 포함 (batch)', async () => {
    const cases = [
      req('GET', '/api/auth/sessions'),                             // 401
      req('GET', '/internal/sql'),                                    // 403
      req('GET', '/api/nonexistent-xyz'),                             // 404
      req('POST', '/api/auth/signup', {}),                            // 400
    ];
    const results = await Promise.all(cases);
    for (const { data } of results) {
      expect(typeof data?.code).toBe('number');
      expect(typeof data?.message).toBe('string');
      expect(data?.stack).toBeUndefined();
    }
  });
});
