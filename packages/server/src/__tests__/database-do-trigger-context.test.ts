import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { defineConfig } from '@edge-base/shared';
import { setConfig } from '../lib/do-router.js';

type ExecuteDbTriggers = (
  table: string,
  event: 'insert' | 'update' | 'delete',
  data: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  context: Record<string, unknown>,
  origin: { namespace: string; id?: string },
) => Promise<void>;

const functionMocks = vi.hoisted(() => ({
  executeDbTriggers: vi.fn<ExecuteDbTriggers>(async () => undefined),
  executeDbTriggerBatch: vi.fn(async (
    items: Array<{
      table: string;
      event: 'insert' | 'update' | 'delete';
      data: { before?: Record<string, unknown>; after?: Record<string, unknown> };
    }>,
    context: Record<string, unknown>,
    origin: { namespace: string; id?: string },
  ) => {
    for (const item of items) {
      await functionMocks.executeDbTriggers(
        item.table,
        item.event,
        item.data,
        context,
        origin,
      );
    }
  }),
}));

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

vi.mock('../lib/functions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/functions.js')>();
  return {
    ...actual,
    executeDbTriggerBatch: functionMocks.executeDbTriggerBatch,
    executeDbTriggers: functionMocks.executeDbTriggers,
  };
});

const TABLE = 'trigger_rows';
const NORMALIZED_TABLE = 'normalized_transact_rows';
const DO_NAME = 'workspace:synthetic-workspace';
const openDatabases: DatabaseSync[] = [];

function createSQLiteState(database: DatabaseSync) {
  return {
    storage: {
      sql: {
        exec(query: string, ...params: unknown[]) {
          return database.prepare(query).all(...(params as never[]));
        },
      },
      transactionSync(callback: () => void) {
        database.exec('BEGIN');
        try {
          callback();
          database.exec('COMMIT');
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      },
    },
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState;
}

function internalRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`http://do${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-DO-Name': DO_NAME,
      'X-DO-Create-Authorized': 'true',
      'X-EdgeBase-Internal': 'true',
      ...init.headers,
    },
  });
}

function ruleCheckedRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`http://do${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-DO-Name': DO_NAME,
      'X-DO-Create-Authorized': 'true',
      ...init.headers,
    },
  });
}

describe('DatabaseDO trigger provider context', () => {
  afterEach(async () => {
    const { clearFunctionRegistry } = await import('../lib/functions.js');
    clearFunctionRegistry();
    functionMocks.executeDbTriggerBatch.mockClear();
    functionMocks.executeDbTriggers.mockClear();
    setConfig({});
    for (const database of openDatabases.splice(0)) database.close();
  });

  it('preserves provider authority across single, batch, and transact trigger paths', async () => {
    const config = defineConfig({
      release: true,
      databases: {
        workspace: {
          provider: 'do',
          instance: true,
          tables: {
            [TABLE]: {
              schema: { title: { type: 'string', required: true } },
              access: { read: true, insert: true, update: true, delete: true },
            },
          },
        },
        app: {
          provider: 'd1',
          tables: {
            queue: {
              schema: { workspaceId: { type: 'string', required: true } },
            },
          },
        },
      },
    });
    setConfig(config);

    const database = new DatabaseSync(':memory:');
    openDatabases.push(database);
    const authD1 = {} as D1Database;
    const appD1 = {} as D1Database;
    const databaseFetch = vi.fn().mockResolvedValue(
      Response.json({ slug: 'unexpected-do-fallback' }, { status: 500 }),
    );
    const env = {
      DATABASE_LIVE: {
        idFromName: vi.fn((name: string) => name),
        get: vi.fn(() => ({
          fetch: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
        })),
      } as unknown as DurableObjectNamespace,
      DATABASE: {
        idFromName: vi.fn((name: string) => name),
        get: vi.fn(() => ({ fetch: databaseFetch })),
      } as unknown as DurableObjectNamespace,
      AUTH: {} as DurableObjectNamespace,
      AUTH_DB: authD1,
      DB_D1_APP: appD1,
    };
    const state = createSQLiteState(database);
    const { registerFunction } = await import('../lib/functions.js');
    for (const event of ['insert', 'update', 'delete'] as const) {
      registerFunction(`probe-${event}`, {
        trigger: { type: 'db', table: TABLE, event },
        handler: vi.fn(async () => undefined),
      });
    }
    const { DatabaseDO } = await import('../durable-objects/database-do.js');
    const databaseDo = new DatabaseDO(state, env as never);

    const warmup = await databaseDo.fetch(internalRequest(`/tables/${TABLE}?limit=1`));
    expect(warmup.status).toBe(200);

    const captured: Array<{
      lane: string;
      event: string;
      context: Record<string, unknown>;
    }> = [];
    const run = async (
      lane: string,
      request: Request,
      expectedEvents: string[],
    ): Promise<void> => {
      functionMocks.executeDbTriggers.mockClear();
      const response = await databaseDo.fetch(request);
      expect(response.status, `${lane}: ${await response.clone().text()}`).toBeLessThan(300);
      const calls = functionMocks.executeDbTriggers.mock.calls;
      expect(calls.map((call) => call[1]), lane).toEqual(expectedEvents);
      for (const call of calls) {
        captured.push({
          lane,
          event: call[1],
          context: call[3] as Record<string, unknown>,
        });
      }
    };

    await run(
      'insert',
      internalRequest(`/tables/${TABLE}`, {
        method: 'POST',
        body: JSON.stringify({ id: 'single', title: 'Inserted' }),
      }),
      ['insert'],
    );
    await run(
      'update',
      internalRequest(`/tables/${TABLE}/single`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated' }),
      }),
      ['update'],
    );
    await run(
      'delete',
      internalRequest(`/tables/${TABLE}/single`, { method: 'DELETE' }),
      ['delete'],
    );

    database.prepare(`INSERT INTO "${TABLE}" ("id", "title") VALUES (?, ?)`)
      .run('batch-update', 'Before batch update');
    database.prepare(`INSERT INTO "${TABLE}" ("id", "title") VALUES (?, ?)`)
      .run('batch-delete', 'Before batch delete');
    await run(
      'batch',
      internalRequest(`/tables/${TABLE}/batch`, {
        method: 'POST',
        body: JSON.stringify({
          inserts: [{ id: 'batch-insert', title: 'Batch insert' }],
          updates: [{ id: 'batch-update', data: { title: 'Batch update' } }],
          deletes: ['batch-delete'],
        }),
      }),
      ['insert', 'update', 'delete'],
    );

    database.prepare(`INSERT INTO "${TABLE}" ("id", "title") VALUES (?, ?)`)
      .run('transact-update', 'Before transact update');
    database.prepare(`INSERT INTO "${TABLE}" ("id", "title") VALUES (?, ?)`)
      .run('transact-delete', 'Before transact delete');
    await run(
      'transact',
      internalRequest('/transact', {
        method: 'POST',
        body: JSON.stringify({
          resultMode: 'compact',
          operations: [
            { table: TABLE, op: 'insert', data: { id: 'transact-insert', title: 'Insert' } },
            { table: TABLE, op: 'update', id: 'transact-update', data: { title: 'Update' } },
            { table: TABLE, op: 'delete', id: 'transact-delete' },
          ],
        }),
      }),
      ['insert', 'update', 'delete'],
    );

    expect(captured.map(({ lane, event, context }) => ({
      lane,
      event,
      env: context.env === env,
      d1Database: context.d1Database === authD1,
      executionCtx: context.executionCtx === state,
      databaseNamespace: context.databaseNamespace === env.DATABASE,
    }))).toEqual([
      { lane: 'insert', event: 'insert', env: true, d1Database: true, executionCtx: true, databaseNamespace: true },
      { lane: 'update', event: 'update', env: true, d1Database: true, executionCtx: true, databaseNamespace: true },
      { lane: 'delete', event: 'delete', env: true, d1Database: true, executionCtx: true, databaseNamespace: true },
      { lane: 'batch', event: 'insert', env: true, d1Database: true, executionCtx: true, databaseNamespace: true },
      { lane: 'batch', event: 'update', env: true, d1Database: true, executionCtx: true, databaseNamespace: true },
      { lane: 'batch', event: 'delete', env: true, d1Database: true, executionCtx: true, databaseNamespace: true },
      { lane: 'transact', event: 'insert', env: true, d1Database: true, executionCtx: true, databaseNamespace: true },
      { lane: 'transact', event: 'update', env: true, d1Database: true, executionCtx: true, databaseNamespace: true },
      { lane: 'transact', event: 'delete', env: true, d1Database: true, executionCtx: true, databaseNamespace: true },
    ]);
  });

  it('normalizes schema values for every full transact row consumer', async () => {
    const ruleRows: Record<string, unknown>[] = [];
    const recordRuleRow = (_auth: unknown, row: Record<string, unknown>) => {
      ruleRows.push(structuredClone(row));
      return true;
    };
    const config = defineConfig({
      release: true,
      databases: {
        workspace: {
          provider: 'do',
          instance: true,
          tables: {
            [NORMALIZED_TABLE]: {
              schema: {
                title: { type: 'string', required: true },
                payload: { type: 'json', required: true },
                active: { type: 'boolean', required: true },
                score: { type: 'number', required: true },
              },
              access: {
                read: recordRuleRow,
                insert: true,
                update: recordRuleRow,
                delete: recordRuleRow,
              },
            },
          },
        },
      },
    });
    setConfig(config);

    const database = new DatabaseSync(':memory:');
    openDatabases.push(database);
    const databaseFetch = vi.fn().mockResolvedValue(
      Response.json({ slug: 'unexpected-do-fallback' }, { status: 500 }),
    );
    const liveFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const env = {
      DATABASE_LIVE: {
        idFromName: vi.fn((name: string) => name),
        get: vi.fn(() => ({ fetch: liveFetch })),
      } as unknown as DurableObjectNamespace,
      DATABASE: {
        idFromName: vi.fn((name: string) => name),
        get: vi.fn(() => ({ fetch: databaseFetch })),
      } as unknown as DurableObjectNamespace,
      AUTH: {} as DurableObjectNamespace,
      AUTH_DB: {} as D1Database,
      DB_D1_APP: {} as D1Database,
    };
    const state = createSQLiteState(database);
    const { registerFunction } = await import('../lib/functions.js');
    for (const event of ['update', 'delete'] as const) {
      registerFunction(`normalized-${event}`, {
        trigger: { type: 'db', table: NORMALIZED_TABLE, event },
        handler: vi.fn(async () => undefined),
      });
    }
    const { DatabaseDO } = await import('../durable-objects/database-do.js');
    const databaseDo = new DatabaseDO(state, env as never);

    const warmup = await databaseDo.fetch(internalRequest(`/tables/${NORMALIZED_TABLE}?limit=1`));
    expect(warmup.status).toBe(200);
    const insertedResponse = await databaseDo.fetch(internalRequest('/transact', {
      method: 'POST',
      body: JSON.stringify({
        operations: [{
          table: NORMALIZED_TABLE,
          op: 'insert',
          data: {
            id: 'normalized-row',
            title: 'Before',
            payload: { phase: 'before' },
            active: false,
            score: 3,
          },
        }],
      }),
    }));
    expect(insertedResponse.status, await insertedResponse.clone().text()).toBe(200);
    const insertedBody = await insertedResponse.json() as {
      results: Array<{ inserted: Record<string, unknown> }>;
    };
    expect(insertedBody.results[0]?.inserted).toMatchObject({
      payload: { phase: 'before' },
      active: false,
      score: 3,
    });

    ruleRows.length = 0;
    liveFetch.mockClear();
    functionMocks.executeDbTriggers.mockClear();
    const updatedResponse = await databaseDo.fetch(ruleCheckedRequest('/transact', {
      method: 'POST',
      body: JSON.stringify({
        operations: [
          { table: NORMALIZED_TABLE, op: 'expect', id: 'normalized-row', exists: true },
          {
            table: NORMALIZED_TABLE,
            op: 'update',
            id: 'normalized-row',
            data: {
              title: 'After',
              payload: { phase: 'after' },
              active: true,
              score: 7,
            },
          },
        ],
      }),
    }));
    expect(updatedResponse.status, await updatedResponse.clone().text()).toBe(200);
    const updatedBody = await updatedResponse.json() as {
      results: Array<{ expected?: boolean; updated?: Record<string, unknown> }>;
    };
    expect(updatedBody.results[1]?.updated).toMatchObject({
      payload: { phase: 'after' },
      active: true,
      score: 7,
    });
    expect(ruleRows).toEqual([
      expect.objectContaining({ payload: { phase: 'before' }, active: false, score: 3 }),
      expect.objectContaining({ payload: { phase: 'before' }, active: false, score: 3 }),
    ]);
    const updateTrigger = functionMocks.executeDbTriggers.mock.calls.find((call) => call[1] === 'update');
    expect(updateTrigger?.[2]).toMatchObject({
      before: { payload: { phase: 'before' }, active: false, score: 3 },
      after: { payload: { phase: 'after' }, active: true, score: 7 },
    });
    await vi.waitFor(() => expect(liveFetch).toHaveBeenCalledTimes(2));
    const updateLivePayloads = liveFetch.mock.calls.map(([, init]) => (
      JSON.parse((init as RequestInit).body as string) as Record<string, unknown>
    ));
    expect(updateLivePayloads).toEqual([
      expect.objectContaining({
        type: 'modified',
        data: expect.objectContaining({ payload: { phase: 'after' }, active: true, score: 7 }),
      }),
      expect.objectContaining({
        type: 'modified',
        data: expect.objectContaining({ payload: { phase: 'after' }, active: true, score: 7 }),
      }),
    ]);

    ruleRows.length = 0;
    const deletedResponse = await databaseDo.fetch(ruleCheckedRequest('/transact', {
      method: 'POST',
      body: JSON.stringify({
        operations: [{ table: NORMALIZED_TABLE, op: 'delete', id: 'normalized-row' }],
      }),
    }));
    expect(deletedResponse.status, await deletedResponse.clone().text()).toBe(200);
    expect(ruleRows).toEqual([
      expect.objectContaining({ payload: { phase: 'after' }, active: true, score: 7 }),
    ]);
    const deleteTrigger = functionMocks.executeDbTriggers.mock.calls.find((call) => call[1] === 'delete');
    expect(deleteTrigger?.[2]).toMatchObject({
      before: { payload: { phase: 'after' }, active: true, score: 7 },
    });
  });
});
