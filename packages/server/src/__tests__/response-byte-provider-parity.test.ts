import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { defineConfig, type TableConfig } from '@edge-base/shared';
import { buildInternalHandlerContext } from '../lib/internal-request.js';
import { _resetD1SchemaCache } from '../lib/d1-schema-init.js';
import { setConfig } from '../lib/do-router.js';
import {
  computeSchemaHashSync,
  computeSQLiteFtsSignature,
  generateFTS5DDL,
  generateFTS5Triggers,
} from '../lib/schema.js';
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

function sqliteD1(database: DatabaseSync, executedSQL: string[] = []): D1Database {
  const makeStatement = (sql: string, params: unknown[] = []): SqliteD1Statement => ({
    sql,
    params,
    bind(...next: unknown[]) {
      return makeStatement(sql, next);
    },
    async all() {
      executedSQL.push(sql);
      const prepared = database.prepare(sql);
      if (/^\s*(?:SELECT|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
        const rows = prepared.all(...(params as never[])) as Record<string, unknown>[];
        return { success: true, results: rows, meta: { changes: 0 } };
      }
      const result = prepared.run(...(params as never[]));
      return { success: true, results: [], meta: { changes: Number(result.changes) } };
    },
    async run() {
      executedSQL.push(sql);
      const result = database.prepare(sql).run(...(params as never[]));
      return { success: true, results: [], meta: { changes: Number(result.changes) } };
    },
    async first<T>() {
      executedSQL.push(sql);
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

function createSQLiteCtx(database: DatabaseSync, executedSQL: string[] = []) {
  return {
    storage: {
      sql: {
        exec(query: string, ...params: unknown[]) {
          executedSQL.push(query);
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

function exactTableCountQueries(executedSQL: string[], tableName: string): string[] {
  const escapedName = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const countPattern = new RegExp(
    `^\\s*SELECT COUNT\\(\\*\\) as total FROM "${escapedName}"(?:\\s|$)`,
    'i',
  );
  return executedSQL.filter((sql) => countPattern.test(sql));
}

function exactCountQueries(executedSQL: string[]): string[] {
  return executedSQL.filter((sql) => /^\s*SELECT COUNT\(\*\) as total\b/i.test(sql));
}

const driftedBlocksConfig: TableConfig = {
  schema: {
    plainText: { type: 'string' },
    content: { type: 'json' },
  },
  fts: ['plainText', 'content'],
};

function seedLegacyBlocksFts(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE "_meta" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL);
    CREATE TABLE "blocks" (
      "id" TEXT PRIMARY KEY,
      "createdAt" TEXT,
      "updatedAt" TEXT,
      "plainText" TEXT,
      "content" TEXT
    );
  `);
  database.exec(generateFTS5DDL('blocks', ['plainText']));
  for (const ddl of generateFTS5Triggers('blocks', ['plainText'])) database.exec(ddl);
  database.prepare(
    'INSERT INTO "blocks" ("id", "plainText", "content") VALUES (?, ?, ?)',
  ).run('legacy-block', 'legacy heading', JSON.stringify({ text: 'content needle' }));
  const insertMeta = database.prepare(
    'INSERT INTO "_meta" ("key", "value") VALUES (?, ?)',
  );
  insertMeta.run('schemaHash:blocks', computeSchemaHashSync(driftedBlocksConfig));
  insertMeta.run('fts_signature:blocks', computeSQLiteFtsSignature(['plainText']));
}

function expectRebuiltBlocksFts(database: DatabaseSync): void {
  expect(database.prepare('PRAGMA table_info("blocks_fts")').all().map((row) => row.name))
    .toEqual(['plainText', 'content']);
  expect(database.prepare(
    'SELECT rowid FROM "blocks_fts" WHERE "blocks_fts" MATCH ?',
  ).all('needle')).toHaveLength(1);

  database.prepare(
    'INSERT INTO "blocks" ("id", "plainText", "content") VALUES (?, ?, ?)',
  ).run('fresh-block', 'fresh heading', JSON.stringify({ text: 'trigger token' }));
  expect(database.prepare(
    'SELECT rowid FROM "blocks_fts" WHERE "blocks_fts" MATCH ?',
  ).all('token')).toHaveLength(1);

  database.prepare('UPDATE "blocks" SET "content" = ? WHERE "id" = ?')
    .run(JSON.stringify({ text: 'updated marker' }), 'fresh-block');
  expect(database.prepare(
    'SELECT rowid FROM "blocks_fts" WHERE "blocks_fts" MATCH ?',
  ).all('updated')).toHaveLength(1);
  expect(database.prepare(
    'SELECT "value" FROM "_meta" WHERE "key" = ?',
  ).get('fts_signature:blocks')).toEqual({
    value: computeSQLiteFtsSignature(['plainText', 'content']),
  });
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
    const executedSQL: string[] = [];
    const d1 = sqliteD1(database, executedSQL);
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

    expect((await call('limit=0&includeTotal=0')).status).toBe(200);
    executedSQL.length = 0;

    const explicitTotal = await call('limit=3&includeTotal=true');
    expect(explicitTotal.status).toBe(200);
    expect((await explicitTotal.json() as { total: number | null }).total).toBe(0);
    expect(exactTableCountQueries(executedSQL, 'docs')).toHaveLength(1);

    executedSQL.length = 0;
    const defaultTotal = await call('limit=3');
    expect(defaultTotal.status).toBe(200);
    expect((await defaultTotal.json() as { total: number | null }).total).toBeNull();
    expect(exactTableCountQueries(executedSQL, 'docs')).toHaveLength(0);
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
    const executedSQL: string[] = [];
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
      createSQLiteCtx(database, executedSQL),
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

    expect((await call('limit=0&includeTotal=0')).status).toBe(200);
    executedSQL.length = 0;

    const explicitTotal = await call('limit=2&includeTotal=true');
    expect(explicitTotal.status).toBe(200);
    expect((await explicitTotal.json() as { total: number | null }).total).toBe(0);
    expect(exactTableCountQueries(executedSQL, 'docs')).toHaveLength(1);

    executedSQL.length = 0;
    const defaultTotal = await call('limit=2');
    expect(defaultTotal.status).toBe(200);
    expect((await defaultTotal.json() as { total: number | null }).total).toBeNull();
    expect(exactTableCountQueries(executedSQL, 'docs')).toHaveLength(0);
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

  it('Durable Object searches schema text fields directly when FTS is not configured', async () => {
    const database = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];
    setConfig(defineConfig({
      release: true,
      databases: {
        app: {
          provider: 'do',
          tables: {
            docs: { schema: { title: { type: 'string' }, note: { type: 'text' } } },
          },
        },
      },
    }));
    const { DatabaseDO } = await import('../durable-objects/database-do.js');
    const databaseDo = new DatabaseDO(
      createSQLiteCtx(database, executedSQL),
      {
        DATABASE_LIVE: {} as DurableObjectNamespace,
        DATABASE: {} as DurableObjectNamespace,
        AUTH: {} as DurableObjectNamespace,
      } as never,
    );
    const call = (path: string) => databaseDo.fetch(new Request(
      `http://do/tables/docs${path}`,
      { headers: { 'X-DO-Name': 'app', 'X-EdgeBase-Internal': 'true' } },
    ));

    expect((await call('?limit=0&includeTotal=0')).status).toBe(200);
    database.prepare(
      'INSERT INTO "docs" ("id", "title", "note") VALUES (?, ?, ?)',
    ).run('row-1', 'schema needle', 'secondary');
    executedSQL.length = 0;

    const response = await call('/search?search=needle&includeTotal=true');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [expect.objectContaining({ id: 'row-1', title: 'schema needle' })],
      total: 1,
    });
    expect(executedSQL.some((sql) => sql.includes('"docs_fts"'))).toBe(false);
    expect(executedSQL.some((sql) => /\binstr\s*\(/i.test(sql))).toBe(true);
  });

  it('D1 searches schema text fields directly when FTS is not configured', async () => {
    const database = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];
    const d1 = sqliteD1(database, executedSQL);
    const namespace = 'unconfigured_search_d1';
    const config = defineConfig({
      release: true,
      databases: {
        [namespace]: {
          provider: 'd1',
          tables: {
            docs: { schema: { title: { type: 'string' }, note: { type: 'text' } } },
          },
        },
      },
    });
    const env = {
      EDGEBASE_CONFIG: config,
      DB_D1_UNCONFIGURED_SEARCH_D1: d1,
    } as unknown as Env;
    const { handleD1Request } = await import('../lib/d1-handler.js');
    const call = (path: string) => handleD1Request(
      buildInternalHandlerContext({
        env,
        request: new Request(
          `http://internal/api/db/${namespace}/tables/docs${path}`,
          { headers: { 'X-Is-Service-Key': 'true' } },
        ),
      }),
      namespace,
      'docs',
      `/tables/docs${path.split('?')[0]}`,
    );

    expect((await call('?limit=0&includeTotal=0')).status).toBe(200);
    database.prepare(
      'INSERT INTO "docs" ("id", "title", "note") VALUES (?, ?, ?)',
    ).run('row-1', 'schema needle', 'secondary');
    executedSQL.length = 0;

    const response = await call('/search?search=needle&includeTotal=true');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [expect.objectContaining({ id: 'row-1', title: 'schema needle' })],
      total: 1,
    });
    expect(executedSQL.some((sql) => sql.includes('"docs_fts"'))).toBe(false);
    expect(executedSQL.some((sql) => /\binstr\s*\(/i.test(sql))).toBe(true);
  });

  it('Durable Object skips long no-match scans but preserves one- and two-codepoint FTS fallback', async () => {
    const database = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];
    setConfig(defineConfig({
      release: true,
      databases: {
        app: {
          provider: 'do',
          tables: {
            docs: {
              schema: { title: { type: 'string' } },
              fts: ['title'],
            },
          },
        },
      },
    }));
    const { DatabaseDO } = await import('../durable-objects/database-do.js');
    const databaseDo = new DatabaseDO(
      createSQLiteCtx(database, executedSQL),
      {
        DATABASE_LIVE: {} as DurableObjectNamespace,
        DATABASE: {} as DurableObjectNamespace,
        AUTH: {} as DurableObjectNamespace,
      } as never,
    );
    const call = (search: string, query = 'includeTotal=true') => databaseDo.fetch(new Request(
      `http://do/tables/docs/search?search=${encodeURIComponent(search)}&${query}`,
      { headers: { 'X-DO-Name': 'app', 'X-EdgeBase-Internal': 'true' } },
    ));

    expect((await databaseDo.fetch(new Request(
      'http://do/tables/docs?limit=0&includeTotal=0',
      { headers: { 'X-DO-Name': 'app', 'X-EdgeBase-Internal': 'true' } },
    ))).status).toBe(200);
    const insert = database.prepare('INSERT INTO "docs" ("id", "title") VALUES (?, ?)');
    insert.run('fts-row', 'indexed alpha');
    insert.run('short-row', '한지 short fallback');
    insert.run('page-a', 'paged candidate');
    insert.run('page-b', 'paged candidate');
    executedSQL.length = 0;

    const indexed = await call('alpha');
    expect(indexed.status).toBe(200);
    expect(await indexed.json()).toMatchObject({
      items: [expect.objectContaining({ id: 'fts-row' })],
      total: 1,
    });
    expect(executedSQL.some((sql) => sql.includes('"docs_fts"'))).toBe(true);
    expect(executedSQL.some((sql) => /\binstr\s*\(/i.test(sql))).toBe(false);
    expect(exactCountQueries(executedSQL)).toHaveLength(1);

    const fullPage = await call('paged', 'limit=1&includeTotal=false&sort=id:asc');
    expect(await fullPage.json()).toMatchObject({
      items: [expect.objectContaining({ id: 'page-a' })],
      total: null,
      hasMore: true,
    });
    const shortPage = await call('alpha', 'limit=2&includeTotal=false&sort=id:asc');
    expect(await shortPage.json()).toMatchObject({
      items: [expect.objectContaining({ id: 'fts-row' })],
      total: null,
      hasMore: false,
    });

    for (const shortTerm of ['한', '한지']) {
      expect([...shortTerm]).toHaveLength(shortTerm === '한' ? 1 : 2);
      executedSQL.length = 0;

      const fallback = await call(shortTerm);
      expect(fallback.status).toBe(200);
      expect(await fallback.json()).toMatchObject({
        items: [expect.objectContaining({ id: 'short-row' })],
        total: 1,
      });
      expect(executedSQL.some((sql) => sql.includes('"docs_fts"'))).toBe(false);
      // FTS5's trigram tokenizer cannot answer one- or two-codepoint terms,
      // so this compatibility lane must remain until a short-gram index owns it.
      expect(executedSQL.some((sql) => /\binstr\s*\(/i.test(sql))).toBe(true);
      expect(exactCountQueries(executedSQL)).toHaveLength(1);
    }

    executedSQL.length = 0;
    const longNoMatch = await call('omega');
    expect(longNoMatch.status).toBe(200);
    expect(await longNoMatch.json()).toMatchObject({
      items: [],
      total: 0,
    });
    expect(executedSQL.some((sql) => sql.includes('"docs_fts"'))).toBe(true);
    // A valid zero-hit indexed result is terminal. Retrying a long term with
    // instr() turns the cheapest/rarest searches into whole-table reads.
    expect(executedSQL.some((sql) => /\binstr\s*\(/i.test(sql))).toBe(false);
    expect(exactCountQueries(executedSQL)).toHaveLength(1);

    insert.run('indexed-recovery-row', 'recoverable indexed');
    database.exec('DROP TRIGGER "docs_ai"');
    insert.run('recovery-row', 'recoverable delta');
    executedSQL.length = 0;

    const missingArtifact = await call('recoverable');
    expect(missingArtifact.status).toBe(503);
    expect(await missingArtifact.json()).toMatchObject({
      code: 503,
      message: expect.stringContaining('FTS artifacts are unhealthy'),
    });
    expect(executedSQL.some((sql) => sql.includes('"docs_fts"'))).toBe(false);
    // A missing maintenance trigger makes every indexed result incomplete.
    // Long configured searches fail closed instead of becoming hidden scans.
    expect(executedSQL.some((sql) => /\binstr\s*\(/i.test(sql))).toBe(false);
    expect(exactCountQueries(executedSQL)).toHaveLength(0);
  });

  it('D1 preserves the same configured FTS short-term and artifact-recovery boundary', async () => {
    const database = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];
    const d1 = sqliteD1(database, executedSQL);
    const namespace = 'search_d1';
    const config = defineConfig({
      release: true,
      databases: {
        [namespace]: {
          provider: 'd1',
          tables: {
            docs: {
              schema: { title: { type: 'string' } },
              fts: ['title'],
            },
          },
        },
      },
    });
    const env = {
      EDGEBASE_CONFIG: config,
      DB_D1_SEARCH_D1: d1,
    } as unknown as Env;
    const { handleD1Request } = await import('../lib/d1-handler.js');
    const call = (search: string, query = 'includeTotal=true') => handleD1Request(
      buildInternalHandlerContext({
        env,
        request: new Request(
          `http://internal/api/db/${namespace}/tables/docs/search?search=${encodeURIComponent(search)}&${query}`,
          { headers: { 'X-Is-Service-Key': 'true' } },
        ),
      }),
      namespace,
      'docs',
      '/tables/docs/search',
    );

    const warmup = await handleD1Request(
      buildInternalHandlerContext({
        env,
        request: new Request(`http://internal/api/db/${namespace}/tables/docs?limit=0`, {
          headers: { 'X-Is-Service-Key': 'true' },
        }),
      }),
      namespace,
      'docs',
      '/tables/docs',
    );
    expect(warmup.status).toBe(200);

    const insert = database.prepare('INSERT INTO "docs" ("id", "title") VALUES (?, ?)');
    insert.run('indexed-row', 'indexed alpha');
    insert.run('short-row', '한지 D1 fallback');
    insert.run('page-a', 'paged candidate');
    insert.run('page-b', 'paged candidate');
    executedSQL.length = 0;

    const indexed = await call('alpha');
    expect(indexed.status).toBe(200);
    expect(await indexed.json()).toMatchObject({
      items: [expect.objectContaining({ id: 'indexed-row' })],
      total: 1,
    });
    expect(executedSQL.some((sql) => sql.includes('"docs_fts"'))).toBe(true);
    expect(executedSQL.some((sql) => /\binstr\s*\(/i.test(sql))).toBe(false);

    executedSQL.length = 0;

    const short = await call('한지');
    expect(short.status).toBe(200);
    expect(await short.json()).toMatchObject({
      items: [expect.objectContaining({ id: 'short-row' })],
      total: 1,
    });
    expect(executedSQL.some((sql) => sql.includes('"docs_fts"'))).toBe(false);
    expect(executedSQL.some((sql) => /\binstr\s*\(/i.test(sql))).toBe(true);

    executedSQL.length = 0;
    const longNoMatch = await call('omega');
    expect(longNoMatch.status).toBe(200);
    expect(await longNoMatch.json()).toMatchObject({ items: [], total: 0 });
    expect(executedSQL.some((sql) => sql.includes('"docs_fts"'))).toBe(true);
    expect(executedSQL.some((sql) => /\binstr\s*\(/i.test(sql))).toBe(false);

    const fullPage = await call('paged', 'limit=1&includeTotal=false&sort=id:asc');
    expect(await fullPage.json()).toMatchObject({
      items: [expect.objectContaining({ id: 'page-a' })],
      total: null,
      hasMore: true,
    });
    const shortPage = await call('paged', 'limit=3&includeTotal=false&sort=id:asc');
    expect(await shortPage.json()).toMatchObject({
      total: null,
      hasMore: false,
    });

    insert.run('indexed-recovery-row', 'recoverable indexed');
    database.exec('DROP TRIGGER "docs_ai"');
    insert.run('recovery-row', 'recoverable delta');
    executedSQL.length = 0;

    await expect(call('recoverable')).rejects.toMatchObject({
      code: 503,
      message: expect.stringContaining('FTS artifacts are unhealthy'),
    });
    expect(executedSQL.some((sql) => sql.includes('"docs_fts"'))).toBe(false);
    expect(executedSQL.some((sql) => /\binstr\s*\(/i.test(sql))).toBe(false);
  });

  it('Durable Object rebuilds an existing FTS table and triggers when configured fields drift', async () => {
    const database = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];
    seedLegacyBlocksFts(database);
    setConfig(defineConfig({
      release: true,
      databases: {
        app: {
          provider: 'do',
          tables: { blocks: driftedBlocksConfig },
        },
      },
    }));
    const { DatabaseDO } = await import('../durable-objects/database-do.js');
    const databaseDo = new DatabaseDO(
      createSQLiteCtx(database, executedSQL),
      {
        DATABASE_LIVE: {} as DurableObjectNamespace,
        DATABASE: {} as DurableObjectNamespace,
        AUTH: {} as DurableObjectNamespace,
      } as never,
    );

    const response = await databaseDo.fetch(new Request('http://do/tables/blocks?limit=0', {
      headers: { 'X-DO-Name': 'app', 'X-EdgeBase-Internal': 'true' },
    }));

    expect(response.status).toBe(200);
    expectRebuiltBlocksFts(database);
    expect(executedSQL).toContain(
      'SELECT "type", "name", "tbl_name" AS "tableName", "sql" FROM "sqlite_master" '
      + 'WHERE "name" IN (?, ?, ?, ?) LIMIT 8',
    );
  });

  it('D1 rebuilds an existing FTS table and triggers when configured fields drift', async () => {
    const database = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];
    seedLegacyBlocksFts(database);
    const d1 = sqliteD1(database, executedSQL);
    const namespace = 'fts_drift';
    const config = defineConfig({
      release: true,
      databases: {
        [namespace]: {
          provider: 'd1',
          tables: { blocks: driftedBlocksConfig },
        },
      },
    });
    const env = {
      EDGEBASE_CONFIG: config,
      DB_D1_FTS_DRIFT: d1,
    } as unknown as Env;
    const { handleD1Request } = await import('../lib/d1-handler.js');

    const response = await handleD1Request(
      buildInternalHandlerContext({
        env,
        request: new Request(
          `http://internal/api/db/${namespace}/tables/blocks?limit=0`,
          { headers: { 'X-Is-Service-Key': 'true' } },
        ),
      }),
      namespace,
      'blocks',
      '/tables/blocks',
    );

    expect(response.status).toBe(200);
    expectRebuiltBlocksFts(database);
    expect(executedSQL).toContain(
      'SELECT "type", "name", "tbl_name" AS "tableName", "sql" FROM "sqlite_master" '
      + 'WHERE "name" IN (?, ?, ?, ?) LIMIT 8',
    );
  });

  it('Durable Object preserves an ordinary table that occupies an FTS table name', async () => {
    const database = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];
    database.exec(`
      CREATE TABLE "_meta" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL);
      CREATE TABLE "blocks" (
        "id" TEXT PRIMARY KEY,
        "createdAt" TEXT,
        "updatedAt" TEXT,
        "plainText" TEXT,
        "content" TEXT
      );
      CREATE TABLE "blocks_fts" ("sentinel" TEXT);
      INSERT INTO "blocks_fts" ("sentinel") VALUES ('keep-me');
    `);
    database.prepare('INSERT INTO "_meta" ("key", "value") VALUES (?, ?)')
      .run('schemaHash:blocks', computeSchemaHashSync(driftedBlocksConfig));
    setConfig(defineConfig({
      release: true,
      databases: {
        app: {
          provider: 'do',
          tables: { blocks: driftedBlocksConfig },
        },
      },
    }));
    const { DatabaseDO } = await import('../durable-objects/database-do.js');
    const databaseDo = new DatabaseDO(
      createSQLiteCtx(database, executedSQL),
      {
        DATABASE_LIVE: {} as DurableObjectNamespace,
        DATABASE: {} as DurableObjectNamespace,
        AUTH: {} as DurableObjectNamespace,
      } as never,
    );

    await expect(databaseDo.fetch(new Request('http://do/tables/blocks?limit=0', {
      headers: { 'X-DO-Name': 'app', 'X-EdgeBase-Internal': 'true' },
    }))).rejects.toThrow(/FTS artifact collision/);

    expect(database.prepare('SELECT "sentinel" FROM "blocks_fts"').get())
      .toEqual({ sentinel: 'keep-me' });
    expect(executedSQL.some((sql) => /^\s*DROP\s+(?:TABLE|TRIGGER)\b/i.test(sql))).toBe(false);
  });

  it('D1 preserves a foreign trigger that occupies a managed FTS trigger name', async () => {
    const database = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];
    database.exec(`
      CREATE TABLE "_meta" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL);
      CREATE TABLE "blocks" (
        "id" TEXT PRIMARY KEY,
        "createdAt" TEXT,
        "updatedAt" TEXT,
        "plainText" TEXT,
        "content" TEXT
      );
      CREATE TABLE "audit" ("value" TEXT);
      CREATE TRIGGER "blocks_ai" AFTER INSERT ON "audit" BEGIN
        SELECT 1;
      END;
    `);
    database.prepare('INSERT INTO "_meta" ("key", "value") VALUES (?, ?)')
      .run('schemaHash:blocks', computeSchemaHashSync(driftedBlocksConfig));
    const namespace = 'fts_collision';
    const config = defineConfig({
      release: true,
      databases: {
        [namespace]: {
          provider: 'd1',
          tables: { blocks: driftedBlocksConfig },
        },
      },
    });
    const env = {
      EDGEBASE_CONFIG: config,
      DB_D1_FTS_COLLISION: sqliteD1(database, executedSQL),
    } as unknown as Env;
    const { handleD1Request } = await import('../lib/d1-handler.js');

    await expect(handleD1Request(
      buildInternalHandlerContext({
        env,
        request: new Request(
          `http://internal/api/db/${namespace}/tables/blocks?limit=0`,
          { headers: { 'X-Is-Service-Key': 'true' } },
        ),
      }),
      namespace,
      'blocks',
      '/tables/blocks',
    )).rejects.toThrow(/FTS artifact collision/);

    expect(database.prepare(
      'SELECT "tbl_name" FROM "sqlite_master" WHERE "type" = ? AND "name" = ?',
    ).get('trigger', 'blocks_ai')).toEqual({ tbl_name: 'audit' });
    expect(executedSQL.some((sql) => /^\s*DROP\s+(?:TABLE|TRIGGER)\b/i.test(sql))).toBe(false);
  });
});
