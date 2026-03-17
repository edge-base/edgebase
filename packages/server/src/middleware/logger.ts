/**
 * Request logging middleware.
 *
 * Records method, path, status, duration, userId, and enriched analytics
 * fields (category, subcategory, target, operation, region, sizes) for
 * every request. Uses LogWriter adapter for environment-aware storage.
 */
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types.js';
import { createLogWriter } from '../lib/log-writer.js';
import { parseRoute } from '../lib/route-parser.js';

type HonoEnv = { Bindings: Env };
type LogFieldOverrides = Partial<{
  category: string;
  subcategory: string;
  target1: string;
  target2: string;
  operation: string;
  region: string;
  requestSize: number;
  responseSize: number;
  resultCount: number;
  userId: string;
}>;

function resolveRequestPath(c: {
  req: {
    path?: string;
    url: string;
  };
}): string {
  if (typeof c.req.path === 'string' && c.req.path.length > 0) {
    return c.req.path;
  }

  try {
    return new URL(c.req.url, 'http://edgebase.local').pathname;
  } catch {
    return '/';
  }
}

export const loggerMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const start = Date.now();

  // Pre-compute route classification before response
  const path = resolveRequestPath(c);
  const method = c.req.method;
  const route = parseRoute(method, path);

  // Capture request size from Content-Length header
  const requestSize = parseInt(c.req.header('content-length') || '0', 10) || 0;

  await next();

  const duration = Date.now() - start;
  const auth = c.get('auth' as never) as { id: string } | null | undefined;

  // Extract region from Cloudflare cf object or cf-ray header
  let region = '';
  try {
    const cf = (c.req.raw as unknown as { cf?: { colo?: string } }).cf;
    if (cf?.colo) {
      region = cf.colo;
    }
  } catch {
    // cf object not available (non-CF environment)
  }
  if (!region) {
    // Fallback: extract datacenter code from CF-Ray header (e.g., "abc123-ICN" → "ICN")
    const cfRay = c.req.header('cf-ray');
    if (cfRay) {
      const parts = cfRay.split('-');
      if (parts.length >= 2) {
        region = parts[parts.length - 1];
      }
    }
  }

  // Capture response size from Content-Length header
  const responseSize = parseInt(c.res.headers.get('content-length') || '0', 10) || 0;
  const overrides = (c.get('logFields' as never) ?? {}) as LogFieldOverrides;

  // Get execution context for non-blocking writes
  let executionCtx: { waitUntil: (promise: Promise<unknown>) => void } | undefined;
  try {
    executionCtx = c.executionCtx;
  } catch {
    // No execution context (unit tests)
  }

  const logger = createLogWriter(
    (c.env || {}) as unknown as Record<string, unknown>,
    executionCtx,
  );

  const entry = {
    method,
    path,
    status: c.res.status,
    duration,
    userId: overrides.userId ?? auth?.id,
    timestamp: Date.now(),
    // Enriched analytics fields
    category: overrides.category ?? route.category,
    subcategory: overrides.subcategory ?? route.subcategory,
    target1: overrides.target1 ?? route.target1,
    target2: overrides.target2 ?? route.target2,
    operation: overrides.operation ?? route.operation,
    region: overrides.region ?? region,
    requestSize: overrides.requestSize ?? requestSize,
    responseSize: overrides.responseSize ?? responseSize,
    resultCount: overrides.resultCount ?? 0,
  };

  // Fire-and-forget — don't block response
  if (executionCtx) {
    executionCtx.waitUntil(
      Promise.resolve().then(() => logger.write(entry)),
    );
  } else {
    // Unit test environment or no execution context — write synchronously
    logger.write(entry);
  }
};
