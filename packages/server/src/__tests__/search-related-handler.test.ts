import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineConfig } from '@edge-base/shared';

import { _resetD1SchemaCache } from '../lib/d1-schema-init.js';
import { setConfig } from '../lib/do-router.js';
import { buildAdminDbProxy } from '../lib/functions.js';
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

function createSQLiteCtx(database: DatabaseSync): DurableObjectState {
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
        return {
          success: true,
          results: prepared.all(...(params as never[])) as Record<string, unknown>[],
          meta: { changes: 0 },
        };
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
        for (const statement of statements) {
          results.push(await (statement as SqliteD1Statement).all());
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

function relationTables() {
  return {
    pages: {
      schema: {
        workspaceId: { type: 'string' as const, required: true },
        parentId: { type: 'string' as const },
        parentType: { type: 'string' as const },
        notionImportStaging: { type: 'boolean' as const },
        inTrash: { type: 'boolean' as const },
        title: { type: 'text' as const },
      },
    },
    blocks: {
      schema: {
        pageId: { type: 'string' as const, required: true, references: 'pages' },
        plainText: { type: 'text' as const },
      },
    },
  };
}

function relatedInput(relationTable = 'pages') {
  return {
    query: 'needle',
    order: [{ field: 'id', direction: 'asc' }],
    limit: 10,
    includeTotal: true,
    relation: {
      localField: 'pageId',
      table: relationTable,
      whereAll: [
        ['workspaceId', '==', 'ws-1'],
        ['notionImportStaging', 'is-not-true'],
        ['inTrash', 'is-not-true'],
      ],
    },
  };
}

describe('trusted related-search handler', () => {
  afterEach(() => {
    _resetD1SchemaCache();
    setConfig({});
  });

  it('filters related rows before LIMIT and rejects public or cross-database authority input', async () => {
    const database = new DatabaseSync(':memory:');
    setConfig(defineConfig({
      release: true,
      databases: {
        workspace: {
          provider: 'do',
          instance: true,
          tables: relationTables(),
        },
      },
    }));
    const { DatabaseDO } = await import('../durable-objects/database-do.js');
    const databaseDo = new DatabaseDO(
      createSQLiteCtx(database),
      {
        DATABASE_LIVE: {} as DurableObjectNamespace,
        DATABASE: {} as DurableObjectNamespace,
        AUTH: {} as DurableObjectNamespace,
      } as never,
    );
    const headers = {
      'Content-Type': 'application/json',
      'X-DO-Name': 'workspace:ws-1',
      'X-EdgeBase-Internal': 'true',
      'X-DO-Create-Authorized': 'true',
    };

    const initialized = await databaseDo.fetch(new Request('http://do/tables/blocks', {
      headers,
    }));
    expect(initialized.status).toBe(200);
    database.prepare(
      'INSERT INTO pages (id, workspaceId, parentId, parentType, notionImportStaging, inTrash, title) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('visible', 'ws-1', null, 'workspace', 0, 0, 'Visible');
    database.prepare(
      'INSERT INTO pages (id, workspaceId, parentId, parentType, notionImportStaging, inTrash, title) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('trashed', 'ws-1', null, 'workspace', 0, 1, 'Trashed');
    database.prepare(
      'INSERT INTO pages (id, workspaceId, parentId, parentType, notionImportStaging, inTrash, title) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('foreign', 'ws-2', null, 'workspace', 0, 0, 'Foreign');
    const insertBlock = database.prepare(
      'INSERT INTO blocks (id, pageId, plainText) VALUES (?, ?, ?)',
    );
    insertBlock.run('a-denied-foreign', 'foreign', 'needle foreign');
    insertBlock.run('b-denied-trash', 'trashed', 'needle trash');
    insertBlock.run('z-visible', 'visible', 'needle visible');

    const trusted = await databaseDo.fetch(new Request(
      'http://do/tables/blocks/search-related',
      { method: 'POST', headers, body: JSON.stringify(relatedInput()) },
    ));
    expect(trusted.status).toBe(200);
    await expect(trusted.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'z-visible' })],
      total: 1,
      hasMore: false,
      perPage: 10,
    });

    const publicResponse = await databaseDo.fetch(new Request(
      'http://do/tables/blocks/search-related',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-DO-Name': 'workspace:ws-1',
        },
        body: JSON.stringify(relatedInput()),
      },
    ));
    expect(publicResponse.status).toBe(403);

    const crossDatabase = await databaseDo.fetch(new Request(
      'http://do/tables/blocks/search-related',
      {
        method: 'POST',
        headers,
        body: JSON.stringify(relatedInput('central_pages')),
      },
    ));
    expect(crossDatabase.status).toBe(400);
    await expect(crossDatabase.json()).resolves.toMatchObject({
      slug: 'invalid-related-search',
    });
    database.close();
  });

  it('runs the same validated relation through the internal admin proxy and D1 handler', async () => {
    const database = new DatabaseSync(':memory:');
    const config = defineConfig({
      release: true,
      databases: {
        app: {
          provider: 'd1',
          tables: relationTables(),
        },
      },
    });
    const env = {
      EDGEBASE_CONFIG: config,
      DB_D1_APP: sqliteD1(database),
    } as unknown as Env;
    const adminDb = buildAdminDbProxy({
      databaseNamespace: {} as DurableObjectNamespace,
      config,
      env,
    });
    await adminDb('app').table('blocks').limit(1).includeTotal(false).getList();
    database.prepare(
      'INSERT INTO pages (id, workspaceId, parentId, parentType, notionImportStaging, inTrash, title) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('visible', 'ws-1', null, 'workspace', 0, 0, 'Visible');
    database.prepare(
      'INSERT INTO pages (id, workspaceId, parentId, parentType, notionImportStaging, inTrash, title) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('staging', 'ws-1', null, 'workspace', 1, 0, 'Staging');
    database.prepare(
      'INSERT INTO pages (id, workspaceId, parentId, parentType, notionImportStaging, inTrash, title) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('visible-2', 'ws-1', null, 'workspace', 0, 0, 'Visible 2');
    database.prepare('INSERT INTO blocks (id, pageId, plainText) VALUES (?, ?, ?)')
      .run('visible-a', 'visible', 'needle visible a');
    database.prepare('INSERT INTO blocks (id, pageId, plainText) VALUES (?, ?, ?)')
      .run('visible-b', 'visible', 'needle visible b');
    database.prepare('INSERT INTO blocks (id, pageId, plainText) VALUES (?, ?, ?)')
      .run('visible-next', 'visible-2', 'alternate visible next');
    database.prepare('INSERT INTO blocks (id, pageId, plainText) VALUES (?, ?, ?)')
      .run('staging-block', 'staging', 'needle hidden');

    const table = adminDb('app').table('blocks') as unknown as {
      searchRelated(input: unknown): Promise<{
        items: Array<{ id: string }>;
        total: number | null;
        hasMore: boolean;
        cursor: { values: string[] } | null;
      }>;
    };
    const input = {
      ...relatedInput(),
      queryVariants: ['alternate'],
      order: [
        { field: 'pageId', direction: 'asc' },
        { field: 'id', direction: 'asc' },
      ],
      limit: 1,
    };
    const first = await table.searchRelated(input);

    expect(first.items.map(({ id }) => id)).toEqual(['visible-a']);
    expect(first.total).toBe(3);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).toEqual({ values: ['visible', 'visible-a'] });

    const second = await table.searchRelated({ ...input, after: first.cursor });
    expect(second.items.map(({ id }) => id)).toEqual(['visible-b']);
    expect(second.hasMore).toBe(true);
    expect(second.cursor).toEqual({ values: ['visible', 'visible-b'] });

    const third = await table.searchRelated({ ...input, after: second.cursor });
    expect(third.items.map(({ id }) => id)).toEqual(['visible-next']);
    expect(third.hasMore).toBe(false);
    expect(third.cursor).toBeNull();
    database.close();
  });
});
