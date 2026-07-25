import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { defineConfig } from '@edge-base/shared';
import { setConfig } from '../lib/do-router.js';

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

const TABLE = 'trigger_aggregation_rows';
const SECOND_TABLE = 'trigger_aggregation_secondary_rows';
const DO_NAME = 'workspace:synthetic-trigger-aggregation';
const MAX_DB_TRIGGER_CONCURRENCY = 8;
const openDatabases: DatabaseSync[] = [];

function createObservedSQLiteState(database: DatabaseSync) {
  const backgroundPromises: Promise<unknown>[] = [];
  const waitUntil = vi.fn((promise: Promise<unknown>) => {
    backgroundPromises.push(Promise.resolve(promise));
  });
  return {
    state: {
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
      waitUntil,
    } as unknown as DurableObjectState,
    backgroundPromises,
    waitUntil,
  };
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

function createEnv() {
  return {
    DATABASE_LIVE: {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({
        fetch: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
      })),
    } as unknown as DurableObjectNamespace,
    DATABASE: {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({
        fetch: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
      })),
    } as unknown as DurableObjectNamespace,
    AUTH: {} as DurableObjectNamespace,
    AUTH_DB: {} as D1Database,
    DB_D1_APP: {} as D1Database,
  };
}

async function createDatabaseDo() {
  const database = new DatabaseSync(':memory:');
  openDatabases.push(database);
  const observedState = createObservedSQLiteState(database);
  const { DatabaseDO } = await import('../durable-objects/database-do.js');
  const databaseDo = new DatabaseDO(observedState.state, createEnv() as never);
  const warmup = await databaseDo.fetch(internalRequest(`/tables/${TABLE}?limit=1`));
  expect(warmup.status).toBe(200);
  return { databaseDo, ...observedState };
}

function createHeldHandler() {
  let active = 0;
  let peak = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handler = vi.fn(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await held;
    active -= 1;
  });
  return {
    handler,
    release,
    peak: () => peak,
  };
}

describe('DatabaseDO trigger aggregation', () => {
  afterEach(async () => {
    const { clearFunctionRegistry } = await import('../lib/functions.js');
    clearFunctionRegistry();
    setConfig({});
    for (const database of openDatabases.splice(0)) database.close();
  });

  it('keeps one single-row trigger in one background owner', async () => {
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
      },
    });
    setConfig(config);
    const { registerFunction } = await import('../lib/functions.js');
    const handler = vi.fn(async () => undefined);
    registerFunction('single-row-probe', {
      trigger: { type: 'db', table: TABLE, event: 'insert' },
      handler,
    });
    const { databaseDo, backgroundPromises, waitUntil } = await createDatabaseDo();

    const response = await databaseDo.fetch(internalRequest(`/tables/${TABLE}`, {
      method: 'POST',
      body: JSON.stringify({ id: 'single', title: 'Single' }),
    }));
    expect(response.status, await response.clone().text()).toBe(201);
    await Promise.all(backgroundPromises);

    // One database-live owner plus one DB-trigger owner.
    expect(waitUntil).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not create background work for an empty batch', async () => {
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
      },
    });
    setConfig(config);
    const { registerFunction } = await import('../lib/functions.js');
    const handler = vi.fn(async () => undefined);
    registerFunction('empty-batch-probe', {
      trigger: { type: 'db', table: TABLE, event: 'insert' },
      handler,
    });
    const { databaseDo, backgroundPromises, waitUntil } = await createDatabaseDo();

    const response = await databaseDo.fetch(internalRequest(`/tables/${TABLE}/batch`, {
      method: 'POST',
      body: JSON.stringify({ inserts: [], updates: [], deletes: [] }),
    }));
    expect(response.status, await response.clone().text()).toBe(200);
    await Promise.all(backgroundPromises);

    expect(waitUntil).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('collects a 50-row batch into one bounded trigger owner', async () => {
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
      },
    });
    setConfig(config);
    const { registerFunction } = await import('../lib/functions.js');
    const heldHandler = createHeldHandler();
    registerFunction('batch-probe', {
      trigger: { type: 'db', table: TABLE, event: 'insert' },
      handler: heldHandler.handler,
    });
    const { databaseDo, backgroundPromises, waitUntil } = await createDatabaseDo();

    const response = await databaseDo.fetch(internalRequest(`/tables/${TABLE}/batch`, {
      method: 'POST',
      body: JSON.stringify({
        inserts: Array.from({ length: 50 }, (_, index) => ({
          id: `batch-${index}`,
          title: `Batch ${index}`,
        })),
      }),
    }));
    expect(response.status, await response.clone().text()).toBe(200);
    const lateHandler = vi.fn(async () => undefined);
    registerFunction('late-batch-probe', {
      trigger: { type: 'db', table: TABLE, event: 'insert' },
      handler: lateHandler,
    });
    heldHandler.release();
    await Promise.all(backgroundPromises);

    // One collected database-live owner plus one collected DB-trigger owner.
    expect.soft(waitUntil).toHaveBeenCalledTimes(2);
    expect(heldHandler.handler).toHaveBeenCalledTimes(50);
    expect.soft(heldHandler.peak()).toBe(MAX_DB_TRIGGER_CONCURRENCY);
    expect(lateHandler).not.toHaveBeenCalled();
  });

  it('collects a 50-row transact into one bounded trigger owner', async () => {
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
      },
    });
    setConfig(config);
    const { registerFunction } = await import('../lib/functions.js');
    const heldHandler = createHeldHandler();
    registerFunction('transact-probe', {
      trigger: { type: 'db', table: TABLE, event: 'insert' },
      handler: heldHandler.handler,
    });
    const { databaseDo, backgroundPromises, waitUntil } = await createDatabaseDo();

    const response = await databaseDo.fetch(internalRequest('/transact', {
      method: 'POST',
      body: JSON.stringify({
        resultMode: 'compact',
        operations: Array.from({ length: 50 }, (_, index) => ({
          table: TABLE,
          op: 'insert',
          data: { id: `transact-${index}`, title: `Transact ${index}` },
        })),
      }),
    }));
    expect(response.status, await response.clone().text()).toBe(200);
    heldHandler.release();
    await Promise.all(backgroundPromises);

    // One collected database-live owner plus one collected DB-trigger owner.
    expect.soft(waitUntil).toHaveBeenCalledTimes(2);
    expect(heldHandler.handler).toHaveBeenCalledTimes(50);
    expect.soft(heldHandler.peak()).toBe(MAX_DB_TRIGGER_CONCURRENCY);
  });

  it('preserves per-row handler order and drains mixed siblings after one failure', async () => {
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
            [SECOND_TABLE]: {
              schema: { title: { type: 'string', required: true } },
              access: { read: true, insert: true, update: true, delete: true },
            },
          },
        },
      },
    });
    setConfig(config);
    const { databaseDo, backgroundPromises, waitUntil } = await createDatabaseDo();
    const seeded = await databaseDo.fetch(internalRequest(`/tables/${SECOND_TABLE}`, {
      method: 'POST',
      body: JSON.stringify({ id: 'secondary', title: 'Before' }),
    }));
    expect(seeded.status, await seeded.clone().text()).toBe(201);
    await Promise.all(backgroundPromises);
    backgroundPromises.length = 0;
    waitUntil.mockClear();

    const { registerFunction } = await import('../lib/functions.js');
    const order: string[] = [];
    const firstHandler = vi.fn(async (context: unknown) => {
      const data = (context as {
        data: { after: { id: string } };
      }).data;
      order.push(`first:${data.after.id}`);
      if (data.after.id === 'fails-first') {
        throw new Error('synthetic first-handler failure');
      }
    });
    const secondHandler = vi.fn(async (context: unknown) => {
      const data = (context as {
        data: { after: { id: string } };
      }).data;
      order.push(`second:${data.after.id}`);
    });
    const updateHandler = vi.fn(async (context: unknown) => {
      const data = (context as {
        data: { after: { id: string } };
      }).data;
      order.push(`update:${data.after.id}`);
    });
    registerFunction('ordered-first', {
      trigger: { type: 'db', table: TABLE, event: 'insert' },
      handler: firstHandler,
    });
    registerFunction('ordered-second', {
      trigger: { type: 'db', table: TABLE, event: 'insert' },
      handler: secondHandler,
    });
    registerFunction('secondary-update', {
      trigger: { type: 'db', table: SECOND_TABLE, event: 'update' },
      handler: updateHandler,
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const response = await databaseDo.fetch(internalRequest('/transact', {
        method: 'POST',
        body: JSON.stringify({
          resultMode: 'compact',
          operations: [
            {
              table: TABLE,
              op: 'insert',
              data: { id: 'succeeds', title: 'Succeeds' },
            },
            {
              table: TABLE,
              op: 'insert',
              data: { id: 'fails-first', title: 'Fails first handler' },
            },
            {
              table: SECOND_TABLE,
              op: 'update',
              id: 'secondary',
              data: { title: 'After' },
            },
          ],
        }),
      }));
      expect(response.status, await response.clone().text()).toBe(200);
      await Promise.all(backgroundPromises);

      // Three below-threshold database-live events plus one collected trigger owner.
      expect(waitUntil).toHaveBeenCalledTimes(4);
      expect(firstHandler).toHaveBeenCalledTimes(2);
      expect(secondHandler).toHaveBeenCalledTimes(2);
      expect(updateHandler).toHaveBeenCalledTimes(1);
      for (const id of ['succeeds', 'fails-first']) {
        expect(order.indexOf(`first:${id}`)).toBeLessThan(order.indexOf(`second:${id}`));
      }
      expect(order).toContain('update:secondary');
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
