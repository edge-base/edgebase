import type { PostgresExecutor } from './postgres-executor.js';
import type { ResponseCursorRecord, ResponseCursorStore } from './response-byte-limit.js';

export const SQLITE_RESPONSE_CURSOR_TABLE_DDL = `CREATE TABLE IF NOT EXISTS "_edgebase_response_cursors" (
  "token" TEXT PRIMARY KEY,
  "table_name" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "expires_at" INTEGER NOT NULL,
  UNIQUE ("table_name", "record_id")
);`;

export const SQLITE_RESPONSE_CURSOR_EXPIRY_INDEX_DDL = `CREATE INDEX IF NOT EXISTS "_edgebase_response_cursors_expires_at"
  ON "_edgebase_response_cursors" ("expires_at");`;

export const POSTGRES_RESPONSE_CURSOR_TABLE_DDL = `CREATE TABLE IF NOT EXISTS "_edgebase_response_cursors" (
  "token" TEXT PRIMARY KEY,
  "table_name" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "expires_at" BIGINT NOT NULL,
  UNIQUE ("table_name", "record_id")
);`;

export const POSTGRES_RESPONSE_CURSOR_EXPIRY_INDEX_DDL = `CREATE INDEX IF NOT EXISTS "_edgebase_response_cursors_expires_at"
  ON "_edgebase_response_cursors" ("expires_at");`;

type SqliteCursorQuery = (
  sql: string,
  params: unknown[],
) => Promise<Record<string, unknown>[]>;

function sqliteRecord(row: Record<string, unknown> | undefined): ResponseCursorRecord | null {
  if (!row) return null;
  return {
    token: String(row.token),
    tableName: String(row.table_name),
    recordId: String(row.record_id),
    expiresAt: Number(row.expires_at),
  };
}

export function createSqliteResponseCursorStore(
  query: SqliteCursorQuery,
  initialize: () => Promise<void>,
): ResponseCursorStore {
  let ready: Promise<void> | null = null;
  const ensureReady = async () => {
    if (!ready) {
      ready = initialize().catch((error) => {
        ready = null;
        throw error;
      });
    }
    await ready;
  };
  const findByToken = async (token: string) => sqliteRecord((await query(
    'SELECT "token", "table_name", "record_id", "expires_at" FROM "_edgebase_response_cursors" WHERE "token" = ? LIMIT 1',
    [token],
  ))[0]);
  const findByRecord = async (tableName: string, recordId: string) => sqliteRecord((await query(
    'SELECT "token", "table_name", "record_id", "expires_at" FROM "_edgebase_response_cursors" WHERE "table_name" = ? AND "record_id" = ? LIMIT 1',
    [tableName, recordId],
  ))[0]);

  return {
    ensureReady,
    findByToken,
    findByRecord,
    async create(record) {
      const inserted = await query(
        'INSERT OR IGNORE INTO "_edgebase_response_cursors" ("token", "table_name", "record_id", "expires_at") VALUES (?, ?, ?, ?) RETURNING "token"',
        [record.token, record.tableName, record.recordId, record.expiresAt],
      );
      if (inserted.length > 0) return 'inserted';
      if (await findByToken(record.token)) return 'token-conflict';
      if (await findByRecord(record.tableName, record.recordId)) return 'record-conflict';
      return 'token-conflict';
    },
    async touch(token, expiresAt) {
      await query(
        'UPDATE "_edgebase_response_cursors" SET "expires_at" = ? WHERE "token" = ? RETURNING "token"',
        [expiresAt, token],
      );
    },
    async deleteByToken(token) {
      await query(
        'DELETE FROM "_edgebase_response_cursors" WHERE "token" = ? RETURNING "token"',
        [token],
      );
    },
    async deleteExpired(now, limit) {
      const deleted = await query(
        `DELETE FROM "_edgebase_response_cursors"
         WHERE "token" IN (
           SELECT "token" FROM "_edgebase_response_cursors"
           WHERE "expires_at" <= ? ORDER BY "expires_at" ASC LIMIT ?
         ) RETURNING "token"`,
        [now, limit],
      );
      return deleted.length;
    },
  };
}

function postgresRecord(row: Record<string, unknown> | undefined): ResponseCursorRecord | null {
  return sqliteRecord(row);
}

export function createPostgresResponseCursorStore(query: PostgresExecutor): ResponseCursorStore {
  let ready: Promise<void> | null = null;
  const ensureReady = async () => {
    if (!ready) {
      ready = (async () => {
        await query(POSTGRES_RESPONSE_CURSOR_TABLE_DDL, []);
        await query(POSTGRES_RESPONSE_CURSOR_EXPIRY_INDEX_DDL, []);
      })().catch((error) => {
        ready = null;
        throw error;
      });
    }
    await ready;
  };
  const findByToken = async (token: string) => postgresRecord((await query(
    'SELECT "token", "table_name", "record_id", "expires_at" FROM "_edgebase_response_cursors" WHERE "token" = $1 LIMIT 1',
    [token],
  )).rows[0] as Record<string, unknown> | undefined);
  const findByRecord = async (tableName: string, recordId: string) => postgresRecord((await query(
    'SELECT "token", "table_name", "record_id", "expires_at" FROM "_edgebase_response_cursors" WHERE "table_name" = $1 AND "record_id" = $2 LIMIT 1',
    [tableName, recordId],
  )).rows[0] as Record<string, unknown> | undefined);

  return {
    ensureReady,
    findByToken,
    findByRecord,
    async create(record) {
      const inserted = await query(
        `INSERT INTO "_edgebase_response_cursors" ("token", "table_name", "record_id", "expires_at")
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING "token"`,
        [record.token, record.tableName, record.recordId, record.expiresAt],
      );
      if (inserted.rows.length > 0) return 'inserted';
      if (await findByToken(record.token)) return 'token-conflict';
      if (await findByRecord(record.tableName, record.recordId)) return 'record-conflict';
      return 'token-conflict';
    },
    async touch(token, expiresAt) {
      await query(
        'UPDATE "_edgebase_response_cursors" SET "expires_at" = $1 WHERE "token" = $2',
        [expiresAt, token],
      );
    },
    async deleteByToken(token) {
      await query('DELETE FROM "_edgebase_response_cursors" WHERE "token" = $1', [token]);
    },
    async deleteExpired(now, limit) {
      const deleted = await query(
        `DELETE FROM "_edgebase_response_cursors"
         WHERE "token" IN (
           SELECT "token" FROM "_edgebase_response_cursors"
           WHERE "expires_at" <= $1 ORDER BY "expires_at" ASC LIMIT $2
         ) RETURNING "token"`,
        [now, limit],
      );
      return deleted.rows.length;
    },
  };
}

export function createD1ResponseCursorStore(db: D1Database): ResponseCursorStore {
  return createSqliteResponseCursorStore(
    async (sql, params) => {
      const statement = params.length > 0 ? db.prepare(sql).bind(...params) : db.prepare(sql);
      const result = await statement.all();
      return (result.results ?? []) as Record<string, unknown>[];
    },
    async () => {
      await db.prepare(SQLITE_RESPONSE_CURSOR_TABLE_DDL).run();
      await db.prepare(SQLITE_RESPONSE_CURSOR_EXPIRY_INDEX_DDL).run();
    },
  );
}
