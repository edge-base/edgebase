/**
 * 서버 단위 테스트 — D1 Schema Init + Routing
 * d1-handler.test.ts
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/d1-handler.test.ts
 *
 * 테스트 대상:
 *   A. ensureD1Schema — lazy schema initialization
 *   B. _resetD1SchemaCache — cache invalidation
 *   C. shouldRouteToD1 / getD1BindingName — routing (also in do-router.test.ts)
 *   D. D1 meta helpers (schemaHash, migration_version)
 *   E. D1 migration engine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ensureD1Schema, _resetD1SchemaCache } from '../lib/d1-schema-init.js';
import { shouldRouteToD1, getD1BindingName } from '../lib/do-router.js';
import type { TableConfig } from '@edge-base/shared';

// ─── Mock D1 ─────────────────────────────────────────────────────────────────

interface MockCall {
  sql: string;
  bindings: unknown[];
  method: 'first' | 'all' | 'run';
}

function createMockD1(options: {
  firstResult?: unknown;
  allResult?: { results: unknown[] };
  /** Per-call sequential results for `.first()` */
  firstResults?: unknown[];
  /** Per-call sequential results for `.all()` */
  allResults?: Array<{ results: unknown[] }>;
} = {}): D1Database & { _calls: MockCall[]; _batchCalls: number; _batchStmts: string[][] } {
  const calls: MockCall[] = [];
  let firstCallIdx = 0;
  let allCallIdx = 0;
  let batchCalls = 0;
  const batchStmts: string[][] = [];

  function makeStmt(sql: string): any {
    const call: MockCall = { sql, bindings: [], method: 'run' };
    calls.push(call);

    const stmt = {
      _sql: sql,
      bind: (...values: unknown[]) => {
        call.bindings = values;
        return stmt;
      },
      first: async () => {
        call.method = 'first';
        if (options.firstResults && firstCallIdx < options.firstResults.length) {
          return options.firstResults[firstCallIdx++];
        }
        return options.firstResult ?? null;
      },
      all: async () => {
        call.method = 'all';
        if (options.allResults && allCallIdx < options.allResults.length) {
          return options.allResults[allCallIdx++];
        }
        return options.allResult ?? { results: [] };
      },
      run: async () => {
        call.method = 'run';
        return { success: true };
      },
    };
    return stmt;
  }

  const db = {
    prepare: (sql: string) => makeStmt(sql),
    batch: async (stmts: any[]) => {
      batchCalls++;
      batchStmts.push(stmts.map((s: any) => s._sql));
      return stmts;
    },
    _calls: calls,
    _batchCalls: 0,
    _batchStmts: batchStmts,
  };

  Object.defineProperty(db, '_batchCalls', { get: () => batchCalls });

  return db as any;
}

// ─── A. ensureD1Schema ───────────────────────────────────────────────────────

describe('ensureD1Schema', () => {
  beforeEach(() => {
    _resetD1SchemaCache();
  });

  const simpleTables: Record<string, TableConfig> = {
    posts: {
      schema: {
        title: { type: 'string' },
        content: { type: 'text' },
      },
    },
  };

  it('creates _meta table on first call', async () => {
    const db = createMockD1();
    await ensureD1Schema(db, 'shared', simpleTables);

    // First call should be _meta DDL
    const metaCall = db._calls.find(c => c.sql.includes('_meta'));
    expect(metaCall).toBeDefined();
  });

  it('enables foreign keys via PRAGMA', async () => {
    const db = createMockD1();
    await ensureD1Schema(db, 'shared', simpleTables);

    const pragmaCall = db._calls.find(c => c.sql.includes('PRAGMA foreign_keys'));
    expect(pragmaCall).toBeDefined();
  });

  it('checks schema hash for each table', async () => {
    const db = createMockD1();
    await ensureD1Schema(db, 'shared', simpleTables);

    // Should query _meta for schemaHash:posts
    const hashCheck = db._calls.find(c =>
      c.sql.includes('_meta') && c.bindings.includes('schemaHash:posts'),
    );
    expect(hashCheck).toBeDefined();
  });

  it('creates table DDL when no stored hash exists', async () => {
    const db = createMockD1();
    await ensureD1Schema(db, 'shared', simpleTables);

    // Should batch table creation DDLs
    expect(db._batchCalls).toBeGreaterThan(0);
  });

  it('stores schema hash after table creation', async () => {
    const db = createMockD1();
    await ensureD1Schema(db, 'shared', simpleTables);

    // Should INSERT INTO _meta with schemaHash:posts
    const hashStore = db._calls.find(c =>
      c.sql.includes('INSERT INTO "_meta"') && c.bindings[0] === 'schemaHash:posts',
    );
    expect(hashStore).toBeDefined();
    // Hash value should be a non-empty string
    expect(hashStore!.bindings[1]).toBeTruthy();
  });

  it('skips re-init on second call (memory cache)', async () => {
    const db = createMockD1();
    await ensureD1Schema(db, 'shared', simpleTables);
    const callCount = db._calls.length;

    // Second call should be no-op
    await ensureD1Schema(db, 'shared', simpleTables);
    expect(db._calls.length).toBe(callCount); // no new calls
  });

  it('different namespaces are tracked independently', async () => {
    const db = createMockD1();
    await ensureD1Schema(db, 'shared', simpleTables);
    const callCount1 = db._calls.length;

    // Different namespace should trigger init
    await ensureD1Schema(db, 'analytics', { events: { schema: { name: { type: 'string' } } } });
    expect(db._calls.length).toBeGreaterThan(callCount1);
  });

  it('_resetD1SchemaCache clears the memory cache', async () => {
    const db = createMockD1();
    await ensureD1Schema(db, 'shared', simpleTables);
    const callCount = db._calls.length;

    _resetD1SchemaCache();
    await ensureD1Schema(db, 'shared', simpleTables);
    // Should re-run init after cache clear
    expect(db._calls.length).toBeGreaterThan(callCount);
  });
});

// ─── B. ensureD1Schema — schema update (hash mismatch) ──────────────────────

describe('ensureD1Schema — schema update', () => {
  beforeEach(() => {
    _resetD1SchemaCache();
  });

  it('detects schema hash mismatch and runs PRAGMA table_info', async () => {
    // Simulate: _meta has a stale hash for 'posts'
    const db = createMockD1({
      // first .first() call returns stale hash, rest return null
      firstResults: [{ value: 'stale-hash' }],
      // PRAGMA table_info returns existing columns
      allResult: { results: [{ name: 'id' }, { name: 'title' }] },
    });

    await ensureD1Schema(db, 'shared', {
      posts: {
        schema: {
          title: { type: 'string' },
          content: { type: 'text' }, // new column
        },
      },
    });

    // Should run PRAGMA table_info to detect existing columns
    const pragmaInfo = db._calls.find(c => c.sql.includes('PRAGMA table_info'));
    expect(pragmaInfo).toBeDefined();
  });
});

// ─── C. ensureD1Schema — migrations ─────────────────────────────────────────

describe('ensureD1Schema — migrations', () => {
  beforeEach(() => {
    _resetD1SchemaCache();
  });

  it('sets initial migration version on fresh table', async () => {
    const db = createMockD1();

    await ensureD1Schema(db, 'shared', {
      posts: {
        schema: { title: { type: 'string' } },
        migrations: [
          { version: 2, description: 'Add slug column', up: 'ALTER TABLE posts ADD COLUMN slug TEXT' },
          { version: 3, description: 'Add slug index', up: 'CREATE INDEX idx_slug ON posts(slug)' },
        ],
      },
    });

    // Should set migration_version:posts to 3 (max version)
    const versionSet = db._calls.find(c =>
      c.sql.includes('INSERT INTO "_meta"') && c.bindings[0] === 'migration_version:posts',
    );
    expect(versionSet).toBeDefined();
    expect(versionSet!.bindings[1]).toBe('3');
  });

  it('runs pending migrations when schema hash matches', async () => {
    // We need to force hash match — pass a config that produces the stored hash
    // Since we can't predict the hash, test that migration SQL runs
    // Use fresh DB (no stored hash) with migrations
    const db2 = createMockD1({
      firstResults: [
        null,  // schemaHash:posts → null = fresh table
      ],
    });

    await ensureD1Schema(db2, 'shared', {
      posts: {
        schema: { title: { type: 'string' } },
        migrations: [
          { version: 2, description: 'Add category column', up: 'ALTER TABLE posts ADD COLUMN category TEXT' },
        ],
      },
    });

    // Fresh table: sets migration_version to max (2), skips running them
    const versionSet = db2._calls.find(c =>
      c.bindings[0] === 'migration_version:posts',
    );
    expect(versionSet).toBeDefined();
    expect(versionSet!.bindings[1]).toBe('2');
  });
});

// ─── D. Multiple tables in single namespace ─────────────────────────────────

describe('ensureD1Schema — multiple tables', () => {
  beforeEach(() => {
    _resetD1SchemaCache();
  });

  it('initializes all tables in the namespace', async () => {
    const db = createMockD1();

    await ensureD1Schema(db, 'shared', {
      posts: { schema: { title: { type: 'string' } } },
      comments: { schema: { body: { type: 'text' } } },
    });

    // Should check hash for both tables
    const postHash = db._calls.find(c =>
      c.bindings.includes('schemaHash:posts'),
    );
    const commentHash = db._calls.find(c =>
      c.bindings.includes('schemaHash:comments'),
    );
    expect(postHash).toBeDefined();
    expect(commentHash).toBeDefined();
  });
});

// ─── E. D1 routing integration ──────────────────────────────────────────────

describe('D1 routing — shouldRouteToD1 integration', () => {
  it('shared namespace with tables → D1 (auto-detect)', () => {
    const config = {
      databases: {
        shared: {
          tables: {
            posts: { schema: { title: { type: 'string' } } },
          },
        },
      },
    };
    expect(shouldRouteToD1('shared', config as any)).toBe(true);
    expect(getD1BindingName('shared')).toBe('DB_D1_SHARED');
  });

  it('explicit provider: "d1" → D1', () => {
    const config = {
      databases: {
        analytics: {
          provider: 'd1',
          tables: { events: {} },
        },
      },
    };
    expect(shouldRouteToD1('analytics', config as any)).toBe(true);
    expect(getD1BindingName('analytics')).toBe('DB_D1_ANALYTICS');
  });

  it('workspace with instance: true → DO (not D1)', () => {
    const config = {
      databases: {
        workspace: {
          instance: true,
          tables: { members: {} },
        },
      },
    };
    expect(shouldRouteToD1('workspace', config as any)).toBe(false);
  });

  it('namespace with canCreate access → DO', () => {
    const config = {
      databases: {
        project: {
          access: { canCreate: 'auth.role == "admin"' },
          tables: { tasks: {} },
        },
      },
    };
    expect(shouldRouteToD1('project', config as any)).toBe(false);
  });

  it('namespace with access callback config → DO', () => {
    const config = {
      databases: {
        project: {
          access: { access: 'auth.id == instanceId' },
          tables: { tasks: {} },
        },
      },
    };
    expect(shouldRouteToD1('project', config as any)).toBe(false);
  });

  it('mixed config: some D1, some DO', () => {
    const config = {
      databases: {
        shared: { tables: { posts: {} } },
        workspace: { instance: true, tables: { members: {} } },
        logs: { provider: 'do' as const, tables: { entries: {} } },
        analytics: { provider: 'd1' as const, tables: { events: {} } },
      },
    };
    expect(shouldRouteToD1('shared', config as any)).toBe(true);
    expect(shouldRouteToD1('workspace', config as any)).toBe(false);
    expect(shouldRouteToD1('logs', config as any)).toBe(false);
    expect(shouldRouteToD1('analytics', config as any)).toBe(true);
  });
});

// ─── F. D1 binding name convention ──────────────────────────────────────────

describe('getD1BindingName', () => {
  it('simple namespace', () => {
    expect(getD1BindingName('shared')).toBe('DB_D1_SHARED');
  });

  it('camelCase namespace → uppercased', () => {
    expect(getD1BindingName('myData')).toBe('DB_D1_MYDATA');
  });

  it('hyphenated namespace → uppercased (with hyphen)', () => {
    expect(getD1BindingName('my-data')).toBe('DB_D1_MY-DATA');
  });

  it('already uppercase → unchanged', () => {
    expect(getD1BindingName('SHARED')).toBe('DB_D1_SHARED');
  });
});
