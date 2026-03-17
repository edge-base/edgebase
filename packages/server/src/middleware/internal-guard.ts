import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types.js';

type HonoEnv = { Bindings: Env };

/**
 * Internal guard middleware.
 * Blocks ALL external access to /internal/* endpoints unconditionally.
 *
 * SECURITY: The X-EdgeBase-Internal header MUST NOT be trusted from external
 * requests — any client can set arbitrary headers. Workers cannot strip
 * incoming headers (Request.headers is immutable), so we simply block all
 * /internal/* requests at this middleware regardless of headers.
 *
 * DO-to-DO calls use the Worker's own internal routing (same-process), not the
 * public /internal/* path, so legitimate internal calls never reach this guard.
 */
export const internalGuardMiddleware: MiddlewareHandler<HonoEnv> = async (c) => {
  return c.json(
    {
      code: 403,
      message: 'Access denied. Internal endpoints are not publicly accessible.',
    },
    403,
  );
};
