import type { EdgeBaseConfig } from '@edge-base/shared';
import { executeD1Sql } from './d1-sql.js';
import { executeDoSql } from './do-sql.js';
import { getD1BindingName, shouldRouteToD1 } from './do-router.js';
import {
  ensureLocalDevPostgresSchema,
  getLocalDevPostgresExecOptions,
  getProviderBindingName,
  withPostgresConnection,
} from './postgres-executor.js';
import { ensurePgSchema } from './postgres-schema-init.js';
import type { Env } from '../types.js';

export interface ProviderAwareSqlOptions {
  env?: Env;
  config: EdgeBaseConfig;
  databaseNamespace?: DurableObjectNamespace;
  workerUrl?: string;
  serviceKey?: string;
}

export interface ProviderAwareSqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

function inferColumns(rows: Record<string, unknown>[]): string[] {
  return rows.length > 0 ? Object.keys(rows[0] ?? {}) : [];
}

function normalizeRows(payload: {
  rows?: unknown[];
  items?: unknown[];
  results?: unknown[];
}): Record<string, unknown>[] {
  if (Array.isArray(payload.rows)) return payload.rows as Record<string, unknown>[];
  if (Array.isArray(payload.items)) return payload.items as Record<string, unknown>[];
  if (Array.isArray(payload.results)) return payload.results as Record<string, unknown>[];
  return [];
}

function readDollarQuoteToken(query: string, index: number): string | null {
  const match = query.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
  return match?.[0] ?? null;
}

function scanSqlPlaceholders(query: string): {
  questionPlaceholderCount: number;
  sawPostgresPlaceholder: boolean;
} {
  let questionPlaceholderCount = 0;
  let sawPostgresPlaceholder = false;
  let state: 'code' | 'single' | 'double' | 'line-comment' | 'block-comment' | 'dollar-quote' =
    'code';
  let dollarQuoteToken = '';

  for (let i = 0; i < query.length; i++) {
    const char = query[i]!;
    const next = query[i + 1];

    if (state === 'single') {
      if (char === "'" && next === "'") {
        i++;
        continue;
      }
      if (char === "'") state = 'code';
      continue;
    }

    if (state === 'double') {
      if (char === '"' && next === '"') {
        i++;
        continue;
      }
      if (char === '"') state = 'code';
      continue;
    }

    if (state === 'line-comment') {
      if (char === '\n') state = 'code';
      continue;
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        i++;
        state = 'code';
      }
      continue;
    }

    if (state === 'dollar-quote') {
      if (query.startsWith(dollarQuoteToken, i)) {
        i += dollarQuoteToken.length - 1;
        state = 'code';
      }
      continue;
    }

    if (char === "'") {
      state = 'single';
      continue;
    }
    if (char === '"') {
      state = 'double';
      continue;
    }
    if (char === '-' && next === '-') {
      i++;
      state = 'line-comment';
      continue;
    }
    if (char === '/' && next === '*') {
      i++;
      state = 'block-comment';
      continue;
    }
    if (char === '$') {
      const dollarQuote = readDollarQuoteToken(query, i);
      if (dollarQuote) {
        i += dollarQuote.length - 1;
        state = 'dollar-quote';
        dollarQuoteToken = dollarQuote;
        continue;
      }

      const positionalMatch = query.slice(i).match(/^\$(\d+)/);
      if (positionalMatch) {
        sawPostgresPlaceholder = true;
        i += positionalMatch[0].length - 1;
        continue;
      }
    }
    if (char === '?') {
      questionPlaceholderCount++;
    }
  }

  return { questionPlaceholderCount, sawPostgresPlaceholder };
}

export function normalizePostgresSqlPlaceholders(query: string, expectedParamCount = 0): string {
  const { questionPlaceholderCount, sawPostgresPlaceholder } = scanSqlPlaceholders(query);
  if (questionPlaceholderCount === 0) {
    return query;
  }
  if (sawPostgresPlaceholder) {
    throw new Error('Cannot mix ? placeholders with PostgreSQL-style $n placeholders.');
  }
  if (expectedParamCount === 0) {
    return query;
  }
  if (questionPlaceholderCount !== expectedParamCount) {
    throw new Error(
      'PostgreSQL raw SQL placeholders do not match params length. If your query uses the PostgreSQL ? operator, use $1, $2, ... for bind parameters.',
    );
  }

  let normalized = '';
  let paramIndex = 1;
  let state: 'code' | 'single' | 'double' | 'line-comment' | 'block-comment' | 'dollar-quote' =
    'code';
  let dollarQuoteToken = '';

  for (let i = 0; i < query.length; i++) {
    const char = query[i]!;
    const next = query[i + 1];

    if (state === 'single') {
      normalized += char;
      if (char === "'" && next === "'") {
        normalized += next;
        i++;
        continue;
      }
      if (char === "'") state = 'code';
      continue;
    }

    if (state === 'double') {
      normalized += char;
      if (char === '"' && next === '"') {
        normalized += next;
        i++;
        continue;
      }
      if (char === '"') state = 'code';
      continue;
    }

    if (state === 'line-comment') {
      normalized += char;
      if (char === '\n') state = 'code';
      continue;
    }

    if (state === 'block-comment') {
      normalized += char;
      if (char === '*' && next === '/') {
        normalized += next;
        i++;
        state = 'code';
      }
      continue;
    }

    if (state === 'dollar-quote') {
      if (query.startsWith(dollarQuoteToken, i)) {
        normalized += dollarQuoteToken;
        i += dollarQuoteToken.length - 1;
        state = 'code';
        continue;
      }
      normalized += char;
      continue;
    }

    if (char === "'") {
      normalized += char;
      state = 'single';
      continue;
    }
    if (char === '"') {
      normalized += char;
      state = 'double';
      continue;
    }
    if (char === '-' && next === '-') {
      normalized += '--';
      i++;
      state = 'line-comment';
      continue;
    }
    if (char === '/' && next === '*') {
      normalized += '/*';
      i++;
      state = 'block-comment';
      continue;
    }
    if (char === '$') {
      const dollarQuote = readDollarQuoteToken(query, i);
      if (dollarQuote) {
        normalized += dollarQuote;
        i += dollarQuote.length - 1;
        state = 'dollar-quote';
        dollarQuoteToken = dollarQuote;
        continue;
      }

      const positionalMatch = query.slice(i).match(/^\$(\d+)/);
      if (positionalMatch) {
        normalized += positionalMatch[0];
        i += positionalMatch[0].length - 1;
        continue;
      }
    }
    if (char === '?') {
      normalized += `$${paramIndex++}`;
      continue;
    }

    normalized += char;
  }

  return normalized;
}

export async function executeProviderAwareSql(
  opts: ProviderAwareSqlOptions,
  namespace: string,
  id: string | undefined,
  query: string,
  params: unknown[] = [],
): Promise<ProviderAwareSqlResult> {
  const dbBlock = opts.config.databases?.[namespace];
  const isDynamicNamespace = !!(
    dbBlock?.instance ||
    dbBlock?.access?.canCreate ||
    dbBlock?.access?.access
  );
  if (isDynamicNamespace && !id) {
    throw new Error(
      `admin.sqlWithDirectD1Access() requires an id for dynamic namespace '${namespace}'.`,
    );
  }

  if (opts.env) {
    if (!id && (dbBlock?.provider === 'neon' || dbBlock?.provider === 'postgres')) {
      const bindingName = getProviderBindingName(namespace);
      const envRecord = opts.env as unknown as Record<string, unknown>;
      const hyperdrive = envRecord[bindingName] as { connectionString?: string } | undefined;
      const envKey = dbBlock.connectionString ?? `${bindingName}_URL`;
      const connectionString =
        hyperdrive?.connectionString ?? (envRecord[envKey] as string | undefined);
      if (!connectionString) {
        throw new Error(`PostgreSQL connection '${envKey}' not found.`);
      }

      const normalizedSql = normalizePostgresSqlPlaceholders(query, params.length);
      const localDevOptions = getLocalDevPostgresExecOptions(
        opts.env as unknown as Record<string, unknown>,
        namespace,
      );
      if (localDevOptions) {
        await ensureLocalDevPostgresSchema(localDevOptions);
      }
      return withPostgresConnection(
        connectionString,
        async (executor) => {
          if (!localDevOptions) {
            await ensurePgSchema(connectionString, namespace, dbBlock.tables ?? {}, executor);
          }
          return executor(normalizedSql, params);
        },
        localDevOptions,
      );
    }

    if (!id && shouldRouteToD1(namespace, opts.config)) {
      const bindingName = getD1BindingName(namespace);
      const d1 = (opts.env as unknown as Record<string, unknown>)[bindingName] as
        | D1Database
        | undefined;
      if (!d1) {
        throw new Error(`D1 binding '${bindingName}' not found.`);
      }
      const result = await executeD1Sql(d1, query, params);
      const rows = result.rows;
      return {
        columns: inferColumns(rows),
        rows,
        rowCount: result.rowCount,
      };
    }

    if (opts.databaseNamespace) {
      const rows = await executeDoSql({
        databaseNamespace: opts.databaseNamespace,
        namespace,
        id,
        query,
        params,
        internal: true,
      });
      return {
        columns: inferColumns(rows),
        rows,
        rowCount: rows.length,
      };
    }
  }

  if (opts.workerUrl && opts.serviceKey) {
    const res = await fetch(`${opts.workerUrl}/api/sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': opts.serviceKey,
      },
      body: JSON.stringify({ namespace, id, sql: query, params }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: 'SQL execution failed' }))) as {
        message?: string;
      };
      throw new Error(err.message || 'SQL execution failed');
    }
    const data = (await res.json()) as {
      rows?: unknown[];
      items?: unknown[];
      results?: unknown[];
      columns?: string[];
      rowCount?: number;
    };
    const rows = normalizeRows(data);
    return {
      columns: Array.isArray(data.columns) ? data.columns.map(String) : inferColumns(rows),
      rows,
      rowCount: typeof data.rowCount === 'number' ? data.rowCount : rows.length,
    };
  }

  throw new Error('admin.sqlWithDirectD1Access() requires env or workerUrl.');
}
