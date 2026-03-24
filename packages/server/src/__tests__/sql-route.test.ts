import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAPIHono, type HonoEnv } from '../lib/hono.js';
import { sqlRoute } from '../routes/sql.js';
import { setConfig } from '../lib/do-router.js';
import { defineConfig } from '@edge-base/shared';
import type { Env } from '../types.js';
import { executeDoSql } from '../lib/do-sql.js';

function createApp() {
  const app = new OpenAPIHono<HonoEnv>();
  app.route('/api/sql', sqlRoute);
  return app;
}

describe('sql route', () => {
  afterEach(() => {
    setConfig({});
  });

  it('rejects unconfigured shared namespace instead of treating it as implicit', async () => {
    setConfig(
      defineConfig({
        databases: {
          app: {
            tables: {
              posts: { schema: { title: { type: 'string' } } },
            },
          },
        },
      }),
    );

    const app = createApp();
    const response = await app.request(
      '/api/sql',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace: 'shared', sql: 'SELECT 1' }),
      },
      {} as Env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 404,
      message: "Namespace 'shared' not found in config",
    });
  });

  it('rejects ids for single-instance namespaces before touching any backend', async () => {
    setConfig(
      defineConfig({
        databases: {
          shared: {
            tables: {
              posts: { schema: { title: { type: 'string' } } },
            },
          },
        },
        serviceKeys: {
          keys: [
            {
              kid: 'root',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'inline',
              inlineSecret: 'sk-root',
            },
          ],
        },
      }),
    );

    const env = {
      DATABASE: {
        idFromName: vi.fn(),
        get: vi.fn(),
      },
      DB_D1_SHARED: {
        prepare: vi.fn(),
      },
    } as unknown as Env;

    const app = createApp();
    const response = await app.request(
      '/api/sql',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EdgeBase-Service-Key': 'sk-root',
        },
        body: JSON.stringify({
          namespace: 'shared',
          id: 'shadow',
          sql: 'SELECT 1',
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 400,
      message: "id is not allowed for single-instance namespace 'shared'",
    });
    expect(
      (env as unknown as { DATABASE: { get: ReturnType<typeof vi.fn> } }).DATABASE.get,
    ).not.toHaveBeenCalled();
    expect(
      (env as unknown as { DB_D1_SHARED: { prepare: ReturnType<typeof vi.fn> } }).DB_D1_SHARED
        .prepare,
    ).not.toHaveBeenCalled();
  });

  it('retries dynamic DO SQL after create handshake and forwards the DO name', async () => {
    setConfig(
      defineConfig({
        databases: {
          workspace: {
            instance: true,
            tables: {
              members: { schema: { userId: { type: 'string' } } },
            },
          },
        },
        serviceKeys: {
          keys: [
            {
              kid: 'root',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'inline',
              inlineSecret: 'sk-root',
            },
          ],
        },
      }),
    );

    const stub = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ needsCreate: true, namespace: 'workspace', id: 'ws-1' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ rows: [{ total: 1 }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
    };
    const env = {
      DATABASE: {
        idFromName: vi.fn().mockReturnValue('do-id'),
        get: vi.fn().mockReturnValue(stub),
      },
    } as unknown as Env;

    const app = createApp();
    const response = await app.request(
      '/api/sql',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EdgeBase-Service-Key': 'sk-root',
        },
        body: JSON.stringify({
          namespace: 'workspace',
          id: 'ws-1',
          sql: 'SELECT COUNT(*) AS total FROM members',
          params: [],
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rows: [{ total: 1 }],
      items: [{ total: 1 }],
      results: [{ total: 1 }],
    });
    expect(stub.fetch).toHaveBeenCalledTimes(2);
    const firstRequest = stub.fetch.mock.calls[0]?.[0] as Request;
    const secondRequest = stub.fetch.mock.calls[1]?.[0] as Request;
    expect(firstRequest.headers.get('X-DO-Name')).toBe('workspace:ws-1');
    expect(firstRequest.headers.get('X-DO-Create-Authorized')).toBeNull();
    await expect(firstRequest.json()).resolves.toEqual({
      query: 'SELECT COUNT(*) AS total FROM members',
      params: [],
    });
    expect(secondRequest.headers.get('X-DO-Name')).toBe('workspace:ws-1');
    expect(secondRequest.headers.get('X-DO-Create-Authorized')).toBe('1');
  });

  it('uses D1 run() for non-SELECT SQL so schema mutations actually execute', async () => {
    setConfig(
      defineConfig({
        databases: {
          shared: {
            tables: {
              posts: { schema: { title: { type: 'string' } } },
            },
          },
        },
        serviceKeys: {
          keys: [
            {
              kid: 'root',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'inline',
              inlineSecret: 'sk-root',
            },
          ],
        },
      }),
    );

    const stmt: {
      bind: ReturnType<typeof vi.fn>;
      all: ReturnType<typeof vi.fn>;
      run: ReturnType<typeof vi.fn>;
    } = {
      bind: vi.fn(() => stmt),
      all: vi.fn().mockResolvedValue({ results: [] }),
      run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
    };
    const env = {
      DB_D1_SHARED: {
        prepare: vi.fn(() => stmt),
      },
    } as unknown as Env;

    const app = createApp();
    const response = await app.request(
      '/api/sql',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EdgeBase-Service-Key': 'sk-root',
        },
        body: JSON.stringify({
          namespace: 'shared',
          sql: 'ALTER TABLE "posts" RENAME TO "articles"',
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rows: [],
      rowCount: 0,
    });
    expect(
      (env as unknown as { DB_D1_SHARED: { prepare: ReturnType<typeof vi.fn> } }).DB_D1_SHARED
        .prepare,
    ).toHaveBeenCalledWith('ALTER TABLE "posts" RENAME TO "articles"');
    expect(stmt.run).toHaveBeenCalledTimes(1);
    expect(stmt.all).not.toHaveBeenCalled();
  });

  it.each(['postgres', 'neon'] as const)(
    'routes %s raw SQL through the provider-aware executor and normalizes ? placeholders',
    async (provider) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              columns: ['literal', 'total'],
              rows: [{ literal: '?', total: 3 }],
              rowCount: 1,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );
      vi.stubGlobal('fetch', fetchMock);

      setConfig(
        defineConfig({
          databases: {
            shared: {
              provider,
              tables: {
                posts: { schema: { title: { type: 'string' } } },
              },
            },
          },
          serviceKeys: {
            keys: [
              {
                kid: 'root',
                tier: 'root',
                scopes: ['*'],
                secretSource: 'inline',
                inlineSecret: 'sk-root',
              },
            ],
          },
        }),
      );

      const env = {
        DATABASE: {
          idFromName: vi.fn().mockReturnValue('do-id'),
          get: vi.fn(),
        },
        EDGEBASE_DEV_SIDECAR_PORT: '8788',
        JWT_ADMIN_SECRET: 'jwt-secret',
        DB_POSTGRES_SHARED_URL: 'postgres://edgebase:test@localhost/shared',
      } as unknown as Env;

      const app = createApp();
      const response = await app.request(
        '/api/sql',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-EdgeBase-Service-Key': 'sk-root',
          },
          body: JSON.stringify({
            namespace: 'shared',
            sql: "SELECT '?' AS literal, COUNT(*) AS total FROM posts WHERE title = ?",
            params: ['owner'],
          }),
        },
        env,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        rows: [{ literal: '?', total: 3 }],
        rowCount: 1,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body ?? '{}'))).toEqual({
        namespace: 'shared',
        sql: "SELECT '?' AS literal, COUNT(*) AS total FROM posts WHERE title = $1",
        params: ['owner'],
      });
      expect(
        (env as unknown as { DATABASE: { get: ReturnType<typeof vi.fn> } }).DATABASE.get,
      ).not.toHaveBeenCalled();
    },
  );

  it('executeDoSql retries the create handshake before returning rows', async () => {
    const stub = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ needsCreate: true, namespace: 'workspace', id: 'ws-2' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ rows: [{ total: 2 }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
    };

    const rows = await executeDoSql({
      databaseNamespace: {
        idFromName: vi.fn().mockReturnValue('do-id'),
        get: vi.fn().mockReturnValue(stub),
      } as unknown as DurableObjectNamespace,
      namespace: 'workspace',
      id: 'ws-2',
      query: 'SELECT COUNT(*) AS total FROM members',
      params: [],
      internal: true,
    });

    expect(rows).toEqual([{ total: 2 }]);
    expect(stub.fetch).toHaveBeenCalledTimes(2);
  });
});
