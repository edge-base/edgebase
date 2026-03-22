import { afterEach, describe, expect, it } from 'vitest';
import type { FunctionDefinition } from '@edge-base/shared';
import { OpenAPIHono } from '../lib/hono.js';
import { setConfig } from '../lib/do-router.js';
import {
  clearFunctionRegistry,
  clearMiddlewareRegistry,
  rebuildCompiledRoutes,
  registerFunction,
  registerMiddleware,
} from '../lib/functions.js';
import { functionsRoute } from '../routes/functions.js';
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

async function invokeFunction(path: string, method = 'GET') {
  return createApp().fetch(
    new Request(`http://localhost/api/functions/${path}`, { method }),
    createEnv(),
    createExecutionContext(),
  );
}

afterEach(() => {
  clearFunctionRegistry();
  clearMiddlewareRegistry();
  rebuildCompiledRoutes();
  setConfig({});
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
});

describe('functionsRoute HTTP contracts', () => {
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
