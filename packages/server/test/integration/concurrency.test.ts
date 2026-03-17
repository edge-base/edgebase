/**
 * Concurrency safety tests.
 *
 * Verifies that concurrent operations don't cause data corruption.
 * Cloudflare Durable Objects are single-threaded, but the Worker layer
 * can receive concurrent requests that get serialized by the DO.
 */
import { describe, it, expect, afterAll } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';
// Use /api/db/shared/ endpoint (matches crud.test.ts pattern)
const TABLE_URL = '/api/db/shared/tables/posts';

async function api(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {
    'X-EdgeBase-Service-Key': SK,
    'Content-Type': 'application/json',
  };
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

describe('Concurrency Safety', () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    if (createdIds.length > 0) {
      const chunks = [];
      for (let i = 0; i < createdIds.length; i += 50) {
        chunks.push(createdIds.slice(i, i + 50));
      }
      for (const chunk of chunks) {
        await api('POST', `${TABLE_URL}/batch`, { deletes: chunk }).catch(() => {});
      }
    }
  }, 30_000);

  it('concurrent GET reads do not crash the server', async () => {
    // Issue 20 concurrent GETs to the list endpoint
    const COUNT = 20;
    const promises = Array.from({ length: COUNT }, () =>
      api('GET', `${TABLE_URL}?limit=5`),
    );

    const results = await Promise.all(promises);

    // All should return 200 (public read access)
    for (const r of results) {
      expect(r.status).toBe(200);
    }

    // All should return valid list structure
    for (const r of results) {
      expect(r.data).toHaveProperty('items');
      expect(Array.isArray(r.data.items)).toBe(true);
    }
  }, 15_000);

  it('concurrent reads return identical results', async () => {
    // Issue 10 concurrent reads with same params — should all return same data
    const COUNT = 10;
    const promises = Array.from({ length: COUNT }, () =>
      api('GET', `${TABLE_URL}?limit=3&sort=createdAt:asc`),
    );

    const results = await Promise.all(promises);

    // All responses should be 200
    for (const r of results) {
      expect(r.status).toBe(200);
    }

    // All should return the same set of items
    const firstItems = JSON.stringify(results[0].data.items);
    for (let i = 1; i < results.length; i++) {
      expect(JSON.stringify(results[i].data.items)).toBe(firstItems);
    }
  }, 15_000);

  it('concurrent writes produce unique IDs (when POST works)', async () => {
    // Try a single write first to check if POST is available
    const probe = await api('POST', TABLE_URL, {
      title: `probe-${Date.now()}`,
      views: 0,
    });

    // POST must succeed — no silent skip
    expect(probe.status).toBe(201);
    if (probe.data?.id) createdIds.push(probe.data.id);

    // POST works — run concurrent writes
    const COUNT = 5;
    const promises = Array.from({ length: COUNT }, (_, i) =>
      api('POST', TABLE_URL, {
        title: `concurrent-${Date.now()}-${i}`,
        views: i,
      }),
    );

    const results = await Promise.all(promises);
    const successes = results.filter(r => r.status >= 200 && r.status < 300);

    for (const r of successes) {
      if (r.data?.id) createdIds.push(r.data.id);
    }

    // All should succeed
    expect(successes.length).toBe(COUNT);

    // All IDs should be unique
    const ids = successes.map(r => r.data.id);
    expect(new Set(ids).size).toBe(COUNT);
  }, 30_000);

  it('concurrent auth requests do not deadlock', async () => {
    // Issue 5 concurrent signups — tests auth DO concurrency
    const COUNT = 5;
    const promises = Array.from({ length: COUNT }, (_, i) =>
      api('POST', '/api/auth/signup', {
        email: `concurrency-${Date.now()}-${i}@test.com`,
        password: 'Concurrent1234!',
      }),
    );

    const results = await Promise.all(promises);

    // All should get a valid response (not hang/deadlock, no 500)
    for (const r of results) {
      // Acceptable: 201 (created) or 429 (rate limited) — never 500
      expect(r.status).toBeLessThan(500);
    }
  }, 30_000);
});
