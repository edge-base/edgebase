import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { defineConfig } from '@edge-base/shared';
import { buildInternalHandlerContext } from '../lib/internal-request.js';
import { _resetD1SchemaCache } from '../lib/d1-schema-init.js';
import { setConfig } from '../lib/do-router.js';
import {
  buildListQuery,
  normalizeSQLiteBooleanQueryOptions,
  type QueryOptions,
} from '../lib/query-engine.js';
import type { Env } from '../types.js';

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

type SqliteD1Statement = D1PreparedStatement & { sql: string; params: unknown[] };

interface ProviderHarness {
  database: DatabaseSync;
  request(path: string, body?: Record<string, unknown>): Promise<Response>;
  close(): void;
}

const TABLE = {
  schema: {
    title: { type: 'string' as const },
    enabled: { type: 'boolean' as const },
    score: { type: 'number' as const },
  },
  fts: ['title'],
};

function sqliteD1(database: DatabaseSync): D1Database {
  const makeStatement = (sql: string, params: unknown[] = []): SqliteD1Statement => ({
    sql,
    params,
    bind(...next: unknown[]) {
      return makeStatement(sql, next);
    },
    async all() {
      const prepared = database.prepare(sql);
      if (/^\s*(?:SELECT|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
        const rows = prepared.all(...(params as never[])) as Record<string, unknown>[];
        return { success: true, results: rows, meta: { changes: 0 } };
      }
      const result = prepared.run(...(params as never[]));
      return { success: true, results: [], meta: { changes: Number(result.changes) } };
    },
    async run() {
      const result = database.prepare(sql).run(...(params as never[]));
      return { success: true, results: [], meta: { changes: Number(result.changes) } };
    },
    async first<T>() {
      return (database.prepare(sql).get(...(params as never[])) ?? null) as T | null;
    },
  }) as unknown as SqliteD1Statement;

  return {
    prepare: makeStatement,
    async batch(statements: D1PreparedStatement[]) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const raw of statements) {
          results.push(await (raw as SqliteD1Statement).all());
        }
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
}

function createSQLiteCtx(database: DatabaseSync) {
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
    waitUntil: vi.fn((promise: Promise<unknown>) => void promise.catch(() => {})),
  } as unknown as DurableObjectState;
}

function createDatabaseLiveNamespace() {
  return {
    idFromName: vi.fn(() => ({ toString: () => 'database-live-test' })),
    get: vi.fn(() => ({
      fetch: vi.fn(async () => new Response(null, { status: 204 })),
    })),
  } as unknown as DurableObjectNamespace;
}

function filterParam(filters: unknown[]): string {
  return encodeURIComponent(JSON.stringify(filters));
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json() as Record<string, unknown>;
  expect.soft(response.status, JSON.stringify(body)).toBe(200);
  return body;
}

async function createD1Harness(): Promise<ProviderHarness> {
  const database = new DatabaseSync(':memory:');
  const namespace = 'boolean_filters_d1';
  const config = defineConfig({
    release: true,
    databases: {
      [namespace]: {
        provider: 'd1',
        tables: { flags: TABLE },
      },
    },
  });
  const env = {
    EDGEBASE_CONFIG: config,
    DB_D1_BOOLEAN_FILTERS_D1: sqliteD1(database),
    DATABASE_LIVE: createDatabaseLiveNamespace(),
  } as unknown as Env;
  const { handleD1Request } = await import('../lib/d1-handler.js');

  const request = (path: string, body?: Record<string, unknown>) => {
    const method = body === undefined ? 'GET' : 'POST';
    const raw = new Request(`http://internal/api/db/${namespace}${path}`, {
      method,
      headers: { 'X-Is-Service-Key': 'true' },
    });
    const doPath = new URL(raw.url).pathname.slice(`/api/db/${namespace}`.length);
    return handleD1Request(
      buildInternalHandlerContext({ env, request: raw, body }),
      namespace,
      'flags',
      doPath,
    ).catch((error: unknown) => Response.json({
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    }, { status: 500 }));
  };

  expect((await request('/tables/flags?limit=1&includeTotal=0')).status).toBe(200);
  seedRows(database);
  return { database, request, close: () => database.close() };
}

async function createDoHarness(): Promise<ProviderHarness> {
  const database = new DatabaseSync(':memory:');
  const namespace = 'boolean_filters_do';
  const config = defineConfig({
    release: true,
    databases: {
      [namespace]: {
        provider: 'do',
        tables: { flags: TABLE },
      },
    },
  });
  setConfig(config);
  const { DatabaseDO } = await import('../durable-objects/database-do.js');
  const databaseDo = new DatabaseDO(
    createSQLiteCtx(database),
    {
      DATABASE_LIVE: createDatabaseLiveNamespace(),
      DATABASE: {} as DurableObjectNamespace,
      AUTH: {} as DurableObjectNamespace,
    } as never,
  );
  const request = (path: string, body?: Record<string, unknown>) => databaseDo.fetch(
    new Request(`http://do${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DO-Name': namespace,
        'X-EdgeBase-Internal': 'true',
        'X-Is-Service-Key': 'true',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

  expect((await request('/tables/flags?limit=1&includeTotal=0')).status).toBe(200);
  seedRows(database);
  return { database, request, close: () => database.close() };
}

function seedRows(database: DatabaseSync): void {
  const insert = database.prepare(
    'INSERT INTO "flags" ("id", "title", "enabled", "score") VALUES (?, ?, ?, ?)',
  );
  insert.run('false-row', 'alpha disabled', 0, 10);
  insert.run('true-row', 'alpha enabled', 1, 20);
}

async function assertBooleanFilterContract(harness: ProviderHarness): Promise<void> {
  const listCases = [
    { query: `filter=${filterParam([['enabled', '==', false]])}`, ids: ['false-row'] },
    { query: `filter=${filterParam([['enabled', '==', true]])}`, ids: ['true-row'] },
    { query: `filter=${filterParam([['enabled', '!=', false]])}`, ids: ['true-row'] },
    { query: `filter=${filterParam([['enabled', 'in', [false]]])}`, ids: ['false-row'] },
    { query: `filter=${filterParam([['enabled', 'not in', [false]]])}`, ids: ['true-row'] },
    {
      query: `orFilter=${filterParam([['enabled', '==', false], ['score', '==', 20]])}`,
      ids: ['false-row', 'true-row'],
    },
  ];

  for (const { query, ids } of listCases) {
    const body = await responseJson(await harness.request(
      `/tables/flags?${query}&sort=id:asc&limit=10&includeTotal=0`,
    ));
    const items = Array.isArray(body.items) ? body.items as Array<{ id: string }> : [];
    expect.soft(items.map(({ id }) => id)).toEqual(ids);
  }

  const projected = await responseJson(await harness.request(
    `/tables/flags?filter=${filterParam([['enabled', '==', false]])}`
      + '&fields=id,enabled&sort=score:desc&limit=1&includeTotal=0',
  ));
  expect.soft(projected.items).toEqual([{ id: 'false-row', enabled: false }]);

  const count = await responseJson(await harness.request(
    `/tables/flags/count?filter=${filterParam([['enabled', '==', false]])}`,
  ));
  expect.soft(count.total).toBe(1);

  const search = await responseJson(await harness.request(
    `/tables/flags/search?search=alpha&filter=${filterParam([['enabled', '==', false]])}`
      + '&sort=id:asc&limit=10',
  ));
  const searchItems = Array.isArray(search.items) ? search.items as Array<{ id: string }> : [];
  expect.soft(searchItems.map(({ id }) => id)).toEqual(['false-row']);

  const mutation = await responseJson(await harness.request('/tables/flags/batch-by-filter', {
    action: 'update',
    filter: [['enabled', '==', false]],
    update: { score: 99 },
    limit: 10,
  }));
  expect.soft(mutation).toMatchObject({ processed: 1, succeeded: 1 });
  expect.soft(harness.database.prepare(
    'SELECT "score" FROM "flags" WHERE "id" = ?',
  ).get('false-row')).toMatchObject({ score: 99 });
  expect.soft(harness.database.prepare(
    'SELECT "score" FROM "flags" WHERE "id" = ?',
  ).get('true-row')).toMatchObject({ score: 20 });
}

describe('SQLite boolean filter provider parity', () => {
  afterEach(() => {
    _resetD1SchemaCache();
    setConfig({});
  });

  it('normalizes schema booleans for every D1 filter consumer', async () => {
    const harness = await createD1Harness();
    try {
      await assertBooleanFilterContract(harness);
    } finally {
      harness.close();
    }
  });

  it('normalizes schema booleans for every Durable Object filter consumer', async () => {
    const harness = await createDoHarness();
    try {
      await assertBooleanFilterContract(harness);
    } finally {
      harness.close();
    }
  });
});

describe('SQLite boolean filter normalization boundary', () => {
  it('copies boolean scalar/set/OR values without mutating or coercing numeric fields', () => {
    const options: QueryOptions = {
      filters: [
        ['enabled', '==', false],
        ['enabled', 'in', [true, false]],
        ['score', 'in', [0, 1]],
      ],
      orFilters: [
        ['enabled', '!=', true],
        ['unknown', '==', false],
      ],
      pagination: { limit: 7 },
    };

    const normalized = normalizeSQLiteBooleanQueryOptions(options, TABLE.schema);

    expect(normalized).not.toBe(options);
    expect(normalized).toEqual({
      filters: [
        ['enabled', '==', 0],
        ['enabled', 'in', [1, 0]],
        ['score', 'in', [0, 1]],
      ],
      orFilters: [
        ['enabled', '!=', 1],
        ['unknown', '==', false],
      ],
      pagination: { limit: 7 },
    });
    expect(options.filters?.[0]?.[2]).toBe(false);
    expect(options.filters?.[1]?.[2]).toEqual([true, false]);
    expect(options.filters?.[2]?.[2]).toEqual([0, 1]);
  });

  it('keeps PostgreSQL native boolean parameters unchanged', () => {
    const query = buildListQuery('flags', {
      filters: [['enabled', '==', false]],
      orFilters: [['enabled', '==', true]],
      pagination: { limit: 5 },
    }, 'postgres');

    expect(query.params).toEqual([false, true, 5, 0]);
    expect(query.countParams).toEqual([false, true]);
  });
});
