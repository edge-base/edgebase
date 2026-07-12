/**
 * auth-db-adapter.ts — Abstraction layer for Auth database access.
 *
 * Provides a unified interface for D1 (SQLite) and PostgreSQL backends.
 * All auth-service functions use AuthDb instead of D1Database directly,
 * enabling transparent provider switching via config.auth.provider.
 *
 * Key differences handled by the adapter:
 * - D1 uses `?` bind params, PostgreSQL uses `$1, $2, ...`
 * - D1 `db.batch()` is atomic, PostgreSQL uses `BEGIN/COMMIT`
 * - D1 `.all()` returns `{ results: T[] }`, pg `.query()` returns `{ rows: T[] }`
 */
import { Client } from 'pg';
import { parseConfig } from './do-router.js';

// ─── Interface ───

export type AuthDbDialect = 'sqlite' | 'postgres';

export interface AdminSessionRotation {
  sessionId: string;
  currentRefreshTokens: string[];
  nextRefreshToken: string;
  expiresAt: string;
}

export interface UserSessionRotation {
  sessionId: string;
  currentRefreshToken: string;
  nextRefreshToken: string;
  expiresAt: string;
  rotatedAt: string;
}

export interface AtomicSessionInsert {
  id: string;
  userId: string;
  refreshToken: string;
  previousRefreshToken: string | null;
  rotatedAt: string | null;
  expiresAt: string;
  createdAt: string;
  metadata: string | null;
}

export interface AuthDb {
  /** The SQL dialect (sqlite for D1, postgres for Neon/PostgreSQL). */
  readonly dialect: AuthDbDialect;

  /**
   * Execute a query and return all matching rows.
   * SQL uses `?` placeholders — the adapter converts to `$1, $2, ...` for PostgreSQL.
   */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /**
   * Execute a query and return the first row, or null.
   */
  first<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;

  /**
   * Execute a statement that doesn't return rows (INSERT, UPDATE, DELETE).
   */
  run(sql: string, params?: unknown[]): Promise<void>;

  /**
   * Execute multiple statements atomically.
   * D1: db.batch([...])
   * PostgreSQL: BEGIN; ...; COMMIT;
   */
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<void>;

  /** Execute a transaction serialized by a logical lock key. */
  batchWithLock(lockKey: string | string[], statements: { sql: string; params?: unknown[] }[]): Promise<void>;

  /** Atomically replace one admin session credential if it is still current. */
  compareAndSwapAdminSession(rotation: AdminSessionRotation): Promise<boolean>;

  /** Atomically rotate one user session credential if it is still current. */
  compareAndSwapUserSession(rotation: UserSessionRotation): Promise<boolean>;

  /** Insert a session and enforce the per-user cap in the same transaction. */
  createSessionWithLimit(session: AtomicSessionInsert, maxSessions: number): Promise<void>;
}

// ─── D1 Implementation ───

export class D1AuthDb implements AuthDb {
  readonly dialect: AuthDbDialect = 'sqlite';

  constructor(private readonly db: D1Database) {}

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const stmt = params && params.length > 0
      ? this.db.prepare(sql).bind(...params)
      : this.db.prepare(sql);
    const result = await stmt.all();
    return (result.results ?? []) as T[];
  }

  async first<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    const stmt = params && params.length > 0
      ? this.db.prepare(sql).bind(...params)
      : this.db.prepare(sql);
    const row = await stmt.first();
    return (row ?? null) as T | null;
  }

  async run(sql: string, params?: unknown[]): Promise<void> {
    const stmt = params && params.length > 0
      ? this.db.prepare(sql).bind(...params)
      : this.db.prepare(sql);
    await stmt.run();
  }

  async batch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
    if (statements.length === 0) return;
    await this.db.batch(
      statements.map((s) =>
        s.params && s.params.length > 0
          ? this.db.prepare(s.sql).bind(...s.params)
          : this.db.prepare(s.sql),
      ),
    );
  }

  async batchWithLock(
    _lockKey: string | string[],
    statements: { sql: string; params?: unknown[] }[],
  ): Promise<void> {
    await this.batch(statements);
  }

  async compareAndSwapAdminSession(rotation: AdminSessionRotation): Promise<boolean> {
    if (rotation.currentRefreshTokens.length === 0) return false;
    const placeholders = rotation.currentRefreshTokens.map(() => '?').join(', ');
    const result = await this.db.prepare(
      `UPDATE _admin_sessions
       SET refreshToken = ?, expiresAt = ?
       WHERE id = ? AND refreshToken IN (${placeholders}) AND expiresAt > ?`,
    ).bind(
      rotation.nextRefreshToken,
      rotation.expiresAt,
      rotation.sessionId,
      ...rotation.currentRefreshTokens,
      new Date().toISOString(),
    ).run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async compareAndSwapUserSession(rotation: UserSessionRotation): Promise<boolean> {
    const result = await this.db.prepare(
      `UPDATE _sessions
       SET refreshToken = ?, previousRefreshToken = ?, rotatedAt = ?, expiresAt = ?,
           metadata = json_set(COALESCE(metadata, '{}'), '$.lastActiveAt', ?)
       WHERE id = ? AND refreshToken = ? AND expiresAt > ?`,
    ).bind(
      rotation.nextRefreshToken,
      rotation.currentRefreshToken,
      rotation.rotatedAt,
      rotation.expiresAt,
      rotation.rotatedAt,
      rotation.sessionId,
      rotation.currentRefreshToken,
      new Date().toISOString(),
    ).run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async createSessionWithLimit(session: AtomicSessionInsert, maxSessions: number): Promise<void> {
    const insert = this.db.prepare(
      `INSERT INTO _sessions
       (id, userId, refreshToken, previousRefreshToken, rotatedAt, expiresAt, createdAt, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      session.id,
      session.userId,
      session.refreshToken,
      session.previousRefreshToken,
      session.rotatedAt,
      session.expiresAt,
      session.createdAt,
      session.metadata,
    );

    if (maxSessions <= 0) {
      await insert.run();
      return;
    }

    // D1 batch statements execute atomically and serially. Remove expired
    // rows, insert, then retain the authoritative new session plus the newest
    // remaining rows.
    const cleanExpired = this.db.prepare(
      `DELETE FROM _sessions WHERE userId = ? AND expiresAt <= ?`,
    ).bind(session.userId, session.createdAt);
    const prune = this.db.prepare(
      `DELETE FROM _sessions
       WHERE id IN (
         SELECT id FROM _sessions
         WHERE userId = ?
         ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END ASC, createdAt DESC, id DESC
         LIMIT -1 OFFSET ?
       )`,
    ).bind(session.userId, session.id, maxSessions);
    await this.db.batch([cleanExpired, insert, prune]);
  }
}

// ─── PostgreSQL Implementation ───

/**
 * Convert `?` placeholders to `$1, $2, ...` for PostgreSQL.
 * Handles `?` inside single-quoted strings by skipping them.
 */
function sqliteToPostgresParams(sql: string): string {
  let idx = 0;
  let inString = false;
  let result = '';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    // Track single-quoted strings
    if (ch === "'") {
      if (inString && sql[i + 1] === "'") {
        // Escaped quote ''
        result += "''";
        i++;
        continue;
      }
      inString = !inString;
      result += ch;
      continue;
    }

    if (ch === '?' && !inString) {
      idx++;
      result += `$${idx}`;
    } else {
      result += ch;
    }
  }

  return result;
}

/**
 * Convert SQLite-specific SQL constructs to PostgreSQL equivalents.
 * - `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`
 * - `INSERT OR REPLACE` → `INSERT ... ON CONFLICT (pk) DO UPDATE SET ...`
 */
export function adaptSqlDialect(sql: string): string {
  // 1. INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
  const ignoreAdapted = sql.replace(
    /INSERT\s+OR\s+IGNORE\s+INTO/gi,
    'INSERT INTO',
  );

  if (ignoreAdapted !== sql) {
    const result = ignoreAdapted.trimEnd().replace(/;\s*$/, '');
    const returningIndex = result.search(/\sRETURNING\b/i);
    if (returningIndex >= 0) {
      return `${result.slice(0, returningIndex)} ON CONFLICT DO NOTHING${result.slice(returningIndex)}`;
    }
    return `${result} ON CONFLICT DO NOTHING`;
  }

  // 2. INSERT OR REPLACE → INSERT ... ON CONFLICT (pk) DO UPDATE SET ...
  const replaceAdapted = sql.replace(
    /INSERT\s+OR\s+REPLACE\s+INTO/gi,
    'INSERT INTO',
  );

  if (replaceAdapted !== sql) {
    // Extract column names from quoted or unquoted table/column identifiers.
    const colMatch = replaceAdapted.match(/INTO\s+(?:"[^"]+"|[A-Za-z_][\w$]*)\s*\(([^)]+)\)/i);
    if (colMatch) {
      const cols = colMatch[1].split(',').map(c => c.trim().replace(/"/g, ''));
      // First column is the PK (id, email, token, key, etc.)
      const pk = cols[0];
      const updateCols = cols.filter(c => c !== pk);

      let result = replaceAdapted.trimEnd().replace(/;\s*$/, '');
      const returningIndex = result.search(/\sRETURNING\b/i);
      const returningClause = returningIndex >= 0 ? result.slice(returningIndex) : '';
      if (returningIndex >= 0) result = result.slice(0, returningIndex);
      if (updateCols.length > 0) {
        const setClause = updateCols.map(c => `${c} = EXCLUDED.${c}`).join(', ');
        result += ` ON CONFLICT (${pk}) DO UPDATE SET ${setClause}${returningClause}`;
      } else {
        result += ` ON CONFLICT DO NOTHING${returningClause}`;
      }
      return result;
    }
    return replaceAdapted;
  }

  return sql;
}

const PG_CANONICAL_COLUMNS: Record<string, string> = {
  userid: 'userId',
  shardid: 'shardId',
  provideruserid: 'providerUserId',
  reservationid: 'reservationId',
  passwordhash: 'passwordHash',
  displayname: 'displayName',
  avatarurl: 'avatarUrl',
  emailvisibility: 'emailVisibility',
  customclaims: 'customClaims',
  isanonymous: 'isAnonymous',
  phoneverified: 'phoneVerified',
  appmetadata: 'appMetadata',
  lastsigninat: 'lastSignInAt',
  lastsignedinat: 'lastSignedInAt',
  banneduntil: 'bannedUntil',
  authrevision: 'authRevision',
  authmutationid: 'authMutationId',
  createdat: 'createdAt',
  updatedat: 'updatedAt',
  adminid: 'adminId',
  refreshtoken: 'refreshToken',
  previousrefreshtoken: 'previousRefreshToken',
  rotatedat: 'rotatedAt',
  expiresat: 'expiresAt',
  deviceid: 'deviceId',
  deviceinfo: 'deviceInfo',
  credentialid: 'credentialId',
  consumptionid: 'consumptionId',
  secrethash: 'secretHash',
  maxattempts: 'maxAttempts',
  consumedat: 'consumedAt',
  codehash: 'codeHash',
  credentialpublickey: 'credentialPublicKey',
};

function canonicalizePgRow<T>(row: Record<string, unknown>): T {
  const canonical: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const canonicalKey = PG_CANONICAL_COLUMNS[key] ?? key;
    canonical[canonicalKey] = (canonicalKey === 'count' || canonicalKey === 'cnt' || canonicalKey === 'counter')
      && typeof value === 'string'
      && /^-?\d+$/.test(value)
      ? Number(value)
      : value;
  }
  return canonical as T;
}

export class PgAuthDb implements AuthDb {
  readonly dialect: AuthDbDialect = 'postgres';

  constructor(private readonly connectionString: string) {}

  private adaptSql(sql: string): string {
    return sqliteToPostgresParams(adaptSqlDialect(sql));
  }

  private async withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: this.connectionString });
    try {
      await client.connect();
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.withClient(async (client) => {
      const result = await client.query(this.adaptSql(sql), params ?? []);
      return result.rows.map((row) => canonicalizePgRow<T>(row));
    });
  }

  async first<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    return this.withClient(async (client) => {
      const result = await client.query(this.adaptSql(sql), params ?? []);
      return result.rows[0] ? canonicalizePgRow<T>(result.rows[0]) : null;
    });
  }

  async run(sql: string, params?: unknown[]): Promise<void> {
    await this.withClient(async (client) => {
      await client.query(this.adaptSql(sql), params ?? []);
    });
  }

  async batch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
    if (statements.length === 0) return;
    await this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        for (const stmt of statements) {
          await client.query(this.adaptSql(stmt.sql), stmt.params ?? []);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  }

  async batchWithLock(
    lockKey: string | string[],
    statements: { sql: string; params?: unknown[] }[],
  ): Promise<void> {
    if (statements.length === 0) return;
    await this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const lockKeys = [...new Set(Array.isArray(lockKey) ? lockKey : [lockKey])].sort();
        for (const key of lockKeys) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
        }
        for (const stmt of statements) {
          await client.query(this.adaptSql(stmt.sql), stmt.params ?? []);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  }

  async compareAndSwapAdminSession(rotation: AdminSessionRotation): Promise<boolean> {
    if (rotation.currentRefreshTokens.length === 0) return false;
    const placeholders = rotation.currentRefreshTokens.map(() => '?').join(', ');
    return this.withClient(async (client) => {
      const result = await client.query(this.adaptSql(
        `UPDATE _admin_sessions
         SET refreshToken = ?, expiresAt = ?
         WHERE id = ? AND refreshToken IN (${placeholders}) AND expiresAt > ?
         RETURNING id`,
      ), [
        rotation.nextRefreshToken,
        rotation.expiresAt,
        rotation.sessionId,
        ...rotation.currentRefreshTokens,
        new Date().toISOString(),
      ]);
      return result.rowCount === 1;
    });
  }

  async compareAndSwapUserSession(rotation: UserSessionRotation): Promise<boolean> {
    return this.withClient(async (client) => {
      const result = await client.query(this.adaptSql(
        `UPDATE _sessions
         SET refreshToken = ?, previousRefreshToken = ?, rotatedAt = ?, expiresAt = ?,
             metadata = jsonb_set(COALESCE(metadata::jsonb, '{}'), '{lastActiveAt}', to_jsonb(?::text))::text
         WHERE id = ? AND refreshToken = ? AND expiresAt > ?
         RETURNING id`,
      ), [
        rotation.nextRefreshToken,
        rotation.currentRefreshToken,
        rotation.rotatedAt,
        rotation.expiresAt,
        rotation.rotatedAt,
        rotation.sessionId,
        rotation.currentRefreshToken,
        new Date().toISOString(),
      ]);
      return result.rowCount === 1;
    });
  }

  async createSessionWithLimit(session: AtomicSessionInsert, maxSessions: number): Promise<void> {
    await this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        // Serialize all session-cap transitions for one user. Hash collisions
        // only reduce concurrency; they cannot weaken the cap invariant.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [session.userId]);
        if (maxSessions > 0) {
          await client.query(
            'DELETE FROM _sessions WHERE userId = $1 AND expiresAt <= $2',
            [session.userId, session.createdAt],
          );
        }
        await client.query(
          `INSERT INTO _sessions
           (id, userId, refreshToken, previousRefreshToken, rotatedAt, expiresAt, createdAt, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            session.id,
            session.userId,
            session.refreshToken,
            session.previousRefreshToken,
            session.rotatedAt,
            session.expiresAt,
            session.createdAt,
            session.metadata,
          ],
        );

        if (maxSessions > 0) {
          await client.query(
            `DELETE FROM _sessions
             WHERE id IN (
               SELECT id FROM _sessions
               WHERE userId = $1
               ORDER BY CASE WHEN id = $2 THEN 0 ELSE 1 END ASC, createdAt DESC, id DESC
               OFFSET $3
             )`,
            [session.userId, session.id, maxSessions],
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  }
}

// ─── Factory ───

/**
 * Resolve the Hyperdrive binding name for auth PostgreSQL.
 * Convention: AUTH_POSTGRES
 * The .env secret key: AUTH_POSTGRES_URL (or user-specified connectionString value)
 */
export function getAuthPostgresBindingName(): string {
  return 'AUTH_POSTGRES';
}

/**
 * Create an AuthDb instance from the environment and config.
 * - Default / provider='d1' → D1AuthDb using env.AUTH_DB
 * - provider='neon'|'postgres' → PgAuthDb using Hyperdrive connection string
 *
 * When authProvider / connectionStringKey are omitted, the adapter resolves them
 * from config.auth.provider and config.auth.connectionString.
 */
export function resolveAuthDb(env: Record<string, unknown>, authProvider?: string, connectionStringKey?: string): AuthDb {
  const config = parseConfig(env);
  const provider = authProvider ?? config.auth?.provider ?? 'd1';
  const resolvedConnectionStringKey = connectionStringKey ?? config.auth?.connectionString ?? 'AUTH_POSTGRES_URL';

  if (provider === 'd1') {
    const d1 = env.AUTH_DB as D1Database | undefined;
    if (!d1) {
      throw new Error('AUTH_DB D1 binding is not available in the environment.');
    }
    return new D1AuthDb(d1);
  }

  if (provider === 'neon' || provider === 'postgres') {
    // Resolve Hyperdrive connection string
    const bindingName = getAuthPostgresBindingName();
    const hyperdrive = env[bindingName] as { connectionString?: string } | undefined;

    if (hyperdrive?.connectionString) {
      return new PgAuthDb(hyperdrive.connectionString);
    }

    // Fallback: direct connection string from env (local dev)
    const envKey = resolvedConnectionStringKey;
    const connStr = env[envKey] as string | undefined;
    if (connStr) {
      return new PgAuthDb(connStr);
    }

    throw new Error(
      `Auth provider '${provider}' requires a PostgreSQL connection. ` +
      `Expected Hyperdrive binding '${bindingName}' or env variable '${envKey}'.`,
    );
  }

  throw new Error(`Unknown auth provider: '${provider}'.`);
}
