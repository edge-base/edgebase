import { describe, expect, it } from 'vitest';
import { executeD1Sql } from '../lib/d1-sql.js';

interface MockCall {
  bindings: unknown[];
  method: 'all' | 'run';
  sql: string;
}

function createMockD1(options: {
  allResult?: { results?: Record<string, unknown>[] };
  runResult?: { meta?: { changes?: number } };
} = {}): D1Database & { _calls: MockCall[] } {
  const calls: MockCall[] = [];

  function makeStmt(sql: string) {
    const call: MockCall = {
      bindings: [],
      method: 'run',
      sql,
    };
    calls.push(call);

    const stmt = {
      bind: (...values: unknown[]) => {
        call.bindings = values;
        return stmt;
      },
      all: async () => {
        call.method = 'all';
        return options.allResult ?? { results: [] };
      },
      run: async () => {
        call.method = 'run';
        return options.runResult ?? { meta: { changes: 0 } };
      },
    };

    return stmt;
  }

  return {
    _calls: calls,
    prepare: (sql: string) => makeStmt(sql),
  } as unknown as D1Database & { _calls: MockCall[] };
}

describe('executeD1Sql', () => {
  it('returns rows for SELECT-style queries and binds parameters', async () => {
    const db = createMockD1({
      allResult: {
        results: [{ id: 'post_1', title: 'Hello' }],
      },
    });

    const result = await executeD1Sql(
      db,
      'SELECT * FROM posts WHERE id = ?',
      ['post_1'],
    );

    expect(result).toEqual({
      rowCount: 1,
      rows: [{ id: 'post_1', title: 'Hello' }],
    });
    expect(db._calls).toEqual([
      {
        bindings: ['post_1'],
        method: 'all',
        sql: 'SELECT * FROM posts WHERE id = ?',
      },
    ]);
  });

  it('returns affected row count for write queries', async () => {
    const db = createMockD1({
      runResult: {
        meta: { changes: 2 },
      },
    });

    const result = await executeD1Sql(
      db,
      'UPDATE posts SET published = ? WHERE category = ?',
      [true, 'news'],
    );

    expect(result).toEqual({
      rowCount: 2,
      rows: [],
    });
    expect(db._calls).toEqual([
      {
        bindings: [true, 'news'],
        method: 'run',
        sql: 'UPDATE posts SET published = ? WHERE category = ?',
      },
    ]);
  });

  it('treats RETURNING queries as row-producing even when they mutate data', async () => {
    const db = createMockD1({
      allResult: {
        results: [{ id: 'post_2', published: true }],
      },
    });

    const result = await executeD1Sql(
      db,
      'UPDATE posts SET published = 1 WHERE id = ? RETURNING id, published',
      ['post_2'],
    );

    expect(result).toEqual({
      rowCount: 1,
      rows: [{ id: 'post_2', published: true }],
    });
    expect(db._calls[0]?.method).toBe('all');
  });
});
