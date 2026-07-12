import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { defineConfig } from '@edge-base/shared';
import { setConfig } from '../lib/do-router.js';
import {
  generateSQLiteAddColumnDDLs,
  normalizeSQLiteAddColumnField,
} from '../lib/schema.js';

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

function createSQLiteCtx(db: DatabaseSync, executedSQL: string[]) {
  const exec = vi.fn((query: string, ...params: unknown[]) => {
    executedSQL.push(query);
    return db.prepare(query).all(...(params as never[]));
  });

  return {
    storage: {
      sql: { exec },
      transactionSync: (callback: () => void) => {
        db.exec('BEGIN');
        try {
          callback();
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState;
}

function createEnv(config: unknown) {
  return {
    DATABASE_LIVE: {} as DurableObjectNamespace,
    DATABASE: {} as DurableObjectNamespace,
    AUTH: {} as DurableObjectNamespace,
    EDGEBASE_CONFIG: config,
  };
}

describe('DatabaseDO existing-table schema migration', () => {
  afterEach(() => {
    setConfig({});
  });

  it('adds a unique field without inline constraints and enforces a separate unique index', async () => {
    const db = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];

    try {
      db.exec(`
        CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE notion_import_mappings (
          id TEXT PRIMARY KEY,
          createdAt TEXT,
          updatedAt TEXT,
          pageId TEXT NOT NULL
        );
        INSERT INTO notion_import_mappings (id, pageId) VALUES ('existing', 'page-existing');
        INSERT INTO _meta (key, value)
          VALUES ('schemaHash:notion_import_mappings', 'stale-schema-hash');
      `);

      const config = defineConfig({
        release: true,
        databases: {
          workspace: {
            provider: 'do',
            instance: true,
            tables: {
              notion_import_mappings: {
                schema: {
                  pageId: { type: 'string', required: true },
                  mappingKey: { type: 'string', unique: true },
                },
              },
            },
          },
        },
      });
      setConfig(config);

      const { DatabaseDO } = await import('../durable-objects/database-do.js');
      const databaseDo = new DatabaseDO(createSQLiteCtx(db, executedSQL), createEnv(config) as never);
      const response = await databaseDo.fetch(new Request('http://do/not-a-route', {
        headers: {
          'X-DO-Name': 'workspace:existing-workspace',
          'X-DO-Create-Authorized': 'true',
        },
      }));

      expect(response.status).toBe(404);

      const addColumnSQL = executedSQL.find((sql) =>
        sql.startsWith('ALTER TABLE "notion_import_mappings" ADD COLUMN "mappingKey"'),
      );
      expect(addColumnSQL).toBeDefined();
      expect(addColumnSQL).not.toMatch(/\b(?:UNIQUE|PRIMARY KEY|NOT NULL)\b/);
      expect(executedSQL).toContain(
        'CREATE UNIQUE INDEX IF NOT EXISTS "uidx_notion_import_mappings_mappingKey" ON "notion_import_mappings"("mappingKey")',
      );

      const mappingKeyColumn = db.prepare('PRAGMA table_info("notion_import_mappings")')
        .all()
        .find((row) => row.name === 'mappingKey');
      expect(mappingKeyColumn).toMatchObject({ notnull: 0, pk: 0 });

      const uniqueIndex = db.prepare('PRAGMA index_list("notion_import_mappings")')
        .all()
        .find((row) => row.name === 'uidx_notion_import_mappings_mappingKey');
      expect(uniqueIndex).toMatchObject({ unique: 1 });

      expect(
        db.prepare('SELECT id, mappingKey FROM notion_import_mappings WHERE id = ?').get('existing'),
      ).toMatchObject({ id: 'existing', mappingKey: null });

      const insert = db.prepare(
        'INSERT INTO notion_import_mappings (id, pageId, mappingKey) VALUES (?, ?, ?)',
      );
      insert.run('first-mapping', 'page-1', 'workspace:page-1');
      expect(() => insert.run('duplicate-mapping', 'page-2', 'workspace:page-1'))
        .toThrow(/UNIQUE constraint failed/);
    } finally {
      db.close();
    }
  });

  it('normalizes primary-key and unsafe required additions while preserving safe defaults', () => {
    expect(normalizeSQLiteAddColumnField({
      type: 'string',
      primaryKey: true,
      unique: true,
      required: true,
    })).toMatchObject({ primaryKey: false, unique: false, required: false });

    expect(normalizeSQLiteAddColumnField({
      type: 'string',
      required: true,
      default: null,
    })).toMatchObject({ required: false, default: null });

    expect(normalizeSQLiteAddColumnField({
      type: 'string',
      required: true,
      default: '',
    })).toMatchObject({ required: true, default: '' });

    const [columnDDL, indexDDL] = generateSQLiteAddColumnDDLs(
      'existing_table',
      'mappingKey',
      { type: 'string', unique: true },
    );
    expect(columnDDL).not.toContain('UNIQUE');
    expect(indexDDL).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
  });
});
