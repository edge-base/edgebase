/**
 * PostgreSQL request handler for provider='neon'|'postgres'.
 *
 * Runs in Worker context (not DO) — handles:
 * - Hyperdrive binding resolution
 * - Lazy schema initialization (via postgres-schema-init)
 * - CRUD operations (via query-engine + postgres-executor)
 * - Rules evaluation (Worker level)
 * - Hooks execution (Worker level)
 *
 * Database Live: After successful writes, emits events to DatabaseLiveDO
 * via fire-and-forget stub.fetch() — same pattern as database-do.ts.
 *
 * Mirrors database-do.ts CRUD logic but uses PostgreSQL instead of SQLite.
 */
import type { Context } from 'hono';
import type { HonoEnv } from './hono.js';
import type { Env } from '../types.js';
import type {
  AuthContext,
  TableConfig,
  TableRules,
  HookCtx,
  DbBlock,
} from '@edge-base/shared';
import { EdgeBaseError, getTableAccess, getTableHooks } from '@edge-base/shared';
import { parseConfig } from './do-router.js';
import {
  ensureLocalDevPostgresSchema,
  getLocalDevPostgresExecOptions,
  getProviderBindingName,
  executePostgresQuery,
  withPostgresConnection,
  type PostgresExecutor,
} from './postgres-executor.js';
import { ensurePgSchema } from './postgres-schema-init.js';
import {
  buildListQuery, buildCountQuery, buildGetQuery, buildSearchQuery,
  parseQueryParams,
  type FilterTuple,
} from './query-engine.js';
import { summarizeValidationErrors, validateInsert, validateUpdate } from './validation.js';
import { emitDbLiveEvent, emitDbLiveBatchEvent } from './database-live-emitter.js';
import { forbiddenError, hookRejectedError } from './errors.js';
import {
  escapePgIdentifier,
  preparePgInsertData,
  preparePgUpdateData,
  stripInternalPgFields,
} from './postgres-table-utils.js';
import { isTrustedInternalContext } from './internal-request.js';
import { executeDbTriggers } from './functions.js';
import { parseUpdateBody } from './op-parser.js';

// ─── Types ───

interface PgResolvedDb {
  connectionString: string;
  dbBlock: DbBlock;
  namespace: string;
}

// ─── Main Handler ───

/**
 * Handle a request to a PostgreSQL-backed database table.
 * Called from tables.ts when provider is 'neon' or 'postgres'.
 *
 * @param c - Hono context
 * @param namespace - Database namespace (e.g. 'shared')
 * @param tableName - Table name (e.g. 'posts')
 * @param doPath - Internal path (e.g. '/tables/posts', '/tables/posts/abc123')
 */
export async function handlePgRequest(
  c: Context<HonoEnv>,
  namespace: string,
  tableName: string,
  doPath: string,
): Promise<Response> {
  const resolved = resolvePgConnection(c.env, namespace);
  const tableConfig = resolved.dbBlock.tables?.[tableName];
  if (!tableConfig) {
    return c.json({ code: 404, message: `Table '${tableName}' not found in database '${namespace}'.` }, 404);
  }
  const isServiceKey = checkServiceKey(c);
  const auth = c.get('auth') as AuthContext | null | undefined ?? null;
  const method = c.req.raw.method;
  const pathSuffix = doPath.replace(`/tables/${tableName}`, '');
  const localDevOptions = getLocalDevPostgresExecOptions(c.env as unknown as Record<string, unknown>, namespace);

  if (localDevOptions) {
    await ensureLocalDevPostgresSchema(localDevOptions);
  }

  return withPostgresConnection(
    resolved.connectionString,
    async (query) => {
      if (!localDevOptions) {
        await ensurePgSchema(
          resolved.connectionString,
          namespace,
          resolved.dbBlock.tables ?? {},
          query,
        );
      }

      if (method === 'GET') {
        if (pathSuffix === '/count') {
          return handleCount(c, resolved, tableName, tableConfig, auth, isServiceKey, query);
        }
        if (pathSuffix === '/search') {
          return handleSearch(c, resolved, tableName, tableConfig, auth, isServiceKey, query);
        }
        if (pathSuffix && pathSuffix !== '/') {
          const id = pathSuffix.slice(1);
          return handleGet(c, resolved, tableName, tableConfig, id, auth, isServiceKey, query);
        }
        return handleList(c, resolved, tableName, tableConfig, auth, isServiceKey, query);
      }

      if (method === 'POST') {
        if (pathSuffix === '/batch') {
          return handleBatch(c, resolved, tableName, tableConfig, auth, isServiceKey, query);
        }
        if (pathSuffix === '/batch-by-filter') {
          return handleBatchByFilter(c, resolved, tableName, tableConfig, auth, isServiceKey, query);
        }
        return handleInsert(c, resolved, tableName, tableConfig, auth, isServiceKey, query);
      }

      if (method === 'PATCH' || method === 'PUT') {
        const id = pathSuffix.slice(1);
        return handleUpdate(c, resolved, tableName, tableConfig, id, auth, isServiceKey, query);
      }

      if (method === 'DELETE') {
        const id = pathSuffix.slice(1);
        return handleDelete(c, resolved, tableName, tableConfig, id, auth, isServiceKey, query);
      }

      return c.json({ code: 405, message: 'Method not allowed' }, 405);
    },
    localDevOptions,
  );
}

// ─── Connection Resolution ───

function resolvePgConnection(env: Env, namespace: string): PgResolvedDb {
  const config = parseConfig(env);
  const dbBlock = config.databases?.[namespace];
  if (!dbBlock) {
    throw new EdgeBaseError(404, `Database '${namespace}' not found in config.`);
  }

  const bindingName = getProviderBindingName(namespace);
  const envRecord = env as unknown as Record<string, unknown>;

  // 1. Try Hyperdrive binding (production — object with .connectionString)
  const hyperdrive = envRecord[bindingName] as { connectionString: string } | undefined;
  if (hyperdrive?.connectionString) {
    return { connectionString: hyperdrive.connectionString, dbBlock, namespace };
  }

  // 2. Fallback: direct connection string from env (local dev — {BINDING}_URL string)
  const envKey = dbBlock.connectionString ?? `${bindingName}_URL`;
  const directUrl = envRecord[envKey] as string | undefined;
  if (directUrl) {
    return { connectionString: directUrl, dbBlock, namespace };
  }

  throw new EdgeBaseError(500,
    `PostgreSQL connection for '${namespace}' not found. ` +
    `In production: run 'edgebase deploy' to auto-provision Hyperdrive. ` +
    `In development: add ${envKey}=postgres://... to .env.development`,
  );
}

// ─── Service Key Check ───

function checkServiceKey(c: Context<HonoEnv>): boolean {
  if (isTrustedInternalContext(c)) return true;
  // Public request paths must be validated upstream (rules middleware / admin route)
  // so provider-backed handlers observe the same scoped + constrained bypass result.
  return c.get('isServiceKey' as never) === true;
}

// ─── Rule Evaluation ───

async function evalRowRule(
  rule: TableRules['read'],
  auth: AuthContext | null,
  row: Record<string, unknown>,
): Promise<boolean> {
  if (rule === undefined || rule === null) return true;
  if (typeof rule === 'boolean') return rule;
  if (typeof rule === 'function') {
    try {
      const result = await Promise.race([
        Promise.resolve(rule(auth, row)),
        new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('Rule timeout')), 50)),
      ]);
      return result;
    } catch {
      return false; // fail-closed
    }
  }
  return true;
}

async function evalInsertRule(
  rule: TableRules['insert'],
  auth: AuthContext | null,
): Promise<boolean> {
  if (rule === undefined || rule === null) return true;
  if (typeof rule === 'boolean') return rule;
  if (typeof rule === 'function') {
    try {
      const result = await Promise.race([
        Promise.resolve((rule as (a: AuthContext | null) => boolean | Promise<boolean>)(auth)),
        new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('Rule timeout')), 50)),
      ]);
      return result;
    } catch {
      return false;
    }
  }
  return true;
}

// ─── Hook Context Builder ───

function buildHookCtx(
  connectionString: string,
  tables: Record<string, TableConfig>,
  executionCtx?: ExecutionContext,
  queryExecutor?: PostgresExecutor,
): HookCtx {
  const query =
    queryExecutor ??
    ((sql: string, params: unknown[] = []) => executePostgresQuery(connectionString, sql, params));

  return {
    db: {
      async get(table: string, id: string): Promise<Record<string, unknown> | null> {
        const { sql, params } = buildGetQuery(table, id, undefined, 'postgres');
        const result = await query(sql, params);
        return result.rows.length > 0
          ? stripInternalPgFields(result.rows[0] as Record<string, unknown>)
          : null;
      },
      async list(table: string, filter?: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
        let sql = `SELECT * FROM "${table.replace(/"/g, '""')}"`;
        const params: unknown[] = [];
        if (filter && Object.keys(filter).length > 0) {
          const conditions: string[] = [];
          let idx = 1;
          for (const [key, value] of Object.entries(filter)) {
            conditions.push(`"${key.replace(/"/g, '""')}" = $${idx++}`);
            params.push(value);
          }
          sql += ` WHERE ${conditions.join(' AND ')}`;
        }
        sql += ' LIMIT 100';
        const result = await query(sql, params);
        return result.rows.map(r => stripInternalPgFields(r as Record<string, unknown>));
      },
      async exists(table: string, filter: Record<string, unknown>): Promise<boolean> {
        const conditions: string[] = [];
        const params: unknown[] = [];
        let idx = 1;
        for (const [key, value] of Object.entries(filter)) {
          conditions.push(`"${key.replace(/"/g, '""')}" = $${idx++}`);
          params.push(value);
        }
        const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
        const sql = `SELECT 1 FROM "${table.replace(/"/g, '""')}"${where} LIMIT 1`;
        const result = await query(sql, params);
        return result.rows.length > 0;
      },
    },
    databaseLive: {
      async broadcast(_channel: string, _event: string, _data: unknown): Promise<void> {
        // HookCtx broadcast — not implemented for PostgreSQL provider (no direct env access)
        // Use database-live subscription from client SDK instead
      },
    },
    push: {
      async send(_userId: string, _payload: { title?: string; body: string }): Promise<void> {
        // Push notifications — same mechanism as DO (via Worker env)
      },
    },
    waitUntil(promise: Promise<unknown>): void {
      if (executionCtx) {
        executionCtx.waitUntil(promise);
      }
    },
  };
}

function toFieldErrorData(
  errors: Record<string, string>,
): Record<string, { code: string; message: string }> {
  return Object.fromEntries(
    Object.entries(errors).map(([key, message]) => [key, { code: 'invalid', message }]),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CRUD Operations
// ═══════════════════════════════════════════════════════════════════════════

// ─── LIST ───

async function handleList(
  c: Context<HonoEnv>,
  resolved: PgResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  auth: AuthContext | null,
  isServiceKey: boolean,
  query: PostgresExecutor,
): Promise<Response> {
  const tableAccess = getTableAccess(tableConfig);
  if (!isServiceKey && tableAccess?.read === false) {
    const error = forbiddenError('Access denied.');
    return c.json(error.toJSON(), error.status as 403);
  }

  const queryOpts = parseQueryParams(Object.fromEntries(new URL(c.req.url).searchParams));
  const { sql, params, countSql, countParams } = buildListQuery(tableName, queryOpts, 'postgres');
  const result = await query(sql, params);

  // Apply read rules per row
  let items = result.rows.map(r => stripInternalPgFields(r as Record<string, unknown>));
  const tableHooks = getTableHooks(tableConfig);
  if (!isServiceKey && tableAccess?.read !== undefined) {
    const filtered: Record<string, unknown>[] = [];
    for (const row of items) {
      if (await evalRowRule(tableAccess.read, auth, row)) {
        filtered.push(row);
      }
    }
    items = filtered;
  }

  // Apply onEnrich hook
  if (tableHooks?.onEnrich) {
    const hookCtx = buildHookCtx(resolved.connectionString, resolved.dbBlock.tables ?? {}, c.executionCtx, query);
    for (let i = 0; i < items.length; i++) {
      try {
        const enriched = await tableHooks.onEnrich(auth, items[i], hookCtx);
        if (enriched && typeof enriched === 'object') items[i] = { ...items[i], ...enriched };
      } catch (err) {
        console.error(`[EdgeBase] onEnrich hook error for table "${tableName}":`, err);
      }
    }
  }

  // Get total count
  let total: number | null = null;
  const includeTotal = !['0', 'false'].includes((c.req.query('includeTotal') ?? '').toLowerCase());
  if (includeTotal && countSql && countParams) {
    const countResult = await query(countSql, countParams);
    total = Number(countResult.rows[0]?.total ?? 0);
  }

  const perPage = queryOpts.pagination?.limit ?? queryOpts.pagination?.perPage ?? 20;
  const page = queryOpts.pagination?.page ?? 1;
  const hasMore = queryOpts.pagination?.after || queryOpts.pagination?.before
    ? items.length >= perPage
    : null;
  const cursor = hasMore && items.length > 0
    ? String((items[items.length - 1] as Record<string, unknown>).id ?? '')
    : null;

  return c.json({ items, total, hasMore, cursor, page: hasMore !== null ? null : page, perPage });
}

// ─── COUNT ───

async function handleCount(
  c: Context<HonoEnv>,
  resolved: PgResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  _auth: AuthContext | null,
  isServiceKey: boolean,
  query: PostgresExecutor,
): Promise<Response> {
  const tableAccess = getTableAccess(tableConfig);
  if (!isServiceKey && tableAccess?.read === false) {
    const error = forbiddenError('Access denied.');
    return c.json(error.toJSON(), error.status as 403);
  }

  const queryOpts = parseQueryParams(Object.fromEntries(new URL(c.req.url).searchParams));
  const { sql, params } = buildCountQuery(tableName, queryOpts.filters, queryOpts.orFilters, 'postgres');
  const result = await query(sql, params);
  const total = result.rows[0]?.total ?? 0;
  return c.json({ total });
}

// ─── SEARCH ───

async function handleSearch(
  c: Context<HonoEnv>,
  resolved: PgResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  auth: AuthContext | null,
  isServiceKey: boolean,
  query: PostgresExecutor,
): Promise<Response> {
  const tableAccess = getTableAccess(tableConfig);
  if (!isServiceKey && tableAccess?.read === false) {
    const error = forbiddenError('Access denied.');
    return c.json(error.toJSON(), error.status as 403);
  }

  const queryOpts = parseQueryParams(Object.fromEntries(new URL(c.req.url).searchParams));
  const searchTerm = queryOpts.search || '';
  if (!searchTerm) {
    return c.json({ code: 400, message: 'Search term is required (use ?search=)' }, 400);
  }

  // Use FTS fields from config, or fallback to text columns from schema
  const ftsFields = tableConfig.fts?.length
    ? tableConfig.fts
    : getTextFields(tableConfig);
  const limit = queryOpts.pagination?.limit ?? queryOpts.pagination?.perPage ?? 20;
  const offset = queryOpts.pagination?.offset ?? ((queryOpts.pagination?.page ?? 1) - 1) * limit;
  const searchQuery = buildSearchQuery(tableName, searchTerm, {
    pagination: queryOpts.pagination,
    filters: queryOpts.filters,
    orFilters: queryOpts.orFilters,
    sort: queryOpts.sort,
    ftsFields,
  }, 'postgres');

  const result = await query(searchQuery.sql, searchQuery.params);
  let items = result.rows.map(r => stripInternalPgFields(r as Record<string, unknown>));
  let total = items.length;
  if (searchQuery.countSql) {
    const countResult = await query(searchQuery.countSql, searchQuery.countParams ?? []);
    total = Number(countResult.rows[0]?.total ?? items.length);
  }

  // Apply read rules
  if (!isServiceKey && tableAccess?.read !== undefined) {
    const filtered: Record<string, unknown>[] = [];
    for (const row of items) {
      if (await evalRowRule(tableAccess.read, auth, row)) {
        filtered.push(row);
      }
    }
    items = filtered;
  }

  return c.json({ items, total, hasMore: total > offset + items.length, cursor: null, page: null, perPage: limit });
}

// ─── GET ───

async function handleGet(
  c: Context<HonoEnv>,
  resolved: PgResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  id: string,
  auth: AuthContext | null,
  isServiceKey: boolean,
  query: PostgresExecutor,
): Promise<Response> {
  const fieldsParam = new URL(c.req.url).searchParams.get('fields');
  const fields = fieldsParam ? fieldsParam.split(',').map(f => f.trim()) : undefined;

  const { sql, params } = buildGetQuery(tableName, id, fields, 'postgres');
  const result = await query(sql, params);

  if (result.rows.length === 0) {
    return c.json({ code: 404, message: `Record '${id}' not found in '${tableName}'.` }, 404);
  }

  const row = stripInternalPgFields(result.rows[0] as Record<string, unknown>);

  // Check read rule
  const tableAccess = getTableAccess(tableConfig);
  const tableHooks = getTableHooks(tableConfig);
  if (!isServiceKey && tableAccess?.read !== undefined) {
    if (!(await evalRowRule(tableAccess.read, auth, row))) {
      return c.json({ code: 403, message: 'Access denied.' }, 403);
    }
  }

  // Apply onEnrich hook
  if (tableHooks?.onEnrich) {
    const hookCtx = buildHookCtx(resolved.connectionString, resolved.dbBlock.tables ?? {}, c.executionCtx, query);
    try {
      const enriched = await tableHooks.onEnrich(auth, row, hookCtx);
      if (enriched && typeof enriched === 'object') return c.json({ ...row, ...enriched });
    } catch (err) {
      console.error(`[EdgeBase] onEnrich hook error for table "${tableName}":`, err);
    }
  }

  return c.json(row);
}

// ─── INSERT ───

async function handleInsert(
  c: Context<HonoEnv>,
  resolved: PgResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  auth: AuthContext | null,
  isServiceKey: boolean,
  query: PostgresExecutor,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: 'Invalid JSON body' }, 400);
  }

  // Check insert rule
  const tableAccess = getTableAccess(tableConfig);
  const tableHooks = getTableHooks(tableConfig);
  if (!isServiceKey && tableAccess?.insert !== undefined) {
    if (!(await evalInsertRule(tableAccess.insert, auth))) {
      return c.json({ code: 403, message: 'Insert not allowed.' }, 403);
    }
  }

  // Validate against schema
  const validation = validateInsert(body, tableConfig.schema);
  if (!validation.valid) {
    return c.json({
      code: 400,
      message: summarizeValidationErrors(validation.errors),
      data: toFieldErrorData(validation.errors),
      errors: validation.errors,
    }, 400);
  }

  // Run beforeInsert hook
  const requestHookCtx = buildHookCtx(resolved.connectionString, resolved.dbBlock.tables ?? {}, c.executionCtx, query);
  if (tableHooks?.beforeInsert) {
    try {
      const transformed = await tableHooks.beforeInsert(auth, body, requestHookCtx);
      if (transformed && typeof transformed === 'object') {
        body = { ...body, ...transformed };
      }
    } catch (err) {
      const hookError = hookRejectedError(err, 'Insert rejected by beforeInsert hook.');
      return c.json(hookError.toJSON(), hookError.status as 400);
    }
  }

  const { data } = preparePgInsertData(body, tableConfig);

  // Check upsert mode
  const url = new URL(c.req.url);
  const isUpsert = url.searchParams.get('upsert') === 'true';
  const conflictTarget = url.searchParams.get('conflictTarget') || 'id';
  let isUpdate = false;
  let upsertBeforeRow: Record<string, unknown> | null = null;

  if (isUpsert && data[conflictTarget] !== undefined) {
    const checkSql = `SELECT * FROM ${escapePgIdentifier(tableName)} WHERE ${escapePgIdentifier(conflictTarget)} = $1 LIMIT 1`;
    const checkResult = await query(checkSql, [data[conflictTarget]]);
    isUpdate = checkResult.rows.length > 0;
    upsertBeforeRow = isUpdate
      ? stripInternalPgFields(checkResult.rows[0] as Record<string, unknown>)
      : null;
  }

  // Build INSERT SQL
  const columns = Object.keys(data);
  const values = columns.map(col => data[col] ?? null);
  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

  let sql: string;
  if (isUpsert) {
    const setClauses = columns
      .filter(col => col !== 'id' && col !== conflictTarget && col !== 'createdAt')
      .map(col => `${escapePgIdentifier(col)} = EXCLUDED.${escapePgIdentifier(col)}`);
    sql = `INSERT INTO ${escapePgIdentifier(tableName)} (${columns.map(escapePgIdentifier).join(', ')}) VALUES (${placeholders})` +
      ` ON CONFLICT (${escapePgIdentifier(conflictTarget)}) DO UPDATE SET ${setClauses.join(', ')}` +
      ` RETURNING *`;
  } else {
    sql = `INSERT INTO ${escapePgIdentifier(tableName)} (${columns.map(escapePgIdentifier).join(', ')}) VALUES (${placeholders}) RETURNING *`;
  }

  const result = await query(sql, values);
  const inserted = stripInternalPgFields(result.rows[0] as Record<string, unknown>);

  // Run afterInsert hook (fire-and-forget)
  if (tableHooks?.afterInsert) {
    const hook = tableHooks.afterInsert;
    const backgroundHookCtx = buildHookCtx(resolved.connectionString, resolved.dbBlock.tables ?? {}, c.executionCtx);
    backgroundHookCtx.waitUntil(Promise.resolve(hook(inserted, backgroundHookCtx)).catch(() => {}));
  }

  // Emit database-live event (fire-and-forget)
  c.executionCtx.waitUntil(
    emitDbLiveEvent(
      c.env,
      resolved.namespace,
      tableName,
      isUpsert && isUpdate ? 'modified' : 'added',
      String(inserted.id ?? ''),
      inserted,
    ),
  );
  c.executionCtx.waitUntil(
    executeDbTriggers(
      tableName,
      isUpsert && isUpdate ? 'update' : 'insert',
      isUpsert && isUpdate ? { before: upsertBeforeRow ?? inserted, after: inserted } : { after: inserted },
      {
        databaseNamespace: c.env.DATABASE,
        authNamespace: c.env.AUTH,
        kvNamespace: c.env.KV,
        config: parseConfig(c.env),
        env: c.env as never,
        executionCtx: c.executionCtx as never,
      },
      { namespace: resolved.namespace },
    ),
  );

  if (isUpsert) {
    const statusCode = isUpdate ? 200 : 201;
    const action = isUpdate ? 'updated' : 'inserted';
    return c.json({ ...inserted, action }, statusCode as 200);
  }

  return c.json(inserted, 201);
}

// ─── UPDATE ───

async function handleUpdate(
  c: Context<HonoEnv>,
  resolved: PgResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  id: string,
  auth: AuthContext | null,
  isServiceKey: boolean,
  query: PostgresExecutor,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: 'Invalid JSON body' }, 400);
  }

  // Validate against schema
  const validation = validateUpdate(body, tableConfig.schema);
  if (!validation.valid) {
    return c.json({
      code: 400,
      message: 'Validation failed.',
      data: toFieldErrorData(validation.errors),
      errors: validation.errors,
    }, 400);
  }

  // Fetch existing record to check rules
  const { sql: getSql, params: getParams } = buildGetQuery(tableName, id, undefined, 'postgres');
  const existing = await query(getSql, getParams);
  if (existing.rows.length === 0) {
    return c.json({ code: 404, message: `Record '${id}' not found in '${tableName}'.` }, 404);
  }
  const existingRow = existing.rows[0] as Record<string, unknown>;

  // Check update rule
  const tableAccess = getTableAccess(tableConfig);
  const tableHooks = getTableHooks(tableConfig);
  if (!isServiceKey && tableAccess?.update !== undefined) {
    if (!(await evalRowRule(tableAccess.update, auth, existingRow))) {
      return c.json({ code: 403, message: 'Update not allowed.' }, 403);
    }
  }

  // Run beforeUpdate hook
  const requestHookCtx = buildHookCtx(resolved.connectionString, resolved.dbBlock.tables ?? {}, c.executionCtx, query);
  if (tableHooks?.beforeUpdate) {
    try {
      const transformed = await tableHooks.beforeUpdate(auth, existingRow, body, requestHookCtx);
      if (transformed && typeof transformed === 'object') {
        body = { ...body, ...transformed };
      }
    } catch (err) {
      const hookError = hookRejectedError(err, 'Update rejected by beforeUpdate hook.');
      return c.json(hookError.toJSON(), hookError.status as 400);
    }
  }

  const { data } = preparePgUpdateData(body, tableConfig);

  if (Object.keys(data).length === 0) {
    return c.json({ code: 400, message: 'No valid fields to update.' }, 400);
  }

  const { setClauses, params, nextParamIndex } = parseUpdateBody(
    data,
    ['id'],
    { dialect: 'postgres', startIndex: 1 },
  );

  const sql = `UPDATE ${escapePgIdentifier(tableName)} SET ${setClauses.join(', ')} WHERE "id" = $${nextParamIndex} RETURNING *`;
  const result = await query(sql, [...params, id]);

  if (result.rows.length === 0) {
    return c.json({ code: 404, message: `Record '${id}' not found in '${tableName}'.` }, 404);
  }

  const updated = stripInternalPgFields(result.rows[0] as Record<string, unknown>);

  // Run afterUpdate hook (fire-and-forget)
  if (tableHooks?.afterUpdate) {
    const hook = tableHooks.afterUpdate;
    const backgroundHookCtx = buildHookCtx(resolved.connectionString, resolved.dbBlock.tables ?? {}, c.executionCtx);
    backgroundHookCtx.waitUntil(
      Promise.resolve(hook(existingRow, updated, backgroundHookCtx)).catch(() => {}),
    );
  }

  // Emit database-live event (fire-and-forget)
  c.executionCtx.waitUntil(
    emitDbLiveEvent(c.env, resolved.namespace, tableName, 'modified', id, updated),
  );
  c.executionCtx.waitUntil(
    executeDbTriggers(
      tableName,
      'update',
      {
        before: existingRow,
        after: updated,
      },
      {
        databaseNamespace: c.env.DATABASE,
        authNamespace: c.env.AUTH,
        kvNamespace: c.env.KV,
        config: parseConfig(c.env),
        env: c.env as never,
        executionCtx: c.executionCtx as never,
      },
      { namespace: resolved.namespace },
    ),
  );

  return c.json(updated);
}

// ─── DELETE ───

async function handleDelete(
  c: Context<HonoEnv>,
  resolved: PgResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  id: string,
  auth: AuthContext | null,
  isServiceKey: boolean,
  query: PostgresExecutor,
): Promise<Response> {
  // Fetch existing record
  const { sql: getSql, params: getParams } = buildGetQuery(tableName, id, undefined, 'postgres');
  const existing = await query(getSql, getParams);
  if (existing.rows.length === 0) {
    return c.json({ code: 404, message: `Record '${id}' not found in '${tableName}'.` }, 404);
  }
  const existingRow = existing.rows[0] as Record<string, unknown>;

  // Check delete rule
  const tableAccess = getTableAccess(tableConfig);
  const tableHooks = getTableHooks(tableConfig);
  if (!isServiceKey && tableAccess?.delete !== undefined) {
    if (!(await evalRowRule(tableAccess.delete, auth, existingRow))) {
      return c.json({ code: 403, message: 'Delete not allowed.' }, 403);
    }
  }

  // Run beforeDelete hook
  const requestHookCtx = buildHookCtx(resolved.connectionString, resolved.dbBlock.tables ?? {}, c.executionCtx, query);
  if (tableHooks?.beforeDelete) {
    try {
      await tableHooks.beforeDelete(auth, existingRow, requestHookCtx);
    } catch (err) {
      const hookError = hookRejectedError(err, 'Delete rejected by beforeDelete hook.');
      return c.json(hookError.toJSON(), hookError.status as 400);
    }
  }

  // Execute DELETE
  const sql = `DELETE FROM ${escapePgIdentifier(tableName)} WHERE "id" = $1 RETURNING *`;
  const result = await query(sql, [id]);

  if (result.rows.length === 0) {
    return c.json({ code: 404, message: `Record '${id}' not found.` }, 404);
  }

  // Run afterDelete hook (fire-and-forget)
  if (tableHooks?.afterDelete) {
    const hook = tableHooks.afterDelete;
    const backgroundHookCtx = buildHookCtx(resolved.connectionString, resolved.dbBlock.tables ?? {}, c.executionCtx);
    backgroundHookCtx.waitUntil(
      Promise.resolve(hook(existingRow, backgroundHookCtx)).catch(() => {}),
    );
  }

  // Emit database-live event (fire-and-forget)
  c.executionCtx.waitUntil(
    emitDbLiveEvent(c.env, resolved.namespace, tableName, 'removed', id, stripInternalPgFields(existingRow)),
  );
  c.executionCtx.waitUntil(
    executeDbTriggers(
      tableName,
      'delete',
      { before: existingRow },
      {
        databaseNamespace: c.env.DATABASE,
        authNamespace: c.env.AUTH,
        kvNamespace: c.env.KV,
        config: parseConfig(c.env),
        env: c.env as never,
        executionCtx: c.executionCtx as never,
      },
      { namespace: resolved.namespace },
    ),
  );

  return c.json({ success: true, deleted: stripInternalPgFields(existingRow) });
}

// ─── BATCH ───

async function handleBatch(
  c: Context<HonoEnv>,
  resolved: PgResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  auth: AuthContext | null,
  isServiceKey: boolean,
  query: PostgresExecutor,
): Promise<Response> {
  let body: {
    items?: Record<string, unknown>[];
    inserts?: Record<string, unknown>[];
    updates?: { id: string; data: Record<string, unknown> }[];
    deletes?: string[];
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: 'Invalid JSON body' }, 400);
  }

  const inserts = Array.isArray(body.inserts)
    ? body.inserts
    : Array.isArray(body.items)
      ? body.items
      : [];
  const updates = Array.isArray(body.updates) ? body.updates : [];
  const deletes = Array.isArray(body.deletes) ? body.deletes : [];

  const totalOps = inserts.length + updates.length + deletes.length;
  if (totalOps === 0) {
    return c.json({ code: 400, message: 'items array is required and must not be empty' }, 400);
  }

  if (totalOps > 500) {
    return c.json({ code: 400, message: 'Batch size cannot exceed 500 items.' }, 400);
  }

  if (updates.length > 0 || deletes.length > 0) {
    return c.json({
      code: 400,
      message: 'PostgreSQL batch currently supports inserts/upserts only. Use batch-by-filter for updates/deletes.',
    }, 400);
  }

  // Check insert rule (table-level, once)
  const tableAccess = getTableAccess(tableConfig);
  if (!isServiceKey && inserts.length > 0 && tableAccess?.insert !== undefined) {
    if (!(await evalInsertRule(tableAccess.insert, auth))) {
      return c.json({ code: 403, message: 'Insert not allowed.' }, 403);
    }
  }

  const upsertMode = c.req.query('upsert') === 'true';
  const conflictTarget = c.req.query('conflictTarget') || 'id';
  const results: Record<string, unknown>[] = [];

  for (const item of inserts) {
    // Validate
    const validation = validateInsert(item, tableConfig.schema);
    if (!validation.valid) {
      return c.json({
        code: 400,
        message: 'Validation failed.',
        data: toFieldErrorData(validation.errors),
        errors: validation.errors,
      }, 400);
    }

    const { data } = preparePgInsertData(item, tableConfig);

    const columns = Object.keys(data);
    const values = columns.map(col => data[col] ?? null);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    let sql = `INSERT INTO ${escapePgIdentifier(tableName)} (${columns.map(escapePgIdentifier).join(', ')}) VALUES (${placeholders})`;
    if (upsertMode) {
      const updateCols = columns.filter((col) => col !== 'id' && col !== 'createdAt' && col !== conflictTarget);
      if (updateCols.length > 0) {
        const updateSet = updateCols
          .map((col) => `${escapePgIdentifier(col)} = EXCLUDED.${escapePgIdentifier(col)}`)
          .join(', ');
        sql += ` ON CONFLICT (${escapePgIdentifier(conflictTarget)}) DO UPDATE SET ${updateSet}`;
      } else {
        sql += ` ON CONFLICT (${escapePgIdentifier(conflictTarget)}) DO NOTHING`;
      }
    }
    sql += ' RETURNING *';

    const result = await query(sql, values);
    if (result.rows.length > 0) {
      results.push(stripInternalPgFields(result.rows[0] as Record<string, unknown>));
    }
  }

  // Emit batch database-live events
  if (results.length > 0) {
    const changes = results.map(r => ({
      type: 'added' as const,
      docId: String((r as Record<string, unknown>).id ?? ''),
      data: r as Record<string, unknown>,
    }));
    if (changes.length >= 10) {
      c.executionCtx.waitUntil(
        emitDbLiveBatchEvent(c.env, resolved.namespace, tableName, changes),
      );
    } else {
      for (const ch of changes) {
        c.executionCtx.waitUntil(
          emitDbLiveEvent(c.env, resolved.namespace, tableName, ch.type, ch.docId, ch.data),
        );
      }
    }
  }

  return c.json({
    inserted: results,
    items: results,
  });
}

// ─── BATCH BY FILTER ───

async function handleBatchByFilter(
  c: Context<HonoEnv>,
  resolved: PgResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  _auth: AuthContext | null,
  isServiceKey: boolean,
  query: PostgresExecutor,
): Promise<Response> {
  let body: {
    action?: string;
    filter?: FilterTuple[];
    orFilter?: FilterTuple[];
    update?: Record<string, unknown>;
    data?: Record<string, unknown>;
    limit?: number;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: 'Invalid JSON body' }, 400);
  }

  if (!body.action || !['delete', 'update'].includes(body.action)) {
    return c.json({ code: 400, message: "batch-by-filter requires 'action' to be 'delete' or 'update'." }, 400);
  }
  if (!body.filter || !Array.isArray(body.filter)) {
    return c.json({ code: 400, message: "batch-by-filter requires 'filter' to be a non-empty array." }, 400);
  }
  const updateData = body.update ?? body.data;
  if (body.action === 'update' && !updateData) {
    return c.json({ code: 400, message: "batch-by-filter with action 'update' requires 'update' data." }, 400);
  }

  const limit = Math.min(body.limit ?? 500, 500);
  const { sql: selectSql, params: selectParams } = buildListQuery(tableName, {
    filters: body.filter,
    orFilters: body.orFilter,
    pagination: { limit },
    fields: ['id'],
  }, 'postgres');
  const selectResult = await query(selectSql, selectParams);
  const allRows = selectResult.rows;
  const processed = allRows.length;

  if (allRows.length === 0) {
    return c.json({ processed: 0, succeeded: 0 });
  }

  const ids = allRows.map((row) => String((row as Record<string, unknown>).id));
  const idPlaceholders = ids.map((_, index) => `$${index + 1}`).join(', ');
  let succeeded = 0;

  if (body.action === 'delete') {
    // Check delete rule at table level
    const tableAccess = getTableAccess(tableConfig);
    if (!isServiceKey && tableAccess?.delete !== undefined) {
      if (typeof tableAccess.delete === 'boolean' && !tableAccess.delete) {
        return c.json({ code: 403, message: 'Delete not allowed.' }, 403);
      }
    }

    const sql = `DELETE FROM ${escapePgIdentifier(tableName)} WHERE "id" IN (${idPlaceholders}) RETURNING *`;
    const result = await query(sql, ids);
    succeeded = result.rowCount;

    if (succeeded > 0) {
      c.executionCtx.waitUntil(
        emitDbLiveEvent(c.env, resolved.namespace, tableName, 'removed', '_bulk', { action: 'delete', count: succeeded }),
      );
    }

    return c.json({
      processed,
      succeeded,
      deleted: result.rowCount,
      items: result.rows.map(r => stripInternalPgFields(r as Record<string, unknown>)),
    });
  }

  // action === 'update'
  if (!updateData || Object.keys(updateData).length === 0) {
    return c.json({ code: 400, message: 'data is required for update action.' }, 400);
  }

  // Check update rule at table level
  const tableAccess = getTableAccess(tableConfig);
  if (!isServiceKey && tableAccess?.update !== undefined) {
    if (typeof tableAccess.update === 'boolean' && !tableAccess.update) {
      return c.json({ code: 403, message: 'Update not allowed.' }, 403);
    }
  }

  const prepared = preparePgUpdateData(updateData, tableConfig).data;
  if (Object.keys(prepared).length === 0) {
    return c.json({ code: 400, message: 'No valid fields to update.' }, 400);
  }

  const { setClauses, params: updateValues } = parseUpdateBody(
    prepared,
    ['id'],
    { dialect: 'postgres', startIndex: ids.length + 1 },
  );
  const updateParams = [...ids, ...updateValues];

  const sql = `UPDATE ${escapePgIdentifier(tableName)} SET ${setClauses.join(', ')} WHERE "id" IN (${idPlaceholders}) RETURNING *`;
  const result = await query(sql, updateParams);
  succeeded = result.rowCount;

  if (succeeded > 0) {
    c.executionCtx.waitUntil(
      emitDbLiveEvent(c.env, resolved.namespace, tableName, 'modified', '_bulk', { action: 'update', count: succeeded }),
    );
  }

  return c.json({
    processed,
    succeeded,
    updated: result.rowCount,
    items: result.rows.map(r => stripInternalPgFields(r as Record<string, unknown>)),
  });
}

// ─── Helpers ───

function getTextFields(config: TableConfig): string[] {
  if (!config.schema) return ['id'];
  const fields: string[] = [];
  for (const [name, field] of Object.entries(config.schema)) {
    if (field === false) continue;
    if (field.type === 'string' || field.type === 'text') {
      fields.push(name);
    }
  }
  return fields.length > 0 ? fields : ['id'];
}
