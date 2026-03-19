/**
 * Functions Route - HTTP trigger handler with file-system routing.
 *
 * Handles requests to /api/functions/:functionName
 * Supports:
 * - Static routes: /api/functions/hello
 * - Dynamic params: /api/functions/users/abc123/profile
 * - Catch-all: /api/functions/docs/a/b/c
 * - Directory middleware (_middleware.ts)
 * - FunctionError structured error responses
 */
import { OpenAPIHono, type HonoEnv } from '../lib/hono.js';
import {
  matchRoute,
  routeExistsForPath,
  buildFunctionContext,
  getMiddlewareChain,
  getWorkerUrl,
} from '../lib/functions.js';
import { parseConfig } from '../lib/do-router.js';
import { resolveRootServiceKey } from '../lib/service-key.js';
import type { AuthContext } from '../lib/functions.js';
import { captchaMiddleware } from '../middleware/captcha-verify.js';
import { FunctionError } from '@edge-base/shared';

function isFunctionErrorLike(
  value: unknown,
): value is {
  code: string;
  message: string;
  httpStatus?: number;
  status?: number;
  details?: Record<string, unknown>;
  toJSON?: () => unknown;
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    (typeof candidate.httpStatus === 'number' || typeof candidate.status === 'number')
  );
}

export const functionsRoute = new OpenAPIHono<HonoEnv>();

/**
 * Dynamic HTTP trigger handler with pattern matching.
 */
functionsRoute.all('/:functionName{.+}', async (c) => {
  const functionName = c.req.param('functionName');
  const method = c.req.method.toUpperCase();

  // Match route with pattern matching (handles [param], [...slug], static routes)
  const matched = matchRoute(functionName, method);

  if (!matched) {
    // Check if route exists but method is wrong → 405
    if (routeExistsForPath(functionName)) {
      return c.json(
        { code: 405, message: `Method ${method} not allowed for '${functionName}'.` },
        405,
      );
    }
    return c.json(
      { code: 404, message: `Function '${functionName}' not found.` },
      404,
    );
  }

  const config = parseConfig(c.env);
  const serviceKey = resolveRootServiceKey(config, c.env);

  // Auth context from middleware (set by authMiddleware earlier in chain)
  const auth = (c.get('auth' as never) || null) as AuthContext | null;

  const workerUrl = getWorkerUrl(c.req.url, c.env) ?? 'http://localhost';

  const ctx = buildFunctionContext({
    request: c.req.raw,
    auth,
    databaseNamespace: c.env.DATABASE,
    authNamespace: c.env.AUTH,
    d1Database: c.env.AUTH_DB,
    kvNamespace: c.env.KV,
    env: c.env as never,
    executionCtx: c.executionCtx as never,
    config,
    serviceKey,
    workerUrl,
    params: matched.params,
  });

  // Captcha check for functions with captcha: true
  if (matched.route.definition.captcha) {
    const captchaMw = captchaMiddleware(`function:${matched.route.name}`);
    await captchaMw(c, async () => {});
    if (c.res && c.res.status === 403) {
      return c.res;
    }
  }

  try {
    // Execute middleware chain (root → nested → handler)
    const middlewares = getMiddlewareChain(matched.route.name);
    for (const mw of middlewares) {
      await mw(ctx);
    }

    // Execute handler
    const result = await matched.route.definition.handler(ctx);

    // If handler returns a Response, use it directly
    if (result instanceof Response) {
      return result;
    }

    // If handler returns an object, JSON-serialize it
    if (result && typeof result === 'object') {
      return c.json(result);
    }

    // If handler returns a string, return as text
    if (typeof result === 'string') {
      return c.text(result);
    }

    // Default: 204 No Content
    return c.body(null, 204);
  } catch (err: unknown) {
    // Handle FunctionError specially — return structured JSON
    if (err instanceof FunctionError) {
      return c.json(err.toJSON(), err.httpStatus as 400);
    }

    // Cloudflare/local dev can bundle user functions with a second copy of
    // @edge-base/shared, so instanceof is not reliable across that boundary.
    if (isFunctionErrorLike(err)) {
      const status = err.httpStatus ?? err.status ?? 500;
      const body =
        typeof err.toJSON === 'function'
          ? err.toJSON()
          : {
              code: err.code,
              message: err.message,
              status,
              ...(err.details ? { details: err.details } : {}),
            };
      return c.json(body, status as 400);
    }

    console.error(`[EdgeBase] HTTP function '${matched.route.name}' error:`, err);
    const release = parseConfig(c.env)?.release ?? false;
    return c.json({
      code: 500,
      message: 'Function execution failed.',
      ...(!release && {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
    }, 500);
  }
});
