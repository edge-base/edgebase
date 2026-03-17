/**
 * 서버 단위 테스트 — Backup Restore endpoints (skipWipe)
 * backup-restore.test.ts
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/backup-restore.test.ts
 *
 * 테스트 대상:
 *   A. restore-d1: skipWipe=false (wipe + insert), skipWipe=true (insert only)
 *   B. restore-data: skipWipe=false (wipe + insert), skipWipe=true (insert only), D1 path
 *   C. cleanup-plugin: namespaced plugin table cleanup
 *   D. Edge cases: empty tables, missing namespace
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { backupRoute } from '../routes/backup.js';
import { setConfig } from '../lib/do-router.js';
import { resetSchemaInit } from '../lib/auth-d1.js';
import { resetControlSchemaInit } from '../lib/control-db.js';
import { _resetD1SchemaCache } from '../lib/d1-schema-init.js';
import { OpenAPIHono, type HonoEnv } from '../lib/hono.js';

// ─── Mock D1 Database ─────────────────────────────────────────────────────────

interface BatchCall {
  stmts: Array<{ sql: string; params?: unknown[] }>;
}

interface DirectCall {
  sql: string;
  params?: unknown[];
}

function createMockD1(options?: {
  allResults?: Array<{ match: RegExp | string; results: unknown[] }>;
}): D1Database & {
  _batchCalls: BatchCall[];
  _directCalls: DirectCall[];
  _allSql: () => string[];
  _directSql: () => string[];
} {
  const batchCalls: BatchCall[] = [];
  const directCalls: DirectCall[] = [];

  function getAllResults(sql: string): unknown[] {
    for (const entry of options?.allResults ?? []) {
      if (
        (typeof entry.match === 'string' && sql.includes(entry.match)) ||
        (entry.match instanceof RegExp && entry.match.test(sql))
      ) {
        return entry.results;
      }
    }
    return [];
  }

  function makeStmt(sql: string, bindings: unknown[] = []): any {
    const stmtData = { sql, params: bindings };

    const stmt: any = {
      _sql: sql,
      _params: bindings,
      bind: (...values: unknown[]) => {
        stmtData.params = values;
        return makeStmt(sql, values);
      },
      first: async () => {
        directCalls.push({ sql: stmtData.sql, params: stmtData.params });
        return null;
      },
      all: async () => {
        directCalls.push({ sql: stmtData.sql, params: stmtData.params });
        return { results: getAllResults(stmtData.sql) };
      },
      run: async () => {
        directCalls.push({ sql: stmtData.sql, params: stmtData.params });
        return { success: true };
      },
    };
    // Store a reference so batch can read it
    stmt.__stmtData = stmtData;
    return stmt;
  }

  const db: any = {
    prepare: (sql: string) => makeStmt(sql),
    batch: async (stmts: any[]) => {
      const call: BatchCall = {
        stmts: stmts.map((s: any) => {
          // Handle both formats: D1PreparedStatement and {sql, params}
          if (s.__stmtData) return s.__stmtData;
          if (s.sql) return { sql: s.sql, params: s.params };
          if (s._sql) return { sql: s._sql, params: s._params };
          return { sql: String(s) };
        }),
      };
      batchCalls.push(call);
      return stmts.map(() => ({ success: true }));
    },
    exec: async () => ({ count: 0, duration: 0 }),
    _batchCalls: batchCalls,
    _directCalls: directCalls,
    _allSql: () => batchCalls.flatMap((c) => c.stmts.map((s) => s.sql)),
    _directSql: () => directCalls.map((call) => call.sql),
  };

  Object.defineProperty(db, '_batchCalls', { get: () => batchCalls });
  Object.defineProperty(db, '_directCalls', { get: () => directCalls });
  return db;
}

// ─── Test App Factory ────────────────────────────────────────────────────────

function createTestApp(
  authDb: D1Database,
  dataDb?: D1Database,
  runtimeConfig?: Record<string, unknown>,
  controlDb?: D1Database,
) {
  const baseConfig = {
    serviceKeys: {
      keys: [
        {
          kid: 'root',
          tier: 'root',
          scopes: ['*'],
          secretSource: 'dashboard',
          secretRef: 'SERVICE_KEY',
        },
      ],
    },
    databases: {
      shared: {
        provider: 'd1',
        tables: {
          posts: { schema: { title: { type: 'string' }, content: { type: 'text' } } },
          categories: { schema: { name: { type: 'string' } } },
        },
      },
    },
  } satisfies Record<string, unknown>;

  setConfig({
    ...baseConfig,
    ...(runtimeConfig ?? {}),
  } as any);

  // Create a wrapper Hono app with the backup route
  // Skip service key middleware by wrapping the route
  const app = new OpenAPIHono<HonoEnv>();

  // Mount backup route under /admin/api/backup
  // We need to bypass the service key middleware, so we'll create our own app
  // that sets up env correctly
  app.route('/admin/api/backup', backupRoute);

  // The env needs AUTH_DB and DB_D1_SHARED bindings, plus SERVICE_KEY
  const env: Record<string, unknown> = {
    AUTH_DB: authDb,
    CONTROL_DB: controlDb ?? authDb,
    DB_D1_SHARED: dataDb ?? authDb,
    SERVICE_KEY: 'test-service-key',
  };

  return { app, env };
}

async function postRestore(
  app: {
    request: (
      path: string,
      init?: RequestInit,
      env?: Record<string, unknown>,
    ) => Response | Promise<Response>;
  },
  env: Record<string, unknown>,
  path: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const resp = await app.request(
    `/admin/api/backup${path}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': 'test-service-key',
      },
      body: JSON.stringify(body),
    },
    env,
  );

  let json: any;
  try {
    json = await resp.json();
  } catch {
    json = {};
  }
  return { status: resp.status, json };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('A. restore-d1 — skipWipe behavior', () => {
  let authDb: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    authDb = createMockD1();
    resetSchemaInit();
    resetControlSchemaInit();
    _resetD1SchemaCache();
  });

  afterEach(() => {
    setConfig({});
  });

  it('skipWipe=false (default) — wipes all auth tables then inserts', async () => {
    const { app, env } = createTestApp(authDb);
    const { status, json } = await postRestore(app, env, '/restore-d1', {
      tables: { _users: [{ id: 'u1', email: 'a@b.com' }] },
    });

    expect(status).toBe(200);
    expect(json.ok).toBe(true);

    const allSql = authDb._allSql();

    // Should contain DELETE statements (wipe)
    const deleteStmts = allSql.filter((s) => s.startsWith('DELETE FROM'));
    expect(deleteStmts.length).toBeGreaterThan(0);
    expect(deleteStmts.some((s) => s.includes('_users'))).toBe(true);
    expect(deleteStmts.some((s) => s.includes('_sessions'))).toBe(true);

    // Should contain INSERT statement for _users
    const insertStmts = allSql.filter((s) => s.includes('INSERT OR REPLACE'));
    expect(insertStmts.length).toBe(1);
    expect(insertStmts[0]).toContain('_users');
  });

  it('skipWipe=true — no DELETE, inserts only', async () => {
    const { app, env } = createTestApp(authDb);
    const { status, json } = await postRestore(app, env, '/restore-d1', {
      tables: { _users: [{ id: 'u1', email: 'a@b.com' }] },
      skipWipe: true,
    });

    expect(status).toBe(200);
    expect(json.ok).toBe(true);

    const allSql = authDb._allSql();

    // Should NOT contain any DELETE statements
    const deleteStmts = allSql.filter((s) => s.startsWith('DELETE FROM'));
    expect(deleteStmts.length).toBe(0);

    // Should contain INSERT statement
    const insertStmts = allSql.filter((s) => s.includes('INSERT OR REPLACE'));
    expect(insertStmts.length).toBe(1);
    expect(insertStmts[0]).toContain('_users');
  });

  it('skipWipe=false with empty tables — wipes only, no inserts', async () => {
    const { app, env } = createTestApp(authDb);
    const { status, json } = await postRestore(app, env, '/restore-d1', {
      tables: {},
      skipWipe: false,
    });

    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.restored).toBe(0);

    const allSql = authDb._allSql();

    // Should have DELETE statements (wipe step executed)
    const deleteStmts = allSql.filter((s) => s.startsWith('DELETE FROM'));
    expect(deleteStmts.length).toBeGreaterThan(0);

    // Should NOT have any INSERT statements (no data to restore)
    const insertStmts = allSql.filter((s) => s.includes('INSERT'));
    expect(insertStmts.length).toBe(0);
  });

  it('skipWipe=true with empty tables — no operations', async () => {
    const { app, env } = createTestApp(authDb);
    const { status, json } = await postRestore(app, env, '/restore-d1', {
      tables: {},
      skipWipe: true,
    });

    expect(status).toBe(200);
    expect(json.restored).toBe(0);

    const allSql = authDb._allSql();
    // No deletes, no inserts — just schema init
    const deleteStmts = allSql.filter((s) => s.startsWith('DELETE FROM'));
    const insertStmts = allSql.filter((s) => s.includes('INSERT OR REPLACE INTO "_'));
    expect(deleteStmts.length).toBe(0);
    expect(insertStmts.length).toBe(0);
  });

  it('multiple per-table restores with skipWipe=true accumulate data', async () => {
    const { app, env } = createTestApp(authDb);

    // Simulate: wipe first, then restore per-table
    await postRestore(app, env, '/restore-d1', { tables: {}, skipWipe: false });
    const wipeSql = authDb._allSql();
    const wipeDeletes = wipeSql.filter((s) => s.startsWith('DELETE FROM'));
    expect(wipeDeletes.length).toBeGreaterThan(0);

    // Now restore table 1
    const r1 = await postRestore(app, env, '/restore-d1', {
      tables: { _users: [{ id: 'u1', email: 'a@b.com' }] },
      skipWipe: true,
    });
    expect(r1.json.ok).toBe(true);
    expect(r1.json.restored).toBe(1);

    // Restore table 2
    const r2 = await postRestore(app, env, '/restore-d1', {
      tables: { _sessions: [{ id: 's1', userId: 'u1', token: 'abc' }] },
      skipWipe: true,
    });
    expect(r2.json.ok).toBe(true);
    expect(r2.json.restored).toBe(1);

    // Each per-table call should NOT contain any deletes
    // Total batch calls: schema init + wipe + 2x insert
    const allSql = authDb._allSql();
    // Count inserts after the wipe batch call
    const insertAfterWipe = allSql.filter((s) => s.includes('INSERT OR REPLACE'));
    expect(insertAfterWipe.length).toBe(2); // _users + _sessions
  });
});

// ─── B. restore-data — skipWipe behavior (D1 path) ───

describe('B. restore-data — skipWipe behavior (D1 path)', () => {
  let dataDb: ReturnType<typeof createMockD1>;
  let authDb: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    dataDb = createMockD1();
    authDb = createMockD1();
    resetSchemaInit();
    resetControlSchemaInit();
    _resetD1SchemaCache();
  });

  afterEach(() => {
    setConfig({});
  });

  it('skipWipe=false — wipes data tables then inserts', async () => {
    const { app, env } = createTestApp(authDb, dataDb);
    const { status, json } = await postRestore(app, env, '/restore-data', {
      namespace: 'shared',
      tables: { posts: [{ id: 'p1', title: 'Hello' }] },
    });

    expect(status).toBe(200);
    expect(json.ok).toBe(true);

    const allSql = dataDb._allSql();

    // Should have DELETE for user tables + _meta
    const deleteStmts = allSql.filter((s) => s.startsWith('DELETE FROM'));
    expect(deleteStmts.length).toBeGreaterThan(0);
    expect(deleteStmts.some((s) => s.includes('posts'))).toBe(true);

    // Should have INSERT for posts
    const insertStmts = allSql.filter((s) => s.includes('INSERT OR REPLACE'));
    expect(insertStmts.length).toBe(1);
    expect(insertStmts[0]).toContain('posts');
  });

  it('skipWipe=true — inserts only, no DELETE', async () => {
    const { app, env } = createTestApp(authDb, dataDb);
    const { status, json } = await postRestore(app, env, '/restore-data', {
      namespace: 'shared',
      tables: { posts: [{ id: 'p1', title: 'Hello' }] },
      skipWipe: true,
    });

    expect(status).toBe(200);
    expect(json.ok).toBe(true);

    const allSql = dataDb._allSql();

    // No deletes
    const deleteStmts = allSql.filter((s) => s.startsWith('DELETE FROM'));
    expect(deleteStmts.length).toBe(0);

    // Has inserts
    const insertStmts = allSql.filter((s) => s.includes('INSERT OR REPLACE'));
    expect(insertStmts.length).toBe(1);
  });

  it('wipe-only call (empty tables, skipWipe=false)', async () => {
    const { app, env } = createTestApp(authDb, dataDb);
    const { status, json } = await postRestore(app, env, '/restore-data', {
      namespace: 'shared',
      tables: {},
      skipWipe: false,
    });

    expect(status).toBe(200);
    expect(json.restored).toBe(0);

    const allSql = dataDb._allSql();
    const deleteStmts = allSql.filter((s) => s.startsWith('DELETE FROM'));
    expect(deleteStmts.length).toBeGreaterThan(0);

    const insertStmts = allSql.filter((s) => s.includes('INSERT'));
    expect(insertStmts.length).toBe(0);
  });

  it('unknown namespace returns 404', async () => {
    const { app, env } = createTestApp(authDb, dataDb);
    const { status, json } = await postRestore(app, env, '/restore-data', {
      namespace: 'nonexistent',
      tables: {},
    });

    expect(status).toBe(404);
    expect(json.message).toContain('nonexistent');
  });

  it('per-table restore flow: wipe then restore each table separately', async () => {
    const { app, env } = createTestApp(authDb, dataDb);

    // Step 1: Wipe
    const wipeResult = await postRestore(app, env, '/restore-data', {
      namespace: 'shared',
      tables: {},
      skipWipe: false,
    });
    expect(wipeResult.status).toBe(200);

    // Step 2: Restore posts
    const r1 = await postRestore(app, env, '/restore-data', {
      namespace: 'shared',
      tables: {
        posts: [
          { id: 'p1', title: 'A' },
          { id: 'p2', title: 'B' },
        ],
      },
      skipWipe: true,
    });
    expect(r1.json.ok).toBe(true);
    expect(r1.json.restored).toBe(1);

    // Step 3: Restore _meta
    const r2 = await postRestore(app, env, '/restore-data', {
      namespace: 'shared',
      tables: { _meta: [{ key: 'k1', value: 'v1' }] },
      skipWipe: true,
    });
    expect(r2.json.ok).toBe(true);
    expect(r2.json.restored).toBe(1);

    const allSql = dataDb._allSql();
    const inserts = allSql.filter((s) => s.includes('INSERT OR REPLACE'));
    // 2 posts + 1 _meta = 3 inserts total
    expect(inserts.length).toBe(3);
  });
});

// ─── C. cleanup-plugin ───

describe('C. cleanup-plugin', () => {
  beforeEach(() => {
    resetSchemaInit();
    resetControlSchemaInit();
    _resetD1SchemaCache();
  });

  afterEach(() => {
    setConfig({});
  });

  it('restores control-plane metadata in CONTROL_DB', async () => {
    const authDb = createMockD1();
    const controlDb = createMockD1();
    const { app, env } = createTestApp(authDb, undefined, undefined, controlDb);

    const { status, json } = await postRestore(app, env, '/restore-control-d1', {
      tables: {
        _meta: [{ key: 'plugin_version:plugin-a', value: '1.2.0' }],
      },
    });

    expect(status).toBe(200);
    expect(json.ok).toBe(true);

    const allSql = controlDb._allSql();
    expect(allSql.some((sql) => sql === 'DELETE FROM "_meta"')).toBe(true);
    expect(allSql.some((sql) => sql.includes('INSERT OR REPLACE INTO "_meta"'))).toBe(true);
  });

  it('removes only plugin-prefixed D1 tables and metadata', async () => {
    const authDb = createMockD1();
    const controlDb = createMockD1();
    const dataDb = createMockD1({
      allResults: [
        {
          match: /sqlite_master/,
          results: [
            { name: 'posts' },
            { name: 'plugin-a/events' },
            { name: 'plugin-a/events_fts' },
            { name: 'plugin-a/events_fts_data' },
            { name: 'plugin-a/logs' },
          ],
        },
      ],
    });

    const { app, env } = createTestApp(
      authDb,
      dataDb,
      {
        databases: {
          shared: {
            provider: 'd1',
            tables: {
              posts: { schema: { title: { type: 'string' } } },
            },
          },
        },
      },
      controlDb,
    );

    const { status, json } = await postRestore(app, env, '/cleanup-plugin', {
      prefix: 'plugin-a',
      namespace: 'shared',
    });

    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.removed).toEqual({
      tables: ['plugin-a/events', 'plugin-a/logs'],
      metaKeys: [
        'schemaHash:plugin-a/events',
        'migration_version:plugin-a/events',
        'schemaHash:plugin-a/logs',
        'migration_version:plugin-a/logs',
        'plugin_version:plugin-a',
      ],
    });

    const directSql = dataDb._directSql();
    expect(directSql).toContain('DROP TABLE IF EXISTS "plugin-a/events_fts"');
    expect(directSql).toContain('DROP TABLE IF EXISTS "plugin-a/events"');
    expect(directSql).toContain('DROP TABLE IF EXISTS "plugin-a/logs_fts"');
    expect(directSql).toContain('DROP TABLE IF EXISTS "plugin-a/logs"');
    expect(directSql).not.toContain('DROP TABLE IF EXISTS "plugin-a/events_fts_fts"');
    expect(directSql).not.toContain('DROP TABLE IF EXISTS "posts_fts"');

    const metaDeletes = dataDb._directCalls
      .filter((call) => call.sql === 'DELETE FROM "_meta" WHERE "key" = ?')
      .map((call) => call.params?.[0]);
    expect(metaDeletes).toEqual([
      'schemaHash:plugin-a/events',
      'migration_version:plugin-a/events',
      'schemaHash:plugin-a/logs',
      'migration_version:plugin-a/logs',
    ]);

    const controlDeletes = controlDb._directCalls
      .filter((call) => call.sql === 'DELETE FROM _meta WHERE key = ?')
      .map((call) => call.params?.[0]);
    expect(controlDeletes).toContain('plugin_version:plugin-a');
  });
});

// ─── D. Edge cases ───

describe('D. restore edge cases', () => {
  beforeEach(() => {
    resetSchemaInit();
    resetControlSchemaInit();
    _resetD1SchemaCache();
  });

  afterEach(() => {
    setConfig({});
  });

  it('restore-d1 without tables field returns 400', async () => {
    const authDb = createMockD1();
    const { app, env } = createTestApp(authDb);
    const { status } = await postRestore(app, env, '/restore-d1', {} as any);

    expect(status).toBe(400);
  });

  it('restore-data without namespace returns 400', async () => {
    const authDb = createMockD1();
    const { app, env } = createTestApp(authDb);
    const { status } = await postRestore(app, env, '/restore-data', {
      tables: {},
    } as any);

    expect(status).toBe(400);
  });

  it('service key missing returns 403', async () => {
    const authDb = createMockD1();
    const { app, env } = createTestApp(authDb);

    const resp = await app.request(
      '/admin/api/backup/restore-d1',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables: {} }),
      },
      env,
    );

    expect(resp.status).toBe(403);
  });

  it('invalid service key returns 401', async () => {
    const authDb = createMockD1();
    const { app, env } = createTestApp(authDb);

    const resp = await app.request(
      '/admin/api/backup/restore-d1',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EdgeBase-Service-Key': 'wrong-key',
        },
        body: JSON.stringify({ tables: {} }),
      },
      env,
    );

    expect(resp.status).toBe(401);
  });
});

describe('E. export routes', () => {
  beforeEach(() => {
    resetSchemaInit();
    resetControlSchemaInit();
    _resetD1SchemaCache();
  });

  afterEach(() => {
    setConfig({});
  });

  it('backup export reads shared D1 tables instead of assuming Durable Objects', async () => {
    const authDb = createMockD1();
    const dataDb = createMockD1({
      allResults: [
        {
          match: 'SELECT * FROM "posts"',
          results: [{ id: 'post_1', title: 'Hello export' }],
        },
        {
          match: 'SELECT * FROM "_meta"',
          results: [],
        },
      ],
    });
    const { app, env } = createTestApp(authDb, dataDb);

    const resp = await app.request(
      '/admin/api/backup/export/posts?format=json',
      {
        method: 'GET',
        headers: {
          'X-EdgeBase-Service-Key': 'test-service-key',
        },
      },
      env,
    );

    expect(resp.status).toBe(200);
    await expect(resp.json()).resolves.toEqual([{ id: 'post_1', title: 'Hello export' }]);
    expect(dataDb._directSql()).toContain('SELECT * FROM "posts"');
  });

  it('list-dos accepts an empty JSON body for config-scan backups', async () => {
    const authDb = createMockD1();
    const { app, env } = createTestApp(authDb);

    const resp = await app.request(
      '/admin/api/backup/list-dos',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EdgeBase-Service-Key': 'test-service-key',
        },
        body: '{}',
      },
      env,
    );

    expect(resp.status).toBe(200);
    await expect(resp.json()).resolves.toMatchObject({ dos: expect.any(Array), total: expect.any(Number) });
  });
});
