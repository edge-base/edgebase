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
  httpFunctionBodyLimit,
} from '../lib/functions.js';
import { parseConfig } from '../lib/do-router.js';
import { resolveRootServiceKey } from '../lib/service-key.js';
import { normalizeDatabaseError } from '../lib/errors.js';
import type { AuthContext } from '../lib/functions.js';
import { captchaMiddleware } from '../middleware/captcha-verify.js';
import { FunctionError } from '@edge-base/shared';

class FunctionRequestBodyLimitError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Function request body exceeds ${maxBytes} bytes.`);
    this.name = 'FunctionRequestBodyLimitError';
  }
}

function declaredRequestBodyBytes(request: Request): number | null {
  const raw = request.headers.get('content-length')?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : Number.POSITIVE_INFINITY;
}

function functionPayloadTooLarge(maxBytes: number): Response {
  return Response.json(
    {
      code: 'payload-too-large',
      message: `Function request body exceeds the configured limit of ${maxBytes} bytes.`,
      status: 413,
      details: { maxBytes },
    },
    { status: 413 },
  );
}

async function bufferFunctionRequestBody(request: Request, maxBytes: number): Promise<Request> {
  if (!request.body) return request;
  const reader = request.body.getReader();
  const slabs: Array<{ bytes: Uint8Array; used: number }> = [];
  const slabBytes = 64 * 1024;
  let consumedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    consumedBytes += value.byteLength;
    if (consumedBytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FunctionRequestBodyLimitError(maxBytes);
    }
    let sourceOffset = 0;
    while (sourceOffset < value.byteLength) {
      let slab = slabs.at(-1);
      if (!slab || slab.used === slab.bytes.byteLength) {
        const remaining = maxBytes - (consumedBytes - value.byteLength + sourceOffset);
        slab = {
          bytes: new Uint8Array(Math.min(slabBytes, Math.max(1, remaining))),
          used: 0,
        };
        slabs.push(slab);
      }
      const copyBytes = Math.min(
        slab.bytes.byteLength - slab.used,
        value.byteLength - sourceOffset,
      );
      slab.bytes.set(value.subarray(sourceOffset, sourceOffset + copyBytes), slab.used);
      slab.used += copyBytes;
      sourceOffset += copyBytes;
    }
  }
  const bytes = new Uint8Array(consumedBytes);
  let offset = 0;
  for (const slab of slabs) {
    bytes.set(slab.bytes.subarray(0, slab.used), offset);
    offset += slab.used;
  }
  return new Request(
    request,
    { body: bytes, duplex: 'half' } as RequestInit & { duplex: 'half' },
  );
}

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

  const maxRequestBodyBytes = httpFunctionBodyLimit(matched.route.definition);
  const declaredBodyBytes = declaredRequestBodyBytes(c.req.raw);
  if (declaredBodyBytes !== null && declaredBodyBytes > maxRequestBodyBytes) {
    return functionPayloadTooLarge(maxRequestBodyBytes);
  }

  const config = parseConfig(c.env);
  const serviceKey = resolveRootServiceKey(config, c.env);

  // Auth context from middleware (set by authMiddleware earlier in chain)
  const auth = (c.get('auth' as never) || null) as AuthContext | null;

  const workerUrl = getWorkerUrl(c.req.url, c.env) ?? 'http://localhost';

  let functionRequest: Request;
  try {
    // Validate and materialize at most the configured bound before any user
    // middleware, CAPTCHA body parsing, or handler side effect can run. A
    // catch inside user code can therefore never turn an oversized request
    // into a committed mutation followed by a transport-level 413.
    functionRequest = await bufferFunctionRequestBody(c.req.raw, maxRequestBodyBytes);
  } catch (error) {
    if (error instanceof FunctionRequestBodyLimitError) {
      return functionPayloadTooLarge(maxRequestBodyBytes);
    }
    throw error;
  }

  // Captcha check for functions with captcha: true
  if (matched.route.definition.captcha) {
    const captchaResponse = await captchaMiddleware('function', functionRequest)(c, async () => {});
    // Manually composed Hono middleware returns its rejection Response. Always
    // forward it (403 verification failures and 503 fail-closed outages alike)
    // instead of inspecting only one status on c.res and continuing to user code.
    if (captchaResponse instanceof Response) return captchaResponse;
  }

  try {
    const ctx = buildFunctionContext({
      request: functionRequest,
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
    if (err instanceof FunctionRequestBodyLimitError) {
      return functionPayloadTooLarge(maxRequestBodyBytes);
    }
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

    const normalizedStorageError = normalizeDatabaseError(err);
    if (normalizedStorageError) {
      return c.json(normalizedStorageError.toJSON(), normalizedStorageError.code as 400);
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
