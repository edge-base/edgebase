/**
 * Plugin Migration Engine (Phase 2)
 *
 * Executes plugin onInstall / version-keyed migrations on first request
 * after deploy. Versioned plugins are tracked in CONTROL_DB D1 via
 * `plugin_version:{pluginName}`, while in-flight execution is deduplicated
 * with a module-level promise latch.
 *
 * Provider-aware: if a plugin's dbBlock uses a PostgreSQL provider,
 * the admin context routes CRUD and sql() through PostgreSQL directly
 * instead of DO calls.
 */

import type { Env } from '../types.js';
import type { EdgeBaseConfig, PluginInstance } from '@edgebase-fun/shared';
import { parseConfig } from './do-router.js';
import { executePostgresQuery } from './postgres-executor.js';
import { getProviderBindingName } from './postgres-executor.js';
import { ensurePgSchema } from './postgres-schema-init.js';
import { ensureControlSchema, resolveControlDb, type ControlDb } from './control-db.js';
import { validateInsert, validateUpdate } from './validation.js';
import {
  escapePgIdentifier,
  preparePgInsertData,
  preparePgUpdateData,
  stripInternalPgFields,
} from './postgres-table-utils.js';
import {
  buildAdminDbProxy,
  buildFunctionKvProxy,
  buildFunctionD1Proxy,
  buildFunctionVectorizeProxy,
  buildFunctionPushProxy,
  buildAdminAuthContext,
} from './functions.js';
import { executeDoSql } from './do-sql.js';
import { resolveRootServiceKey } from './service-key.js';

/**
 * Promise-based latch: deduplicates concurrent migration requests.
 */
let migrationPromise: Promise<void> | null = null;
const versionlessPluginsExecuted = new Set<string>();
const currentVersionedPlugins = new Map<string, string>();
let controlSchemaReady = false;
let currentStateCacheExpiresAt = 0;

const DEFAULT_PLUGIN_MIGRATION_TIMEOUT_MS = 30_000;
const CURRENT_STATE_CACHE_TTL_MS = 30_000;

/**
 * Run pending plugin migrations (lazy, once per cold-start).
 *
 * For each plugin that declares `version`:
 * 1. Read stored version from CONTROL_DB (`plugin_version:{name}`)
 * 2. If no stored version → run `onInstall` and pending migrations up to current version
 * 3. If stored < current → run pending migrations in semver order
 * 4. Update stored version
 */
export async function executePluginMigrations(
  plugins: PluginInstance[],
  env: Env,
  config: EdgeBaseConfig,
  workerUrl?: string,
): Promise<void> {
  if (arePluginMigrationsCurrentInMemory(plugins)) {
    return;
  }

  const controlDb = resolveControlDb(env as unknown as Record<string, unknown>);
  await ensureControlSchemaOnce(controlDb);

  if (await arePluginMigrationsCurrent(controlDb, plugins)) {
    markPluginsCurrent(plugins);
    return;
  }

  if (!migrationPromise) {
    migrationPromise = runMigrationsWithTimeout(plugins, env, config, controlDb, workerUrl)
      .then(() => {
        markPluginsCurrent(plugins);
      })
      .catch((error) => {
        throw error;
      })
      .finally(() => {
        migrationPromise = null;
      });
  }
  return migrationPromise;
}

export function resetPluginMigrationState(): void {
  migrationPromise = null;
  versionlessPluginsExecuted.clear();
  currentVersionedPlugins.clear();
  controlSchemaReady = false;
  currentStateCacheExpiresAt = 0;
}

async function ensureControlSchemaOnce(controlDb: ControlDb): Promise<void> {
  if (controlSchemaReady) return;
  await ensureControlSchema(controlDb);
  controlSchemaReady = true;
}

function arePluginMigrationsCurrentInMemory(plugins: PluginInstance[]): boolean {
  if (Date.now() > currentStateCacheExpiresAt) {
    return false;
  }

  const versionedPlugins = plugins.filter((plugin) => plugin.version);
  const versionlessPlugins = plugins.filter(
    (plugin) => !plugin.version && (plugin.onInstall || plugin.migrations),
  );

  if (versionlessPlugins.some((plugin) => !versionlessPluginsExecuted.has(plugin.name))) {
    return false;
  }

  return versionedPlugins.every((plugin) => (
    currentVersionedPlugins.get(plugin.name) === plugin.version
  ));
}

function markPluginsCurrent(plugins: PluginInstance[]): void {
  for (const plugin of plugins) {
    if (plugin.version) {
      currentVersionedPlugins.set(plugin.name, plugin.version);
    }
  }
  currentStateCacheExpiresAt = Date.now() + CURRENT_STATE_CACHE_TTL_MS;
}

async function doMigrations(
  plugins: PluginInstance[],
  env: Env,
  config: EdgeBaseConfig,
  controlDb: ControlDb,
  workerUrl?: string,
): Promise<void> {
  const dbNamespace = env.DATABASE;

  for (const plugin of plugins) {
    if (!plugin.version && !plugin.onInstall && !plugin.migrations) continue;

    // 1. Read stored version from CONTROL_DB D1 _meta table
    const metaKey = `plugin_version:${plugin.name}`;
    const row = await controlDb.first<{ value: string }>('SELECT value FROM _meta WHERE key = ?', [
      metaKey,
    ]);
    const storedVersion = row?.value ?? null;

    // Build admin context for migration handlers (provider-aware)
    const adminCtx = buildMigrationAdminContext(
      dbNamespace,
      config,
      env as Env,
      resolveRootServiceKey(config, env),
      workerUrl,
    );

    if (storedVersion === null) {
      // ─── First install ───
      if (plugin.onInstall) {
        await plugin.onInstall({
          pluginConfig: plugin.config,
          admin: adminCtx,
          previousVersion: null,
        });
      }

      await runPendingMigrations(plugin, adminCtx, null);

      if (plugin.version) {
        await setPluginVersion(controlDb, plugin.name, plugin.version);
      } else {
        versionlessPluginsExecuted.add(plugin.name);
      }
    } else if (plugin.version && storedVersion !== plugin.version) {
      // ─── Pending migrations (semver-sorted) ───
      await runPendingMigrations(plugin, adminCtx, storedVersion);

      // Update stored version even when no version-keyed migrations exist.
      await setPluginVersion(controlDb, plugin.name, plugin.version);
    }
  }
}

async function runMigrationsWithTimeout(
  plugins: PluginInstance[],
  env: Env,
  config: EdgeBaseConfig,
  controlDb: ControlDb,
  workerUrl?: string,
): Promise<void> {
  const timeoutMs = resolvePluginMigrationTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    await Promise.race([
      doMigrations(plugins, env, config, controlDb, workerUrl),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Plugin migrations timed out (${timeoutMs}ms)`));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    console.error('[EdgeBase] Plugin migrations failed:', error);
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function resolvePluginMigrationTimeoutMs(): number {
  const raw = typeof process !== 'undefined' ? process.env.EDGEBASE_PLUGIN_MIGRATIONS_TIMEOUT_MS : undefined;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_PLUGIN_MIGRATION_TIMEOUT_MS;
}

async function arePluginMigrationsCurrent(
  controlDb: ControlDb,
  plugins: PluginInstance[],
): Promise<boolean> {
  const versionedPlugins = plugins.filter((plugin) => plugin.version);
  const versionlessPlugins = plugins.filter(
    (plugin) => !plugin.version && (plugin.onInstall || plugin.migrations),
  );

  if (versionlessPlugins.some((plugin) => !versionlessPluginsExecuted.has(plugin.name))) {
    return false;
  }

  if (versionedPlugins.length === 0) {
    return true;
  }

  const keys = versionedPlugins.map((plugin) => `plugin_version:${plugin.name}`);
  const placeholders = keys.map(() => '?').join(', ');
  const rows = await controlDb.query<{ key: string; value: string }>(
    `SELECT key, value FROM _meta WHERE key IN (${placeholders})`,
    keys,
  );
  const versions = new Map(rows.map((row) => [row.key, row.value]));

  return versionedPlugins.every((plugin) => (
    versions.get(`plugin_version:${plugin.name}`) === plugin.version
  ));
}

// ─── Helpers ───

async function setPluginVersion(db: ControlDb, pluginName: string, version: string): Promise<void> {
  await db.run('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)', [
    `plugin_version:${pluginName}`,
    version,
  ]);
}

async function runPendingMigrations(
  plugin: PluginInstance,
  admin: ReturnType<typeof buildMigrationAdminContext>,
  previousVersion: string | null,
): Promise<void> {
  if (!plugin.migrations) return;

  const pending = Object.keys(plugin.migrations)
    .filter((version) => !plugin.version || semverCompare(version, plugin.version) <= 0)
    .filter((version) => previousVersion === null || semverCompare(version, previousVersion) > 0)
    .sort(semverCompare);

  for (const version of pending) {
    const migrationFn = plugin.migrations[version];
    if (!migrationFn) continue;

    await migrationFn({
      pluginConfig: plugin.config,
      admin,
      previousVersion,
    });
  }
}

/**
 * Build a lightweight admin context for migration/onInstall handlers.
 * Provides `db().table()` (CRUD proxy via DO calls or PostgreSQL) and `sql()`.
 *
 * Provider-aware: checks the dbBlock's provider for each namespace.
 * - provider='do' (default) → routes through DO calls (existing behavior)
 * - provider='neon'|'postgres' → routes through PostgreSQL directly
 */
function buildMigrationAdminContext(
  dbNamespace: DurableObjectNamespace,
  _config: EdgeBaseConfig,
  env: Env,
  serviceKey?: string,
  workerUrl?: string,
) {
  const config = parseConfig(env);
  const doAdminDb = buildAdminDbProxy({
    databaseNamespace: dbNamespace,
    config,
    workerUrl,
    serviceKey,
    env,
  });

  /**
   * Resolve connection string for a PostgreSQL-backed namespace.
   * Returns null if not PostgreSQL or binding not available.
   */
  function resolvePgConnString(namespace: string): string | null {
    const dbBlock = config.databases?.[namespace];
    const provider = dbBlock?.provider ?? 'do';
    if (provider === 'do') return null;

    const bindingName = getProviderBindingName(namespace);
    const envRecord = env as unknown as Record<string, unknown>;

    // 1. Hyperdrive binding (production)
    const hyperdrive = envRecord[bindingName] as { connectionString: string } | undefined;
    if (hyperdrive?.connectionString) return hyperdrive.connectionString;

    // 2. Direct URL string (local dev)
    const envKey = dbBlock?.connectionString ?? `${bindingName}_URL`;
    const directUrl = envRecord[envKey] as string | undefined;
    return directUrl ?? null;
  }

  return {
    db(namespace: string, id?: string) {
      const pgConnStr = resolvePgConnString(namespace);

      // ─── PostgreSQL path ───
      if (pgConnStr) {
        return {
          table(tableName: string) {
            return buildPgTableOps(pgConnStr, namespace, tableName, config);
          },
        };
      }

      return doAdminDb(namespace, id);
    },

    async sql(
      namespace: string,
      id: string | undefined,
      query: string,
      params?: unknown[],
    ): Promise<unknown[]> {
      const dbBlock = config.databases?.[namespace];
      const isDynamicNamespace = !!(dbBlock?.instance || dbBlock?.access?.canCreate || dbBlock?.access?.access);
      if (isDynamicNamespace && !id) {
        throw new Error(`admin.sql() requires an id for dynamic namespace '${namespace}'.`);
      }

      const pgConnStr = resolvePgConnString(namespace);

      // ─── PostgreSQL path ───
      if (pgConnStr) {
        // Ensure schema is initialized before raw SQL
        const dbBlock = config.databases?.[namespace];
        if (dbBlock?.tables) {
          await ensurePgSchema(pgConnStr, namespace, dbBlock.tables);
        }
        const result = await executePostgresQuery(pgConnStr, query, params ?? []);
        return result.rows as unknown[];
      }

      // ─── DO path (existing) ───
      return executeDoSql({
        databaseNamespace: dbNamespace,
        namespace,
        id,
        query,
        params: params ?? [],
        internal: true,
      });
    },

    // ─── Convenience shortcut: table(name) → db('shared').table(name) ───
    table(name: string) {
      // Delegate to db('shared') which handles provider-aware routing
      return this.db('shared').table(name);
    },

    // ─── KV / D1 / Vectorize / Push proxies (HTTP-based, require workerUrl) ───
    kv(namespace: string) {
      return buildFunctionKvProxy(namespace, config, env, workerUrl, serviceKey);
    },
    d1(database: string) {
      return buildFunctionD1Proxy(database, config, env, workerUrl, serviceKey);
    },
    vector(index: string) {
      return buildFunctionVectorizeProxy(index, config, env, workerUrl, serviceKey);
    },
    push: buildFunctionPushProxy(workerUrl, serviceKey),

    // ─── Auth context (D1-backed) ───
    auth: buildAdminAuthContext({
      d1Database: env.AUTH_DB,
      serviceKey,
      workerUrl,
      kvNamespace: env.KV,
    }),

    // ─── Broadcast (HTTP → Worker → DatabaseLiveDO) ───
    async broadcast(
      channel: string,
      event: string,
      payload?: Record<string, unknown>,
    ): Promise<void> {
      if (!workerUrl || !serviceKey) {
        throw new Error('admin.broadcast() requires workerUrl and serviceKey.');
      }
      const res = await fetch(`${workerUrl}/api/db/broadcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EdgeBase-Service-Key': serviceKey,
        },
        body: JSON.stringify({ channel, event, payload: payload ?? {} }),
      });
      if (!res.ok) throw new Error(`admin.broadcast() failed: ${res.status}`);
    },

    // ─── Inter-function calls (HTTP → Worker → function handler) ───
    functions: {
      async call(name: string, data?: unknown): Promise<unknown> {
        if (!workerUrl || !serviceKey) {
          throw new Error('admin.functions.call() requires workerUrl and serviceKey.');
        }
        const safeName = name.split('/').map(encodeURIComponent).join('/');
        const res = await fetch(`${workerUrl}/api/functions/${safeName}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-EdgeBase-Service-Key': serviceKey,
          },
          body: JSON.stringify(data ?? {}),
        });
        if (!res.ok) {
          const err = (await res
            .json()
            .catch(() => ({ message: `Function call '${name}' failed` }))) as { message: string };
          throw new Error(err.message);
        }
        return res.json();
      },
    },
  };
}

/**
 * Build PostgreSQL CRUD operations for plugin migration admin context.
 * Simplified CRUD — no rules/hooks (migrations are internal/admin-level).
 */
function buildPgTableOps(
  connectionString: string,
  namespace: string,
  tableName: string,
  config: EdgeBaseConfig,
) {
  const tableConfig = config.databases?.[namespace]?.tables?.[tableName];
  if (!tableConfig) {
    throw new Error(`Migration table '${tableName}' not found in database '${namespace}'.`);
  }

  // Helper: ensure schema before first operation
  let schemaReady = false;
  async function ensureSchema(): Promise<void> {
    if (schemaReady) return;
    const dbBlock = config.databases?.[namespace];
    if (dbBlock?.tables) {
      await ensurePgSchema(connectionString, namespace, dbBlock.tables);
    }
    schemaReady = true;
  }

  return {
    async insert(data: Record<string, unknown>): Promise<Record<string, unknown>> {
      await ensureSchema();
      const validation = validateInsert(data, tableConfig.schema);
      if (!validation.valid) {
        throw new Error(`Migration insert validation failed: ${JSON.stringify(validation.errors)}`);
      }

      const prepared = preparePgInsertData(data, tableConfig).data;
      const cols = Object.keys(prepared);
      const vals = Object.values(prepared);
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const sql = `INSERT INTO ${escapePgIdentifier(tableName)} (${cols.map(escapePgIdentifier).join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
      const result = await executePostgresQuery(connectionString, sql, vals);
      return result.rows[0]
        ? stripInternalPgFields(result.rows[0] as Record<string, unknown>)
        : prepared;
    },

    async upsert(
      data: Record<string, unknown>,
      options?: { conflictTarget?: string },
    ): Promise<Record<string, unknown>> {
      await ensureSchema();
      const validation = validateInsert(data, tableConfig.schema);
      if (!validation.valid) {
        throw new Error(`Migration upsert validation failed: ${JSON.stringify(validation.errors)}`);
      }

      const payload = preparePgInsertData(data, tableConfig).data;
      const conflictTarget = options?.conflictTarget ?? 'id';
      const cols = Object.keys(payload);
      const vals = Object.values(payload);
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const updatableCols = cols.filter((col) => col !== conflictTarget);
      const setClauses = (updatableCols.length > 0 ? updatableCols : [conflictTarget]).map(
        (col) => `${escapePgIdentifier(col)} = EXCLUDED.${escapePgIdentifier(col)}`,
      );
      const sql = `INSERT INTO ${escapePgIdentifier(tableName)} (${cols.map(escapePgIdentifier).join(', ')}) VALUES (${placeholders.join(', ')})` +
        ` ON CONFLICT (${escapePgIdentifier(conflictTarget)}) DO UPDATE SET ${setClauses.join(', ')} RETURNING *`;
      const result = await executePostgresQuery(connectionString, sql, vals);
      return result.rows[0]
        ? stripInternalPgFields(result.rows[0] as Record<string, unknown>)
        : payload;
    },

    async update(rowId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
      await ensureSchema();
      const validation = validateUpdate(data, tableConfig.schema);
      if (!validation.valid) {
        throw new Error(`Migration update validation failed: ${JSON.stringify(validation.errors)}`);
      }

      const prepared = preparePgUpdateData(data, tableConfig).data;
      if (Object.keys(prepared).length === 0) {
        throw new Error(`Migration update: no valid fields to update in ${tableName}`);
      }

      const cols = Object.keys(prepared);
      const vals = Object.values(prepared);
      const setClauses = cols.map((c, i) => `${escapePgIdentifier(c)} = $${i + 1}`);
      const sql = `UPDATE ${escapePgIdentifier(tableName)} SET ${setClauses.join(', ')} WHERE "id" = $${cols.length + 1} RETURNING *`;
      const result = await executePostgresQuery(connectionString, sql, [...vals, rowId]);
      if (result.rows.length === 0)
        throw new Error(`Migration update: row '${rowId}' not found in ${tableName}`);
      return stripInternalPgFields(result.rows[0] as Record<string, unknown>);
    },

    async delete(rowId: string): Promise<{ deleted: boolean }> {
      await ensureSchema();
      const sql = `DELETE FROM ${escapePgIdentifier(tableName)} WHERE "id" = $1`;
      const result = await executePostgresQuery(connectionString, sql, [rowId]);
      return { deleted: result.rowCount > 0 };
    },

    async get(rowId: string): Promise<Record<string, unknown>> {
      await ensureSchema();
      const sql = `SELECT * FROM ${escapePgIdentifier(tableName)} WHERE "id" = $1`;
      const result = await executePostgresQuery(connectionString, sql, [rowId]);
      if (result.rows.length === 0)
        throw new Error(`Migration get: row '${rowId}' not found in ${tableName}`);
      return stripInternalPgFields(result.rows[0] as Record<string, unknown>);
    },

    async list(opts?: {
      limit?: number;
      filter?: unknown;
    }): Promise<{ items: Record<string, unknown>[] }> {
      await ensureSchema();
      let sql = `SELECT * FROM ${escapePgIdentifier(tableName)}`;
      const params: unknown[] = [];
      let paramIdx = 1;

      // Simple filter support: { column: value }
      if (opts?.filter && typeof opts.filter === 'object') {
        const filterEntries = Object.entries(opts.filter as Record<string, unknown>);
        if (filterEntries.length > 0) {
          const whereClauses = filterEntries.map(([col, val]) => {
            params.push(val);
            return `${escapePgIdentifier(col)} = $${paramIdx++}`;
          });
          sql += ` WHERE ${whereClauses.join(' AND ')}`;
        }
      }

      if (opts?.limit) {
        sql += ` LIMIT $${paramIdx}`;
        params.push(opts.limit);
      }

      const result = await executePostgresQuery(connectionString, sql, params);
      return { items: result.rows.map((row) => stripInternalPgFields(row as Record<string, unknown>)) };
    },
  };
}

/** Simple semver comparison: returns negative/0/positive like Array.sort compareFn. */
function semverCompare(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}
