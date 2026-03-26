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
import {
  formatDbTargetValidationIssue,
  parseConfig,
  resolveDbTarget,
} from '../lib/do-router.js';
import { validateKey, buildConstraintCtx } from '../lib/service-key.js';
import {
  zodDefaultHook,
  sqlBodySchema,
  jsonResponseSchema,
  errorResponseSchema,
} from '../lib/schemas.js';
import { executeProviderAwareSql } from '../lib/provider-aware-sql.js';

export const sqlRoute = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

function invalidSqlJsonMessage(): string {
  return 'Invalid JSON body for SQL execution. Send application/json with { namespace, sql, params? }.';
}

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
    404: {
      description: 'Namespace not found',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

sqlRoute.openapi(executeSql, async (c) => {
  let body: { namespace?: string; id?: string; sql?: string; params?: unknown[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: invalidSqlJsonMessage() }, 400);
  }

  const { namespace, id, sql, params } = body;

  if (!namespace || typeof namespace !== 'string') {
    return c.json({ code: 400, message: "Missing required field 'namespace' for SQL execution." }, 400);
  }
  if (id !== undefined && id !== null && typeof id !== 'string') {
    return c.json({ code: 400, message: "Field 'id' must be a string when provided for SQL execution." }, 400);
  }
  if (!sql || typeof sql !== 'string') {
    return c.json({ code: 400, message: "Missing required field 'sql' for SQL execution." }, 400);
  }

  // Validate namespace is declared in databases config (§1)
  const config = parseConfig(c.env);
  const target = resolveDbTarget(config, namespace, id);
  if (!target.ok) {
    return c.json(
      {
        code: target.status,
        message: formatDbTargetValidationIssue(target.issue, namespace, {
          namespaceLabel: 'Namespace',
          instanceIdLabel: 'id',
          includeSectionRef: target.issue === 'instance_id_invalid',
        }),
      },
      target.status,
    );
  }
  const { instanceId } = target.value;

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
    return c.json({ code: 403, message: `X-EdgeBase-Service-Key is required to execute SQL for database namespace '${namespace}'.` }, 403);
  }
  if (skResult === 'invalid') {
    return c.json({ code: 401, message: `Invalid X-EdgeBase-Service-Key for SQL execution in database namespace '${namespace}'.` }, 401);
  }

  try {
    const result = await executeProviderAwareSql(
      {
        env: c.env,
        config,
        databaseNamespace: c.env.DATABASE,
      },
      namespace,
      instanceId,
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
