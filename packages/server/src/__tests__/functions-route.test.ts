import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FunctionDefinition } from '@edge-base/shared';
import { OpenAPIHono } from '../lib/hono.js';
import { setConfig } from '../lib/do-router.js';
import {
  clearFunctionRegistry,
  clearMiddlewareRegistry,
  DEFAULT_HTTP_FUNCTION_BODY_LIMIT_BYTES,
  rebuildCompiledRoutes,
  registerFunction,
  registerMiddleware,
  wrapMethodExport,
} from '../lib/functions.js';
import { functionsRoute } from '../routes/functions.js';
import { authMiddleware } from '../middleware/auth.js';
import type { Env } from '../types.js';

class ForeignFunctionError extends Error {
  code: string;
  httpStatus: number;
  details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'FunctionError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      status: this.httpStatus,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    DATABASE: {
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get: () => ({
        fetch: async () => new Response('unexpected database fetch', { status: 500 }),
      }),
    } as unknown as DurableObjectNamespace,
    AUTH: {
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get: () => ({
        fetch: async () => new Response('unexpected auth fetch', { status: 500 }),
      }),
    } as unknown as DurableObjectNamespace,
    AUTH_DB: {} as D1Database,
    KV: {} as KVNamespace,
    ...overrides,
  } as Env;
}

function createApp() {
  const app = new OpenAPIHono();
  app.route('/api/functions', functionsRoute);
  return app;
}

function createAuthenticatedApp() {
  const app = new OpenAPIHono();
  app.use('/api/*', authMiddleware);
  app.route('/api/functions', functionsRoute);
  return app;
}

function createAuthProbeApp() {
  const app = new OpenAPIHono();
  app.use('/api/*', authMiddleware);
  app.all('/api/functions/protocol', (c) => c.json({
    serviceKeyToken: c.get('serviceKeyToken'),
  }));
  return app;
}

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
}

function httpFunction(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  handler: (ctx: Record<string, any>) => Promise<unknown> | unknown,
  path?: string,
): FunctionDefinition {
  return {
    trigger: {
      type: 'http' as const,
      method,
      ...(path ? { path } : {}),
    },
    handler: async (ctx: unknown) => handler(ctx as Record<string, any>),
  };
}

async function invokeFunction(path: string, method = 'GET', envOverrides: Partial<Env> = {}) {
  return createApp().fetch(
    new Request(`http://localhost/api/functions/${path}`, { method }),
    createEnv(envOverrides),
    createExecutionContext(),
  );
}

afterEach(() => {
  clearFunctionRegistry();
  clearMiddlewareRegistry();
  rebuildCompiledRoutes();
  setConfig({});
  vi.unstubAllGlobals();
});

describe('function registry wrapping', () => {
  it('preserves full default-export function definitions with non-HTTP triggers', () => {
    const scheduleFunction: FunctionDefinition = {
      trigger: { type: 'schedule', cron: '*/15 * * * *' },
      handler: async () => ({ ok: true }),
    };

    const wrapped = wrapMethodExport(scheduleFunction, '*');

    expect(wrapped).toBe(scheduleFunction);
    expect(wrapped.trigger).toEqual({ type: 'schedule', cron: '*/15 * * * *' });
  });

  it('preserves custom Bearer auth on method exports', () => {
    const wrapped = wrapMethodExport({
      trigger: { type: 'http' },
      customBearerAuth: true,
      handler: async () => ({ ok: true }),
    }, 'POST');

    expect(wrapped.customBearerAuth).toBe(true);
    expect(wrapped.trigger).toMatchObject({ type: 'http', method: 'POST' });
  });

  it('preserves request body limits on method exports and rejects invalid limits at registration', () => {
    const wrapped = wrapMethodExport({
      trigger: { type: 'http' },
      maxRequestBodyBytes: 4096,
      handler: async () => ({ ok: true }),
    }, 'POST');

    expect(wrapped.maxRequestBodyBytes).toBe(4096);
    expect(() => registerFunction('invalid-limit', {
      ...httpFunction('POST', async () => ({ ok: true })),
      maxRequestBodyBytes: Number.POSITIVE_INFINITY,
    })).toThrow(/maxRequestBodyBytes must be a safe integer/);
  });
});

describe('functionsRoute custom Bearer authentication', () => {
  it('delegates an opaque Bearer token only for an opted-in function', async () => {
    setConfig({ release: true });
    registerFunction('protocol', {
      trigger: { type: 'http', method: 'POST' },
      customBearerAuth: true,
      handler: async (context) => ({
        auth: (context as Record<string, unknown>).auth,
        authorization: ((context as Record<string, any>).request as Request).headers.get('Authorization'),
      }),
    });
    registerFunction('ordinary', httpFunction('POST', async () => ({ ok: true })));
    rebuildCompiledRoutes();

    const env = createEnv({ JWT_USER_SECRET: 'test-user-secret-with-at-least-32-characters' });
    const customResponse = await createAuthenticatedApp().fetch(
      new Request('http://localhost/api/functions/protocol', {
        method: 'POST',
        headers: { Authorization: 'Bearer opaque-protocol-token' },
      }),
      env,
      createExecutionContext(),
    );
    const customBody = await customResponse.json() as Record<string, unknown>;

    expect(customResponse.status).toBe(200);
    expect(customBody.auth).toBeNull();
    expect(customBody.authorization).toBe('Bearer opaque-protocol-token');

    const ordinaryResponse = await createAuthenticatedApp().fetch(
      new Request('http://localhost/api/functions/ordinary', {
        method: 'POST',
        headers: { Authorization: 'Bearer opaque-protocol-token' },
      }),
      env,
      createExecutionContext(),
    );
    expect(ordinaryResponse.status).toBe(401);
    expect(await ordinaryResponse.json()).toMatchObject({ error: 'TOKEN_INVALID' });
  });

  it('keeps configured Bearer Service Keys ahead of custom delegation', async () => {
    setConfig({
      release: true,
      serviceKeys: {
        keys: [{
          kid: 'protocol',
          tier: 'root',
          scopes: ['*'],
          secretSource: 'inline',
          inlineSecret: 'protocol-service-key',
        }],
      },
    });
    registerFunction('protocol', {
      trigger: { type: 'http', method: 'POST' },
      customBearerAuth: true,
      handler: async () => ({ ok: true }),
    });
    rebuildCompiledRoutes();

    const response = await createAuthProbeApp().fetch(
      new Request('http://localhost/api/functions/protocol', {
        method: 'POST',
        headers: { Authorization: 'Bearer protocol-service-key' },
      }),
      createEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ serviceKeyToken: 'protocol-service-key' });
  });
});

describe('functionsRoute FunctionError compatibility', () => {
  it('returns structured JSON when directory middleware throws a foreign FunctionError', async () => {
    registerMiddleware('', async () => {
      throw new ForeignFunctionError('unauthenticated', 'Login required for secure routes.', 401, {
        source: 'middleware',
      });
    });
    registerFunction('secure/profile', {
      trigger: { type: 'http', method: 'GET' },
      handler: async () => ({ ok: true }),
    });
    rebuildCompiledRoutes();

    const response = await createApp().fetch(
      new Request('http://localhost/api/functions/secure/profile', { method: 'GET' }),
      createEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: 'unauthenticated',
      message: 'Login required for secure routes.',
      status: 401,
      details: { source: 'middleware' },
    });
  });

  it('returns structured JSON when a handler throws a foreign FunctionError', async () => {
    registerFunction('call-chain', {
      trigger: { type: 'http', method: 'POST' },
      handler: async () => {
        throw new ForeignFunctionError(
          'failed-precondition',
          'Function call depth exceeded (max 5).',
          412,
          { depth: 6 },
        );
      },
    });
    rebuildCompiledRoutes();

    const response = await createApp().fetch(
      new Request('http://localhost/api/functions/call-chain', { method: 'POST' }),
      createEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(412);
    await expect(response.json()).resolves.toEqual({
      code: 'failed-precondition',
      message: 'Function call depth exceeded (max 5).',
      status: 412,
      details: { depth: 6 },
    });
  });

  it('normalizes caught filesystem exhaustion without exposing the underlying path', async () => {
    registerFunction('disk-full', {
      trigger: { type: 'http', method: 'POST' },
      handler: async () => {
        throw Object.assign(new Error('/data/private/path: no space left on device'), {
          code: 'ENOSPC',
        });
      },
    });
    rebuildCompiledRoutes();

    const response = await createApp().fetch(
      new Request('http://localhost/api/functions/disk-full', { method: 'POST' }),
      createEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(507);
    await expect(response.json()).resolves.toEqual({
      code: 507,
      message: 'Persistence storage is full. Free disk space and retry.',
      slug: 'insufficient-storage',
    });
  });
});

describe('functionsRoute HTTP contracts', () => {
  it('rejects a declared oversized body before the function executes', async () => {
    const handler = vi.fn(async () => ({ shouldNotRun: true }));
    registerFunction('bounded-default', httpFunction('POST', handler));
    rebuildCompiledRoutes();

    const response = await createApp().fetch(
      new Request('http://localhost/api/functions/bounded-default', {
        method: 'POST',
        headers: {
          'Content-Length': String(DEFAULT_HTTP_FUNCTION_BODY_LIMIT_BYTES + 1),
          'Content-Type': 'application/json',
        },
        body: '{}',
      }),
      createEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      code: 'payload-too-large',
      message: `Function request body exceeds the configured limit of ${DEFAULT_HTTP_FUNCTION_BODY_LIMIT_BYTES} bytes.`,
      status: 413,
      details: { maxBytes: DEFAULT_HTTP_FUNCTION_BODY_LIMIT_BYTES },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects the actual streamed byte count before user code can catch or mutate', async () => {
    const committed: string[] = [];
    const handler = vi.fn(async (ctx: Record<string, any>) => {
      await (ctx.request as Request).text().catch(() => 'caught');
      committed.push('must-not-commit');
      return { caught: true };
    });
    registerFunction('bounded-stream', {
      ...httpFunction('POST', handler),
      maxRequestBodyBytes: 8,
    });
    rebuildCompiledRoutes();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('12345'));
        controller.enqueue(encoder.encode('67890'));
        controller.close();
      },
    });

    const response = await createApp().fetch(
      new Request(
        'http://localhost/api/functions/bounded-stream',
        { method: 'POST', body, duplex: 'half' } as RequestInit & { duplex: 'half' },
      ),
      createEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: 'payload-too-large',
      status: 413,
      details: { maxBytes: 8 },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(committed).toEqual([]);
  });

  it('accepts an exact-size body under a per-function override without changing it', async () => {
    registerFunction('bounded-exact', {
      ...httpFunction('POST', async (ctx) => ({
        body: await (ctx.request as Request).text(),
      })),
      maxRequestBodyBytes: 8,
    });
    rebuildCompiledRoutes();

    const response = await createApp().fetch(
      new Request('http://localhost/api/functions/bounded-exact', {
        method: 'POST',
        body: '12345678',
      }),
      createEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ body: '12345678' });
  });

  it('coalesces many tiny stream chunks without changing the accepted body', async () => {
    const chunkCount = 4_096;
    registerFunction('bounded-tiny-chunks', {
      ...httpFunction('POST', async (ctx) => ({
        body: await (ctx.request as Request).text(),
      })),
      maxRequestBodyBytes: chunkCount,
    });
    rebuildCompiledRoutes();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < chunkCount; index += 1) {
          controller.enqueue(Uint8Array.of(97));
        }
        controller.close();
      },
    });

    const response = await createApp().fetch(
      new Request('http://localhost/api/functions/bounded-tiny-chunks', {
        method: 'POST',
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }),
      createEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ body: 'a'.repeat(chunkCount) });
  });

  it('forwards CAPTCHA rejection responses and never executes a protected function', async () => {
    const handler = vi.fn(async () => ({ shouldNotRun: true }));
    setConfig({
      release: true,
      captcha: {
        siteKey: 'synthetic-site-key',
        secretKey: 'synthetic-secret-key',
        hostnames: ['localhost'],
      },
    });
    registerFunction('protected', {
      ...httpFunction('POST', handler),
      captcha: true,
    });
    rebuildCompiledRoutes();

    const missingToken = await invokeFunction('protected', 'POST', {
      TURNSTILE_SECRET: 'synthetic-secret-key',
    });
    expect(missingToken.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const unavailable = await createApp().fetch(
      new Request('http://localhost/api/functions/protected', {
        method: 'POST',
        headers: { 'X-EdgeBase-Captcha-Token': 'synthetic-token' },
      }),
      createEnv({ TURNSTILE_SECRET: 'synthetic-secret-key' }),
      createExecutionContext(),
    );
    expect(unavailable.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
  });

  it('uses the valid fixed Turnstile action and preserves a protected function body', async () => {
    setConfig({
      release: true,
      captcha: {
        siteKey: 'synthetic-site-key',
        secretKey: 'synthetic-secret-key',
        hostnames: ['localhost'],
      },
    });
    const handler = vi.fn(async (ctx: Record<string, any>) => ({
      body: await (ctx.request as Request).json(),
    }));
    registerFunction('a/very/long/route/name/that/must/not/become/a-turnstile-action', {
      ...httpFunction('POST', handler),
      captcha: true,
    });
    rebuildCompiledRoutes();
    const siteverify = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      action: 'function',
      hostname: 'localhost',
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', siteverify);

    const response = await createApp().fetch(
      new Request(
        'http://localhost/api/functions/a/very/long/route/name/that/must/not/become/a-turnstile-action',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-EdgeBase-Captcha-Token': 'synthetic-token',
          },
          body: JSON.stringify({ value: 'preserved' }),
        },
      ),
      createEnv({ TURNSTILE_SECRET: 'synthetic-secret-key' }),
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ body: { value: 'preserved' } });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('applies a protected function body limit before CAPTCHA parsing or the handler', async () => {
    const handler = vi.fn(async () => ({ shouldNotRun: true }));
    setConfig({
      release: true,
      captcha: {
        siteKey: 'synthetic-site-key',
        secretKey: 'synthetic-secret-key',
        hostnames: ['localhost'],
      },
    });
    registerFunction('protected-bounded', {
      ...httpFunction('POST', handler),
      captcha: true,
      maxRequestBodyBytes: 8,
    });
    rebuildCompiledRoutes();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('123456789'));
        controller.close();
      },
    });

    const response = await createApp().fetch(
      new Request('http://localhost/api/functions/protected-bounded', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }),
      createEnv({ TURNSTILE_SECRET: 'synthetic-secret-key' }),
      createExecutionContext(),
    );

    expect(response.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it('serializes plain objects as JSON responses', async () => {
    registerFunction('reports/summary', httpFunction('GET', async () => ({
      ok: true,
      total: 3,
    })));
    rebuildCompiledRoutes();

    const response = await invokeFunction('reports/summary');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ ok: true, total: 3 });
  });

  it('returns text/plain when handler returns a string', async () => {
    registerFunction('health', httpFunction('GET', async () => 'healthy'));
    rebuildCompiledRoutes();

    const response = await invokeFunction('health');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    await expect(response.text()).resolves.toBe('healthy');
  });

  it('returns 204 when handler returns null', async () => {
    registerFunction('empty', httpFunction('POST', async () => null));
    rebuildCompiledRoutes();

    const response = await invokeFunction('empty', 'POST');

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe('');
  });

  it('passes through native Response objects untouched', async () => {
    registerFunction('created', httpFunction('POST', async () => (
      new Response('created-body', {
        status: 201,
        headers: { 'content-type': 'text/plain', 'x-fn': 'direct-response' },
      })
    )));
    rebuildCompiledRoutes();

    const response = await invokeFunction('created', 'POST');

    expect(response.status).toBe(201);
    expect(response.headers.get('x-fn')).toBe('direct-response');
    await expect(response.text()).resolves.toBe('created-body');
  });

  it('executes directory middleware before the handler', async () => {
    const executionOrder: string[] = [];
    registerMiddleware('secure', async () => {
      executionOrder.push('middleware');
    });
    registerFunction('secure/audit', httpFunction('GET', async () => {
      executionOrder.push('handler');
      return { executionOrder };
    }));
    rebuildCompiledRoutes();

    const response = await invokeFunction('secure/audit');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      executionOrder: ['middleware', 'handler'],
    });
  });

  it('supports custom trigger.path params and preserves query strings', async () => {
    registerFunction(
      'shortlink/resolve',
      httpFunction(
        'GET',
        async (ctx) => {
          const requestUrl = new URL(ctx.request.url);
          return {
            code: ctx.params.code,
            target: requestUrl.searchParams.get('target'),
          };
        },
        '/s/:code',
      ),
    );
    rebuildCompiledRoutes();

    const response = await createApp().fetch(
      new Request('http://localhost/api/functions/s/abc123?target=docs', { method: 'GET' }),
      createEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      code: 'abc123',
      target: 'docs',
    });
  });

  it('supports catch-all params at execution time', async () => {
    registerFunction('docs/[...slug]', httpFunction('GET', async (ctx) => ({
      slug: ctx.params.slug,
    })));
    rebuildCompiledRoutes();

    const response = await invokeFunction('docs/guides/getting-started/install');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      slug: 'guides/getting-started/install',
    });
  });

  it('returns 405 with structured JSON when method does not match', async () => {
    registerFunction('users', httpFunction('GET', async () => ({ ok: true })));
    rebuildCompiledRoutes();

    const response = await invokeFunction('users', 'POST');

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      code: 405,
      message: "Method POST not allowed for 'users'.",
    });
  });
});
