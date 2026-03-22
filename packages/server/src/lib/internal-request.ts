import type { Context } from 'hono';
import type { HonoEnv } from './hono.js';
import type { Env } from '../types.js';

export function isTrustedInternalRequestUrl(_url: string): boolean {
  // Requests are only trusted when the runtime marks them internal via context.
  // URL hosts (including 'do' / 'internal') can be spoofed in self-hosted or proxy setups.
  return false;
}

export function isTrustedInternalContext(c: Pick<Context<HonoEnv>, 'get' | 'req'>): boolean {
  return c.get('isInternalRequest' as never) === true;
}

export function buildInternalHandlerContext(options: {
  env: Env;
  request: Request;
  body?: Record<string, unknown>;
  executionCtx?: ExecutionContext;
}): Context<HonoEnv> {
  const fallbackExecutionCtx = options.executionCtx ??
    ({ waitUntil() {} } as unknown as ExecutionContext);
  const url = new URL(options.request.url);

  return {
    env: options.env,
    executionCtx: fallbackExecutionCtx,
    req: {
      raw: options.request,
      url: options.request.url,
      header: (name: string) => options.request.headers.get(name) ?? undefined,
      json: async () => options.body ?? {},
      query: (name?: string) =>
        name
          ? url.searchParams.get(name) ?? undefined
          : Object.fromEntries(url.searchParams.entries()),
    },
    get(key: string) {
      if (key === 'auth') return null;
      if (key === 'isServiceKey') {
        return options.request.headers.get('X-Is-Service-Key') === 'true';
      }
      if (key === 'isInternalRequest') return true;
      return undefined;
    },
    json(payload: unknown, status = 200) {
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  } as unknown as Context<HonoEnv>;
}
