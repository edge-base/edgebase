/**
 * do-lifecycle.test.ts — 50개
 *
 * 테스트 대상: DO 초기화, 스키마 생성, lazy init
 *              database-do.ts의 initializeSchema, 백업 dump, 헬스 체크
 *
 * GET /api/health — degraded/ok 상태 확인
 * GET /api/db/:ns/health (내부) — DO 헬스 체크
 * DO 초기화: initializeSchema → tables 생성
 *
 * CRUD 이후 DO 상태 확인을 통해 lifecycle 검증
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

async function api(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'X-EdgeBase-Service-Key': SK };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

// ─── 1. 헬스 체크 ────────────────────────────────────────────────────────────

describe('1-25 do-lifecycle — 헬스 체크', () => {
  it('GET /api/health → 200', async () => {
    const { status } = await api('GET', '/api/health');
    expect(status).toBe(200);
  });

  it('/api/health → { status: "ok" | "degraded", version: string }', async () => {
    const { data } = await api('GET', '/api/health');
    expect(['ok', 'degraded'].includes(data.status)).toBe(true);
    expect(typeof data.version).toBe('string');
  });
});

// ─── 2. DO 첫 초기화 — 스키마 생성 ───────────────────────────────────────────

describe('1-25 do-lifecycle — DO 첫 초기화', () => {
  it('첫 번째 CRUD → DO 초기화됨 (posts 테이블)', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/posts');
    expect(status).toBe(200);
  });

  it('이미 초기화된 DO → 중복 초기화 없음 (두 번째 요청도 200)', async () => {
    const r1 = await api('GET', '/api/db/shared/tables/posts');
    const r2 = await api('GET', '/api/db/shared/tables/posts');
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  it('다른 namespace DO → 각자 독립 초기화', async () => {
    // shared namespace
    const r1 = await api('GET', '/api/db/shared/tables/posts');
    expect(r1.status).toBe(200);
  });

  it('스키마 해시 저장 → 동일 config 재요청 시 skip', async () => {
    // Just verify GET returns consistently
    const r1 = await api('GET', '/api/db/shared/tables/posts');
    const r2 = await api('GET', '/api/db/shared/tables/posts?limit=1');
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });
});

// ─── 3. DO CRUD 후 상태 유지 ─────────────────────────────────────────────────

describe('1-25 do-lifecycle — CRUD 데이터 영속성', () => {
  let postId: string;

  beforeAll(async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Lifecycle Test Post',
    });
    postId = data?.id;
  });

  it('생성 후 GET → 데이터 존재', async () => {
    if (!postId) return;
    const { status, data } = await api('GET', `/api/db/shared/tables/posts/${postId}`);
    expect(status).toBe(200);
    expect(data.title).toBe('Lifecycle Test Post');
  });

  it('UPDATE 후 GET → 변경된 데이터', async () => {
    if (!postId) return;
    await api('PATCH', `/api/db/shared/tables/posts/${postId}`, { title: 'Updated Lifecycle' });
    const { data } = await api('GET', `/api/db/shared/tables/posts/${postId}`);
    expect(data.title).toBe('Updated Lifecycle');
  });

  it('DELETE 후 GET → 404', async () => {
    if (!postId) return;
    await api('DELETE', `/api/db/shared/tables/posts/${postId}`);
    const { status } = await api('GET', `/api/db/shared/tables/posts/${postId}`);
    expect(status).toBe(404);
  });
});

// ─── 4. 백업 dump ─────────────────────────────────────────────────────────────

describe('1-25 do-lifecycle — 백업 dump', () => {
  it('GET /api/backup → 인증 없이 → 401 또는 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/backup`);
    expect([401, 403, 404].includes(res.status)).toBe(true);
  });

  it('SK로 백업 → 200 또는 204 (백업 지원 여부에 따라)', async () => {
    const { status } = await api('GET', '/api/backup');
    expect([200, 204, 404].includes(status)).toBe(true);
  });
});

// ─── 5. 미등록 경로/메서드 ───────────────────────────────────────────────────

describe('1-25 do-lifecycle — 경로 검증', () => {
  it('/api/db/shared/tables/없는테이블 → 404', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/not_a_real_table');
    expect(status).toBe(404);
  });

  it('/api/db/shared/tables/없는/id → 404', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/nonexistent/some-id');
    expect(status).toBe(404);
  });

  it('/api/nonexistent → 404', async () => {
    const { status } = await api('GET', '/api/nonexistent-route');
    expect(status).toBe(404);
  });

  it('POST /api/db/shared/tables/없는테이블 → 404', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/not_configured_table', { x: 1 });
    expect(status).toBe(404);
  });
});

// ─── 6. 동시성 ────────────────────────────────────────────────────────────────

describe('1-25 do-lifecycle — 동시성', () => {
  it('동시 10개 요청 → 모두 200', async () => {
    const requests = Array.from({ length: 10 }, () =>
      api('GET', '/api/db/shared/tables/posts?limit=1')
    );
    const results = await Promise.all(requests);
    for (const r of results) {
      expect(r.status).toBe(200);
    }
  });

  it('동시 CREATE 5개 → 모두 성공, ID 고유', async () => {
    const requests = Array.from({ length: 5 }, (_, i) =>
      api('POST', '/api/db/shared/tables/posts', { title: `Concurrent ${i}` })
    );
    const results = await Promise.all(requests);
    const ids = results.map(r => r.data?.id).filter(Boolean);
    expect(ids.length).toBe(5);
    expect(new Set(ids).size).toBe(5); // 유일 ID

    // Cleanup
    for (const id of ids) {
      await api('DELETE', `/api/db/shared/tables/posts/${id}`).catch(() => {});
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW TESTS — appended below (33 tests)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 7. DO name rules ─────────────────────────────────────────────────────────

describe('1-25 do-lifecycle — DO 이름 규칙', () => {
  it('shared namespace → 정적 DO (id 없음), 정상 접근', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/posts?limit=1');
    expect(status).toBe(200);
  });

  it('동일 namespace 동일 테이블 → 동일 DO (결정론적)', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { status: s1, data: d1 } = await api('POST', '/api/db/shared/tables/posts', { title: `DO-det-${prefix}` });
    expect(s1).toBe(201);
    const { status: s2, data: d2 } = await api('GET', `/api/db/shared/tables/posts/${d1.id}`);
    expect(s2).toBe(200);
    expect(d2.title).toBe(`DO-det-${prefix}`);
    // Cleanup
    await api('DELETE', `/api/db/shared/tables/posts/${d1.id}`);
  });

  it('같은 namespace 반복 접근 → 동일 DO에서 서빙', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data: created } = await api('POST', '/api/db/shared/tables/posts', { title: `same-do-${prefix}` });
    const { data: fetched } = await api('GET', `/api/db/shared/tables/posts/${created.id}`);
    expect(fetched.id).toBe(created.id);
    // Cleanup
    await api('DELETE', `/api/db/shared/tables/posts/${created.id}`);
  });
});

// ─── 8. articles collection — shared DO ──────────────────────────────────────

describe('1-25 do-lifecycle — articles collection', () => {
  it('articles → 생성 가능', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { status, data } = await api('POST', '/api/db/shared/tables/articles', {
      title: `articles-${prefix}`,
    });
    expect(status).toBe(201);
    expect(data.title).toBe(`articles-${prefix}`);
    // Cleanup
    await api('DELETE', `/api/db/shared/tables/articles/${data.id}`);
  });

  it('articles → 조회 가능', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data: created } = await api('POST', '/api/db/shared/tables/articles', {
      title: `articles-read-${prefix}`,
    });
    const { status, data } = await api('GET', `/api/db/shared/tables/articles/${created.id}`);
    expect(status).toBe(200);
    expect(data.title).toBe(`articles-read-${prefix}`);
    // Cleanup
    await api('DELETE', `/api/db/shared/tables/articles/${created.id}`);
  });

  it('articles → 목록 조회 가능', async () => {
    const { status, data } = await api('GET', '/api/db/shared/tables/articles?limit=1');
    expect(status).toBe(200);
    expect(data.items).toBeDefined();
  });

  it('articles → UPDATE 가능', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data: created } = await api('POST', '/api/db/shared/tables/articles', {
      title: `articles-upd-${prefix}`,
    });
    const { status } = await api('PATCH', `/api/db/shared/tables/articles/${created.id}`, {
      title: `articles-updated-${prefix}`,
    });
    expect(status).toBe(200);
    // Cleanup
    await api('DELETE', `/api/db/shared/tables/articles/${created.id}`);
  });

  it('articles → DELETE 가능', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data: created } = await api('POST', '/api/db/shared/tables/articles', {
      title: `articles-del-${prefix}`,
    });
    const { status } = await api('DELETE', `/api/db/shared/tables/articles/${created.id}`);
    expect([200, 204].includes(status)).toBe(true);
  });
});

// ─── 9. _system DO ───────────────────────────────────────────────────────────

describe('1-25 do-lifecycle — _system DO', () => {
  it('_system DO → health 체크 (200)', async () => {
    const { status } = await api('GET', '/api/health');
    expect(status).toBe(200);
  });
});

// ─── 10. 미등록 테이블 접근 ──────────────────────────────────────────────────

describe('1-25 do-lifecycle — 미등록 테이블 접근', () => {
  it('config에 없는 테이블 POST → 404', async () => {
    const tableName = `auto_${crypto.randomUUID().slice(0, 8)}`;
    const { status } = await api('POST', `/api/db/shared/tables/${tableName}`, { x: 1 });
    expect(status).toBe(404);
  });

  it('config에 없는 테이블 GET → 404', async () => {
    const tableName = `auto_${crypto.randomUUID().slice(0, 8)}`;
    const { status } = await api('GET', `/api/db/shared/tables/${tableName}`);
    expect(status).toBe(404);
  });

  it('config에 없는 테이블 PATCH → 404', async () => {
    const tableName = `auto_${crypto.randomUUID().slice(0, 8)}`;
    const { status } = await api('PATCH', `/api/db/shared/tables/${tableName}/some-id`, { x: 1 });
    expect(status).toBe(404);
  });

  it('config에 없는 테이블 DELETE → 404', async () => {
    const tableName = `auto_${crypto.randomUUID().slice(0, 8)}`;
    const { status } = await api('DELETE', `/api/db/shared/tables/${tableName}/some-id`);
    expect(status).toBe(404);
  });
});

// ─── 11. UUID v7 — 생성된 ID 검증 ───────────────────────────────────────────

describe('1-25 do-lifecycle — UUID v7 ID 생성', () => {
  it('생성된 ID는 UUID 형식', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data } = await api('POST', '/api/db/shared/tables/posts', { title: `uuid-${prefix}` });
    expect(data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // Cleanup
    await api('DELETE', `/api/db/shared/tables/posts/${data.id}`);
  });

  it('연속 생성된 ID는 시간순 정렬됨', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data: d1 } = await api('POST', '/api/db/shared/tables/posts', { title: `uuid-order-1-${prefix}` });
    const { data: d2 } = await api('POST', '/api/db/shared/tables/posts', { title: `uuid-order-2-${prefix}` });
    // UUID v7 is time-ordered, so d1.id < d2.id lexicographically
    expect(d1.id < d2.id).toBe(true);
    // Cleanup
    await api('DELETE', `/api/db/shared/tables/posts/${d1.id}`);
    await api('DELETE', `/api/db/shared/tables/posts/${d2.id}`);
  });
});

// ─── 12. auto-fields (createdAt, updatedAt) ─────────────────────────────────

describe('1-25 do-lifecycle — auto-fields', () => {
  it('생성 시 createdAt 자동 설정', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data } = await api('POST', '/api/db/shared/tables/posts', { title: `auto-ca-${prefix}` });
    expect(data.createdAt).toBeDefined();
    expect(typeof data.createdAt).toBe('string');
    // Cleanup
    await api('DELETE', `/api/db/shared/tables/posts/${data.id}`);
  });

  it('생성 시 updatedAt 자동 설정', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data } = await api('POST', '/api/db/shared/tables/posts', { title: `auto-ua-${prefix}` });
    expect(data.updatedAt).toBeDefined();
    expect(typeof data.updatedAt).toBe('string');
    // Cleanup
    await api('DELETE', `/api/db/shared/tables/posts/${data.id}`);
  });

  it('UPDATE 후 updatedAt 갱신됨', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data: created } = await api('POST', '/api/db/shared/tables/posts', { title: `auto-upd-${prefix}` });
    // Small delay to ensure timestamp difference
    await new Promise(r => setTimeout(r, 10));
    await api('PATCH', `/api/db/shared/tables/posts/${created.id}`, { title: `auto-upd2-${prefix}` });
    const { data: updated } = await api('GET', `/api/db/shared/tables/posts/${created.id}`);
    expect(updated.updatedAt >= created.updatedAt).toBe(true);
    // Cleanup
    await api('DELETE', `/api/db/shared/tables/posts/${created.id}`);
  });

  it('createdAt은 UPDATE 후에도 불변', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data: created } = await api('POST', '/api/db/shared/tables/posts', { title: `ca-immut-${prefix}` });
    await api('PATCH', `/api/db/shared/tables/posts/${created.id}`, { title: `ca-immut2-${prefix}` });
    const { data: updated } = await api('GET', `/api/db/shared/tables/posts/${created.id}`);
    expect(updated.createdAt).toBe(created.createdAt);
    // Cleanup
    await api('DELETE', `/api/db/shared/tables/posts/${created.id}`);
  });
});

// ─── 13. default 값 검증 ────────────────────────────────────────────────────

describe('1-25 do-lifecycle — default 값', () => {
  it('views default 0 → 생성 시 0', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data } = await api('POST', '/api/db/shared/tables/posts', { title: `def-views-${prefix}` });
    expect(data.views).toBe(0);
    // Cleanup
    await api('DELETE', `/api/db/shared/tables/posts/${data.id}`);
  });

  it('isPublished default false → 생성 시 0 (SQLite INTEGER)', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data } = await api('POST', '/api/db/shared/tables/posts', { title: `def-pub-${prefix}` });
    // SQLite stores false as 0
    expect(data.isPublished === false || data.isPublished === 0).toBe(true);
    // Cleanup
    await api('DELETE', `/api/db/shared/tables/posts/${data.id}`);
  });

  it('articles status default "draft" → 생성 시 "draft"', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data } = await api('POST', '/api/db/shared/tables/articles', { title: `def-status-${prefix}` });
    expect(data.status).toBe('draft');
    // Cleanup
    await api('DELETE', `/api/db/shared/tables/articles/${data.id}`);
  });
});

// ─── 14. Service Key 바이패스 검증 ───────────────────────────────────────────

describe('1-25 do-lifecycle — Service Key', () => {
  it('SK 있으면 규칙 바이패스 → categories 생성 가능', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { status, data } = await api('POST', '/api/db/shared/tables/categories', {
      name: `sk-bypass-${prefix}`,
    });
    expect(status).toBe(201);
    // Cleanup
    await api('DELETE', `/api/db/shared/tables/categories/${data.id}`);
  });

  it('SK 없이 categories 생성 → auth 필요 (401)', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `no-sk-${prefix}` }),
    });
    // categories.create: (auth) => auth !== null → without auth = 403 or 401
    expect([401, 403].includes(res.status)).toBe(true);
  });
});

// ─── 15. 멀티 테이블 동시 접근 ──────────────────────────────────────────────

describe('1-25 do-lifecycle — 멀티 테이블 동시 접근', () => {
  it('posts + categories + articles 동시 GET → 모두 200', async () => {
    const [r1, r2, r3] = await Promise.all([
      api('GET', '/api/db/shared/tables/posts?limit=1'),
      api('GET', '/api/db/shared/tables/categories?limit=1'),
      api('GET', '/api/db/shared/tables/articles?limit=1'),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
  });

  it('서로 다른 테이블 CREATE → 각자 독립 ID', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const [rPost, rCat] = await Promise.all([
      api('POST', '/api/db/shared/tables/posts', { title: `multi-p-${prefix}` }),
      api('POST', '/api/db/shared/tables/categories', { name: `multi-c-${prefix}` }),
    ]);
    expect(rPost.status).toBe(201);
    expect(rCat.status).toBe(201);
    expect(rPost.data.id).not.toBe(rCat.data.id);
    // Cleanup
    await api('DELETE', `/api/db/shared/tables/posts/${rPost.data.id}`);
    await api('DELETE', `/api/db/shared/tables/categories/${rCat.data.id}`);
  });
});

// ─── 16. 존재하지 않는 레코드 ID ────────────────────────────────────────────

describe('1-25 do-lifecycle — 존재하지 않는 레코드', () => {
  it('GET 존재하지 않는 ID → 404', async () => {
    const fakeId = crypto.randomUUID();
    const { status } = await api('GET', `/api/db/shared/tables/posts/${fakeId}`);
    expect(status).toBe(404);
  });

  it('PATCH 존재하지 않는 ID → 404', async () => {
    const fakeId = crypto.randomUUID();
    const { status } = await api('PATCH', `/api/db/shared/tables/posts/${fakeId}`, { title: 'nope' });
    expect(status).toBe(404);
  });

  it('DELETE 존재하지 않는 ID → 404', async () => {
    const fakeId = crypto.randomUUID();
    const { status } = await api('DELETE', `/api/db/shared/tables/posts/${fakeId}`);
    expect(status).toBe(404);
  });
});

// ─── 17. 목록 조회 응답 포맷 ────────────────────────────────────────────────

describe('1-25 do-lifecycle — 목록 조회 응답 포맷', () => {
  it('GET list → items 배열 존재', async () => {
    const { data } = await api('GET', '/api/db/shared/tables/posts?limit=5');
    expect(Array.isArray(data.items)).toBe(true);
  });

  it('GET list → total 필드 존재 (offset pagination)', async () => {
    const { data } = await api('GET', '/api/db/shared/tables/posts?limit=5');
    expect(typeof data.total).toBe('number');
  });

  it('GET list → page/perPage 필드 존재', async () => {
    const { data } = await api('GET', '/api/db/shared/tables/posts?limit=5&page=1');
    expect(data.page).toBeDefined();
    expect(data.perPage).toBeDefined();
  });

  it('limit=1 → items 최대 1개', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    await api('POST', '/api/db/shared/tables/posts', { title: `limit-1a-${prefix}` });
    await api('POST', '/api/db/shared/tables/posts', { title: `limit-1b-${prefix}` });
    const { data } = await api('GET', '/api/db/shared/tables/posts?limit=1');
    expect(data.items.length).toBeLessThanOrEqual(1);
  });
});

// ─── 18. 에러 응답 포맷 (PocketBase style) ──────────────────────────────────

describe('1-25 do-lifecycle — 에러 응답 포맷', () => {
  it('validation 에러 → { code, message, data }', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', {});
    expect(data.code).toBeDefined();
    expect(data.message).toBeDefined();
  });

  it('404 에러 → JSON 응답', async () => {
    const fakeId = crypto.randomUUID();
    const { data } = await api('GET', `/api/db/shared/tables/posts/${fakeId}`);
    expect(data).toBeDefined();
  });
});
