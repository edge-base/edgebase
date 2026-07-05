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
        tx_docs: {
          schema: {
            title: { type: 'string', required: true },
            status: { type: 'string' },
          },
          access: { read: () => true, insert: () => true, update: () => true, delete: () => true },
        },
        tx_audit: {
          schema: {
            action: { type: 'string', required: true },
          },
          access: { read: () => true, insert: () => true },
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
      sidecar ? { namespace: 'shared', sidecarPort: 5999, sidecarSecret: 's' } : undefined),
    getProviderBindingName: () => 'DB_POSTGRES_SHARED',
  }));
  vi.doMock('../lib/postgres-schema-init.js', () => ({
    ensurePgSchema: vi.fn().mockResolvedValue(undefined),
  }));
  return calls;
}

async function callTransact(operations: unknown[], env = makeEnv()) {
  const { handlePgRequest } = await import('../lib/postgres-handler.js');
  const request = new Request('http://internal/api/db/shared/transact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Is-Service-Key': 'true' },
  });
  const ctx = buildInternalHandlerContext({ env, request, body: { operations } });
  return handlePgRequest(ctx, 'shared', '', '/transact');
}

describe('postgres transact', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('wraps cross-table ops in BEGIN/COMMIT and returns ordered results', async () => {
    const calls = mockExecutorModule((sql) => {
      if (sql.startsWith('INSERT INTO "tx_docs"')) {
        return { rows: [{ id: 'd1', title: 'Doc', status: 'draft' }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO "tx_audit"')) {
        return { rows: [{ id: 'a1', action: 'created' }], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE "tx_docs"')) {
        return { rows: [{ id: 'd1', title: 'Doc', status: 'done' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const response = await callTransact([
      { table: 'tx_docs', op: 'insert', data: { title: 'Doc', status: 'draft' } },
      { table: 'tx_audit', op: 'insert', data: { action: 'created' } },
      { table: 'tx_docs', op: 'update', id: 'd1', data: { status: 'done' } },
    ]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: Array<Record<string, unknown>> };
    expect(body.results).toHaveLength(3);
    expect((body.results[0].inserted as Record<string, unknown>).id).toBe('d1');
    expect((body.results[2].updated as Record<string, unknown>).status).toBe('done');

    const sqls = calls.map((call) => call.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    expect(sqls).not.toContain('ROLLBACK');
  });

  it('rolls back with 409 when an expect assertion is unmet', async () => {
    const calls = mockExecutorModule((sql) => {
      if (sql.startsWith('SELECT * FROM "tx_docs"')) {
        return { rows: [], rowCount: 0 }; // expectation probe finds nothing
      }
      if (sql.startsWith('INSERT INTO "tx_audit"')) {
        return { rows: [{ id: 'a1', action: 'created' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const response = await callTransact([
      { table: 'tx_audit', op: 'insert', data: { action: 'created' } },
      { table: 'tx_docs', op: 'expect', id: 'missing', where: [['status', '==', 'active']], exists: true },
    ]);
    expect(response.status).toBe(409);

    const sqls = calls.map((call) => call.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
  });

  it('rejects the local dev sidecar with 501', async () => {
    mockExecutorModule(() => ({ rows: [], rowCount: 0 }), { sidecar: true });
    const response = await callTransact([
      { table: 'tx_docs', op: 'insert', data: { title: 'Doc' } },
    ]);
    expect(response.status).toBe(501);
  });

  it('validates operations before opening a transaction', async () => {
    const calls = mockExecutorModule(() => ({ rows: [], rowCount: 0 }));
    const response = await callTransact([
      { table: 'no_such_table', op: 'insert', data: { title: 'x' } },
    ]);
    expect(response.status).toBe(400);
    expect(calls.map((call) => call.sql)).not.toContain('BEGIN');
  });
});
