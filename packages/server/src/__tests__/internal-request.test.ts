import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';
import type { HonoEnv } from '../lib/hono.js';
import {
  buildInternalHandlerContext,
  isTrustedInternalContext,
  isTrustedInternalRequestUrl,
} from '../lib/internal-request.js';
import type { Env } from '../types.js';

function makeContext(
  url: string,
  isInternalRequest = false,
): Pick<Context<HonoEnv>, 'get' | 'req'> {
  return {
    get(key: string) {
      return key === 'isInternalRequest' ? isInternalRequest : undefined;
    },
    req: { url } as Context<HonoEnv>['req'],
  };
}

describe('internal request helpers', () => {
  it('isTrustedInternalRequestUrl only trusts worker-internal hosts', () => {
    expect(isTrustedInternalRequestUrl('http://internal/api/db/shared')).toBe(true);
    expect(isTrustedInternalRequestUrl('http://do/internal/functions/reindex')).toBe(true);
    expect(isTrustedInternalRequestUrl('http://localhost:8787/api/db/shared')).toBe(false);
    expect(isTrustedInternalRequestUrl('not-a-url')).toBe(false);
  });

  it('isTrustedInternalContext accepts explicit internal flags or trusted internal hosts', () => {
    expect(isTrustedInternalContext(makeContext('http://localhost/api/db/shared', true))).toBe(true);
    expect(isTrustedInternalContext(makeContext('http://do/api/db/shared'))).toBe(true);
    expect(isTrustedInternalContext(makeContext('http://example.com/api/db/shared'))).toBe(false);
  });

  it('buildInternalHandlerContext marks requests as internal and exposes request helpers', async () => {
    const request = new Request('http://do/api/functions/feed-summary?limit=5', {
      method: 'POST',
      headers: { 'X-Test': 'yes' },
    });

    const ctx = buildInternalHandlerContext({
      env: {} as Env,
      request,
      body: { ok: true },
    });

    expect(ctx.req.url).toBe(request.url);
    expect(ctx.req.header('X-Test')).toBe('yes');
    await expect(ctx.req.json()).resolves.toEqual({ ok: true });
    expect(ctx.req.query('limit')).toBe('5');
    expect(ctx.req.query()).toEqual({ limit: '5' });
    expect(ctx.get('isInternalRequest' as never)).toBe(true);
    expect(ctx.get('auth' as never)).toBeNull();
    expect(ctx.get('isServiceKey' as never)).toBe(false);
    expect(typeof ctx.executionCtx.waitUntil).toBe('function');

    const response = ctx.json({ ok: true }, 201);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('buildInternalHandlerContext reflects explicit X-Is-Service-Key for privileged internal calls', () => {
    const request = new Request('http://internal/api/db/shared/tables/users', {
      headers: { 'X-Is-Service-Key': 'true' },
    });

    const ctx = buildInternalHandlerContext({
      env: {} as Env,
      request,
    });

    expect(ctx.get('isInternalRequest' as never)).toBe(true);
    expect(ctx.get('isServiceKey' as never)).toBe(true);
  });
});
