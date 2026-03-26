import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types.js';
import { EdgeBaseError } from '@edge-base/shared';
import { normalizeDatabaseError } from '../lib/errors.js';

type HonoEnv = { Bindings: Env };

/**
 * Global error handler middleware.
 * Catches all errors and returns a standardized response.
 */
export const errorHandlerMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  try {
    await next();
  } catch (err) {
    if (err instanceof EdgeBaseError) {
      return c.json(err.toJSON(), err.code as 400);
    }

    // Hono HTTPException (thrown by @hono/zod-openapi validators on malformed JSON, etc.)
    if (err instanceof HTTPException) {
      return c.json({ code: err.status, message: err.message, slug: 'validation-failed' }, err.status as 400);
    }

    // Duck-type fallback for cross-module instanceof failures (Cloudflare Workers)
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>;
      if (typeof e.code === 'number' && e.code >= 400 && e.code < 600 && typeof e.message === 'string') {
        const body: { code: number; message: string; slug?: string; data?: unknown } = { code: e.code, message: e.message };
        if (typeof e.slug === 'string') body.slug = e.slug;
        if (e.data) body.data = e.data;
        return c.json(body, e.code as 400);
      }
    }

    const normalizedDbError = normalizeDatabaseError(err);
    if (normalizedDbError) {
      return c.json(normalizedDbError.toJSON(), normalizedDbError.code as 400);
    }

    // Unexpected error
    console.error('Unhandled error:', err);

    return c.json(
      {
        code: 500,
        message: `Internal server error while handling '${c.req.path}'. Check the worker logs for the original exception.`,
        slug: 'internal-error',
      },
      500,
    );
  }
};
