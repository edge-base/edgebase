/**
 * Property-based integration tests — Stage 3.
 *
 * Uses fast-check to verify "always-true" properties with random inputs.
 * Seed data is isolated with a unique PREFIX per test run.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';
const ADMIN_URL = '/admin/api/data/tables/posts/records';
const DO_URL = '/api/db/shared/tables/posts';

async function api(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {
    'X-EdgeBase-Service-Key': SK,
  };
  if (body && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

// ─── Seed Data ───────────────────────────────────────────────────────────────

describe('property-based query contract', () => {
  const seedIds: string[] = [];
  const PREFIX = `PBT-${Date.now()}-`;
  const SEED_COUNT = 50;

  beforeAll(async () => {
    // Create 50 records with diverse data
    for (let i = 0; i < SEED_COUNT; i++) {
      const views = Math.floor(Math.random() * 100);
      const { data } = await api('POST', ADMIN_URL, {
        title: `${PREFIX}Post-${String(i).padStart(3, '0')}`,
        views,
        isPublished: views >= 50,
      });
      if (data?.id) seedIds.push(data.id);
    }
  }, 60_000);

  afterAll(async () => {
    // Batch cleanup
    for (let i = 0; i < seedIds.length; i += 100) {
      const chunk = seedIds.slice(i, i + 100);
      for (const id of chunk) {
        await api('DELETE', `${ADMIN_URL}/${id}`).catch(() => {});
      }
    }
  }, 30_000);

  // Helper: fetch our seed data only (filter by PREFIX)
  async function fetchSeedData(extraParams = '') {
    const prefixFilter = JSON.stringify([['title', 'contains', PREFIX]]);
    const url = `${ADMIN_URL}?filter=${encodeURIComponent(prefixFilter)}&limit=${SEED_COUNT}${extraParams ? '&' + extraParams : ''}`;
    return api('GET', url);
  }

  // ─── Property 1: limit(N) → items.length ≤ N ────────────────────────────
  it('P1: limit(N) → result length ≤ N', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }),
        async (limit) => {
          const prefixFilter = JSON.stringify([['title', 'contains', PREFIX]]);
          const { data } = await api('GET',
            `${ADMIN_URL}?filter=${encodeURIComponent(prefixFilter)}&limit=${limit}`);
          expect(data.items.length).toBeLessThanOrEqual(limit);
        },
      ),
      { numRuns: 50, verbose: 0 },
    );
  }, 60_000);

  // ─── Property 2: sort:desc → consecutive pairs are non-ascending ─────────
  it('P2: sort=views:desc → non-ascending order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('views:desc', 'title:desc', 'createdAt:desc'),
        async (sort) => {
          const prefixFilter = JSON.stringify([['title', 'contains', PREFIX]]);
          const { data } = await api('GET',
            `${ADMIN_URL}?filter=${encodeURIComponent(prefixFilter)}&sort=${sort}&limit=${SEED_COUNT}`);
          const field = sort.split(':')[0];
          const values = data.items.map((r: any) => r[field]);
          for (let i = 1; i < values.length; i++) {
            expect(values[i] <= values[i - 1]).toBe(true);
          }
        },
      ),
      { numRuns: 20, verbose: 0 },
    );
  }, 60_000);

  // ─── Property 3: filter(>= X) → all results satisfy condition ───────────
  it('P3: filter(views >= X) → all results satisfy condition', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 99 }),
        async (threshold) => {
          const filter = JSON.stringify([
            ['title', 'contains', PREFIX],
            ['views', '>=', threshold],
          ]);
          const { data } = await api('GET',
            `${ADMIN_URL}?filter=${encodeURIComponent(filter)}&limit=${SEED_COUNT}`);
          for (const item of data.items) {
            expect(item.views).toBeGreaterThanOrEqual(threshold);
          }
        },
      ),
      { numRuns: 50, verbose: 0 },
    );
  }, 60_000);

  // ─── Property 4: cursor pagination → no ID duplicates across pages ───────
  it('P4: cursor pagination → no duplicate IDs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10 }),
        async (pageSize) => {
          const allIds = new Set<string>();
          let cursor: string | null = null;
          const prefixFilter = JSON.stringify([['title', 'contains', PREFIX]]);

          for (let page = 0; page < 10; page++) {
            let url = `${ADMIN_URL}?filter=${encodeURIComponent(prefixFilter)}&limit=${pageSize}`;
            if (cursor) url += `&after=${cursor}`;
            const { data } = await api('GET', url);
            for (const item of data.items) {
              expect(allIds.has(item.id)).toBe(false);
              allIds.add(item.id);
            }
            cursor = data.cursor;
            if (!data.hasMore && !data.cursor) break;
          }
        },
      ),
      { numRuns: 20, verbose: 0 },
    );
  }, 120_000);

  // ─── Property 5: admin proxy === DO direct (transparency) ────────────────
  it('P5: admin proxy result === DO direct result', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('views:desc', 'views:asc', 'title:asc'),
        fc.integer({ min: 1, max: 20 }),
        async (sort, limit) => {
          const prefixFilter = JSON.stringify([['title', 'contains', PREFIX]]);
          const params = `filter=${encodeURIComponent(prefixFilter)}&sort=${sort}&limit=${limit}`;
          const admin = await api('GET', `${ADMIN_URL}?${params}`);
          const direct = await api('GET', `${DO_URL}?${params}`);
          expect(admin.data.items.map((r: any) => r.id))
            .toEqual(direct.data.items.map((r: any) => r.id));
        },
      ),
      { numRuns: 30, verbose: 0 },
    );
  }, 60_000);

  // ─── Property 6: orFilter → OR conditions satisfied ────────────────────
  it('P6: orFilter → at least one OR condition satisfied', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 60, max: 99 }),
        async (low, high) => {
          const filter = JSON.stringify([['title', 'contains', PREFIX]]);
          const orFilter = JSON.stringify([
            ['views', '<=', low],
            ['views', '>=', high],
          ]);
          const { data } = await api('GET',
            `${ADMIN_URL}?filter=${encodeURIComponent(filter)}&orFilter=${encodeURIComponent(orFilter)}&limit=${SEED_COUNT}`);
          for (const item of data.items) {
            expect(item.views <= low || item.views >= high).toBe(true);
          }
        },
      ),
      { numRuns: 30, verbose: 0 },
    );
  }, 60_000);

  // ─── Property 7: sort:asc → consecutive pairs are non-descending ───────
  it('P7: sort=views:asc → non-descending order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('views:asc', 'title:asc', 'createdAt:asc'),
        async (sort) => {
          const prefixFilter = JSON.stringify([['title', 'contains', PREFIX]]);
          const { data } = await api('GET',
            `${ADMIN_URL}?filter=${encodeURIComponent(prefixFilter)}&sort=${sort}&limit=${SEED_COUNT}`);
          const field = sort.split(':')[0];
          const values = data.items.map((r: any) => r[field]);
          for (let i = 1; i < values.length; i++) {
            expect(values[i] >= values[i - 1]).toBe(true);
          }
        },
      ),
      { numRuns: 20, verbose: 0 },
    );
  }, 60_000);
});
