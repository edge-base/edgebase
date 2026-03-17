/**
 * Tests for schema-check.ts — Schema Destructive Change Detection.
 *
 * 실행: cd packages/cli && TMPDIR=/tmp npx vitest run test/schema-check.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildSnapshot,
  loadSnapshot,
  saveSnapshot,
  getSnapshotPath,
  detectDestructiveChanges,
  filterAutoPassChanges,
  detectProviderChanges,
  detectAuthProviderChange,
  handleDestructiveChanges,
  type SchemaSnapshot,
  type DbBlockLike,
} from '../src/lib/schema-check.js';
import { setContext } from '../src/lib/cli-context.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-schema-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  setContext({ verbose: false, quiet: false, json: false, nonInteractive: false });
});

// ======================================================================
// 1. buildSnapshot — DB Block Hierarchy (§1)
// ======================================================================

describe('buildSnapshot — DB Block Hierarchy', () => {
  it('builds snapshot from databases with tables', () => {
    const databases: Record<string, DbBlockLike> = {
      shared: {
        tables: {
          posts: {
            schema: { title: { type: 'string' }, views: { type: 'number' } },
          },
        },
      },
    };

    const snapshot = buildSnapshot(databases);
    expect(snapshot.version).toBe(2);
    expect(snapshot.databases.shared.tables.posts).toBeDefined();
    expect(snapshot.databases.shared.tables.posts.schema).toHaveProperty('id');
    expect(snapshot.databases.shared.tables.posts.schema).toHaveProperty('createdAt');
    expect(snapshot.databases.shared.tables.posts.schema).toHaveProperty('updatedAt');
    expect(snapshot.databases.shared.tables.posts.schema).toHaveProperty('title');
    expect(snapshot.databases.shared.tables.posts.schema).toHaveProperty('views');
  });

  it('mirrors DB block hierarchy with multiple databases', () => {
    const databases: Record<string, DbBlockLike> = {
      shared: {
        tables: { posts: { schema: { title: { type: 'string' } } } },
      },
      workspace: {
        tables: { documents: { schema: { content: { type: 'text' } } } },
      },
    };

    const snapshot = buildSnapshot(databases);
    expect(Object.keys(snapshot.databases)).toEqual(['shared', 'workspace']);
    expect(snapshot.databases.shared.tables.posts).toBeDefined();
    expect(snapshot.databases.workspace.tables.documents).toBeDefined();
  });

  it('auto-fields always included with fixed types (§1a)', () => {
    const databases: Record<string, DbBlockLike> = {
      shared: { tables: { posts: { schema: { title: { type: 'string' } } } } },
    };

    const snapshot = buildSnapshot(databases);
    const schema = snapshot.databases.shared.tables.posts.schema;
    expect(schema.id).toEqual({ type: 'string', primaryKey: true });
    expect(schema.createdAt).toEqual({ type: 'datetime' });
    expect(schema.updatedAt).toEqual({ type: 'datetime' });
  });

  it('auto-field disabled with false → excluded from snapshot (§1a)', () => {
    const databases: Record<string, DbBlockLike> = {
      shared: {
        tables: {
          logs: { schema: { updatedAt: false, message: { type: 'text' } } },
        },
      },
    };

    const snapshot = buildSnapshot(databases);
    const schema = snapshot.databases.shared.tables.logs.schema;
    expect(schema).not.toHaveProperty('updatedAt');
    expect(schema).toHaveProperty('id');
    expect(schema).toHaveProperty('createdAt');
    expect(schema).toHaveProperty('message');
  });

  it('schemaless table → auto-fields only (§1b)', () => {
    const databases: Record<string, DbBlockLike> = {
      shared: { tables: { logs: {} } },
    };

    const snapshot = buildSnapshot(databases);
    const schema = snapshot.databases.shared.tables.logs.schema;
    expect(Object.keys(schema)).toHaveLength(3);
    expect(schema.id).toEqual({ type: 'string', primaryKey: true });
    expect(schema.createdAt).toEqual({ type: 'datetime' });
    expect(schema.updatedAt).toEqual({ type: 'datetime' });
  });

  it('tracks latestMigrationVersion from migrations array', () => {
    const databases: Record<string, DbBlockLike> = {
      shared: {
        tables: {
          posts: {
            schema: { title: { type: 'string' } },
            migrations: [
              { version: 1 },
              { version: 3 },
              { version: 2 },
            ],
          },
        },
      },
    };

    const snapshot = buildSnapshot(databases);
    expect(snapshot.databases.shared.tables.posts.latestMigrationVersion).toBe(3);
  });

  it('no migrations → latestMigrationVersion is 0', () => {
    const databases: Record<string, DbBlockLike> = {
      shared: { tables: { posts: { schema: { title: { type: 'string' } } } } },
    };

    const snapshot = buildSnapshot(databases);
    expect(snapshot.databases.shared.tables.posts.latestMigrationVersion).toBe(0);
  });

  it('empty databases → empty snapshot', () => {
    const snapshot = buildSnapshot({});
    expect(snapshot.databases).toEqual({});
  });

  it('empty tables → empty tables in snapshot', () => {
    const databases: Record<string, DbBlockLike> = {
      shared: { tables: {} },
    };
    const snapshot = buildSnapshot(databases);
    expect(snapshot.databases.shared.tables).toEqual({});
  });
});

// ======================================================================
// 2. Snapshot I/O — loadSnapshot / saveSnapshot (§1, §5)
// ======================================================================

describe('Snapshot I/O', () => {
  it('saveSnapshot writes JSON file', () => {
    const snapshot: SchemaSnapshot = {
      version: 1,
      databases: {
        shared: {
          tables: {
            posts: {
              schema: { id: { type: 'string', primaryKey: true } },
              latestMigrationVersion: 0,
            },
          },
        },
      },
    };

    saveSnapshot(tmpDir, snapshot);
    const filePath = getSnapshotPath(tmpDir);
    expect(existsSync(filePath)).toBe(true);

    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.databases.shared.tables.posts).toBeDefined();
  });

  it('loadSnapshot reads saved snapshot', () => {
    const snapshot: SchemaSnapshot = {
      version: 1,
      databases: { shared: { tables: {} } },
    };

    saveSnapshot(tmpDir, snapshot);
    const loaded = loadSnapshot(tmpDir);
    expect(loaded).toEqual(snapshot);
  });

  it('loadSnapshot returns null when no file exists', () => {
    const loaded = loadSnapshot(tmpDir);
    expect(loaded).toBeNull();
  });

  it('loadSnapshot returns null for malformed JSON', () => {
    const filePath = getSnapshotPath(tmpDir);
    const { writeFileSync } = require('node:fs');
    writeFileSync(filePath, 'not-valid-json', 'utf-8');
    const loaded = loadSnapshot(tmpDir);
    expect(loaded).toBeNull();
  });

  it('snapshot file is named edgebase-schema.lock.json in project root', () => {
    const path = getSnapshotPath(tmpDir);
    expect(path).toBe(join(tmpDir, 'edgebase-schema.lock.json'));
  });
});

// ======================================================================
// 3. detectDestructiveChanges (§2)
// ======================================================================

describe('detectDestructiveChanges', () => {
  function makeSnapshot(tables: Record<string, Record<string, { type: string }>>, migrations = 0): SchemaSnapshot {
    const snapshotTables: Record<string, { schema: Record<string, { type: string }>; latestMigrationVersion: number }> = {};
    for (const [name, schema] of Object.entries(tables)) {
      snapshotTables[name] = { schema, latestMigrationVersion: migrations };
    }
    return { version: 1, databases: { shared: { tables: snapshotTables } } };
  }

  it('no changes → empty array', () => {
    const saved = makeSnapshot({ posts: { title: { type: 'string' } } });
    const current = makeSnapshot({ posts: { title: { type: 'string' } } });
    expect(detectDestructiveChanges(saved, current)).toHaveLength(0);
  });

  it('column added → not destructive (empty array)', () => {
    const saved = makeSnapshot({ posts: { title: { type: 'string' } } });
    const current = makeSnapshot({
      posts: { title: { type: 'string' }, views: { type: 'number' } },
    });
    expect(detectDestructiveChanges(saved, current)).toHaveLength(0);
  });

  it('column deleted → destructive', () => {
    const saved = makeSnapshot({
      posts: { title: { type: 'string' }, views: { type: 'number' } },
    });
    const current = makeSnapshot({ posts: { title: { type: 'string' } } });
    const changes = detectDestructiveChanges(saved, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('column_deleted');
    expect(changes[0].detail).toContain('views');
  });

  it('column type changed → destructive', () => {
    const saved = makeSnapshot({ posts: { score: { type: 'number' } } });
    const current = makeSnapshot({ posts: { score: { type: 'string' } } });
    const changes = detectDestructiveChanges(saved, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('column_type_changed');
    expect(changes[0].detail).toContain('number → string');
  });

  it('table deleted → destructive', () => {
    const saved = makeSnapshot({ posts: { title: { type: 'string' } } });
    const current: SchemaSnapshot = { version: 1, databases: { shared: { tables: {} } } };
    const changes = detectDestructiveChanges(saved, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('table_deleted');
  });

  it('entire DB block removed → all tables destructive', () => {
    const saved: SchemaSnapshot = {
      version: 1,
      databases: {
        shared: { tables: { posts: { schema: { title: { type: 'string' } }, latestMigrationVersion: 0 } } },
        workspace: { tables: { docs: { schema: { content: { type: 'text' } }, latestMigrationVersion: 0 } } },
      },
    };
    const current: SchemaSnapshot = {
      version: 1,
      databases: {
        shared: { tables: { posts: { schema: { title: { type: 'string' } }, latestMigrationVersion: 0 } } },
      },
    };
    const changes = detectDestructiveChanges(saved, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].dbKey).toBe('workspace');
    expect(changes[0].type).toBe('table_deleted');
  });

  it('new DB block added → not destructive', () => {
    const saved: SchemaSnapshot = {
      version: 1,
      databases: { shared: { tables: { posts: { schema: { title: { type: 'string' } }, latestMigrationVersion: 0 } } } },
    };
    const current: SchemaSnapshot = {
      version: 1,
      databases: {
        shared: { tables: { posts: { schema: { title: { type: 'string' } }, latestMigrationVersion: 0 } } },
        workspace: { tables: { docs: { schema: { content: { type: 'text' } }, latestMigrationVersion: 0 } } },
      },
    };
    expect(detectDestructiveChanges(saved, current)).toHaveLength(0);
  });

  it('new table added → not destructive', () => {
    const saved = makeSnapshot({ posts: { title: { type: 'string' } } });
    const current = makeSnapshot({
      posts: { title: { type: 'string' } },
      comments: { body: { type: 'text' } },
    });
    expect(detectDestructiveChanges(saved, current)).toHaveLength(0);
  });

  it('multiple destructive changes detected simultaneously', () => {
    const saved = makeSnapshot({
      posts: { title: { type: 'string' }, views: { type: 'number' }, score: { type: 'number' } },
    });
    const current = makeSnapshot({
      posts: { title: { type: 'string' }, score: { type: 'string' } },
    });
    const changes = detectDestructiveChanges(saved, current);
    expect(changes).toHaveLength(2);
    const types = changes.map(c => c.type);
    expect(types).toContain('column_deleted');
    expect(types).toContain('column_type_changed');
  });

  it('column rename detected as delete + add (not a single rename)', () => {
    const saved = makeSnapshot({ posts: { oldName: { type: 'string' } } });
    const current = makeSnapshot({ posts: { newName: { type: 'string' } } });
    const changes = detectDestructiveChanges(saved, current);
    // Rename = 1 delete (oldName removed). newName add is non-destructive.
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('column_deleted');
    expect(changes[0].detail).toContain('oldName');
  });
});

// ======================================================================
// 4. filterAutoPassChanges — Per-table Migration (§4)
// ======================================================================

describe('filterAutoPassChanges — Per-table Migration', () => {
  it('new migration on affected table → auto-pass (filtered out)', () => {
    const saved: SchemaSnapshot = {
      version: 1,
      databases: {
        shared: {
          tables: {
            posts: { schema: { title: { type: 'string' }, views: { type: 'number' } }, latestMigrationVersion: 1 },
          },
        },
      },
    };
    const current: SchemaSnapshot = {
      version: 1,
      databases: {
        shared: {
          tables: {
            posts: { schema: { title: { type: 'string' } }, latestMigrationVersion: 2 },
          },
        },
      },
    };

    const changes = detectDestructiveChanges(saved, current);
    expect(changes).toHaveLength(1); // views column deleted

    const filtered = filterAutoPassChanges(changes, saved, current);
    expect(filtered).toHaveLength(0); // auto-passed because migration version 2 > 1
  });

  it('migration on DIFFERENT table → NOT auto-passed', () => {
    const saved: SchemaSnapshot = {
      version: 1,
      databases: {
        shared: {
          tables: {
            posts: { schema: { title: { type: 'string' }, views: { type: 'number' } }, latestMigrationVersion: 1 },
            comments: { schema: { body: { type: 'text' } }, latestMigrationVersion: 1 },
          },
        },
      },
    };
    const current: SchemaSnapshot = {
      version: 1,
      databases: {
        shared: {
          tables: {
            posts: { schema: { title: { type: 'string' } }, latestMigrationVersion: 1 }, // same version!
            comments: { schema: { body: { type: 'text' } }, latestMigrationVersion: 2 }, // comments has migration
          },
        },
      },
    };

    const changes = detectDestructiveChanges(saved, current);
    expect(changes).toHaveLength(1); // posts.views deleted

    const filtered = filterAutoPassChanges(changes, saved, current);
    expect(filtered).toHaveLength(1); // NOT auto-passed — posts still has no migration
  });

  it('same migration version → NOT auto-passed', () => {
    const saved: SchemaSnapshot = {
      version: 1,
      databases: {
        shared: { tables: { posts: { schema: { views: { type: 'number' } }, latestMigrationVersion: 1 } } },
      },
    };
    const current: SchemaSnapshot = {
      version: 1,
      databases: {
        shared: { tables: { posts: { schema: {}, latestMigrationVersion: 1 } } },
      },
    };

    const changes = detectDestructiveChanges(saved, current);
    const filtered = filterAutoPassChanges(changes, saved, current);
    expect(filtered).toHaveLength(1); // NOT auto-passed — same version
  });

  it('table deleted → NOT auto-passed (no current table to check)', () => {
    const saved: SchemaSnapshot = {
      version: 1,
      databases: {
        shared: { tables: { posts: { schema: { title: { type: 'string' } }, latestMigrationVersion: 0 } } },
      },
    };
    const current: SchemaSnapshot = {
      version: 1,
      databases: { shared: { tables: {} } },
    };

    const changes = detectDestructiveChanges(saved, current);
    const filtered = filterAutoPassChanges(changes, saved, current);
    expect(filtered).toHaveLength(1); // table delete cannot be auto-passed
  });
});

// ======================================================================
// 5. Snapshot Roundtrip — Full Integration
// ======================================================================

describe('Snapshot Roundtrip', () => {
  it('build → save → load → compare with identical config = no changes', () => {
    const databases: Record<string, DbBlockLike> = {
      shared: {
        tables: {
          posts: { schema: { title: { type: 'string' }, views: { type: 'number' } } },
          tags: { schema: { name: { type: 'string' } } },
        },
      },
      workspace: {
        tables: {
          documents: { schema: { content: { type: 'text' } } },
        },
      },
    };

    const snapshot = buildSnapshot(databases);
    saveSnapshot(tmpDir, snapshot);

    const loaded = loadSnapshot(tmpDir);
    expect(loaded).not.toBeNull();

    const current = buildSnapshot(databases);
    const changes = detectDestructiveChanges(loaded!, current);
    expect(changes).toHaveLength(0);
  });

  it('build → save → modify schema → load → detect change', () => {
    const original: Record<string, DbBlockLike> = {
      shared: {
        tables: {
          posts: { schema: { title: { type: 'string' }, views: { type: 'number' } } },
        },
      },
    };
    saveSnapshot(tmpDir, buildSnapshot(original));

    const modified: Record<string, DbBlockLike> = {
      shared: {
        tables: {
          posts: { schema: { title: { type: 'string' } } }, // views removed
        },
      },
    };

    const saved = loadSnapshot(tmpDir)!;
    const current = buildSnapshot(modified);
    const changes = detectDestructiveChanges(saved, current);

    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('column_deleted');
    expect(changes[0].detail).toContain('views');
    expect(changes[0].dbKey).toBe('shared');
    expect(changes[0].table).toBe('posts');
  });
});

// ======================================================================
// 6. detectAuthProviderChange — Auth Provider Tracking
// ======================================================================

describe('detectAuthProviderChange', () => {
  it('returns null when both snapshots have same auth provider', () => {
    const saved: SchemaSnapshot = { version: 2, databases: {}, authProvider: 'd1' };
    const current: SchemaSnapshot = { version: 2, databases: {}, authProvider: 'd1' };
    expect(detectAuthProviderChange(saved, current)).toBeNull();
  });

  it('detects d1 → neon change', () => {
    const saved: SchemaSnapshot = { version: 2, databases: {}, authProvider: 'd1' };
    const current: SchemaSnapshot = { version: 2, databases: {}, authProvider: 'neon' };
    const change = detectAuthProviderChange(saved, current);
    expect(change).not.toBeNull();
    expect(change!.namespace).toBe('_auth');
    expect(change!.oldProvider).toBe('d1');
    expect(change!.newProvider).toBe('neon');
  });

  it('detects neon → d1 change', () => {
    const saved: SchemaSnapshot = { version: 2, databases: {}, authProvider: 'neon' };
    const current: SchemaSnapshot = { version: 2, databases: {}, authProvider: 'd1' };
    const change = detectAuthProviderChange(saved, current);
    expect(change).not.toBeNull();
    expect(change!.oldProvider).toBe('neon');
    expect(change!.newProvider).toBe('d1');
  });

  it('defaults to d1 when authProvider is undefined', () => {
    const saved: SchemaSnapshot = { version: 2, databases: {} }; // no authProvider
    const current: SchemaSnapshot = { version: 2, databases: {} }; // no authProvider
    expect(detectAuthProviderChange(saved, current)).toBeNull();
  });

  it('detects change from undefined (d1) to explicit neon', () => {
    const saved: SchemaSnapshot = { version: 2, databases: {} }; // defaults to d1
    const current: SchemaSnapshot = { version: 2, databases: {}, authProvider: 'neon' };
    const change = detectAuthProviderChange(saved, current);
    expect(change).not.toBeNull();
    expect(change!.oldProvider).toBe('d1');
    expect(change!.newProvider).toBe('neon');
  });

  it('detects change from explicit postgres to undefined (d1)', () => {
    const saved: SchemaSnapshot = { version: 2, databases: {}, authProvider: 'postgres' };
    const current: SchemaSnapshot = { version: 2, databases: {} }; // defaults to d1
    const change = detectAuthProviderChange(saved, current);
    expect(change).not.toBeNull();
    expect(change!.oldProvider).toBe('postgres');
    expect(change!.newProvider).toBe('d1');
  });
});

// ======================================================================
// 7. detectProviderChanges — Data Namespace Provider Tracking
// ======================================================================

describe('detectProviderChanges', () => {
  it('returns empty array when no provider changes', () => {
    const saved: SchemaSnapshot = {
      version: 2,
      databases: { shared: { tables: {}, provider: 'do' } },
    };
    const current: SchemaSnapshot = {
      version: 2,
      databases: { shared: { tables: {}, provider: 'do' } },
    };
    expect(detectProviderChanges(saved, current)).toHaveLength(0);
  });

  it('detects do → d1 change', () => {
    const saved: SchemaSnapshot = {
      version: 2,
      databases: { shared: { tables: {}, provider: 'do' } },
    };
    const current: SchemaSnapshot = {
      version: 2,
      databases: { shared: { tables: {}, provider: 'd1' } },
    };
    const changes = detectProviderChanges(saved, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].namespace).toBe('shared');
    expect(changes[0].oldProvider).toBe('do');
    expect(changes[0].newProvider).toBe('d1');
  });

  it('detects d1 → neon change', () => {
    const saved: SchemaSnapshot = {
      version: 2,
      databases: { shared: { tables: {}, provider: 'd1' } },
    };
    const current: SchemaSnapshot = {
      version: 2,
      databases: { shared: { tables: {}, provider: 'neon' } },
    };
    const changes = detectProviderChanges(saved, current);
    expect(changes).toHaveLength(1);
    expect(changes[0].oldProvider).toBe('d1');
    expect(changes[0].newProvider).toBe('neon');
  });

  it('skips new namespaces (no saved entry)', () => {
    const saved: SchemaSnapshot = { version: 2, databases: {} };
    const current: SchemaSnapshot = {
      version: 2,
      databases: { newNs: { tables: {}, provider: 'neon' } },
    };
    expect(detectProviderChanges(saved, current)).toHaveLength(0);
  });

  it('detects multiple namespace changes', () => {
    const saved: SchemaSnapshot = {
      version: 2,
      databases: {
        shared: { tables: {}, provider: 'do' },
        analytics: { tables: {}, provider: 'd1' },
      },
    };
    const current: SchemaSnapshot = {
      version: 2,
      databases: {
        shared: { tables: {}, provider: 'neon' },
        analytics: { tables: {}, provider: 'neon' },
      },
    };
    const changes = detectProviderChanges(saved, current);
    expect(changes).toHaveLength(2);
  });

  it('defaults to "do" when provider is undefined', () => {
    const saved: SchemaSnapshot = {
      version: 2,
      databases: { shared: { tables: {} } }, // no provider = 'do'
    };
    const current: SchemaSnapshot = {
      version: 2,
      databases: { shared: { tables: {} } }, // no provider = 'do'
    };
    expect(detectProviderChanges(saved, current)).toHaveLength(0);
  });
});

// ======================================================================
// 8. buildSnapshot — authProvider tracking
// ======================================================================

describe('buildSnapshot — authProvider', () => {
  it('stores authProvider in snapshot when provided', () => {
    const snapshot = buildSnapshot({}, 'neon');
    expect(snapshot.authProvider).toBe('neon');
  });

  it('omits authProvider when not provided', () => {
    const snapshot = buildSnapshot({});
    expect(snapshot.authProvider).toBeUndefined();
  });

  it('stores provider per database namespace', () => {
    const databases: Record<string, DbBlockLike> = {
      shared: { tables: {}, provider: 'neon' },
    };
    const snapshot = buildSnapshot(databases);
    expect(snapshot.databases.shared.provider).toBe('neon');
  });

  it('round-trips authProvider through save/load', () => {
    const snapshot = buildSnapshot({}, 'postgres');
    saveSnapshot(tmpDir, snapshot);
    const loaded = loadSnapshot(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.authProvider).toBe('postgres');
  });
});

// ======================================================================
// 9. handleDestructiveChanges — agent-safe non-interactive behavior
// ======================================================================

describe('handleDestructiveChanges', () => {
  it('rejects release-mode resets as a structured error in non-interactive mode', async () => {
    setContext({ verbose: false, quiet: false, json: true, nonInteractive: true });

    await expect(handleDestructiveChanges([
      {
        dbKey: 'shared',
        table: 'posts',
        type: 'table_deleted',
        detail: 'shared.posts would be deleted',
      },
    ], true, false, 'reset')).rejects.toMatchObject({
      payload: expect.objectContaining({
        status: 'error',
        code: 'destructive_reset_not_allowed',
        field: 'ifDestructive',
      }),
    });
  });
});
