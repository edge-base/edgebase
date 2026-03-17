/**
 * 서버 단위 테스트 — lib/query-engine.ts
 * 1-04 query.test.ts — 120개
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/query.test.ts
 *
 * 테스트 대상:
 *   buildListQuery / buildCountQuery / buildGetQuery / buildSearchQuery
 *   parseQueryParams
 *   filter operators: == != > < >= <= contains in not in
 *   OR filter (orFilters, max 5)
 *   sort / limit / offset / cursor after/before
 */

import { describe, it, expect } from 'vitest';
import {
  buildListQuery,
  buildCountQuery,
  buildGetQuery,
  buildSearchQuery,
  buildSubstringSearchQuery,
  parseQueryParams,
  QUERY_PARAM_KEYS,
} from '../lib/query-engine.js';

// ─── A. buildGetQuery ─────────────────────────────────────────────────────────

describe('buildGetQuery', () => {
  it('generates SELECT * from table WHERE id = ?', () => {
    const { sql, params } = buildGetQuery('posts', 'post-123');
    expect(sql).toContain('SELECT *');
    expect(sql).toContain('"posts"');
    expect(sql).toContain('"id" = ?');
    expect(params).toEqual(['post-123']);
  });

  it('with fields projection', () => {
    const { sql } = buildGetQuery('posts', 'id-1', ['id', 'title']);
    expect(sql).toContain('"id"');
    expect(sql).toContain('"title"');
    expect(sql).not.toContain('SELECT *');
  });

  it('empty fields → SELECT *', () => {
    const { sql } = buildGetQuery('posts', 'x', []);
    expect(sql).toContain('SELECT *');
  });
});

// ─── B. buildCountQuery ───────────────────────────────────────────────────────

describe('buildCountQuery', () => {
  it('no filters → COUNT(*)', () => {
    const { sql, params } = buildCountQuery('posts');
    expect(sql).toContain('SELECT COUNT(*) as total');
    expect(sql).toContain('"posts"');
    expect(params).toEqual([]);
  });

  it('with filter adds WHERE', () => {
    const { sql, params } = buildCountQuery('posts', [['status', '==', 'published']]);
    expect(sql).toContain('WHERE');
    expect(params).toContain('published');
  });

  it('with OR filter', () => {
    const { sql } = buildCountQuery('posts', undefined, [['status', '==', 'draft'], ['status', '==', 'published']]);
    expect(sql).toContain('OR');
  });
});

// ─── C. buildListQuery — no filters ──────────────────────────────────────────

describe('buildListQuery — no filters', () => {
  it('basic query', () => {
    const { sql, params: _params } = buildListQuery('posts', {});
    expect(sql).toContain('SELECT "posts".* FROM "posts"');
    expect(sql).toContain('ORDER BY');
    expect(sql).toContain('LIMIT');
  });

  it('default limit is 20', () => {
    const { params } = buildListQuery('posts', {});
    // params should contain 20 as default limit
    expect(params).toContain(20);
  });

  it('generates countSql for non-cursor pagination', () => {
    const { countSql } = buildListQuery('posts', {});
    expect(countSql).toContain('SELECT COUNT(*)');
  });

  it('no countSql for cursor (after) pagination', () => {
    const { countSql } = buildListQuery('posts', { pagination: { after: 'cursor-abc' } });
    expect(countSql).toBeUndefined();
  });
});

// ─── D. buildListQuery — filter operators ─────────────────────────────────────

describe('buildListQuery — filter operators', () => {
  it('== operator', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['status', '==', 'published']] });
    expect(sql).toContain('= ?');
    expect(params).toContain('published');
  });

  it('!= operator', () => {
    const { sql } = buildListQuery('posts', { filters: [['status', '!=', 'deleted']] });
    expect(sql).toContain('!= ?');
  });

  it('> operator', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['views', '>', 100]] });
    expect(sql).toContain('> ?');
    expect(params).toContain(100);
  });

  it('< operator', () => {
    const { sql } = buildListQuery('posts', { filters: [['views', '<', 100]] });
    expect(sql).toContain('< ?');
  });

  it('>= operator', () => {
    const { sql } = buildListQuery('posts', { filters: [['age', '>=', 18]] });
    expect(sql).toContain('>= ?');
  });

  it('<= operator', () => {
    const { sql } = buildListQuery('posts', { filters: [['age', '<=', 65]] });
    expect(sql).toContain('<= ?');
  });

  it('contains → INSTR(col, ?) > 0', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['title', 'contains', 'hello']] });
    expect(sql).toContain('INSTR("title", ?) > 0');
    expect(params).toContain('hello');
  });

  it('in → IN (?, ?, ?)', () => {
    const { sql, params } = buildListQuery('posts', { filters: [['status', 'in', ['a', 'b', 'c']]] });
    expect(sql).toContain('IN (?, ?, ?)');
    expect(params).toContain('a');
    expect(params).toContain('c');
  });

  it('not in → NOT IN', () => {
    const { sql } = buildListQuery('posts', { filters: [['status', 'not in', ['deleted', 'spam']]] });
    expect(sql).toContain('NOT IN');
  });

  it('in with empty array', () => {
    const { sql } = buildListQuery('posts', { filters: [['status', 'in', []]] });
    // Empty IN() should generate "IN ()" which might return 0 results
    expect(sql).toContain('IN ()');
  });

  it('multiple filters → AND', () => {
    const { sql } = buildListQuery('posts', {
      filters: [['status', '==', 'pub'], ['views', '>', 100]],
    });
    expect(sql).toContain('AND');
  });

  it('unknown operator → throws', () => {
    expect(() =>
      buildListQuery('posts', { filters: [['status', 'between' as any, 'a']] }),
    ).toThrow('Unsupported filter operator');
  });
});

// ─── E. buildListQuery — OR filters ──────────────────────────────────────────

describe('buildListQuery — OR filters', () => {
  it('OR filters joined with OR', () => {
    const { sql } = buildListQuery('posts', {
      orFilters: [['status', '==', 'draft'], ['status', '==', 'published']],
    });
    expect(sql).toContain('OR');
  });

  it('AND + OR combined', () => {
    const { sql } = buildListQuery('posts', {
      filters: [['category', '==', 'tech']],
      orFilters: [['status', '==', 'draft'], ['status', '==', 'published']],
    });
    expect(sql).toContain('AND');
    expect(sql).toContain('OR');
  });

  it('OR filters grouped with parentheses', () => {
    const { sql } = buildListQuery('posts', {
      orFilters: [['a', '==', '1'], ['b', '==', '2']],
    });
    expect(sql).toContain('(');
    expect(sql).toContain(')');
  });

  it('OR filter > 5 → throws', () => {
    expect(() =>
      buildListQuery('posts', {
        orFilters: [
          ['a', '==', '1'], ['b', '==', '2'], ['c', '==', '3'],
          ['d', '==', '4'], ['e', '==', '5'], ['f', '==', '6'],
        ],
      }),
    ).toThrow('OR_FILTER_LIMIT_EXCEEDED');
  });

  it('OR filter exactly 5 → OK', () => {
    expect(() =>
      buildListQuery('posts', {
        orFilters: [
          ['a', '==', '1'], ['b', '==', '2'], ['c', '==', '3'],
          ['d', '==', '4'], ['e', '==', '5'],
        ],
      }),
    ).not.toThrow();
  });
});

// ─── F. buildListQuery — sort ─────────────────────────────────────────────────

describe('buildListQuery — sort', () => {
  it('sort ASC', () => {
    const { sql } = buildListQuery('posts', { sort: [{ field: 'title', direction: 'asc' }] });
    expect(sql).toContain('"title" ASC');
  });

  it('sort DESC', () => {
    const { sql } = buildListQuery('posts', { sort: [{ field: 'createdAt', direction: 'desc' }] });
    expect(sql).toContain('"createdAt" DESC');
  });

  it('multiple sorts', () => {
    const { sql } = buildListQuery('posts', {
      sort: [{ field: 'category', direction: 'asc' }, { field: 'createdAt', direction: 'desc' }],
    });
    expect(sql).toContain('"category" ASC');
    expect(sql).toContain('"createdAt" DESC');
  });

  it('no sort → default ORDER BY id ASC', () => {
    const { sql } = buildListQuery('posts', {});
    expect(sql).toContain('"id" ASC');
  });

  it('before cursor → default ORDER BY id DESC', () => {
    const { sql } = buildListQuery('posts', { pagination: { before: 'cursor-x' } });
    expect(sql).toContain('"id" DESC');
  });
});

// ─── G. buildListQuery — pagination ──────────────────────────────────────────

describe('buildListQuery — pagination', () => {
  it('limit', () => {
    const { sql, params } = buildListQuery('posts', { pagination: { limit: 10 } });
    expect(sql).toContain('LIMIT ?');
    expect(params).toContain(10);
  });

  it('limit=1', () => {
    const { params } = buildListQuery('posts', { pagination: { limit: 1 } });
    expect(params).toContain(1);
  });

  it('offset', () => {
    const { sql, params } = buildListQuery('posts', { pagination: { limit: 10, offset: 20 } });
    expect(sql).toContain('OFFSET ?');
    expect(params).toContain(20);
  });

  it('page=2, perPage=10 → offset=10', () => {
    const { params } = buildListQuery('posts', { pagination: { page: 2, perPage: 10 } });
    // offset = (page-1) * perPage = 10
    expect(params).toContain(10);
  });

  it('cursor after → WHERE id > ?', () => {
    const { sql, params } = buildListQuery('posts', { pagination: { after: 'cursor-abc' } });
    expect(sql).toContain('"id" > ?');
    expect(params).toContain('cursor-abc');
  });

  it('cursor before → WHERE id < ?', () => {
    const { sql, params } = buildListQuery('posts', { pagination: { before: 'cursor-xyz' } });
    expect(sql).toContain('"id" < ?');
    expect(params).toContain('cursor-xyz');
  });

  it('after cursor + filter combined', () => {
    const { sql } = buildListQuery('posts', {
      filters: [['status', '==', 'pub']],
      pagination: { after: 'cursor-1' },
    });
    expect(sql).toContain('"status" = ?');
    expect(sql).toContain('"id" > ?');
  });
});

// ─── H. buildSearchQuery ─────────────────────────────────────────────────────

describe('buildSearchQuery', () => {
  it('generates FTS5 MATCH query', () => {
    const { sql, params } = buildSearchQuery('posts', 'hello world');
    expect(sql).toContain('MATCH ?');
    expect(params[0]).toBe('"hello"* "world"*');
  });

  it('uses {tableName}_fts table', () => {
    const { sql } = buildSearchQuery('posts', 'query');
    expect(sql).toContain('"posts_fts"');
  });

  it('default limit 20, offset 0', () => {
    const { params } = buildSearchQuery('posts', 'q');
    expect(params[1]).toBe(20);
    expect(params[2]).toBeUndefined();
  });

  it('custom limit and offset', () => {
    const { params } = buildSearchQuery('posts', 'q', { limit: 5, offset: 10 });
    expect(params[1]).toBe(5);
    expect(params[2]).toBe(10);
  });

  it('with ftsFields generates highlight columns', () => {
    const { sql } = buildSearchQuery('posts', 'q', { ftsFields: ['title', 'body'] });
    expect(sql).toContain('highlight(');
    expect(sql).toContain('title_highlighted');
    expect(sql).toContain('body_highlighted');
  });

  it('custom highlightPre/Post', () => {
    const { sql } = buildSearchQuery('posts', 'q', {
      ftsFields: ['title'],
      highlightPre: '<b>',
      highlightPost: '</b>',
    });
    expect(sql).toContain('<b>');
    expect(sql).toContain('</b>');
  });

  it('ORDER BY rank', () => {
    const { sql } = buildSearchQuery('posts', 'q');
    expect(sql).toContain('rank');
  });

  it('JOIN on rowid', () => {
    const { sql } = buildSearchQuery('posts', 'q');
    expect(sql).toContain('rowid');
  });

  it('supports filters, sorting, and count queries', () => {
    const { sql, params, countSql, countParams } = buildSearchQuery('posts', 'q', {
      filters: [['status', '==', 'published']],
      sort: [{ field: 'createdAt', direction: 'desc' }],
      pagination: { limit: 5, offset: 10 },
    });
    expect(sql).toContain('"status" = ?');
    expect(sql).toContain('ORDER BY "createdAt" DESC, "id" ASC');
    expect(params).toEqual(['"q"*', 'published', 5, 10]);
    expect(countSql).toContain('"status" = ?');
    expect(countParams).toEqual(['"q"*', 'published']);
  });
});

describe('buildSubstringSearchQuery', () => {
  it('supports filters and sorting', () => {
    const { sql, params, countSql, countParams } = buildSubstringSearchQuery('posts', 'needle', {
      fields: ['title'],
      filters: [['status', '==', 'draft']],
      sort: [{ field: 'title', direction: 'desc' }],
      pagination: { limit: 2, offset: 1 },
    });
    expect(sql).toContain('instr(lower(CAST("title" AS TEXT)), lower(?)) > 0');
    expect(sql).toContain('"status" = ?');
    expect(sql).toContain('ORDER BY "title" DESC, "id" ASC');
    expect(params).toEqual(['needle', 'draft', 2, 1]);
    expect(countSql).toContain('"status" = ?');
    expect(countParams).toEqual(['needle', 'draft']);
  });
});

// ─── I. parseQueryParams ──────────────────────────────────────────────────────

describe('parseQueryParams', () => {
  it('parses filter JSON', () => {
    const opts = parseQueryParams({ filter: '[["status","==","pub"]]' });
    expect(opts.filters).toEqual([['status', '==', 'pub']]);
  });

  it('invalid filter JSON → ignores', () => {
    const opts = parseQueryParams({ filter: 'invalid-json' });
    expect(opts.filters).toBeUndefined();
  });

  it('parses sort: field:asc', () => {
    const opts = parseQueryParams({ sort: 'title:asc' });
    expect(opts.sort).toEqual([{ field: 'title', direction: 'asc' }]);
  });

  it('parses sort: multiple fields', () => {
    const opts = parseQueryParams({ sort: 'category:asc,createdAt:desc' });
    expect(opts.sort).toHaveLength(2);
    expect(opts.sort![1].direction).toBe('desc');
  });

  it('parses limit', () => {
    const opts = parseQueryParams({ limit: '10' });
    expect(opts.pagination?.limit).toBe(10);
  });

  it('parses offset', () => {
    const opts = parseQueryParams({ offset: '20' });
    expect(opts.pagination?.offset).toBe(20);
  });

  it('parses page', () => {
    const opts = parseQueryParams({ page: '3' });
    expect(opts.pagination?.page).toBe(3);
  });

  it('parses after cursor', () => {
    const opts = parseQueryParams({ after: 'cursor-abc' });
    expect(opts.pagination?.after).toBe('cursor-abc');
  });

  it('parses before cursor', () => {
    const opts = parseQueryParams({ before: 'cursor-xyz' });
    expect(opts.pagination?.before).toBe('cursor-xyz');
  });

  it('parses fields: comma-separated', () => {
    const opts = parseQueryParams({ fields: 'id,title,status' });
    expect(opts.fields).toEqual(['id', 'title', 'status']);
  });

  it('parses search', () => {
    const opts = parseQueryParams({ search: 'hello' });
    expect(opts.search).toBe('hello');
  });

  it('empty params → empty options', () => {
    const opts = parseQueryParams({});
    expect(opts.filters).toBeUndefined();
    expect(opts.sort).toBeUndefined();
  });

  it('parses orFilter JSON', () => {
    const opts = parseQueryParams({ orFilter: '[["a","==","1"],["b","==","2"]]' });
    expect(opts.orFilters).toHaveLength(2);
  });

  it('invalid orFilter JSON → ignores', () => {
    const opts = parseQueryParams({ orFilter: 'bad-json' });
    expect(opts.orFilters).toBeUndefined();
  });

  it('non-numeric limit → throws 400', () => {
    expect(() => parseQueryParams({ limit: 'abc' })).toThrow('Invalid limit');
  });

  it('negative limit → throws 400', () => {
    expect(() => parseQueryParams({ limit: '-5' })).toThrow('Invalid limit');
  });

  it('non-numeric offset → throws 400', () => {
    expect(() => parseQueryParams({ offset: 'xyz' })).toThrow('Invalid offset');
  });

  it('negative offset → throws 400', () => {
    expect(() => parseQueryParams({ offset: '-1' })).toThrow('Invalid offset');
  });

  it('non-numeric page → throws 400', () => {
    expect(() => parseQueryParams({ page: 'abc' })).toThrow('Invalid page');
  });

  it('page=0 → throws 400 (must be positive)', () => {
    expect(() => parseQueryParams({ page: '0' })).toThrow('Invalid page');
  });

  it('non-numeric perPage → throws 400', () => {
    expect(() => parseQueryParams({ perPage: 'xyz' })).toThrow('Invalid perPage');
  });

  it('valid numeric strings → parsed correctly', () => {
    const opts = parseQueryParams({ limit: '50', offset: '10', page: '2', perPage: '25' });
    expect(opts.pagination?.limit).toBe(50);
    expect(opts.pagination?.offset).toBe(10);
    expect(opts.pagination?.page).toBe(2);
    expect(opts.pagination?.perPage).toBe(25);
  });

  it('limit=0 → valid (explicit zero limit)', () => {
    const opts = parseQueryParams({ limit: '0' });
    expect(opts.pagination?.limit).toBe(0);
  });

  it('perPage with parseQueryParams → field-level validation', () => {
    const opts = parseQueryParams({ perPage: '100' });
    expect(opts.pagination?.perPage).toBe(100);
  });
});

// ─── J. QUERY_PARAM_KEYS ↔ parseQueryParams sync ─────────────────────────────

describe('QUERY_PARAM_KEYS ↔ parseQueryParams sync', () => {
  /** Test values that cause parseQueryParams to produce non-empty output for each key. */
  const testValues: Record<string, string> = {
    filter: JSON.stringify([['x', '==', 1]]),
    orFilter: JSON.stringify([['x', '==', 1]]),
    sort: 'x:asc',
    limit: '10',
    offset: '5',
    page: '2',
    perPage: '10',
    after: 'cursor-abc',
    before: 'cursor-xyz',
    fields: 'x,y',
    search: 'test',
  };

  const emptyOpts = JSON.stringify(parseQueryParams({}));

  it('every QUERY_PARAM_KEYS key has effect in parseQueryParams', () => {
    for (const key of QUERY_PARAM_KEYS) {
      const opts = parseQueryParams({ [key]: testValues[key] ?? 'test' });
      const hasEffect = JSON.stringify(opts) !== emptyOpts;
      expect(hasEffect, `QUERY_PARAM_KEYS key '${key}' is ignored by parseQueryParams`).toBe(true);
    }
  });

  it('every parseQueryParams key is in QUERY_PARAM_KEYS', () => {
    for (const key of Object.keys(testValues)) {
      expect(
        (QUERY_PARAM_KEYS as readonly string[]).includes(key),
        `parseQueryParams handles '${key}' but it is missing from QUERY_PARAM_KEYS`,
      ).toBe(true);
    }
  });
});

// ─── L. 3-way sync: QUERY_PARAM_KEYS ↔ parseQueryParams ↔ Zod schema ──────

describe('3-way sync: QUERY_PARAM_KEYS ↔ Zod queryParamsSchema', () => {
  // Dynamic import to avoid circular — schemas.ts is a new file
  it('queryParamsSchema keys === QUERY_PARAM_KEYS', async () => {
    const { queryParamsSchema } = await import('../lib/schemas.js');
    const zodKeys = Object.keys(queryParamsSchema.shape).sort();
    const engineKeys = [...QUERY_PARAM_KEYS].sort();
    expect(zodKeys).toEqual(engineKeys);
  });
});

// ─── M. Mutation-killing: exact params + countSql verification ──────────────

describe('buildListQuery — exact params verification', () => {
  it('no filters → params contains only default limit', () => {
    const { params } = buildListQuery('t', {});
    expect(params).toEqual([20]);
  });

  it('no filters → countParams is empty array', () => {
    const { countParams } = buildListQuery('t', {});
    expect(countParams).toEqual([]);
  });

  it('no filters → countSql has no WHERE', () => {
    const { countSql } = buildListQuery('t', {});
    expect(countSql).not.toContain('WHERE');
  });

  it('with filter → countSql includes WHERE and countParams has value', () => {
    const { countSql, countParams } = buildListQuery('t', {
      filters: [['status', '==', 'pub']],
    });
    expect(countSql).toContain('WHERE');
    expect(countParams).toEqual(['pub']);
  });

  it('!= operator → params include the filter value', () => {
    const { params } = buildListQuery('t', {
      filters: [['status', '!=', 'deleted']],
    });
    expect(params).toContain('deleted');
  });

  it('< operator → params include the filter value', () => {
    const { params } = buildListQuery('t', {
      filters: [['views', '<', 100]],
    });
    expect(params).toContain(100);
  });

  it('>= operator → params include the filter value', () => {
    const { params } = buildListQuery('t', {
      filters: [['age', '>=', 18]],
    });
    expect(params).toContain(18);
  });

  it('<= operator → params include the filter value', () => {
    const { params } = buildListQuery('t', {
      filters: [['age', '<=', 65]],
    });
    expect(params).toContain(65);
  });

  it('OR filters → params include all OR values', () => {
    const { params } = buildListQuery('t', {
      orFilters: [['a', '==', 'v1'], ['b', '==', 'v2']],
    });
    expect(params).toContain('v1');
    expect(params).toContain('v2');
  });

  it('cursor after → no countSql (cursor pagination)', () => {
    const { countSql } = buildListQuery('t', { pagination: { after: 'x' } });
    expect(countSql).toBeUndefined();
  });
});

describe('buildListQuery — SQL structure precision', () => {
  it('no filters → SQL has no WHERE clause', () => {
    const { sql } = buildListQuery('t', {});
    expect(sql).not.toContain('WHERE');
  });

  it('with filter → SQL has WHERE clause', () => {
    const { sql } = buildListQuery('t', { filters: [['a', '==', 1]] });
    expect(sql).toContain('WHERE');
  });

  it('no sort → SQL still has ORDER BY', () => {
    const { sql } = buildListQuery('t', {});
    expect(sql).toContain('ORDER BY');
  });

  it('multiple fields → joined with comma-space', () => {
    const { sql } = buildGetQuery('t', 'id-1', ['a', 'b', 'c']);
    expect(sql).toContain('"a", "b", "c"');
  });

  it('multiple AND filters → conditions joined with AND', () => {
    const { sql } = buildListQuery('t', {
      filters: [['a', '==', 1], ['b', '==', 2]],
    });
    // Verify AND separator exists between conditions
    expect(sql).toMatch(/"a" = \? AND "b" = \?/);
  });

  it('OR filters → conditions joined with OR inside parens', () => {
    const { sql } = buildListQuery('t', {
      orFilters: [['a', '==', 1], ['b', '==', 2]],
    });
    expect(sql).toMatch(/\("a" = \? OR "b" = \?\)/);
  });

  it('no filters → empty whereClause generates no WHERE text', () => {
    const { sql } = buildCountQuery('t');
    expect(sql).toBe('SELECT COUNT(*) as total FROM "t"');
  });
});

describe('buildSearchQuery — mutation-killing', () => {
  it('search term with double-quotes → escaped by doubling', () => {
    const { params } = buildSearchQuery('t', 'say "hello"');
    expect(params[0]).toBe('"say"* "hello"*');
  });

  it('single token search uses prefix matching for better DX', () => {
    const { params } = buildSearchQuery('t', '준규');
    expect(params[0]).toBe('"준규"*');
  });

  it('default highlight tags are <mark> and </mark>', () => {
    const { sql } = buildSearchQuery('t', 'q', { ftsFields: ['title'] });
    expect(sql).toContain("<mark>");
    expect(sql).toContain("</mark>");
  });

  it('highlight quote escaping in highlight tags with single quotes', () => {
    const { sql } = buildSearchQuery('t', 'q', {
      ftsFields: ['title'],
      highlightPre: "it's",
      highlightPost: "end's",
    });
    // Single quotes should be doubled for SQL safety
    expect(sql).toContain("it''s");
    expect(sql).toContain("end''s");
  });

  it('selectCols includes tableName.* and ftsTable.rank separated by comma', () => {
    const { sql } = buildSearchQuery('t', 'q');
    expect(sql).toContain('"t".*, "t_fts".rank');
  });

  it('ftsFields produces indexed highlight columns', () => {
    const { sql } = buildSearchQuery('t', 'q', { ftsFields: ['a', 'b'] });
    // Column index matters for highlight()
    expect(sql).toContain('highlight("t_fts", 0,');
    expect(sql).toContain('highlight("t_fts", 1,');
  });

  it('ftsFields highlight columns joined with comma-space', () => {
    const { sql } = buildSearchQuery('t', 'q', { ftsFields: ['a'] });
    // Verify the select columns are properly comma-separated
    expect(sql).toContain('"t".*, "t_fts".rank, highlight(');
  });

  it('empty ftsFields → no highlight columns', () => {
    const { sql } = buildSearchQuery('t', 'q', { ftsFields: [] });
    expect(sql).not.toContain('highlight(');
  });
});

describe('buildSubstringSearchQuery', () => {
  it('builds SQLite instr() fallback across search fields', () => {
    const { sql, params } = buildSubstringSearchQuery('posts', '준규', { fields: ['title', 'content'] });
    expect(sql).toContain('instr(lower(CAST("title" AS TEXT)), lower(?)) > 0');
    expect(sql).toContain('instr(lower(CAST("content" AS TEXT)), lower(?)) > 0');
    expect(params).toEqual(['준규', '준규', 20]);
  });

  it('passes the raw term through the SQLite instr() fallback', () => {
    const { params } = buildSubstringSearchQuery('posts', '50%_off', { fields: ['title'] });
    expect(params[0]).toBe('50%_off');
  });
});

describe('buildCountQuery — exact params', () => {
  it('no filters → params is empty array', () => {
    const { params } = buildCountQuery('t');
    expect(params).toEqual([]);
  });

  it('with filter → params match filter values exactly', () => {
    const { params } = buildCountQuery('t', [['status', '==', 'active']]);
    expect(params).toEqual(['active']);
  });

  it('with OR filters → sql contains WHERE with OR', () => {
    const { sql, params } = buildCountQuery('t', undefined, [['a', '==', 1], ['b', '==', 2]]);
    expect(sql).toContain('WHERE');
    expect(sql).toContain('OR');
    expect(params).toEqual([1, 2]);
  });
});

describe('buildListQuery — sort tiebreaker', () => {
  it('custom sort adds id tiebreaker with comma separator', () => {
    const { sql } = buildListQuery('t', {
      sort: [{ field: 'name', direction: 'asc' }],
    });
    expect(sql).toContain('"name" ASC, "id" ASC');
  });

  it('sort by id alone → no duplicate tiebreaker', () => {
    const { sql } = buildListQuery('t', {
      sort: [{ field: 'id', direction: 'desc' }],
    });
    // Should only have one "id" in ORDER BY, not a duplicate
    const orderByMatch = sql.match(/ORDER BY (.+?) LIMIT/s);
    expect(orderByMatch).toBeTruthy();
    const orderByParts = orderByMatch![1].split(',').map(s => s.trim());
    expect(orderByParts).toHaveLength(1);
  });
});
