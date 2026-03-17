/**
 * Query performance benchmarks.
 *
 * Tracks response time for common query patterns.
 * Run: cd packages/server && TMPDIR=/tmp npx vitest bench --config vitest.bench.config.ts
 */
import { bench, describe, beforeAll } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';
const ADMIN_URL = '/admin/api/data/tables/posts/records';

async function api(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {
    'X-EdgeBase-Service-Key': SK,
  };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  await res.json().catch(() => null);
}

describe('Query Performance', () => {
  // Seed data if needed
  beforeAll(async () => {
    // Ensure at least some records exist for meaningful benchmarks
    for (let i = 0; i < 5; i++) {
      await api('POST', ADMIN_URL, {
        title: `bench-seed-${Date.now()}-${i}`,
        views: Math.floor(Math.random() * 100),
      });
    }
  }, 30_000);

  bench('GET list (default limit)', async () => {
    await api('GET', `${ADMIN_URL}?limit=20`);
  });

  bench('GET list (limit=100)', async () => {
    await api('GET', `${ADMIN_URL}?limit=100`);
  });

  bench('GET list with filter', async () => {
    const filter = JSON.stringify([['views', '>=', 10]]);
    await api('GET', `${ADMIN_URL}?filter=${encodeURIComponent(filter)}&limit=20`);
  });

  bench('GET list with sort', async () => {
    await api('GET', `${ADMIN_URL}?sort=views:desc&limit=20`);
  });

  bench('GET list with filter + sort + limit', async () => {
    const filter = JSON.stringify([['views', '>=', 5]]);
    await api('GET', `${ADMIN_URL}?filter=${encodeURIComponent(filter)}&sort=views:desc&limit=10`);
  });

  bench('POST create record', async () => {
    await api('POST', ADMIN_URL, {
      title: `bench-${Date.now()}`,
      views: 0,
    });
  });

  bench('GET health check', async () => {
    await api('GET', '/api/health');
  });
});
