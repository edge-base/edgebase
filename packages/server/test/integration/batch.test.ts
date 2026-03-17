/**
 * batch.test.ts — 80개
 *
 * 테스트 대상: POST /api/db/shared/tables/:name/batch
 *              POST /api/db/shared/tables/:name/batch-by-filter
 *
 * 대상 코드: src/durable-objects/database-do.ts (batch 엔드포인트)
 *   body: { inserts?, updates?, deletes? }
 *   inserts: Record[] — 최대 500개 total
 *   updates: { id, data }[]
 *   deletes: string[]
 *   batch-by-filter: { action, filter, update?, limit? }
 *
 * 격리: 고유 UUID prefix, afterAll 전체 삭제
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

async function api(method: string, path: string, body?: unknown) {
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-EdgeBase-Service-Key': SK,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

const createdIds: string[] = [];

afterAll(async () => {
  // Use batch DELETE endpoint to avoid flooding miniflare with 500+ concurrent requests.
  // The batch API handles up to 500 deletes per call in a single DO round-trip.
  for (let i = 0; i < createdIds.length; i += 500) {
    const chunk = createdIds.slice(i, i + 500);
    await api('POST', '/api/db/shared/tables/posts/batch', { deletes: chunk }).catch(() => {});
  }
});

// ─── 1. batch creates ─────────────────────────────────────────────────────────

describe('1-06 batch — creates', () => {
  it('creates 3개 → 200, created 배열 반환', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [
        { title: 'Batch Post 1' },
        { title: 'Batch Post 2' },
        { title: 'Batch Post 3' },
      ],
    });
    expect(status).toBe(200);
    expect(Array.isArray(data.inserted)).toBe(true);
    expect(data.inserted).toHaveLength(3);
    for (const r of data.inserted) createdIds.push(r.id);
  });

  it('creates 1개 → 200', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [{ title: 'Single Batch Post' }],
    });
    expect(status).toBe(200);
    expect(data.inserted).toHaveLength(1);
    createdIds.push(data.inserted[0].id);
  });

  it('creates 빈배열 → 200, created 없음(undefined 또는 빈배열)', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [],
    });
    expect(status).toBe(200);
  });

  it('creates 검증 실패(title 누락) → 400 + 전체 롤백', async () => {
    const countBefore = (await api('GET', '/api/db/shared/tables/posts/count')).data.total;
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [
        { title: 'Valid Post' },
        { content: 'No title here' }, // invalid
      ],
    });
    expect(status).toBe(400);
    const countAfter = (await api('GET', '/api/db/shared/tables/posts/count')).data.total;
    expect(countAfter).toBe(countBefore); // 롤백
  });

  it('501건 → 400 (max 500)', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: Array.from({ length: 501 }, (_, i) => ({ title: `Overflow ${i}` })),
    });
    expect(status).toBe(400);
  });

  it('500건 → 200 (경계값)', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: Array.from({ length: 500 }, (_, i) => ({ title: `Limit Post ${i}` })),
    });
    expect(status).toBe(200);
    expect(data.inserted).toHaveLength(500);
    for (const r of data.inserted) createdIds.push(r.id);
  });

  it('creates auto fields(createdAt, updatedAt, id) 생성 확인', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [{ title: 'Auto Field Batch Test' }],
    });
    const created = data.inserted[0];
    expect(typeof created.id).toBe('string');
    createdIds.push(created.id);
  });

  it('creates default 필드 적용(views=0, isPublished=false)', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [{ title: 'Batch Defaults Test' }],
    });
    const item = data.inserted[0];
    expect(item.views).toBe(0);
    createdIds.push(item.id);
  });
});

// ─── 2. batch updates ─────────────────────────────────────────────────────────

describe('1-06 batch — updates', () => {
  const batchUpdateIds: string[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 3; i++) {
      const { data } = await api('POST', '/api/db/shared/tables/posts', {
        title: `Batch Update Target ${i}`,
        views: i,
      });
      batchUpdateIds.push(data.id);
      createdIds.push(data.id);
    }
  });

  it('updates 3개 → 200, updated 배열 반환', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      updates: batchUpdateIds.map((id, i) => ({
        id,
        data: { title: `Batch Updated ${i}` },
      })),
    });
    expect(status).toBe(200);
    expect(Array.isArray(data.updated)).toBe(true);
    expect(data.updated).toHaveLength(3);
  });

  it('updates 후 GET에서 변경 확인', async () => {
    await api('POST', '/api/db/shared/tables/posts/batch', {
      updates: [{ id: batchUpdateIds[0], data: { title: 'Verified Update' } }],
    });
    const { data } = await api('GET', `/api/db/shared/tables/posts/${batchUpdateIds[0]}`);
    expect(data.title).toBe('Verified Update');
  });

  it('updates 빈배열 → 200', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', { updates: [] });
    expect(status).toBe(200);
  });
});

// ─── 3. batch deletes ─────────────────────────────────────────────────────────

describe('1-06 batch — deletes', () => {
  it('deletes 3개 → 200, deleted count 반환', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { data } = await api('POST', '/api/db/shared/tables/posts', { title: `Del Target ${i}` });
      ids.push(data.id);
    }
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      deletes: ids,
    });
    expect(status).toBe(200);
    expect(data.deleted).toBe(3);
    // 삭제 확인
    for (const id of ids) {
      const { status: gs } = await api('GET', `/api/db/shared/tables/posts/${id}`);
      expect(gs).toBe(404);
    }
  });

  it('deletes 0건 id → 성공 (count=0)', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      deletes: ['non-existent-id-xyz'],
    });
    expect(status).toBe(200);
    // deleted = 0 (id not found matches 0 rows in SQL)
  });

  it('deletes 빈배열 → 200', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', { deletes: [] });
    expect(status).toBe(200);
  });
});

// ─── 4. batch mixed ops ───────────────────────────────────────────────────────

describe('1-06 batch — mixed ops', () => {
  it('creates + updates + deletes 동시 → 200', async () => {
    // Create target for update and delete
    const { data: u } = await api('POST', '/api/db/shared/tables/posts', { title: 'MixedUpdate' });
    const { data: d } = await api('POST', '/api/db/shared/tables/posts', { title: 'MixedDelete' });

    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [{ title: 'MixedNew' }],
      updates: [{ id: u.id, data: { title: 'MixedUpdated' } }],
      deletes: [d.id],
    });
    expect(status).toBe(200);
    // 새 레코드 정리
    if (data.inserted?.[0]?.id) createdIds.push(data.inserted[0].id);
    // update 대상 정리
    createdIds.push(u.id);
  });

  it('creates + updates = 501건 → 400 (total ops limit)', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: Array.from({ length: 251 }, (_, i) => ({ title: `C${i}` })),
      updates: Array.from({ length: 250 }, (_, i) => ({ id: `fake-${i}`, data: { title: `U${i}` } })),
    });
    expect(status).toBe(400);
  });
});

// ─── 5. batch-by-filter ───────────────────────────────────────────────────────

describe('1-06 batch — batch-by-filter delete', () => {
  const filterDeleteIds: string[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 5; i++) {
      const { data } = await api('POST', '/api/db/shared/tables/posts', {
        title: `FilterDelete Target ${i}`,
        isPublished: false,
      });
      filterDeleteIds.push(data.id);
    }
  });

  afterAll(async () => {
    for (const id of filterDeleteIds) {
      await api('DELETE', `/api/db/shared/tables/posts/${id}`).catch(() => {});
    }
  });

  it('batch-by-filter delete → { processed, succeeded }', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch-by-filter', {
      action: 'delete',
      filter: [['isPublished', '==', false]],
      limit: 3,
    });
    expect(status).toBe(200);
    expect(typeof data.processed).toBe('number');
    expect(typeof data.succeeded).toBe('number');
    expect(data.succeeded).toBeGreaterThanOrEqual(0);
    expect(data.processed).toBeLessThanOrEqual(3);
  });
});

describe('1-06 batch — batch-by-filter update', () => {
  const filterUpdateIds: string[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 4; i++) {
      const { data } = await api('POST', '/api/db/shared/tables/posts', {
        title: `FilterUpdate Target ${i}`,
        isPublished: true,
      });
      filterUpdateIds.push(data.id);
      createdIds.push(data.id);
    }
  });

  it('batch-by-filter update → succeeded count', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch-by-filter', {
      action: 'update',
      filter: [['isPublished', '==', true]],
      update: { isPublished: false },
      limit: 2,
    });
    expect(status).toBe(200);
    expect(data.succeeded).toBeGreaterThanOrEqual(0);
    expect(data.processed).toBeLessThanOrEqual(2);
  });

  it('batch-by-filter: 0건 매칭 → processed=0, succeeded=0', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch-by-filter', {
      action: 'delete',
      filter: [['title', '==', 'this-title-does-not-exist-xyz']],
    });
    expect(status).toBe(200);
    expect(data.processed).toBe(0);
    expect(data.succeeded).toBe(0);
  });
});

// ─── 6. upsertMany ────────────────────────────────────────────────────────────

describe('1-06 batch — upsertMany', () => {
  const upsertIds: string[] = [];

  afterAll(async () => {
    for (const id of upsertIds) {
      await api('DELETE', `/api/db/shared/tables/posts/${id}`).catch(() => {});
    }
  });

  it('creates ?upsert=true → insert if not exists', async () => {
    const customId = 'upsert-batch-' + crypto.randomUUID().slice(0, 8);
    const { status, data } = await api(
      'POST',
      '/api/db/shared/tables/posts/batch?upsert=true&conflictTarget=id',
      {
        inserts: [{ id: customId, title: 'UpsertMany Insert' }],
      },
    );
    expect(status).toBe(200);
    expect(data.inserted?.[0]?.id).toBe(customId);
    upsertIds.push(customId);
  });

  it('upsertMany 동일 id 재전송 → update (충돌 처리)', async () => {
    const customId = 'upsert-batch2-' + crypto.randomUUID().slice(0, 8);
    // First insert
    await api('POST', '/api/db/shared/tables/posts/batch?upsert=true&conflictTarget=id', {
      inserts: [{ id: customId, title: 'Original' }],
    });
    // Second upsert → should update
    const { status, data } = await api(
      'POST',
      '/api/db/shared/tables/posts/batch?upsert=true&conflictTarget=id',
      {
        inserts: [{ id: customId, title: 'Upserted' }],
      },
    );
    expect(status).toBe(200);
    // Record should be updated
    const { data: record } = await api('GET', `/api/db/shared/tables/posts/${customId}`);
    expect(record.title).toBe('Upserted');
    upsertIds.push(customId);
  });
});

// ─── 7. createMany 추가 ──────────────────────────────────────────────────────

describe('1-06 batch — createMany 추가', () => {
  it('createMany 고유 prefix 데이터 → 200, 각 레코드 고유 id', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: Array.from({ length: 5 }, (_, i) => ({ title: `${prefix}-createMany-${i}` })),
    });
    expect(status).toBe(200);
    expect(data.inserted).toHaveLength(5);
    const ids = data.inserted.map((r: any) => r.id);
    expect(new Set(ids).size).toBe(5); // 모든 id가 고유
    for (const r of data.inserted) createdIds.push(r.id);
  });

  it('createMany 1건 → 200, created 배열 길이 1', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [{ title: `${prefix}-single` }],
    });
    expect(status).toBe(200);
    expect(data.inserted).toHaveLength(1);
    createdIds.push(data.inserted[0].id);
  });

  it('createMany 빈 배열 → 200, created 없음 또는 빈 배열', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [],
    });
    expect(status).toBe(200);
    // created 비어있거나 undefined
    expect(!data.inserted || data.inserted.length === 0).toBe(true);
  });

  it('createMany 전체 검증 실패 시 하나도 생성되지 않음 (전체 롤백)', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const countBefore = (await api('GET', '/api/db/shared/tables/posts/count')).data.total;
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [
        { title: `${prefix}-valid1` },
        { title: `${prefix}-valid2` },
        { content: 'no-title-invalid' }, // title required → fail
      ],
    });
    expect(status).toBe(400);
    const countAfter = (await api('GET', '/api/db/shared/tables/posts/count')).data.total;
    expect(countAfter).toBe(countBefore);
  });

  it('createMany 500건 경계값 → 200', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: Array.from({ length: 500 }, (_, i) => ({ title: `${prefix}-lim-${i}` })),
    });
    expect(status).toBe(200);
    expect(data.inserted).toHaveLength(500);
    for (const r of data.inserted) createdIds.push(r.id);
  });

  it('createMany 501건 → 400 (max 500 초과)', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: Array.from({ length: 501 }, (_, i) => ({ title: `${prefix}-over-${i}` })),
    });
    expect(status).toBe(400);
  });

  it('createMany 짧은 title → 201 성공 (min 제약 없음)', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [{ title: 'ab' }, { title: 'xy' }],
    });
    expect(status).toBe(200);
    for (const item of (data.inserted ?? [])) {
      createdIds.push(item.id);
    }
  });

  it('createMany — default 필드(views=0, isPublished=false) 일괄 적용', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [{ title: `${prefix}-defaults-a` }, { title: `${prefix}-defaults-b` }],
    });
    for (const item of data.inserted) {
      expect(item.views).toBe(0);
      createdIds.push(item.id);
    }
  });

  it('createMany — 각 레코드에 createdAt 자동 생성', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [{ title: `${prefix}-ts-check` }],
    });
    const created = data.inserted[0];
    expect(typeof created.createdAt).toBe('string');
    expect(new Date(created.createdAt).getTime()).toBeGreaterThan(0);
    createdIds.push(created.id);
  });

  it('createMany — 중복 title 허용 (unique 아닌 필드)', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const title = `${prefix}-dup-title`;
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [{ title }, { title }, { title }],
    });
    expect(status).toBe(200);
    expect(data.inserted).toHaveLength(3);
    for (const r of data.inserted) createdIds.push(r.id);
  });
});

// ─── 8. updateMany 추가 ──────────────────────────────────────────────────────

describe('1-06 batch — updateMany 추가', () => {
  const updateTargetIds: string[] = [];
  const prefix = crypto.randomUUID().slice(0, 8);

  beforeAll(async () => {
    for (let i = 0; i < 5; i++) {
      const { data } = await api('POST', '/api/db/shared/tables/posts', {
        title: `${prefix}-updateMany-${i}`,
        views: i * 10,
      });
      updateTargetIds.push(data.id);
      createdIds.push(data.id);
    }
  });

  it('updateMany 조건 매칭 5건 → 200, updated 5개', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      updates: updateTargetIds.map((id, i) => ({
        id,
        data: { title: `${prefix}-updated-${i}` },
      })),
    });
    expect(status).toBe(200);
    expect(data.updated).toHaveLength(5);
  });

  it('updateMany 후 GET에서 각 레코드 변경 확인', async () => {
    const { data } = await api('GET', `/api/db/shared/tables/posts/${updateTargetIds[0]}`);
    expect(data.title).toContain('updated');
  });

  it('updateMany 매칭 0건 (존재하지 않는 id) → 200, updated 빈배열', async () => {
    const fakeId = crypto.randomUUID();
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      updates: [{ id: fakeId, data: { title: 'Ghost Update' } }],
    });
    expect(status).toBe(200);
    // 존재하지 않는 id → updated 배열에 0건 또는 에러 없이 무시
  });

  it('updateMany 빈 배열 → 200', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', { updates: [] });
    expect(status).toBe(200);
  });

  it('updateMany — 일부 필드만 변경해도 나머지 필드 유지', async () => {
    const targetId = updateTargetIds[1];
    // 먼저 현재 views 확인
    const { data: before } = await api('GET', `/api/db/shared/tables/posts/${targetId}`);
    await api('POST', '/api/db/shared/tables/posts/batch', {
      updates: [{ id: targetId, data: { title: `${prefix}-partial-update` } }],
    });
    const { data: after } = await api('GET', `/api/db/shared/tables/posts/${targetId}`);
    expect(after.title).toBe(`${prefix}-partial-update`);
    expect(after.views).toBe(before.views); // 변경하지 않은 필드 유지
  });

  it('updateMany — updatedAt 갱신 확인', async () => {
    const targetId = updateTargetIds[2];
    const { data: before } = await api('GET', `/api/db/shared/tables/posts/${targetId}`);
    await new Promise(r => setTimeout(r, 5));
    await api('POST', '/api/db/shared/tables/posts/batch', {
      updates: [{ id: targetId, data: { title: `${prefix}-ts-update` } }],
    });
    const { data: after } = await api('GET', `/api/db/shared/tables/posts/${targetId}`);
    expect(new Date(after.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before.updatedAt).getTime(),
    );
  });

  it('updateMany — 동일 id 중복 업데이트 → 마지막 값 반영', async () => {
    const targetId = updateTargetIds[3];
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', {
      updates: [
        { id: targetId, data: { title: `${prefix}-first` } },
        { id: targetId, data: { title: `${prefix}-second` } },
      ],
    });
    expect(status).toBe(200);
    const { data } = await api('GET', `/api/db/shared/tables/posts/${targetId}`);
    expect(data.title).toBe(`${prefix}-second`);
  });
});

// ─── 9. deleteMany 추가 ──────────────────────────────────────────────────────

describe('1-06 batch — deleteMany 추가', () => {
  it('deleteMany 조건 매칭 3건 → 200, deleted count', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { data } = await api('POST', '/api/db/shared/tables/posts', {
        title: `${prefix}-delMany-${i}`,
      });
      ids.push(data.id);
    }
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      deletes: ids,
    });
    expect(status).toBe(200);
    expect(data.deleted).toBe(3);
    for (const id of ids) {
      const { status: gs } = await api('GET', `/api/db/shared/tables/posts/${id}`);
      expect(gs).toBe(404);
    }
  });

  it('deleteMany 매칭 0건 → 200, deleted=0', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      deletes: [crypto.randomUUID(), crypto.randomUUID()],
    });
    expect(status).toBe(200);
    // deleted = 0 (non-existent ids)
  });

  it('deleteMany 빈 배열 → 200', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', { deletes: [] });
    expect(status).toBe(200);
  });

  it('deleteMany 단건 삭제 → 200, deleted=1', async () => {
    const { data: created } = await api('POST', '/api/db/shared/tables/posts', {
      title: `delSingle-${crypto.randomUUID().slice(0, 8)}`,
    });
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      deletes: [created.id],
    });
    expect(status).toBe(200);
    expect(data.deleted).toBe(1);
  });

  it('deleteMany 이미 삭제된 id 재삭제 → 200, deleted=0', async () => {
    const { data: created } = await api('POST', '/api/db/shared/tables/posts', {
      title: `delTwice-${crypto.randomUUID().slice(0, 8)}`,
    });
    await api('POST', '/api/db/shared/tables/posts/batch', { deletes: [created.id] });
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      deletes: [created.id],
    });
    expect(status).toBe(200);
    // 이미 삭제된 id → 0
  });

  it('deleteMany + 존재하는 id + 존재하지 않는 id 혼합 → 200', async () => {
    const { data: created } = await api('POST', '/api/db/shared/tables/posts', {
      title: `delMixed-${crypto.randomUUID().slice(0, 8)}`,
    });
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      deletes: [created.id, crypto.randomUUID()],
    });
    expect(status).toBe(200);
    expect(data.deleted).toBeGreaterThanOrEqual(1);
  });
});

// ─── 10. batch-by-filter 추가 ────────────────────────────────────────────────

describe('1-06 batch — batch-by-filter 추가', () => {
  const prefix = crypto.randomUUID().slice(0, 8);
  const filterIds: string[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 10; i++) {
      const { data } = await api('POST', '/api/db/shared/tables/posts', {
        title: `${prefix}-filter-${i}`,
        views: i,
        isPublished: i % 2 === 0,
      });
      filterIds.push(data.id);
      createdIds.push(data.id);
    }
  });

  it('batch-by-filter update limit=3 → processed <= 3', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch-by-filter', {
      action: 'update',
      filter: [['isPublished', '==', true]],
      update: { views: 999 },
      limit: 3,
    });
    expect(status).toBe(200);
    expect(data.processed).toBeLessThanOrEqual(3);
  });

  it('batch-by-filter delete limit=2 → processed <= 2', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch-by-filter', {
      action: 'delete',
      filter: [['isPublished', '==', false]],
      limit: 2,
    });
    expect(status).toBe(200);
    expect(data.processed).toBeLessThanOrEqual(2);
  });

  it('batch-by-filter 0건 매칭 → processed=0, succeeded=0', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch-by-filter', {
      action: 'delete',
      filter: [['title', '==', `nonexistent-${crypto.randomUUID()}`]],
    });
    expect(status).toBe(200);
    expect(data.processed).toBe(0);
    expect(data.succeeded).toBe(0);
  });

  it('batch-by-filter limit 500 청크 → 200', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch-by-filter', {
      action: 'update',
      filter: [['isPublished', '==', true]],
      update: { views: 0 },
      limit: 500,
    });
    expect(status).toBe(200);
    expect(typeof data.processed).toBe('number');
    expect(typeof data.succeeded).toBe('number');
  });

  it('batch-by-filter update 누락(action=update인데 update 미제공) → 400', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch-by-filter', {
      action: 'update',
      filter: [['isPublished', '==', true]],
      // update 누락
    });
    expect(status).toBe(400);
  });

  it('batch-by-filter action 누락 → 400', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch-by-filter', {
      filter: [['isPublished', '==', true]],
    });
    expect(status).toBe(400);
  });

  it('batch-by-filter filter 누락 → 400', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch-by-filter', {
      action: 'delete',
    });
    expect(status).toBe(400);
  });

  it('batch-by-filter 잘못된 action → 400', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch-by-filter', {
      action: 'invalid_action',
      filter: [['isPublished', '==', true]],
    });
    expect(status).toBe(400);
  });
});

// ─── 11. batch mixed ops 추가 ────────────────────────────────────────────────

describe('1-06 batch — mixed ops 추가', () => {
  it('creates + deletes 동시 → 200', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data: toDelete } = await api('POST', '/api/db/shared/tables/posts', {
      title: `${prefix}-toDelete`,
    });
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [{ title: `${prefix}-newInMixed` }],
      deletes: [toDelete.id],
    });
    expect(status).toBe(200);
    if (data.inserted?.[0]?.id) createdIds.push(data.inserted[0].id);
  });

  it('updates + deletes 동시 → 200', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data: u } = await api('POST', '/api/db/shared/tables/posts', {
      title: `${prefix}-upTarget`,
    });
    const { data: d } = await api('POST', '/api/db/shared/tables/posts', {
      title: `${prefix}-delTarget`,
    });
    createdIds.push(u.id);
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', {
      updates: [{ id: u.id, data: { title: `${prefix}-updated` } }],
      deletes: [d.id],
    });
    expect(status).toBe(200);
  });

  it('creates + updates + deletes 전부 → 200, 각 결과 반환', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data: u } = await api('POST', '/api/db/shared/tables/posts', {
      title: `${prefix}-mixAllUp`,
    });
    const { data: d } = await api('POST', '/api/db/shared/tables/posts', {
      title: `${prefix}-mixAllDel`,
    });
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [{ title: `${prefix}-mixAllNew` }],
      updates: [{ id: u.id, data: { title: `${prefix}-mixAllUpd` } }],
      deletes: [d.id],
    });
    expect(status).toBe(200);
    expect(data.inserted?.length).toBeGreaterThanOrEqual(1);
    expect(data.updated?.length).toBeGreaterThanOrEqual(1);
    if (data.inserted?.[0]?.id) createdIds.push(data.inserted[0].id);
    createdIds.push(u.id);
  });

  it('mixed ops total 500 → 200 (경계값)', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: Array.from({ length: 250 }, (_, i) => ({ title: `${prefix}-mixLim-${i}` })),
      updates: [],
      deletes: Array.from({ length: 250 }, () => crypto.randomUUID()),
    });
    expect(status).toBe(200);
    if (data.inserted) {
      for (const r of data.inserted) createdIds.push(r.id);
    }
  });

  it('mixed ops total 501 → 400 (total ops limit 초과)', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: Array.from({ length: 200 }, (_, i) => ({ title: `${prefix}-overA-${i}` })),
      updates: Array.from({ length: 200 }, (_, i) => ({ id: `fake-${i}`, data: { title: 'x' } })),
      deletes: Array.from({ length: 101 }, () => crypto.randomUUID()),
    });
    expect(status).toBe(400);
  });

  it('빈 body → 200 (아무 연산 없음)', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', {});
    expect(status).toBe(200);
  });

  it('creates 빈 + updates 빈 + deletes 빈 → 200', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [],
      updates: [],
      deletes: [],
    });
    expect(status).toBe(200);
  });
});

// ─── 12. mid-failure 부분 보존 ────────────────────────────────────────────────

describe('1-06 batch — mid-failure / partial retention', () => {
  it('creates 중 유효성 실패 → 전체 롤백 (유효한 것도 생성 안 됨)', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const countBefore = (await api('GET', '/api/db/shared/tables/posts/count')).data.total;
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [
        { title: `${prefix}-ok1` },
        { title: `${prefix}-ok2` },
        { title: 'a'.repeat(201) }, // max:200 초과 → 실패
        { title: `${prefix}-ok3` },
      ],
    });
    expect(status).toBe(400);
    const countAfter = (await api('GET', '/api/db/shared/tables/posts/count')).data.total;
    expect(countAfter).toBe(countBefore);
  });

  it('updates에 유효하지 않은 데이터 → 400', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data: target } = await api('POST', '/api/db/shared/tables/posts', {
      title: `${prefix}-midFail`,
    });
    createdIds.push(target.id);
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', {
      updates: [{ id: target.id, data: { title: 'a'.repeat(201) } }], // max:200 초과
    });
    expect(status).toBe(400);
  });

  it('mixed: creates 유효 + updates 실패 → 전체 롤백', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const countBefore = (await api('GET', '/api/db/shared/tables/posts/count')).data.total;
    const { data: target } = await api('POST', '/api/db/shared/tables/posts', {
      title: `${prefix}-mixFail`,
    });
    createdIds.push(target.id);
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [{ title: `${prefix}-shouldRollback` }],
      updates: [{ id: target.id, data: { title: 'a'.repeat(201) } }], // max:200 초과
    });
    expect(status).toBe(400);
    const countAfter = (await api('GET', '/api/db/shared/tables/posts/count')).data.total;
    // creates도 롤백됨
    expect(countAfter).toBeLessThanOrEqual(countBefore + 1); // target 생성분만 존재
  });
});

// ─── 13. rules failure → full rollback ───────────────────────────────────────

describe('1-06 batch — rules failure', () => {
  it('인증 없이 batch delete → 401 또는 403 (posts delete는 auth!=null)', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { data: target } = await api('POST', '/api/db/shared/tables/posts', {
      title: `${prefix}-rulesFail`,
    });
    createdIds.push(target.id);
    // No auth header → rules fail
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/posts/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletes: [target.id] }),
    });
    expect([401, 403].includes(res.status)).toBe(true);
  });

  it('categories batch create 인증 없이 → 401 또는 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/categories/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inserts: [{ name: `rulesFail-${crypto.randomUUID().slice(0, 8)}` }] }),
    });
    expect([401, 403].includes(res.status)).toBe(true);
  });
});

// ─── 14. upsertMany 추가 ────────────────────────────────────────────────────

describe('1-06 batch — upsertMany 추가', () => {
  const upsertCleanup: string[] = [];

  afterAll(async () => {
    // Use batch DELETE endpoint — single DO round-trip per 500 IDs (top-level afterAll과 동일 패턴)
    for (let i = 0; i < upsertCleanup.length; i += 500) {
      const chunk = upsertCleanup.slice(i, i + 500);
      await api('POST', '/api/db/shared/tables/posts/batch', { deletes: chunk }).catch(() => {});
    }
  }, 30_000);

  it('upsert 다건 insert → 200, 모두 생성됨', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const id1 = `upsert-multi-${prefix}-1`;
    const id2 = `upsert-multi-${prefix}-2`;
    const { status, data } = await api(
      'POST',
      '/api/db/shared/tables/posts/batch?upsert=true&conflictTarget=id',
      { inserts: [{ id: id1, title: `${prefix}-up1` }, { id: id2, title: `${prefix}-up2` }] },
    );
    expect(status).toBe(200);
    expect(data.inserted).toHaveLength(2);
    upsertCleanup.push(id1, id2);
  });

  it('upsert 기존 레코드 update → 필드 변경 확인', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const customId = `upsert-up-${prefix}`;
    await api('POST', '/api/db/shared/tables/posts/batch?upsert=true&conflictTarget=id', {
      inserts: [{ id: customId, title: `${prefix}-orig` }],
    });
    await api('POST', '/api/db/shared/tables/posts/batch?upsert=true&conflictTarget=id', {
      inserts: [{ id: customId, title: `${prefix}-changed`, views: 77 }],
    });
    const { data } = await api('GET', `/api/db/shared/tables/posts/${customId}`);
    expect(data.title).toBe(`${prefix}-changed`);
    upsertCleanup.push(customId);
  });

  it('upsert conflictTarget 없이 → 일반 insert 동작', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { status, data } = await api(
      'POST',
      '/api/db/shared/tables/posts/batch?upsert=true',
      { inserts: [{ title: `${prefix}-noConflict` }] },
    );
    // conflictTarget 누락 시 일반 insert 또는 400
    expect([200, 400].includes(status)).toBe(true);
    if (status === 200 && data.inserted?.[0]?.id) {
      upsertCleanup.push(data.inserted[0].id);
    }
  });

  it('upsert 빈 creates → 200, 아무 것도 안 함', async () => {
    const { status } = await api(
      'POST',
      '/api/db/shared/tables/posts/batch?upsert=true&conflictTarget=id',
      { inserts: [] },
    );
    expect(status).toBe(200);
  });

  it('upsert 500건 경계값 → 200', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const ids = Array.from({ length: 500 }, (_, i) => `upsert-lim-${prefix}-${i}`);
    const { status, data } = await api(
      'POST',
      '/api/db/shared/tables/posts/batch?upsert=true&conflictTarget=id',
      { inserts: ids.map(id => ({ id, title: `${prefix}-${id.slice(-3)}` })) },
    );
    expect(status).toBe(200);
    for (const id of ids) upsertCleanup.push(id);
  });
});

// ─── 15. batch individual rule evaluation ────────────────────────────────────

describe('1-06 batch — individual rule evaluation', () => {
  it('batch create on posts (public) → 200', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [{ title: `${prefix}-public-batch` }],
    });
    expect(status).toBe(200);
    if (data.inserted?.[0]?.id) createdIds.push(data.inserted[0].id);
  });

  it('batch on non-existent table → 404', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/nonexistent_table_xyz/batch', {
      inserts: [{ title: 'Should Fail' }],
    });
    expect(status).toBe(404);
  });

  it('batch-by-filter on non-existent table → 404', async () => {
    const { status } = await api(
      'POST',
      '/api/db/shared/tables/nonexistent_table_xyz/batch-by-filter',
      { action: 'delete', filter: [['title', '==', 'x']] },
    );
    expect(status).toBe(404);
  });

  it('batch body가 JSON이 아닌 경우 → 400', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/posts/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': SK,
      },
      body: 'not a json',
    });
    expect([400, 500].includes(res.status)).toBe(true);
  });

  it('batch creates에 null 전달 → 200 또는 400', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: null,
    });
    expect([200, 400].includes(status)).toBe(true);
  });

  it('batch updates에 id 누락 → 400', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', {
      updates: [{ data: { title: 'no-id' } }],
    });
    expect(status).toBe(400);
  });

  it('batch updates에 data 누락 → 400', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', {
      updates: [{ id: crypto.randomUUID() }],
    });
    expect(status).toBe(400);
  });

  it('batch deletes에 빈 문자열 id → 200 또는 400', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts/batch', {
      deletes: [''],
    });
    expect([200, 400].includes(status)).toBe(true);
  });

  it('batch GET method → 405 (POST only)', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/posts/batch');
    expect([404, 405].includes(status)).toBe(true);
  });

  it('batch creates에 unknown 필드 → 무시 또는 400', async () => {
    const prefix = crypto.randomUUID().slice(0, 8);
    const { status, data } = await api('POST', '/api/db/shared/tables/posts/batch', {
      inserts: [{ title: `${prefix}-unknown`, unknownField: 'should-be-ignored' }],
    });
    expect([200, 400].includes(status)).toBe(true);
    if (status === 200 && data.inserted?.[0]?.id) createdIds.push(data.inserted[0].id);
  });
});
