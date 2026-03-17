/**
 * @edgebase/admin — Property-based E2E 테스트
 *
 * fast-check으로 SDK .where() 결과 === HTTP 직접 호출 결과 검증.
 * SDK가 쿼리 파라미터를 올바르게 전달하는지 랜덤 조합으로 확인.
 *
 * wrangler dev --port 8688 실서버 필요
 *
 * 실행:
 *   BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
 *     npx vitest run packages/sdk/js/packages/admin/test/e2e/property.e2e.test.ts
 *
 * 원칙: mock 금지, 실서버 fetch
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { createAdminClient } from '../../src/index.js';

const BASE_URL = process.env['BASE_URL'] || 'http://localhost:8688';
const SERVICE_KEY = process.env['SERVICE_KEY'] || 'test-service-key-for-admin';
const PREFIX = `prop-e2e-${Date.now()}`;
const SEED_COUNT = 30;

let admin: ReturnType<typeof createAdminClient>;
const seedIds: string[] = [];

// ─── Raw HTTP helper (SDK 우회) ─────────────────────────────────────────────

async function rawHttp(
  method: string,
  path: string,
  query?: Record<string, string>,
  body?: unknown,
) {
  const url = new URL(path, BASE_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }
  const headers: Record<string, string> = {
    'X-EdgeBase-Service-Key': SERVICE_KEY,
  };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json() as Promise<any>;
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

beforeAll(async () => {
  admin = createAdminClient(BASE_URL, { serviceKey: SERVICE_KEY });

  // Seed 30 records with diverse data
  for (let i = 0; i < SEED_COUNT; i++) {
    const views = Math.floor(Math.random() * 100);
    const r = await admin.db('shared').table('posts').insert({
      title: `${PREFIX}-Post-${String(i).padStart(3, '0')}`,
      views,
      isPublished: views >= 50,
    });
    if ((r as any).id) seedIds.push((r as any).id);
  }
}, 60_000);

afterAll(async () => {
  for (const id of seedIds) {
    try {
      await admin.db('shared').table('posts').delete(id);
    } catch {}
  }
  admin.destroy();
}, 30_000);

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('SDK Property E2E — SDK === HTTP', () => {
  // ─── P1: SDK .where() + .orderBy() + .limit() === raw HTTP ──────────────
  it('P1: SDK filter+sort+limit === HTTP direct', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('views:desc', 'views:asc', 'title:asc'),
        fc.integer({ min: 1, max: 20 }),
        async (sort, limit) => {
          const [field, dir] = sort.split(':') as [string, 'asc' | 'desc'];

          // SDK call
          const sdkResult = await admin
            .db('shared')
            .table('posts')
            .where('title', 'contains', PREFIX)
            .orderBy(field, dir)
            .limit(limit)
            .getList();

          // Raw HTTP call
          const filter = JSON.stringify([['title', 'contains', PREFIX]]);
          const httpResult = await rawHttp(
            'GET',
            '/admin/api/data/tables/posts/records',
            { filter, sort, limit: String(limit) },
          );

          // Compare: same IDs in same order
          const sdkIds = sdkResult.items.map((r: any) => r.id);
          const httpIds = httpResult.items.map((r: any) => r.id);
          expect(sdkIds).toEqual(httpIds);
        },
      ),
      { numRuns: 30, verbose: 0 },
    );
  }, 60_000);

  // ─── P2: SDK .where(>=) → same filtered set as HTTP ────────────────────
  it('P2: SDK where(views >= X) === HTTP filter', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 99 }),
        async (threshold) => {
          // SDK call
          const sdkResult = await admin
            .db('shared')
            .table('posts')
            .where('title', 'contains', PREFIX)
            .where('views', '>=', threshold)
            .orderBy('views', 'asc')
            .limit(SEED_COUNT)
            .getList();

          // Raw HTTP call
          const filter = JSON.stringify([
            ['title', 'contains', PREFIX],
            ['views', '>=', threshold],
          ]);
          const httpResult = await rawHttp(
            'GET',
            '/admin/api/data/tables/posts/records',
            { filter, sort: 'views:asc', limit: String(SEED_COUNT) },
          );

          // Same IDs in same order
          const sdkIds = sdkResult.items.map((r: any) => r.id);
          const httpIds = httpResult.items.map((r: any) => r.id);
          expect(sdkIds).toEqual(httpIds);
        },
      ),
      { numRuns: 30, verbose: 0 },
    );
  }, 60_000);

  // ─── P3: SDK cursor pagination === HTTP cursor pagination ───────────────
  it('P3: SDK cursor pagination === HTTP pagination', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 8 }),
        async (pageSize) => {
          // SDK: collect all pages
          const sdkAllIds: string[] = [];
          let sdkRef = admin
            .db('shared')
            .table('posts')
            .where('title', 'contains', PREFIX)
            .limit(pageSize);

          for (let p = 0; p < 10; p++) {
            const result = await sdkRef.getList();
            for (const item of result.items) {
              sdkAllIds.push((item as any).id);
            }
            if (!result.hasMore || !result.cursor) break;
            sdkRef = admin
              .db('shared')
              .table('posts')
              .where('title', 'contains', PREFIX)
              .limit(pageSize)
              .after(result.cursor);
          }

          // HTTP: collect all pages
          const httpAllIds: string[] = [];
          const filter = JSON.stringify([['title', 'contains', PREFIX]]);
          let cursor: string | null = null;

          for (let p = 0; p < 10; p++) {
            const params: Record<string, string> = {
              filter,
              limit: String(pageSize),
            };
            if (cursor) params.after = cursor;
            const data = await rawHttp(
              'GET',
              '/admin/api/data/tables/posts/records',
              params,
            );
            for (const item of data.items) {
              httpAllIds.push(item.id);
            }
            cursor = data.cursor;
            if (!data.hasMore && !data.cursor) break;
          }

          // Both should have collected the same set of IDs
          expect(sdkAllIds.sort()).toEqual(httpAllIds.sort());
        },
      ),
      { numRuns: 15, verbose: 0 },
    );
  }, 120_000);

  // ─── P4: SDK .limit(N) always returns ≤ N items ────────────────────────
  it('P4: SDK limit(N) → items.length ≤ N', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: SEED_COUNT }),
        async (limit) => {
          const result = await admin
            .db('shared')
            .table('posts')
            .where('title', 'contains', PREFIX)
            .limit(limit)
            .getList();
          expect(result.items.length).toBeLessThanOrEqual(limit);
        },
      ),
      { numRuns: 30, verbose: 0 },
    );
  }, 60_000);

  // ─── P5: SDK .orderBy(desc) → non-ascending ────────────────────────────
  it('P5: SDK orderBy(desc) → non-ascending order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('views', 'title', 'createdAt'),
        async (field) => {
          const result = await admin
            .db('shared')
            .table('posts')
            .where('title', 'contains', PREFIX)
            .orderBy(field, 'desc')
            .limit(SEED_COUNT)
            .getList();
          const values = result.items.map((r: any) => r[field]);
          for (let i = 1; i < values.length; i++) {
            expect(values[i] <= values[i - 1]).toBe(true);
          }
        },
      ),
      { numRuns: 15, verbose: 0 },
    );
  }, 60_000);

  // ─── P6: SDK .or() === HTTP orFilter ─────────────────────────────────────
  it('P6: SDK .or() === HTTP orFilter', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 51, max: 99 }),
        async (low, high) => {
          // SDK call with .or()
          const sdkResult = await admin
            .db('shared')
            .table('posts')
            .where('title', 'contains', PREFIX)
            .or(q => q.where('views', '<=', low).where('views', '>=', high))
            .limit(SEED_COUNT)
            .getList();

          // Raw HTTP call with orFilter
          const filter = JSON.stringify([['title', 'contains', PREFIX]]);
          const orFilter = JSON.stringify([
            ['views', '<=', low],
            ['views', '>=', high],
          ]);
          const httpResult = await rawHttp(
            'GET',
            '/admin/api/data/tables/posts/records',
            { filter, orFilter, limit: String(SEED_COUNT) },
          );

          // Same IDs (order may differ, so compare sorted sets)
          const sdkIds = sdkResult.items.map((r: any) => r.id).sort();
          const httpIds = httpResult.items.map((r: any) => r.id).sort();
          expect(sdkIds).toEqual(httpIds);

          // All items satisfy at least one OR condition
          for (const item of sdkResult.items) {
            expect((item as any).views <= low || (item as any).views >= high).toBe(true);
          }
        },
      ),
      { numRuns: 20, verbose: 0 },
    );
  }, 60_000);

  // ─── P7: SDK .orderBy(asc) === HTTP sort:asc ────────────────────────────
  it('P7: SDK orderBy(asc) === HTTP sort:asc → non-descending', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('views', 'title', 'createdAt'),
        async (field) => {
          // SDK call
          const sdkResult = await admin
            .db('shared')
            .table('posts')
            .where('title', 'contains', PREFIX)
            .orderBy(field, 'asc')
            .limit(SEED_COUNT)
            .getList();

          // Raw HTTP call
          const filter = JSON.stringify([['title', 'contains', PREFIX]]);
          const httpResult = await rawHttp(
            'GET',
            '/admin/api/data/tables/posts/records',
            { filter, sort: `${field}:asc`, limit: String(SEED_COUNT) },
          );

          // Same IDs in same order
          const sdkIds = sdkResult.items.map((r: any) => r.id);
          const httpIds = httpResult.items.map((r: any) => r.id);
          expect(sdkIds).toEqual(httpIds);

          // Verify non-descending order
          const values = sdkResult.items.map((r: any) => r[field]);
          for (let i = 1; i < values.length; i++) {
            expect(values[i] >= values[i - 1]).toBe(true);
          }
        },
      ),
      { numRuns: 15, verbose: 0 },
    );
  }, 60_000);

  // ─── P8: SDK .where() with random operators === HTTP filter ─────────────
  it('P8: SDK .where(random op) === HTTP filter', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('>=', '>', '<=', '<', '==', '!=') as fc.Arbitrary<string>,
        fc.integer({ min: 0, max: 100 }),
        async (op, value) => {
          // SDK call
          const sdkResult = await admin
            .db('shared')
            .table('posts')
            .where('title', 'contains', PREFIX)
            .where('views', op, value)
            .orderBy('views', 'asc')
            .limit(SEED_COUNT)
            .getList();

          // Raw HTTP call
          const filter = JSON.stringify([
            ['title', 'contains', PREFIX],
            ['views', op, value],
          ]);
          const httpResult = await rawHttp(
            'GET',
            '/admin/api/data/tables/posts/records',
            { filter, sort: 'views:asc', limit: String(SEED_COUNT) },
          );

          // Same IDs in same order
          const sdkIds = sdkResult.items.map((r: any) => r.id);
          const httpIds = httpResult.items.map((r: any) => r.id);
          expect(sdkIds).toEqual(httpIds);
        },
      ),
      { numRuns: 30, verbose: 0 },
    );
  }, 60_000);
});
