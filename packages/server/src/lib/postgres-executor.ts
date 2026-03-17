/**
 * PostgreSQL query executor via Cloudflare Hyperdrive.
 *
 * Uses `pg` (node-postgres) Client with Hyperdrive connection string.
 * Hyperdrive handles upstream pooling in production. In local dev we still
 * open a short-lived Client per request to stay compatible with the Workers
 * runtime, which does not like long-lived pooled sockets.
 *
 * Requires `nodejs_compat` flag in wrangler.toml (already present).
 *
 * Connection flow:
 *   1. CLI creates Hyperdrive config from user's connection string
 *   2. Worker reads `env.DB_POSTGRES_{NAMESPACE}.connectionString`
 *   3. pg Client connects via Hyperdrive proxy
 */
import { Client } from 'pg';

export interface PostgresQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export type PostgresExecutor = (
  sql: string,
  params?: unknown[],
) => Promise<PostgresQueryResult>;

export interface LocalDevPostgresExecOptions {
  namespace?: string;
  sidecarPort?: string;
  sidecarSecret?: string;
}

export function getLocalDevPostgresExecOptions(
  env: Record<string, unknown> | undefined,
  namespace: string,
): LocalDevPostgresExecOptions | undefined {
  const sidecarPort = typeof env?.EDGEBASE_DEV_SIDECAR_PORT === 'string'
    ? env.EDGEBASE_DEV_SIDECAR_PORT
    : undefined;
  const sidecarSecret = typeof env?.JWT_ADMIN_SECRET === 'string'
    ? env.JWT_ADMIN_SECRET
    : undefined;

  if (!sidecarPort || !sidecarSecret) {
    return undefined;
  }

  return {
    namespace,
    sidecarPort,
    sidecarSecret,
  };
}

async function executePostgresViaSidecar(
  sql: string,
  params: unknown[],
  options: LocalDevPostgresExecOptions,
): Promise<PostgresQueryResult> {
  const response = await fetch(`http://127.0.0.1:${options.sidecarPort}/postgres/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-EdgeBase-Internal-Secret': options.sidecarSecret!,
    },
    body: JSON.stringify({
      namespace: options.namespace,
      sql,
      params,
    }),
  });

  if (!response.ok) {
    let message = `Local PostgreSQL sidecar failed with ${response.status}`;
    try {
      const payload = await response.json() as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      // Ignore non-JSON error bodies and keep the status-based fallback.
    }
    throw new Error(message);
  }

  return response.json() as Promise<PostgresQueryResult>;
}

export async function ensureLocalDevPostgresSchema(
  options: LocalDevPostgresExecOptions,
): Promise<void> {
  if (!options.namespace || !options.sidecarPort || !options.sidecarSecret) {
    return;
  }

  const response = await fetch(`http://127.0.0.1:${options.sidecarPort}/postgres/ensure-schema`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-EdgeBase-Internal-Secret': options.sidecarSecret,
    },
    body: JSON.stringify({
      namespace: options.namespace,
    }),
  });

  if (response.ok) {
    return;
  }

  let message = `Local PostgreSQL schema ensure failed with ${response.status}`;
  try {
    const payload = await response.json() as { message?: string };
    if (payload.message) {
      message = payload.message;
    }
  } catch {
    // Ignore non-JSON error bodies and keep the status-based fallback.
  }
  throw new Error(message);
}

/**
 * Execute a SQL query against a PostgreSQL database via Hyperdrive.
 *
 * @param connectionString - Hyperdrive connection string (from env binding)
 * @param sql - SQL query with $1, $2, ... bind parameters
 * @param params - Bind parameter values
 * @returns Normalized result with columns, rows, and rowCount
 */
export async function executePostgresQuery(
  connectionString: string,
  sql: string,
  params: unknown[] = [],
  options?: LocalDevPostgresExecOptions,
): Promise<PostgresQueryResult> {
  if (options?.namespace && options.sidecarPort && options.sidecarSecret) {
    return executePostgresViaSidecar(sql, params, options);
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query(sql, params);
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return {
      columns: (result.fields ?? []).map((field) => field.name),
      rows,
      rowCount: result.rowCount ?? rows.length,
    };
  } finally {
    await client.end();
  }
}

/**
 * Resolve the Hyperdrive binding name for a database block with PostgreSQL provider.
 * Convention: DB_POSTGRES_{NAMESPACE_UPPER}
 *
 * e.g. namespace 'shared' → 'DB_POSTGRES_SHARED'
 *      namespace 'analytics' → 'DB_POSTGRES_ANALYTICS'
 *
 * The .env secret key has a _URL suffix: DB_POSTGRES_SHARED_URL
 */
export function getProviderBindingName(namespace: string): string {
  const normalized = namespace.toUpperCase().replace(/-/g, '_');
  return `DB_POSTGRES_${normalized}`;
}

export async function withPostgresConnection<T>(
  connectionString: string,
  fn: (query: PostgresExecutor) => Promise<T>,
  options?: LocalDevPostgresExecOptions,
): Promise<T> {
  if (options?.namespace && options.sidecarPort && options.sidecarSecret) {
    const query: PostgresExecutor = async (sql, params = []) =>
      executePostgresQuery(connectionString, sql, params, options);
    return fn(query);
  }

  const client = new Client({ connectionString });
  await client.connect();
  const query: PostgresExecutor = async (sql, params = []) => {
    const result = await client.query(sql, params);
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    return {
      columns: (result.fields ?? []).map((field) => field.name),
      rows,
      rowCount: result.rowCount ?? rows.length,
    };
  };
  try {
    return await fn(query);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function _resetPostgresPoolCache(): Promise<void> {
  // No-op. PostgreSQL requests use short-lived clients per request.
}
