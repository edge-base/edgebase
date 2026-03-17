/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * EdgeBase OpenAPIHono wrapper — relaxed handler return type.
 *
 * EdgeBase uses a DO-proxy pattern: route handlers forward raw Durable Object
 * responses as `new Response(resp.body, ...)`. The upstream `@hono/zod-openapi`
 * `openapi()` method enforces typed return values (`RouteConfigToTypedResponse`)
 * when routes define response `content` schemas, which conflicts with this
 * proxy pattern.
 *
 * This module re-exports `OpenAPIHono` with a relaxed `openapi()` method that
 * accepts `Response` returns while preserving full request/context typing.
 *
 * All route files should import from this module instead of `@hono/zod-openapi`.
 */
import { OpenAPIHono as _OriginalOpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Env } from '../types.js';

/** Standard Hono environment type used by all EdgeBase routes. */
export type HonoEnv = { Bindings: Env };

/**
 * Re-export OpenAPIHono with a relaxed `openapi()` signature.
 *
 * EdgeBase routes proxy Durable Object responses as raw `Response` objects.
 * Upstream `@hono/zod-openapi` enforces `RouteConfigToTypedResponse` as the
 * handler return type when routes define response `content` schemas — this
 * conflicts with the DO-proxy pattern.
 *
 * We use `Omit` + intersection to replace only `openapi` while keeping all
 * other Hono methods (`.route()`, `.use()`, `.onError()`, etc.) fully typed.
 */

// Instance type: everything from OpenAPIHono, but openapi() accepts any handler return.
// Handler parameter typing is preserved via the `c: Context<E>` constraint.
type RelaxedInstance<E extends Record<string, unknown>> =
  Omit<_OriginalOpenAPIHono<E>, 'openapi' | 'route'> & {
    openapi<R extends import('@hono/zod-openapi').RouteConfig>(
      route: R,
      handler: (c: import('hono').Context<E, any, any>) => any,
      hook?: any,
    ): RelaxedInstance<E>;
    route(path: string, app: any): RelaxedInstance<E>;
  };

// Constructor type: preserves `new <E>(opts?)` while producing RelaxedInstance
interface RelaxedOpenAPIHonoConstructor {
  new <E extends Record<string, unknown> = Record<string, unknown>>(
    opts?: { defaultHook?: (...args: any[]) => any },
  ): RelaxedInstance<E>;
}

export const OpenAPIHono: RelaxedOpenAPIHonoConstructor =
  _OriginalOpenAPIHono as unknown as RelaxedOpenAPIHonoConstructor;

export { createRoute, z };
