import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineConfig } from '@edgebase/shared';
import type { Env } from '../types.js';

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    DATABASE: {
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get: () => ({
        fetch: async () => new Response('unexpected DO fetch', { status: 500 }),
      }),
    } as unknown as DurableObjectNamespace,
    ...overrides,
  } as Env;
}

async function createApp() {
  const { OpenAPIHono } = await import('../lib/hono.js');
  const { authMiddleware } = await import('../middleware/auth.js');
  const { errorHandlerMiddleware } = await import('../middleware/error-handler.js');
  const { rulesMiddleware } = await import('../middleware/rules.js');
  const { tablesRoute } = await import('../routes/tables.js');

  const app = new OpenAPIHono();
  app.use('*', errorHandlerMiddleware);
  app.use('/api/*', authMiddleware);
  app.use('/api/db/*', rulesMiddleware);
  app.route('/api/db', tablesRoute);
  return app;
}

async function setRuntimeConfig(config: Parameters<typeof defineConfig>[0]) {
  const { setConfig } = await import('../lib/do-router.js');
  setConfig(defineConfig(config));
}

describe('provider-backed DB routes preserve upstream service key bypass', () => {
  afterEach(async () => {
    const { setConfig } = await import('../lib/do-router.js');
    setConfig({});
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('passes scoped bearer service key bypass into the D1 handler', async () => {
    const handleD1Request = vi.fn().mockImplementation((c) =>
      new Response(JSON.stringify({ isServiceKey: c.get('isServiceKey' as never) === true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    vi.doMock('../lib/d1-handler.js', () => ({ handleD1Request }));
    const app = await createApp();

    await setRuntimeConfig({
      release: true,
      databases: {
        shared: {
          provider: 'd1',
          tables: { users: {} },
        },
      },
      serviceKeys: {
        keys: [
          {
            kid: 'd1-scoped',
            tier: 'scoped',
            scopes: ['db:table:users:read'],
            secretSource: 'inline',
            inlineSecret: 'jb_d1-scoped_payload',
          },
        ],
      },
    });

    const response = await app.request('/api/db/shared/tables/users', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer jb_d1-scoped_payload',
      },
    }, createEnv());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ isServiceKey: true });
    expect(handleD1Request).toHaveBeenCalledTimes(1);
  });

  it('passes constrained scoped service key bypass into the PostgreSQL handler', async () => {
    const handlePgRequest = vi.fn().mockImplementation((c) =>
      new Response(JSON.stringify({ isServiceKey: c.get('isServiceKey' as never) === true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    vi.doMock('../lib/postgres-handler.js', () => ({ handlePgRequest }));
    const app = await createApp();

    await setRuntimeConfig({
      release: true,
      databases: {
        shared: {
          provider: 'postgres',
          tables: { users: {} },
        },
      },
      serviceKeys: {
        keys: [
          {
            kid: 'pg-scoped',
            tier: 'scoped',
            scopes: ['db:table:users:read'],
            secretSource: 'inline',
            inlineSecret: 'jb_pg-scoped_payload',
            constraints: {
              env: ['prod'],
            },
          },
        ],
      },
    });

    const response = await app.request('/api/db/shared/tables/users', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer jb_pg-scoped_payload',
      },
    }, createEnv({
      ENVIRONMENT: 'prod',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ isServiceKey: true });
    expect(handlePgRequest).toHaveBeenCalledTimes(1);
  });
});
