/**
 * Backup/Restore Admin API routes  *
 * Service Key–protected endpoints for portable backup/recovery.
 * All routes require X-Service-Key header with valid SERVICE_KEY.
 *
 * Endpoints:
 *   POST /admin/api/backup/list-dos         — enumerate all DO instances from config
 *   POST /admin/api/backup/dump-do          — dump a specific DO's data
 *   POST /admin/api/backup/restore-do       — restore a specific DO's data
 *   POST /admin/api/backup/dump-d1          — dump auth database tables
 *   POST /admin/api/backup/restore-d1       — restore auth database tables
 *   POST /admin/api/backup/dump-control-d1  — dump internal control-plane tables
 *   POST /admin/api/backup/restore-control-d1 — restore internal control-plane tables
 *   POST /admin/api/backup/dump-data        — dump data namespace tables (D1 or PostgreSQL)
 *   POST /admin/api/backup/restore-data     — restore data namespace tables (D1 or PostgreSQL)
 *   POST /admin/api/backup/dump-storage     — list/download R2 objects
 *   POST /admin/api/backup/restore-storage  — wipe/upload R2 objects
 *   GET  /admin/api/backup/export/:name     — export table data as JSON
 */
import { OpenAPIHono, createRoute, z, type HonoEnv } from '../lib/hono.js';
import type { Env } from '../types.js';
import { EdgeBaseError } from '@edge-base/shared';
import { validateKey, buildConstraintCtx, resolveServiceKeyCandidate } from '../lib/service-key.js';
import {
  ensureAuthSchema,
  upsertUserPublic,
  type UserPublicData,
} from '../lib/auth-d1.js';
import {
  parseConfig,
  callDO,
  callDOByHexId,
  getDbDoName,
  shouldRouteToD1,
  getD1BindingName,
} from '../lib/do-router.js';
import { zodDefaultHook, jsonResponseSchema, errorResponseSchema } from '../lib/schemas.js';
import { resolveAuthDb, type AuthDb } from '../lib/auth-db-adapter.js';
import { ensureControlSchema, resolveControlDb, type ControlDb } from '../lib/control-db.js';
import { ensureD1Schema } from '../lib/d1-schema-init.js';
import { dumpNamespaceTables } from '../lib/namespace-dump.js';
import { ensurePgSchema } from '../lib/postgres-schema-init.js';
import { executePostgresQuery } from '../lib/postgres-executor.js';
import {
  ensureLocalDevPostgresSchema,
  getLocalDevPostgresExecOptions,
  getProviderBindingName,
  withPostgresConnection,
} from '../lib/postgres-executor.js';

/** Resolve AuthDb from Hono context. Defaults to D1 (AUTH_DB binding). */
function getAuthDb(c: { env: unknown }): AuthDb {
  return resolveAuthDb(c.env as Record<string, unknown>);
}

function getControlDb(c: { env: unknown }): ControlDb {
  return resolveControlDb(c.env as Record<string, unknown>);
}

export const backupRoute = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

// ─── Service Key Auth Middleware ───
backupRoute.use('*', async (c, next) => {
  const config = parseConfig(c.env);
  const provided = resolveServiceKeyCandidate(c.req);
  const { result } = validateKey(
    provided,
    'backup:*:*:exec',
    config,
    c.env,
    undefined,
    buildConstraintCtx(c.env, c.req),
  );
  if (result === 'missing') {
    throw new EdgeBaseError(403, 'Service Key required for backup operations.');
  }
  if (result === 'invalid') {
    throw new EdgeBaseError(401, 'Invalid or missing Service Key.');
  }
  await next();
});

// Error handler
backupRoute.onError((err, c) => {
  if (err instanceof EdgeBaseError) {
    return c.json(err.toJSON(), err.code as 400);
  }
  console.error('Backup API error:', err);
  return c.json({ code: 500, message: 'Backup operation failed unexpectedly. Check the worker logs for the original exception.' }, 500);
});

// ─── DO Name Helpers ───

interface DOInfo {
  doName: string;
  type: 'database' | 'auth';
  namespace: 'DATABASE' | 'AUTH';
}

interface PluginCleanupResult {
  tables: string[];
  metaKeys: string[];
}

function isSqliteFtsCompanionTable(name: string): boolean {
  return /_fts(?:_.+)?$/.test(name);
}

function quoteSqliteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quotePgIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function buildPluginSqliteCleanupPlan(
  tableNames: string[],
  prefix: string,
): PluginCleanupResult & { dropTables: string[] } {
  const basePrefix = `${prefix}/`;
  const tables = tableNames
    .filter(
      (name) => name !== '_meta' && name.startsWith(basePrefix) && !isSqliteFtsCompanionTable(name),
    )
    .sort();

  const dropTables = tables.flatMap((table) => [`${table}_fts`, table]);
  const metaKeys = tables.flatMap((table) => [`schemaHash:${table}`, `migration_version:${table}`]);

  return { tables, dropTables, metaKeys };
}

function buildPluginPgCleanupPlan(tableNames: string[], prefix: string): PluginCleanupResult {
  const basePrefix = `${prefix}/`;
  const tables = tableNames
    .filter((name) => name !== '_meta' && name.startsWith(basePrefix))
    .sort();
  const metaKeys = tables.flatMap((table) => [`schemaHash:${table}`, `migration_version:${table}`]);
  return { tables, metaKeys };
}

async function clearPluginVersionMeta(db: ControlDb, prefix: string): Promise<void> {
  await ensureControlSchema(db);
  await db.run('DELETE FROM _meta WHERE key = ?', [`plugin_version:${prefix}`]);
}

async function cleanupPluginTablesInD1(
  db: D1Database,
  prefix: string,
): Promise<PluginCleanupResult> {
  const rows = await db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`,
    )
    .all();
  const tableNames = (rows.results ?? []).map((row) =>
    String((row as Record<string, unknown>).name),
  );
  const plan = buildPluginSqliteCleanupPlan(tableNames, prefix);

  for (const tableName of plan.dropTables) {
    await db.prepare(`DROP TABLE IF EXISTS ${quoteSqliteIdent(tableName)}`).run();
  }
  for (const metaKey of plan.metaKeys) {
    await db.prepare(`DELETE FROM "_meta" WHERE "key" = ?`).bind(metaKey).run();
  }

  return { tables: plan.tables, metaKeys: plan.metaKeys };
}

async function cleanupPluginTablesInPostgres(
  connectionString: string,
  prefix: string,
): Promise<PluginCleanupResult> {
  const result = await executePostgresQuery(
    connectionString,
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    [],
  );
  const tableNames = result.rows.map((row) => String((row as Record<string, unknown>).table_name));
  const plan = buildPluginPgCleanupPlan(tableNames, prefix);

  for (const tableName of plan.tables) {
    await executePostgresQuery(
      connectionString,
      `DROP TRIGGER IF EXISTS ${quotePgIdent(`${tableName}_fts_update`)} ON ${quotePgIdent(tableName)}`,
      [],
    );
    await executePostgresQuery(
      connectionString,
      `DROP TABLE IF EXISTS ${quotePgIdent(tableName)} CASCADE`,
      [],
    );
    await executePostgresQuery(
      connectionString,
      `DROP FUNCTION IF EXISTS ${quotePgIdent(`${tableName}_fts_trigger`)}() CASCADE`,
      [],
    );
  }
  for (const metaKey of plan.metaKeys) {
    await executePostgresQuery(connectionString, `DELETE FROM "_meta" WHERE "key" = $1`, [metaKey]);
  }

  return plan;
}

async function callDatabaseDoSql(
  env: Env,
  doName: string,
  query: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const resp = await callDO(env.DATABASE, doName, '/internal/sql', {
    method: 'POST',
    headers: { 'X-DO-Name': doName },
    body: { query, params },
  });

  const data = (await resp.json().catch(() => ({}))) as {
    rows?: Record<string, unknown>[];
    message?: string;
  };
  if (!resp.ok) {
    throw new EdgeBaseError(resp.status as 500, data.message || 'DO SQL execution failed.');
  }
  return data.rows ?? [];
}

async function cleanupPluginTablesInDO(
  env: Env,
  doName: string,
  prefix: string,
): Promise<PluginCleanupResult> {
  const rows = await callDatabaseDoSql(
    env,
    doName,
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`,
  );
  const tableNames = rows.map((row) => String(row.name));
  const plan = buildPluginSqliteCleanupPlan(tableNames, prefix);

  for (const tableName of plan.dropTables) {
    await callDatabaseDoSql(env, doName, `DROP TABLE IF EXISTS ${quoteSqliteIdent(tableName)}`);
  }
  for (const metaKey of plan.metaKeys) {
    await callDatabaseDoSql(env, doName, `DELETE FROM "_meta" WHERE "key" = ?`, [metaKey]);
  }

  return { tables: plan.tables, metaKeys: plan.metaKeys };
}

/**
 * Enumerate all DO instance names from config (§1/§2).
 * Covers: namespace DOs from databases block (as 'namespace' name),
 *         auth:shard-{0..15}
 * Isolation is at the namespace DO level — individual tenant DOs are
 * dynamically created (namespace:id) and cannot be statically enumerated.
 * Use doName = namespace for static DBs, or discover via app-level listing.
 */
async function enumerateDOs(env: Env): Promise<DOInfo[]> {
  const dos: DOInfo[] = [];
  const seenNames = new Set<string>();

  // 1. Parse config for database-namespace DOs (§1/§2)
  const config = parseConfig(env);

  if (env.DATABASE) {
    // Static shared DB
    const sharedDoName = getDbDoName('shared');
    if (!seenNames.has(sharedDoName)) {
      dos.push({ doName: sharedDoName, type: 'database', namespace: 'DATABASE' });
      seenNames.add(sharedDoName);
    }

    // databases block namespaces (static DOs only — dynamic namespace:id DOs need app-level discovery)
    for (const ns of Object.keys(config.databases ?? {})) {
      const doName = getDbDoName(ns);
      if (!seenNames.has(doName)) {
        dos.push({ doName, type: 'database', namespace: 'DATABASE' });
        seenNames.add(doName);
      }
    }
  }

  return dos;
}

// ─── Routes ───

// POST /admin/api/backup/list-dos — enumerate all DO instances
const listDOs = createRoute({
  operationId: 'backupListDOs',
  method: 'post',
  path: '/list-dos',
  tags: ['admin'],
  summary: 'List all DO instances',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              hexIds: z.array(z.string()).optional(),
            })
            .passthrough(),
        },
      },
      required: false,
    },
  },
  responses: {
    200: {
      description: 'DO list',
      content: { 'application/json': { schema: jsonResponseSchema } },
    },
    400: {
      description: 'Bad request',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

backupRoute.openapi(listDOs, async (c) => {
  const body = await c.req.json<{ hexIds?: string[] }>().catch(() => ({}) as { hexIds?: string[] });

  if (body.hexIds && body.hexIds.length > 0) {
    // Edge mode: resolve hex IDs to DO names
    const dos: DOInfo[] = [];

    for (const hexId of body.hexIds) {
      // Database DO: call dump to get _meta doName
      if (c.env.DATABASE) {
        try {
          const resp = await callDOByHexId(c.env.DATABASE, hexId, '/internal/backup/dump');
          if (resp.ok) {
            const data = (await resp.json()) as { doName?: string };
            if (data.doName) {
              dos.push({ doName: data.doName, type: 'database', namespace: 'DATABASE' });
              continue;
            }
          }
        } catch {
          /* not a Database DO */
        }
      }

      // Try as Auth DO (non-shard, e.g. future expansion)
      if (c.env.AUTH) {
        try {
          const resp = await callDOByHexId(c.env.AUTH, hexId, '/internal/backup/dump');
          if (resp.ok) {
            const data = (await resp.json()) as { doName?: string };
            if (data.doName) {
              dos.push({ doName: data.doName, type: 'auth', namespace: 'AUTH' });
              continue;
            }
          }
        } catch {
          /* not an Auth DO */
        }
      }
    }

    return c.json({ dos, total: dos.length });
  }

  // Config-scan mode: enumerate via config + membership
  const dos = await enumerateDOs(c.env);
  return c.json({
    dos,
    total: dos.length,
  });
});

// GET /admin/api/backup/config — return parsed config snapshot
const getConfig = createRoute({
  operationId: 'backupGetConfig',
  method: 'get',
  path: '/config',
  tags: ['admin'],
  summary: 'Return parsed config snapshot',
  responses: {
    200: {
      description: 'Config snapshot',
      content: { 'application/json': { schema: jsonResponseSchema } },
    },
  },
});

backupRoute.openapi(getConfig, (c) => {
  const config = parseConfig(c.env);
  return c.json(config);
});

// POST /admin/api/backup/cleanup-plugin — remove plugin-prefixed tables from a namespace/DO
const cleanupPlugin = createRoute({
  operationId: 'backupCleanupPlugin',
  method: 'post',
  path: '/cleanup-plugin',
  tags: ['admin'],
  summary: 'Remove plugin-prefixed tables and migration metadata',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              prefix: z.string(),
              namespace: z.string().optional(),
              id: z.string().optional(),
              doName: z.string().optional(),
            })
            .passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Cleanup result',
      content: { 'application/json': { schema: jsonResponseSchema } },
    },
    400: {
      description: 'Bad request',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

backupRoute.openapi(cleanupPlugin, async (c) => {
  const body = await c.req.json<{
    prefix: string;
    namespace?: string;
    id?: string;
    doName?: string;
  }>();

  const prefix = body.prefix.trim().replace(/\/+$/, '');
  if (!prefix) throw new EdgeBaseError(400, 'prefix is required.');

  let removed: PluginCleanupResult = { tables: [], metaKeys: [] };

  if (body.doName) {
    removed = await cleanupPluginTablesInDO(c.env, body.doName, prefix);
  } else if (body.namespace) {
    const config = parseConfig(c.env);
    const dbBlock = config.databases?.[body.namespace];
    const envRecord = c.env as unknown as Record<string, unknown>;
    const d1BindingName = getD1BindingName(body.namespace);
    const d1 = envRecord[d1BindingName] as D1Database | undefined;
    const pgBindingName = getProviderBindingName(body.namespace);
    const hyperdrive = envRecord[pgBindingName] as { connectionString?: string } | undefined;
    const envKey = dbBlock?.connectionString ?? `${pgBindingName}_URL`;
    const directUrl = envRecord[envKey] as string | undefined;
    const connectionString = hyperdrive?.connectionString ?? directUrl;
    const wantsPostgres = dbBlock?.provider === 'neon' || dbBlock?.provider === 'postgres';
    const wantsD1 = !!dbBlock && !body.id && shouldRouteToD1(body.namespace, config);

    if (wantsPostgres || (!dbBlock && connectionString)) {
      if (!connectionString) {
        throw new EdgeBaseError(500, `PostgreSQL binding '${pgBindingName}' not found.`);
      }
      removed = await cleanupPluginTablesInPostgres(connectionString, prefix);
    } else if (wantsD1 || (!dbBlock && !body.id && d1)) {
      if (!d1) {
        throw new EdgeBaseError(500, `D1 binding '${d1BindingName}' not found.`);
      }
      removed = await cleanupPluginTablesInD1(d1, prefix);
    } else {
      removed = await cleanupPluginTablesInDO(c.env, getDbDoName(body.namespace, body.id), prefix);
    }
  }

  await clearPluginVersionMeta(getControlDb(c), prefix);
  const metaKeys = [...removed.metaKeys, `plugin_version:${prefix}`];

  return c.json({
    ok: true,
    prefix,
    target: body.doName
      ? { doName: body.doName }
      : body.namespace
        ? { namespace: body.namespace, ...(body.id ? { id: body.id } : {}) }
        : null,
    removed: {
      tables: removed.tables,
      metaKeys,
    },
  });
});

// POST /admin/api/backup/wipe-do — wipe a specific DO's data (orphan cleanup)
const wipeDO = createRoute({
  operationId: 'backupWipeDO',
  method: 'post',
  path: '/wipe-do',
  tags: ['admin'],
  summary: "Wipe a specific DO's data",
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              doName: z.string(),
              type: z.enum(['database', 'auth']),
            })
            .passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Wipe result',
      content: { 'application/json': { schema: jsonResponseSchema } },
    },
    400: {
      description: 'Bad request',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

backupRoute.openapi(wipeDO, async (c) => {
  const { doName, type } = await c.req.json<{ doName: string; type: 'database' | 'auth' }>();
  if (!doName) throw new EdgeBaseError(400, 'doName is required.');

  const namespace = type === 'auth' ? c.env.AUTH : c.env.DATABASE;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= 10; attempt++) {
    const resp = await callDO(namespace, doName, '/internal/drop-all', {
      method: 'POST',
      headers: { 'X-DO-Name': doName },
    });

    if (resp.ok) {
      return c.json({ ok: true, doName });
    }

    lastError = await resp.text();
    const lockError = lastError.includes('SQLITE_LOCKED') || lastError.includes('table is locked');
    if (!lockError || attempt === 10) {
      throw new EdgeBaseError(resp.status as 500, `DO wipe failed: ${lastError}`);
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 200));
  }
  throw new EdgeBaseError(500, `DO wipe failed: ${lastError ?? 'unknown error'}`);
});

// POST /admin/api/backup/dump-do — dump a specific DO
const dumpDO = createRoute({
  operationId: 'backupDumpDO',
  method: 'post',
  path: '/dump-do',
  tags: ['admin'],
  summary: "Dump a specific DO's data",
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              doName: z.string(),
              type: z.enum(['database', 'auth']),
            })
            .passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'DO dump data',
      content: { 'application/json': { schema: jsonResponseSchema } },
    },
    400: {
      description: 'Bad request',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

backupRoute.openapi(dumpDO, async (c) => {
  const { doName, type } = await c.req.json<{ doName: string; type: 'database' | 'auth' }>();
  if (!doName) throw new EdgeBaseError(400, 'doName is required.');

  const namespace = type === 'auth' ? c.env.AUTH : c.env.DATABASE;
  const resp = await callDO(namespace, doName, '/internal/backup/dump', {
    headers: { 'X-DO-Name': doName },
  });

  if (!resp.ok) {
    const error = await resp.text();
    throw new EdgeBaseError(resp.status as 500, `DO dump failed: ${error}`);
  }

  const data = await resp.json();
  return c.json(data);
});

// POST /admin/api/backup/restore-do — restore a specific DO
const restoreDO = createRoute({
  operationId: 'backupRestoreDO',
  method: 'post',
  path: '/restore-do',
  tags: ['admin'],
  summary: "Restore a specific DO's data",
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              doName: z.string(),
              type: z.enum(['database', 'auth']),
              tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
            })
            .passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Restore result',
      content: { 'application/json': { schema: jsonResponseSchema } },
    },
    400: {
      description: 'Bad request',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

backupRoute.openapi(restoreDO, async (c) => {
  const body = await c.req.json<{
    doName: string;
    type: 'database' | 'auth';
    tables: Record<string, Array<Record<string, unknown>>>;
  }>();

  if (!body.doName) throw new EdgeBaseError(400, 'doName is required.');
  if (!body.tables) throw new EdgeBaseError(400, 'tables data is required.');

  const namespace = body.type === 'auth' ? c.env.AUTH : c.env.DATABASE;
  const resp = await callDO(namespace, body.doName, '/internal/backup/restore', {
    method: 'POST',
    body: { tables: body.tables },
    headers: { 'X-DO-Name': body.doName },
  });

  if (!resp.ok) {
    const error = await resp.text();
    throw new EdgeBaseError(resp.status as 500, `DO restore failed: ${error}`);
  }

  const data = await resp.json();
  return c.json(data);
});

// POST /admin/api/backup/dump-d1 — dump auth database tables
const dumpD1 = createRoute({
  operationId: 'backupDumpD1',
  method: 'post',
  path: '/dump-d1',
  tags: ['admin'],
  summary: 'Dump auth database tables',
  responses: {
    200: {
      description: 'D1 dump data',
      content: { 'application/json': { schema: jsonResponseSchema } },
    },
  },
});

backupRoute.openapi(dumpD1, async (c) => {
  const authDb = getAuthDb(c);
  await ensureAuthSchema(authDb);

  const D1_TABLES = [
    '_email_index',
    '_oauth_index',
    '_anon_index',
    '_phone_index',
    '_passkey_index',
    '_admins',
    '_admin_sessions',
    '_users_public',
    '_meta',
    // Auth tables (Phase 3: Auth DO → D1)
    '_users',
    '_sessions',
    '_oauth_accounts',
    '_email_tokens',
    '_mfa_factors',
    '_mfa_recovery_codes',
    '_webauthn_credentials',
  ];
  const tables: Record<string, unknown[]> = {};

  for (const tableName of D1_TABLES) {
    try {
      tables[tableName] = await authDb.query(`SELECT * FROM "${tableName}"`);
    } catch {
      tables[tableName] = [];
    }
  }

  return c.json({
    type: 'd1',
    tables,
    timestamp: new Date().toISOString(),
  });
});

// POST /admin/api/backup/restore-d1 — restore auth database tables
const restoreD1 = createRoute({
  operationId: 'backupRestoreD1',
  method: 'post',
  path: '/restore-d1',
  tags: ['admin'],
  summary: 'Restore auth database tables',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
            })
            .passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Restore result',
      content: { 'application/json': { schema: jsonResponseSchema } },
    },
    400: {
      description: 'Bad request',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

backupRoute.openapi(restoreD1, async (c) => {
  const body = await c.req.json<{
    tables: Record<string, Array<Record<string, unknown>>>;
    skipWipe?: boolean;
  }>();

  if (!body.tables) throw new EdgeBaseError(400, 'tables data is required.');

  const authDb = getAuthDb(c);
  await ensureAuthSchema(authDb);

  // 1. Wipe existing data (child tables first for FK safety) — skip if skipWipe is true
  if (!body.skipWipe) {
    const WIPE_ORDER = [
      '_admin_sessions',
      '_webauthn_credentials',
      '_mfa_recovery_codes',
      '_mfa_factors',
      '_email_tokens',
      '_oauth_accounts',
      '_sessions',
      '_anon_index',
      '_oauth_index',
      '_email_index',
      '_phone_index',
      '_passkey_index',
      '_users_public',
      '_meta',
      '_admins',
      '_users',
    ];
    const wipeStatements: { sql: string; params?: unknown[] }[] = [];

    for (const tableName of WIPE_ORDER) {
      wipeStatements.push({ sql: `DELETE FROM "${tableName}"` });
    }

    await authDb.batch(wipeStatements);
  }

  // 2. Insert backup data (parent tables first for FK constraints)
  const INSERT_ORDER = [
    '_users',
    '_admins',
    '_meta',
    '_users_public',
    '_email_index',
    '_oauth_index',
    '_anon_index',
    '_phone_index',
    '_passkey_index',
    '_sessions',
    '_oauth_accounts',
    '_email_tokens',
    '_mfa_factors',
    '_mfa_recovery_codes',
    '_webauthn_credentials',
    '_admin_sessions',
  ];
  for (const tableName of INSERT_ORDER) {
    const rows = body.tables[tableName];
    if (!rows || rows.length === 0) continue;

    // Build batch statements for efficient inserts
    const insertStmts: { sql: string; params?: unknown[] }[] = [];
    for (const row of rows) {
      const columns = Object.keys(row);
      const placeholders = columns.map(() => '?').join(', ');
      const escId = (n: string) => `"${n.replace(/"/g, '""')}"`;
      const colStr = columns.map((col) => escId(col)).join(', ');
      const values = columns.map((col) => row[col]);
      insertStmts.push({
        sql: `INSERT OR REPLACE INTO ${escId(tableName)} (${colStr}) VALUES (${placeholders})`,
        params: values,
      });
    }

    // Batch limit is 100 — chunk if needed
    const BATCH_SIZE = 100;
    for (let i = 0; i < insertStmts.length; i += BATCH_SIZE) {
      const chunk = insertStmts.slice(i, i + BATCH_SIZE);
      await authDb.batch(chunk);
    }
  }

  return c.json({ ok: true, restored: Object.keys(body.tables).length });
});

const dumpControlD1 = createRoute({
  operationId: 'backupDumpControlD1',
  method: 'post',
  path: '/dump-control-d1',
  tags: ['admin'],
  summary: 'Dump control-plane D1 tables',
  responses: {
    200: {
      description: 'Control-plane D1 dump data',
      content: { 'application/json': { schema: jsonResponseSchema } },
    },
  },
});

backupRoute.openapi(dumpControlD1, async (c) => {
  const controlDb = getControlDb(c);
  await ensureControlSchema(controlDb);

  const tables: Record<string, unknown[]> = {};
  try {
    tables._meta = await controlDb.query('SELECT * FROM "_meta"');
  } catch {
    tables._meta = [];
  }

  return c.json({
    type: 'd1',
    tables,
    timestamp: new Date().toISOString(),
  });
});

const restoreControlD1 = createRoute({
  operationId: 'backupRestoreControlD1',
  method: 'post',
  path: '/restore-control-d1',
  tags: ['admin'],
  summary: 'Restore control-plane D1 tables',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
            })
            .passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Restore result',
      content: { 'application/json': { schema: jsonResponseSchema } },
    },
    400: {
      description: 'Bad request',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

backupRoute.openapi(restoreControlD1, async (c) => {
  const body = await c.req.json<{
    tables: Record<string, Array<Record<string, unknown>>>;
    skipWipe?: boolean;
  }>();

  if (!body.tables) throw new EdgeBaseError(400, 'tables data is required.');

  const controlDb = getControlDb(c);
  await ensureControlSchema(controlDb);

  if (!body.skipWipe) {
    await controlDb.batch([{ sql: 'DELETE FROM "_meta"' }]);
  }

  const metaRows = body.tables._meta ?? [];
  if (metaRows.length > 0) {
    const insertStmts = metaRows.map((row) => {
      const columns = Object.keys(row);
      const placeholders = columns.map(() => '?').join(', ');
      const escId = (name: string) => `"${name.replace(/"/g, '""')}"`;
      const colStr = columns.map((col) => escId(col)).join(', ');
      return {
        sql: `INSERT OR REPLACE INTO "_meta" (${colStr}) VALUES (${placeholders})`,
        params: columns.map((col) => row[col]),
      };
    });

    const batchSize = 100;
    for (let i = 0; i < insertStmts.length; i += batchSize) {
      await controlDb.batch(insertStmts.slice(i, i + batchSize));
    }
  }

  return c.json({ ok: true, restored: metaRows.length > 0 ? 1 : 0 });
});

// ─── Data Namespace Dump/Restore — Phase 5 ───

// POST /admin/api/backup/dump-data — dump data namespace tables (D1 or PostgreSQL)
const dumpData = createRoute({
  operationId: 'backupDumpData',
  method: 'post',
  path: '/dump-data',
  tags: ['admin'],
  summary: 'Dump all tables from a data namespace',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              namespace: z.string(),
            })
            .passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Data namespace dump',
      content: { 'application/json': { schema: jsonResponseSchema } },
    },
    400: {
      description: 'Bad request',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Namespace not found',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

backupRoute.openapi(dumpData, async (c) => {
  const { namespace } = await c.req.json<{ namespace: string }>();
  if (!namespace) throw new EdgeBaseError(400, 'namespace is required.');

  const config = parseConfig(c.env);
  const dbBlock = config.databases?.[namespace];
  if (!dbBlock) throw new EdgeBaseError(404, `Namespace '${namespace}' not found in config.`);

  const tableNames = Object.keys(dbBlock.tables ?? {});
  const tables = await dumpNamespaceTables(c.env, config, namespace, {
    includeMeta: true,
    tableNames,
  });

  return c.json({
    type: 'data',
    namespace,
    tables,
    tableOrder: tableNames,
    timestamp: new Date().toISOString(),
  });
});

// POST /admin/api/backup/restore-data — restore data namespace tables (D1 or PostgreSQL)
const restoreData = createRoute({
  operationId: 'backupRestoreData',
  method: 'post',
  path: '/restore-data',
  tags: ['admin'],
  summary: 'Restore all tables into a data namespace',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              namespace: z.string(),
              tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
            })
            .passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Restore result',
      content: { 'application/json': { schema: jsonResponseSchema } },
    },
    400: {
      description: 'Bad request',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Namespace not found',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

backupRoute.openapi(restoreData, async (c) => {
  const body = await c.req.json<{
    namespace: string;
    tables: Record<string, Array<Record<string, unknown>>>;
    skipWipe?: boolean;
  }>();

  if (!body.namespace) throw new EdgeBaseError(400, 'namespace is required.');
  if (!body.tables) throw new EdgeBaseError(400, 'tables data is required.');

  const config = parseConfig(c.env);
  const dbBlock = config.databases?.[body.namespace];
  if (!dbBlock) throw new EdgeBaseError(404, `Namespace '${body.namespace}' not found in config.`);

  const userTableNames = Object.keys(dbBlock.tables ?? {});
  const provider = dbBlock.provider;
  const BATCH_SIZE = 100;

  if (provider === 'neon' || provider === 'postgres') {
    // PostgreSQL path
    const bindingName = getProviderBindingName(body.namespace);
    const envRecord = c.env as unknown as Record<string, unknown>;
    const hyperdrive = envRecord[bindingName] as { connectionString: string } | undefined;
    const envKey = dbBlock.connectionString ?? `${bindingName}_URL`;
    const connStr =
      hyperdrive?.connectionString ?? (envRecord[envKey] as string | undefined);
    if (!connStr)
      throw new EdgeBaseError(500, `PostgreSQL connection not available for '${body.namespace}'.`);

    const localDevOptions = getLocalDevPostgresExecOptions(c.env as unknown as Record<string, unknown>, body.namespace);
    if (localDevOptions) {
      await ensureLocalDevPostgresSchema(localDevOptions);
    }
    await withPostgresConnection(connStr, async (query) => {
      if (!localDevOptions) {
        await ensurePgSchema(connStr, body.namespace, dbBlock.tables ?? {}, query);
      }

      if (!body.skipWipe) {
        for (const tableName of [...userTableNames, '_meta']) {
          try {
            await query(`DELETE FROM "${tableName}"`, []);
          } catch {
            /* table may not exist */
          }
        }
      }

      for (const tableName of [...userTableNames, '_meta']) {
        const rows = body.tables[tableName];
        if (!rows || rows.length === 0) continue;

        const escId = (n: string) => `"${n.replace(/"/g, '""')}"`;
        for (const row of rows) {
          const columns = Object.keys(row);
          const colStr = columns.map((col) => escId(col)).join(', ');
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
          const values = columns.map((col) => row[col]);
          await query(
            `INSERT INTO ${escId(tableName)} (${colStr}) VALUES (${placeholders})`,
            values,
          );
        }
      }

      for (const tableName of userTableNames) {
        try {
          await query(
            `SELECT setval(pg_get_serial_sequence('"${tableName}"', 'id'), COALESCE((SELECT MAX(CAST(id AS BIGINT)) FROM "${tableName}"), 0) + 1, false)`,
            [],
          );
        } catch {
          /* no sequence or non-numeric id — skip */
        }
      }
    }, localDevOptions);
  } else {
    // D1 path
    const bindingName = getD1BindingName(body.namespace);
    const db = (c.env as unknown as Record<string, unknown>)[bindingName] as D1Database | undefined;
    if (!db)
      throw new EdgeBaseError(
        500,
        `D1 binding '${bindingName}' not available for '${body.namespace}'.`,
      );

    // 1. Ensure schema
    await ensureD1Schema(db, body.namespace, dbBlock.tables ?? {});

    // 2. Wipe existing data — skip if skipWipe is true
    if (!body.skipWipe) {
      const wipeStmts = [...userTableNames, '_meta'].map((t) => db.prepare(`DELETE FROM "${t}"`));
      if (wipeStmts.length > 0) {
        await db.batch(wipeStmts);
      }
    }

    // 3. Insert data in batches
    for (const tableName of [...userTableNames, '_meta']) {
      const rows = body.tables[tableName];
      if (!rows || rows.length === 0) continue;

      const escId = (n: string) => `"${n.replace(/"/g, '""')}"`;
      const insertStmts: D1PreparedStatement[] = [];
      for (const row of rows) {
        const columns = Object.keys(row);
        const colStr = columns.map((col) => escId(col)).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map((col) => row[col]);
        insertStmts.push(
          db
            .prepare(
              `INSERT OR REPLACE INTO ${escId(tableName)} (${colStr}) VALUES (${placeholders})`,
            )
            .bind(...values),
        );
      }

      // Batch limit is 100
      for (let i = 0; i < insertStmts.length; i += BATCH_SIZE) {
        const chunk = insertStmts.slice(i, i + BATCH_SIZE);
        await db.batch(chunk);
      }
    }
  }

  return c.json({
    ok: true,
    namespace: body.namespace,
    restored: Object.keys(body.tables).length,
  });
});

// ─── R2 Storage Backup/Restore — Phase 3 ───

// POST /admin/api/backup/dump-storage — dump R2 storage
// ?action=list  → list all R2 objects with cursor pagination
// ?action=get&key=...  → download a specific file as binary stream
const dumpStorage = createRoute({
  operationId: 'backupDumpStorage',
  method: 'post',
  path: '/dump-storage',
  tags: ['admin'],
  summary: 'Dump R2 storage (list or download)',
  request: {
    query: z.object({
      action: z.enum(['list', 'get']).optional(),
      key: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Storage dump data',
      content: { 'application/json': { schema: jsonResponseSchema } },
    },
    400: {
      description: 'Bad request',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

backupRoute.openapi(dumpStorage, async (c) => {
  const action = c.req.query('action');

  if (action === 'list') {
    // Paginate through all R2 objects
    const objects: Array<{ key: string; size: number; etag: string; contentType: string }> = [];
    let cursor: string | undefined;

    do {
      const listed = await c.env.STORAGE.list({
        cursor,
        limit: 1000,
      });

      for (const obj of listed.objects) {
        objects.push({
          key: obj.key,
          size: obj.size,
          etag: obj.etag,
          contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
        });
      }

      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    return c.json({
      objects,
      total: objects.length,
      timestamp: new Date().toISOString(),
    });
  }

  if (action === 'get') {
    const key = c.req.query('key');
    if (!key) throw new EdgeBaseError(400, 'key query parameter is required.');

    const object = await c.env.STORAGE.get(key);
    if (!object) {
      throw new EdgeBaseError(404, `Object not found: ${key}`);
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Length': String(object.size),
        'X-R2-Key': key,
      },
    });
  }

  throw new EdgeBaseError(400, 'action query parameter must be "list" or "get".');
});

// POST /admin/api/backup/restore-storage — restore R2 storage
// ?action=wipe  → delete all R2 objects
// ?action=put&key=...  → upload a single file (body = binary data)
const restoreStorage = createRoute({
  operationId: 'backupRestoreStorage',
  method: 'post',
  path: '/restore-storage',
  tags: ['admin'],
  summary: 'Restore R2 storage (wipe or upload)',
  request: {
    query: z.object({
      action: z.enum(['wipe', 'put']).optional(),
      key: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Restore result',
      content: { 'application/json': { schema: jsonResponseSchema } },
    },
    400: {
      description: 'Bad request',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

backupRoute.openapi(restoreStorage, async (c) => {
  const action = c.req.query('action');

  if (action === 'wipe') {
    // Delete all objects in R2 bucket
    let deleted = 0;
    let cursor: string | undefined;

    do {
      const listed = await c.env.STORAGE.list({
        cursor,
        limit: 1000,
      });

      if (listed.objects.length > 0) {
        const keys = listed.objects.map((obj) => obj.key);
        await c.env.STORAGE.delete(keys);
        deleted += keys.length;
      }

      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    return c.json({ ok: true, deleted });
  }

  if (action === 'put') {
    const key = c.req.query('key');
    if (!key) throw new EdgeBaseError(400, 'key query parameter is required.');

    const body = await c.req.arrayBuffer();
    const contentType = c.req.header('Content-Type') || 'application/octet-stream';

    await c.env.STORAGE.put(key, body, {
      httpMetadata: { contentType },
    });

    return c.json({ ok: true, key, size: body.byteLength });
  }

  throw new EdgeBaseError(400, 'action query parameter must be "wipe" or "put".');
});

// ─── _users_public Resync — Step 8 ───

// POST /admin/api/backup/resync-users-public
// Resync _users_public from _users table in AUTH_DB D1.
// Phase 3: Auth data now lives in D1 — reads _users directly instead of shard iteration.
const resyncUsersPublic = createRoute({
  operationId: 'backupResyncUsersPublic',
  method: 'post',
  path: '/resync-users-public',
  tags: ['admin'],
  summary: 'Resync _users_public from _users in AUTH_DB D1',
  responses: {
    200: {
      description: 'Resync result',
      content: { 'application/json': { schema: jsonResponseSchema } },
    },
  },
});

backupRoute.openapi(resyncUsersPublic, async (c) => {
  const authDb = getAuthDb(c);
  await ensureAuthSchema(authDb);

  // Auth data is now in AUTH_DB D1 — read _users directly instead of shard iteration
  let totalSynced = 0;

  try {
    const users = await authDb.query(
      'SELECT id, email, displayName, avatarUrl, role, isAnonymous, createdAt, updatedAt FROM _users',
    );

    // Batch upsert to _users_public
    for (const user of users) {
      try {
        const now = new Date().toISOString();
        await upsertUserPublic(
          authDb,
          user.id as string,
          {
            email: (user.email as string) ?? null,
            displayName: (user.displayName as string) ?? null,
            avatarUrl: (user.avatarUrl as string) ?? null,
            role: (user.role as string) ?? 'user',
            isAnonymous: user.isAnonymous ? 1 : 0,
            createdAt: (user.createdAt as string) ?? now,
            updatedAt: now,
          } as UserPublicData,
        );
        totalSynced++;
      } catch (err) {
        console.error(`Failed to sync user ${user.id}:`, err);
      }
    }

    return c.json({
      ok: true,
      totalSynced,
      source: 'd1',
    });
  } catch (err) {
    console.error('Failed to resync _users_public:', err);
    throw new EdgeBaseError(500, `Resync failed: ${(err as Error).message}`);
  }
});

// ─── Table Export — ───

// GET /admin/api/backup/export/:name?format=json
// Exports a single table's data as JSON array.
// Reuses dump-do infrastructure; filters to the requested table.
// For user-namespaced DB blocks (#133 §1), each user has a dedicated DO — export merges all.
const exportTable = createRoute({
  operationId: 'backupExportTable',
  method: 'get',
  path: '/export/{name}',
  tags: ['admin'],
  summary: 'Export a single table as JSON',
  request: {
    params: z.object({ name: z.string() }),
    query: z.object({
      format: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Exported table data',
      content: { 'application/json': { schema: jsonResponseSchema } },
    },
    400: {
      description: 'Bad request',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Table not found',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

backupRoute.openapi(exportTable, async (c) => {
  const name = c.req.param('name')!;
  const format = c.req.query('format') || 'json';

  if (format !== 'json') {
    throw new EdgeBaseError(400, `Unsupported export format: ${format}. Only "json" is supported.`);
  }

  // Validate table exists in databases config (§1)
  const config = parseConfig(c.env);
  let tableNamespace = 'shared';
  let found = false;
  for (const [ns, dbBlock] of Object.entries(config.databases ?? {})) {
    if (dbBlock.tables?.[name]) {
      tableNamespace = ns;
      found = true;
      break;
    }
  }
  if (!found) {
    throw new EdgeBaseError(404, `Table not found: ${name}`);
  }

  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Content-Disposition': `attachment; filename="${name}-export.json"`,
  };

  const tables = await dumpNamespaceTables(c.env, config, tableNamespace, {
    includeMeta: false,
    tableNames: [name],
  });
  const records = tables[name] || [];

  return new Response(JSON.stringify(records, null, 2), { headers: responseHeaders });
});
