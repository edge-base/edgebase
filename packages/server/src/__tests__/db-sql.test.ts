/**
 * 서버 단위 테스트 — lib/db-sql.ts
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/db-sql.test.ts
 *
 * 테스트 대상:
 *   RawSql / raw / buildSqlQuery / createSqlTaggedTemplate
 */

import { describe, it, expect, vi } from 'vitest';
import { RawSql, raw, buildSqlQuery, createSqlTaggedTemplate } from '../lib/db-sql.js';

// ─── A. RawSql ──────────────────────────────────────────────────────────────

describe('RawSql', () => {
  it('stores value property', () => {
    const r = new RawSql('table_name');
    expect(r.value).toBe('table_name');
  });

  it('is instanceof RawSql', () => {
    const r = new RawSql('x');
    expect(r instanceof RawSql).toBe(true);
  });

  it('value is readonly (reflected in type)', () => {
    const r = new RawSql('abc');
    expect(r.value).toBe('abc');
  });
});

// ─── B. raw() ───────────────────────────────────────────────────────────────

describe('raw()', () => {
  it('returns a RawSql instance', () => {
    const r = raw('my_table');
    expect(r).toBeInstanceOf(RawSql);
    expect(r.value).toBe('my_table');
  });

  it('empty string raw', () => {
    const r = raw('');
    expect(r.value).toBe('');
  });
});

// ─── C. buildSqlQuery ───────────────────────────────────────────────────────

describe('buildSqlQuery', () => {
  // Helper to create tagged template arrays
  function sql(strings: TemplateStringsArray, ...values: unknown[]) {
    return buildSqlQuery(strings, ...values);
  }

  it('no interpolation → just the query', () => {
    const result = sql`SELECT * FROM users`;
    expect(result.query).toBe('SELECT * FROM users');
    expect(result.params).toEqual([]);
  });

  it('single parameterized value', () => {
    const result = sql`SELECT * FROM users WHERE id = ${123}`;
    expect(result.query).toBe('SELECT * FROM users WHERE id = ?');
    expect(result.params).toEqual([123]);
  });

  it('multiple parameterized values', () => {
    const result = sql`INSERT INTO t (a, b) VALUES (${1}, ${'hello'})`;
    expect(result.query).toBe('INSERT INTO t (a, b) VALUES (?, ?)');
    expect(result.params).toEqual([1, 'hello']);
  });

  it('RawSql bypasses parameterization', () => {
    const tableName = raw('users');
    const result = sql`SELECT * FROM ${tableName} WHERE id = ${42}`;
    expect(result.query).toBe('SELECT * FROM users WHERE id = ?');
    expect(result.params).toEqual([42]);
  });

  it('mixed raw and parameterized', () => {
    const col = raw('"name"');
    const result = sql`UPDATE ${raw('posts')} SET ${col} = ${'new title'} WHERE id = ${5}`;
    expect(result.query).toBe('UPDATE posts SET "name" = ? WHERE id = ?');
    expect(result.params).toEqual(['new title', 5]);
  });

  it('null and undefined as params', () => {
    const result = sql`INSERT INTO t (a, b) VALUES (${null}, ${undefined})`;
    expect(result.params).toEqual([null, undefined]);
    expect(result.query).toBe('INSERT INTO t (a, b) VALUES (?, ?)');
  });

  it('boolean as param', () => {
    const result = sql`UPDATE t SET active = ${true}`;
    expect(result.params).toEqual([true]);
  });

  it('only raw values → no params', () => {
    const result = sql`SELECT * FROM ${raw('users')} ORDER BY ${raw('"created_at"')} DESC`;
    expect(result.query).toBe('SELECT * FROM users ORDER BY "created_at" DESC');
    expect(result.params).toEqual([]);
  });
});

// ─── D. createSqlTaggedTemplate ─────────────────────────────────────────────

describe('createSqlTaggedTemplate', () => {
  it('executes query with correct params and returns rows', () => {
    const mockExec = vi.fn((..._args: unknown[]) =>
      [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] as Iterable<Record<string, unknown>>,
    );
    const sql = createSqlTaggedTemplate(mockExec);

    const result = sql`SELECT * FROM users WHERE active = ${true}`;

    expect(mockExec).toHaveBeenCalledWith('SELECT * FROM users WHERE active = ?', true);
    expect(result).toEqual([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]);
  });

  it('spreads multiple params correctly', () => {
    const mockExec = vi.fn((..._args: unknown[]) => [] as Iterable<Record<string, unknown>>);
    const sql = createSqlTaggedTemplate(mockExec);

    void sql`INSERT INTO t (a, b, c) VALUES (${1}, ${'two'}, ${null})`;

    expect(mockExec).toHaveBeenCalledWith(
      'INSERT INTO t (a, b, c) VALUES (?, ?, ?)',
      1, 'two', null,
    );
  });

  it('raw values are inlined, not passed as params', () => {
    const mockExec = vi.fn((..._args: unknown[]) => [] as Iterable<Record<string, unknown>>);
    const sql = createSqlTaggedTemplate(mockExec);

    void sql`SELECT * FROM ${raw('my_table')} WHERE id = ${42}`;

    expect(mockExec).toHaveBeenCalledWith('SELECT * FROM my_table WHERE id = ?', 42);
  });

  it('no-param query passes only query string', () => {
    const mockExec = vi.fn((..._args: unknown[]) => [] as Iterable<Record<string, unknown>>);
    const sql = createSqlTaggedTemplate(mockExec);

    void sql`SELECT 1`;

    expect(mockExec).toHaveBeenCalledWith('SELECT 1');
  });

  it('iterates cursor and returns array', () => {
    // Simulate a generator/iterable cursor
    function* cursor() {
      yield { id: 1 };
      yield { id: 2 };
      yield { id: 3 };
    }
    const mockExec = vi.fn(() => cursor());
    const sql = createSqlTaggedTemplate(mockExec);

    const result = sql`SELECT * FROM t`;
    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });
});
