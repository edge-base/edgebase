/**
 * batch-rules.test.ts
 *
 * Pins per-row access rule evaluation for /batch and /batch-by-filter on the
 * D1 provider path ('shared' namespace routes to D1) and the DO provider
 * path ('txdo' namespace pins provider: 'do'), plus the service-key bypass.
 *
 * Tables (edgebase.test.config.ts):
 *   - batch_rule_rows (shared) / tx_rule_rows (txdo): update/delete rules deny
 *     rows with status 'locked' but pass on an empty row — so any rule
 *     enforcement observed here is genuinely per-row. (Two table names because
 *     table names must be unique across DB blocks.)
 *   - secure_posts (shared): owner-only rules (auth?.id === row?.authorId).
 *   - denied_notes (shared): update/delete: false (boolean deny).
 *
 * Semantics under test (DO canonical, database-do.ts):
 *   - batch update/delete: any denied row → 403 and NOTHING is applied
 *   - batch-by-filter: table-level pre-check on an empty row, then per-row
 *     filtering of matched rows; 403 only if every matched row is blocked
 *   - service keys bypass rules entirely
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

async function skApi(method: string, path: string, body?: unknown) {
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

async function userApi(token: string, method: string, path: string, body?: unknown) {
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function getToken(): Promise<{ token: string; userId: string }> {
  const email = `batch-rules-${crypto.randomUUID().slice(0, 8)}@test.com`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'BatchRules1234!' }),
  });
  const data = await res.json() as any;
  return { token: data.accessToken, userId: data.user?.id };
}

let token: string;
let userId: string;

const cleanup: Record<string, string[]> = {
  '/api/db/shared/tables/batch_rule_rows': [],
  '/api/db/shared/tables/secure_posts': [],
  '/api/db/shared/tables/denied_notes': [],
  '/api/db/txdo/tables/tx_rule_rows': [],
};

function track(tablePath: string, id: string) {
  cleanup[tablePath].push(id);
}

beforeAll(async () => {
  const auth = await getToken();
  token = auth.token;
  userId = auth.userId;
  expect(typeof token).toBe('string');
});

afterAll(async () => {
  for (const [tablePath, ids] of Object.entries(cleanup)) {
    if (ids.length > 0) {
      await skApi('POST', `${tablePath}/batch`, { deletes: ids }).catch(() => {});
    }
  }
});

/** Seed one 'open' and one 'locked' row via service key; returns their ids. */
async function seedPair(ns: 'shared' | 'txdo', prefix: string) {
  const table = ns === 'txdo' ? 'tx_rule_rows' : 'batch_rule_rows';
  const tablePath = `/api/db/${ns}/tables/${table}`;
  const open = await skApi('POST', tablePath, { title: `${prefix}-open`, status: 'open' });
  const locked = await skApi('POST', tablePath, { title: `${prefix}-locked`, status: 'locked' });
  expect([200, 201].includes(open.status)).toBe(true);
  expect([200, 201].includes(locked.status)).toBe(true);
  track(tablePath, open.data.id);
  track(tablePath, locked.data.id);
  return { tablePath, openId: open.data.id as string, lockedId: locked.data.id as string };
}

// ═══════════════ D1 provider ('shared' namespace) ═══════════════

describe('batch rules — D1 batch updates (per-row)', () => {
  it('denies the whole batch when the update rule blocks one row, applying nothing', async () => {
    const prefix = `d1-up-${crypto.randomUUID().slice(0, 8)}`;
    const { tablePath, openId, lockedId } = await seedPair('shared', prefix);

    const { status } = await userApi(token, 'POST', `${tablePath}/batch`, {
      updates: [
        { id: openId, data: { title: `${prefix}-changed-open` } },
        { id: lockedId, data: { title: `${prefix}-changed-locked` } },
      ],
    });
    expect(status).toBe(403);

    // All-or-nothing: even the allowed row must be untouched.
    const openRow = await skApi('GET', `${tablePath}/${openId}`);
    const lockedRow = await skApi('GET', `${tablePath}/${lockedId}`);
    expect(openRow.data.title).toBe(`${prefix}-open`);
    expect(lockedRow.data.title).toBe(`${prefix}-locked`);
  });

  it('allows a batch update when every row passes the rule', async () => {
    const prefix = `d1-up-ok-${crypto.randomUUID().slice(0, 8)}`;
    const { tablePath, openId } = await seedPair('shared', prefix);

    const { status, data } = await userApi(token, 'POST', `${tablePath}/batch`, {
      updates: [{ id: openId, data: { title: `${prefix}-updated` } }],
    });
    expect(status).toBe(200);
    expect(data.updated).toHaveLength(1);
    const row = await skApi('GET', `${tablePath}/${openId}`);
    expect(row.data.title).toBe(`${prefix}-updated`);
  });

  it('enforces owner-only update rules per row (secure_posts)', async () => {
    const tablePath = '/api/db/shared/tables/secure_posts';
    const mine = await skApi('POST', tablePath, { title: 'mine', authorId: userId });
    const theirs = await skApi('POST', tablePath, { title: 'theirs', authorId: 'someone-else' });
    track(tablePath, mine.data.id);
    track(tablePath, theirs.data.id);

    const denied = await userApi(token, 'POST', `${tablePath}/batch`, {
      updates: [
        { id: mine.data.id, data: { title: 'mine-2' } },
        { id: theirs.data.id, data: { title: 'theirs-2' } },
      ],
    });
    expect(denied.status).toBe(403);

    const ownOnly = await userApi(token, 'POST', `${tablePath}/batch`, {
      updates: [{ id: mine.data.id, data: { title: 'mine-2' } }],
    });
    expect(ownOnly.status).toBe(200);
  });
});

describe('batch rules — D1 batch deletes (per-row)', () => {
  it('denies deletion of a locked row and leaves it in place', async () => {
    const prefix = `d1-del-${crypto.randomUUID().slice(0, 8)}`;
    const { tablePath, openId, lockedId } = await seedPair('shared', prefix);

    const { status } = await userApi(token, 'POST', `${tablePath}/batch`, {
      deletes: [openId, lockedId],
    });
    expect(status).toBe(403);

    // All-or-nothing: neither row was deleted.
    expect((await skApi('GET', `${tablePath}/${openId}`)).status).toBe(200);
    expect((await skApi('GET', `${tablePath}/${lockedId}`)).status).toBe(200);
  });

  it('allows deleting rows the rule permits', async () => {
    const prefix = `d1-del-ok-${crypto.randomUUID().slice(0, 8)}`;
    const { tablePath, openId } = await seedPair('shared', prefix);

    const { status } = await userApi(token, 'POST', `${tablePath}/batch`, {
      deletes: [openId],
    });
    expect(status).toBe(200);
    expect((await skApi('GET', `${tablePath}/${openId}`)).status).toBe(404);
  });

  it('rolls back inserts when a delete in the same batch is denied', async () => {
    const prefix = `d1-mixed-${crypto.randomUUID().slice(0, 8)}`;
    const { tablePath, lockedId } = await seedPair('shared', prefix);
    const countBefore = (await skApi('GET', `${tablePath}/count`)).data.total;

    const { status } = await userApi(token, 'POST', `${tablePath}/batch`, {
      inserts: [{ title: `${prefix}-should-roll-back` }],
      deletes: [lockedId],
    });
    expect(status).toBe(403);

    const countAfter = (await skApi('GET', `${tablePath}/count`)).data.total;
    expect(countAfter).toBe(countBefore);
  });
});

describe('batch rules — D1 batch-by-filter', () => {
  it('filters matched rows per-row: locked rows survive, open rows update', async () => {
    const prefix = `d1-bbf-${crypto.randomUUID().slice(0, 8)}`;
    const tablePath = '/api/db/shared/tables/batch_rule_rows';
    // Two rows sharing a title so one filter matches both.
    const open = await skApi('POST', tablePath, { title: prefix, status: 'open' });
    const locked = await skApi('POST', tablePath, { title: prefix, status: 'locked' });
    track(tablePath, open.data.id);
    track(tablePath, locked.data.id);

    const { status, data } = await userApi(token, 'POST', `${tablePath}/batch-by-filter`, {
      action: 'update',
      filter: [['title', '==', prefix]],
      update: { title: `${prefix}-renamed` },
    });
    expect(status).toBe(200);
    expect(data.processed).toBe(2);
    expect(data.succeeded).toBe(1);

    expect((await skApi('GET', `${tablePath}/${open.data.id}`)).data.title).toBe(`${prefix}-renamed`);
    expect((await skApi('GET', `${tablePath}/${locked.data.id}`)).data.title).toBe(prefix);
  });

  it('returns 403 when every matched row is blocked by the rule', async () => {
    const prefix = `d1-bbf-all-${crypto.randomUUID().slice(0, 8)}`;
    const { tablePath, lockedId } = await seedPair('shared', prefix);

    const { status } = await userApi(token, 'POST', `${tablePath}/batch-by-filter`, {
      action: 'delete',
      filter: [['title', '==', `${prefix}-locked`]],
    });
    expect(status).toBe(403);
    expect((await skApi('GET', `${tablePath}/${lockedId}`)).status).toBe(200);
  });

  it('rejects non-service-key requests via the boolean table-level pre-check (denied_notes)', async () => {
    const tablePath = '/api/db/shared/tables/denied_notes';
    const note = await skApi('POST', tablePath, { title: 'bbf-denied' });
    track(tablePath, note.data.id);

    const update = await userApi(token, 'POST', `${tablePath}/batch-by-filter`, {
      action: 'update',
      filter: [['title', '==', 'bbf-denied']],
      update: { content: 'nope' },
    });
    expect(update.status).toBe(403);

    const del = await userApi(token, 'POST', `${tablePath}/batch-by-filter`, {
      action: 'delete',
      filter: [['title', '==', 'bbf-denied']],
    });
    expect(del.status).toBe(403);
    expect((await skApi('GET', `${tablePath}/${note.data.id}`)).status).toBe(200);
  });
});

describe('batch rules — D1 service-key bypass', () => {
  it('service key updates and deletes locked rows via /batch', async () => {
    const prefix = `d1-sk-${crypto.randomUUID().slice(0, 8)}`;
    const { tablePath, lockedId } = await seedPair('shared', prefix);

    const update = await skApi('POST', `${tablePath}/batch`, {
      updates: [{ id: lockedId, data: { title: `${prefix}-sk-updated` } }],
    });
    expect(update.status).toBe(200);
    expect((await skApi('GET', `${tablePath}/${lockedId}`)).data.title).toBe(`${prefix}-sk-updated`);

    const del = await skApi('POST', `${tablePath}/batch`, { deletes: [lockedId] });
    expect(del.status).toBe(200);
    expect((await skApi('GET', `${tablePath}/${lockedId}`)).status).toBe(404);
  });

  it('service key bypasses batch-by-filter rules on locked rows', async () => {
    const prefix = `d1-sk-bbf-${crypto.randomUUID().slice(0, 8)}`;
    const { tablePath, lockedId } = await seedPair('shared', prefix);

    const { status, data } = await skApi('POST', `${tablePath}/batch-by-filter`, {
      action: 'update',
      filter: [['title', '==', `${prefix}-locked`]],
      update: { title: `${prefix}-sk-bbf` },
    });
    expect(status).toBe(200);
    expect(data.succeeded).toBe(1);
    expect((await skApi('GET', `${tablePath}/${lockedId}`)).data.title).toBe(`${prefix}-sk-bbf`);
  });
});

// ═══════════════ DO provider ('txdo' namespace, provider: 'do') ═══════════════

describe('batch rules — DO provider parity (txdo)', () => {
  it('batch update with a locked row → 403 and nothing applied', async () => {
    const prefix = `do-up-${crypto.randomUUID().slice(0, 8)}`;
    const { tablePath, openId, lockedId } = await seedPair('txdo', prefix);

    const { status } = await userApi(token, 'POST', `${tablePath}/batch`, {
      updates: [
        { id: openId, data: { title: `${prefix}-changed-open` } },
        { id: lockedId, data: { title: `${prefix}-changed-locked` } },
      ],
    });
    expect(status).toBe(403);
    expect((await skApi('GET', `${tablePath}/${openId}`)).data.title).toBe(`${prefix}-open`);
    expect((await skApi('GET', `${tablePath}/${lockedId}`)).data.title).toBe(`${prefix}-locked`);
  });

  it('batch delete with a locked row → 403 and rows remain', async () => {
    const prefix = `do-del-${crypto.randomUUID().slice(0, 8)}`;
    const { tablePath, openId, lockedId } = await seedPair('txdo', prefix);

    const { status } = await userApi(token, 'POST', `${tablePath}/batch`, {
      deletes: [openId, lockedId],
    });
    expect(status).toBe(403);
    expect((await skApi('GET', `${tablePath}/${openId}`)).status).toBe(200);
    expect((await skApi('GET', `${tablePath}/${lockedId}`)).status).toBe(200);
  });

  it('rolls back inserts when a delete in the same batch is denied', async () => {
    const prefix = `do-mixed-${crypto.randomUUID().slice(0, 8)}`;
    const { tablePath, lockedId } = await seedPair('txdo', prefix);
    const countBefore = (await skApi('GET', `${tablePath}/count`)).data.total;

    const { status } = await userApi(token, 'POST', `${tablePath}/batch`, {
      inserts: [{ title: `${prefix}-should-roll-back` }],
      deletes: [lockedId],
    });
    expect(status).toBe(403);
    expect((await skApi('GET', `${tablePath}/count`)).data.total).toBe(countBefore);
  });

  it('batch-by-filter filters locked rows per-row', async () => {
    const prefix = `do-bbf-${crypto.randomUUID().slice(0, 8)}`;
    const tablePath = '/api/db/txdo/tables/tx_rule_rows';
    const open = await skApi('POST', tablePath, { title: prefix, status: 'open' });
    const locked = await skApi('POST', tablePath, { title: prefix, status: 'locked' });
    track(tablePath, open.data.id);
    track(tablePath, locked.data.id);

    const { status, data } = await userApi(token, 'POST', `${tablePath}/batch-by-filter`, {
      action: 'update',
      filter: [['title', '==', prefix]],
      update: { title: `${prefix}-renamed` },
    });
    expect(status).toBe(200);
    expect(data.processed).toBe(2);
    expect(data.succeeded).toBe(1);
    expect((await skApi('GET', `${tablePath}/${locked.data.id}`)).data.title).toBe(prefix);
  });

  it('service key bypasses batch rules on the DO path', async () => {
    const prefix = `do-sk-${crypto.randomUUID().slice(0, 8)}`;
    const { tablePath, lockedId } = await seedPair('txdo', prefix);

    const update = await skApi('POST', `${tablePath}/batch`, {
      updates: [{ id: lockedId, data: { title: `${prefix}-sk-updated` } }],
    });
    expect(update.status).toBe(200);

    const del = await skApi('POST', `${tablePath}/batch`, { deletes: [lockedId] });
    expect(del.status).toBe(200);
    expect((await skApi('GET', `${tablePath}/${lockedId}`)).status).toBe(404);
  });
});
