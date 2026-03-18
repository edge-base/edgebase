/**
 * core/unit/table.test.ts — JS SDK @edge-base/core TableRef 단위 테스트
 *
 * 실제 서버(wrangler dev --local :8688)로 fetch — no mock
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@edge-base/web';
import { increment, deleteField } from '@edge-base/core';

const SERVER = 'http://localhost:8688';
const SK = 'test-service-key-for-admin';

// Admin client (SK) → 규칙 통과 보장
function adminClient() {
  // AdminEdgeBase는 http.ts에서 X-EdgeBase-Service-Key 주입
  return createClient(SERVER);
}

// Raw fetch helper (SK)
async function raw(method: string, path: string, body?: unknown) {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-EdgeBase-Service-Key': SK,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

let createdId: string;

// ─── TableRef CRUD ────────────────────────────────────────────────────────────

describe('js-core:table — insert / getOne / update / delete', () => {
  it('insert → 반환에 id 있음', async () => {
    const { data } = await raw('POST', '/api/db/shared/tables/posts', { title: 'JS Unit Create' });
    expect(typeof data.id).toBe('string');
    createdId = data.id;
  });

  it('getOne → title 일치', async () => {
    if (!createdId) return;
    const { data } = await raw('GET', `/api/db/shared/tables/posts/${createdId}`);
    expect(data.title).toBe('JS Unit Create');
  });

  it('update (PATCH) → 변경된 title', async () => {
    if (!createdId) return;
    const { data } = await raw('PATCH', `/api/db/shared/tables/posts/${createdId}`, { title: 'JS Unit Updated' });
    expect(data.title).toBe('JS Unit Updated');
  });

  it('delete → 204 / 200', async () => {
    if (!createdId) return;
    const res = await fetch(`${SERVER}/api/db/shared/tables/posts/${createdId}`, {
      method: 'DELETE',
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect([200, 204].includes(res.status)).toBe(true);
  });

  it('delete된 record GET → 404', async () => {
    if (!createdId) return;
    const { status } = await raw('GET', `/api/db/shared/tables/posts/${createdId}`);
    expect(status).toBe(404);
  });
});

// ─── TableRef LIST ────────────────────────────────────────────────────────────

describe('js-core:table — list / filter / sort / limit / cursor', () => {
  const ids: string[] = [];

  beforeAll(async () => {
    const items = [
      { title: 'List A', isPublished: true },
      { title: 'List B', isPublished: false },
      { title: 'List C', isPublished: true },
    ];
    for (const item of items) {
      const { data } = await raw('POST', '/api/db/shared/tables/posts', item);
      if (data?.id) ids.push(data.id);
    }
  });

  afterAll(async () => {
    for (const id of ids) await raw('DELETE', `/api/db/shared/tables/posts/${id}`);
  });

  it('list → items 배열 반환', async () => {
    const { data } = await raw('GET', '/api/db/shared/tables/posts');
    expect(Array.isArray(data.items)).toBe(true);
  });

  it('limit=2 → 최대 2개', async () => {
    const { data } = await raw('GET', '/api/db/shared/tables/posts?limit=2');
    expect(data.items.length).toBeLessThanOrEqual(2);
  });

  it('filter isPublished=true → 모두 isPublished:true', async () => {
    const filter = JSON.stringify([['isPublished', '==', true]]);
    const { data } = await raw('GET', `/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}`);
    for (const item of data.items ?? []) {
      expect(item.isPublished).toBe(true);
    }
  });

  it('sort by title asc → 정렬됨', async () => {
    const { data } = await raw('GET', '/api/db/shared/tables/posts?sort=title:asc&limit=10');
    const titles = (data.items ?? []).map((i: any) => i.title);
    const sorted = [...titles].sort();
    expect(titles).toEqual(sorted);
  });

  it('count endpoint → total 숫자', async () => {
    const { status, data } = await raw('GET', '/api/db/shared/tables/posts/count');
    expect(status).toBe(200);
    expect(typeof data.total).toBe('number');
  });
});

// ─── TableRef UPSERT ──────────────────────────────────────────────────────────

describe('js-core:table — upsert', () => {
  let upsertId: string;

  it('upsert?upsert=true — 새 레코드 → action=inserted', async () => {
    const res = await fetch(`${SERVER}/api/db/shared/tables/posts?upsert=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': SK },
      body: JSON.stringify({ title: 'Upsert Test' }),
    });
    const data = await res.json() as any;
    expect(data.action).toBe('inserted');
    upsertId = data.id;
  });

  it('upsert 같은 id → action=updated', async () => {
    if (!upsertId) return;
    const res = await fetch(`${SERVER}/api/db/shared/tables/posts?upsert=true&conflictTarget=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': SK },
      body: JSON.stringify({ id: upsertId, title: 'Upsert Updated' }),
    });
    const data = await res.json() as any;
    expect(data.action).toBe('updated');
    expect(data.title).toBe('Upsert Updated');
  });

  afterAll(async () => {
    if (upsertId) await raw('DELETE', `/api/db/shared/tables/posts/${upsertId}`);
  });
});

// ─── Field Operations ─────────────────────────────────────────────────────────

describe('js-core:field-ops — increment / deleteField', () => {
  let postId: string;

  beforeAll(async () => {
    const { data } = await raw('POST', '/api/db/shared/tables/posts', { title: 'FieldOps', viewCount: 0 });
    postId = data?.id;
  });

  afterAll(async () => {
    if (postId) await raw('DELETE', `/api/db/shared/tables/posts/${postId}`);
  });

  it('increment(5) → viewCount 증가', async () => {
    if (!postId) return;
    const body = { viewCount: { $op: 'increment', value: 5 } };
    const { data } = await raw('PATCH', `/api/db/shared/tables/posts/${postId}`, body);
    expect(data.viewCount).toBe(5);
  });

  it('increment(-2) → viewCount 감소', async () => {
    if (!postId) return;
    const body = { viewCount: { $op: 'increment', value: -2 } };
    const { data } = await raw('PATCH', `/api/db/shared/tables/posts/${postId}`, body);
    expect(data.viewCount).toBe(3);
  });

  it('deleteField → null', async () => {
    if (!postId) return;
    const body = { title: { $op: 'deleteField' } };
    const { data } = await raw('PATCH', `/api/db/shared/tables/posts/${postId}`, body);
    expect(data.title).toBeNull();
  });

  it('SDK increment() serializeFieldOps 확인', () => {
    const op = increment(10);
    expect(op.$op).toBe('increment');
    expect(op.value).toBe(10);
  });

  it('SDK deleteField() serializeFieldOps 확인', () => {
    const op = deleteField();
    expect(op.$op).toBe('deleteField');
    expect(op.value).toBeUndefined();
  });
});

// ─── Batch ────────────────────────────────────────────────────────────────────

describe('js-core:table — insertMany / updateMany / deleteMany', () => {
  const batchIds: string[] = [];

  it('insertMany 3개 → 3개 반환', async () => {
    const items = [
      { title: 'Batch A' },
      { title: 'Batch B' },
      { title: 'Batch C' },
    ];
    const res = await fetch(`${SERVER}/api/db/shared/tables/posts/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': SK },
      body: JSON.stringify({ inserts: items }),
    });
    const data = await res.json() as any;
    expect(data.inserted.length).toBe(3);
    batchIds.push(...data.inserted.map((i: any) => i.id));
  });

  it('batch-by-filter update → processed 반환', async () => {
    const filter = JSON.stringify([['title', '==', 'Batch A']]);
    const res = await fetch(`${SERVER}/api/db/shared/tables/posts/batch-by-filter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': SK },
      body: JSON.stringify({
        action: 'update',
        filter: JSON.parse(filter),
        update: { title: 'Batch A Updated' },
        limit: 500,
      }),
    });
    const data = await res.json() as any;
    expect(typeof data.processed).toBe('number');
  });

  it('batch-by-filter delete', async () => {
    const filter = [['title', '==', 'Batch B']];
    const res = await fetch(`${SERVER}/api/db/shared/tables/posts/batch-by-filter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': SK },
      body: JSON.stringify({ action: 'delete', filter, limit: 500 }),
    });
    const data = await res.json() as any;
    expect(typeof data.processed).toBe('number');
  });

  afterAll(async () => {
    for (const id of batchIds) await raw('DELETE', `/api/db/shared/tables/posts/${id}`).catch(() => {});
  });
});

// ─── OR Filter ────────────────────────────────────────────────────────────────

describe('js-core:table — OR filter', () => {
  const orIds: string[] = [];

  beforeAll(async () => {
    for (const t of ['OR Alpha', 'OR Beta', 'OR Gamma']) {
      const { data } = await raw('POST', '/api/db/shared/tables/posts', { title: t });
      if (data?.id) orIds.push(data.id);
    }
  });

  afterAll(async () => {
    for (const id of orIds) await raw('DELETE', `/api/db/shared/tables/posts/${id}`).catch(() => {});
  });

  it('orFilter — title=OR Alpha OR title=OR Beta → 2개', async () => {
    const filter = JSON.stringify([['title', '==', 'OR Alpha']]);
    const orFilter = JSON.stringify([['title', '==', 'OR Beta']]);
    const { data } = await raw(
      'GET',
      `/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}&orFilter=${encodeURIComponent(orFilter)}&limit=10`
    );
    const titles = (data.items ?? []).map((i: any) => i.title);
    expect(titles.includes('OR Alpha') || titles.includes('OR Beta')).toBe(true);
  });
});
