/**
 * 서버 단위 테스트 — PostgreSQL dialect (query engine + executor)
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/postgres-dialect.test.ts
 *
 * 테스트 대상:
 *   A. Query engine — PostgreSQL dialect ($1,$2... bind params)
 *   B. Query engine — PostgreSQL contains (ILIKE)
 *   C. Query engine — PostgreSQL IN operator
 *   D. Query engine — PostgreSQL OR filters
 *   E. Query engine — PostgreSQL indexed substring search
 *   F. Query engine — PostgreSQL countSql consistency
 *   G. Default dialect behavior (SQLite fallback)
 *   H. executePostgresQuery — export validation
 */

import { describe, it, expect } from 'vitest';
import {
  buildListQuery,
  buildCountQuery,
  buildGetQuery,
  buildSearchQuery,
  POSTGRES_FTS_TEXT_COLUMN,
} from '../lib/query-engine.js';
import { generatePgFTSDDL } from '../lib/schema.js';
import { executePostgresQuery } from '../lib/postgres-executor.js';

const POSTGRES_SUBSTRING_CORPUS = `"${POSTGRES_FTS_TEXT_COLUMN}"`;

// ─── A. PostgreSQL dialect — bind params ($1, $2, ...) ────────────────────────

describe('PostgreSQL dialect — bind params', () => {
  it('buildGetQuery uses $1 placeholder', () => {
    const { sql, params } = buildGetQuery('products', 'p-1', undefined, 'postgres');
    expect(sql).toContain('"id" = $1');
    expect(sql).not.toContain('?');
    expect(params).toEqual(['p-1']);
  });

  it('buildGetQuery with fields uses $1', () => {
    const { sql } = buildGetQuery('products', 'p-1', ['id', 'name'], 'postgres');
    expect(sql).toContain('"id", "name"');
    expect(sql).toContain('$1');
  });

  it('buildListQuery no filters → default limit uses $1', () => {
    const { sql, params } = buildListQuery('products', {}, 'postgres');
    expect(sql).toContain('LIMIT $1');
    expect(sql).not.toContain('?');
    expect(params).toEqual([100]);
  });

  it('buildListQuery with offset → $1 OFFSET $2', () => {
    const { sql, params } = buildListQuery('products', {
      pagination: { limit: 10, offset: 5 },
    }, 'postgres');
    expect(sql).toContain('LIMIT $1 OFFSET $2');
    expect(params).toEqual([10, 5]);
  });

  it('buildListQuery with filter + limit → correct $N sequence', () => {
    const { sql, params } = buildListQuery('products', {
      filters: [['status', '==', 'active']],
      pagination: { limit: 10, offset: 0 },
    }, 'postgres');
    expect(sql).toContain('"status" = $1');
    expect(sql).toContain('LIMIT $2 OFFSET $3');
    expect(params).toEqual(['active', 10, 0]);
  });

  it('buildListQuery with multiple filters → $1, $2, ...', () => {
    const { sql, params } = buildListQuery('products', {
      filters: [['status', '==', 'active'], ['price', '>', 100]],
    }, 'postgres');
    expect(sql).toContain('"status" = $1');
    expect(sql).toContain('"price" > $2');
    expect(sql).toContain('LIMIT $3');
    expect(params).toEqual(['active', 100, 100]);
  });

  it('buildListQuery cursor after → $1 for cursor, $2 for limit', () => {
    const { sql, params } = buildListQuery('products', {
      pagination: { after: 'cursor-abc', limit: 5 },
    }, 'postgres');
    expect(sql).toContain('"id" > $1');
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual(['cursor-abc', 5]);
  });

  it('buildListQuery cursor before → $1 for cursor, $2 for limit', () => {
    const { sql, params } = buildListQuery('products', {
      pagination: { before: 'cursor-xyz', limit: 5 },
    }, 'postgres');
    expect(sql).toContain('"id" < $1');
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual(['cursor-xyz', 5]);
  });

  it('buildCountQuery with filter → $1', () => {
    const { sql, params } = buildCountQuery('products', [['status', '==', 'active']], undefined, 'postgres');
    expect(sql).toContain('"status" = $1');
    expect(sql).not.toContain('?');
    expect(params).toEqual(['active']);
  });

  it('buildCountQuery no filters → no placeholders', () => {
    const { sql, params } = buildCountQuery('products', undefined, undefined, 'postgres');
    expect(sql).toBe('SELECT COUNT(*) as total FROM "products"');
    expect(params).toEqual([]);
  });
});

// ─── B. PostgreSQL dialect — contains operator (ILIKE) ────────────────────────

describe('PostgreSQL dialect — contains operator', () => {
  it('contains uses ILIKE instead of INSTR', () => {
    const { sql, params } = buildListQuery('products', {
      filters: [['name', 'contains', 'widget']],
    }, 'postgres');
    expect(sql).toContain("ILIKE '%' || $1 || '%'");
    expect(sql).not.toContain('INSTR');
    expect(params).toContain('widget');
  });

  it('SQLite contains still uses INSTR (default dialect)', () => {
    const { sql } = buildListQuery('products', {
      filters: [['name', 'contains', 'widget']],
    });
    expect(sql).toContain('INSTR("name", ?) > 0');
    expect(sql).not.toContain('ILIKE');
  });
});

// ─── C. PostgreSQL dialect — IN operator ─────────────────────────────────────

describe('PostgreSQL dialect — IN operator', () => {
  it('in → IN ($1, $2, $3)', () => {
    const { sql, params } = buildListQuery('products', {
      filters: [['status', 'in', ['a', 'b', 'c']]],
    }, 'postgres');
    expect(sql).toContain('IN ($1, $2, $3)');
    expect(params).toContain('a');
    expect(params).toContain('b');
    expect(params).toContain('c');
  });

  it('not in → NOT IN ($1, $2)', () => {
    const { sql } = buildListQuery('products', {
      filters: [['status', 'not in', ['deleted', 'spam']]],
    }, 'postgres');
    expect(sql).toContain('NOT IN ($1, $2)');
  });
});

// ─── D. PostgreSQL dialect — OR filters ───────────────────────────────────────

describe('PostgreSQL dialect — OR filters', () => {
  it('OR filters use $N placeholders', () => {
    const { sql, params } = buildListQuery('products', {
      orFilters: [['a', '==', 'v1'], ['b', '==', 'v2']],
    }, 'postgres');
    expect(sql).toContain('$1');
    expect(sql).toContain('$2');
    expect(sql).toContain('OR');
    expect(sql).not.toContain('?');
    expect(params).toContain('v1');
    expect(params).toContain('v2');
  });

  it('AND + OR combined with $N', () => {
    const { sql, params } = buildListQuery('products', {
      filters: [['category', '==', 'tech']],
      orFilters: [['status', '==', 'draft'], ['status', '==', 'pub']],
    }, 'postgres');
    expect(sql).toContain('"category" = $1');
    expect(sql).toContain('$2');
    expect(sql).toContain('$3');
    expect(sql).toContain('AND');
    expect(sql).toContain('OR');
    expect(params).toContain('tech');
    expect(params).toContain('draft');
    expect(params).toContain('pub');
  });
});

// ─── E. PostgreSQL dialect — indexed substring search ─────────────────────────

describe('PostgreSQL dialect — search', () => {
  it('buildListQuery search serializes the row instead of casting the table name', () => {
    const { sql, params } = buildListQuery('products', {
      search: 'widget',
      filters: [['status', '==', 'active']],
      pagination: { limit: 10 },
    }, 'postgres');
    expect(sql).toContain('to_jsonb("products")::text ILIKE');
    expect(sql).toContain('"status" = $1');
    expect(sql).toContain('LIMIT $3 OFFSET $4');
    expect(params).toEqual(['active', 'widget', 10, 0]);
  });

  it('configured FTS DDL generates a pg_trgm index over one substring corpus', () => {
    const ftsDDL = generatePgFTSDDL('products', ['name', 'description']);
    expect(ftsDDL.some((ddl) => /CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pg_trgm/i.test(ddl))).toBe(true);
    expect(ftsDDL.some((ddl) => (
      ddl.includes(`USING gin(${POSTGRES_SUBSTRING_CORPUS} gin_trgm_ops)`)
    ))).toBe(true);
  });

  it('configured FTS query searches the indexed substring corpus instead of source fields', () => {
    const { sql, params, countSql, countParams } = buildSearchQuery('products', 'widget', {
      ftsFields: ['name', 'description'],
    }, 'postgres');

    expect(sql).toContain(`${POSTGRES_SUBSTRING_CORPUS} ILIKE`);
    expect(sql).not.toContain('"name"::text ILIKE');
    expect(sql).not.toContain('"description"::text ILIKE');
    expect(sql).not.toContain('MATCH');
    expect(sql).not.toContain('highlight(');
    expect(params.filter((value) => value === 'widget')).toHaveLength(1);
    expect(countSql).toContain(`${POSTGRES_SUBSTRING_CORPUS} ILIKE`);
    expect(countParams?.filter((value) => value === 'widget')).toHaveLength(1);
  });

  it('search with no ftsFields uses id as default search field', () => {
    const { sql } = buildSearchQuery('products', 'query', undefined, 'postgres');
    expect(sql).toContain('"id"::text ILIKE');
  });

  it('configured FTS combines multiple source fields into one corpus predicate', () => {
    const { sql } = buildSearchQuery('products', 'q', {
      ftsFields: ['name', 'description', 'sku'],
    }, 'postgres');
    expect(sql).toContain(`${POSTGRES_SUBSTRING_CORPUS} ILIKE`);
    expect(sql).not.toContain(' OR ');
    expect(sql).not.toContain('"name"::text ILIKE');
    expect(sql).not.toContain('"description"::text ILIKE');
    expect(sql).not.toContain('"sku"::text ILIKE');
  });

  it('configured FTS binds one corpus term plus limit and offset', () => {
    const { params } = buildSearchQuery('products', 'q', {
      ftsFields: ['name', 'description'],
      limit: 10,
      offset: 5,
    }, 'postgres');
    expect(params).toEqual(['q', 10, 5]);
  });

  it('treats PostgreSQL LIKE metacharacters literally in search and count', () => {
    const term = String.raw`50%_off\path`;
    const escaped = String.raw`50\%\_off\\path`;
    const { sql, params, countSql, countParams } = buildSearchQuery('products', term, {
      ftsFields: ['name'],
    }, 'postgres');

    expect(sql).toContain("ESCAPE E'\\\\'");
    expect(countSql).toContain("ESCAPE E'\\\\'");
    expect(params[0]).toBe(escaped);
    expect(countParams?.[0]).toBe(escaped);

    const list = buildListQuery('products', {
      search: term,
      pagination: { limit: 5 },
    }, 'postgres');
    expect(list.sql).toContain("ESCAPE E'\\\\'");
    expect(list.countSql).toContain("ESCAPE E'\\\\'");
    expect(list.params[0]).toBe(escaped);
    expect(list.countParams?.[0]).toBe(escaped);
  });

  it('search uses $N placeholders', () => {
    const { sql } = buildSearchQuery('products', 'q', {
      ftsFields: ['name'],
      limit: 10,
      offset: 0,
    }, 'postgres');
    expect(sql).toContain('$1');
    expect(sql).toContain('$2');
    expect(sql).toContain('$3');
    expect(sql).not.toContain('?');
  });

  it('SQLite search still uses FTS5 (default dialect)', () => {
    const { sql } = buildSearchQuery('products', 'widget');
    expect(sql).toContain('MATCH ?');
    expect(sql).toContain('_fts');
  });
});

// ─── F. PostgreSQL dialect — countSql consistency ─────────────────────────────

describe('PostgreSQL dialect — countSql', () => {
  it('countSql uses independent $N sequence', () => {
    const { countSql, countParams } = buildListQuery('products', {
      filters: [['status', '==', 'active']],
    }, 'postgres');
    // countSql gets its own BindTracker, so starts at $1
    expect(countSql).toContain('"status" = $1');
    expect(countParams).toEqual(['active']);
  });

  it('no countSql for cursor pagination (postgres)', () => {
    const { countSql } = buildListQuery('products', {
      pagination: { after: 'c1' },
    }, 'postgres');
    expect(countSql).toBeUndefined();
  });

  it('countSql no filters → no WHERE (postgres)', () => {
    const { countSql } = buildListQuery('products', {}, 'postgres');
    expect(countSql).not.toContain('WHERE');
  });

  it('countSql includes postgres search predicates', () => {
    const { countSql, countParams } = buildListQuery('products', {
      filters: [['status', '==', 'active']],
      search: 'widget',
    }, 'postgres');
    expect(countSql).toContain('"status" = $1');
    expect(countSql).toContain('to_jsonb("products")::text ILIKE');
    expect(countParams).toEqual(['active', 'widget']);
  });
});

// ─── G. Default dialect behavior ───────────────────────────────────────────────

describe('default dialect behavior', () => {
  it('buildGetQuery default → sqlite (? placeholder)', () => {
    const { sql } = buildGetQuery('t', 'id-1');
    expect(sql).toContain('?');
    expect(sql).not.toContain('$');
  });

  it('buildListQuery default → sqlite', () => {
    const { sql } = buildListQuery('t', {});
    expect(sql).toContain('?');
    expect(sql).not.toContain('$');
  });

  it('buildCountQuery default → sqlite', () => {
    const { sql } = buildCountQuery('t', [['a', '==', 1]]);
    expect(sql).toContain('?');
    expect(sql).not.toContain('$');
  });

  it('buildSearchQuery default → sqlite (FTS5)', () => {
    const { sql } = buildSearchQuery('t', 'q');
    expect(sql).toContain('MATCH ?');
  });
});

// ─── H. executePostgresQuery — export validation ─────────────────────────────

describe('executePostgresQuery', () => {
  it('is a function', () => {
    expect(typeof executePostgresQuery).toBe('function');
  });

  it('rejects invalid connection string', async () => {
    // pg Client connect will fail against an unreachable host.
    // Use connect_timeout=1 to fail quickly instead of default timeout.
    await expect(
      executePostgresQuery('postgres://user:pass@127.0.0.1:1/db?connect_timeout=1', 'SELECT 1', []),
    ).rejects.toThrow();
  }, 10_000);
});
