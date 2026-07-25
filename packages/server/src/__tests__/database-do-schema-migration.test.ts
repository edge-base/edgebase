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
  generateFTS5DDL,
  generateFTS5Triggers,
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

function createSQLiteCtx(
  db: DatabaseSync,
  executedSQL: string[],
  options: { failOnSQL?: (query: string) => boolean } = {},
) {
  const exec = vi.fn((query: string, ...params: unknown[]) => {
    executedSQL.push(query);
    if (options.failOnSQL?.(query)) {
      throw new Error(`synthetic SQL failure: ${query}`);
    }
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
  options: { failOnSQL?: (query: string) => boolean } = {},
): Promise<Response> {
  setConfig(config);
  const { DatabaseDO } = await import('../durable-objects/database-do.js');
  const databaseDo = new DatabaseDO(
    createSQLiteCtx(db, executedSQL, options),
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

  it('self-heals a reference index and uses it for a 5,000-row child lookup', async () => {
    const db = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];
    const tableConfig: TableConfig = {
      schema: {
        parentId: { type: 'string', references: 'parents' },
        value: { type: 'string' },
      },
    };

    try {
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE parents (id TEXT PRIMARY KEY);
        CREATE TABLE children (
          id TEXT PRIMARY KEY,
          createdAt TEXT,
          updatedAt TEXT,
          parentId TEXT REFERENCES parents(id) ON DELETE SET NULL,
          value TEXT
        );
        INSERT INTO parents (id) VALUES ('parent-0'), ('parent-1');
        INSERT INTO _meta (key, value)
          VALUES ('schemaHash:children', '${computeSchemaHashSync(tableConfig)}');
      `);
      const insert = db.prepare(
        'INSERT INTO children (id, parentId, value) VALUES (?, ?, ?)',
      );
      db.exec('BEGIN');
      for (let index = 0; index < 5_000; index++) {
        insert.run(
          `child-${String(index).padStart(4, '0')}`,
          `parent-${index % 2}`,
          `value-${index}`,
        );
      }
      db.exec('COMMIT');

      const response = await initializeExistingWorkspace(
        db,
        executedSQL,
        createWorkspaceConfig('children', tableConfig),
      );

      expect(response.status).toBe(404);
      expect(db.prepare('PRAGMA index_list("children")').all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'idx_children_parentId', unique: 0, origin: 'c' }),
        ]),
      );
      const plan = db.prepare(
        'EXPLAIN QUERY PLAN SELECT id FROM children WHERE parentId = ?',
      ).all('parent-1');
      expect(plan).toEqual([
        expect.objectContaining({ detail: expect.stringContaining('idx_children_parentId') }),
      ]);
      expect(plan.some((row) => String(row.detail).startsWith('SCAN children'))).toBe(false);
      expect(executedSQL.filter((sql) => sql ===
        'CREATE INDEX IF NOT EXISTS "idx_children_parentId" ON "children"("parentId")'
      )).toHaveLength(1);
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

  it('runs a pending duplicate repair before finalizing a new unique constraint', async () => {
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
          ('older', 'duplicate@example.com'),
          ('newer', 'duplicate@example.com');
        INSERT INTO _meta (key, value) VALUES
          ('schemaHash:contacts', 'stale-schema-hash'),
          ('migration_version:contacts', '1');
      `);

      const config = createWorkspaceConfig('contacts', {
        schema: { email: { type: 'string', unique: true } },
        migrations: [{
          version: 2,
          description: 'Keep the newest contact for each email',
          up: `DELETE FROM contacts WHERE id = 'older'`,
        }],
      });

      const response = await initializeExistingWorkspace(db, executedSQL, config);

      expect(response.status).toBe(404);
      expect(db.prepare('SELECT id, email FROM contacts').all()).toEqual([
        { id: 'newer', email: 'duplicate@example.com' },
      ]);
      expect(
        db.prepare('SELECT value FROM _meta WHERE key = ?').get('migration_version:contacts'),
      ).toMatchObject({ value: '2' });
      expect(
        db.prepare('SELECT value FROM _meta WHERE key = ?').get('schemaHash:contacts'),
      ).toMatchObject({ value: computeSchemaHashSync(config.databases!.workspace!.tables!.contacts!) });
      expect(
        db.prepare('PRAGMA index_list("contacts")').all()
          .find((row) => row.name === 'uidx_contacts_email'),
      ).toMatchObject({ unique: 1 });

      const migrationPosition = executedSQL.findIndex((sql) => sql.includes("id = 'older'"));
      const uniquePosition = executedSQL.findIndex((sql) =>
        sql.startsWith('CREATE UNIQUE INDEX "uidx_contacts_email"'),
      );
      expect(migrationPosition).toBeGreaterThanOrEqual(0);
      expect(uniquePosition).toBeGreaterThan(migrationPosition);
    } finally {
      db.close();
    }
  });

  it('rolls back migration data and metadata when a pending migration fails', async () => {
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
          ('older', 'duplicate@example.com'),
          ('newer', 'duplicate@example.com');
        INSERT INTO _meta (key, value) VALUES
          ('schemaHash:contacts', 'stale-schema-hash'),
          ('migration_version:contacts', '1');
      `);

      await expect(initializeExistingWorkspace(
        db,
        executedSQL,
        createWorkspaceConfig('contacts', {
          schema: { email: { type: 'string', unique: true } },
          migrations: [{
            version: 2,
            description: 'A failing duplicate repair',
            up: `DELETE FROM contacts WHERE id = 'older'; INSERT INTO missing_table VALUES ('x')`,
          }],
        }),
      )).rejects.toThrow();

      expect(db.prepare('SELECT id FROM contacts ORDER BY id').all()).toEqual([
        { id: 'newer' },
        { id: 'older' },
      ]);
      expect(
        db.prepare('SELECT value FROM _meta WHERE key = ?').get('migration_version:contacts'),
      ).toMatchObject({ value: '1' });
      expect(
        db.prepare('SELECT value FROM _meta WHERE key = ?').get('schemaHash:contacts'),
      ).toMatchObject({ value: 'stale-schema-hash' });
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

  it('rebuilds removed foreign keys while preserving rows, indexes, unique fields, and triggers', async () => {
    const db = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];
    const tableConfig: TableConfig = {
      schema: {
        workspaceId: {
          type: 'string',
          required: true,
          references: { table: 'workspaces', onDelete: 'CASCADE' },
        },
        pageId: { type: 'string' },
        message: { type: 'string', unique: true },
      },
      indexes: [{ fields: ['pageId'] }],
      fts: ['message'],
    };
    const managedFtsDDL = [
      generateFTS5DDL('notifications', ['message']),
      ...generateFTS5Triggers('notifications', ['message']),
    ].join('\n');

    try {
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE workspaces (id TEXT PRIMARY KEY);
        CREATE TABLE pages (id TEXT PRIMARY KEY);
        CREATE TABLE notification_audit (notificationId TEXT NOT NULL);
        CREATE TABLE notifications (
          id TEXT PRIMARY KEY,
          createdAt TEXT,
          updatedAt TEXT,
          workspaceId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          pageId TEXT REFERENCES pages(id) ON DELETE CASCADE,
          message TEXT
        );
        CREATE INDEX legacy_notifications_message ON notifications(message);
        CREATE TRIGGER notifications_audit AFTER INSERT ON notifications BEGIN
          INSERT INTO notification_audit(notificationId) VALUES (new.id);
        END;
        ${managedFtsDDL}
        INSERT INTO workspaces (id) VALUES ('workspace-1');
        INSERT INTO pages (id) VALUES ('page-legacy');
        INSERT INTO notifications (id, createdAt, updatedAt, workspaceId, pageId, message)
          VALUES ('notification-1', 'created', 'updated', 'workspace-1', 'page-legacy', 'first');
        DELETE FROM notification_audit;
        INSERT INTO _meta (key, value) VALUES ('schemaHash:notifications', 'stale-schema-hash');
      `);

      const config = createWorkspaceConfig('notifications', tableConfig);
      const response = await initializeExistingWorkspace(db, executedSQL, config);

      expect(response.status).toBe(404);
      expect(db.prepare('PRAGMA foreign_key_list("notifications")').all()).toEqual([
        expect.objectContaining({
          from: 'workspaceId',
          table: 'workspaces',
          to: 'id',
          on_delete: 'CASCADE',
        }),
      ]);
      expect(db.prepare('SELECT * FROM notifications').all()).toEqual([
        {
          id: 'notification-1',
          createdAt: 'created',
          updatedAt: 'updated',
          workspaceId: 'workspace-1',
          pageId: 'page-legacy',
          message: 'first',
        },
      ]);
      const indexes = db.prepare('PRAGMA index_list("notifications")').all();
      expect(indexes.find((row) => row.name === 'idx_notifications_pageId'))
        .toMatchObject({ unique: 0, origin: 'c' });
      expect(indexes.some((row) => row.name === 'legacy_notifications_message')).toBe(true);
      expect(indexes.some((row) => row.unique === 1 && row.origin === 'u')).toBe(true);
      expect(db.prepare(
        'SELECT sql FROM sqlite_master WHERE type = ? AND name = ?',
      ).get('trigger', 'notifications_audit')).toMatchObject({
        sql: expect.stringContaining('INSERT INTO notification_audit'),
      });
      expect(db.prepare(
        'SELECT message FROM notifications_fts WHERE notifications_fts MATCH ?',
      ).all('first')).toEqual([{ message: 'first' }]);
      expect(db.prepare(
        'SELECT name FROM sqlite_master WHERE type = ? AND name IN (?, ?, ?) ORDER BY name',
      ).all('trigger', 'notifications_ai', 'notifications_ad', 'notifications_au'))
        .toEqual([
          { name: 'notifications_ad' },
          { name: 'notifications_ai' },
          { name: 'notifications_au' },
        ]);

      db.prepare(
        'INSERT INTO notifications (id, workspaceId, pageId, message) VALUES (?, ?, ?, ?)',
      ).run('notification-2', 'workspace-1', 'page-not-central', 'second');
      expect(db.prepare('SELECT notificationId FROM notification_audit').all())
        .toEqual([{ notificationId: 'notification-2' }]);
      expect(db.prepare(
        'SELECT message FROM notifications_fts WHERE notifications_fts MATCH ?',
      ).all('second')).toEqual([{ message: 'second' }]);
      expect(() => db.prepare(
        'INSERT INTO notifications (id, workspaceId, message) VALUES (?, ?, ?)',
      ).run('notification-duplicate', 'workspace-1', 'second'))
        .toThrow(/UNIQUE constraint failed/);

      const rebuildCount = executedSQL.filter((sql) =>
        sql.startsWith('CREATE TABLE "__edgebase_rebuild_notifications"'),
      ).length;
      const secondResponse = await initializeExistingWorkspace(db, executedSQL, config);
      expect(secondResponse.status).toBe(404);
      expect(executedSQL.filter((sql) =>
        sql.startsWith('CREATE TABLE "__edgebase_rebuild_notifications"'),
      )).toHaveLength(rebuildCount);
    } finally {
      db.close();
    }
  });

  it('preserves a self-referential hierarchy while reconciling its foreign-key action', async () => {
    const db = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];

    try {
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE folders (
          id TEXT PRIMARY KEY,
          createdAt TEXT,
          updatedAt TEXT,
          parentId TEXT REFERENCES folders(id) ON DELETE SET NULL
        );
        INSERT INTO folders (id, parentId) VALUES ('child', 'parent');
        INSERT INTO folders (id, parentId) VALUES ('parent', NULL);
        INSERT INTO _meta (key, value) VALUES ('schemaHash:folders', 'stale-schema-hash');
      `);
      const config = createWorkspaceConfig('folders', {
        schema: {
          parentId: {
            type: 'string',
            references: { table: 'folders', onDelete: 'CASCADE' },
          },
        },
      });

      const response = await initializeExistingWorkspace(db, executedSQL, config);

      expect(response.status).toBe(404);
      expect(db.prepare('SELECT id, parentId FROM folders ORDER BY id').all()).toEqual([
        { id: 'child', parentId: 'parent' },
        { id: 'parent', parentId: null },
      ]);
      expect(db.prepare('PRAGMA foreign_key_list("folders")').all()).toEqual([
        expect.objectContaining({
          from: 'parentId',
          table: 'folders',
          to: 'id',
          on_delete: 'CASCADE',
        }),
      ]);
      expect(executedSQL).toContain('PRAGMA defer_foreign_keys = ON');
    } finally {
      db.close();
    }
  });

  it('fails closed without deleting rows when another table references the rebuild target', async () => {
    const db = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];

    try {
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE pages (id TEXT PRIMARY KEY);
        CREATE TABLE notifications (
          id TEXT PRIMARY KEY,
          createdAt TEXT,
          updatedAt TEXT,
          pageId TEXT REFERENCES pages(id) ON DELETE CASCADE,
          message TEXT
        );
        CREATE TABLE deliveries (
          id TEXT PRIMARY KEY,
          notificationId TEXT REFERENCES notifications(id) ON DELETE CASCADE
        );
        INSERT INTO pages (id) VALUES ('page-legacy');
        INSERT INTO notifications (id, pageId, message)
          VALUES ('notification-1', 'page-legacy', 'first');
        INSERT INTO deliveries (id, notificationId)
          VALUES ('delivery-1', 'notification-1');
        INSERT INTO _meta (key, value) VALUES
          ('schemaHash:notifications', 'stale-schema-hash');
      `);
      const config = createWorkspaceConfig('notifications', {
        schema: {
          pageId: { type: 'string' },
          message: { type: 'string' },
        },
      });

      await expect(initializeExistingWorkspace(db, executedSQL, config))
        .rejects.toThrow(/referenced by 'deliveries.notificationId'/);

      expect(db.prepare('SELECT id FROM notifications').all())
        .toEqual([{ id: 'notification-1' }]);
      expect(db.prepare('SELECT id, notificationId FROM deliveries').all())
        .toEqual([{ id: 'delivery-1', notificationId: 'notification-1' }]);
      expect(db.prepare('PRAGMA foreign_key_list("notifications")').all()).toEqual([
        expect.objectContaining({ from: 'pageId', table: 'pages' }),
      ]);
      expect(db.prepare('SELECT value FROM _meta WHERE key = ?')
        .get('schemaHash:notifications')).toEqual({ value: 'stale-schema-hash' });
    } finally {
      db.close();
    }
  });

  it('rolls back a removed-FK rebuild and migration metadata, then retries cleanly', async () => {
    const db = new DatabaseSync(':memory:');
    const executedSQL: string[] = [];
    const tableConfig: TableConfig = {
      schema: {
        workspaceId: {
          type: 'string',
          required: true,
          references: { table: 'workspaces', onDelete: 'CASCADE' },
        },
        pageId: { type: 'string' },
        message: { type: 'string' },
      },
      migrations: [{
        version: 2,
        description: 'Update the synthetic notification',
        up: `UPDATE notifications SET message = 'migrated' WHERE id = 'notification-1'`,
      }],
    };

    try {
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE workspaces (id TEXT PRIMARY KEY);
        CREATE TABLE pages (id TEXT PRIMARY KEY);
        CREATE TABLE notifications (
          id TEXT PRIMARY KEY,
          createdAt TEXT,
          updatedAt TEXT,
          workspaceId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          pageId TEXT REFERENCES pages(id) ON DELETE CASCADE,
          message TEXT
        );
        INSERT INTO workspaces (id) VALUES ('workspace-1');
        INSERT INTO pages (id) VALUES ('page-legacy');
        INSERT INTO notifications (id, workspaceId, pageId, message)
          VALUES ('notification-1', 'workspace-1', 'page-legacy', 'original');
        INSERT INTO _meta (key, value) VALUES
          ('schemaHash:notifications', 'stale-schema-hash'),
          ('migration_version:notifications', '1');
      `);
      const config = createWorkspaceConfig('notifications', tableConfig);

      await expect(initializeExistingWorkspace(db, executedSQL, config, {
        failOnSQL: (sql) => sql.startsWith(
          'ALTER TABLE "__edgebase_rebuild_notifications" RENAME TO "notifications"',
        ),
      })).rejects.toThrow(/synthetic SQL failure/);

      expect(db.prepare('SELECT message FROM notifications WHERE id = ?')
        .get('notification-1')).toEqual({ message: 'original' });
      expect(db.prepare('PRAGMA foreign_key_list("notifications")').all()).toHaveLength(2);
      expect(db.prepare('SELECT value FROM _meta WHERE key = ?')
        .get('schemaHash:notifications')).toEqual({ value: 'stale-schema-hash' });
      expect(db.prepare('SELECT value FROM _meta WHERE key = ?')
        .get('migration_version:notifications')).toEqual({ value: '1' });
      expect(db.prepare(
        'SELECT name FROM sqlite_master WHERE name = ?',
      ).get('__edgebase_rebuild_notifications')).toBeUndefined();

      const retryResponse = await initializeExistingWorkspace(db, executedSQL, config);
      expect(retryResponse.status).toBe(404);
      expect(db.prepare('SELECT message FROM notifications WHERE id = ?')
        .get('notification-1')).toEqual({ message: 'migrated' });
      expect(db.prepare('PRAGMA foreign_key_list("notifications")').all()).toEqual([
        expect.objectContaining({ from: 'workspaceId', table: 'workspaces' }),
      ]);
      expect(db.prepare('SELECT value FROM _meta WHERE key = ?')
        .get('migration_version:notifications')).toEqual({ value: '2' });
      expect(db.prepare('SELECT value FROM _meta WHERE key = ?')
        .get('schemaHash:notifications')).toEqual({
          value: computeSchemaHashSync(tableConfig),
        });
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
