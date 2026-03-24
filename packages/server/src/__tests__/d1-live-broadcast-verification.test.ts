import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineConfig } from '@edge-base/shared';
import { buildInternalHandlerContext } from '../lib/internal-request.js';
import type { Env } from '../types.js';

function createInsertMockD1(row: Record<string, unknown>): D1Database {
  return {
    prepare(sql: string) {
      const state = { bindings: [] as unknown[] };
      const stmt = {
        bind: (...values: unknown[]) => {
          state.bindings = values;
          return stmt;
        },
        all: async () => {
          if (sql.startsWith('INSERT INTO')) {
            return { results: [], meta: { changes: 1 } };
          }
          if (sql.startsWith('SELECT * FROM')) {
            return { results: [row], meta: { changes: 0 } };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function createBatchInsertMockD1(rowsById: Record<string, Record<string, unknown>>): D1Database {
  return {
    prepare(sql: string) {
      const state = { bindings: [] as unknown[] };
      const stmt = {
        _sql: sql,
        bind: (...values: unknown[]) => {
          state.bindings = values;
          return stmt;
        },
        all: async () => {
          if (!sql.startsWith('SELECT * FROM')) {
            throw new Error(`Unexpected SQL: ${sql}`);
          }
          const id = String(state.bindings[0]);
          return {
            results: rowsById[id] ? [rowsById[id]] : [],
            meta: { changes: 0 },
          };
        },
      };
      return stmt;
    },
    batch: async () => [],
  } as unknown as D1Database;
}

function createEnv(db: D1Database): Env {
  return {
    EDGEBASE_CONFIG: defineConfig({
      release: true,
      databases: {
        shared: {
          tables: {
            posts: {
              schema: {
                title: { type: 'string', required: true },
              },
            },
          },
        },
      },
    }),
    DB_D1_SHARED: db,
    DATABASE: {} as DurableObjectNamespace,
    AUTH: {} as DurableObjectNamespace,
    KV: {} as KVNamespace,
  } as unknown as Env;
}

describe('d1 live broadcast verification', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns single-record insert responses without waiting for emitDbLiveEvent', async () => {
    let resolveEmit!: () => void;
    const emitGate = new Promise<void>((resolve) => {
      resolveEmit = resolve;
    });
    const emitDbLiveEvent = vi.fn(() => emitGate);
    const emitDbLiveBatchEvent = vi.fn().mockResolvedValue(undefined);
    const sendToDatabaseLiveDO = vi.fn().mockResolvedValue(undefined);
    const executeDbTriggers = vi.fn().mockResolvedValue(undefined);

    vi.doMock('../lib/d1-schema-init.js', () => ({
      ensureD1Schema: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../lib/database-live-emitter.js', () => ({
      emitDbLiveEvent,
      emitDbLiveBatchEvent,
      sendToDatabaseLiveDO,
    }));
    vi.doMock('../lib/functions.js', () => ({
      executeDbTriggers,
    }));

    const { handleD1Request } = await import('../lib/d1-handler.js');

    const env = createEnv(createInsertMockD1({ id: 'post-1', title: 'hello world' }));
    const waitUntil = vi.fn();
    const ctx = buildInternalHandlerContext({
      env,
      executionCtx: { waitUntil } as unknown as ExecutionContext,
      request: new Request('http://internal/api/db/shared/tables/posts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Is-Service-Key': 'true',
        },
      }),
      body: {
        id: 'post-1',
        title: 'hello world',
      },
    });

    let settled = false;
    const responsePromise = handleD1Request(ctx, 'shared', 'posts', '/tables/posts').then((response) => {
      settled = true;
      return response;
    });

    await vi.waitFor(() => {
      expect(emitDbLiveEvent).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(settled).toBe(true);
    });

    const response = await responsePromise;
    const json = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(json).toMatchObject({ id: 'post-1', title: 'hello world' });
    expect(waitUntil).toHaveBeenCalled();

    resolveEmit();
  });

  it('sends small batches through a single background Promise.all instead of awaiting fan-out', async () => {
    let resolveFanOut!: () => void;
    const fanOutGate = new Promise<void>((resolve) => {
      resolveFanOut = resolve;
    });
    const emitDbLiveEvent = vi.fn(() => fanOutGate);
    const emitDbLiveBatchEvent = vi.fn().mockResolvedValue(undefined);
    const sendToDatabaseLiveDO = vi.fn().mockResolvedValue(undefined);

    vi.doMock('../lib/d1-schema-init.js', () => ({
      ensureD1Schema: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../lib/database-live-emitter.js', () => ({
      emitDbLiveEvent,
      emitDbLiveBatchEvent,
      sendToDatabaseLiveDO,
    }));
    vi.doMock('../lib/functions.js', () => ({
      executeDbTriggers: vi.fn().mockResolvedValue(undefined),
    }));

    const { handleD1Request } = await import('../lib/d1-handler.js');

    const rowsById = {
      'post-1': { id: 'post-1', title: 'post 1' },
      'post-2': { id: 'post-2', title: 'post 2' },
    };
    const env = createEnv(createBatchInsertMockD1(rowsById));
    const waitUntil = vi.fn();
    const ctx = buildInternalHandlerContext({
      env,
      executionCtx: { waitUntil } as unknown as ExecutionContext,
      request: new Request('http://internal/api/db/shared/tables/posts/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Is-Service-Key': 'true',
        },
      }),
      body: {
        inserts: Object.values(rowsById),
      },
    });

    let settled = false;
    const responsePromise = handleD1Request(ctx, 'shared', 'posts', '/tables/posts/batch').then((response) => {
      settled = true;
      return response;
    });

    await vi.waitFor(() => {
      expect(emitDbLiveEvent).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(settled).toBe(true);
    });

    const response = await responsePromise;
    const json = await response.json() as { inserted: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(json.inserted).toHaveLength(2);
    expect(emitDbLiveBatchEvent).not.toHaveBeenCalled();
    expect(waitUntil).toHaveBeenCalledTimes(1);

    resolveFanOut();
  });

  it('still sends 10+ change batches through waitUntil instead of awaiting the batch emitter', async () => {
    const emitDbLiveEvent = vi.fn().mockResolvedValue(undefined);
    const emitDbLiveBatchEvent = vi.fn(() => new Promise<void>(() => {}));
    const sendToDatabaseLiveDO = vi.fn().mockResolvedValue(undefined);

    vi.doMock('../lib/d1-schema-init.js', () => ({
      ensureD1Schema: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('../lib/database-live-emitter.js', () => ({
      emitDbLiveEvent,
      emitDbLiveBatchEvent,
      sendToDatabaseLiveDO,
    }));
    vi.doMock('../lib/functions.js', () => ({
      executeDbTriggers: vi.fn().mockResolvedValue(undefined),
    }));

    const { handleD1Request } = await import('../lib/d1-handler.js');

    const rowsById = Object.fromEntries(
      Array.from({ length: 10 }, (_value, index) => {
        const id = `post-${index + 1}`;
        return [id, { id, title: `post ${index + 1}` }];
      }),
    );
    const env = createEnv(createBatchInsertMockD1(rowsById));
    const waitUntil = vi.fn();
    const ctx = buildInternalHandlerContext({
      env,
      executionCtx: { waitUntil } as unknown as ExecutionContext,
      request: new Request('http://internal/api/db/shared/tables/posts/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Is-Service-Key': 'true',
        },
      }),
      body: {
        inserts: Object.values(rowsById),
      },
    });

    const response = await handleD1Request(ctx, 'shared', 'posts', '/tables/posts/batch');
    const json = await response.json() as { inserted: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(json.inserted).toHaveLength(10);
    expect(emitDbLiveBatchEvent).toHaveBeenCalledTimes(1);
    expect(emitDbLiveEvent).not.toHaveBeenCalled();
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});
