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

interface MockQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function postgresError(code: string) {
  return Object.assign(new Error(`PostgreSQL error ${code}`), { code });
}

function mockExecutorModule(
  handler: (
    sql: string,
    params: unknown[],
    connectionId: number,
  ) => MockQueryResult | Promise<MockQueryResult>,
  { sidecar = false } = {},
) {
  const calls: Array<{ sql: string; params: unknown[]; connectionId: number }> = [];
  let connectionCount = 0;
  vi.doMock('../lib/postgres-executor.js', () => ({
    executePostgresQuery: vi.fn(),
    ensureLocalDevPostgresSchema: vi.fn().mockResolvedValue(undefined),
    withPostgresConnection: vi.fn(async (_cs: string, fn: (q: unknown) => Promise<unknown>) => {
      const connectionId = connectionCount + 1;
      connectionCount = connectionId;
      return fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params, connectionId });
        return handler(sql, params, connectionId);
      });
    }),
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
    expect(sqls[0]).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE');
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
    expect(sqls[0]).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE');
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(sqls.filter((sql) => sql === 'BEGIN ISOLATION LEVEL SERIALIZABLE')).toHaveLength(1);
    expect(sqls.find((sql) => sql.startsWith('SELECT * FROM "tx_docs"')))
      .toContain('LIMIT 1 FOR UPDATE');
  });

  it.each([
    { sqlState: '40001', failStatement: 'COMMIT' },
    { sqlState: '40P01', failStatement: 'UPDATE' },
  ])(
    'replays the whole ordered transaction after retryable SQLSTATE $sqlState',
    async ({ sqlState, failStatement }) => {
      let injectedFailure = false;
      const calls = mockExecutorModule((sql) => {
        if (sql.startsWith('SELECT * FROM "tx_docs"')) {
          return { rows: [{ id: 'anchor', title: 'Anchor', status: 'active' }], rowCount: 1 };
        }
        if (sql.startsWith('UPDATE "tx_docs"')) {
          if (!injectedFailure && failStatement === 'UPDATE') {
            injectedFailure = true;
            throw postgresError(sqlState);
          }
          return { rows: [{ id: 'd1', title: 'Doc', status: 'done' }], rowCount: 1 };
        }
        if (sql === 'COMMIT' && !injectedFailure && failStatement === 'COMMIT') {
          injectedFailure = true;
          throw postgresError(sqlState);
        }
        return { rows: [], rowCount: 0 };
      });

      const response = await callTransact([
        { table: 'tx_docs', op: 'expect', id: 'anchor', exists: true },
        { table: 'tx_docs', op: 'update', id: 'd1', data: { status: 'done' } },
      ]);

      expect(response.status).toBe(200);
      const body = (await response.json()) as { results: Array<Record<string, unknown>> };
      expect(body.results).toEqual([
        { expected: true },
        { updated: { id: 'd1', title: 'Doc', status: 'done' } },
      ]);
      const sqls = calls.map(({ sql }) => sql);
      const orderedSteps = sqls.map((sql) => {
        if (sql.startsWith('SELECT * FROM "tx_docs"')) return 'EXPECT';
        if (sql.startsWith('UPDATE "tx_docs"')) return 'UPDATE';
        return sql;
      });
      expect(orderedSteps).toEqual(failStatement === 'COMMIT'
        ? [
          'BEGIN ISOLATION LEVEL SERIALIZABLE', 'EXPECT', 'UPDATE', 'COMMIT', 'ROLLBACK',
          'BEGIN ISOLATION LEVEL SERIALIZABLE', 'EXPECT', 'UPDATE', 'COMMIT',
        ]
        : [
          'BEGIN ISOLATION LEVEL SERIALIZABLE', 'EXPECT', 'UPDATE', 'ROLLBACK',
          'BEGIN ISOLATION LEVEL SERIALIZABLE', 'EXPECT', 'UPDATE', 'COMMIT',
        ]);
    },
  );

  it('returns a conflict after the fixed serialization retry bound', async () => {
    const calls = mockExecutorModule((sql) => {
      if (sql.startsWith('INSERT INTO "tx_docs"')) {
        return { rows: [{ id: 'd1', title: 'Doc' }], rowCount: 1 };
      }
      if (sql === 'COMMIT') throw postgresError('40001');
      return { rows: [], rowCount: 0 };
    });

    const response = await callTransact([
      { table: 'tx_docs', op: 'insert', data: { title: 'Doc' } },
    ]);

    expect(response.status).toBe(409);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain('persisted for 3 attempts');
    const sqls = calls.map(({ sql }) => sql);
    expect(sqls.filter((sql) => sql === 'BEGIN ISOLATION LEVEL SERIALIZABLE')).toHaveLength(3);
    expect(sqls.filter((sql) => sql.startsWith('INSERT INTO "tx_docs"'))).toHaveLength(3);
    expect(sqls.filter((sql) => sql === 'ROLLBACK')).toHaveLength(3);
  });

  it('does not retry a non-serialization PostgreSQL failure', async () => {
    const calls = mockExecutorModule((sql) => {
      if (sql.startsWith('INSERT INTO "tx_docs"')) throw postgresError('23505');
      return { rows: [], rowCount: 0 };
    });

    await expect(callTransact([
      { table: 'tx_docs', op: 'insert', data: { title: 'Doc' } },
    ])).rejects.toMatchObject({ code: '23505' });
    const sqls = calls.map(({ sql }) => sql);
    expect(sqls.filter((sql) => sql === 'BEGIN ISOLATION LEVEL SERIALIZABLE')).toHaveLength(1);
    expect(sqls.filter((sql) => sql === 'ROLLBACK')).toHaveLength(1);
  });

  it.each([
    {
      operation: { table: 'tx_docs', op: 'update', id: 'missing', data: { status: 'done' } },
      statement: 'UPDATE "tx_docs"',
      label: 'update',
    },
    {
      operation: { table: 'tx_docs', op: 'delete', id: 'missing' },
      statement: 'DELETE FROM "tx_docs"',
      label: 'delete',
    },
  ])('rolls back instead of false-acking a missing $label target', async ({
    operation,
    statement,
    label,
  }) => {
    const calls = mockExecutorModule(() => ({ rows: [], rowCount: 0 }));

    const response = await callTransact([operation]);

    expect(response.status).toBe(409);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain(`${label} target "tx_docs/missing" did not affect exactly one row`);
    const sqls = calls.map(({ sql }) => sql);
    expect(sqls.some((sql) => sql.startsWith(statement))).toBe(true);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
  });

  // This barrier proves lock-holder ordering only. A version-changing anchor
  // write is still required for strict post-wait snapshot freshness.
  it('orders held writers that expect the same existing anchor row', async () => {
    const firstUpdateEntered = deferred();
    const allowFirstCommit = deferred();
    const secondAnchorAttempted = deferred();
    const updateOrder: number[] = [];
    let lockOwner: number | null = null;
    const waiters: Array<{ connectionId: number; resolve: () => void }> = [];

    const acquireAnchor = async (connectionId: number) => {
      if (lockOwner === null) {
        lockOwner = connectionId;
        return;
      }
      if (connectionId === 2) secondAnchorAttempted.resolve();
      await new Promise<void>((resolve) => {
        waiters.push({ connectionId, resolve });
      });
    };
    const releaseAnchor = (connectionId: number) => {
      if (lockOwner !== connectionId) return;
      const next = waiters.shift();
      if (!next) {
        lockOwner = null;
        return;
      }
      lockOwner = next.connectionId;
      next.resolve();
    };

    const calls = mockExecutorModule(async (sql, _params, connectionId) => {
      if (sql.startsWith('SELECT * FROM "tx_docs"')) {
        expect(sql).toContain('LIMIT 1 FOR UPDATE');
        await acquireAnchor(connectionId);
        return { rows: [{ id: 'anchor', title: 'Anchor', status: 'active' }], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE "tx_docs"')) {
        updateOrder.push(connectionId);
        if (connectionId === 1) {
          firstUpdateEntered.resolve();
          await allowFirstCommit.promise;
        }
        return {
          rows: [{ id: `doc-${connectionId}`, title: 'Doc', status: 'done' }],
          rowCount: 1,
        };
      }
      if (sql === 'COMMIT' || sql === 'ROLLBACK') releaseAnchor(connectionId);
      return { rows: [], rowCount: 0 };
    });

    const first = callTransact([
      { table: 'tx_docs', op: 'expect', id: 'anchor', exists: true },
      { table: 'tx_docs', op: 'update', id: 'doc-1', data: { status: 'done' } },
    ]);
    await firstUpdateEntered.promise;

    let secondSettled = false;
    const second = callTransact([
      { table: 'tx_docs', op: 'expect', id: 'anchor', exists: true },
      { table: 'tx_docs', op: 'update', id: 'doc-2', data: { status: 'done' } },
    ]).finally(() => {
      secondSettled = true;
    });
    await secondAnchorAttempted.promise;

    expect(updateOrder).toEqual([1]);
    expect(secondSettled).toBe(false);
    allowFirstCommit.resolve();

    const responses = await Promise.all([first, second]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    expect(updateOrder).toEqual([1, 2]);
    expect(calls.filter(({ sql }) => sql === 'BEGIN ISOLATION LEVEL SERIALIZABLE')).toHaveLength(2);
    expect(calls.filter(({ sql }) => sql.startsWith('SELECT * FROM "tx_docs"')))
      .toHaveLength(2);
  });

  it('retries a stale waiter after an anchor write and sees the committed cross-table predicate', async () => {
    interface TransactionState {
      snapshotVersion: number;
      pendingAnchorStatus?: string;
      pendingClaim?: boolean;
    }

    const firstAnchorUpdated = deferred();
    const allowFirstToFinish = deferred();
    const secondAnchorAttempted = deferred();
    const states = new Map<number, TransactionState>();
    const waiters: Array<{ connectionId: number; resolve: () => void }> = [];
    let lockOwner: number | null = null;
    let committedVersion = 0;
    let committedAnchorStatus = 'open';
    let committedClaim = false;
    let heldFirstUpdate = false;

    const acquireAnchor = async (connectionId: number) => {
      if (lockOwner === null) {
        lockOwner = connectionId;
        return;
      }
      if (connectionId === 2) secondAnchorAttempted.resolve();
      await new Promise<void>((resolve) => {
        waiters.push({ connectionId, resolve });
      });
    };
    const releaseAnchor = (connectionId: number) => {
      if (lockOwner !== connectionId) return;
      const next = waiters.shift();
      if (!next) {
        lockOwner = null;
        return;
      }
      lockOwner = next.connectionId;
      next.resolve();
    };

    const calls = mockExecutorModule(async (sql, _params, connectionId) => {
      if (sql === 'BEGIN ISOLATION LEVEL SERIALIZABLE') {
        states.set(connectionId, { snapshotVersion: committedVersion });
        return { rows: [], rowCount: 0 };
      }
      const state = states.get(connectionId);
      if (!state) throw new Error(`Missing transaction state for connection ${connectionId}`);

      if (sql.startsWith('SELECT * FROM "tx_docs"')) {
        await acquireAnchor(connectionId);
        if (state.snapshotVersion !== committedVersion) {
          throw postgresError('40001');
        }
        return {
          rows: [{ id: 'anchor', title: 'Anchor', status: committedAnchorStatus }],
          rowCount: 1,
        };
      }
      if (sql.startsWith('UPDATE "tx_docs"')) {
        state.pendingAnchorStatus = connectionId === 1 ? 'fenced-1' : 'fenced-2';
        if (connectionId === 1 && !heldFirstUpdate) {
          heldFirstUpdate = true;
          firstAnchorUpdated.resolve();
          await allowFirstToFinish.promise;
        }
        return {
          rows: [{ id: 'anchor', title: 'Anchor', status: state.pendingAnchorStatus }],
          rowCount: 1,
        };
      }
      if (sql.startsWith('SELECT * FROM "tx_audit"')) {
        return committedClaim
          ? { rows: [{ id: 'claim-1', action: 'claim' }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('INSERT INTO "tx_audit"')) {
        state.pendingClaim = true;
        return { rows: [{ id: 'claim-1', action: 'claim' }], rowCount: 1 };
      }
      if (sql === 'COMMIT') {
        if (state.pendingAnchorStatus !== undefined) {
          committedAnchorStatus = state.pendingAnchorStatus;
          committedVersion += 1;
        }
        if (state.pendingClaim) committedClaim = true;
        states.delete(connectionId);
        releaseAnchor(connectionId);
        return { rows: [], rowCount: 0 };
      }
      if (sql === 'ROLLBACK') {
        states.delete(connectionId);
        releaseAnchor(connectionId);
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    const operationsFor = (status: string) => [
      {
        table: 'tx_docs', op: 'expect', id: 'anchor',
        where: [['status', '==', 'open']], exists: true,
      },
      { table: 'tx_docs', op: 'update', id: 'anchor', data: { status } },
      {
        table: 'tx_audit', op: 'expect', where: [['action', '==', 'claim']], exists: false,
        fencedBy: { table: 'tx_docs', id: 'anchor', field: 'status' },
      },
      { table: 'tx_audit', op: 'insert', data: { action: 'claim' } },
    ];

    const first = callTransact(operationsFor('fenced-1'));
    await firstAnchorUpdated.promise;
    const second = callTransact(operationsFor('fenced-2'));
    await secondAnchorAttempted.promise;

    try {
      expect(calls.filter(({ connectionId, sql }) =>
        connectionId === 2 && sql.startsWith('UPDATE "tx_docs"'))).toHaveLength(0);
    } finally {
      allowFirstToFinish.resolve();
    }

    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(409);
    const secondBody = (await secondResponse.json()) as { message: string };
    expect(secondBody.message).toContain('expected no matching row in "tx_audit"');
    expect(committedAnchorStatus).toBe('fenced-1');
    expect(committedClaim).toBe(true);

    const secondSqls = calls
      .filter(({ connectionId }) => connectionId === 2)
      .map(({ sql }) => {
        if (sql.startsWith('SELECT * FROM "tx_docs"')) return 'EXPECT_ANCHOR';
        if (sql.startsWith('UPDATE "tx_docs"')) return 'UPDATE_ANCHOR';
        if (sql.startsWith('SELECT * FROM "tx_audit"')) return 'EXPECT_CLAIM_ABSENT';
        return sql;
      });
    expect(secondSqls).toEqual([
      'BEGIN ISOLATION LEVEL SERIALIZABLE', 'EXPECT_ANCHOR', 'ROLLBACK',
      'BEGIN ISOLATION LEVEL SERIALIZABLE', 'EXPECT_ANCHOR', 'UPDATE_ANCHOR',
      'EXPECT_CLAIM_ABSENT', 'ROLLBACK',
    ]);
    expect(calls.filter(({ connectionId, sql }) =>
      connectionId === 2 && sql.startsWith('INSERT INTO "tx_audit"'))).toHaveLength(0);
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

  it('rejects an unanchored negative expectation before BEGIN and all writes', async () => {
    const calls = mockExecutorModule(() => ({ rows: [], rowCount: 0 }));
    const response = await callTransact([
      { table: 'tx_audit', op: 'expect', where: [['action', '==', 'claim']], exists: false },
      { table: 'tx_docs', op: 'delete', id: 'd1' },
    ]);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 400,
      message: expect.stringContaining('Unsafe transaction shape'),
    });
    expect(calls).toHaveLength(0);
  });

  it('accepts an exact-id self-sealing negative expectation', async () => {
    const calls = mockExecutorModule((sql) => {
      if (sql.startsWith('SELECT * FROM "tx_audit"')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('INSERT INTO "tx_audit"')) {
        return { rows: [{ id: 'claim-1', action: 'claim' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const response = await callTransact([
      { table: 'tx_audit', op: 'expect', id: 'claim-1', exists: false },
      { table: 'tx_audit', op: 'insert', data: { id: 'claim-1', action: 'claim' } },
    ]);

    expect(response.status).toBe(200);
    expect(calls.map(({ sql }) => sql)).toContain('BEGIN ISOLATION LEVEL SERIALIZABLE');
  });

  it('accepts an actual-changing keyed revision fence before a negative predicate', async () => {
    const calls = mockExecutorModule((sql) => {
      if (sql.startsWith('SELECT * FROM "tx_docs"')) {
        return { rows: [{ id: 'anchor', title: 'Anchor', status: 'open' }], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE "tx_docs"')) {
        return { rows: [{ id: 'anchor', title: 'Anchor', status: 'fenced' }], rowCount: 1 };
      }
      if (sql.startsWith('SELECT * FROM "tx_audit"')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('INSERT INTO "tx_audit"')) {
        return { rows: [{ id: 'claim-1', action: 'claim' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const response = await callTransact([
      {
        table: 'tx_docs', op: 'expect', id: 'anchor',
        where: [['status', '==', 'open']], exists: true,
      },
      { table: 'tx_docs', op: 'update', id: 'anchor', data: { status: 'fenced' } },
      {
        table: 'tx_audit', op: 'expect', where: [['action', '==', 'claim']], exists: false,
        fencedBy: { table: 'tx_docs', id: 'anchor', field: 'status' },
      },
      { table: 'tx_audit', op: 'insert', data: { id: 'claim-1', action: 'claim' } },
    ]);

    expect(response.status).toBe(200);
    expect(calls.filter(({ sql }) => sql === 'BEGIN ISOLATION LEVEL SERIALIZABLE')).toHaveLength(1);
  });
});
