/**
 * provider-parity.test.ts — Phase 3 provider alignment coverage.
 *
 * Pins two behaviors that were promoted/unified across providers so all three
 * (Durable Objects, D1, PostgreSQL) share one contract:
 *
 *   1. `?includeTotal=0` (or `false`) on LIST skips the COUNT query and returns
 *      `total: null`, while `hasMore`/`cursor` still drive pagination. Verified
 *      on the D1 path ('shared' namespace) and the DO path ('txdo' namespace).
 *      (PostgreSQL already had this; it is unit-only with a mocked executor.)
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

// ─── 1. includeTotal — skip COUNT, total:null (D1 + DO parity) ────────────────

describe('provider parity — includeTotal skips the COUNT query', () => {
  it('D1 (shared/posts): includeTotal=0 → total null, default → number', async () => {
    const seeded = await skApi('POST', '/api/db/shared/tables/posts', { title: 'parity-d1-total' });
    expect([200, 201].includes(seeded.status)).toBe(true);
    cleanup.push({ path: '/api/db/shared/tables/posts', id: seeded.data.id });

    const withTotal = await skApi('GET', '/api/db/shared/tables/posts?limit=5');
    expect(withTotal.status).toBe(200);
    expect(typeof withTotal.data.total).toBe('number');

    const skip0 = await skApi('GET', '/api/db/shared/tables/posts?limit=5&includeTotal=0');
    expect(skip0.status).toBe(200);
    expect(skip0.data.total).toBeNull();
    expect(Array.isArray(skip0.data.items)).toBe(true);
    // hasMore/cursor still drive pagination when the count is skipped.
    expect('hasMore' in skip0.data).toBe(true);

    const skipFalse = await skApi('GET', '/api/db/shared/tables/posts?limit=5&includeTotal=false');
    expect(skipFalse.data.total).toBeNull();
  });

  it('DO (txdo/tx_posts): includeTotal=0 → total null, default → number', async () => {
    const seeded = await skApi('POST', '/api/db/txdo/tables/tx_posts', { title: 'parity-do-total' });
    expect([200, 201].includes(seeded.status)).toBe(true);
    cleanup.push({ path: '/api/db/txdo/tables/tx_posts', id: seeded.data.id });

    const withTotal = await skApi('GET', '/api/db/txdo/tables/tx_posts?limit=5');
    expect(withTotal.status).toBe(200);
    expect(typeof withTotal.data.total).toBe('number');

    const skip0 = await skApi('GET', '/api/db/txdo/tables/tx_posts?limit=5&includeTotal=0');
    expect(skip0.status).toBe(200);
    expect(skip0.data.total).toBeNull();
    expect(Array.isArray(skip0.data.items)).toBe(true);
    expect('hasMore' in skip0.data).toBe(true);

    const skipFalse = await skApi('GET', '/api/db/txdo/tables/tx_posts?limit=5&includeTotal=false');
    expect(skipFalse.data.total).toBeNull();
  });
});

// ─── 2. DO rule-rejection wording matches D1's canonical format ───────────────

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
