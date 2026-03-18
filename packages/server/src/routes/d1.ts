/**
 * D1 route — POST /api/d1/:database
 *
 * Allows server SDK (with Service Key) to execute raw SQL on user-defined D1 databases.
 * NOT available to client SDK (server-only,).
 *
 * Security:
 * - Config Allowlist: database must be declared in config.d1
 * - Service Key required with scoped validation
 * - Internal D1 binding (AUTH_DB) is never exposed
 * - DDL allowed — Service Key holders are admin-level trusted (#75)
 * - ? bind variables enforced (SQL injection prevention)
 *
 * Flow: Server SDK → POST /api/d1/:database → Worker → D1 binding → JSON
 */
import { OpenAPIHono, createRoute, z, type HonoEnv } from '../lib/hono.js';
import { EdgeBaseError } from '@edge-base/shared';
import { parseConfig } from '../lib/do-router.js';
import { validateKey, buildConstraintCtx } from '../lib/service-key.js';
import { zodDefaultHook, d1BodySchema, jsonResponseSchema, errorResponseSchema } from '../lib/schemas.js';


export const d1Route = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

/**
 * POST /api/d1/:database
 * Body: { query: string, params?: unknown[] }
 */
const executeD1Query = createRoute({
  operationId: 'executeD1Query',
  method: 'post',
  path: '/{database}',
  tags: ['admin'],
  summary: 'Execute raw SQL on D1 database',
  request: {
    params: z.object({ database: z.string() }),
    body: { content: { 'application/json': { schema: d1BodySchema } }, required: true },
  },
  responses: {
    200: { description: 'Query results', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

d1Route.openapi(executeD1Query, async (c) => {
  const nameParam = c.req.param('database')!;

  let body: { query?: string; params?: unknown[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: 'Invalid JSON body' }, 400);
  }

  const { query, params } = body;
  if (!query || typeof query !== 'string') {
    return c.json({ code: 400, message: 'query is required' }, 400);
  }

  // §2 Allowlist: validate database is declared in config
  const config = parseConfig(c.env);
  const d1Config = config.d1?.[nameParam];
  if (!d1Config) {
    return c.json({ code: 404, message: `D1 database '${nameParam}' not found in config.` }, 404);
  }

  // §4 Scope: d1:database:{name}:exec
  const { result: skResult } = validateKey(
    c.req.header('X-EdgeBase-Service-Key'),
    `d1:database:${nameParam}:exec`,
    config,
    c.env,
    undefined,
    buildConstraintCtx(c.env, c.req),
  );
  if (skResult === 'missing') {
    return c.json({ code: 403, message: 'Service Key required to access D1' }, 403);
  }
  if (skResult === 'invalid') {
    return c.json({ code: 401, message: 'Unauthorized. Invalid Service Key.' }, 401);
  }

  // §1 Env type — dynamic binding access via type assertion
  const binding = (c.env as unknown as Record<string, unknown>)[d1Config.binding] as D1Database | undefined;
  if (!binding) {
    return c.json({ code: 500, message: `D1 binding '${d1Config.binding}' not available.` }, 500);
  }

  // Execute D1 query — all SQL allowed (DDL included), ? bind variables enforced
  try {
    const stmt = binding.prepare(query);
    const boundStmt = params && params.length > 0 ? stmt.bind(...params) : stmt;
    const result = await boundStmt.all();
    return c.json({
      results: result.results,
      meta: {
        changes: result.meta?.changes,
        duration: result.meta?.duration,
        rows_read: result.meta?.rows_read,
        rows_written: result.meta?.rows_written,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'D1 query execution failed';
    throw new EdgeBaseError(400, message);
  }
});
