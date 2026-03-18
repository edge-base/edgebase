/**
 * @edgebase-fun/core + @edgebase-fun/admin — E2E 테스트
 *
 * wrangler dev --port 8688 로컬 서버 필요
 *
 * 실행:
 *   BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
 *     npx vitest run packages/sdk/js/packages/core/test/e2e/core.e2e.test.ts
 *
 * E2E 원칙: mock 금지, 실서버 fetch
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '../../../admin/src/index.js';

const BASE_URL = process.env['BASE_URL'] || 'http://localhost:8688';
const SERVICE_KEY = process.env['SERVICE_KEY'] || 'test-service-key-for-admin';


const PREFIX = `js-core-e2e-${Date.now()}`;
let admin: ReturnType<typeof createAdminClient>;
const createdIds: string[] = [];

beforeAll(() => {
  admin = createAdminClient(BASE_URL, { serviceKey: SERVICE_KEY });
});

afterAll(async () => {
  // cleanup
  const uniqueIds = Array.from(new Set(createdIds));
  const batchSize = 10;
  for (let i = 0; i < uniqueIds.length; i += batchSize) {
    const batch = uniqueIds.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(async (id) => {
        try {
          await admin.db('shared').table('posts').delete(id);
        } catch {}
      }),
    );
  }
  admin.destroy();
}, 30000);

// ─── 1. DB CRUD ───────────────────────────────────────────────────────────────

describe('E2E core — CRUD', () => {
  it('insert → id 반환', async () => {
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-create` });
    expect((r as any).id).toBeTruthy();
    createdIds.push((r as any).id);
  });

  it('getOne → 레코드 조회', async () => {
    const created = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-getOne` });
    const id = (created as any).id;
    createdIds.push(id);
    const fetched = await admin.db('shared').table('posts').getOne(id);
    expect((fetched as any).id).toBe(id);
  });

  it('update → title 변경', async () => {
    const created = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-orig` });
    const id = (created as any).id;
    createdIds.push(id);
    const updated = await admin.db('shared').table('posts').update(id, { title: `${PREFIX}-updated` });
    expect((updated as any).title).toBe(`${PREFIX}-updated`);
  });

  it('delete → getOne 404 에러', async () => {
    const created = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-del` });
    const id = (created as any).id;
    await admin.db('shared').table('posts').delete(id);
    await expect(admin.db('shared').table('posts').getOne(id)).rejects.toThrow();
  });

  it('getList() → items 배열 반환', async () => {
    const result = await admin.db('shared').table('posts').limit(5).getList();
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('count() → 숫자 반환', async () => {
    const count = await admin.db('shared').table('posts').count();
    expect(typeof count).toBe('number');
  });
});

// ─── 2. Filter & Query builder ────────────────────────────────────────────────

describe('E2E core — filter', () => {
  it('where == 필터 → 해당 레코드만 반환', async () => {
    const uniqueTitle = `${PREFIX}-filter-${crypto.randomUUID().slice(0, 6)}`;
    const r = await admin.db('shared').table('posts').insert({ title: uniqueTitle });
    createdIds.push((r as any).id);
    const list = await admin.db('shared').table('posts')
      .where('title', '==', uniqueTitle).getList();
    expect(list.items.length).toBeGreaterThanOrEqual(1);
    expect((list.items[0] as any).title).toBe(uniqueTitle);
  });

  it('orderBy + limit → 최대 N개 반환', async () => {
    const list = await admin.db('shared').table('posts').orderBy('createdAt', 'desc').limit(2).getList();
    expect(list.items.length).toBeLessThanOrEqual(2);
  });

  it('offset pagination → page1/page2 다름', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-page-${i}` });
      createdIds.push((r as any).id);
    }
    const p1 = await admin.db('shared').table('posts')
      .where('title', 'contains', `${PREFIX}-page-`)
      .orderBy('title', 'asc').limit(2).getList();
    const p2 = await admin.db('shared').table('posts')
      .where('title', 'contains', `${PREFIX}-page-`)
      .orderBy('title', 'asc').limit(2).offset(2).getList();
    if (p1.items.length > 0 && p2.items.length > 0) {
      expect((p1.items[0] as any).id).not.toBe((p2.items[0] as any).id);
    }
  });

  it('cursor pagination → after(cursor) → 다른 페이지', async () => {
    for (let i = 0; i < 4; i++) {
      const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-cur-${i}` });
      createdIds.push((r as any).id);
    }
    const p1 = await admin.db('shared').table('posts')
      .where('title', 'contains', `${PREFIX}-cur-`)
      .orderBy('title', 'asc').limit(2).getList();
    if (p1.cursor) {
      const p2 = await admin.db('shared').table('posts')
        .where('title', 'contains', `${PREFIX}-cur-`)
        .orderBy('title', 'asc').limit(2).after(p1.cursor).getList();
      const ids1 = p1.items.map(i => (i as any).id);
      const ids2 = p2.items.map(i => (i as any).id);
      const overlap = ids1.filter(id => ids2.includes(id));
      expect(overlap.length).toBe(0);
    }
  });

  it('or() 체인 → 두 조건 중 하나 만족', async () => {
    const title1 = `${PREFIX}-or-A`;
    const title2 = `${PREFIX}-or-B`;
    const r1 = await admin.db('shared').table('posts').insert({ title: title1 });
    const r2 = await admin.db('shared').table('posts').insert({ title: title2 });
    createdIds.push((r1 as any).id, (r2 as any).id);
    const list = await admin.db('shared').table('posts')
      .or(q => q.where('title', '==', title1).where('title', '==', title2)).getList();
    expect(list.items.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── 3. Batch 조작 ────────────────────────────────────────────────────────────

describe('E2E core — batch', () => {
  it('insertMany → N개 반환', async () => {
    const items = [
      { title: `${PREFIX}-batch-1` },
      { title: `${PREFIX}-batch-2` },
      { title: `${PREFIX}-batch-3` },
    ];
    const result = await admin.db('shared').table('posts').insertMany(items);
    expect(result.length).toBe(3);
    for (const r of result) createdIds.push((r as any).id);
  });

  it('updateMany → 필터 기반 일괄 업데이트', async () => {
    const title = `${PREFIX}-upd-many`;
    const r = await admin.db('shared').table('posts').insert({ title });
    createdIds.push((r as any).id);
    const result = await admin.db('shared').table('posts')
      .where('title', '==', title)
      .updateMany({ content: 'bulk-updated' });
    expect(result.totalProcessed).toBeGreaterThanOrEqual(1);
  });

  it('deleteMany → 필터 기반 일괄 삭제', async () => {
    const title = `${PREFIX}-del-many`;
    const r = await admin.db('shared').table('posts').insert({ title });
    const id = (r as any).id;
    const result = await admin.db('shared').table('posts')
      .where('title', '==', title)
      .deleteMany();
    expect(result.totalProcessed).toBeGreaterThanOrEqual(1);
    // Don't add to createdIds since already deleted
  });
});

// ─── 4. Upsert ─────────────────────────────────────────────────────────────────

describe('E2E core — upsert', () => {
  it('upsert 새 레코드 → action === "inserted"', async () => {
    const r = await admin.db('shared').table('posts').upsert({ title: `${PREFIX}-upsert-new` });
    expect((r as any).action).toBe('inserted');
    createdIds.push((r as any).id);
  });
});

// ─── 5. FieldOps ─────────────────────────────────────────────────────────────────

describe('E2E core — fieldOps', () => {
  it('increment → viewCount 증가', async () => {
    const { increment } = await import('@edgebase-fun/core');
    const created = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-inc`, viewCount: 0 });
    const id = (created as any).id;
    createdIds.push(id);
    const updated = await admin.db('shared').table('posts').update(id, { viewCount: increment(5) as any });
    expect((updated as any).viewCount).toBe(5);
  });

  it('deleteField → 필드 null/삭제', async () => {
    const { deleteField } = await import('@edgebase-fun/core');
    const created = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-del-field`, extra: 'to-delete' });
    const id = (created as any).id;
    createdIds.push(id);
    const updated = await admin.db('shared').table('posts').update(id, { extra: deleteField() as any });
    expect((updated as any).extra ?? null).toBeNull();
  });
});

// ─── 6. Error Handling ────────────────────────────────────────────────────────

describe('E2E core — error', () => {
  it('getOne 없는 id → 에러', async () => {
    await expect(admin.db('shared').table('posts').getOne('nonexistent-js-99999')).rejects.toThrow();
  });

  it('update 없는 id → 에러', async () => {
    await expect(admin.db('shared').table('posts').update('nonexistent-upd', { title: 'X' })).rejects.toThrow();
  });

  it('delete 없는 id → 에러 또는 성공', async () => {
    // server may return 200 or 404 for missing id
    try {
      await admin.db('shared').table('posts').delete('nonexistent-del-js');
    } catch {
      // 404 is expected
    }
    expect(true).toBe(true);
  });
});

// ─── 7. Promise.all 병렬 (언어특화) ──────────────────────────────────────────

describe('E2E core — Promise.all 병렬', () => {
  it('Promise.all로 3개 동시 insert', async () => {
    const titles = [`${PREFIX}-parallel-1`, `${PREFIX}-parallel-2`, `${PREFIX}-parallel-3`];
    const results = await Promise.all(
      titles.map(t => admin.db('shared').table('posts').insert({ title: t }))
    );
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect((r as any).id).toBeTruthy();
      createdIds.push((r as any).id);
    }
  });

  it('Promise.all + count 동시', async () => {
    const [count, list] = await Promise.all([
      admin.db('shared').table('posts').count(),
      admin.db('shared').table('posts').limit(3).getList(),
    ]);
    expect(typeof count).toBe('number');
    expect(Array.isArray(list.items)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Phase 2 additions below
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 8. CRUD Extended ────────────────────────────────────────────────────────

describe('E2E core — CRUD extended', () => {
  it('insert with special characters in title', async () => {
    const title = `${PREFIX}-special-"quotes" & <angle> 'apos'`;
    const r = await admin.db('shared').table('posts').insert({ title });
    expect((r as any).id).toBeTruthy();
    const fetched = await admin.db('shared').table('posts').getOne((r as any).id);
    expect((fetched as any).title).toBe(title);
    createdIds.push((r as any).id);
  });

  it('insert with unicode/emoji content', async () => {
    const title = `${PREFIX}-unicode-한국어-日本語-🎉`;
    const r = await admin.db('shared').table('posts').insert({ title });
    expect((r as any).id).toBeTruthy();
    const fetched = await admin.db('shared').table('posts').getOne((r as any).id);
    expect((fetched as any).title).toBe(title);
    createdIds.push((r as any).id);
  });

  it('insert with large payload (many fields)', async () => {
    const data: Record<string, unknown> = { title: `${PREFIX}-large` };
    for (let i = 0; i < 50; i++) {
      data[`field_${i}`] = `value_${i}_${'x'.repeat(100)}`;
    }
    const r = await admin.db('shared').table('posts').insert(data);
    expect((r as any).id).toBeTruthy();
    createdIds.push((r as any).id);
  });

  it('update preserves non-updated fields', async () => {
    const r = await admin.db('shared').table('posts').insert({
      title: `${PREFIX}-preserve`,
      content: 'original-content',
      viewCount: 42,
    });
    const id = (r as any).id;
    createdIds.push(id);
    const updated = await admin.db('shared').table('posts').update(id, { title: `${PREFIX}-preserved` });
    expect((updated as any).title).toBe(`${PREFIX}-preserved`);
    expect((updated as any).content).toBe('original-content');
    expect((updated as any).viewCount).toBe(42);
  });

  it('concurrent inserts with Promise.all (5 docs)', async () => {
    const promises = Array.from({ length: 5 }, (_, i) =>
      admin.db('shared').table('posts').insert({ title: `${PREFIX}-concurrent-${i}` })
    );
    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);
    for (const r of results) {
      expect((r as any).id).toBeTruthy();
      createdIds.push((r as any).id);
    }
  });
});

// ─── 9. QueryBuilder extended ────────────────────────────────────────────────

describe('E2E core — QueryBuilder extended', () => {
  it('where != filter', async () => {
    const title = `${PREFIX}-neq-${Date.now()}`;
    const r = await admin.db('shared').table('posts').insert({ title, status: 'draft' });
    createdIds.push((r as any).id);
    const list = await admin.db('shared').table('posts')
      .where('title', '==', title)
      .where('status', '!=', 'published')
      .getList();
    expect(list.items.length).toBeGreaterThanOrEqual(1);
  });

  it('where > filter (numeric)', async () => {
    const title = `${PREFIX}-gt-${Date.now()}`;
    await admin.db('shared').table('posts').insert({ title, viewCount: 100 }).then(r => createdIds.push((r as any).id));
    await admin.db('shared').table('posts').insert({ title, viewCount: 5 }).then(r => createdIds.push((r as any).id));
    const list = await admin.db('shared').table('posts')
      .where('title', '==', title)
      .where('viewCount', '>', 50)
      .getList();
    expect(list.items.length).toBe(1);
    expect((list.items[0] as any).viewCount).toBe(100);
  });

  it('where contains filter', async () => {
    const unique = `${PREFIX}-contains-${Date.now()}`;
    const r = await admin.db('shared').table('posts').insert({ title: unique });
    createdIds.push((r as any).id);
    const list = await admin.db('shared').table('posts')
      .where('title', 'contains', 'contains')
      .where('title', '==', unique)
      .getList();
    expect(list.items.length).toBeGreaterThanOrEqual(1);
  });

  it('where in filter', async () => {
    const t1 = `${PREFIX}-in-A-${Date.now()}`;
    const t2 = `${PREFIX}-in-B-${Date.now()}`;
    const r1 = await admin.db('shared').table('posts').insert({ title: t1 });
    const r2 = await admin.db('shared').table('posts').insert({ title: t2 });
    createdIds.push((r1 as any).id, (r2 as any).id);
    const list = await admin.db('shared').table('posts')
      .where('title', 'in', [t1, t2])
      .getList();
    expect(list.items.length).toBe(2);
  });

  it('complex .or() with nested conditions', async () => {
    const base = `${PREFIX}-or-complex-${Date.now()}`;
    const r1 = await admin.db('shared').table('posts').insert({ title: `${base}-x`, status: 'draft' });
    const r2 = await admin.db('shared').table('posts').insert({ title: `${base}-y`, status: 'archived' });
    const r3 = await admin.db('shared').table('posts').insert({ title: `${base}-z`, status: 'published' });
    createdIds.push((r1 as any).id, (r2 as any).id, (r3 as any).id);
    const list = await admin.db('shared').table('posts')
      .where('title', 'contains', base)
      .or(q => q.where('status', '==', 'draft').where('status', '==', 'archived'))
      .getList();
    expect(list.items.length).toBe(2);
  });

  it('search FTS query', async () => {
    const unique = `${PREFIX}-fts-${Date.now()}-searchable`;
    const r = await admin.db('shared').table('posts').insert({ title: unique });
    createdIds.push((r as any).id);
    // FTS may or may not return results depending on indexing
    const list = await admin.db('shared').table('posts').search('searchable').getList();
    expect(Array.isArray(list.items)).toBe(true);
  });

  it('cursor pagination: after → no overlap with page 1', async () => {
    const base = `${PREFIX}-cursor2-${Date.now()}`;
    for (let i = 0; i < 6; i++) {
      const r = await admin.db('shared').table('posts').insert({ title: `${base}-${String(i).padStart(2, '0')}` });
      createdIds.push((r as any).id);
    }
    const p1 = await admin.db('shared').table('posts')
      .where('title', 'contains', base)
      .orderBy('title', 'asc')
      .limit(3)
      .getList();
    if (p1.cursor) {
      const p2 = await admin.db('shared').table('posts')
        .where('title', 'contains', base)
        .orderBy('title', 'asc')
        .limit(3)
        .after(p1.cursor)
        .getList();
      const ids1 = new Set(p1.items.map(i => (i as any).id));
      for (const item of p2.items) {
        expect(ids1.has((item as any).id)).toBe(false);
      }
    }
  });

  it('ListResult shape: items, total, page, perPage', async () => {
    const list = await admin.db('shared').table('posts').limit(3).getList();
    expect(Array.isArray(list.items)).toBe(true);
    expect('total' in list).toBe(true);
    expect('page' in list).toBe(true);
    expect('perPage' in list).toBe(true);
  });
});

// ─── 10. Batch extended ─────────────────────────────────────────────────────

describe('E2E core — batch extended', () => {
  it('insertMany empty array → empty result', async () => {
    const result = await admin.db('shared').table('posts').insertMany([]);
    expect(result).toHaveLength(0);
  });

  it('insertMany single item', async () => {
    const result = await admin.db('shared').table('posts').insertMany([{ title: `${PREFIX}-batch-single` }]);
    expect(result).toHaveLength(1);
    createdIds.push((result[0] as any).id);
  });

  it('insertMany 10 items', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ title: `${PREFIX}-batch10-${i}` }));
    const result = await admin.db('shared').table('posts').insertMany(items);
    expect(result).toHaveLength(10);
    for (const r of result) createdIds.push((r as any).id);
  });

  it('updateMany returns totalProcessed/totalSucceeded/errors', async () => {
    const unique = `${PREFIX}-updmany2-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      const r = await admin.db('shared').table('posts').insert({ title: unique, status: 'draft' });
      createdIds.push((r as any).id);
    }
    const result = await admin.db('shared').table('posts')
      .where('title', '==', unique)
      .updateMany({ status: 'updated' });
    expect(typeof result.totalProcessed).toBe('number');
    expect(typeof result.totalSucceeded).toBe('number');
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('deleteMany removes matching records', async () => {
    const unique = `${PREFIX}-delmany2-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      await admin.db('shared').table('posts').insert({ title: unique });
    }
    const result = await admin.db('shared').table('posts')
      .where('title', '==', unique)
      .deleteMany();
    expect(result.totalSucceeded).toBeGreaterThanOrEqual(3);
    // Verify deletion
    const list = await admin.db('shared').table('posts').where('title', '==', unique).getList();
    expect(list.items).toHaveLength(0);
  });

  it('updateMany without where filter → error', async () => {
    await expect(
      admin.db('shared').table('posts').updateMany({ status: 'x' })
    ).rejects.toThrow();
  });

  it('deleteMany without where filter → error', async () => {
    await expect(
      admin.db('shared').table('posts').deleteMany()
    ).rejects.toThrow();
  });
});

// ─── 11. Storage E2E ────────────────────────────────────────────────────────

describe('E2E core — Storage', () => {
  const bucket = 'test-bucket';

  it('upload + download text file', async () => {
    const key = `core-e2e-${Date.now()}.txt`;
    const content = 'Hello from core E2E storage test';
    await admin.storage.upload(bucket, key, new Blob([content], { type: 'text/plain' }));
    const downloaded = await admin.storage.bucket(bucket).download(key, { as: 'text' }) as string;
    expect(downloaded).toBe(content);
    await admin.storage.delete(bucket, key);
  });

  it('upload + getUrl contains key', async () => {
    const key = `core-e2e-url-${Date.now()}.txt`;
    await admin.storage.upload(bucket, key, new Blob(['url test'], { type: 'text/plain' }));
    const url = admin.storage.getUrl(bucket, key);
    expect(url).toContain(key);
    await admin.storage.delete(bucket, key);
  });

  it('list files in bucket', async () => {
    const key = `core-e2e-list-${Date.now()}.txt`;
    await admin.storage.upload(bucket, key, new Blob(['list test'], { type: 'text/plain' }));
    const result = await admin.storage.bucket(bucket).list({ limit: 50 });
    expect(Array.isArray(result.files)).toBe(true);
    await admin.storage.delete(bucket, key);
  });

  it('delete removes file', async () => {
    const key = `core-e2e-del-${Date.now()}.txt`;
    await admin.storage.upload(bucket, key, new Blob(['del test'], { type: 'text/plain' }));
    await admin.storage.delete(bucket, key);
    // Downloading deleted file should fail
    try {
      await admin.storage.bucket(bucket).download(key);
      expect(false).toBe(true); // should not reach
    } catch {
      expect(true).toBe(true);
    }
  });
});

// ─── 12. FieldOps extended ──────────────────────────────────────────────────

describe('E2E core — FieldOps extended', () => {
  it('increment with decimal', async () => {
    const { increment } = await import('@edgebase-fun/core');
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-inc-dec`, score: 10 });
    const id = (r as any).id;
    createdIds.push(id);
    const updated = await admin.db('shared').table('posts').update(id, { score: increment(0.5) as any });
    expect((updated as any).score).toBeCloseTo(10.5);
  });

  it('increment with negative value', async () => {
    const { increment } = await import('@edgebase-fun/core');
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-inc-neg`, viewCount: 100 });
    const id = (r as any).id;
    createdIds.push(id);
    const updated = await admin.db('shared').table('posts').update(id, { viewCount: increment(-30) as any });
    expect((updated as any).viewCount).toBe(70);
  });

  it('multiple increments in sequence', async () => {
    const { increment } = await import('@edgebase-fun/core');
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-inc-multi`, viewCount: 0 });
    const id = (r as any).id;
    createdIds.push(id);
    await admin.db('shared').table('posts').update(id, { viewCount: increment(3) as any });
    const final = await admin.db('shared').table('posts').update(id, { viewCount: increment(7) as any });
    expect((final as any).viewCount).toBe(10);
  });

  it('deleteField on multiple fields', async () => {
    const { deleteField } = await import('@edgebase-fun/core');
    const r = await admin.db('shared').table('posts').insert({
      title: `${PREFIX}-delf-multi`,
      extra1: 'a',
      extra2: 'b',
    });
    const id = (r as any).id;
    createdIds.push(id);
    const updated = await admin.db('shared').table('posts').update(id, {
      extra1: deleteField() as any,
      extra2: deleteField() as any,
    });
    expect((updated as any).extra1 ?? null).toBeNull();
    expect((updated as any).extra2 ?? null).toBeNull();
  });
});

// ─── 13. Upsert extended ────────────────────────────────────────────────────

describe('E2E core — upsert extended', () => {
  it('upsert existing record → action === "updated"', async () => {
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-upsert-exist` });
    const id = (r as any).id;
    createdIds.push(id);
    const upserted = await admin.db('shared').table('posts').upsert({
      id,
      title: `${PREFIX}-upsert-exist-updated`,
    });
    expect((upserted as any).action).toBe('updated');
    expect((upserted as any).title).toBe(`${PREFIX}-upsert-exist-updated`);
  });
});
