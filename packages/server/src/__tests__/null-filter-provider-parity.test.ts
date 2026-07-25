import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { buildListQuery } from '../lib/query-engine.js';

function createFixture(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE schedules (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      kind TEXT NOT NULL,
      nextRunAt TEXT,
      retiredAt TEXT
    );
    INSERT INTO schedules (id, state, kind, nextRunAt, retiredAt) VALUES
      ('null-next', 'active', 'daily', NULL, NULL),
      ('future-next', 'active', 'daily', '2026-07-24T00:00:00.000Z', NULL),
      ('retired-next', 'paused', 'event', '2026-07-25T00:00:00.000Z', '2026-07-23T00:00:00.000Z');
  `);
  return database;
}

function executeSQLiteNullFilter(
  database: DatabaseSync,
  operator: '==' | '!=',
): { ids: string[]; total: number; sql: string; params: unknown[] } {
  const query = buildListQuery('schedules', {
    filters: [['nextRunAt', operator, null]],
    sort: [{ field: 'id', direction: 'asc' }],
    pagination: { limit: 10, offset: 0 },
  });
  const rows = database.prepare(query.sql).all(
    ...(query.params as SQLInputValue[]),
  ) as Array<{ id: string }>;
  const count = database.prepare(query.countSql!).get(
    ...(query.countParams as SQLInputValue[]),
  ) as { total: number };
  return {
    ids: rows.map(({ id }) => id),
    total: count.total,
    sql: query.sql,
    params: query.params,
  };
}

describe('null equality filter provider parity', () => {
  it('executes == null and != null with SQL null semantics on SQLite', () => {
    const database = createFixture();
    try {
      const equal = executeSQLiteNullFilter(database, '==');
      expect.soft(equal.ids).toEqual(['null-next']);
      expect.soft(equal.total).toBe(1);
      expect.soft(equal.sql).toContain('"nextRunAt" IS NULL');
      expect.soft(equal.params).toEqual([10, 0]);

      const notEqual = executeSQLiteNullFilter(database, '!=');
      expect.soft(notEqual.ids).toEqual(['future-next', 'retired-next']);
      expect.soft(notEqual.total).toBe(2);
      expect.soft(notEqual.sql).toContain('"nextRunAt" IS NOT NULL');
      expect.soft(notEqual.params).toEqual([10, 0]);
    } finally {
      database.close();
    }
  });

  it('does not consume PostgreSQL bind positions for null equality variants', () => {
    const query = buildListQuery('schedules', {
      filters: [
        ['nextRunAt', '!=', null],
        ['state', '==', 'active'],
      ],
      orFilters: [
        ['retiredAt', '==', null],
        ['kind', '==', 'daily'],
      ],
      pagination: { limit: 10, offset: 0 },
    }, 'postgres');

    expect(query.sql).toContain(
      '"nextRunAt" IS NOT NULL AND "state" = $1 AND ("retiredAt" IS NULL OR "kind" = $2)',
    );
    expect(query.sql).toContain('LIMIT $3 OFFSET $4');
    expect(query.params).toEqual(['active', 'daily', 10, 0]);
    expect(query.countSql).toContain(
      '"nextRunAt" IS NOT NULL AND "state" = $1 AND ("retiredAt" IS NULL OR "kind" = $2)',
    );
    expect(query.countParams).toEqual(['active', 'daily']);
  });
});
