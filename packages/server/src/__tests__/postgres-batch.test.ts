/**
 * PostgreSQL batch semantics (D1/DO parity alignment):
 * - all-or-nothing: BEGIN/COMMIT around every batch, ROLLBACK on failure
 * - tri-key { inserts, updates, deletes } support with per-row rules
 * - zero-op {} → {} with 200 (no transaction opened)
 * - batch-by-filter per-row function-rule filtering
 *
 * Uses a mocked executor (same pattern as postgres-transact.test.ts).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { defineConfig } from '@edge-base/shared';
import { buildInternalHandlerContext } from '../lib/internal-request.js';
import type { Env } from '../types.js';

const CONFIG = defineConfig({
  release: true,
  databases: {
    shared: {
      provider: 'postgres',
      connectionString: 'DB_POSTGRES_SHARED_URL',
      tables: {
        batch_docs: {
          schema: {
            title: { type: 'string', required: true },
            status: { type: 'string' },
          },
          access: {
            read: () => true,
            insert: () => true,
            // Row-dependent rules: pass on an empty row, deny 'locked' rows.
            update: (_auth, row) => row?.status !== 'locked',
            delete: (_auth, row) => row?.status !== 'locked',
          },
        },
      },
    },
  },
});

function makeEnv(): Env {
  return {
    EDGEBASE_CONFIG: CONFIG,
    DB_POSTGRES_SHARED_URL: 'postgres://edgebase:test@localhost/shared',
  } as unknown as Env;
}

function mockExecutorModule(
  handler: (sql: string, params: unknown[]) => { rows: Record<string, unknown>[]; rowCount: number },
  { sidecar = false } = {},
) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  vi.doMock('../lib/postgres-executor.js', () => ({
    executePostgresQuery: vi.fn(),
    ensureLocalDevPostgresSchema: vi.fn().mockResolvedValue(undefined),
    withPostgresConnection: vi.fn(async (_cs: string, fn: (q: unknown) => Promise<unknown>) =>
      fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return handler(sql, params);
      })),
    getLocalDevPostgresExecOptions: vi.fn(() =>
      sidecar ? { namespace: 'shared', sidecarPort: '5999', sidecarSecret: 's' } : undefined),
    getProviderBindingName: () => 'DB_POSTGRES_SHARED',
  }));
  vi.doMock('../lib/postgres-schema-init.js', () => ({
    ensurePgSchema: vi.fn().mockResolvedValue(undefined),
  }));
  return calls;
}

/**
 * Non-service-key handler context (buildInternalHandlerContext always marks
 * requests as trusted internal, which bypasses rules).
 */
function makeNonServiceKeyCtx(options: { env: Env; url: string; body?: unknown }) {
  const url = new URL(options.url);
  const request = new Request(options.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return {
    env: options.env,
    executionCtx: { waitUntil() {} },
    req: {
      raw: request,
      url: request.url,
      header: (name: string) => request.headers.get(name) ?? undefined,
      json: async () => options.body ?? {},
      query: (name?: string) =>
        name
          ? url.searchParams.get(name) ?? undefined
          : Object.fromEntries(url.searchParams.entries()),
    },
    get(key: string) {
      if (key === 'auth') return null;
      if (key === 'isServiceKey') return false;
      if (key === 'isInternalRequest') return false;
      return undefined;
    },
    json(payload: unknown, status = 200) {
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
}

async function callBatch(
  body: unknown,
  { serviceKey = true, env = makeEnv(), path = '/tables/batch_docs/batch' } = {},
) {
  const { handlePgRequest } = await import('../lib/postgres-handler.js');
  const url = `http://internal/api/db/shared${path}`;
  const ctx = serviceKey
    ? buildInternalHandlerContext({
        env,
        request: new Request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Is-Service-Key': 'true' },
        }),
        body: body as Record<string, unknown>,
      })
    : makeNonServiceKeyCtx({ env, url, body });
  return handlePgRequest(ctx as never, 'shared', 'batch_docs', path);
}

describe('postgres batch', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('wraps batch inserts in BEGIN/COMMIT on one session', async () => {
    let n = 0;
    const calls = mockExecutorModule((sql) => {
      if (sql.startsWith('INSERT INTO "batch_docs"')) {
        n += 1;
        return { rows: [{ id: `doc-${n}`, title: `Doc ${n}`, status: 'open' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const response = await callBatch({
      inserts: [{ title: 'Doc 1' }, { title: 'Doc 2' }],
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.inserted).toHaveLength(2);
    expect(json.items).toHaveLength(2); // deprecated echo kept for legacy clients
    expect(json.updated).toBeUndefined();
    expect(json.deleted).toBeUndefined();

    const sqls = calls.map((call) => call.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    expect(sqls.filter((sql) => sql.startsWith('INSERT INTO'))).toHaveLength(2);
    expect(sqls).not.toContain('ROLLBACK');
  });

  it('rolls back the whole batch when a statement fails mid-batch', async () => {
    let n = 0;
    const calls = mockExecutorModule((sql) => {
      if (sql.startsWith('INSERT INTO "batch_docs"')) {
        n += 1;
        if (n === 2) throw new Error('duplicate key value violates unique constraint');
        return { rows: [{ id: `doc-${n}`, title: `Doc ${n}` }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(
      callBatch({ inserts: [{ title: 'Doc 1' }, { title: 'Doc 2' }] }),
    ).rejects.toThrow('duplicate key');

    const sqls = calls.map((call) => call.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
  });

  it('supports tri-key { inserts, updates, deletes } inside one transaction with rules', async () => {
    const rowsById: Record<string, Record<string, unknown>> = {
      'u1': { id: 'u1', title: 'Old', status: 'open' },
      'd1': { id: 'd1', title: 'Bye', status: 'open' },
    };
    const calls = mockExecutorModule((sql, params) => {
      if (sql.startsWith('INSERT INTO "batch_docs"')) {
        return { rows: [{ id: 'n1', title: 'New', status: 'open' }], rowCount: 1 };
      }
      if (sql.startsWith('SELECT * FROM "batch_docs"')) {
        const row = rowsById[String(params[0])];
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.startsWith('UPDATE "batch_docs"')) {
        return { rows: [{ id: 'u1', title: 'Updated', status: 'open' }], rowCount: 1 };
      }
      if (sql.startsWith('DELETE FROM "batch_docs"')) {
        return { rows: [{ id: 'd1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const response = await callBatch(
      {
        inserts: [{ title: 'New' }],
        updates: [{ id: 'u1', data: { title: 'Updated' } }],
        deletes: ['d1'],
      },
      { serviceKey: false }, // rules active: rows are 'open', so all allowed
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>;
    expect((json.inserted as unknown[])).toHaveLength(1);
    expect((json.updated as Array<Record<string, unknown>>)[0].title).toBe('Updated');
    expect(json.deleted).toBe(1);

    const sqls = calls.map((call) => call.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
  });

  it('denies per-row via the delete rule and rolls back everything (403)', async () => {
    const calls = mockExecutorModule((sql, params) => {
      if (sql.startsWith('INSERT INTO "batch_docs"')) {
        return { rows: [{ id: 'n1', title: 'New' }], rowCount: 1 };
      }
      if (sql.startsWith('SELECT * FROM "batch_docs"')) {
        return { rows: [{ id: String(params[0]), title: 'Locked', status: 'locked' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const response = await callBatch(
      { inserts: [{ title: 'New' }], deletes: ['locked-1'] },
      { serviceKey: false },
    );
    expect(response.status).toBe(403);

    const sqls = calls.map((call) => call.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(sqls.some((sql) => sql.startsWith('DELETE FROM'))).toBe(false);
  });

  it('denies per-row via the update rule (403) but service key bypasses', async () => {
    const handler = (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT * FROM "batch_docs"')) {
        return { rows: [{ id: String(params[0]), title: 'Locked', status: 'locked' }], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE "batch_docs"')) {
        return { rows: [{ id: 'locked-1', title: 'Changed', status: 'locked' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };

    mockExecutorModule(handler);
    const denied = await callBatch(
      { updates: [{ id: 'locked-1', data: { title: 'Changed' } }] },
      { serviceKey: false },
    );
    expect(denied.status).toBe(403);

    vi.resetModules();
    mockExecutorModule(handler);
    const bypassed = await callBatch(
      { updates: [{ id: 'locked-1', data: { title: 'Changed' } }] },
      { serviceKey: true },
    );
    expect(bypassed.status).toBe(200);
    const json = (await bypassed.json()) as { updated: Array<Record<string, unknown>> };
    expect(json.updated[0].title).toBe('Changed');
  });

  it('returns {} with 200 for a zero-op batch without opening a transaction', async () => {
    const calls = mockExecutorModule(() => ({ rows: [], rowCount: 0 }));
    const response = await callBatch({});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(calls.map((call) => call.sql)).not.toContain('BEGIN');
  });

  it('echoes empty keyed results for empty arrays (200)', async () => {
    mockExecutorModule(() => ({ rows: [], rowCount: 0 }));
    const response = await callBatch({ inserts: [], updates: [], deletes: [] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ inserted: [], items: [], updated: [], deleted: 0 });
  });

  it('rejects the local dev sidecar with 501 (all-or-nothing cannot be honored)', async () => {
    mockExecutorModule(() => ({ rows: [], rowCount: 0 }), { sidecar: true });
    const response = await callBatch({ inserts: [{ title: 'Doc' }] });
    expect(response.status).toBe(501);
  });

  it('batch-by-filter filters matched rows per-row through function rules', async () => {
    const calls = mockExecutorModule((sql) => {
      if (sql.startsWith('SELECT "batch_docs".*')) {
        return {
          rows: [
            { id: 'r1', title: 'A', status: 'open' },
            { id: 'r2', title: 'B', status: 'locked' },
          ],
          rowCount: 2,
        };
      }
      if (sql.startsWith('UPDATE "batch_docs"')) {
        return { rows: [{ id: 'r1', title: 'A', status: 'done' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const response = await callBatch(
      {
        action: 'update',
        filter: [['title', '!=', '']],
        update: { status: 'done' },
      },
      { serviceKey: false, path: '/tables/batch_docs/batch-by-filter' },
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { processed: number; succeeded: number };
    expect(json.processed).toBe(2); // both matched the filter
    expect(json.succeeded).toBe(1); // only the unlocked row was updated

    const updateCall = calls.find((call) => call.sql.startsWith('UPDATE "batch_docs"'))!;
    expect(updateCall.params).toContain('r1');
    expect(updateCall.params).not.toContain('r2');
  });

  it('batch-by-filter returns 403 when the rule blocks every matched row', async () => {
    const calls = mockExecutorModule((sql) => {
      if (sql.startsWith('SELECT "batch_docs".*')) {
        return { rows: [{ id: 'r2', title: 'B', status: 'locked' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const response = await callBatch(
      { action: 'delete', filter: [['status', '==', 'locked']] },
      { serviceKey: false, path: '/tables/batch_docs/batch-by-filter' },
    );
    expect(response.status).toBe(403);
    expect(calls.some((call) => call.sql.startsWith('DELETE FROM'))).toBe(false);
  });
});
