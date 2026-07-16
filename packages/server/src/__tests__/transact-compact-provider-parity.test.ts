import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { defineConfig } from '@edge-base/shared';
import { buildInternalHandlerContext } from '../lib/internal-request.js';
import { _resetD1SchemaCache } from '../lib/d1-schema-init.js';
import { setConfig } from '../lib/do-router.js';
import { clearFunctionRegistry } from '../lib/functions.js';
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

function sqliteD1(database: DatabaseSync, executedSql: string[]): D1Database {
  const makeStatement = (sql: string, params: unknown[] = []): SqliteD1Statement => ({
    sql,
    params,
    bind(...next: unknown[]) {
      return makeStatement(sql, next);
    },
    async all() {
      executedSql.push(sql);
      const prepared = database.prepare(sql);
      if (/^\s*(?:SELECT|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
        const rows = prepared.all(...(params as never[])) as Record<string, unknown>[];
        return { success: true, results: rows, meta: { changes: 0 } };
      }
      const result = prepared.run(...(params as never[]));
      return { success: true, results: [], meta: { changes: Number(result.changes) } };
    },
    async run() {
      executedSql.push(sql);
      const result = database.prepare(sql).run(...(params as never[]));
      return { success: true, results: [], meta: { changes: Number(result.changes) } };
    },
    async first<T>() {
      executedSql.push(sql);
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

function createSQLiteCtx(database: DatabaseSync, executedSql: string[]) {
  return {
    storage: {
      sql: {
        exec(query: string, ...params: unknown[]) {
          executedSql.push(query);
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

const HUGE_PAYLOAD = '한'.repeat(750_000);

function expectCompactBody(text: string, operationCount: number) {
  expect(text).toBe(JSON.stringify({ committed: true, operationCount }));
  expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(39);
}

function expectNoFullRowMaterialization(executedSql: string[]) {
  expect(executedSql.some((sql) => /\bSELECT\s+\*/i.test(sql))).toBe(false);
  expect(executedSql.some((sql) => /\bRETURNING\b/i.test(sql))).toBe(false);
}

describe('compact transact provider parity', () => {
  afterEach(() => {
    _resetD1SchemaCache();
    clearFunctionRegistry();
    setConfig({});
  });

  it('D1 commits huge mixed operations without post-commit row reads and keeps full as the default', async () => {
    const database = new DatabaseSync(':memory:');
    const executedSql: string[] = [];
    const namespace = 'compact_d1';
    const config = defineConfig({
      release: true,
      databases: {
        [namespace]: {
          provider: 'd1',
          tables: {
            docs: {
              schema: {
                title: { type: 'string' },
                payload: { type: 'string' },
              },
              access: {
                read: () => true,
                insert: () => true,
                update: () => true,
                delete: () => true,
              },
            },
          },
        },
      },
    });
    const env = {
      EDGEBASE_CONFIG: config,
      DB_D1_COMPACT_D1: sqliteD1(database, executedSql),
    } as unknown as Env;
    const { handleD1Request } = await import('../lib/d1-handler.js');
    const call = (body: Record<string, unknown>, withServiceKey = true) => {
      const context = buildInternalHandlerContext({
        env,
        request: new Request(`http://internal/api/db/${namespace}/transact`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(withServiceKey ? { 'X-Is-Service-Key': 'true' } : {}),
          },
        }),
        body,
      });
      if (!withServiceKey) {
        (context as unknown as { get(key: string): unknown }).get = (key: string) => {
          if (key === 'auth') return null;
          if (key === 'isServiceKey' || key === 'isInternalRequest') return false;
          return undefined;
        };
      }
      return handleD1Request(context, namespace, '', '/transact');
    };

    const initialized = await handleD1Request(
      buildInternalHandlerContext({
        env,
        request: new Request(`http://internal/api/db/${namespace}/tables/docs`, {
          headers: { 'X-Is-Service-Key': 'true' },
        }),
      }),
      namespace,
      'docs',
      '/tables/docs',
    );
    expect(initialized.status).toBe(200);
    database.prepare('INSERT INTO "docs" ("id", "title", "payload") VALUES (?, ?, ?)')
      .run('source', 'before', HUGE_PAYLOAD);
    database.prepare('INSERT INTO "docs" ("id", "title", "payload") VALUES (?, ?, ?)')
      .run('delete-me', 'delete', HUGE_PAYLOAD);

    executedSql.length = 0;
    const compact = await call({
      resultMode: 'compact',
      operations: [
        { table: 'docs', op: 'expect', id: 'source', exists: true },
        { table: 'docs', op: 'insert', data: { id: 'inserted', title: 'new', payload: HUGE_PAYLOAD } },
        { table: 'docs', op: 'update', id: 'source', data: { title: 'after' } },
        { table: 'docs', op: 'delete', id: 'delete-me' },
      ],
    });
    expect(compact.status).toBe(200);
    expectCompactBody(await compact.text(), 4);
    expectNoFullRowMaterialization(executedSql);
    expect(database.prepare('SELECT "title" FROM "docs" WHERE "id" = ?').get('source'))
      .toEqual({ title: 'after' });
    expect(database.prepare('SELECT 1 AS "found" FROM "docs" WHERE "id" = ?').get('inserted'))
      .toEqual({ found: 1 });
    expect(database.prepare('SELECT 1 FROM "docs" WHERE "id" = ?').get('delete-me'))
      .toBeUndefined();

    executedSql.length = 0;
    const full = await call({
      operations: [{ table: 'docs', op: 'update', id: 'source', data: { title: 'full' } }],
    });
    const fullText = await full.text();
    expect(full.status).toBe(200);
    expect(new TextEncoder().encode(fullText).byteLength).toBeGreaterThan(2_000_000);
    expect(executedSql.some((sql) => /\bSELECT\s+\*/i.test(sql))).toBe(true);

    executedSql.length = 0;
    const invalid = await call({
      resultMode: 'verbose',
      operations: [{ table: 'docs', op: 'update', id: 'source', data: { title: 'invalid' } }],
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ slug: 'invalid-transact-result-mode' });
    expect(executedSql.some((sql) => /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
    expect(database.prepare('SELECT "title" FROM "docs" WHERE "id" = ?').get('source'))
      .toEqual({ title: 'full' });

    executedSql.length = 0;
    const authorized = await call({
      resultMode: 'compact',
      operations: [
        { table: 'docs', op: 'expect', id: 'source', exists: true },
        { table: 'docs', op: 'update', id: 'source', data: { title: 'authorized' } },
        { table: 'docs', op: 'delete', id: 'inserted' },
      ],
    }, false);
    expect(authorized.status).toBe(200);
    expectCompactBody(await authorized.text(), 3);
    expect(executedSql.filter((sql) => /\bSELECT\s+\*/i.test(sql))).toHaveLength(3);
    expect(executedSql.some((sql) => /\bRETURNING\b/i.test(sql))).toBe(false);
    database.close();
  });

  it('D1 batches compact Database Live post-fetches in bounded chunks and drains every row', async () => {
    const database = new DatabaseSync(':memory:');
    const executedSql: string[] = [];
    const background: Promise<unknown>[] = [];
    const liveFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const namespace = 'compact_live';
    const config = defineConfig({
      release: true,
      databases: {
        [namespace]: {
          provider: 'd1',
          tables: { docs: { schema: { title: { type: 'string' } } } },
        },
      },
    });
    const env = {
      EDGEBASE_CONFIG: config,
      DB_D1_COMPACT_LIVE: sqliteD1(database, executedSql),
      DATABASE_LIVE: {
        idFromName: vi.fn((name: string) => name),
        get: vi.fn(() => ({ fetch: liveFetch })),
      } as unknown as DurableObjectNamespace,
    } as unknown as Env;
    const executionCtx = {
      waitUntil(promise: Promise<unknown>) {
        background.push(promise);
      },
    } as unknown as ExecutionContext;
    const { handleD1Request } = await import('../lib/d1-handler.js');
    const initialized = await handleD1Request(
      buildInternalHandlerContext({
        env,
        executionCtx,
        request: new Request(`http://internal/api/db/${namespace}/tables/docs`, {
          headers: { 'X-Is-Service-Key': 'true' },
        }),
      }),
      namespace,
      'docs',
      '/tables/docs',
    );
    expect(initialized.status).toBe(200);

    executedSql.length = 0;
    const operations = Array.from({ length: 205 }, (_, index) => ({
      table: 'docs',
      op: 'insert',
      data: { id: `row-${String(index).padStart(3, '0')}`, title: `Row ${index}` },
    }));
    const compact = await handleD1Request(
      buildInternalHandlerContext({
        env,
        executionCtx,
        request: new Request(`http://internal/api/db/${namespace}/transact`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Is-Service-Key': 'true' },
        }),
        body: { operations, resultMode: 'compact' },
      }),
      namespace,
      '',
      '/transact',
    );
    expect(compact.status).toBe(200);
    expectCompactBody(await compact.text(), 205);
    await Promise.all(background);

    const postFetches = executedSql.filter((sql) => (
      /^SELECT \* FROM "docs" WHERE "id" IN \(/.test(sql)
    ));
    expect(postFetches).toHaveLength(3);
    expect(postFetches.map((sql) => (sql.match(/\?/g) ?? []).length)).toEqual([100, 100, 5]);
    expect(database.prepare('SELECT COUNT(*) AS "total" FROM "docs"').get())
      .toEqual({ total: 205 });
    expect(liveFetch).toHaveBeenCalledTimes(1);
    const [, init] = liveFetch.mock.calls[0] as [string, RequestInit];
    const event = JSON.parse(String(init.body)) as { changes: unknown[]; total: number };
    expect(event.total).toBe(205);
    expect(event.changes).toHaveLength(205);
    database.close();
  });

  it('Durable Object commits huge mixed operations without unconsumed SELECT * rows', async () => {
    const database = new DatabaseSync(':memory:');
    const executedSql: string[] = [];
    const config = defineConfig({
      release: true,
      databases: {
        compact_do: {
          provider: 'do',
          tables: {
            docs: {
              schema: {
                title: { type: 'string' },
                payload: { type: 'string' },
              },
              access: {
                read: () => true,
                insert: () => true,
                update: () => true,
                delete: () => true,
              },
            },
          },
        },
      },
    });
    setConfig(config);
    const { DatabaseDO } = await import('../durable-objects/database-do.js');
    const databaseDo = new DatabaseDO(
      createSQLiteCtx(database, executedSql),
      {
        DATABASE_LIVE: undefined,
        DATABASE: {} as DurableObjectNamespace,
        AUTH: {} as DurableObjectNamespace,
      } as never,
    );
    const call = (body: Record<string, unknown>, trusted = true) => databaseDo.fetch(new Request(
      trusted ? 'http://do/transact' : 'http://external/transact',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-DO-Name': 'compact_do',
          ...(trusted ? { 'X-EdgeBase-Internal': 'true' } : {}),
        },
        body: JSON.stringify(body),
      },
    ));
    const initialized = await databaseDo.fetch(new Request(
      'http://do/tables/docs?limit=1',
      { headers: { 'X-DO-Name': 'compact_do', 'X-EdgeBase-Internal': 'true' } },
    ));
    expect(initialized.status).toBe(200);
    database.prepare('INSERT INTO "docs" ("id", "title", "payload") VALUES (?, ?, ?)')
      .run('source', 'before', HUGE_PAYLOAD);
    database.prepare('INSERT INTO "docs" ("id", "title", "payload") VALUES (?, ?, ?)')
      .run('delete-me', 'delete', HUGE_PAYLOAD);

    executedSql.length = 0;
    const compact = await call({
      resultMode: 'compact',
      operations: [
        { table: 'docs', op: 'expect', id: 'source', exists: true },
        { table: 'docs', op: 'insert', data: { id: 'inserted', title: 'new', payload: HUGE_PAYLOAD } },
        { table: 'docs', op: 'update', id: 'source', data: { title: 'after' } },
        { table: 'docs', op: 'delete', id: 'delete-me' },
      ],
    });
    expect(compact.status).toBe(200);
    expectCompactBody(await compact.text(), 4);
    expectNoFullRowMaterialization(executedSql);
    expect(database.prepare('SELECT "title" FROM "docs" WHERE "id" = ?').get('source'))
      .toEqual({ title: 'after' });
    expect(database.prepare('SELECT 1 AS "found" FROM "docs" WHERE "id" = ?').get('inserted'))
      .toEqual({ found: 1 });
    expect(database.prepare('SELECT 1 FROM "docs" WHERE "id" = ?').get('delete-me'))
      .toBeUndefined();

    executedSql.length = 0;
    const full = await call({
      operations: [{ table: 'docs', op: 'update', id: 'source', data: { title: 'full' } }],
    });
    const fullText = await full.text();
    expect(full.status).toBe(200);
    expect(new TextEncoder().encode(fullText).byteLength).toBeGreaterThan(2_000_000);
    expect(executedSql.some((sql) => /\bSELECT\s+\*/i.test(sql))).toBe(true);

    executedSql.length = 0;
    const invalid = await call({
      resultMode: 'verbose',
      operations: [{ table: 'docs', op: 'update', id: 'source', data: { title: 'invalid' } }],
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ slug: 'invalid-transact-result-mode' });
    expect(executedSql.some((sql) => /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
    expect(database.prepare('SELECT "title" FROM "docs" WHERE "id" = ?').get('source'))
      .toEqual({ title: 'full' });

    executedSql.length = 0;
    const authorized = await call({
      resultMode: 'compact',
      operations: [
        { table: 'docs', op: 'expect', id: 'source', exists: true },
        { table: 'docs', op: 'update', id: 'source', data: { title: 'authorized' } },
        { table: 'docs', op: 'delete', id: 'inserted' },
      ],
    }, false);
    expect(authorized.status).toBe(200);
    expectCompactBody(await authorized.text(), 3);
    expect(executedSql.filter((sql) => /\bSELECT\s+\*/i.test(sql))).toHaveLength(3);
    expect(executedSql.some((sql) => /\bRETURNING\b/i.test(sql))).toBe(false);
    database.close();
  });
});
