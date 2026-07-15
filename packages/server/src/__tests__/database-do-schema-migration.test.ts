import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  defineConfig,
  type EdgeBaseConfig,
  type TableConfig,
} from '@edge-base/shared';
import { setConfig } from '../lib/do-router.js';
import {
  computeSchemaHashSync,
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

function createEnv(config?: unknown) {
  return {
    DATABASE_LIVE: {} as DurableObjectNamespace,
    DATABASE: {} as DurableObjectNamespace,
    AUTH: {} as DurableObjectNamespace,
    ...(config === undefined ? {} : { EDGEBASE_CONFIG: config }),
  };
}

function createWorkspaceConfig(tableName: string, table: TableConfig): EdgeBaseConfig {
  return defineConfig({
    release: true,
    databases: {
      workspace: {
        provider: 'do',
        instance: true,
        tables: { [tableName]: table },
      },
    },
  });
}

async function initializeExistingWorkspace(
  db: DatabaseSync,
  executedSQL: string[],
  config: EdgeBaseConfig,
): Promise<Response> {
  setConfig(config);
  const { DatabaseDO } = await import('../durable-objects/database-do.js');
  const databaseDo = new DatabaseDO(
    createSQLiteCtx(db, executedSQL),
    createEnv() as never,
  );
  return databaseDo.fetch(new Request('http://do/not-a-route', {
    headers: {
      'X-DO-Name': 'workspace:existing-workspace',
      'X-DO-Create-Authorized': 'true',
    },
  }));
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
      const databaseDo = new DatabaseDO(createSQLiteCtx(db, executedSQL), createEnv() as never);
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
        'CREATE UNIQUE INDEX "uidx_notion_import_mappings_mappingKey" ON "notion_import_mappings"("mappingKey")',
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

  it('self-heals a missing unique index when an older runtime stored the current hash', async () => {
    const db = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];
    const tableConfig: TableConfig = {
      schema: { email: { type: 'string', unique: true } },
    };

    try {
      db.exec(`
        CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE contacts (
          id TEXT PRIMARY KEY,
          createdAt TEXT,
          updatedAt TEXT,
          email TEXT
        );
        INSERT INTO contacts (id, email) VALUES ('first', 'first@example.com');
      `);
      db.prepare('INSERT INTO _meta (key, value) VALUES (?, ?)')
        .run('schemaHash:contacts', computeSchemaHashSync(tableConfig));

      const response = await initializeExistingWorkspace(
        db,
        executedSQL,
        createWorkspaceConfig('contacts', tableConfig),
      );

      expect(response.status).toBe(404);
      expect(
        db.prepare('PRAGMA index_list("contacts")').all()
          .find((row) => row.name === 'uidx_contacts_email'),
      ).toMatchObject({ unique: 1 });
    } finally {
      db.close();
    }
  });

  it('fails closed on a reserved unique-index collision before adding the column', async () => {
    const db = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];

    try {
      db.exec(`
        CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE contacts (
          id TEXT PRIMARY KEY,
          createdAt TEXT,
          updatedAt TEXT,
          legacy TEXT
        );
        CREATE INDEX uidx_contacts_email ON contacts(legacy);
        INSERT INTO _meta (key, value) VALUES ('schemaHash:contacts', 'stale-schema-hash');
      `);

      await expect(initializeExistingWorkspace(
        db,
        executedSQL,
        createWorkspaceConfig('contacts', {
          schema: { email: { type: 'string', unique: true } },
        }),
      )).rejects.toThrow(/reserved index 'uidx_contacts_email' does not match/);

      expect(
        db.prepare('PRAGMA table_info("contacts")').all()
          .some((row) => row.name === 'email'),
      ).toBe(false);
      expect(
        db.prepare('PRAGMA index_list("contacts")').all()
          .find((row) => row.name === 'uidx_contacts_email'),
      ).toMatchObject({ unique: 0, origin: 'c' });
      expect(
        db.prepare('SELECT value FROM _meta WHERE key = ?').get('schemaHash:contacts'),
      ).toMatchObject({ value: 'stale-schema-hash' });
    } finally {
      db.close();
    }
  });

  it('enables unique on an existing column and retains SQLite NULL semantics', async () => {
    const db = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];

    try {
      db.exec(`
        CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE contacts (
          id TEXT PRIMARY KEY,
          createdAt TEXT,
          updatedAt TEXT,
          email TEXT
        );
        INSERT INTO contacts (id, email) VALUES
          ('first', 'first@example.com'),
          ('second', 'second@example.com'),
          ('null-one', NULL),
          ('null-two', NULL);
        INSERT INTO _meta (key, value) VALUES ('schemaHash:contacts', 'stale-schema-hash');
      `);

      const response = await initializeExistingWorkspace(
        db,
        executedSQL,
        createWorkspaceConfig('contacts', {
          schema: { email: { type: 'string', unique: true } },
        }),
      );

      expect(response.status).toBe(404);
      expect(executedSQL).toContain(
        'CREATE UNIQUE INDEX "uidx_contacts_email" ON "contacts"("email")',
      );
      expect(
        db.prepare('PRAGMA index_list("contacts")').all()
          .find((row) => row.name === 'uidx_contacts_email'),
      ).toMatchObject({ unique: 1, origin: 'c', partial: 0 });

      const insert = db.prepare('INSERT INTO contacts (id, email) VALUES (?, ?)');
      expect(() => insert.run('duplicate', 'first@example.com'))
        .toThrow(/UNIQUE constraint failed/);
      expect(() => insert.run('null-three', null)).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('fails clearly and leaves the schema hash retryable when existing values are duplicated', async () => {
    const db = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];

    try {
      db.exec(`
        CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE contacts (
          id TEXT PRIMARY KEY,
          createdAt TEXT,
          updatedAt TEXT,
          email TEXT
        );
        INSERT INTO contacts (id, email) VALUES
          ('first', 'duplicate@example.com'),
          ('second', 'duplicate@example.com');
        INSERT INTO _meta (key, value) VALUES ('schemaHash:contacts', 'stale-schema-hash');
      `);

      const config = createWorkspaceConfig('contacts', {
        schema: { email: { type: 'string', unique: true } },
      });
      await expect(initializeExistingWorkspace(
        db,
        executedSQL,
        config,
      )).rejects.toThrow(
        "Cannot enable unique for field 'contacts.email': existing non-NULL values contain duplicates.",
      );

      expect(
        db.prepare('SELECT value FROM _meta WHERE key = ?').get('schemaHash:contacts'),
      ).toMatchObject({ value: 'stale-schema-hash' });
      expect(
        db.prepare('PRAGMA index_list("contacts")').all()
          .some((row) => row.name === 'uidx_contacts_email'),
      ).toBe(false);
      expect(db.prepare('SELECT COUNT(*) AS count FROM contacts').get())
        .toMatchObject({ count: 2 });

      db.prepare('UPDATE contacts SET email = ? WHERE id = ?')
        .run('second@example.com', 'second');
      const retryResponse = await initializeExistingWorkspace(db, executedSQL, config);
      expect(retryResponse.status).toBe(404);
      expect(
        db.prepare('PRAGMA index_list("contacts")').all()
          .find((row) => row.name === 'uidx_contacts_email'),
      ).toMatchObject({ unique: 1 });
      expect(
        db.prepare('SELECT value FROM _meta WHERE key = ?').get('schemaHash:contacts'),
      ).not.toMatchObject({ value: 'stale-schema-hash' });
    } finally {
      db.close();
    }
  });

  it('disables only field-owned unique indexes and preserves config.indexes ownership', async () => {
    const db = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];

    try {
      db.exec(`
        CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE contacts (
          id TEXT PRIMARY KEY,
          createdAt TEXT,
          updatedAt TEXT,
          email TEXT,
          handle TEXT
        );
        CREATE UNIQUE INDEX uidx_contacts_email ON contacts(email);
        CREATE UNIQUE INDEX uidx_contacts_handle ON contacts(handle);
        CREATE UNIQUE INDEX idx_contacts_handle ON contacts(handle);
        INSERT INTO contacts (id, email, handle)
          VALUES ('first', 'first@example.com', 'first-handle');
        INSERT INTO _meta (key, value) VALUES ('schemaHash:contacts', 'stale-schema-hash');
      `);

      const response = await initializeExistingWorkspace(
        db,
        executedSQL,
        createWorkspaceConfig('contacts', {
          schema: {
            email: { type: 'string', unique: false },
            handle: { type: 'string' },
          },
          indexes: [{ fields: ['handle'], unique: true }],
        }),
      );

      expect(response.status).toBe(404);
      const indexes = db.prepare('PRAGMA index_list("contacts")').all();
      expect(indexes.some((row) => row.name === 'uidx_contacts_email')).toBe(false);
      expect(indexes.some((row) => row.name === 'uidx_contacts_handle')).toBe(false);
      expect(indexes.find((row) => row.name === 'idx_contacts_handle'))
        .toMatchObject({ unique: 1, origin: 'c' });

      const insert = db.prepare('INSERT INTO contacts (id, email, handle) VALUES (?, ?, ?)');
      expect(() => insert.run('duplicate-email', 'first@example.com', 'second-handle'))
        .not.toThrow();
      expect(() => insert.run('duplicate-handle', 'second@example.com', 'first-handle'))
        .toThrow(/UNIQUE constraint failed/);
    } finally {
      db.close();
    }
  });

  it('requires an explicit migration before disabling an inline UNIQUE constraint', async () => {
    const db = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];

    try {
      db.exec(`
        CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE contacts (
          id TEXT PRIMARY KEY,
          createdAt TEXT,
          updatedAt TEXT,
          email TEXT UNIQUE
        );
        INSERT INTO contacts (id, email) VALUES ('first', 'first@example.com');
        INSERT INTO _meta (key, value) VALUES ('schemaHash:contacts', 'stale-schema-hash');
      `);

      await expect(initializeExistingWorkspace(
        db,
        executedSQL,
        createWorkspaceConfig('contacts', {
          schema: { email: { type: 'string', unique: false } },
        }),
      )).rejects.toThrow(
        "Cannot disable unique for field 'contacts.email': SQLite stored it as an inline UNIQUE constraint.",
      );

      expect(
        db.prepare('SELECT value FROM _meta WHERE key = ?').get('schemaHash:contacts'),
      ).toMatchObject({ value: 'stale-schema-hash' });
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
