/**
 * Worker-level database table routes — §7.
 *
 * REST URL patterns:
 *   Single-instance DB: /api/db/{namespace}/tables/{table}[/{id}][/action]
 *   Dynamic DB:         /api/db/{namespace}/{instanceId}/tables/{table}[/{id}][/action]
 *
 * Worker acts as a pure proxy — all data operations happen inside DatabaseDOs.
 * DO routing: getDbDoName(namespace, instanceId?) → 'shared' | 'workspace:ws-456' etc.
 *
 * All 18 routes (9 static + 9 dynamic) are explicitly defined via createRoute()
 * for OpenAPI spec generation. SDK codegen reads these to generate type-safe
 * client methods — NO hardcoded paths allowed in SDKs.
 *
 * 9 operations per DB type:
 *   GET    list, get, count, search
 *   POST   insert, batch, batchByFilter
 *   PATCH  update
 *   DELETE delete
 *
 * Reference: /api/collections/* completely removed (§7). Now uses /api/db/*.
 */
import { OpenAPIHono, createRoute, z, type HonoEnv } from '../lib/hono.js';
import type { Context } from 'hono';
import { getDbDoName, parseConfig, shouldRouteToD1 } from '../lib/do-router.js';
import { fetchDOWithRetry } from '../lib/do-retry.js';
import {
  queryParamsSchema, listResponseSchema, recordResponseSchema,
  jsonResponseSchema, errorResponseSchema, zodDefaultHook,
} from '../lib/schemas.js';
import type { AuthContext } from '@edge-base/shared';
import { handlePgRequest } from '../lib/postgres-handler.js';
import { handleD1Request } from '../lib/d1-handler.js';


export const tablesRoute = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

// ─── Shared param schemas ─────────────────────────────────────────────

const singleInstanceTableParams = z.object({
  namespace: z.string().openapi({ description: 'Database namespace', example: 'app' }),
  table: z.string().openapi({ description: 'Table name', example: 'posts' }),
});

const singleInstanceTableIdParams = z.object({
  namespace: z.string().openapi({ description: 'Database namespace', example: 'app' }),
  table: z.string().openapi({ description: 'Table name', example: 'posts' }),
  id: z.string().openapi({ description: 'Record ID' }),
});

const dynamicTableParams = z.object({
  namespace: z.string().openapi({ description: 'Database namespace', example: 'workspace' }),
  instanceId: z.string().openapi({ description: 'Instance ID', example: 'ws-456' }),
  table: z.string().openapi({ description: 'Table name', example: 'posts' }),
});

const dynamicTableIdParams = z.object({
  namespace: z.string().openapi({ description: 'Database namespace', example: 'workspace' }),
  instanceId: z.string().openapi({ description: 'Instance ID', example: 'ws-456' }),
  table: z.string().openapi({ description: 'Table name', example: 'posts' }),
  id: z.string().openapi({ description: 'Record ID' }),
});

/** Query params for insert/batch — supports ?upsert=true&conflictTarget=email. */
const insertQuerySchema = z.object({
  upsert: z.string().optional().openapi({ description: 'Set to "true" for upsert mode' }),
  conflictTarget: z.string().optional().openapi({ description: 'Column to use for conflict detection in upsert mode' }),
});

// ======================================================================
//  SINGLE-INSTANCE DB: /{namespace}/tables/*
//  Must be registered BEFORE dynamic /:namespace/:instanceId routes.
//  Within GET routes: /count and /search BEFORE /{id} to avoid shadowing.
// ======================================================================

// ─── GET /{namespace}/tables/{table}/count ────────────────────────────

const dbSingleCountRecords = createRoute({
  operationId: 'dbSingleCountRecords',
  method: 'get',
  path: '/{namespace}/tables/{table}/count',
  tags: ['client'],
  summary: 'Count records in a single-instance table',
  request: {
    params: singleInstanceTableParams,
    query: queryParamsSchema,
  },
  responses: {
    200: { description: 'Count result', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbSingleCountRecords, async (c) => {
  const namespace = c.req.param('namespace')!;
  const table = c.req.param('table')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, undefined, table, `/tables/${table}/count`);
});

// ─── GET /{namespace}/tables/{table}/search ───────────────────────────

const dbSingleSearchRecords = createRoute({
  operationId: 'dbSingleSearchRecords',
  method: 'get',
  path: '/{namespace}/tables/{table}/search',
  tags: ['client'],
  summary: 'Search records in a single-instance table',
  request: {
    params: singleInstanceTableParams,
    query: queryParamsSchema,
  },
  responses: {
    200: { description: 'Search results', content: { 'application/json': { schema: listResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbSingleSearchRecords, async (c) => {
  const namespace = c.req.param('namespace')!;
  const table = c.req.param('table')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, undefined, table, `/tables/${table}/search`);
});

// ─── GET /{namespace}/tables/{table}/{id} ─────────────────────────────

const dbSingleGetRecord = createRoute({
  operationId: 'dbSingleGetRecord',
  method: 'get',
  path: '/{namespace}/tables/{table}/{id}',
  tags: ['client'],
  summary: 'Get a single record from a single-instance table',
  request: {
    params: singleInstanceTableIdParams,
    query: z.object({
      fields: z.string().optional().openapi({ description: 'Comma-separated field names to return' }),
    }),
  },
  responses: {
    200: { description: 'Record found', content: { 'application/json': { schema: recordResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbSingleGetRecord, async (c) => {
  const namespace = c.req.param('namespace')!;
  const table = c.req.param('table')!;
  const id = c.req.param('id')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, undefined, table, `/tables/${table}/${id}`);
});

// ─── GET /{namespace}/tables/{table} ──────────────────────────────────

const dbSingleListRecords = createRoute({
  operationId: 'dbSingleListRecords',
  method: 'get',
  path: '/{namespace}/tables/{table}',
  tags: ['client'],
  summary: 'List records from a single-instance table',
  request: {
    params: singleInstanceTableParams,
    query: queryParamsSchema,
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: listResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbSingleListRecords, async (c) => {
  const namespace = c.req.param('namespace')!;
  const table = c.req.param('table')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, undefined, table, `/tables/${table}`);
});

// ─── POST /{namespace}/tables/{table}/batch ───────────────────────────

const dbSingleBatchRecords = createRoute({
  operationId: 'dbSingleBatchRecords',
  method: 'post',
  path: '/{namespace}/tables/{table}/batch',
  tags: ['client'],
  summary: 'Batch insert records into a single-instance table',
  request: {
    params: singleInstanceTableParams,
    query: insertQuerySchema,
    body: { content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } }, required: true },
  },
  responses: {
    200: { description: 'Batch result', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbSingleBatchRecords, async (c) => {
  const namespace = c.req.param('namespace')!;
  const table = c.req.param('table')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, undefined, table, `/tables/${table}/batch`);
});

// ─── POST /{namespace}/tables/{table}/batch-by-filter ─────────────────

const dbSingleBatchByFilter = createRoute({
  operationId: 'dbSingleBatchByFilter',
  method: 'post',
  path: '/{namespace}/tables/{table}/batch-by-filter',
  tags: ['client'],
  summary: 'Batch update/delete records by filter in a single-instance table',
  request: {
    params: singleInstanceTableParams,
    query: insertQuerySchema,
    body: { content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } }, required: true },
  },
  responses: {
    200: { description: 'Batch result', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbSingleBatchByFilter, async (c) => {
  const namespace = c.req.param('namespace')!;
  const table = c.req.param('table')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, undefined, table, `/tables/${table}/batch-by-filter`);
});

// ─── POST /{namespace}/tables/{table} (insert) ────────────────────────

const dbSingleInsertRecord = createRoute({
  operationId: 'dbSingleInsertRecord',
  method: 'post',
  path: '/{namespace}/tables/{table}',
  tags: ['client'],
  summary: 'Insert a record into a single-instance table',
  request: {
    params: singleInstanceTableParams,
    query: insertQuerySchema,
    body: { content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } }, required: true },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: recordResponseSchema } } },
    200: { description: 'Updated (upsert)', content: { 'application/json': { schema: recordResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbSingleInsertRecord, async (c) => {
  const namespace = c.req.param('namespace')!;
  const table = c.req.param('table')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, undefined, table, `/tables/${table}`);
});

// ─── PATCH /{namespace}/tables/{table}/{id} ───────────────────────────

const dbSingleUpdateRecord = createRoute({
  operationId: 'dbSingleUpdateRecord',
  method: 'patch',
  path: '/{namespace}/tables/{table}/{id}',
  tags: ['client'],
  summary: 'Update a record in a single-instance table',
  request: {
    params: singleInstanceTableIdParams,
    body: { content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } }, required: true },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: recordResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbSingleUpdateRecord, async (c) => {
  const namespace = c.req.param('namespace')!;
  const table = c.req.param('table')!;
  const id = c.req.param('id')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, undefined, table, `/tables/${table}/${id}`);
});

// ─── DELETE /{namespace}/tables/{table}/{id} ──────────────────────────

const dbSingleDeleteRecord = createRoute({
  operationId: 'dbSingleDeleteRecord',
  method: 'delete',
  path: '/{namespace}/tables/{table}/{id}',
  tags: ['client'],
  summary: 'Delete a record from a single-instance table',
  request: {
    params: singleInstanceTableIdParams,
  },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: jsonResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbSingleDeleteRecord, async (c) => {
  const namespace = c.req.param('namespace')!;
  const table = c.req.param('table')!;
  const id = c.req.param('id')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, undefined, table, `/tables/${table}/${id}`);
});

// ======================================================================
//  DYNAMIC DB: /{namespace}/{instanceId}/tables/*
//  Same 9 operations with additional namespace + instanceId params.
// ======================================================================

// ─── GET /{namespace}/{instanceId}/tables/{table}/count ───────────────

const dbCountRecords = createRoute({
  operationId: 'dbCountRecords',
  method: 'get',
  path: '/{namespace}/{instanceId}/tables/{table}/count',
  tags: ['client'],
  summary: 'Count records in dynamic table',
  request: {
    params: dynamicTableParams,
    query: queryParamsSchema,
  },
  responses: {
    200: { description: 'Count result', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbCountRecords, async (c) => {
  const namespace = c.req.param('namespace')!;
  const instanceId = c.req.param('instanceId')!;
  const table = c.req.param('table')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, instanceId, table, `/tables/${table}/count`);
});

// ─── GET /{namespace}/{instanceId}/tables/{table}/search ──────────────

const dbSearchRecords = createRoute({
  operationId: 'dbSearchRecords',
  method: 'get',
  path: '/{namespace}/{instanceId}/tables/{table}/search',
  tags: ['client'],
  summary: 'Search records in dynamic table',
  request: {
    params: dynamicTableParams,
    query: queryParamsSchema,
  },
  responses: {
    200: { description: 'Search results', content: { 'application/json': { schema: listResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbSearchRecords, async (c) => {
  const namespace = c.req.param('namespace')!;
  const instanceId = c.req.param('instanceId')!;
  const table = c.req.param('table')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, instanceId, table, `/tables/${table}/search`);
});

// ─── GET /{namespace}/{instanceId}/tables/{table}/{id} ────────────────

const dbGetRecord = createRoute({
  operationId: 'dbGetRecord',
  method: 'get',
  path: '/{namespace}/{instanceId}/tables/{table}/{id}',
  tags: ['client'],
  summary: 'Get single record from dynamic table',
  request: {
    params: dynamicTableIdParams,
    query: z.object({
      fields: z.string().optional().openapi({ description: 'Comma-separated field names to return' }),
    }),
  },
  responses: {
    200: { description: 'Record found', content: { 'application/json': { schema: recordResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbGetRecord, async (c) => {
  const namespace = c.req.param('namespace')!;
  const instanceId = c.req.param('instanceId')!;
  const table = c.req.param('table')!;
  const id = c.req.param('id')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, instanceId, table, `/tables/${table}/${id}`);
});

// ─── GET /{namespace}/{instanceId}/tables/{table} ─────────────────────

const dbListRecords = createRoute({
  operationId: 'dbListRecords',
  method: 'get',
  path: '/{namespace}/{instanceId}/tables/{table}',
  tags: ['client'],
  summary: 'List records from dynamic table',
  request: {
    params: dynamicTableParams,
    query: queryParamsSchema,
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: listResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbListRecords, async (c) => {
  const namespace = c.req.param('namespace')!;
  const instanceId = c.req.param('instanceId')!;
  const table = c.req.param('table')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, instanceId, table, `/tables/${table}`);
});

// ─── POST /{namespace}/{instanceId}/tables/{table}/batch ──────────────

const dbBatchRecords = createRoute({
  operationId: 'dbBatchRecords',
  method: 'post',
  path: '/{namespace}/{instanceId}/tables/{table}/batch',
  tags: ['client'],
  summary: 'Batch insert records into dynamic table',
  request: {
    params: dynamicTableParams,
    query: insertQuerySchema,
    body: { content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } }, required: true },
  },
  responses: {
    200: { description: 'Batch result', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbBatchRecords, async (c) => {
  const namespace = c.req.param('namespace')!;
  const instanceId = c.req.param('instanceId')!;
  const table = c.req.param('table')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, instanceId, table, `/tables/${table}/batch`);
});

// ─── POST /{namespace}/{instanceId}/tables/{table}/batch-by-filter ────

const dbBatchByFilter = createRoute({
  operationId: 'dbBatchByFilter',
  method: 'post',
  path: '/{namespace}/{instanceId}/tables/{table}/batch-by-filter',
  tags: ['client'],
  summary: 'Batch update/delete records by filter in dynamic table',
  request: {
    params: dynamicTableParams,
    query: insertQuerySchema,
    body: { content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } }, required: true },
  },
  responses: {
    200: { description: 'Batch result', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbBatchByFilter, async (c) => {
  const namespace = c.req.param('namespace')!;
  const instanceId = c.req.param('instanceId')!;
  const table = c.req.param('table')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, instanceId, table, `/tables/${table}/batch-by-filter`);
});

// ─── POST /{namespace}/{instanceId}/tables/{table} (insert) ───────────

const dbInsertRecord = createRoute({
  operationId: 'dbInsertRecord',
  method: 'post',
  path: '/{namespace}/{instanceId}/tables/{table}',
  tags: ['client'],
  summary: 'Insert record into dynamic table',
  request: {
    params: dynamicTableParams,
    query: insertQuerySchema,
    body: { content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } }, required: true },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: recordResponseSchema } } },
    200: { description: 'Updated (upsert)', content: { 'application/json': { schema: recordResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbInsertRecord, async (c) => {
  const namespace = c.req.param('namespace')!;
  const instanceId = c.req.param('instanceId')!;
  const table = c.req.param('table')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, instanceId, table, `/tables/${table}`);
});

// ─── PATCH /{namespace}/{instanceId}/tables/{table}/{id} ──────────────

const dbUpdateRecord = createRoute({
  operationId: 'dbUpdateRecord',
  method: 'patch',
  path: '/{namespace}/{instanceId}/tables/{table}/{id}',
  tags: ['client'],
  summary: 'Update record in dynamic table',
  request: {
    params: dynamicTableIdParams,
    body: { content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } }, required: true },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: recordResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbUpdateRecord, async (c) => {
  const namespace = c.req.param('namespace')!;
  const instanceId = c.req.param('instanceId')!;
  const table = c.req.param('table')!;
  const id = c.req.param('id')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, instanceId, table, `/tables/${table}/${id}`);
});

// ─── DELETE /{namespace}/{instanceId}/tables/{table}/{id} ─────────────

const dbDeleteRecord = createRoute({
  operationId: 'dbDeleteRecord',
  method: 'delete',
  path: '/{namespace}/{instanceId}/tables/{table}/{id}',
  tags: ['client'],
  summary: 'Delete record from dynamic table',
  request: {
    params: dynamicTableIdParams,
  },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: jsonResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

tablesRoute.openapi(dbDeleteRecord, async (c) => {
  const namespace = c.req.param('namespace')!;
  const instanceId = c.req.param('instanceId')!;
  const table = c.req.param('table')!;
  const id = c.req.param('id')!;
  return routeToDO(c as unknown as Context<HonoEnv>, namespace, instanceId, table, `/tables/${table}/${id}`);
});

// ======================================================================
//  Shared DO proxy logic
// ======================================================================

/**
 * Route a request to the correct backend based on provider config.
 * - provider='do' (default): forwards to DatabaseDO instance
 * - provider='neon'|'postgres': handles in Worker via postgres-handler
 *
 * Handles §36 canCreate 2-RTT flow for dynamic DOs.
 */
async function routeToDO(
  c: Context<HonoEnv>,
  namespace: string,
  instanceId: string | undefined,
  _tableName: string,
  doPath: string,
): Promise<Response> {
  const tableName = decodeURIComponent(_tableName);
  // Check provider — route to D1 or PostgreSQL handler if not DO
  const config = parseConfig(c.env);
  const dbBlock = config.databases?.[namespace];

  if (!dbBlock) {
    return c.json({ code: 404, message: `Database '${namespace}' not found in config.` }, 404);
  }

  // D1 route: single-instance namespaces without dynamic instanceId
  if (!instanceId && shouldRouteToD1(namespace, config)) {
    return handleD1Request(c as unknown as Context<HonoEnv>, namespace, tableName, doPath);
  }

  // PostgreSQL route
  const provider = dbBlock.provider;
  if (provider === 'neon' || provider === 'postgres') {
    return handlePgRequest(c as unknown as Context<HonoEnv>, namespace, tableName, doPath);
  }

  // Build DO name: 'shared' | 'workspace:ws-456' (§2)
  const doName = getDbDoName(namespace, instanceId);

  const doId = c.env.DATABASE.idFromName(doName);
  const stub = c.env.DATABASE.get(doId);

  // Build forwarded request
  const url = new URL(c.req.raw.url);
  const doUrl = `http://do${doPath}${url.search}`;

  const headers = new Headers(c.req.raw.headers);
  headers.delete('X-EdgeBase-Internal');
  headers.delete('X-Is-Service-Key');
  headers.delete('X-DO-Create-Authorized');
  headers.set('X-DO-Name', doName);

  // Forward auth context to DO for hooks (#133 §6)
  const auth = c.get('auth') as AuthContext | null | undefined;
  if (auth !== undefined) {
    headers.set('X-Auth-Context', JSON.stringify(auth));
  }

  // The trusted upstream rules middleware validates scoped/constrained Service Keys
  // and pins the bypass decision on the request context. Downstream handlers and DOs
  // must consume that decision instead of re-running a wildcard scope check.
  const isServiceKey = c.get('isServiceKey' as never) === true;
  if (isServiceKey) {
    headers.set('X-Is-Service-Key', 'true');
  }

  const init: RequestInit = { method: c.req.raw.method, headers };
  // Always pre-read body as text for non-GET/HEAD methods.
  // ReadableStream is consumed by zod-validator middleware, so we
  // reconstruct from Hono's cached parsed body (c.req.json()).
  let bodyText: string | null = null;
  if (c.req.raw.method !== 'GET' && c.req.raw.method !== 'HEAD') {
    try {
      const json = await c.req.json();
      bodyText = JSON.stringify(json);
    } catch {
      // Body might be empty or non-JSON — default to empty object
      // so DO doesn't crash with "Unexpected end of JSON input"
      bodyText = '{}';
    }
    init.body = bodyText;
  }

  // Retry on DO reset only for idempotent (read) methods.
  // Writes are not retried to avoid duplicate side-effects (hooks, triggers,
  // database-live events) and non-idempotent ops ($op: increment).
  const safeToRetry = c.req.raw.method === 'GET' || c.req.raw.method === 'HEAD';
  const res = await fetchDOWithRetry(stub, doUrl, {
    method: c.req.raw.method,
    headers,
    body: bodyText,
  }, { safeToRetry });

  // §36: Handle needsCreate 2-RTT flow for dynamic DOs (not 'shared' or static)
  if (res.status === 201 && instanceId) {
    const body = await res.clone().json().catch(() => null) as
      | { needsCreate?: boolean; namespace?: string; id?: string }
      | null;
    if (body?.needsCreate) {
      // Evaluate DbLevelRules.canCreate(auth, id) in Worker (#133 §36)
      const config = parseConfig(c.env);
      const dbBlock = config.databases?.[namespace];
      const canCreateFn = dbBlock?.access?.canCreate;

      // Internal/admin DB proxy calls already bypass row-level rules.
      // Dynamic DB bootstrap must honor that bypass too, otherwise
      // context.admin.db(namespace, id).table(...).insert() fails on first write.
      let allowed = isServiceKey;
      if (!allowed && canCreateFn) {
        try {
          allowed = await Promise.resolve(canCreateFn(auth ?? null, body.id ?? instanceId));
        } catch {
          allowed = false; // fail-closed
        }
      }

      if (!allowed) {
        return c.json(
          { code: 403, message: 'DB creation not allowed.', error: 'CANNOT_CREATE_DB' },
          403,
        );
      }

      // Authorized — retry with X-DO-Create-Authorized header
      const retryHeaders = new Headers(headers);
      retryHeaders.set('X-DO-Create-Authorized', '1');
      const retryInit: RequestInit = { method: c.req.raw.method, headers: retryHeaders };
      // BUG-008 fix: use pre-read body text (stream already consumed above)
      if (c.req.raw.method !== 'GET' && c.req.raw.method !== 'HEAD') {
        retryInit.body = bodyText ?? null;
      }
      // needsCreate 2-RTT: DO is empty at this point, safe to retry
      return fetchDOWithRetry(stub, doUrl, {
        method: c.req.raw.method,
        headers: retryHeaders,
        body: (c.req.raw.method !== 'GET' && c.req.raw.method !== 'HEAD') ? (bodyText ?? null) : null,
      }, { safeToRetry: true });
    }
  }

  return res;
}
