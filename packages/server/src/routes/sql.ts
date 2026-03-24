/**
 * SQL endpoint — POST /api/sql
 *
 * Allows server SDK (with Service Key) to execute provider-aware raw SQL.
 * NOT available to client SDK (no sql() method on ClientEdgeBase).
 *
 * §11: URL stays /api/sql, but request body now uses
 * { namespace, id?, sql, params? } — previously: { table, query, params }.
 *
 * Security:
 * - Service Key required AND validated (returns 403/401 without valid key)
 * - namespace must match a declared databases block key in config
 * - id, if provided, must not contain ':' (§2)
 * - Parameterized queries enforced (sql + params separate)
 *
 * Flow: Server SDK → POST /api/sql → Worker → provider-aware executor → JSON
 *
 *  Request body:
 *    { namespace: string, id?: string, sql: string, params?: unknown[] }
 *
 *  Examples:
 *    { namespace: 'shared', sql: 'SELECT * FROM posts WHERE id=?', params: ['abc'] }
 *    { namespace: 'workspace', id: 'ws-456', sql: 'SELECT * FROM documents', params: [] }
 */
import { OpenAPIHono, createRoute, type HonoEnv } from '../lib/hono.js';
import { parseConfig } from '../lib/do-router.js';
import { validateKey, buildConstraintCtx } from '../lib/service-key.js';
import {
  zodDefaultHook,
  sqlBodySchema,
  jsonResponseSchema,
  errorResponseSchema,
} from '../lib/schemas.js';
import { executeProviderAwareSql } from '../lib/provider-aware-sql.js';

export const sqlRoute = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

/**
 * POST /api/sql
 * Body: { namespace: string, id?: string, sql: string, params?: unknown[] }
 */
const executeSql = createRoute({
  operationId: 'executeSql',
  method: 'post',
  path: '/',
  tags: ['admin'],
  summary: 'Execute provider-aware raw SQL',
  request: {
    body: { content: { 'application/json': { schema: sqlBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: 'Query results',
      content: { 'application/json': { schema: jsonResponseSchema } },
    },
    400: {
      description: 'Bad request',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

sqlRoute.openapi(executeSql, async (c) => {
  let body: { namespace?: string; id?: string; sql?: string; params?: unknown[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: 'Invalid JSON body' }, 400);
  }

  const { namespace, id, sql, params } = body;

  if (!namespace || typeof namespace !== 'string') {
    return c.json({ code: 400, message: 'namespace is required' }, 400);
  }
  if (id !== undefined && id !== null && typeof id !== 'string') {
    return c.json({ code: 400, message: 'id must be a string' }, 400);
  }
  if (id && id.includes(':')) {
    return c.json({ code: 400, message: "id must not contain ':' (§2)" }, 400);
  }
  if (!sql || typeof sql !== 'string') {
    return c.json({ code: 400, message: 'sql is required' }, 400);
  }

  // Validate namespace is declared in databases config (§1)
  const config = parseConfig(c.env);
  const dbBlock = config.databases?.[namespace];
  if (!dbBlock) {
    return c.json({ code: 404, message: `Namespace '${namespace}' not found in config` }, 404);
  }
  const isDynamicNamespace = !!(
    dbBlock.instance ||
    dbBlock.access?.canCreate ||
    dbBlock.access?.access
  );
  if (isDynamicNamespace && !id) {
    return c.json(
      { code: 400, message: `id is required for dynamic namespace '${namespace}'` },
      400,
    );
  }

  // Service Key required AND validated
  const { result: skResult } = validateKey(
    c.req.header('X-EdgeBase-Service-Key'),
    `sql:namespace:${namespace}:exec`,
    config,
    c.env,
    undefined,
    buildConstraintCtx(c.env, c.req),
  );
  if (skResult === 'missing') {
    return c.json({ code: 403, message: 'Service Key required to execute SQL' }, 403);
  }
  if (skResult === 'invalid') {
    return c.json({ code: 401, message: 'Unauthorized. Invalid Service Key.' }, 401);
  }

  try {
    const result = await executeProviderAwareSql(
      {
        env: c.env,
        config,
        databaseNamespace: c.env.DATABASE,
      },
      namespace,
      id,
      sql,
      params ?? [],
    );
    return c.json({
      rows: result.rows,
      items: result.rows,
      results: result.rows,
      columns: result.columns,
      rowCount: result.rowCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'SQL execution failed';
    return c.json({ code: 500, message }, 500);
  }
});
