/**
 * 서버 단위 테스트 — lib/schema.ts
 * 1-03 schema.test.ts — 80개
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/schema.test.ts
 *
 * 테스트 대상:
 *   buildEffectiveSchema — auto fields injection / user overrides / schemaless
 *   generateCreateTableDDL — column types + constraints
 *   generateAddColumnDDL — ADD COLUMN DDL
 *   generateIndexDDL — single/composite/unique
 *   generateFTS5DDL — FTS5 virtual table
 *   generateFTS5Triggers — INSERT/DELETE/UPDATE triggers
 *   computeSchemaHash / computeSchemaHashSync — deterministic
 *   generateTableDDL — full table DDL array
 */

import { describe, it, expect } from 'vitest';
import {
  buildEffectiveSchema,
  generateCreateTableDDL,
  generateAddColumnDDL,
  generateIndexDDL,
  generateFTS5DDL,
  generateFTS5Triggers,
  computeSchemaHash,
  computeSchemaHashSync,
  generateTableDDL,
  META_TABLE_DDL,
  // PostgreSQL DDL
  PG_META_TABLE_DDL,
  generatePgCreateTableDDL,
  generatePgAddColumnDDL,
  generatePgIndexDDL,
  generatePgFTSDDL,
  generatePgTableDDL,
} from '../lib/schema.js';
import { AUTH_D1_SCHEMA } from '../lib/auth-d1.js';
import { zodDefaultHook } from '../lib/schemas.js';
import type { TableConfig } from '@edge-base/shared';

// ─── A. buildEffectiveSchema ──────────────────────────────────────────────────

describe('buildEffectiveSchema', () => {
  it('no user schema → auto fields only (id, createdAt, updatedAt)', () => {
    const schema = buildEffectiveSchema(undefined);
    expect(Object.keys(schema)).toContain('id');
    expect(Object.keys(schema)).toContain('createdAt');
    expect(Object.keys(schema)).toContain('updatedAt');
    expect(Object.keys(schema)).toHaveLength(3);
  });

  it('user fields added alongside auto fields', () => {
    const schema = buildEffectiveSchema({ title: { type: 'string' } });
    expect(Object.keys(schema)).toContain('id');
    expect(Object.keys(schema)).toContain('title');
  });

  it('user can set auto field to false to disable it', () => {
    const schema = buildEffectiveSchema({ updatedAt: false });
    expect(Object.keys(schema)).not.toContain('updatedAt');
    expect(Object.keys(schema)).toContain('id');
    expect(Object.keys(schema)).toContain('createdAt');
  });

  it('auto-field type override is ignored — always uses default type', () => {
    // Even if user schema object is passed for an auto-field, the default type is used
    // (defineConfig blocks this at validation, but buildEffectiveSchema also ignores overrides)
    const schema = buildEffectiveSchema({ id: { type: 'number', primaryKey: true } });
    // id in AUTO_FIELDS is always 'string' — user object treated as "present, not false" → default injected
    expect(schema.id.type).toBe('string');
    expect(schema.id.primaryKey).toBe(true);
  });

  it('multiple user fields all included', () => {
    const schema = buildEffectiveSchema({
      title: { type: 'string' },
      views: { type: 'number' },
      active: { type: 'boolean' },
    });
    expect(Object.keys(schema)).toContain('title');
    expect(Object.keys(schema)).toContain('views');
    expect(Object.keys(schema)).toContain('active');
  });

  it('disabling all auto fields', () => {
    const schema = buildEffectiveSchema({ id: false, createdAt: false, updatedAt: false });
    expect(Object.keys(schema)).toHaveLength(0);
  });
});

// ─── B. generateCreateTableDDL ───────────────────────────────────────────────

describe('generateCreateTableDDL', () => {
  it('generates CREATE TABLE IF NOT EXISTS', () => {
    const ddl = generateCreateTableDDL('posts', { schema: {} } as TableConfig);
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS');
    expect(ddl).toContain('"posts"');
  });

  it('id column is PRIMARY KEY', () => {
    const ddl = generateCreateTableDDL('posts', { schema: {} } as TableConfig);
    expect(ddl).toContain('PRIMARY KEY');
  });

  it('string → TEXT type', () => {
    const ddl = generateCreateTableDDL('t', { schema: { title: { type: 'string' } } } as TableConfig);
    expect(ddl).toContain('"title" TEXT');
  });

  it('number → REAL type', () => {
    const ddl = generateCreateTableDDL('t', { schema: { views: { type: 'number' } } } as TableConfig);
    expect(ddl).toContain('"views" REAL');
  });

  it('boolean → INTEGER type', () => {
    const ddl = generateCreateTableDDL('t', { schema: { active: { type: 'boolean' } } } as TableConfig);
    expect(ddl).toContain('"active" INTEGER');
  });

  it('json → TEXT type', () => {
    const ddl = generateCreateTableDDL('t', { schema: { data: { type: 'json' } } } as TableConfig);
    expect(ddl).toContain('"data" TEXT');
  });

  it('datetime → TEXT type', () => {
    const ddl = generateCreateTableDDL('t', { schema: { ts: { type: 'datetime' } } } as TableConfig);
    expect(ddl).toContain('"ts" TEXT');
  });

  it('required field → NOT NULL', () => {
    const ddl = generateCreateTableDDL('t', { schema: { email: { type: 'string', required: true } } } as TableConfig);
    expect(ddl).toContain('NOT NULL');
  });

  it('unique field → UNIQUE', () => {
    const ddl = generateCreateTableDDL('t', { schema: { slug: { type: 'string', unique: true } } } as TableConfig);
    expect(ddl).toContain('UNIQUE');
  });

  it('default string value', () => {
    const ddl = generateCreateTableDDL('t', { schema: { role: { type: 'string', default: 'user' } } } as TableConfig);
    expect(ddl).toContain("DEFAULT 'user'");
  });

  it('default boolean value', () => {
    const ddl = generateCreateTableDDL('t', { schema: { active: { type: 'boolean', default: true } } } as TableConfig);
    expect(ddl).toContain('DEFAULT 1');
  });

  it('default null value', () => {
    const ddl = generateCreateTableDDL('t', { schema: { deletedAt: { type: 'datetime', default: null } } } as TableConfig);
    expect(ddl).toContain('DEFAULT NULL');
  });

  it('primary key field not marked NOT NULL (PK is implicit NOT NULL)', () => {
    const ddl = generateCreateTableDDL('t', { schema: {} } as TableConfig);
    // id is PRIMARY KEY, should not have duplicate NOT NULL
    // The check: required && !primaryKey → NOT NULL
    const idLine = ddl.split('\n').find((l) => l.includes('"id"'));
    expect(idLine).toContain('PRIMARY KEY');
  });
});

// ─── C. generateAddColumnDDL ─────────────────────────────────────────────────

describe('generateAddColumnDDL', () => {
  it('generates ALTER TABLE ADD COLUMN', () => {
    const ddl = generateAddColumnDDL('posts', 'rating', { type: 'number' });
    expect(ddl).toContain('ALTER TABLE "posts" ADD COLUMN "rating" REAL');
  });

  it('with NOT NULL constraint', () => {
    const ddl = generateAddColumnDDL('t', 'email', { type: 'string', required: true });
    expect(ddl).toContain('NOT NULL');
  });

  it('with DEFAULT value', () => {
    const ddl = generateAddColumnDDL('t', 'active', { type: 'boolean', default: false });
    expect(ddl).toContain('DEFAULT 0');
  });

  it('ends with semicolon', () => {
    const ddl = generateAddColumnDDL('t', 'col', { type: 'string' });
    expect(ddl.trim()).toMatch(/;$/);
  });
});

// ─── D. generateIndexDDL ─────────────────────────────────────────────────────

describe('generateIndexDDL', () => {
  it('single-field index', () => {
    const ddls = generateIndexDDL('posts', [{ fields: ['status'] }]);
    expect(ddls).toHaveLength(1);
    expect(ddls[0]).toContain('CREATE INDEX IF NOT EXISTS');
    expect(ddls[0]).toContain('"posts"("status")');
  });

  it('unique index', () => {
    const ddls = generateIndexDDL('posts', [{ fields: ['slug'], unique: true }]);
    expect(ddls[0]).toContain('UNIQUE INDEX');
  });

  it('composite index (multi-field)', () => {
    const ddls = generateIndexDDL('posts', [{ fields: ['userId', 'createdAt'] }]);
    expect(ddls[0]).toContain('"userId"');
    expect(ddls[0]).toContain('"createdAt"');
  });

  it('index name derived from table + fields', () => {
    const ddls = generateIndexDDL('posts', [{ fields: ['status'] }]);
    expect(ddls[0]).toContain('idx_posts_status');
  });

  it('multiple indexes', () => {
    const ddls = generateIndexDDL('t', [
      { fields: ['a'] },
      { fields: ['b', 'c'] },
    ]);
    expect(ddls).toHaveLength(2);
  });

  it('empty indexes → empty array', () => {
    const ddls = generateIndexDDL('t', []);
    expect(ddls).toEqual([]);
  });
});

// ─── E. generateFTS5DDL ────────────────────────────────────────────────────

describe('generateFTS5DDL', () => {
  it('creates virtual table with _fts suffix', () => {
    const ddl = generateFTS5DDL('posts', ['title', 'body']);
    expect(ddl).toContain('"posts_fts"');
    expect(ddl).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS');
  });

  it('uses fts5 engine', () => {
    const ddl = generateFTS5DDL('posts', ['title']);
    expect(ddl).toContain('USING fts5');
  });

  it('includes content table reference', () => {
    const ddl = generateFTS5DDL('posts', ['title']);
    expect(ddl).toContain("content='posts'");
  });

  it('uses trigram tokenizer', () => {
    const ddl = generateFTS5DDL('posts', ['title']);
    expect(ddl).toContain("tokenize='trigram'");
  });

  it('includes all FTS fields', () => {
    const ddl = generateFTS5DDL('articles', ['title', 'content', 'tags']);
    expect(ddl).toContain('title');
    expect(ddl).toContain('content');
    expect(ddl).toContain('tags');
  });
});

// ─── F. generateFTS5Triggers ──────────────────────────────────────────────

describe('generateFTS5Triggers', () => {
  it('generates 3 triggers (INSERT, DELETE, UPDATE)', () => {
    const triggers = generateFTS5Triggers('posts', ['title']);
    expect(triggers).toHaveLength(3);
  });

  it('INSERT trigger: AFTER INSERT', () => {
    const triggers = generateFTS5Triggers('posts', ['title']);
    expect(triggers[0]).toContain('AFTER INSERT ON "posts"');
  });

  it('DELETE trigger: AFTER DELETE', () => {
    const triggers = generateFTS5Triggers('posts', ['title']);
    expect(triggers[1]).toContain('AFTER DELETE ON "posts"');
  });

  it('UPDATE trigger: AFTER UPDATE', () => {
    const triggers = generateFTS5Triggers('posts', ['title']);
    expect(triggers[2]).toContain('AFTER UPDATE ON "posts"');
  });

  it('trigger names use _ai, _ad, _au suffixes', () => {
    const triggers = generateFTS5Triggers('posts', ['title']);
    expect(triggers[0]).toContain('posts_ai');
    expect(triggers[1]).toContain('posts_ad');
    expect(triggers[2]).toContain('posts_au');
  });
});

// ─── G. computeSchemaHash (async SHA-256) ────────────────────────────────────

describe('computeSchemaHash', () => {
  it('returns a hex string', async () => {
    const hash = await computeSchemaHash({ schema: { title: { type: 'string' } } } as TableConfig);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('deterministic — same input → same hash', async () => {
    const cfg: TableConfig = { schema: { title: { type: 'string' } } } as TableConfig;
    const h1 = await computeSchemaHash(cfg);
    const h2 = await computeSchemaHash(cfg);
    expect(h1).toBe(h2);
  });

  it('different schema → different hash', async () => {
    const h1 = await computeSchemaHash({ schema: { a: { type: 'string' } } } as TableConfig);
    const h2 = await computeSchemaHash({ schema: { b: { type: 'number' } } } as TableConfig);
    expect(h1).not.toBe(h2);
  });

  it('SHA-256 produces 64-char hex', async () => {
    const hash = await computeSchemaHash({} as TableConfig);
    expect(hash).toHaveLength(64);
  });
});

// ─── H. computeSchemaHashSync (djb2) ─────────────────────────────────────────

describe('computeSchemaHashSync', () => {
  it('returns an 8-char hex string', () => {
    const hash = computeSchemaHashSync({ schema: { title: { type: 'string' } } } as TableConfig);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('deterministic with same schema', () => {
    const cfg = { schema: { a: { type: 'string' } } } as TableConfig;
    expect(computeSchemaHashSync(cfg)).toBe(computeSchemaHashSync(cfg));
  });

  it('different schema → different hash', () => {
    const h1 = computeSchemaHashSync({ schema: { x: { type: 'string' } } } as TableConfig);
    const h2 = computeSchemaHashSync({ schema: { y: { type: 'number' } } } as TableConfig);
    expect(h1).not.toBe(h2);
  });

  it('access field ignored (functions serialize to undefined)', () => {
    // Same schema field, different access functions → same hash
    const h1 = computeSchemaHashSync({ schema: { a: { type: 'string' } } } as TableConfig);
    const h2 = computeSchemaHashSync({
      schema: { a: { type: 'string' } },
      access: { read: () => true },
    } as unknown as TableConfig);
    expect(h1).toBe(h2);
  });
});

// ─── I. generateTableDDL ─────────────────────────────────────────────────────

describe('generateTableDDL', () => {
  it('returns array with CREATE TABLE', () => {
    const ddls = generateTableDDL('posts', { schema: {} } as TableConfig);
    expect(ddls.length).toBeGreaterThanOrEqual(1);
    expect(ddls[0]).toContain('CREATE TABLE');
  });

  it('with indexes → includes CREATE INDEX', () => {
    const ddls = generateTableDDL('posts', {
      schema: {},
      indexes: [{ fields: ['status'] }],
    } as TableConfig);
    expect(ddls.some((d) => d.includes('CREATE INDEX'))).toBe(true);
  });

  it('with FTS → includes CREATE VIRTUAL TABLE + 3 triggers', () => {
    const ddls = generateTableDDL('posts', {
      schema: { title: { type: 'string' } },
      fts: ['title'],
    } as TableConfig);
    expect(ddls.some((d) => d.includes('VIRTUAL TABLE'))).toBe(true);
    // 1 CREATE TABLE + 1 FTS + 3 triggers = 5
    expect(ddls.length).toBeGreaterThanOrEqual(4);
  });

  it('no FTS → no triggers', () => {
    const ddls = generateTableDDL('posts', { schema: {} } as TableConfig);
    expect(ddls.every((d) => !d.includes('TRIGGER'))).toBe(true);
  });
});

// ─── J. System DDL constants ──────────────────────────────────────────────────

describe('system DDL constants', () => {
  it('META_TABLE_DDL creates _meta table', () => {
    expect(META_TABLE_DDL).toContain('_meta');
    expect(META_TABLE_DDL).toContain('key TEXT PRIMARY KEY');
  });

  it('AUTH_D1_SCHEMA creates _users_public table', () => {
    expect(AUTH_D1_SCHEMA).toContain('_users_public');
    expect(AUTH_D1_SCHEMA).toContain('email');
    expect(AUTH_D1_SCHEMA).toContain('CREATE INDEX');
  });

  it('AUTH_D1_SCHEMA no longer defines _schedules table', () => {
    expect(AUTH_D1_SCHEMA).not.toContain('_schedules');
  });
});

// ─── K. Edge cases (mutation coverage) ──────────────────────────────────────

describe('buildEffectiveSchema — edge cases', () => {
  it('user field set to false (non-auto) → excluded', () => {
    const schema = buildEffectiveSchema({ title: false, body: { type: 'string' } });
    expect(Object.keys(schema)).not.toContain('title');
    expect(Object.keys(schema)).toContain('body');
  });

  it('empty user schema → auto fields only', () => {
    const schema = buildEffectiveSchema({});
    expect(Object.keys(schema)).toEqual(['id', 'createdAt', 'updatedAt']);
  });
});

describe('generateCreateTableDDL — edge cases', () => {
  it('unknown field type → fallback to TEXT', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { exotic: { type: 'vector' as any } },
    } as TableConfig);
    expect(ddl).toContain('"exotic" TEXT');
  });

  it('required + primaryKey → only PRIMARY KEY (no NOT NULL)', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { pk: { type: 'string', primaryKey: true, required: true } },
    } as TableConfig);
    const pkLine = ddl.split('\n').find((l) => l.includes('"pk"'))!;
    expect(pkLine).toContain('PRIMARY KEY');
    // required + primaryKey should NOT add NOT NULL (it's implicit)
    expect(pkLine).not.toContain('NOT NULL');
  });

  it('default number value', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { count: { type: 'number', default: 42 } },
    } as TableConfig);
    expect(ddl).toContain('DEFAULT 42');
  });

  it('default false boolean → DEFAULT 0', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { active: { type: 'boolean', default: false } },
    } as TableConfig);
    expect(ddl).toContain('DEFAULT 0');
  });

  it('string default with single quote → escaped', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { note: { type: 'string', default: "it's" } },
    } as TableConfig);
    expect(ddl).toContain("DEFAULT 'it''s'");
  });

  it('field with auth user references string form stays logical only', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { userId: { type: 'string', references: 'users' } },
    } as TableConfig);
    expect(ddl).not.toContain('REFERENCES "users"("id")');
  });

  it('field with auth references string form (with column) stays logical only', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { userId: { type: 'string', references: 'users(uid)' } },
    } as TableConfig);
    expect(ddl).not.toContain('REFERENCES "users"("uid")');
  });

  it('field with non-auth references string form emits a physical FK', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { orderId: { type: 'string', references: 'orders' } },
    } as TableConfig);
    expect(ddl).toContain('REFERENCES "orders"("id") ON DELETE SET NULL');
  });

  it('field with references object form', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: {
        categoryId: {
          type: 'string',
          references: { table: 'categories', column: 'cid', onDelete: 'CASCADE', onUpdate: 'SET NULL' },
        },
      },
    } as TableConfig);
    expect(ddl).toContain('REFERENCES "categories"("cid")');
    expect(ddl).toContain('ON DELETE CASCADE');
    expect(ddl).toContain('ON UPDATE SET NULL');
  });

  it('field with references object form (default column)', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: {
        postId: { type: 'string', references: { table: 'posts' } },
      },
    } as TableConfig);
    expect(ddl).toContain('REFERENCES "posts"("id")');
  });

  it('field with check constraint', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { age: { type: 'number', check: 'age >= 0' } },
    } as TableConfig);
    expect(ddl).toContain('CHECK (age >= 0)');
  });

  it('identifier with double-quote → escaped', () => {
    const ddl = generateCreateTableDDL('my"table', { schema: {} } as TableConfig);
    expect(ddl).toContain('"my""table"');
  });
});

describe('computeSchemaHashSync — edge cases', () => {
  it('empty schema → consistent hash', () => {
    const h1 = computeSchemaHashSync({} as TableConfig);
    const h2 = computeSchemaHashSync({} as TableConfig);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{8}$/);
  });

  it('key ordering does not matter (deep sorted)', () => {
    const h1 = computeSchemaHashSync({
      schema: { a: { type: 'string' }, b: { type: 'number' } },
    } as TableConfig);
    const h2 = computeSchemaHashSync({
      schema: { b: { type: 'number' }, a: { type: 'string' } },
    } as TableConfig);
    expect(h1).toBe(h2);
  });
});

describe('generateTableDDL — edge cases', () => {
  it('no indexes, no fts → only CREATE TABLE', () => {
    const ddls = generateTableDDL('simple', { schema: {} } as TableConfig);
    expect(ddls).toHaveLength(1);
    expect(ddls[0]).toContain('CREATE TABLE');
  });

  it('indexes + fts combined', () => {
    const ddls = generateTableDDL('full', {
      schema: { title: { type: 'string' }, status: { type: 'string' } },
      indexes: [{ fields: ['status'] }],
      fts: ['title'],
    } as TableConfig);
    // 1 CREATE TABLE + 1 INDEX + 1 FTS + 3 triggers = 6
    expect(ddls).toHaveLength(6);
  });

  it('empty indexes array → no CREATE INDEX', () => {
    const ddls = generateTableDDL('t', {
      schema: {},
      indexes: [],
    } as TableConfig);
    expect(ddls.every((d) => !d.includes('CREATE INDEX'))).toBe(true);
  });

  it('empty fts array → no FTS', () => {
    const ddls = generateTableDDL('t', {
      schema: {},
      fts: [],
    } as TableConfig);
    expect(ddls.every((d) => !d.includes('VIRTUAL TABLE'))).toBe(true);
  });
});

describe('generateFTS5DDL — edge cases', () => {
  it('single field', () => {
    const ddl = generateFTS5DDL('t', ['body']);
    expect(ddl).toContain('body');
    expect(ddl).toContain("content='t'");
  });
});

describe('generateFTS5Triggers — edge cases', () => {
  it('multiple fields → all included in triggers', () => {
    const triggers = generateFTS5Triggers('t', ['title', 'body', 'tags']);
    // INSERT trigger should reference all new.fields
    expect(triggers[0]).toContain('new."title"');
    expect(triggers[0]).toContain('new."body"');
    expect(triggers[0]).toContain('new."tags"');
    // DELETE trigger should reference all old.fields
    expect(triggers[1]).toContain('old."title"');
    expect(triggers[1]).toContain('old."body"');
    expect(triggers[1]).toContain('old."tags"');
  });
});

// ─── Mutation-killing: schema precision tests ──────────────────────────────

describe('buildColumnDef — mutation-killing', () => {
  it('primaryKey → DDL includes PRIMARY KEY', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { myid: { type: 'string', primaryKey: true } },
    } as TableConfig);
    expect(ddl).toContain('"myid" TEXT PRIMARY KEY');
  });

  it('required non-PK → DDL includes NOT NULL', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { name: { type: 'string', required: true } },
    } as TableConfig);
    expect(ddl).toContain('NOT NULL');
  });

  it('required + PK → DDL has PRIMARY KEY but NOT "NOT NULL"', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { myid: { type: 'string', primaryKey: true, required: true } },
    } as TableConfig);
    expect(ddl).toContain('PRIMARY KEY');
    // PK fields should not also have NOT NULL (redundant in SQLite)
    expect(ddl).not.toMatch(/"myid".*NOT NULL/);
  });

  it('unique → DDL includes UNIQUE', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { email: { type: 'string', unique: true } },
    } as TableConfig);
    expect(ddl).toContain('UNIQUE');
  });

  it('default string → DDL includes DEFAULT with escaped quotes', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { status: { type: 'string', default: "it's" } },
    } as TableConfig);
    expect(ddl).toContain("DEFAULT 'it''s'");
  });

  it('default number → DDL includes DEFAULT with number value', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { count: { type: 'number', default: 42 } },
    } as TableConfig);
    expect(ddl).toContain('DEFAULT 42');
  });

  it('default boolean true → DEFAULT 1', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { active: { type: 'boolean', default: true } },
    } as TableConfig);
    expect(ddl).toContain('DEFAULT 1');
  });

  it('default boolean false → DEFAULT 0', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { active: { type: 'boolean', default: false } },
    } as TableConfig);
    expect(ddl).toContain('DEFAULT 0');
  });

  it('default null → DEFAULT NULL', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { notes: { type: 'string', default: null } },
    } as TableConfig);
    expect(ddl).toContain('DEFAULT NULL');
  });

  it('references string "users(col)" form stays logical only', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { userId: { type: 'string', references: 'users(id)' } },
    } as TableConfig);
    expect(ddl).not.toContain('REFERENCES "users"("id")');
  });

  it('references plain auth table name stays logical only', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { userId: { type: 'string', references: 'users' } },
    } as TableConfig);
    expect(ddl).not.toContain('REFERENCES "users"("id")');
  });

  it('references plain non-auth table name emits a physical FK', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { orderId: { type: 'string', references: 'orders' } },
    } as TableConfig);
    expect(ddl).toContain('REFERENCES "orders"("id") ON DELETE SET NULL');
  });

  it('references auth object form stays logical only', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: {
        userId: {
          type: 'string',
          references: { table: 'users', column: 'uid', onDelete: 'CASCADE', onUpdate: 'SET NULL' },
        },
      },
    } as TableConfig);
    expect(ddl).not.toContain('REFERENCES "users"("uid")');
  });

  it('check constraint → DDL includes CHECK', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { age: { type: 'number', check: 'age >= 0' } },
    } as TableConfig);
    expect(ddl).toContain('CHECK (age >= 0)');
  });
});

describe('buildEffectiveSchema — mutation-killing', () => {
  it('auto-fields are copies (not references)', () => {
    const schema1 = buildEffectiveSchema();
    const schema2 = buildEffectiveSchema();
    // Modifying one should not affect the other
    schema1.id.type = 'number' as any;
    expect(schema2.id.type).toBe('string');
  });

  it('columns joined with comma-newline-indent in DDL', () => {
    const ddl = generateCreateTableDDL('t', {
      schema: { a: { type: 'string' }, b: { type: 'number' } },
    } as TableConfig);
    // Verify columns are separated properly
    expect(ddl).toContain(',\n  ');
  });
});

describe('generateIndexDDL — mutation-killing', () => {
  it('composite index fields joined with comma-space', () => {
    const ddls = generateIndexDDL('t', [{ fields: ['a', 'b', 'c'] }]);
    expect(ddls[0]).toContain('"a", "b", "c"');
  });

  it('index name uses underscore between field names', () => {
    const ddls = generateIndexDDL('t', [{ fields: ['first', 'last'] }]);
    expect(ddls[0]).toContain('"idx_t_first_last"');
  });

  it('unique index includes UNIQUE keyword', () => {
    const ddls = generateIndexDDL('t', [{ fields: ['email'], unique: true }]);
    expect(ddls[0]).toContain('CREATE UNIQUE INDEX');
  });

  it('non-unique index has no UNIQUE keyword', () => {
    const ddls = generateIndexDDL('t', [{ fields: ['status'] }]);
    expect(ddls[0]).not.toContain('UNIQUE');
  });
});

describe('generateFTS5DDL — mutation-killing', () => {
  it('FTS table name is tableName_fts', () => {
    const ddl = generateFTS5DDL('posts', ['title']);
    expect(ddl).toContain('"posts_fts"');
  });

  it('fields listed in fts5() definition', () => {
    const ddl = generateFTS5DDL('t', ['title', 'body']);
    expect(ddl).toContain('fts5(title, body,');
  });

  it("content sync references base table with content='tableName'", () => {
    const ddl = generateFTS5DDL('posts', ['title']);
    expect(ddl).toContain("content='posts'");
  });
});

describe('generateFTS5Triggers — mutation-killing', () => {
  it('INSERT trigger name format: tableName_ai', () => {
    const triggers = generateFTS5Triggers('posts', ['title']);
    expect(triggers[0]).toContain('"posts_ai"');
  });

  it('DELETE trigger name format: tableName_ad', () => {
    const triggers = generateFTS5Triggers('posts', ['title']);
    expect(triggers[1]).toContain('"posts_ad"');
  });

  it('UPDATE trigger name format: tableName_au', () => {
    const triggers = generateFTS5Triggers('posts', ['title']);
    expect(triggers[2]).toContain('"posts_au"');
  });

  it('DELETE trigger inserts "delete" marker', () => {
    const triggers = generateFTS5Triggers('posts', ['title']);
    expect(triggers[1]).toContain("'delete'");
  });

  it('UPDATE trigger has delete-then-insert pattern', () => {
    const triggers = generateFTS5Triggers('posts', ['title']);
    expect(triggers[2]).toContain("'delete'");
    expect(triggers[2]).toContain('new."title"');
  });

  it('field list in triggers uses comma-space separator', () => {
    const triggers = generateFTS5Triggers('t', ['a', 'b']);
    expect(triggers[0]).toContain('"a", "b"');
  });
});

describe('computeSchemaHashSync — mutation-killing', () => {
  it('different schemas produce different hashes', () => {
    const h1 = computeSchemaHashSync({ schema: { a: { type: 'string' } } } as TableConfig);
    const h2 = computeSchemaHashSync({ schema: { b: { type: 'number' } } } as TableConfig);
    expect(h1).not.toBe(h2);
  });

  it('hash is 8-character hex string', () => {
    const h = computeSchemaHashSync({ schema: {} } as TableConfig);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
  });

  it('key order does not affect hash (deep sort)', () => {
    const h1 = computeSchemaHashSync({ schema: { a: { type: 'string' }, b: { type: 'number' } } } as TableConfig);
    const h2 = computeSchemaHashSync({ schema: { b: { type: 'number' }, a: { type: 'string' } } } as TableConfig);
    expect(h1).toBe(h2);
  });
});

// ─── L. zodDefaultHook (schemas.ts) ──────────────────────────────────────────

describe('zodDefaultHook', () => {
  function mockContext() {
    let lastJson: unknown;
    let lastStatus: number;
    return {
      json: (data: unknown, status: number) => { lastJson = data; lastStatus = status; return { data, status }; },
      get lastJson() { return lastJson; },
      get lastStatus() { return lastStatus; },
    };
  }

  it('returns nothing on success', () => {
    const c = mockContext();
    const result = zodDefaultHook({ success: true }, c);
    expect(result).toBeUndefined();
  });

  it('returns 400 with joined issue messages', () => {
    const c = mockContext();
    const result = zodDefaultHook({
      success: false,
      error: { issues: [{ message: 'field required', path: ['body', 'email'] }, { message: 'invalid type' }] },
    }, c);
    expect(result).toBeDefined();
    expect(c.lastJson).toEqual({ code: 400, message: 'body.email: field required, invalid type' });
    expect(c.lastStatus).toBe(400);
  });

  it('handles Zod v3 errors array', () => {
    const c = mockContext();
    zodDefaultHook({
      success: false,
      error: { errors: [{ message: 'too short' }] },
    }, c);
    expect(c.lastJson).toEqual({ code: 400, message: 'too short' });
  });

  it('handles empty issues → default message', () => {
    const c = mockContext();
    zodDefaultHook({
      success: false,
      error: { issues: [] },
    }, c);
    expect(c.lastJson).toEqual({ code: 400, message: 'Request validation failed.' });
  });

  it('handles missing error.issues and error.errors', () => {
    const c = mockContext();
    zodDefaultHook({
      success: false,
      error: {},
    }, c);
    expect(c.lastJson).toEqual({ code: 400, message: 'Request validation failed.' });
  });

  it('handles undefined error', () => {
    const c = mockContext();
    zodDefaultHook({
      success: false,
    }, c);
    expect(c.lastJson).toEqual({ code: 400, message: 'Request validation failed.' });
  });

  it('formats array indexes in issue paths', () => {
    const c = mockContext();
    zodDefaultHook({
      success: false,
      error: { issues: [{ message: 'Expected string', path: ['body', 'members', 0, 'email'] }] },
    }, c);
    expect(c.lastJson).toEqual({ code: 400, message: 'body.members[0].email: Expected string' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PostgreSQL DDL Tests
// ═══════════════════════════════════════════════════════════════════════════

// ─── M. PG_META_TABLE_DDL ───────────────────────────────────────────────────

describe('PG_META_TABLE_DDL', () => {
  it('creates _meta table', () => {
    expect(PG_META_TABLE_DDL).toContain('_meta');
    expect(PG_META_TABLE_DDL).toContain('key TEXT PRIMARY KEY');
    expect(PG_META_TABLE_DDL).toContain('value TEXT NOT NULL');
  });
});

// ─── N. generatePgCreateTableDDL ────────────────────────────────────────────

describe('generatePgCreateTableDDL', () => {
  it('generates CREATE TABLE IF NOT EXISTS', () => {
    const ddl = generatePgCreateTableDDL('posts', { schema: {} } as TableConfig);
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS');
    expect(ddl).toContain('"posts"');
  });

  it('id column is PRIMARY KEY', () => {
    const ddl = generatePgCreateTableDDL('posts', { schema: {} } as TableConfig);
    expect(ddl).toContain('"id" TEXT PRIMARY KEY');
  });

  it('string → TEXT type', () => {
    const ddl = generatePgCreateTableDDL('t', { schema: { title: { type: 'string' } } } as TableConfig);
    expect(ddl).toContain('"title" TEXT');
  });

  it('number → DOUBLE PRECISION type', () => {
    const ddl = generatePgCreateTableDDL('t', { schema: { views: { type: 'number' } } } as TableConfig);
    expect(ddl).toContain('"views" DOUBLE PRECISION');
  });

  it('boolean → BOOLEAN type (not INTEGER)', () => {
    const ddl = generatePgCreateTableDDL('t', { schema: { active: { type: 'boolean' } } } as TableConfig);
    expect(ddl).toContain('"active" BOOLEAN');
    expect(ddl).not.toContain('INTEGER');
  });

  it('json → JSONB type (not TEXT)', () => {
    const ddl = generatePgCreateTableDDL('t', { schema: { data: { type: 'json' } } } as TableConfig);
    expect(ddl).toContain('"data" JSONB');
  });

  it('datetime → TIMESTAMPTZ type (not TEXT)', () => {
    const ddl = generatePgCreateTableDDL('t', { schema: { ts: { type: 'datetime' } } } as TableConfig);
    expect(ddl).toContain('"ts" TIMESTAMPTZ');
  });

  it('required field → NOT NULL', () => {
    const ddl = generatePgCreateTableDDL('t', { schema: { email: { type: 'string', required: true } } } as TableConfig);
    expect(ddl).toContain('NOT NULL');
  });

  it('unique field → UNIQUE', () => {
    const ddl = generatePgCreateTableDDL('t', { schema: { slug: { type: 'string', unique: true } } } as TableConfig);
    expect(ddl).toContain('UNIQUE');
  });

  it('default string value', () => {
    const ddl = generatePgCreateTableDDL('t', { schema: { role: { type: 'string', default: 'user' } } } as TableConfig);
    expect(ddl).toContain("DEFAULT 'user'");
  });

  it('default boolean true → TRUE (not 1)', () => {
    const ddl = generatePgCreateTableDDL('t', { schema: { active: { type: 'boolean', default: true } } } as TableConfig);
    expect(ddl).toContain('DEFAULT TRUE');
    expect(ddl).not.toContain('DEFAULT 1');
  });

  it('default boolean false → FALSE (not 0)', () => {
    const ddl = generatePgCreateTableDDL('t', { schema: { active: { type: 'boolean', default: false } } } as TableConfig);
    expect(ddl).toContain('DEFAULT FALSE');
    expect(ddl).not.toContain('DEFAULT 0');
  });

  it('default null value', () => {
    const ddl = generatePgCreateTableDDL('t', { schema: { deletedAt: { type: 'datetime', default: null } } } as TableConfig);
    expect(ddl).toContain('DEFAULT NULL');
  });

  it('default number value', () => {
    const ddl = generatePgCreateTableDDL('t', { schema: { count: { type: 'number', default: 42 } } } as TableConfig);
    expect(ddl).toContain('DEFAULT 42');
  });

  it('single-quote escape in default', () => {
    const ddl = generatePgCreateTableDDL('t', { schema: { note: { type: 'string', default: "it's" } } } as TableConfig);
    expect(ddl).toContain("DEFAULT 'it''s'");
  });

  it('primary key field not marked NOT NULL (implicit)', () => {
    const ddl = generatePgCreateTableDDL('t', {
      schema: { pk: { type: 'string', primaryKey: true, required: true } },
    } as TableConfig);
    expect(ddl).toContain('PRIMARY KEY');
    expect(ddl).not.toMatch(/"pk".*NOT NULL/);
  });

  it('references auth string form (no column) stays logical only', () => {
    const ddl = generatePgCreateTableDDL('t', {
      schema: { userId: { type: 'string', references: 'users' } },
    } as TableConfig);
    expect(ddl).not.toContain('REFERENCES "users"("id")');
  });

  it('references auth string form (with column) stays logical only', () => {
    const ddl = generatePgCreateTableDDL('t', {
      schema: { userId: { type: 'string', references: 'users(uid)' } },
    } as TableConfig);
    expect(ddl).not.toContain('REFERENCES "users"("uid")');
  });

  it('references object form', () => {
    const ddl = generatePgCreateTableDDL('t', {
      schema: {
        categoryId: {
          type: 'string',
          references: { table: 'categories', column: 'cid', onDelete: 'CASCADE', onUpdate: 'SET NULL' },
        },
      },
    } as TableConfig);
    expect(ddl).toContain('REFERENCES "categories"("cid") ON DELETE CASCADE ON UPDATE SET NULL');
  });

  it('check constraint', () => {
    const ddl = generatePgCreateTableDDL('t', {
      schema: { age: { type: 'number', check: 'age >= 0' } },
    } as TableConfig);
    expect(ddl).toContain('CHECK (age >= 0)');
  });

  it('unknown type → TEXT fallback', () => {
    const ddl = generatePgCreateTableDDL('t', {
      schema: { exotic: { type: 'vector' as any } },
    } as TableConfig);
    expect(ddl).toContain('"exotic" TEXT');
  });

  it('identifier with double-quote → escaped', () => {
    const ddl = generatePgCreateTableDDL('my"table', { schema: {} } as TableConfig);
    expect(ddl).toContain('"my""table"');
  });
});

// ─── O. generatePgAddColumnDDL ──────────────────────────────────────────────

describe('generatePgAddColumnDDL', () => {
  it('generates ALTER TABLE ADD COLUMN', () => {
    const ddl = generatePgAddColumnDDL('posts', 'rating', { type: 'number' });
    expect(ddl).toContain('ALTER TABLE "posts" ADD COLUMN "rating" DOUBLE PRECISION');
  });

  it('with NOT NULL constraint', () => {
    const ddl = generatePgAddColumnDDL('t', 'email', { type: 'string', required: true });
    expect(ddl).toContain('NOT NULL');
  });

  it('with boolean DEFAULT', () => {
    const ddl = generatePgAddColumnDDL('t', 'active', { type: 'boolean', default: false });
    expect(ddl).toContain('DEFAULT FALSE');
  });

  it('ends with semicolon', () => {
    const ddl = generatePgAddColumnDDL('t', 'col', { type: 'string' });
    expect(ddl.trim()).toMatch(/;$/);
  });
});

// ─── P. generatePgIndexDDL ──────────────────────────────────────────────────

describe('generatePgIndexDDL', () => {
  it('single-field index', () => {
    const ddls = generatePgIndexDDL('posts', [{ fields: ['status'] }]);
    expect(ddls).toHaveLength(1);
    expect(ddls[0]).toContain('CREATE INDEX IF NOT EXISTS');
    expect(ddls[0]).toContain('"posts"("status")');
  });

  it('unique index', () => {
    const ddls = generatePgIndexDDL('posts', [{ fields: ['slug'], unique: true }]);
    expect(ddls[0]).toContain('CREATE UNIQUE INDEX');
  });

  it('composite index', () => {
    const ddls = generatePgIndexDDL('posts', [{ fields: ['userId', 'createdAt'] }]);
    expect(ddls[0]).toContain('"userId", "createdAt"');
  });

  it('index name derived from table + fields', () => {
    const ddls = generatePgIndexDDL('posts', [{ fields: ['status'] }]);
    expect(ddls[0]).toContain('idx_posts_status');
  });

  it('multiple indexes', () => {
    const ddls = generatePgIndexDDL('t', [
      { fields: ['a'] },
      { fields: ['b', 'c'] },
    ]);
    expect(ddls).toHaveLength(2);
  });

  it('empty indexes → empty array', () => {
    const ddls = generatePgIndexDDL('t', []);
    expect(ddls).toEqual([]);
  });
});

// ─── Q. generatePgFTSDDL ────────────────────────────────────────────────────

describe('generatePgFTSDDL', () => {
  it('returns 5 DDL statements', () => {
    const ddls = generatePgFTSDDL('posts', ['title', 'body']);
    expect(ddls).toHaveLength(5);
  });

  it('step 1: ALTER TABLE ADD COLUMN _fts tsvector', () => {
    const ddls = generatePgFTSDDL('posts', ['title']);
    expect(ddls[0]).toContain('ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "_fts" tsvector');
  });

  it('step 2: GIN index on _fts column', () => {
    const ddls = generatePgFTSDDL('posts', ['title']);
    expect(ddls[1]).toContain('CREATE INDEX IF NOT EXISTS');
    expect(ddls[1]).toContain('USING gin');
    expect(ddls[1]).toContain('"_fts"');
  });

  it('step 2: GIN index name includes _fts suffix', () => {
    const ddls = generatePgFTSDDL('posts', ['title']);
    expect(ddls[1]).toContain('"idx_posts_fts"');
  });

  it('step 3: trigger function with to_tsvector', () => {
    const ddls = generatePgFTSDDL('posts', ['title', 'body']);
    expect(ddls[2]).toContain('CREATE OR REPLACE FUNCTION');
    expect(ddls[2]).toContain('"posts_fts_trigger"');
    expect(ddls[2]).toContain("to_tsvector('simple'");
    expect(ddls[2]).toContain('RETURNS trigger');
    expect(ddls[2]).toContain('plpgsql');
  });

  it('step 3: trigger function coalesces all fields', () => {
    const ddls = generatePgFTSDDL('posts', ['title', 'body']);
    expect(ddls[2]).toContain('coalesce(NEW."title", \'\')');
    expect(ddls[2]).toContain('coalesce(NEW."body", \'\')');
  });

  it('step 4: BEFORE INSERT OR UPDATE trigger', () => {
    const ddls = generatePgFTSDDL('posts', ['title']);
    expect(ddls[3]).toContain('DROP TRIGGER IF EXISTS');
    expect(ddls[3]).toContain('CREATE TRIGGER');
    expect(ddls[3]).toContain('BEFORE INSERT OR UPDATE');
    expect(ddls[3]).toContain('FOR EACH ROW');
    expect(ddls[3]).toContain('EXECUTE FUNCTION');
  });

  it('step 4: trigger name is tableName_fts_update', () => {
    const ddls = generatePgFTSDDL('posts', ['title']);
    expect(ddls[3]).toContain('"posts_fts_update"');
  });

  it('step 5: backfill UPDATE with bare coalesce', () => {
    const ddls = generatePgFTSDDL('posts', ['title', 'body']);
    expect(ddls[4]).toContain('UPDATE "posts" SET "_fts"');
    expect(ddls[4]).toContain("to_tsvector('simple'");
    expect(ddls[4]).toContain('coalesce("title", \'\')');
    expect(ddls[4]).toContain('coalesce("body", \'\')');
    // Backfill should NOT have NEW. prefix
    expect(ddls[4]).not.toContain('NEW.');
  });

  it('single field FTS', () => {
    const ddls = generatePgFTSDDL('t', ['body']);
    expect(ddls[2]).toContain('coalesce(NEW."body", \'\')');
    // No concatenation with || when single field
    expect(ddls[2]).not.toContain("|| ' ' ||");
  });

  it('multiple fields joined with space separator', () => {
    const ddls = generatePgFTSDDL('t', ['a', 'b', 'c']);
    // Trigger function should concatenate with || ' ' ||
    expect(ddls[2]).toContain("|| ' ' ||");
  });
});

// ─── R. generatePgTableDDL ──────────────────────────────────────────────────

describe('generatePgTableDDL', () => {
  it('returns array with CREATE TABLE', () => {
    const ddls = generatePgTableDDL('posts', { schema: {} } as TableConfig);
    expect(ddls.length).toBeGreaterThanOrEqual(1);
    expect(ddls[0]).toContain('CREATE TABLE');
  });

  it('with indexes → includes CREATE INDEX', () => {
    const ddls = generatePgTableDDL('posts', {
      schema: {},
      indexes: [{ fields: ['status'] }],
    } as TableConfig);
    expect(ddls.some(d => d.includes('CREATE INDEX'))).toBe(true);
  });

  it('with FTS → includes tsvector + GIN + trigger', () => {
    const ddls = generatePgTableDDL('posts', {
      schema: { title: { type: 'string' } },
      fts: ['title'],
    } as TableConfig);
    // 1 CREATE TABLE + 5 FTS DDLs = 6
    expect(ddls).toHaveLength(6);
    expect(ddls.some(d => d.includes('tsvector'))).toBe(true);
    expect(ddls.some(d => d.includes('gin'))).toBe(true);
    expect(ddls.some(d => d.includes('TRIGGER'))).toBe(true);
  });

  it('no FTS → no tsvector', () => {
    const ddls = generatePgTableDDL('posts', { schema: {} } as TableConfig);
    expect(ddls.every(d => !d.includes('tsvector'))).toBe(true);
  });

  it('no indexes, no fts → only CREATE TABLE', () => {
    const ddls = generatePgTableDDL('simple', { schema: {} } as TableConfig);
    expect(ddls).toHaveLength(1);
    expect(ddls[0]).toContain('CREATE TABLE');
  });

  it('indexes + fts combined', () => {
    const ddls = generatePgTableDDL('full', {
      schema: { title: { type: 'string' }, status: { type: 'string' } },
      indexes: [{ fields: ['status'] }],
      fts: ['title'],
    } as TableConfig);
    // 1 CREATE TABLE + 1 INDEX + 5 FTS = 7
    expect(ddls).toHaveLength(7);
  });

  it('empty indexes array → no CREATE INDEX', () => {
    const ddls = generatePgTableDDL('t', {
      schema: {},
      indexes: [],
    } as TableConfig);
    expect(ddls.every(d => !d.includes('CREATE INDEX'))).toBe(true);
  });

  it('empty fts array → no FTS', () => {
    const ddls = generatePgTableDDL('t', {
      schema: {},
      fts: [],
    } as TableConfig);
    expect(ddls.every(d => !d.includes('tsvector'))).toBe(true);
  });
});

// ─── S. PostgreSQL vs SQLite type differences ───────────────────────────────

describe('PostgreSQL vs SQLite type divergence', () => {
  it('boolean: PG uses BOOLEAN, SQLite uses INTEGER', () => {
    const pgDDL = generatePgCreateTableDDL('t', { schema: { flag: { type: 'boolean' } } } as TableConfig);
    const sqliteDDL = generateCreateTableDDL('t', { schema: { flag: { type: 'boolean' } } } as TableConfig);
    expect(pgDDL).toContain('BOOLEAN');
    expect(sqliteDDL).toContain('INTEGER');
  });

  it('number: PG uses DOUBLE PRECISION, SQLite uses REAL', () => {
    const pgDDL = generatePgCreateTableDDL('t', { schema: { val: { type: 'number' } } } as TableConfig);
    const sqliteDDL = generateCreateTableDDL('t', { schema: { val: { type: 'number' } } } as TableConfig);
    expect(pgDDL).toContain('DOUBLE PRECISION');
    expect(sqliteDDL).toContain('REAL');
  });

  it('datetime: PG uses TIMESTAMPTZ, SQLite uses TEXT', () => {
    const pgDDL = generatePgCreateTableDDL('t', { schema: { ts: { type: 'datetime' } } } as TableConfig);
    const sqliteDDL = generateCreateTableDDL('t', { schema: { ts: { type: 'datetime' } } } as TableConfig);
    expect(pgDDL).toContain('TIMESTAMPTZ');
    expect(sqliteDDL).toContain('"ts" TEXT');
  });

  it('json: PG uses JSONB, SQLite uses TEXT', () => {
    const pgDDL = generatePgCreateTableDDL('t', { schema: { data: { type: 'json' } } } as TableConfig);
    const sqliteDDL = generateCreateTableDDL('t', { schema: { data: { type: 'json' } } } as TableConfig);
    expect(pgDDL).toContain('JSONB');
    expect(sqliteDDL).toContain('"data" TEXT');
  });

  it('boolean default: PG uses TRUE/FALSE, SQLite uses 1/0', () => {
    const pgDDL = generatePgCreateTableDDL('t', { schema: { flag: { type: 'boolean', default: true } } } as TableConfig);
    const sqliteDDL = generateCreateTableDDL('t', { schema: { flag: { type: 'boolean', default: true } } } as TableConfig);
    expect(pgDDL).toContain('DEFAULT TRUE');
    expect(sqliteDDL).toContain('DEFAULT 1');
  });

  it('string type is TEXT for both', () => {
    const pgDDL = generatePgCreateTableDDL('t', { schema: { name: { type: 'string' } } } as TableConfig);
    const sqliteDDL = generateCreateTableDDL('t', { schema: { name: { type: 'string' } } } as TableConfig);
    expect(pgDDL).toContain('"name" TEXT');
    expect(sqliteDDL).toContain('"name" TEXT');
  });
});
