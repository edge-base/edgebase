import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { defineConfig } from '@edge-base/shared';
import { buildInternalHandlerContext } from '../lib/internal-request.js';
import { _resetD1SchemaCache } from '../lib/d1-schema-init.js';
import { setConfig } from '../lib/do-router.js';
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
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState;
}

function tableExists(database: DatabaseSync, tableName: string): boolean {
  return Boolean(database.prepare(
    'SELECT 1 FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1',
  ).get('table', tableName));
}

function assertExactBoundedBody(body: string, maxResponseBytes: number) {
  const bytes = new TextEncoder().encode(body).byteLength;
  const parsed = JSON.parse(body) as { returnedBytes: number };
  expect(parsed.returnedBytes).toBe(bytes);
  expect(bytes).toBeLessThanOrEqual(maxResponseBytes);
  return parsed as Record<string, unknown>;
}

async function fullDrain(
  requestPage: (responseAfter?: string) => Promise<Response>,
  oversizedRecordId: string,
) {
  const delivered: string[] = [];
  const isolated: string[] = [];
  let cursor: string | undefined;

  for (let pass = 0; pass < 6; pass += 1) {
    const response = await requestPage(cursor);
    expect(response.status).toBe(200);
    const body = await response.text();
    const json = assertExactBoundedBody(body, 512) as {
      items: Array<{ id: string }>;
      cursor: string | null;
      hasMore: boolean;
      oversizedItem?: boolean;
      cursorExpiresAt?: string;
    };
    delivered.push(...json.items.map(({ id }) => id));
    expect(json.cursorExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    if (json.oversizedItem) isolated.push(oversizedRecordId);
    if (!json.cursor || !json.hasMore) break;
    cursor = json.cursor;
  }

  expect(delivered).toEqual(['a', 'c']);
  expect(isolated).toEqual([oversizedRecordId]);
}

describe('bounded response provider parity', () => {
  afterEach(() => {
    _resetD1SchemaCache();
    setConfig({});
  });

  it('D1 keeps unbounded reads write-free and full-drains a legacy oversized id by opaque keyset', async () => {
    const database = new DatabaseSync(':memory:');
    const d1 = sqliteD1(database);
    const namespace = 'bounded_d1';
    const config = defineConfig({
      release: true,
      databases: {
        [namespace]: {
          provider: 'd1',
          tables: {
            docs: { schema: { title: { type: 'string' } } },
          },
        },
      },
    });
    const env = {
      EDGEBASE_CONFIG: config,
      DB_D1_BOUNDED_D1: d1,
    } as unknown as Env;
    const { handleD1Request } = await import('../lib/d1-handler.js');

    const call = (query: string) => handleD1Request(
      buildInternalHandlerContext({
        env,
        request: new Request(`http://internal/api/db/${namespace}/tables/docs?${query}`, {
          headers: { 'X-Is-Service-Key': 'true' },
        }),
      }),
      namespace,
      'docs',
      '/tables/docs',
    );

    const unbounded = await call('limit=3&includeTotal=0');
    expect(unbounded.status).toBe(200);
    expect(tableExists(database, '_edgebase_response_cursors')).toBe(false);

    const oversizedId = `b${'x'.repeat(20_000)}`;
    const insert = database.prepare(
      'INSERT INTO "docs" ("id", "title") VALUES (?, ?)',
    );
    insert.run('a', 'small');
    insert.run(oversizedId, 'legacy oversized id');
    insert.run('c', 'small');

    await fullDrain(
      (responseAfter) => call([
        'limit=3',
        'includeTotal=0',
        'maxResponseBytes=512',
        ...(responseAfter ? [`responseAfter=${encodeURIComponent(responseAfter)}`] : []),
      ].join('&')),
      oversizedId,
    );

    expect(tableExists(database, '_edgebase_response_cursors')).toBe(true);
    const cursorRows = database.prepare(
      'SELECT "token", "table_name", "record_id" FROM "_edgebase_response_cursors"',
    ).all() as Array<Record<string, unknown>>;
    expect(cursorRows.length).toBeGreaterThanOrEqual(2);
    expect(cursorRows.every(({ token }) => !String(token).includes(oversizedId))).toBe(true);
  });

  it('Durable Object measures enriched Unicode after hooks and lazily owns cursor state', async () => {
    const database = new DatabaseSync(':memory:');
    const config = defineConfig({
      release: true,
      databases: {
        app: {
          provider: 'do',
          tables: {
            docs: {
              schema: { title: { type: 'string' } },
              handlers: {
                hooks: {
                  onEnrich: async () => ({ label: '한글🙂' }),
                },
              },
            },
          },
        },
      },
    });
    setConfig(config);
    const { DatabaseDO } = await import('../durable-objects/database-do.js');
    const databaseDo = new DatabaseDO(
      createSQLiteCtx(database),
      {
        DATABASE_LIVE: {} as DurableObjectNamespace,
        DATABASE: {} as DurableObjectNamespace,
        AUTH: {} as DurableObjectNamespace,
      } as never,
    );
    const call = (query: string) => databaseDo.fetch(new Request(
      `http://do/tables/docs?${query}`,
      { headers: { 'X-DO-Name': 'app', 'X-EdgeBase-Internal': 'true' } },
    ));

    expect((await call('limit=2&includeTotal=0')).status).toBe(200);
    expect(tableExists(database, '_edgebase_response_cursors')).toBe(false);
    database.prepare('INSERT INTO "docs" ("id", "title") VALUES (?, ?)').run('a', 'small');

    const response = await call('limit=2&includeTotal=0&maxResponseBytes=512');
    const body = await response.text();
    const json = assertExactBoundedBody(body, 512) as {
      items: Array<Record<string, unknown>>;
      cursor: string;
    };
    expect(json.items).toEqual([expect.objectContaining({ id: 'a', label: '한글🙂' })]);
    expect(json.cursor).not.toBe('a');
    expect(json.cursor).toMatch(/^~edgebase-response-cursor-v1\.[A-Za-z0-9_-]{32}$/);
    expect(tableExists(database, '_edgebase_response_cursors')).toBe(true);
  });
});
