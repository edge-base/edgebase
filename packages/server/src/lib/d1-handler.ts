/**
 * D1 request handler for single-instance (non-multi-tenant) databases.
 *
 * Runs in Worker context (not DO) — handles:
 * - D1 binding resolution (dynamic per namespace)
 * - Lazy schema initialization (via d1-schema-init)
 * - CRUD operations (via query-engine SQLite dialect)
 * - Rules evaluation (Worker level)
 * - Hooks execution (Worker level)
 *
 * Database Live: After successful writes, emits events to DatabaseLiveDO
 * via fire-and-forget stub.fetch() — same pattern as database-do.ts.
 *
 * Mirrors postgres-handler.ts structurally but uses D1 API + SQLite dialect.
 */
import type { Context } from 'hono';
import type { HonoEnv } from './hono.js';
import type { Env } from '../types.js';
import type {
  AuthContext,
  TableConfig,
  TableRules,
  HookCtx,
  SchemaField,
  DbBlock,
} from '@edge-base/shared';
import { EdgeBaseError, getTableAccess, getTableHooks } from '@edge-base/shared';
import { parseConfig, getD1BindingName } from './do-router.js';
import { ensureD1Schema } from './d1-schema-init.js';
import {
  buildListQuery, buildCountQuery, buildGetQuery, buildSearchQuery, buildSubstringSearchQuery,
  parseQueryParams,
  type FilterTuple,
} from './query-engine.js';
import { summarizeValidationErrors, validateInsert, validateUpdate } from './validation.js';
import { buildEffectiveSchema } from './schema.js';
import { generateId } from './uuid.js';
import { parseUpdateBody } from './op-parser.js';
import { emitDbLiveEvent, emitDbLiveBatchEvent } from './database-live-emitter.js';
import { isTrustedInternalContext } from './internal-request.js';
import { executeDbTriggers } from './functions.js';
import { forbiddenError, hookRejectedError, normalizeDatabaseError } from './errors.js';
import { buildTableHookRuntimeServices } from './table-hook-runtime.js';

// ─── Types ───

interface D1ResolvedDb {
  db: D1Database;
  dbBlock: DbBlock;
  namespace: string;
}

// ─── Main Handler ───

/**
 * Handle a request to a D1-backed database table.
 * Called from tables.ts when shouldRouteToD1() returns true.
 */
export async function handleD1Request(
  c: Context<HonoEnv>,
  namespace: string,
  tableName: string,
  doPath: string,
): Promise<Response> {
  // 1. Resolve D1 binding
  const resolved = resolveD1Binding(c.env, namespace);

  // 2. Validate table exists in config
  const tableConfig = resolved.dbBlock.tables?.[tableName];
  if (!tableConfig) {
    return c.json({ code: 404, message: `Table '${tableName}' not found in database '${namespace}'.` }, 404);
  }

  // 3. Lazy schema init
  await ensureD1Schema(
    resolved.db,
    namespace,
    resolved.dbBlock.tables ?? {},
  );

  // 4. Check if this is a service key request
  const isServiceKey = checkServiceKey(c);

  // 5. Get auth context
  const auth = c.get('auth') as AuthContext | null | undefined ?? null;

  // 6. Parse operation from path + method
  const method = c.req.raw.method;
  const pathSuffix = doPath.replace(`/tables/${tableName}`, '');

  // 7. Route to operation
  if (method === 'GET') {
    if (pathSuffix === '/count') {
      return handleCount(c, resolved, tableName, tableConfig, auth, isServiceKey);
    }
    if (pathSuffix === '/search') {
      return handleSearch(c, resolved, tableName, tableConfig, auth, isServiceKey);
    }
    if (pathSuffix && pathSuffix !== '/') {
      const id = pathSuffix.slice(1);
      return handleGet(c, resolved, tableName, tableConfig, id, auth, isServiceKey);
    }
    return handleList(c, resolved, tableName, tableConfig, auth, isServiceKey);
  }

  if (method === 'POST') {
    if (pathSuffix === '/batch') {
      return handleBatch(c, resolved, tableName, tableConfig, auth, isServiceKey);
    }
    if (pathSuffix === '/batch-by-filter') {
      return handleBatchByFilter(c, resolved, tableName, tableConfig, auth, isServiceKey);
    }
    return handleInsert(c, resolved, tableName, tableConfig, auth, isServiceKey);
  }

  if (method === 'PATCH' || method === 'PUT') {
    const id = pathSuffix.slice(1);
    return handleUpdate(c, resolved, tableName, tableConfig, id, auth, isServiceKey);
  }

  if (method === 'DELETE') {
    const id = pathSuffix.slice(1);
    return handleDelete(c, resolved, tableName, tableConfig, id, auth, isServiceKey);
  }

  return c.json({ code: 405, message: 'Method not allowed' }, 405);
}

function invalidD1BodyMessage(context: string): string {
  return `Invalid JSON body for ${context}. Send application/json with the expected fields.`;
}

function d1RuleRejectedMessage(
  tableName: string,
  action: 'read' | 'insert' | 'delete' | 'list' | 'count' | 'search',
  id?: string,
): string {
  if (id) {
    return `Access denied. The '${action}' access rule for table '${tableName}' rejected record '${id}'.`;
  }
  return `Access denied. The '${action}' access rule for table '${tableName}' rejected this request.`;
}

// ─── D1 Binding Resolution ───

function resolveD1Binding(env: Env, namespace: string): D1ResolvedDb {
  const config = parseConfig(env);
  const dbBlock = config.databases?.[namespace];
  if (!dbBlock) {
    throw new EdgeBaseError(404, `Database '${namespace}' not found in config.`);
  }

  const bindingName = getD1BindingName(namespace);
  const envRecord = env as unknown as Record<string, unknown>;
  const db = envRecord[bindingName] as D1Database | undefined;

  if (!db) {
    throw new EdgeBaseError(500,
      `D1 binding '${bindingName}' not found for namespace '${namespace}'. ` +
      `Run 'edgebase deploy' to auto-provision D1 databases, ` +
      `or add [[d1_databases]] binding = "${bindingName}" to wrangler.toml for local dev.`,
    );
  }

  return { db, dbBlock, namespace };
}

// ─── Service Key Check ───

function checkServiceKey(c: Context<HonoEnv>): boolean {
  if (isTrustedInternalContext(c)) return true;
  // Public request paths must be validated upstream (rules middleware / admin route)
  // so provider-backed handlers observe the same scoped + constrained bypass result.
  return c.get('isServiceKey' as never) === true;
}

// ─── D1 Query Helpers ───

async function executeD1Query(
  db: D1Database,
  sql: string,
  params: unknown[],
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  try {
    const stmt = db.prepare(sql);
    const bound = params.length > 0 ? stmt.bind(...params) : stmt;
    const result = await bound.all();
    return {
      rows: (result.results ?? []) as Record<string, unknown>[],
      rowCount: result.meta?.changes ?? 0,
    };
  } catch (error) {
    const normalized = normalizeDatabaseError(error);
    if (normalized) throw normalized;
    throw error;
  }
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
  db: D1Database,
  env: Env,
  executionCtx?: ExecutionContext,
): HookCtx {
  const runtimeServices = buildTableHookRuntimeServices(parseConfig(env), env);

  return {
    db: {
      async get(table: string, id: string): Promise<Record<string, unknown> | null> {
        const { sql, params } = buildGetQuery(table, id, undefined, 'sqlite');
        const result = await executeD1Query(db, sql, params);
        return result.rows.length > 0 ? stripInternalFields(result.rows[0]) : null;
      },
      async list(table: string, filter?: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
        let sql = `SELECT * FROM "${table.replace(/"/g, '""')}"`;
        const params: unknown[] = [];
        if (filter && Object.keys(filter).length > 0) {
          const conditions: string[] = [];
          for (const [key, value] of Object.entries(filter)) {
            conditions.push(`"${key.replace(/"/g, '""')}" = ?`);
            params.push(value);
          }
          sql += ` WHERE ${conditions.join(' AND ')}`;
        }
        sql += ' LIMIT 100';
        const result = await executeD1Query(db, sql, params);
        return result.rows.map(r => stripInternalFields(r));
      },
      async exists(table: string, filter: Record<string, unknown>): Promise<boolean> {
        const conditions: string[] = [];
        const params: unknown[] = [];
        for (const [key, value] of Object.entries(filter)) {
          conditions.push(`"${key.replace(/"/g, '""')}" = ?`);
          params.push(value);
        }
        const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
        const sql = `SELECT 1 FROM "${table.replace(/"/g, '""')}"${where} LIMIT 1`;
        const result = await executeD1Query(db, sql, params);
        return result.rows.length > 0;
      },
    },
    ...runtimeServices,
    waitUntil(promise: Promise<unknown>): void {
      if (executionCtx) {
        executionCtx.waitUntil(promise);
      }
    },
  };
}

function scheduleDbLive(
  executionCtx: ExecutionContext,
  promise: Promise<void>,
  context: string,
): void {
  executionCtx.waitUntil(
    promise.catch((error) => {
      console.warn(`[db-live] ${context} failed`, error);
    }),
  );
}

// ─── Utility ───

function esc(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function stripInternalFields(row: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...row };
  delete cleaned._fts;
  return cleaned;
}

/**
 * Normalize D1/SQLite row values:
 * - Boolean fields: 0/1 → true/false
 * - JSON fields: parse string → object
 * - Number fields: string → number (SQLite may return strings)
 * Mirrors database-do.ts normalizeRow().
 */
function normalizeRow(
  row: Record<string, unknown>,
  tableConfig: TableConfig,
): Record<string, unknown> {
  if (!tableConfig.schema) return row;
  const result = { ...row };

  for (const [key, fieldDef] of Object.entries(tableConfig.schema)) {
    if (fieldDef === false) continue;
    const value = result[key];
    if (value === undefined) continue;

    if (fieldDef.type === 'boolean') {
      if (value === 1 || value === '1' || value === 'true' || value === true) {
        result[key] = true;
      } else if (value === 0 || value === '0' || value === 'false' || value === false) {
        result[key] = false;
      } else if (value === null) {
        result[key] = null;
      } else {
        result[key] = Boolean(value);
      }
    } else if (fieldDef.type === 'json') {
      if (typeof value === 'string' && value.length > 0) {
        try {
          result[key] = JSON.parse(value);
        } catch {
          // Keep as string if not valid JSON
        }
      }
    } else if (fieldDef.type === 'number') {
      if (typeof value === 'string') {
        const num = Number(value);
        if (!Number.isNaN(num)) result[key] = num;
      }
    }
  }

  return result;
}

function serializeJsonFields(
  data: Record<string, unknown>,
  schema: Record<string, SchemaField>,
): void {
  for (const [key, field] of Object.entries(schema)) {
    if (field.type === 'json' && data[key] !== undefined && data[key] !== null) {
      if (typeof data[key] !== 'string') {
        data[key] = JSON.stringify(data[key]);
      }
    } else if (field.type === 'boolean' && data[key] !== undefined && data[key] !== null) {
      data[key] = data[key] === true || data[key] === 'true' || data[key] === 1 || data[key] === '1'
        ? 1
        : 0;
    }
  }
}

function filterToSchemaColumns(
  data: Record<string, unknown>,
  effectiveSchema: Record<string, SchemaField>,
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (key in effectiveSchema) {
      filtered[key] = data[key];
    }
  }
  return filtered;
}

// ═══════════════════════════════════════════════════════════════════════════
// CRUD Operations
// ═══════════════════════════════════════════════════════════════════════════

// ─── LIST ───

async function handleList(
  c: Context<HonoEnv>,
  resolved: D1ResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  auth: AuthContext | null,
  isServiceKey: boolean,
): Promise<Response> {
  const tableAccess = getTableAccess(tableConfig);
  if (!isServiceKey && tableAccess?.read === false) {
    const error = forbiddenError(d1RuleRejectedMessage(tableName, 'list'));
    return c.json(error.toJSON(), error.status as 403);
  }

  const queryOpts = parseQueryParams(Object.fromEntries(new URL(c.req.url).searchParams));
  let query = buildListQuery(tableName, queryOpts, 'sqlite');
  let result;
  try {
    result = await executeD1Query(resolved.db, query.sql, query.params);
  } catch {
    // FTS table may not exist — fall back to substring search
    if (queryOpts.search) {
      const searchFields = tableConfig.schema ? Object.keys(tableConfig.schema).filter(k => tableConfig.schema![k] !== false) : ['id'];
      query = buildSubstringSearchQuery(tableName, queryOpts.search, {
        pagination: queryOpts.pagination,
        filters: queryOpts.filters,
        orFilters: queryOpts.orFilters,
        sort: queryOpts.sort,
        fields: searchFields,
      }, 'sqlite');
      result = await executeD1Query(resolved.db, query.sql, query.params);
    } else {
      throw new Error('Query failed');
    }
  }
  const { countSql, countParams } = query;

  // Apply read rules per row + normalize booleans/JSON
  let items = result.rows.map(r => normalizeRow(stripInternalFields(r), tableConfig));
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
    const hookCtx = buildHookCtx(resolved.db, c.env, c.executionCtx);
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
  if (countSql && countParams) {
    const countResult = await executeD1Query(resolved.db, countSql, countParams);
    total = Number(countResult.rows[0]?.total ?? 0);
  }

  const perPage = queryOpts.pagination?.limit ?? queryOpts.pagination?.perPage ?? 100;
  const page = queryOpts.pagination?.page ?? 1;
  // Always include cursor/hasMore like DO does — clients can start cursor pagination from any page
  const hasMore = items.length === perPage;
  const cursor = hasMore && items.length > 0
    ? String((items[items.length - 1]).id ?? '')
    : null;

  return c.json({ items, total, hasMore, cursor, page, perPage });
}

// ─── COUNT ───

async function handleCount(
  c: Context<HonoEnv>,
  resolved: D1ResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  _auth: AuthContext | null,
  isServiceKey: boolean,
): Promise<Response> {
  const tableAccess = getTableAccess(tableConfig);
  if (!isServiceKey && tableAccess?.read === false) {
    const error = forbiddenError(d1RuleRejectedMessage(tableName, 'count'));
    return c.json(error.toJSON(), error.status as 403);
  }

  const queryOpts = parseQueryParams(Object.fromEntries(new URL(c.req.url).searchParams));
  const { sql, params } = buildCountQuery(tableName, queryOpts.filters, queryOpts.orFilters, 'sqlite');
  const result = await executeD1Query(resolved.db, sql, params);
  const total = result.rows[0]?.total ?? 0;
  return c.json({ total });
}

// ─── SEARCH ───

async function handleSearch(
  c: Context<HonoEnv>,
  resolved: D1ResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  auth: AuthContext | null,
  isServiceKey: boolean,
): Promise<Response> {
  const tableAccess = getTableAccess(tableConfig);
  if (!isServiceKey && tableAccess?.read === false) {
    const error = forbiddenError(d1RuleRejectedMessage(tableName, 'search'));
    return c.json(error.toJSON(), error.status as 403);
  }

  const queryOpts = parseQueryParams(Object.fromEntries(new URL(c.req.url).searchParams));
  const searchTerm = queryOpts.search || '';
  if (!searchTerm) {
    return c.json({ items: [] });
  }

  const ftsFields = tableConfig.fts?.length
    ? tableConfig.fts
    : getTextFields(tableConfig);

  let items: Record<string, unknown>[];
  let total = 0;
  const limit = queryOpts.pagination?.limit ?? queryOpts.pagination?.perPage ?? 100;
  const offset = queryOpts.pagination?.offset ?? ((queryOpts.pagination?.page ?? 1) - 1) * limit;
  const searchQuery = buildSearchQuery(tableName, searchTerm, {
    pagination: queryOpts.pagination,
    filters: queryOpts.filters,
    orFilters: queryOpts.orFilters,
    sort: queryOpts.sort,
    ftsFields,
  }, 'sqlite');
  try {
    const result = await executeD1Query(resolved.db, searchQuery.sql, searchQuery.params);
    items = result.rows.map(r => normalizeRow(stripInternalFields(r), tableConfig));
    if (searchQuery.countSql) {
      const countResult = await executeD1Query(resolved.db, searchQuery.countSql, searchQuery.countParams ?? []);
      total = Number(countResult.rows[0]?.total ?? items.length);
    }
  } catch {
    items = [];
  }

  if (items.length === 0 && ftsFields.length > 0) {
    const fallback = buildSubstringSearchQuery(tableName, searchTerm, {
      pagination: queryOpts.pagination,
      filters: queryOpts.filters,
      orFilters: queryOpts.orFilters,
      sort: queryOpts.sort,
      fields: ftsFields,
    }, 'sqlite');
    const result = await executeD1Query(resolved.db, fallback.sql, fallback.params);
    items = result.rows.map((row) => normalizeRow(stripInternalFields(row), tableConfig));
    if (fallback.countSql) {
      const countResult = await executeD1Query(resolved.db, fallback.countSql, fallback.countParams ?? []);
      total = Number(countResult.rows[0]?.total ?? items.length);
    }
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
  resolved: D1ResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  id: string,
  auth: AuthContext | null,
  isServiceKey: boolean,
): Promise<Response> {
  const fieldsParam = new URL(c.req.url).searchParams.get('fields');
  const fields = fieldsParam ? fieldsParam.split(',').map(f => f.trim()) : undefined;

  const { sql, params } = buildGetQuery(tableName, id, fields, 'sqlite');
  const result = await executeD1Query(resolved.db, sql, params);

  if (result.rows.length === 0) {
    return c.json({ code: 404, message: `Record '${id}' not found in '${tableName}'.` }, 404);
  }

  const row = normalizeRow(stripInternalFields(result.rows[0]), tableConfig);

  // Check read rule
  const tableAccess = getTableAccess(tableConfig);
  const tableHooks = getTableHooks(tableConfig);
  if (!isServiceKey && tableAccess?.read !== undefined) {
    if (!(await evalRowRule(tableAccess.read, auth, row))) {
      return c.json({ code: 403, message: d1RuleRejectedMessage(tableName, 'read', id) }, 403);
    }
  }

  // Apply onEnrich hook
  if (tableHooks?.onEnrich) {
    const hookCtx = buildHookCtx(resolved.db, c.env, c.executionCtx);
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
  resolved: D1ResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  auth: AuthContext | null,
  isServiceKey: boolean,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: invalidD1BodyMessage(`inserting into table '${tableName}'`) }, 400);
  }
  body = applySchemaFieldAliases(body, tableConfig.schema);

  // Check insert rule
  const tableAccess = getTableAccess(tableConfig);
  const tableHooks = getTableHooks(tableConfig);
  if (!isServiceKey && tableAccess?.insert !== undefined) {
    if (!(await evalInsertRule(tableAccess.insert, auth))) {
      return c.json({ code: 403, message: d1RuleRejectedMessage(tableName, 'insert') }, 403);
    }
  }

  // Validate against schema
  const validation = validateInsert(body, tableConfig.schema);
  if (!validation.valid) {
    return c.json({
      code: 400,
      message: summarizeValidationErrors(validation.errors),
      data: Object.fromEntries(Object.entries(validation.errors).map(([k, v]) => [k, { code: 'invalid', message: v }])),
    }, 400);
  }

  // Build effective schema
  const effectiveSchema = buildEffectiveSchema(tableConfig.schema);

  // Auto-fields
  if (!body.id) body.id = generateId();
  const now = new Date().toISOString();
  if (effectiveSchema.createdAt) body.createdAt = now;
  if (effectiveSchema.updatedAt) body.updatedAt = now;

  // Apply defaults for missing fields
  for (const [name, field] of Object.entries(effectiveSchema)) {
    if (body[name] === undefined && field.default !== undefined) {
      body[name] = field.default;
    }
  }

  // Run beforeInsert hook
  const hookCtx = buildHookCtx(resolved.db, c.env, c.executionCtx);
  if (tableHooks?.beforeInsert) {
    try {
      const transformed = await tableHooks.beforeInsert(auth, body, hookCtx);
      if (transformed && typeof transformed === 'object') {
        body = { ...body, ...transformed };
      }
    } catch (err) {
      const hookError = hookRejectedError(err, 'Insert rejected by beforeInsert hook.');
      return c.json(hookError.toJSON(), hookError.status as 400);
    }
  }

  // Filter to schema columns + serialize JSON
  const data = filterToSchemaColumns(body, effectiveSchema);
  serializeJsonFields(data, effectiveSchema);

  // Check upsert mode
  const url = new URL(c.req.url);
  const isUpsert = url.searchParams.get('upsert') === 'true';
  const conflictTarget = url.searchParams.get('conflictTarget') || 'id';

  // Validate conflictTarget for upserts
  if (isUpsert) {
    // Check field exists in schema
    if (!effectiveSchema[conflictTarget]) {
      return c.json({ code: 400, message: `conflictTarget '${conflictTarget}' does not exist in schema.` }, 400);
    }
    // Check field is unique (or 'id')
    if (conflictTarget !== 'id') {
      const fieldDef = tableConfig.schema?.[conflictTarget];
      if (!fieldDef || !(fieldDef as SchemaField).unique) {
        return c.json({ code: 400, message: `conflictTarget '${conflictTarget}' must be a unique field.` }, 400);
      }
    }
  }

  // For upsert: check if record already exists to determine action
  let isUpdate = false;
  let upsertBeforeRow: Record<string, unknown> | null = null;
  if (isUpsert && data[conflictTarget] !== undefined) {
    const checkSql = `SELECT * FROM ${esc(tableName)} WHERE ${esc(conflictTarget)} = ? LIMIT 1`;
    const checkResult = await executeD1Query(resolved.db, checkSql, [data[conflictTarget]]);
    isUpdate = checkResult.rows.length > 0;
    upsertBeforeRow = isUpdate ? stripInternalFields(checkResult.rows[0]) : null;
  }

  // Build INSERT SQL (SQLite uses ? params)
  const columns = Object.keys(data);
  const values = columns.map(col => data[col] ?? null);
  const placeholders = columns.map(() => '?').join(', ');

  let sql: string;
  if (isUpsert) {
    const setClauses = columns
      .filter(col => col !== 'id' && col !== conflictTarget && col !== 'createdAt')
      .map(col => `${esc(col)} = excluded.${esc(col)}`);
    sql = `INSERT INTO ${esc(tableName)} (${columns.map(esc).join(', ')}) VALUES (${placeholders})` +
      ` ON CONFLICT (${esc(conflictTarget)}) DO UPDATE SET ${setClauses.join(', ')}`;
  } else {
    sql = `INSERT INTO ${esc(tableName)} (${columns.map(esc).join(', ')}) VALUES (${placeholders})`;
  }

  await executeD1Query(resolved.db, sql, values);

  // D1 doesn't support RETURNING * — re-fetch the inserted row using the stable conflict target.
  const fetchField = isUpsert && conflictTarget !== 'id' ? conflictTarget : 'id';
  const fetchValue = data[fetchField];
  const fetchResult = await executeD1Query(
    resolved.db,
    `SELECT * FROM ${esc(tableName)} WHERE ${esc(String(fetchField))} = ? LIMIT 1`,
    [fetchValue],
  );
  const rawRow = fetchResult.rows.length > 0 ? stripInternalFields(fetchResult.rows[0]) : data;
  const inserted = normalizeRow(rawRow, tableConfig);

  // Run afterInsert hook (fire-and-forget)
  if (tableHooks?.afterInsert) {
    const hook = tableHooks.afterInsert;
    hookCtx.waitUntil(Promise.resolve(hook(inserted, hookCtx)).catch(() => {}));
  }

  // Emit database-live event in the background so writes stay fast.
  const eventType = isUpsert && isUpdate ? 'modified' : 'added';
  scheduleDbLive(
    c.executionCtx,
    emitDbLiveEvent(c.env, resolved.namespace, tableName, eventType, String(inserted.id ?? ''), inserted),
    `emit ${eventType} ${resolved.namespace}.${tableName}`,
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

  // Upsert response includes action field
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
  resolved: D1ResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  id: string,
  auth: AuthContext | null,
  isServiceKey: boolean,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: invalidD1BodyMessage(`updating table '${tableName}'`) }, 400);
  }
  body = applySchemaFieldAliases(body, tableConfig.schema);

  // Validate against schema
  const validation = validateUpdate(body, tableConfig.schema);
  if (!validation.valid) {
    return c.json({ code: 400, message: `Update payload for table '${tableName}' failed validation. See data for field-level errors.`, data: Object.fromEntries(Object.entries(validation.errors).map(([k, v]) => [k, { code: 'invalid', message: v }])) }, 400);
  }

  // Fetch existing record to check rules
  const { sql: getSql, params: getParams } = buildGetQuery(tableName, id, undefined, 'sqlite');
  const existing = await executeD1Query(resolved.db, getSql, getParams);
  if (existing.rows.length === 0) {
    return c.json({ code: 404, message: `Record '${id}' not found in '${tableName}'.` }, 404);
  }
  const existingRow = existing.rows[0];

  // Check update rule
  const tableAccess = getTableAccess(tableConfig);
  const tableHooks = getTableHooks(tableConfig);
  if (!isServiceKey && tableAccess?.update !== undefined) {
    if (!(await evalRowRule(tableAccess.update, auth, existingRow))) {
      return c.json({ code: 403, message: `Access denied: 'update' rule blocked record "${id}" in table "${tableName}".` }, 403);
    }
  }

  // Build effective schema
  const effectiveSchema = buildEffectiveSchema(tableConfig.schema);

  // Auto-field: updatedAt
  if (effectiveSchema.updatedAt) {
    body.updatedAt = new Date().toISOString();
  }

  // Run beforeUpdate hook
  const hookCtx = buildHookCtx(resolved.db, c.env, c.executionCtx);
  if (tableHooks?.beforeUpdate) {
    try {
      const transformed = await tableHooks.beforeUpdate(auth, existingRow, body, hookCtx);
      if (transformed && typeof transformed === 'object') {
        body = { ...body, ...transformed };
      }
    } catch (err) {
      const hookError = hookRejectedError(err, 'Update rejected by beforeUpdate hook.');
      return c.json(hookError.toJSON(), hookError.status as 400);
    }
  }

  // Filter to schema columns + serialize JSON (skip $op objects from serialization)
  delete body.id;
  delete body.createdAt;
  const data = filterToSchemaColumns(body, effectiveSchema);
  // Serialize JSON fields (but skip $op objects)
  for (const [key, val] of Object.entries(data)) {
    if (val && typeof val === 'object' && '$op' in (val as Record<string, unknown>)) continue;
    const fieldDef = effectiveSchema[key];
    if (fieldDef && typeof fieldDef === 'object' && fieldDef.type === 'json' && val !== null && val !== undefined) {
      data[key] = JSON.stringify(val);
    } else if (fieldDef && typeof fieldDef === 'object' && fieldDef.type === 'boolean' && val !== null && val !== undefined) {
      data[key] = val === true || val === 'true' || val === 1 || val === '1'
        ? 1
        : 0;
    }
  }

  // Use parseUpdateBody to handle both regular values and $op field operators
  const { setClauses, params } = parseUpdateBody(data);

  if (setClauses.length === 0) {
    // Empty update body — return existing record as-is (same as DO handler)
    return c.json(existingRow);
  }

  // Build UPDATE SQL with WHERE id = ?
  params.push(id);
  const sql = `UPDATE ${esc(tableName)} SET ${setClauses.join(', ')} WHERE "id" = ?`;
  const updateResult = await executeD1Query(resolved.db, sql, params);

  if (updateResult.rowCount === 0) {
    return c.json({ code: 404, message: `Record '${id}' not found in '${tableName}'.` }, 404);
  }

  // Re-fetch updated row (D1 doesn't support RETURNING *)
  const fetchResult = await executeD1Query(resolved.db, getSql, getParams);
  const rawUpdated = fetchResult.rows.length > 0 ? stripInternalFields(fetchResult.rows[0]) : { id, ...data };
  const updated = normalizeRow(rawUpdated, tableConfig);

  // Run afterUpdate hook (fire-and-forget)
  if (tableHooks?.afterUpdate) {
    const hook = tableHooks.afterUpdate;
    hookCtx.waitUntil(
      Promise.resolve(hook(existingRow, updated, hookCtx)).catch(() => {}),
    );
  }

  scheduleDbLive(
    c.executionCtx,
    emitDbLiveEvent(c.env, resolved.namespace, tableName, 'modified', id, updated),
    `emit modified ${resolved.namespace}.${tableName}:${id}`,
  );
  c.executionCtx.waitUntil(
    executeDbTriggers(
      tableName,
      'update',
      {
        before: existingRow as Record<string, unknown>,
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
  resolved: D1ResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  id: string,
  auth: AuthContext | null,
  isServiceKey: boolean,
): Promise<Response> {
  // Fetch existing record
  const { sql: getSql, params: getParams } = buildGetQuery(tableName, id, undefined, 'sqlite');
  const existing = await executeD1Query(resolved.db, getSql, getParams);
  if (existing.rows.length === 0) {
    return c.json({ code: 404, message: `Record '${id}' not found in '${tableName}'.` }, 404);
  }
  const existingRow = existing.rows[0];

  // Check delete rule
  const tableAccess = getTableAccess(tableConfig);
  const tableHooks = getTableHooks(tableConfig);
  if (!isServiceKey && tableAccess?.delete !== undefined) {
    if (!(await evalRowRule(tableAccess.delete, auth, existingRow))) {
      return c.json({ code: 403, message: d1RuleRejectedMessage(tableName, 'delete', id) }, 403);
    }
  }

  // Run beforeDelete hook
  const hookCtx = buildHookCtx(resolved.db, c.env, c.executionCtx);
  if (tableHooks?.beforeDelete) {
    try {
      await tableHooks.beforeDelete(auth, existingRow, hookCtx);
    } catch (err) {
      const hookError = hookRejectedError(err, 'Delete rejected by beforeDelete hook.');
      return c.json(hookError.toJSON(), hookError.status as 400);
    }
  }

  // Execute DELETE
  const sql = `DELETE FROM ${esc(tableName)} WHERE "id" = ?`;
  await executeD1Query(resolved.db, sql, [id]);

  // Run afterDelete hook (fire-and-forget)
  if (tableHooks?.afterDelete) {
    const hook = tableHooks.afterDelete;
    hookCtx.waitUntil(
      Promise.resolve(hook(existingRow, hookCtx)).catch(() => {}),
    );
  }

  scheduleDbLive(
    c.executionCtx,
    emitDbLiveEvent(c.env, resolved.namespace, tableName, 'removed', id, stripInternalFields(existingRow)),
    `emit removed ${resolved.namespace}.${tableName}:${id}`,
  );
  c.executionCtx.waitUntil(
    executeDbTriggers(
      tableName,
      'delete',
      { before: existingRow as Record<string, unknown> },
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

  return c.json({ deleted: true });
}

// ─── BATCH ───

async function handleBatch(
  c: Context<HonoEnv>,
  resolved: D1ResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  auth: AuthContext | null,
  isServiceKey: boolean,
): Promise<Response> {
  let body: {
    inserts?: Record<string, unknown>[];
    updates?: { id: string; data: Record<string, unknown> }[];
    deletes?: string[];
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: invalidD1BodyMessage(`batch operations on table '${tableName}'`) }, 400);
  }

  // Batch size limit: 500 total ops
  const MAX_BATCH_SIZE = 500;
  const totalOps = (body.inserts?.length ?? 0) + (body.updates?.length ?? 0) + (body.deletes?.length ?? 0);
  if (totalOps > MAX_BATCH_SIZE) {
    return c.json({ code: 400, message: `Batch limit exceeded: ${totalOps} operations (max ${MAX_BATCH_SIZE}).` }, 400);
  }

  // Check insert rule (table-level, once)
  const tableAccess = getTableAccess(tableConfig);
  if (!isServiceKey && body.inserts?.length && tableAccess?.insert !== undefined) {
    if (!(await evalInsertRule(tableAccess.insert, auth))) {
      return c.json({ code: 403, message: d1RuleRejectedMessage(tableName, 'insert') }, 403);
    }
  }

  // Upsert mode support
  const upsertMode = c.req.query('upsert') === 'true';
  const conflictTarget = c.req.query('conflictTarget') || 'id';

  if (upsertMode && conflictTarget !== 'id') {
    const eff = buildEffectiveSchema(tableConfig.schema);
    const targetField = eff[conflictTarget];
    if (!targetField) {
      return c.json({ code: 400, message: `conflictTarget '${conflictTarget}' does not exist in schema.` }, 400);
    }
    if (!targetField.unique) {
      return c.json({ code: 400, message: `conflictTarget '${conflictTarget}' must be a unique field.` }, 400);
    }
  }

  // ── Pre-validate ALL operations before executing any (ensures atomicity) ──
  const effectiveSchema = buildEffectiveSchema(tableConfig.schema);
  const now = new Date().toISOString();

  // Validate all inserts
  if (body.inserts?.length) {
    body.inserts = body.inserts.map((item) => applySchemaFieldAliases(item, tableConfig.schema));
    for (const item of body.inserts) {
      const validation = validateInsert(item, tableConfig.schema);
      if (!validation.valid) {
        return c.json({ code: 400, message: `Batch insert payload for table '${tableName}' failed validation. See data for field-level errors.`, data: Object.fromEntries(Object.entries(validation.errors).map(([k, v]) => [k, { code: 'invalid', message: v }])) }, 400);
      }
    }
  }

  // Validate all updates
  if (body.updates?.length) {
    body.updates = body.updates.map((entry) => ({
      ...entry,
      data: applySchemaFieldAliases(entry.data, tableConfig.schema),
    }));
    for (const entry of body.updates) {
      if (!entry.id) {
        return c.json({ code: 400, message: `Each batch update entry for table '${tableName}' must include an id.` }, 400);
      }
      if (!entry.data || typeof entry.data !== 'object') {
        return c.json({ code: 400, message: `Each batch update entry for table '${tableName}' must include a data object.` }, 400);
      }
      const validation = validateUpdate(entry.data, tableConfig.schema);
      if (!validation.valid) {
        return c.json({ code: 400, message: `Batch update payload for table '${tableName}' failed validation. See data for field-level errors.`, data: Object.fromEntries(Object.entries(validation.errors).map(([k, v]) => [k, { code: 'invalid', message: v }])) }, 400);
      }
    }
  }

  // Check delete rules (table-level)
  if (!isServiceKey && body.deletes?.length && tableAccess?.delete !== undefined) {
    if (!(await evalRowRule(tableAccess.delete, auth, {}))) {
      return c.json({ code: 403, message: d1RuleRejectedMessage(tableName, 'delete') }, 403);
    }
  }

  // ── All validation passed — now execute ──
  const results: Record<string, unknown> = {};
  const allChanges: Array<{ type: 'added' | 'modified' | 'removed'; docId: string; data: Record<string, unknown> | null }> = [];

  // ── Inserts ──
  if (body.inserts) results.inserted = [];
  if (body.inserts?.length) {
    const stmts: D1PreparedStatement[] = [];
    const insertedRecords: Record<string, unknown>[] = [];

    for (const item of body.inserts) {
      const id = (item.id as string) || generateId();
      const record: Record<string, unknown> = { ...item, id };
      if (effectiveSchema.createdAt) record.createdAt = now;
      if (effectiveSchema.updatedAt) record.updatedAt = now;

      for (const [fname, field] of Object.entries(effectiveSchema)) {
        if (record[fname] === undefined && field.default !== undefined) {
          record[fname] = field.default;
        }
      }

      const data = filterToSchemaColumns(record, effectiveSchema);
      serializeJsonFields(data, effectiveSchema);

      const columns = Object.keys(data);
      const values = columns.map(col => data[col] ?? null);
      const placeholders = columns.map(() => '?').join(', ');
      const colStr = columns.map(esc).join(', ');

      let sql: string;
      if (upsertMode) {
        const updateCols = columns.filter(k => k !== 'id' && k !== 'createdAt' && k !== conflictTarget);
        const updateSet = updateCols.map(k => `${esc(k)} = excluded.${esc(k)}`).join(', ');
        sql = updateSet
          ? `INSERT INTO ${esc(tableName)} (${colStr}) VALUES (${placeholders}) ON CONFLICT(${esc(conflictTarget)}) DO UPDATE SET ${updateSet}`
          : `INSERT INTO ${esc(tableName)} (${colStr}) VALUES (${placeholders}) ON CONFLICT(${esc(conflictTarget)}) DO NOTHING`;
      } else {
        sql = `INSERT INTO ${esc(tableName)} (${colStr}) VALUES (${placeholders})`;
      }

      const stmt = resolved.db.prepare(sql);
      stmts.push(values.length > 0 ? stmt.bind(...values) : stmt);
      insertedRecords.push(data);
    }

    // Execute all inserts atomically via db.batch()
    await resolved.db.batch(stmts);

    // Re-fetch all inserted rows
    const inserted = results.inserted as Record<string, unknown>[];
    for (const rec of insertedRecords) {
      const fetchField = upsertMode && conflictTarget !== 'id' ? conflictTarget : 'id';
      const fetchValue = rec[fetchField];
      const fetchResult = await executeD1Query(resolved.db, `SELECT * FROM ${esc(tableName)} WHERE ${esc(String(fetchField))} = ?`, [fetchValue]);
      if (fetchResult.rows.length > 0) {
        const row = normalizeRow(stripInternalFields(fetchResult.rows[0]), tableConfig);
        inserted.push(row);
        allChanges.push({ type: 'added', docId: String(row.id ?? ''), data: row });
      }
    }
  }

  // ── Updates ──
  if (body.updates) results.updated = [];
  if (body.updates?.length) {
    const updated = results.updated as Record<string, unknown>[];
    for (const entry of body.updates) {
      const updateData = { ...entry.data };
      delete updateData.id;
      delete updateData.createdAt;
      if (effectiveSchema.updatedAt?.onUpdate === 'now') {
        updateData.updatedAt = now;
      }

      // Serialize json-type fields
      for (const [key, value] of Object.entries(updateData)) {
        if (effectiveSchema[key]?.type === 'json' && value !== null && value !== undefined && typeof value === 'object' && !('$op' in (value as Record<string, unknown>))) {
          updateData[key] = JSON.stringify(value);
        } else if (effectiveSchema[key]?.type === 'boolean' && value !== null && value !== undefined && (typeof value !== 'object' || !('$op' in value))) {
          updateData[key] = value === true || value === 'true' || value === 1 || value === '1'
            ? 1
            : 0;
        }
      }

      const { setClauses, params } = parseUpdateBody(updateData);
      if (setClauses.length > 0) {
        params.push(entry.id);
        await executeD1Query(resolved.db, `UPDATE ${esc(tableName)} SET ${setClauses.join(', ')} WHERE "id" = ?`, params);
      }

      // Re-fetch the updated row
      const fetchResult = await executeD1Query(resolved.db, `SELECT * FROM ${esc(tableName)} WHERE "id" = ?`, [entry.id]);
      const row = fetchResult.rows.length > 0
        ? normalizeRow(stripInternalFields(fetchResult.rows[0]), tableConfig)
        : { id: entry.id, ...entry.data };
      updated.push(row);
      allChanges.push({ type: 'modified', docId: String(row.id ?? entry.id), data: row });
    }
  }

  // ── Deletes ──
  if (body.deletes) results.deleted = 0;
  if (body.deletes?.length) {
    for (const id of body.deletes) {
      await executeD1Query(resolved.db, `DELETE FROM ${esc(tableName)} WHERE "id" = ?`, [id]);
    }
    results.deleted = body.deletes.length;
    for (const id of body.deletes) {
      allChanges.push({ type: 'removed', docId: id, data: null });
    }
  }

  // Emit database-live events
  if (allChanges.length > 0) {
    if (allChanges.length >= 10) {
      scheduleDbLive(
        c.executionCtx,
        emitDbLiveBatchEvent(c.env, resolved.namespace, tableName, allChanges),
        `emit batch ${resolved.namespace}.${tableName} (${allChanges.length} changes)`,
      );
    } else {
      scheduleDbLive(
        c.executionCtx,
        Promise.all(
          allChanges.map((ch) =>
            emitDbLiveEvent(c.env, resolved.namespace, tableName, ch.type, ch.docId, ch.data),
          ),
        ).then(() => undefined),
        `emit fan-out ${resolved.namespace}.${tableName} (${allChanges.length} changes)`,
      );
    }
  }

  return c.json(results);
}

// ─── BATCH BY FILTER ───

async function handleBatchByFilter(
  c: Context<HonoEnv>,
  resolved: D1ResolvedDb,
  tableName: string,
  tableConfig: TableConfig,
  _auth: AuthContext | null,
  _isServiceKey: boolean,
): Promise<Response> {
  let body: {
    action?: string;
    filter?: FilterTuple[];
    orFilter?: FilterTuple[];
    update?: Record<string, unknown>;
    limit?: number;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: invalidD1BodyMessage(`batch-by-filter on table '${tableName}'`) }, 400);
  }

  if (!body.action || !['delete', 'update'].includes(body.action)) {
    return c.json({ code: 400, message: "batch-by-filter requires 'action' to be 'delete' or 'update'." }, 400);
  }
  if (!body.filter || !Array.isArray(body.filter)) {
    return c.json({ code: 400, message: "batch-by-filter requires 'filter' to be a non-empty array." }, 400);
  }
  if (body.action === 'update' && !body.update) {
    return c.json({ code: 400, message: "batch-by-filter with action 'update' requires 'update' data." }, 400);
  }

  const limit = Math.min(body.limit ?? 500, 500);

  // Find matching records using buildListQuery
  const { sql: selectSql, params: selectParams } = buildListQuery(tableName, {
    filters: body.filter,
    orFilters: body.orFilter,
    pagination: { limit },
  }, 'sqlite');
  const selectResult = await executeD1Query(resolved.db, selectSql, selectParams);
  const allRows = selectResult.rows;
  const processed = allRows.length;

  if (allRows.length === 0) {
    return c.json({ processed: 0, succeeded: 0 });
  }

  const ids = allRows.map(r => r.id as string);
  const placeholders = ids.map(() => '?').join(', ');
  let succeeded = 0;

  if (body.action === 'delete') {
    await executeD1Query(resolved.db, `DELETE FROM ${esc(tableName)} WHERE "id" IN (${placeholders})`, ids);
    succeeded = ids.length;
  } else if (body.action === 'update' && body.update) {
    const effectiveSchema = buildEffectiveSchema(tableConfig.schema);
    const updateData = { ...body.update };
    if (effectiveSchema.updatedAt?.onUpdate === 'now') {
      updateData.updatedAt = new Date().toISOString();
    }

    // Serialize json-type fields
    for (const [key, value] of Object.entries(updateData)) {
      if (effectiveSchema[key]?.type === 'json' && value !== null && value !== undefined && typeof value === 'object' && !('$op' in (value as Record<string, unknown>))) {
        updateData[key] = JSON.stringify(value);
      } else if (effectiveSchema[key]?.type === 'boolean' && value !== null && value !== undefined && (typeof value !== 'object' || !('$op' in value))) {
        updateData[key] = value === true || value === 'true' || value === 1 || value === '1'
          ? 1
          : 0;
      }
    }

    const { setClauses, params } = parseUpdateBody(updateData);
    if (setClauses.length > 0) {
      await executeD1Query(
        resolved.db,
        `UPDATE ${esc(tableName)} SET ${setClauses.join(', ')} WHERE "id" IN (${placeholders})`,
        [...params, ...ids],
      );
    }
    succeeded = ids.length;
  }

  // Emit database-live events
  if (succeeded > 0) {
    const eventType = body.action === 'delete' ? 'removed' : 'modified';
    scheduleDbLive(
      c.executionCtx,
      emitDbLiveEvent(
        c.env,
        resolved.namespace,
        tableName,
        eventType as 'modified' | 'removed',
        '_bulk',
        { action: body.action, count: succeeded },
      ),
      `emit bulk ${resolved.namespace}.${tableName} (${body.action})`,
    );
  }

  return c.json({ processed, succeeded });
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

function toSnakeCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function toCamelCase(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

function applySchemaFieldAliases<T extends Record<string, unknown> | null | undefined>(
  record: T,
  schema?: Record<string, SchemaField | false>,
): T {
  if (!schema || !record || typeof record !== 'object' || Array.isArray(record)) return record;

  const effectiveSchema = buildEffectiveSchema(schema);
  const normalized: Record<string, unknown> = { ...record };

  for (const key of Object.keys(effectiveSchema)) {
    const snake = toSnakeCase(key);
    const camel = toCamelCase(key);

    if (effectiveSchema[snake] && normalized[snake] === undefined && normalized[key] !== undefined) {
      normalized[snake] = normalized[key];
    }
    if (effectiveSchema[camel] && normalized[camel] === undefined && normalized[key] !== undefined) {
      normalized[camel] = normalized[key];
    }
  }

  return normalized as T;
}

// ─── Exported batch import for admin routes ───

/**
 * Batch import records into D1 directly (bypasses rules, for admin use).
 * Returns { imported, errors }.
 */
export async function d1BatchImport(
  env: Env,
  namespace: string,
  tableName: string,
  records: Record<string, unknown>[],
  options?: { upsert?: boolean; conflictTarget?: string },
): Promise<{ imported: number; errors: Array<{ row: number; message: string }> }> {
  const resolved = resolveD1Binding(env, namespace);
  const tableConfig = resolved.dbBlock.tables?.[tableName];
  if (!tableConfig) {
    throw new EdgeBaseError(404, `Table '${tableName}' not found in database '${namespace}'.`);
  }

  await ensureD1Schema(resolved.db, namespace, resolved.dbBlock.tables ?? {});

  const effectiveSchema = buildEffectiveSchema(tableConfig.schema);
  const now = new Date().toISOString();
  const upsertMode = options?.upsert ?? false;
  const conflictTarget = options?.conflictTarget ?? 'id';

  const stmts: D1PreparedStatement[] = [];
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 0; i < records.length; i++) {
    const item = applySchemaFieldAliases(records[i], tableConfig.schema);
    const validation = validateInsert(item, tableConfig.schema);
    if (!validation.valid) {
      errors.push({ row: i, message: Object.values(validation.errors).join('; ') });
      continue;
    }

    const id = (item.id as string) || generateId();
    const record: Record<string, unknown> = { ...item, id };
    if (effectiveSchema.createdAt) record.createdAt = now;
    if (effectiveSchema.updatedAt) record.updatedAt = now;

    for (const [fname, field] of Object.entries(effectiveSchema)) {
      if (record[fname] === undefined && field.default !== undefined) {
        record[fname] = field.default;
      }
    }

    const data = filterToSchemaColumns(record, effectiveSchema);
    serializeJsonFields(data, effectiveSchema);

    const columns = Object.keys(data);
    const values = columns.map(col => data[col] ?? null);
    const placeholders = columns.map(() => '?').join(', ');
    const colStr = columns.map(esc).join(', ');

    let sql: string;
    if (upsertMode) {
      const updateCols = columns.filter(k => k !== 'id' && k !== 'createdAt' && k !== conflictTarget);
      const updateSet = updateCols.map(k => `${esc(k)} = excluded.${esc(k)}`).join(', ');
      sql = updateSet
        ? `INSERT INTO ${esc(tableName)} (${colStr}) VALUES (${placeholders}) ON CONFLICT(${esc(conflictTarget)}) DO UPDATE SET ${updateSet}`
        : `INSERT INTO ${esc(tableName)} (${colStr}) VALUES (${placeholders}) ON CONFLICT(${esc(conflictTarget)}) DO NOTHING`;
    } else {
      sql = `INSERT INTO ${esc(tableName)} (${colStr}) VALUES (${placeholders})`;
    }

    const stmt = resolved.db.prepare(sql);
    stmts.push(values.length > 0 ? stmt.bind(...values) : stmt);
  }

  if (stmts.length === 0) {
    return { imported: 0, errors };
  }

  try {
    await resolved.db.batch(stmts);
    return { imported: stmts.length, errors };
  } catch (err) {
    return { imported: 0, errors: [{ row: 0, message: err instanceof Error ? err.message : 'Batch insert failed' }] };
  }
}
