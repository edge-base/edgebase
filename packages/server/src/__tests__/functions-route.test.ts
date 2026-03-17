import { afterEach, describe, expect, it } from 'vitest';
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
