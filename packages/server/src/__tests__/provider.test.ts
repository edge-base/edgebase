/**
 * 서버 단위 테스트 — Database Provider System
 * provider.test.ts — 45개
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/provider.test.ts
 *
 * 테스트 대상:
 *   A. Config 검증 (defineConfig provider 규칙)
 *   B. Provider 바인딩 네이밍 (getProviderBindingName)
 *   C. PostgreSQL DDL 타입 매핑 검증 (schema.ts)
 *   D. MigrationConfig upPg 폴백 로직
 *   E. Plugin provider 충돌 감지
 */

import { describe, it, expect } from 'vitest';
import { CURRENT_PLUGIN_API_VERSION, defineConfig } from '@edgebase-fun/shared';
import { getProviderBindingName } from '../lib/postgres-executor.js';
import { generatePgCreateTableDDL, generatePgTableDDL } from '../lib/schema.js';
import type { TableConfig } from '@edgebase-fun/shared';

// ─── A. Config 검증 (defineConfig provider 규칙) ──────────────────────────────

describe('defineConfig — provider validation', () => {
  it('accepts provider: "do" (default)', () => {
    const config = defineConfig({
      databases: {
        shared: {
          provider: 'do',
          tables: { posts: { schema: { title: { type: 'string' } } } },
        },
      },
    });
    expect(config.databases?.shared?.provider).toBe('do');
  });

  it('accepts provider: "neon"', () => {
    const config = defineConfig({
      databases: {
        shared: {
          provider: 'neon',
          tables: { posts: { schema: { title: { type: 'string' } } } },
        },
      },
    });
    expect(config.databases?.shared?.provider).toBe('neon');
  });

  it('accepts provider: "postgres"', () => {
    const config = defineConfig({
      databases: {
        shared: {
          provider: 'postgres',
          tables: { posts: { schema: { title: { type: 'string' } } } },
        },
      },
    });
    expect(config.databases?.shared?.provider).toBe('postgres');
  });

  it('accepts provider: "d1"', () => {
    const config = defineConfig({
      databases: {
        shared: {
          provider: 'd1',
          tables: { posts: { schema: { title: { type: 'string' } } } },
        },
      },
    });
    expect(config.databases?.shared?.provider).toBe('d1');
  });

  it('accepts instance flag', () => {
    const config = defineConfig({
      databases: {
        workspace: {
          instance: true,
          tables: { members: { schema: { name: { type: 'string' } } } },
        },
      },
    });
    expect(config.databases?.workspace?.instance).toBe(true);
  });

  it('accepts undefined provider (defaults to do)', () => {
    const config = defineConfig({
      databases: {
        shared: {
          tables: { posts: { schema: { title: { type: 'string' } } } },
        },
      },
    });
    expect(config.databases?.shared?.provider).toBeUndefined();
  });

  it('rejects invalid provider value', () => {
    expect(() =>
      defineConfig({
        databases: {
          shared: {
            provider: 'mysql' as any,
            tables: { posts: {} },
          },
        },
      }),
    ).toThrow(/invalid provider 'mysql'/);
  });

  it('rejects provider on multi-tenant block with canCreate', () => {
    expect(() =>
      defineConfig({
        databases: {
          workspace: {
            provider: 'neon',
            access: {
              canCreate: () => true,
            },
            tables: { docs: { schema: { title: { type: 'string' } } } },
          },
        },
      }),
    ).toThrow(/not supported on multi-tenant blocks/);
  });

  it('rejects provider on multi-tenant block with access', () => {
    expect(() =>
      defineConfig({
        databases: {
          user: {
            provider: 'postgres',
            access: {
              access: () => true,
            },
            tables: { notes: { schema: { title: { type: 'string' } } } },
          },
        },
      }),
    ).toThrow(/not supported on multi-tenant blocks/);
  });

  it('allows provider: "do" on multi-tenant block', () => {
    const config = defineConfig({
      databases: {
        workspace: {
          provider: 'do',
          access: {
            canCreate: () => true,
          },
          tables: { docs: { schema: { title: { type: 'string' } } } },
        },
      },
    });
    expect(config.databases?.workspace?.provider).toBe('do');
  });

  it('allows undefined provider on multi-tenant block (defaults to do)', () => {
    const config = defineConfig({
      databases: {
        workspace: {
          access: {
            canCreate: () => true,
          },
          tables: { docs: { schema: { title: { type: 'string' } } } },
        },
      },
    });
    expect(config.databases?.workspace?.provider).toBeUndefined();
  });

  it('rejects connectionString with provider: "do"', () => {
    expect(() =>
      defineConfig({
        databases: {
          shared: {
            provider: 'do',
            connectionString: 'PG_CONN_URL',
            tables: { posts: {} },
          },
        },
      }),
    ).toThrow(/connectionString is not used with provider 'do'/);
  });

  it('accepts connectionString with provider: "neon"', () => {
    const config = defineConfig({
      databases: {
        shared: {
          provider: 'neon',
          connectionString: 'PG_CONN_URL',
          tables: { posts: { schema: { title: { type: 'string' } } } },
        },
      },
    });
    expect(config.databases?.shared?.connectionString).toBe('PG_CONN_URL');
  });

  it('accepts connectionString with provider: "postgres"', () => {
    const config = defineConfig({
      databases: {
        shared: {
          provider: 'postgres',
          connectionString: 'PG_CONN_URL',
          tables: { posts: { schema: { title: { type: 'string' } } } },
        },
      },
    });
    expect(config.databases?.shared?.connectionString).toBe('PG_CONN_URL');
  });

  it('multiple DB blocks with mixed providers allowed', () => {
    const config = defineConfig({
      databases: {
        shared: {
          provider: 'neon',
          tables: { posts: { schema: { title: { type: 'string' } } } },
        },
        analytics: {
          provider: 'postgres',
          tables: { events: { schema: { name: { type: 'string' } } } },
        },
        workspace: {
          // defaults to 'do'
          access: { canCreate: () => true },
          tables: { docs: { schema: { title: { type: 'string' } } } },
        },
      },
    });
    expect(config.databases?.shared?.provider).toBe('neon');
    expect(config.databases?.analytics?.provider).toBe('postgres');
    expect(config.databases?.workspace?.provider).toBeUndefined();
  });
});

// ─── B. Provider 바인딩 네이밍 ──────────────────────────────────────────────────

describe('getProviderBindingName', () => {
  it('returns uppercased namespace with DB_POSTGRES_ prefix', () => {
    expect(getProviderBindingName('shared')).toBe('DB_POSTGRES_SHARED');
  });

  it('handles multi-word namespace', () => {
    expect(getProviderBindingName('analytics')).toBe('DB_POSTGRES_ANALYTICS');
  });

  it('handles uppercase input', () => {
    expect(getProviderBindingName('SHARED')).toBe('DB_POSTGRES_SHARED');
  });

  it('handles mixed case input', () => {
    expect(getProviderBindingName('myData')).toBe('DB_POSTGRES_MYDATA');
  });
});

// ─── C. PostgreSQL DDL 타입 매핑 검증 ────────────────────────────────────────────

describe('PostgreSQL type mapping', () => {
  it('string → TEXT', () => {
    const ddl = generatePgCreateTableDDL('t', {
      schema: { name: { type: 'string' } },
    } as TableConfig);
    expect(ddl).toContain('"name" TEXT');
  });

  it('number → DOUBLE PRECISION', () => {
    const ddl = generatePgCreateTableDDL('t', {
      schema: { score: { type: 'number' } },
    } as TableConfig);
    expect(ddl).toContain('"score" DOUBLE PRECISION');
  });

  it('boolean → BOOLEAN (not INTEGER)', () => {
    const ddl = generatePgCreateTableDDL('t', {
      schema: { active: { type: 'boolean' } },
    } as TableConfig);
    expect(ddl).toContain('"active" BOOLEAN');
    expect(ddl).not.toContain('INTEGER');
  });

  it('datetime → TIMESTAMPTZ', () => {
    const ddl = generatePgCreateTableDDL('t', {
      schema: { ts: { type: 'datetime' } },
    } as TableConfig);
    expect(ddl).toContain('"ts" TIMESTAMPTZ');
  });

  it('json → JSONB (not TEXT)', () => {
    const ddl = generatePgCreateTableDDL('t', {
      schema: { meta: { type: 'json' } },
    } as TableConfig);
    expect(ddl).toContain('"meta" JSONB');
  });

  it('text → TEXT', () => {
    const ddl = generatePgCreateTableDDL('t', {
      schema: { content: { type: 'text' } },
    } as TableConfig);
    expect(ddl).toContain('"content" TEXT');
  });
});

// ─── D. MigrationConfig upPg 필드 존재 검증 ──────────────────────────────────────

describe('MigrationConfig upPg field', () => {
  it('config with migrations including upPg passes validation', () => {
    const config = defineConfig({
      databases: {
        shared: {
          provider: 'neon',
          tables: {
            posts: {
              schema: { title: { type: 'string' } },
              migrations: [
                {
                  version: 2,
                  description: 'rename column',
                  up: 'ALTER TABLE posts RENAME COLUMN name TO title',
                  upPg: 'ALTER TABLE "posts" RENAME COLUMN "name" TO "title"',
                },
              ],
            },
          },
        },
      },
    });
    const migrations = config.databases?.shared?.tables?.posts?.migrations;
    expect(migrations).toHaveLength(1);
    expect(migrations?.[0]?.upPg).toBe('ALTER TABLE "posts" RENAME COLUMN "name" TO "title"');
  });

  it('config with migrations without upPg passes validation (fallback to up)', () => {
    const config = defineConfig({
      databases: {
        shared: {
          provider: 'neon',
          tables: {
            posts: {
              schema: { title: { type: 'string' } },
              migrations: [
                {
                  version: 2,
                  description: 'add column',
                  up: 'ALTER TABLE posts ADD COLUMN body TEXT',
                },
              ],
            },
          },
        },
      },
    });
    const migrations = config.databases?.shared?.tables?.posts?.migrations;
    expect(migrations?.[0]?.upPg).toBeUndefined();
    expect(migrations?.[0]?.up).toBe('ALTER TABLE posts ADD COLUMN body TEXT');
  });

  it('mixed upPg: some migrations have it, some do not', () => {
    const config = defineConfig({
      databases: {
        shared: {
          provider: 'postgres',
          tables: {
            posts: {
              schema: { title: { type: 'string' }, body: { type: 'text' } },
              migrations: [
                {
                  version: 2,
                  description: 'add body',
                  up: 'ALTER TABLE posts ADD COLUMN body TEXT',
                },
                {
                  version: 3,
                  description: 'rename column PG-specific',
                  up: 'ALTER TABLE posts RENAME COLUMN old_col TO new_col',
                  upPg: 'ALTER TABLE "posts" RENAME COLUMN "old_col" TO "new_col"',
                },
              ],
            },
          },
        },
      },
    });
    const migrations = config.databases?.shared?.tables?.posts?.migrations;
    expect(migrations).toHaveLength(2);
    expect(migrations?.[0]?.upPg).toBeUndefined();
    expect(migrations?.[1]?.upPg).toBeDefined();
  });
});

// ─── E. Plugin provider 충돌 감지 ────────────────────────────────────────────────

describe('defineConfig — plugin provider validation', () => {
  it('accepts plugin with matching provider', () => {
    const config = defineConfig({
      databases: {
        shared: {
          provider: 'neon',
          tables: { posts: { schema: { title: { type: 'string' } } } },
        },
      },
      plugins: [
        {
          name: 'test-plugin',
          pluginApiVersion: CURRENT_PLUGIN_API_VERSION,
          provider: 'neon',
          dbBlock: 'shared',
          tables: {},
          config: {},
        },
      ],
    });
    expect(config.plugins).toHaveLength(1);
  });

  it('rejects plugin with mismatched provider', () => {
    expect(() =>
      defineConfig({
        databases: {
          shared: {
            provider: 'do',
            tables: { posts: { schema: { title: { type: 'string' } } } },
          },
        },
        plugins: [
          {
            name: 'pg-plugin',
            pluginApiVersion: CURRENT_PLUGIN_API_VERSION,
            provider: 'neon',
            dbBlock: 'shared',
            tables: {},
            config: {},
          },
        ],
      }),
    ).toThrow(
      /Plugin 'pg-plugin' requires provider 'neon' but DB block 'shared' uses provider 'do'/,
    );
  });

  it('accepts plugin without provider (compatible with any)', () => {
    const config = defineConfig({
      databases: {
        shared: {
          provider: 'neon',
          tables: { posts: { schema: { title: { type: 'string' } } } },
        },
      },
      plugins: [
        {
          name: 'generic-plugin',
          pluginApiVersion: CURRENT_PLUGIN_API_VERSION,
          // no provider — compatible with any
          dbBlock: 'shared',
          tables: {},
          config: {},
        },
      ],
    });
    expect(config.plugins).toHaveLength(1);
  });

  it('accepts plugin with provider but no dbBlock', () => {
    const config = defineConfig({
      databases: {
        shared: {
          provider: 'neon',
          tables: { posts: { schema: { title: { type: 'string' } } } },
        },
      },
      plugins: [
        {
          name: 'standalone-plugin',
          pluginApiVersion: CURRENT_PLUGIN_API_VERSION,
          provider: 'postgres',
          // no dbBlock — nothing to check
          tables: {},
          config: {},
        },
      ],
    });
    expect(config.plugins).toHaveLength(1);
  });

  it('rejects plugin targeting a non-existent dbBlock when provider is declared', () => {
    expect(() =>
      defineConfig({
        databases: {
          shared: {
            tables: { posts: { schema: { title: { type: 'string' } } } },
          },
        },
        plugins: [
          {
            name: 'future-plugin',
            pluginApiVersion: CURRENT_PLUGIN_API_VERSION,
            provider: 'neon',
            dbBlock: 'nonexistent',
            tables: {},
            config: {},
          },
        ],
      }),
    ).toThrow(
      /Plugin 'future-plugin' requires provider 'neon' but DB block 'nonexistent' uses provider 'do'/,
    );
  });
});

// ─── F. PostgreSQL DDL 완전성 (generatePgTableDDL) ──────────────────────────────

describe('generatePgTableDDL completeness', () => {
  it('generates CREATE TABLE with auto fields', () => {
    const ddls = generatePgTableDDL('posts', { schema: {} } as TableConfig);
    expect(ddls.length).toBeGreaterThan(0);
    // Should have CREATE TABLE
    const createDDL = ddls.find((d) => d.includes('CREATE TABLE'));
    expect(createDDL).toBeDefined();
    expect(createDDL).toContain('"id" TEXT PRIMARY KEY');
    expect(createDDL).toContain('"createdAt" TIMESTAMPTZ');
    expect(createDDL).toContain('"updatedAt" TIMESTAMPTZ');
  });

  it('includes indexes when defined', () => {
    const ddls = generatePgTableDDL('posts', {
      schema: { title: { type: 'string' }, status: { type: 'string' } },
      indexes: [{ fields: ['status'] }],
    } as TableConfig);
    const indexDDL = ddls.find((d) => d.includes('CREATE INDEX'));
    expect(indexDDL).toBeDefined();
    expect(indexDDL).toContain('"status"');
  });

  it('includes FTS tsvector when fts defined', () => {
    const ddls = generatePgTableDDL('posts', {
      schema: { title: { type: 'string' }, body: { type: 'text' } },
      fts: ['title', 'body'],
    } as TableConfig);
    // Should have tsvector column, GIN index, and trigger
    const hasTsvector = ddls.some((d) => d.includes('tsvector'));
    const hasGin = ddls.some((d) => d.includes('gin'));
    expect(hasTsvector).toBe(true);
    expect(hasGin).toBe(true);
  });

  it('uses PostgreSQL quoting (double quotes)', () => {
    const ddls = generatePgTableDDL('my_table', {
      schema: { my_col: { type: 'string' } },
    } as TableConfig);
    const createDDL = ddls.find((d) => d.includes('CREATE TABLE'));
    expect(createDDL).toContain('"my_table"');
    expect(createDDL).toContain('"my_col"');
  });
});
