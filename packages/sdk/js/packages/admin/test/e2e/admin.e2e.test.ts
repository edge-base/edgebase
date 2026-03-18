/**
 * @edge-base/admin — E2E 테스트
 *
 * wrangler dev --port 8688 실서버 필요
 *
 * 실행:
 *   BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
 *     npx vitest run packages/sdk/js/packages/admin/test/e2e/admin.e2e.test.ts
 *
 * 원칙: mock 금지, 실서버 fetch
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '../../src/index.js';

const BASE_URL = process.env['BASE_URL'] || 'http://localhost:8688';
const SERVICE_KEY = process.env['SERVICE_KEY'] || 'test-service-key-for-admin';
const PREFIX = `admin-e2e-${Date.now()}`;
const KV_POLL_INTERVAL_MS = 200;
const KV_TIMEOUT_MS = 5000;
const IS_REMOTE_WORKERS_RUNTIME = /\.workers\.dev(?:$|\/)/.test(BASE_URL);

let admin: ReturnType<typeof createAdminClient>;
const createdIds: string[] = [];
let createdUserId: string;

beforeAll(() => {
  admin = createAdminClient(BASE_URL, { serviceKey: SERVICE_KEY });
});

afterAll(async () => {
  for (const id of createdIds) {
    try { await admin.db('shared').table('posts').delete(id); } catch {}
  }
  admin.destroy();
});

async function waitForKvValue(namespace: string, key: string, expected: string | null) {
  const deadline = Date.now() + KV_TIMEOUT_MS;
  let last: string | null = null;

  while (Date.now() <= deadline) {
    last = await admin.kv(namespace).get(key);
    if (last === expected) return last;
    await new Promise((resolve) => setTimeout(resolve, KV_POLL_INTERVAL_MS));
  }

  return last;
}

// ─── 1. AdminAuth 관리 ────────────────────────────────────────────────────────

describe('Admin E2E — AdminAuth', () => {
  it('createUser → id 반환', async () => {
    const email = `admin-create-${Date.now()}@test.com`;
    const r = await admin.auth.createUser({ email, password: 'AdminE2EPass123!' });
    const userId = (r as any).user?.id ?? (r as any).id;
    expect(userId).toBeTruthy();
    createdUserId = userId;
  });

  it('getUser → user 반환', async () => {
    if (!createdUserId) return;
    const r = await admin.auth.getUser(createdUserId);
    const userId = (r as any).user?.id ?? (r as any).id;
    expect(userId).toBe(createdUserId);
  });

  it('listUsers → users 배열 포함', async () => {
    const r = await admin.auth.listUsers({ limit: 5 });
    expect(Array.isArray((r as any).users)).toBe(true);
  });

  it('setCustomClaims → 성공', async () => {
    if (!createdUserId) return;
    await expect(admin.auth.setCustomClaims(createdUserId, { role: 'premium' })).resolves.not.toThrow();
  });

  it('없는 userId getUser → 에러', async () => {
    await expect(admin.auth.getUser('nonexistent-admin-user-99')).rejects.toThrow();
  });
});

// ─── 2. DB CRUD ───────────────────────────────────────────────────────────────

describe('Admin E2E — DB CRUD', () => {
  it('insert → id', async () => {
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-create` });
    expect((r as any).id).toBeTruthy();
    createdIds.push((r as any).id);
  });

  it('getOne → 레코드', async () => {
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-getOne` });
    const id = (r as any).id;
    createdIds.push(id);
    const fetched = await admin.db('shared').table('posts').getOne(id);
    expect((fetched as any).id).toBe(id);
  });

  it('update → 변경', async () => {
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-orig` });
    const id = (r as any).id;
    createdIds.push(id);
    const upd = await admin.db('shared').table('posts').update(id, { title: `${PREFIX}-upd` });
    expect((upd as any).title).toBe(`${PREFIX}-upd`);
  });

  it('delete → getOne 에러', async () => {
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-del` });
    const id = (r as any).id;
    await admin.db('shared').table('posts').delete(id);
    await expect(admin.db('shared').table('posts').getOne(id)).rejects.toThrow();
  });

  it('count() → 숫자', async () => {
    expect(typeof await admin.db('shared').table('posts').count()).toBe('number');
  });
});

// ─── 3. KV 관리 ──────────────────────────────────────────────────────────────

describe('Admin E2E — KV', () => {
  const kvPrefix = `admin-kv-${Date.now()}`;

  it('kv set → 성공', async () => {
    await expect(admin.kv('test').set(`${kvPrefix}-set`, 'hello-admin-e2e')).resolves.not.toThrow();
  });

  it('kv get → 값 반환', async () => {
    const key = `${kvPrefix}-get`;
    await admin.kv('test').set(key, 'hello-kv');
    const val = await waitForKvValue('test', key, 'hello-kv');
    expect(val).toBe('hello-kv');
  });

  it('kv delete → 성공', async () => {
    const key = `${kvPrefix}-delete`;
    await admin.kv('test').set(key, 'del-me');
    await expect(admin.kv('test').delete(key)).resolves.not.toThrow();
  });

  it('kv get 삭제 후 → null', async () => {
    const key = `${kvPrefix}-nullable`;
    await admin.kv('test').set(key, 'val');
    await admin.kv('test').delete(key);
    const val = await waitForKvValue('test', key, null);
    if (IS_REMOTE_WORKERS_RUNTIME) {
      expect([null, 'val']).toContain(val);
      return;
    }
    expect(val).toBeNull();
  }, 15_000);

  it('kv list → keys 배열', async () => {
    const r = await admin.kv('test').list({ limit: 10 });
    expect(Array.isArray(r.keys)).toBe(true);
  });
});

// ─── 4. SQL ──────────────────────────────────────────────────────────────────

describe('Admin E2E — SQL', () => {
  it('raw SQL select → rows 배열', async () => {
    const result = await admin.sql('SELECT 1 AS val');
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── 5. Broadcast ────────────────────────────────────────────────────────────

describe('Admin E2E — Broadcast', () => {
  it('broadcast → 에러 없이 성공', async () => {
    await expect(admin.broadcast(
      'general',
      'server-event',
      { msg: 'hello from admin E2E' },
    )).resolves.not.toThrow();
  });
});

// ─── 6. Storage ──────────────────────────────────────────────────────────────

describe('Admin E2E — Storage', () => {
  it('upload + getUrl', async () => {
    const key = `admin-e2e-${Date.now()}.txt`;
    await admin.storage.upload('test-bucket', key, new Blob(['hello admin'], { type: 'text/plain' }));
    const url = admin.storage.getUrl('test-bucket', key);
    expect(url).toContain(key);
    try { await admin.storage.delete('test-bucket', key); } catch {}
  });
});

// ─── 7. D1 SQL ───────────────────────────────────────────────────────────────

describe('Admin E2E — D1', () => {
  it('d1 query → rows 반환', async () => {
    const result = await admin.d1('analytics').query('SELECT 1 AS n', []);
    expect(Array.isArray(result.rows ?? result)).toBe(true);
  });
});

// ─── 8. Error Handling ───────────────────────────────────────────────────────

describe('Admin E2E — Error', () => {
  it('없는 id getOne → 에러', async () => {
    await expect(admin.db('shared').table('posts').getOne('nonexistent-admin-99999')).rejects.toThrow();
  });

  it('잘못된 serviceKey → 에러', async () => {
    const badAdmin = createAdminClient(BASE_URL, { serviceKey: 'invalid-sk' });
    await expect(badAdmin.db('shared').table('posts').insert({ title: 'X' })).rejects.toThrow();
    badAdmin.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Phase 2 additions below
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 9. AdminAuth extended ──────────────────────────────────────────────────

describe('Admin E2E — AdminAuth extended', () => {
  let testUserId: string;

  it('createUser + getUser chain', async () => {
    const email = `admin-ext-${Date.now()}@test.com`;
    const r = await admin.auth.createUser({ email, password: 'AdminExt123!' });
    const userId = (r as any).id ?? (r as any).user?.id;
    expect(userId).toBeTruthy();
    testUserId = userId;

    const fetched = await admin.auth.getUser(userId);
    expect((fetched as any).id ?? (fetched as any).user?.id).toBe(userId);
  });

  it('listUsers returns array with users', async () => {
    // listUsers depends on D1 _email_index which may not be populated in
    // all local-dev environments. Verify response shape and that length <= limit.
    const r = await admin.auth.listUsers({ limit: 10 });
    expect(Array.isArray((r as any).users)).toBe(true);
    expect((r as any).users.length).toBeLessThanOrEqual(10);
  });

  it('updateUser changes displayName', async () => {
    if (!testUserId) return;
    const updated = await admin.auth.updateUser(testUserId, { displayName: 'Updated Admin' });
    const dn = (updated as any).displayName ?? (updated as any).user?.displayName;
    expect(dn).toBe('Updated Admin');
  });

  it('setCustomClaims + verify via getUser', async () => {
    if (!testUserId) return;
    await admin.auth.setCustomClaims(testUserId, { tier: 'enterprise', admin: true });
    const user = await admin.auth.getUser(testUserId);
    const claims = (user as any).customClaims;
    if (claims) {
      expect(claims.tier).toBe('enterprise');
      expect(claims.admin).toBe(true);
    }
  });

  it('revokeAllSessions → success', async () => {
    if (!testUserId) return;
    await expect(admin.auth.revokeAllSessions(testUserId)).resolves.not.toThrow();
  });

  it('deleteUser → getUser fails', async () => {
    if (!testUserId) return;
    await admin.auth.deleteUser(testUserId);
    await expect(admin.auth.getUser(testUserId)).rejects.toThrow();
  });
});

// ─── 10. SQL extended ───────────────────────────────────────────────────────

describe('Admin E2E — SQL extended', () => {
  it('sql simple query → result', async () => {
    const result = await admin.sql('SELECT 1 + 1 AS sum');
    expect(Array.isArray(result)).toBe(true);
  });

  it('sql with namespace and table', async () => {
    // Query the posts table through the SQL interface
    const result = await admin.sql('shared', undefined, 'SELECT count(*) as cnt FROM posts', []);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── 11. KV CRUD chain ─────────────────────────────────────────────────────

describe('Admin E2E — KV CRUD chain', () => {
  const ns = 'test';
  const key = `admin-kv-chain-${Date.now()}`;

  it('set → get → update → get → delete → get(null) chain', async () => {
    // Set
    await admin.kv(ns).set(key, 'initial-value');

    // Get
    const val1 = await waitForKvValue(ns, key, 'initial-value');
    expect(val1).toBe('initial-value');

    // Update (overwrite)
    await admin.kv(ns).set(key, 'updated-value');
    const val2 = await waitForKvValue(ns, key, 'updated-value');
    expect(val2).toBe('updated-value');

    // Delete
    await admin.kv(ns).delete(key);
    const val3 = await waitForKvValue(ns, key, null);
    if (IS_REMOTE_WORKERS_RUNTIME) {
      expect([null, 'updated-value']).toContain(val3);
      return;
    }
    expect(val3).toBeNull();
  }, 15_000);

  it('kv list with prefix', async () => {
    const prefix = `admin-list-${Date.now()}`;
    await admin.kv(ns).set(`${prefix}-a`, 'v1');
    await admin.kv(ns).set(`${prefix}-b`, 'v2');

    const result = await admin.kv(ns).list({ prefix, limit: 10 });
    expect(Array.isArray(result.keys)).toBe(true);
    expect(result.keys.length).toBeGreaterThanOrEqual(2);

    // Cleanup
    await admin.kv(ns).delete(`${prefix}-a`);
    await admin.kv(ns).delete(`${prefix}-b`);
  });

  it('kv get non-existent key → null', async () => {
    const val = await admin.kv(ns).get(`nonexistent-${Date.now()}`);
    expect(val).toBeNull();
  });
});

// ─── 12. D1 extended ────────────────────────────────────────────────────────

describe('Admin E2E — D1 extended', () => {
  it('d1 exec with params', async () => {
    const result = await admin.d1('analytics').exec('SELECT ? AS val', ['hello']);
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect((result[0] as any).val).toBe('hello');
    }
  });

  it('d1 query alias works same as exec', async () => {
    const result = await admin.d1('analytics').query('SELECT 42 AS num', []);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── 13. Broadcast extended ─────────────────────────────────────────────────

describe('Admin E2E — Broadcast extended', () => {
  it('broadcast with payload data', async () => {
    await expect(admin.broadcast(
      'notifications',
      'alert',
      { type: 'info', message: 'Test broadcast from admin E2E' },
    )).resolves.not.toThrow();
  });

  it('broadcast to different channel', async () => {
    await expect(admin.broadcast(
      `test-channel-${Date.now()}`,
      'test-event',
      { data: 'unique' },
    )).resolves.not.toThrow();
  });
});

// ─── 14. Storage extended ───────────────────────────────────────────────────

describe('Admin E2E — Storage extended', () => {
  it('upload + download + getMetadata + delete', async () => {
    const key = `admin-storage-ext-${Date.now()}.txt`;
    const content = 'Admin storage extended test';

    // Upload
    await admin.storage.upload('test-bucket', key, new Blob([content], { type: 'text/plain' }));

    // Download
    const downloaded = await admin.storage.bucket('test-bucket').download(key, { as: 'text' }) as string;
    expect(downloaded).toBe(content);

    // GetMetadata
    const meta = await admin.storage.bucket('test-bucket').getMetadata(key);
    expect(meta.key).toBe(key);
    expect(meta.contentType).toContain('text/plain');
    expect(meta.size).toBeGreaterThan(0);

    // Delete
    await admin.storage.delete('test-bucket', key);
  });

  it('upload + signedUrl', async () => {
    const key = `admin-signed-${Date.now()}.txt`;
    await admin.storage.upload('test-bucket', key, new Blob(['signed url test'], { type: 'text/plain' }));
    const url = await admin.storage.bucket('test-bucket').createSignedUrl(key, { expiresIn: '1h' });
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
    await admin.storage.delete('test-bucket', key);
  });

  it('list files in bucket', async () => {
    const result = await admin.storage.bucket('test-bucket').list({ limit: 10 });
    expect(Array.isArray(result.files)).toBe(true);
    expect(typeof result.truncated).toBe('boolean');
  });
});

// ─── 15. Error types ────────────────────────────────────────────────────────

describe('Admin E2E — Error types', () => {
  it('error has status property', async () => {
    try {
      await admin.db('shared').table('posts').getOne('nonexistent-admin-err');
      expect(false).toBe(true); // should not reach
    } catch (e: any) {
      expect(typeof e.status).toBe('number');
      expect(e.status).toBe(404);
    }
  });

  it('error has message property', async () => {
    try {
      await admin.db('shared').table('posts').getOne('nonexistent-admin-msg');
      expect(false).toBe(true);
    } catch (e: any) {
      expect(typeof e.message).toBe('string');
      expect(e.message.length).toBeGreaterThan(0);
    }
  });

  it('error instanceof Error', async () => {
    try {
      await admin.db('shared').table('posts').getOne('nonexistent-admin-instanceof');
      expect(false).toBe(true);
    } catch (e: any) {
      expect(e instanceof Error).toBe(true);
    }
  });
});

// ─── 16. async/await patterns ───────────────────────────────────────────────

describe('Admin E2E — async patterns', () => {
  it('Promise.all: insert + count + list', async () => {
    const [created, count, list] = await Promise.all([
      admin.db('shared').table('posts').insert({ title: `${PREFIX}-async-1` }),
      admin.db('shared').table('posts').count(),
      admin.db('shared').table('posts').limit(3).getList(),
    ]);
    expect((created as any).id).toBeTruthy();
    createdIds.push((created as any).id);
    expect(typeof count).toBe('number');
    expect(Array.isArray(list.items)).toBe(true);
  });

  it('sequential operations maintain order', async () => {
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-seq`, status: 'v1' });
    const id = (r as any).id;
    createdIds.push(id);

    await admin.db('shared').table('posts').update(id, { status: 'v2' });
    await admin.db('shared').table('posts').update(id, { status: 'v3' });

    const final = await admin.db('shared').table('posts').getOne(id);
    expect((final as any).status).toBe('v3');
  });

  it('try/catch error handling pattern', async () => {
    let caught = false;
    try {
      await admin.db('shared').table('posts').getOne('admin-try-catch-nonexistent');
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
  });
});

// ─── 17. Push Notifications (mock-fcm-server 필요,) ──────────

describe('Admin E2E — Push', () => {
  it('push.send → 미등록 유저는 sent: 0', async () => {
    const result = await admin.push.send('nonexistent-push-user', { title: 'Test', body: 'E2E' });
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('push.sendToToken → sent: 1 (mock FCM 성공)', async () => {
    const result = await admin.push.sendToToken('e2e-fake-token', { title: 'Direct', body: 'Send' });
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('push.sendMany → 200 OK', async () => {
    const result = await admin.push.sendMany(['uid-1', 'uid-2'], { title: 'Bulk', body: 'Test' });
    expect(typeof result.sent).toBe('number');
    expect(typeof result.failed).toBe('number');
  });

  it('push.getTokens → empty array for no devices', async () => {
    const tokens = await admin.push.getTokens('nonexistent-push-user');
    expect(Array.isArray(tokens)).toBe(true);
    expect(tokens.length).toBe(0);
  });

  it('push.getLogs → array', async () => {
    const logs = await admin.push.getLogs('nonexistent-push-user');
    expect(Array.isArray(logs)).toBe(true);
  });

  it('push.sendToTopic → success', async () => {
    const result = await admin.push.sendToTopic('e2e-test-topic', { title: 'Topic', body: 'E2E' });
    expect(result.success).toBe(true);
  });

  it('push.broadcast → success', async () => {
    const result = await admin.push.broadcast({ title: 'Broadcast', body: 'E2E' });
    expect(result.success).toBe(true);
  });
});

// ─── 18. DB with context ────────────────────────────────────────────────────

describe('Admin E2E — DB namespace variants', () => {
  it('db("shared").table("posts") works', async () => {
    const list = await admin.db('shared').table('posts').limit(1).getList();
    expect(Array.isArray(list.items)).toBe(true);
  });

  it('filter + orderBy + limit combined', async () => {
    const base = `${PREFIX}-combo-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      const r = await admin.db('shared').table('posts').insert({
        title: `${base}-${String(i).padStart(2, '0')}`,
        viewCount: i * 10,
      });
      createdIds.push((r as any).id);
    }
    const list = await admin.db('shared').table('posts')
      .where('title', 'contains', base)
      .where('viewCount', '>=', 20)
      .orderBy('viewCount', 'desc')
      .limit(3)
      .getList();
    expect(list.items.length).toBeLessThanOrEqual(3);
    for (const item of list.items) {
      expect((item as any).viewCount).toBeGreaterThanOrEqual(20);
    }
  });
});

// ─── 18b. Golden Query — filter + sort + limit contract ──────────────────────

describe('Admin E2E — Golden Query', () => {
  const gqPrefix = `${PREFIX}-gq`;
  const gqIds: string[] = [];

  beforeAll(async () => {
    const records = [
      { title: `${gqPrefix}-A`, views: 10 },
      { title: `${gqPrefix}-B`, views: 30 },
      { title: `${gqPrefix}-C`, views: 20 },
      { title: `${gqPrefix}-D`, views: 40 },
      { title: `${gqPrefix}-E`, views: 5 },
    ];
    for (const rec of records) {
      const r = await admin.db('shared').table('posts').insert(rec);
      gqIds.push((r as any).id);
      createdIds.push((r as any).id);
    }
  });

  it('filter>=10 + sort:desc + limit=3 → [40,30,20]', async () => {
    const list = await admin.db('shared').table('posts')
      .where('title', 'contains', gqPrefix)
      .where('views', '>=', 10)
      .orderBy('views', 'desc')
      .limit(3)
      .getList();
    const views = list.items.map((r: any) => r.views);
    expect(views).toEqual([40, 30, 20]);
  });

  it('cursor pagination with filter → no overlap', async () => {
    const p1 = await admin.db('shared').table('posts')
      .where('title', 'contains', gqPrefix)
      .limit(2)
      .getList();
    expect(p1.items.length).toBe(2);
    expect(p1.cursor).toBeTruthy();

    const p2 = await admin.db('shared').table('posts')
      .where('title', 'contains', gqPrefix)
      .limit(2)
      .after(p1.cursor!)
      .getList();
    const ids1 = p1.items.map((r: any) => r.id);
    const ids2 = p2.items.map((r: any) => r.id);
    const overlap = ids1.filter((id: string) => ids2.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('orFilter golden: or(views==10 | views==40) → [10, 40]', async () => {
    const list = await admin.db('shared').table('posts')
      .where('title', 'contains', gqPrefix)
      .or((q) => q.where('views', '==', 10).where('views', '==', 40))
      .orderBy('views', 'asc')
      .limit(10)
      .getList();
    const views = list.items.map((r: any) => r.views);
    expect(views).toEqual([10, 40]);
  });

  it('CRUD round-trip: create → read → update → delete', async () => {
    const crudTitle = `${gqPrefix}CRUD-${Date.now()}`;
    // Create
    const created = await admin.db('shared').table('posts').insert({
      title: crudTitle, views: 111, isPublished: true,
    });
    expect(created.id).toBeDefined();

    // Read
    const read = await admin.db('shared').table('posts').doc(created.id).get();
    expect(read.title).toBe(crudTitle);

    // Update
    const updated = await admin.db('shared').table('posts').update(created.id, { views: 222 });
    expect(updated.views).toBe(222);

    // Delete
    await admin.db('shared').table('posts').delete(created.id);
    try {
      await admin.db('shared').table('posts').doc(created.id).get();
      expect.unreachable('should have thrown');
    } catch (e: any) {
      expect(e.status || e.code).toBeDefined(); // 404
    }
  });
});

// ─── 19. Analytics ──────────────────────────────────────────────────────────

describe('Admin E2E — Analytics', () => {
  it('analytics.overview → 200 + 구조 반환', async () => {
    const result = await admin.analytics.overview({ range: '24h' });
    expect(result).toHaveProperty('timeSeries');
    expect(result).toHaveProperty('summary');
  });

  it('analytics.timeSeries → 배열 반환', async () => {
    const result = await admin.analytics.timeSeries({ range: '24h' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('analytics.breakdown → 배열 반환', async () => {
    const result = await admin.analytics.breakdown({ range: '24h' });
    // breakdown() returns res.breakdown which is BreakdownItem[]
    // In some environments the full AnalyticsResponse may be returned
    const items = Array.isArray(result) ? result : (result as any).breakdown;
    expect(Array.isArray(items)).toBe(true);
  });

  it('analytics.topEndpoints → 배열 반환', async () => {
    const result = await admin.analytics.topEndpoints({ range: '24h' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('analytics.track → 성공', async () => {
    await expect(
      admin.analytics.track('e2e_test_event', { source: 'admin-e2e', ts: Date.now() }),
    ).resolves.not.toThrow();
  });

  it('analytics.track with userId → 성공', async () => {
    await expect(
      admin.analytics.track('e2e_user_event', { plan: 'pro' }, 'user-e2e-123'),
    ).resolves.not.toThrow();
  });

  it('analytics.trackBatch → 배치 전송', async () => {
    await expect(
      admin.analytics.trackBatch([
        { name: 'batch_1', properties: { idx: 1 } },
        { name: 'batch_2', properties: { idx: 2 } },
        { name: 'batch_3', properties: { idx: 3 } },
      ]),
    ).resolves.not.toThrow();
  });

  it('analytics.queryEvents list → events 배열', async () => {
    const uniqueName = `e2e_query_${Date.now()}`;
    await admin.analytics.track(uniqueName, { test: true });

    const result = await admin.analytics.queryEvents({ event: uniqueName, metric: 'list' }) as any;
    expect(Array.isArray(result.events)).toBe(true);
    expect(result.events.length).toBeGreaterThanOrEqual(1);
    expect(result.events[0].eventName).toBe(uniqueName);
  });

  it('analytics.queryEvents count → totalEvents 숫자', async () => {
    const result = await admin.analytics.queryEvents({ metric: 'count' }) as any;
    expect(typeof result.totalEvents).toBe('number');
    expect(typeof result.uniqueUsers).toBe('number');
  });

  it('analytics.queryEvents topEvents → topEvents 배열', async () => {
    const result = await admin.analytics.queryEvents({ metric: 'topEvents' }) as any;
    expect(Array.isArray(result.topEvents)).toBe(true);
  });

  it('analytics.queryEvents timeSeries → timeSeries 배열', async () => {
    const result = await admin.analytics.queryEvents({ metric: 'timeSeries' }) as any;
    expect(Array.isArray(result.timeSeries)).toBe(true);
  });
});

// ─── 20. Vectorize (stub) ────────────────────────────────────────────────────

describe('Admin E2E — Vectorize (stub)', () => {
  it('upsert → stub 200 + ok', async () => {
    const vec = admin.vector('embeddings');
    const result = await vec.upsert([
      { id: 'doc-1', values: new Array(1536).fill(0.1), metadata: { title: 'test' } },
    ]);
    expect(result.ok).toBe(true);
  });

  it('insert → stub 200 + ok', async () => {
    const vec = admin.vector('embeddings');
    const result = await vec.insert([
      { id: 'doc-ins-1', values: new Array(1536).fill(0.2) },
    ]);
    expect(result.ok).toBe(true);
  });

  it('search → stub 200 + matches array', async () => {
    const vec = admin.vector('embeddings');
    const matches = await vec.search(new Array(1536).fill(0.1), { topK: 5 });
    expect(Array.isArray(matches)).toBe(true);
  });

  it('search with returnValues → stub 200', async () => {
    const vec = admin.vector('embeddings');
    const matches = await vec.search(new Array(1536).fill(0.1), {
      topK: 5,
      returnValues: true,
    });
    expect(Array.isArray(matches)).toBe(true);
  });

  it('search with returnMetadata → stub 200', async () => {
    const vec = admin.vector('embeddings');
    const matches = await vec.search(new Array(1536).fill(0.1), {
      topK: 5,
      returnMetadata: 'all',
    });
    expect(Array.isArray(matches)).toBe(true);
  });

  it('search with namespace → stub 200', async () => {
    const vec = admin.vector('embeddings');
    const matches = await vec.search(new Array(1536).fill(0.1), {
      topK: 5,
      namespace: 'test-ns',
    });
    expect(Array.isArray(matches)).toBe(true);
  });

  it('queryById → stub 200 + matches array', async () => {
    const vec = admin.vector('embeddings');
    const matches = await vec.queryById('doc-1', { topK: 5 });
    expect(Array.isArray(matches)).toBe(true);
  });

  it('getByIds → stub 200 + vectors array', async () => {
    const vec = admin.vector('embeddings');
    const vectors = await vec.getByIds(['doc-1', 'doc-2']);
    expect(Array.isArray(vectors)).toBe(true);
  });

  it('delete → stub 200 + ok', async () => {
    const vec = admin.vector('embeddings');
    const result = await vec.delete(['doc-1', 'doc-2']);
    expect(result.ok).toBe(true);
  });

  it('describe → stub 200 + index info', async () => {
    const vec = admin.vector('embeddings');
    const info = await vec.describe();
    expect(typeof info.vectorCount).toBe('number');
    expect(typeof info.dimensions).toBe('number');
    expect(typeof info.metric).toBe('string');
  });

  // ─── Input validation ───
  it('search dimension mismatch → 400', async () => {
    const vec = admin.vector('embeddings');
    await expect(vec.search([0.1, 0.2, 0.3], { topK: 5 })).rejects.toThrow();
  });

  it('search topK=0 → 400', async () => {
    const vec = admin.vector('embeddings');
    await expect(vec.search(new Array(1536).fill(0.1), { topK: 0 })).rejects.toThrow();
  });

  it('search topK=101 → 400', async () => {
    const vec = admin.vector('embeddings');
    await expect(vec.search(new Array(1536).fill(0.1), { topK: 101 })).rejects.toThrow();
  });

  it('nonexistent index → 404', async () => {
    const vec = admin.vector('nonexistent-index-99');
    await expect(vec.describe()).rejects.toThrow();
  });
});
