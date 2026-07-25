/**
 * provider-parity.test.ts — Phase 3 provider alignment coverage.
 *
 * Pins two behaviors that were promoted/unified across providers so all three
 * (Durable Objects, D1, PostgreSQL) share one contract:
 *
 *   1. LIST/search totals are opt-in: omission, `0`, or `false` returns
 *      `total: null`; only explicit `true` returns an exact number. Verified on
 *      the D1 path ('shared') and DO path ('txdo'). PostgreSQL uses a mocked
 *      executor unit test so its exact count-query cardinality is observable.
 *
 *   2. DO rule-rejection wording now matches D1's canonical
 *      d1RuleRejectedMessage format exactly:
 *        Access denied. The '<action>' access rule for table '<table>'
 *        rejected record '<id>'.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

async function skApi(method: string, path: string, body?: unknown) {
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': SK },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function userApi(token: string, method: string, path: string, body?: unknown) {
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function getToken(): Promise<string> {
  const email = `parity-${crypto.randomUUID().slice(0, 8)}@test.com`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'ProviderParity1234!' }),
  });
  const data: any = await res.json();
  return data.accessToken ?? data.token ?? data.access_token;
}

const cleanup: Array<{ path: string; id: string }> = [];
afterAll(async () => {
  for (const { path, id } of cleanup) {
    await skApi('DELETE', `${path}/${id}`).catch(() => {});
  }
});

// ─── 1. includeTotal — exact totals are opt-in (D1 + DO parity) ──────────────

describe('provider parity — includeTotal exact counts are opt-in', () => {
  it('D1 list: explicit true counts, false/zero stay null, and omission is null', async () => {
    const title = `parityd1total${crypto.randomUUID().slice(0, 8)}`;
    const seeded = await skApi('POST', '/api/db/shared/tables/posts', { title });
    expect([200, 201].includes(seeded.status)).toBe(true);
    cleanup.push({ path: '/api/db/shared/tables/posts', id: seeded.data.id });

    const withTotal = await skApi('GET', '/api/db/shared/tables/posts?limit=5&includeTotal=true');
    expect(typeof withTotal.data.total).toBe('number');

    const skip0 = await skApi('GET', '/api/db/shared/tables/posts?limit=5&includeTotal=0');
    expect(skip0.status).toBe(200);
    expect(skip0.data.total).toBeNull();
    expect(Array.isArray(skip0.data.items)).toBe(true);
    // hasMore/cursor still drive pagination when the count is skipped.
    expect('hasMore' in skip0.data).toBe(true);

    const skipFalse = await skApi('GET', '/api/db/shared/tables/posts?limit=5&includeTotal=false');
    expect(skipFalse.data.total).toBeNull();

    const omitted = await skApi('GET', '/api/db/shared/tables/posts?limit=5');
    expect(omitted.status).toBe(200);
    expect(omitted.data.total).toBeNull();
  });

  it('D1 search: explicit true counts and omission is null', async () => {
    const title = `parityd1search${crypto.randomUUID().slice(0, 8)}`;
    const seeded = await skApi('POST', '/api/db/shared/tables/posts', { title });
    expect([200, 201].includes(seeded.status)).toBe(true);
    cleanup.push({ path: '/api/db/shared/tables/posts', id: seeded.data.id });

    const searchWithTotal = await skApi(
      'GET',
      `/api/db/shared/tables/posts/search?search=${encodeURIComponent(title)}&limit=5&includeTotal=true`,
    );
    expect(searchWithTotal.status).toBe(200);
    expect(typeof searchWithTotal.data.total).toBe('number');
    const searchOmitted = await skApi(
      'GET',
      `/api/db/shared/tables/posts/search?search=${encodeURIComponent(title)}&limit=5`,
    );
    expect(searchOmitted.status).toBe(200);
    expect(searchOmitted.data.total).toBeNull();
  });

  it('DO list: explicit true counts, false/zero stay null, and omission is null', async () => {
    const title = `paritydototal${crypto.randomUUID().slice(0, 8)}`;
    const seeded = await skApi('POST', '/api/db/txdo/tables/tx_posts', { title });
    expect([200, 201].includes(seeded.status)).toBe(true);
    cleanup.push({ path: '/api/db/txdo/tables/tx_posts', id: seeded.data.id });

    const withTotal = await skApi('GET', '/api/db/txdo/tables/tx_posts?limit=5&includeTotal=true');
    expect(typeof withTotal.data.total).toBe('number');

    const skip0 = await skApi('GET', '/api/db/txdo/tables/tx_posts?limit=5&includeTotal=0');
    expect(skip0.status).toBe(200);
    expect(skip0.data.total).toBeNull();
    expect(Array.isArray(skip0.data.items)).toBe(true);
    expect('hasMore' in skip0.data).toBe(true);

    const skipFalse = await skApi('GET', '/api/db/txdo/tables/tx_posts?limit=5&includeTotal=false');
    expect(skipFalse.data.total).toBeNull();

    const omitted = await skApi('GET', '/api/db/txdo/tables/tx_posts?limit=5');
    expect(omitted.status).toBe(200);
    expect(omitted.data.total).toBeNull();
  });

  it('DO search without configured FTS: schema text fields return results and explicit true counts', async () => {
    const title = `paritydosearch${crypto.randomUUID().slice(0, 8)}`;
    const seeded = await skApi('POST', '/api/db/txdo/tables/tx_posts', { title });
    expect([200, 201].includes(seeded.status)).toBe(true);
    cleanup.push({ path: '/api/db/txdo/tables/tx_posts', id: seeded.data.id });

    const searchWithTotal = await skApi(
      'GET',
      `/api/db/txdo/tables/tx_posts/search?search=${encodeURIComponent(title)}&limit=5&includeTotal=true`,
    );
    expect(searchWithTotal.status).toBe(200);
    expect(typeof searchWithTotal.data.total).toBe('number');
    expect(searchWithTotal.data.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: seeded.data.id, title })]),
    );
  });

  it('DO search: omission is null', async () => {
    const title = `paritydosearchomit${crypto.randomUUID().slice(0, 8)}`;
    const seeded = await skApi('POST', '/api/db/txdo/tables/tx_posts', { title });
    expect([200, 201].includes(seeded.status)).toBe(true);
    cleanup.push({ path: '/api/db/txdo/tables/tx_posts', id: seeded.data.id });

    const searchOmitted = await skApi(
      'GET',
      `/api/db/txdo/tables/tx_posts/search?search=${encodeURIComponent(title)}&limit=5`,
    );
    expect(searchOmitted.status).toBe(200);
    expect(searchOmitted.data.total).toBeNull();
  });
});

// ─── 2. Bounded set filters stay within each SQLite provider budget ───────────

describe('provider parity — SQLite set-filter bind budget', () => {
  it('DO list keeps 100 set members plus pagination inside one statement', async () => {
    const title = `paritydoset${crypto.randomUUID().slice(0, 8)}`;
    const seeded = await skApi('POST', '/api/db/txdo/tables/tx_posts', { title });
    expect([200, 201].includes(seeded.status)).toBe(true);
    cleanup.push({ path: '/api/db/txdo/tables/tx_posts', id: seeded.data.id });

    const titles = [
      title,
      ...Array.from({ length: 99 }, (_, index) => `missing-title-${index}`),
    ];
    const filter = encodeURIComponent(JSON.stringify([['title', 'in', titles]]));
    const result = await skApi(
      'GET',
      `/api/db/txdo/tables/tx_posts?filter=${filter}&limit=100&offset=0`,
    );

    expect(result.status).toBe(200);
    expect(result.data.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: seeded.data.id, title })]),
    );
  });
});

// ─── 3. DO rule-rejection wording matches D1's canonical format ───────────────

describe('provider parity — DO rule-rejection wording matches D1', () => {
  it('single-record update denial → canonical id-bearing message', async () => {
    const token = await getToken();
    // Locked rows are denied by tx_rule_rows update/delete rules (row.status).
    const locked = await skApi('POST', '/api/db/txdo/tables/tx_rule_rows', {
      title: 'parity-locked-update', status: 'locked',
    });
    expect([200, 201].includes(locked.status)).toBe(true);
    const id = locked.data.id as string;
    cleanup.push({ path: '/api/db/txdo/tables/tx_rule_rows', id });

    const res = await userApi(token, 'PATCH', `/api/db/txdo/tables/tx_rule_rows/${id}`, {
      title: 'parity-changed',
    });
    expect(res.status).toBe(403);
    expect(res.data.message).toBe(
      `Access denied. The 'update' access rule for table 'tx_rule_rows' rejected record '${id}'.`,
    );
  });

  it('single-record delete denial → canonical id-bearing message', async () => {
    const token = await getToken();
    const locked = await skApi('POST', '/api/db/txdo/tables/tx_rule_rows', {
      title: 'parity-locked-delete', status: 'locked',
    });
    expect([200, 201].includes(locked.status)).toBe(true);
    const id = locked.data.id as string;
    cleanup.push({ path: '/api/db/txdo/tables/tx_rule_rows', id });

    const res = await userApi(token, 'DELETE', `/api/db/txdo/tables/tx_rule_rows/${id}`);
    expect(res.status).toBe(403);
    expect(res.data.message).toBe(
      `Access denied. The 'delete' access rule for table 'tx_rule_rows' rejected record '${id}'.`,
    );
  });
});
