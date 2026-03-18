import { EdgeBaseError, type EdgeBaseConfig } from '@edge-base/shared';
import type { Env } from '../types.js';
import { callDO, getDbDoName, getD1BindingName, shouldRouteToD1 } from './do-router.js';
import { ensureD1Schema } from './d1-schema-init.js';
import { ensurePgSchema } from './postgres-schema-init.js';
import {
  ensureLocalDevPostgresSchema,
  getLocalDevPostgresExecOptions,
  getProviderBindingName,
  withPostgresConnection,
} from './postgres-executor.js';

interface DumpNamespaceTablesOptions {
  includeMeta?: boolean;
  tableNames?: string[];
}

export async function dumpNamespaceTables(
  env: Env,
  config: EdgeBaseConfig,
  namespace: string,
  options: DumpNamespaceTablesOptions = {},
): Promise<Record<string, unknown[]>> {
  const dbBlock = config.databases?.[namespace];
  if (!dbBlock) {
    throw new EdgeBaseError(404, `Namespace '${namespace}' not found in config.`);
  }

  const tableNames = options.tableNames?.length
    ? options.tableNames
    : Object.keys(dbBlock.tables ?? {});
  const tables: Record<string, unknown[]> = {};
  const includeMeta = options.includeMeta !== false;

  if (dbBlock.provider === 'neon' || dbBlock.provider === 'postgres') {
    const bindingName = getProviderBindingName(namespace);
    const envRecord = env as unknown as Record<string, unknown>;
    const hyperdrive = envRecord[bindingName] as { connectionString?: string } | undefined;
    const envKey = dbBlock.connectionString ?? `${bindingName}_URL`;
    const connStr = hyperdrive?.connectionString ?? (envRecord[envKey] as string | undefined);
    if (!connStr) {
      throw new EdgeBaseError(500, `PostgreSQL connection not available for '${namespace}'.`);
    }

    const localDevOptions = getLocalDevPostgresExecOptions(env as unknown as Record<string, unknown>, namespace);
    if (localDevOptions) {
      await ensureLocalDevPostgresSchema(localDevOptions);
    }
    await withPostgresConnection(connStr, async (query) => {
      if (!localDevOptions) {
        await ensurePgSchema(connStr, namespace, dbBlock.tables ?? {}, query);
      }
      for (const tableName of tableNames) {
        try {
          const result = await query(`SELECT * FROM "${tableName}"`, []);
          tables[tableName] = result.rows;
        } catch {
          tables[tableName] = [];
        }
      }

      if (includeMeta) {
        try {
          const meta = await query('SELECT * FROM "_meta"', []);
          tables['_meta'] = meta.rows;
        } catch {
          tables['_meta'] = [];
        }
      }
    }, localDevOptions);

    return tables;
  }

  if (shouldRouteToD1(namespace, config)) {
    const bindingName = getD1BindingName(namespace);
    const db = (env as unknown as Record<string, unknown>)[bindingName] as D1Database | undefined;
    if (!db) {
      throw new EdgeBaseError(500, `D1 binding '${bindingName}' not available for '${namespace}'.`);
    }

    await ensureD1Schema(db, namespace, dbBlock.tables ?? {});
    for (const tableName of tableNames) {
      try {
        const result = await db.prepare(`SELECT * FROM "${tableName}"`).all();
        tables[tableName] = result.results ?? [];
      } catch {
        tables[tableName] = [];
      }
    }

    if (includeMeta) {
      try {
        const meta = await db.prepare('SELECT * FROM "_meta"').all();
        tables['_meta'] = meta.results ?? [];
      } catch {
        tables['_meta'] = [];
      }
    }

    return tables;
  }

  const doName = getDbDoName(namespace);
  const response = await callDO(env.DATABASE, doName, '/internal/backup/dump', {
    headers: { 'X-DO-Name': doName },
  });

  if (!response.ok) {
    throw new EdgeBaseError(response.status as 500, `Namespace dump failed: ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    tables?: Record<string, Array<Record<string, unknown>>>;
  };

  for (const tableName of tableNames) {
    tables[tableName] = payload.tables?.[tableName] ?? [];
  }
  if (includeMeta) {
    tables['_meta'] = payload.tables?._meta ?? [];
  }

  return tables;
}
