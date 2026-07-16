import { describe, expect, it, vi } from 'vitest';
import type { PostgresExecutor } from '../lib/postgres-executor.js';
import {
  POSTGRES_RESPONSE_CURSOR_EXPIRY_INDEX_DDL,
  POSTGRES_RESPONSE_CURSOR_TABLE_DDL,
  SQLITE_RESPONSE_CURSOR_EXPIRY_INDEX_DDL,
  SQLITE_RESPONSE_CURSOR_TABLE_DDL,
  createD1ResponseCursorStore,
  createPostgresResponseCursorStore,
  createSqliteResponseCursorStore,
} from '../lib/response-cursor-store.js';

describe('response cursor provider stores', () => {
  it('initializes the SQLite schema once', async () => {
    const initialize = vi.fn(async () => undefined);
    const store = createSqliteResponseCursorStore(async () => [], initialize);
    await Promise.all([store.ensureReady(), store.ensureReady()]);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(SQLITE_RESPONSE_CURSOR_TABLE_DDL).toContain('UNIQUE ("table_name", "record_id")');
    expect(SQLITE_RESPONSE_CURSOR_EXPIRY_INDEX_DDL).toContain('"expires_at"');
  });

  it('initializes the PostgreSQL table and expiry index once', async () => {
    const sqlCalls: string[] = [];
    const query: PostgresExecutor = vi.fn(async (sql) => {
      sqlCalls.push(sql);
      return { columns: [], rows: [], rowCount: 0 };
    });
    const store = createPostgresResponseCursorStore(query);
    await Promise.all([store.ensureReady(), store.ensureReady()]);
    expect(sqlCalls).toEqual([
      POSTGRES_RESPONSE_CURSOR_TABLE_DDL,
      POSTGRES_RESPONSE_CURSOR_EXPIRY_INDEX_DDL,
    ]);
  });

  it('adapts a D1 binding to the shared cursor store contract', () => {
    const bind = vi.fn();
    const statement = {
      bind,
      all: vi.fn(async () => ({ results: [] })),
      run: vi.fn(async () => ({})),
    };
    bind.mockReturnValue(statement);
    const db = { prepare: vi.fn(() => statement) };
    const store = createD1ResponseCursorStore(db as unknown as D1Database);
    expect(store).toMatchObject({
      ensureReady: expect.any(Function),
      findByToken: expect.any(Function),
      create: expect.any(Function),
    });
  });
});
