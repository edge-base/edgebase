import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAPIHono, type HonoEnv } from '../lib/hono.js';
import { adminRoute } from '../routes/admin.js';
import { setConfig } from '../lib/do-router.js';
import { defineConfig } from '@edgebase/shared';
import type { Env } from '../types.js';

function createApp() {
  const app = new OpenAPIHono<HonoEnv>();
  app.route('/admin/api', adminRoute);
  return app;
}

function createConfig(databases: NonNullable<ReturnType<typeof defineConfig>['databases']>) {
  return defineConfig({
    databases,
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
  });
}

describe('admin data routes', () => {
  afterEach(() => {
    setConfig({});
  });

  it('reports effective providers and dynamic metadata in admin schema', async () => {
    setConfig(
      createConfig({
        shared: {
          tables: {
            posts: { schema: { title: { type: 'string' } } },
          },
        },
        workspace: {
          instance: true,
          admin: {
            instances: {
              source: 'manual',
              targetLabel: 'Workspace',
              helperText: 'Enter a workspace ID.',
            },
          },
          tables: {
            tasks: { schema: { done: { type: 'boolean' } } },
          },
        },
        analytics: {
          provider: 'postgres',
          tables: {
            events: { schema: { name: { type: 'string' } } },
          },
        },
        reporting: {
          provider: 'neon',
          tables: {
            snapshots: { schema: { label: { type: 'string' } } },
          },
        },
      }),
    );

    const app = createApp();
    const response = await app.request(
      '/admin/api/data/schema',
      {
        headers: {
          'X-EdgeBase-Service-Key': 'sk-root',
        },
      },
      {} as Env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      namespaces: {
        shared: {
          provider: 'd1',
          dynamic: false,
        },
        workspace: {
          provider: 'do',
          dynamic: true,
          instanceDiscovery: {
            source: 'manual',
            targetLabel: 'Workspace',
            helperText: 'Enter a workspace ID.',
          },
        },
        analytics: {
          provider: 'postgres',
          dynamic: false,
        },
        reporting: {
          provider: 'neon',
          dynamic: false,
        },
      },
      schema: {
        posts: {
          namespace: 'shared',
          provider: 'd1',
          dynamic: false,
        },
        tasks: {
          namespace: 'workspace',
          provider: 'do',
          dynamic: true,
          instanceDiscovery: {
            source: 'manual',
            targetLabel: 'Workspace',
            helperText: 'Enter a workspace ID.',
          },
        },
        events: {
          namespace: 'analytics',
          provider: 'postgres',
          dynamic: false,
        },
        snapshots: {
          namespace: 'reporting',
          provider: 'neon',
          dynamic: false,
        },
      },
    });
  });

  it('rejects dynamic record browsing without an instanceId', async () => {
    setConfig(
      createConfig({
        workspace: {
          instance: true,
          tables: {
            members: { schema: { userId: { type: 'string' } } },
          },
        },
      }),
    );

    const app = createApp();
    const response = await app.request(
      '/admin/api/data/tables/members/records',
      {
        headers: {
          'X-EdgeBase-Service-Key': 'sk-root',
        },
      },
      {} as Env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 400,
      message: "instanceId is required for dynamic namespace 'workspace'",
    });
  });

  it('routes dynamic record browsing to the scoped DO when instanceId is provided', async () => {
    setConfig(
      createConfig({
        workspace: {
          instance: true,
          tables: {
            members: { schema: { userId: { type: 'string' } } },
          },
        },
      }),
    );

    const stub = {
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ rows: [{ id: '1' }], total: 1 }), {
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
      '/admin/api/data/tables/members/records?instanceId=ws-1&limit=1',
      {
        headers: {
          'X-EdgeBase-Service-Key': 'sk-root',
        },
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rows: [{ id: '1' }],
      total: 1,
    });

    expect(stub.fetch).toHaveBeenCalledTimes(1);
    const forwardedInit = stub.fetch.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(forwardedInit.headers);
    expect(headers.get('X-DO-Name')).toBe('workspace:ws-1');
  });

  it('uses D1 run() for admin SQL mutations so table rename actually executes', async () => {
    setConfig(
      createConfig({
        shared: {
          tables: {
            posts: { schema: { title: { type: 'string' } } },
          },
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
      '/admin/api/data/sql',
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
    expect((env as unknown as { DB_D1_SHARED: { prepare: ReturnType<typeof vi.fn> } }).DB_D1_SHARED.prepare).toHaveBeenCalledWith(
      'ALTER TABLE "posts" RENAME TO "articles"',
    );
    expect(stmt.run).toHaveBeenCalledTimes(1);
    expect(stmt.all).not.toHaveBeenCalled();
  });

  it('proxies namespace dump and restore through admin backup routes for D1-backed blocks', async () => {
    setConfig(
      createConfig({
        shared: {
          tables: {
            posts: { schema: { title: { type: 'string' } } },
          },
        },
      }),
    );

    const selectAll = vi.fn()
      .mockResolvedValueOnce({ results: [{ id: '1', title: 'Hello' }] })
      .mockResolvedValueOnce({ results: [{ key: 'schemaHash:posts', value: 'abc' }] });
    const selectFirst = vi.fn().mockResolvedValue(null);
    const run = vi.fn().mockResolvedValue({ meta: { changes: 0 } });

    const prepare = vi.fn((sql: string) => {
      const stmt = {
        bind: vi.fn(() => stmt),
        all: vi.fn(() => {
          if (sql.startsWith('SELECT * FROM')) {
            return selectAll();
          }
          return Promise.resolve({ results: [] });
        }),
        first: vi.fn(() => selectFirst()),
        run: vi.fn(() => run()),
      };
      return stmt;
    });

    const env = {
      DB_D1_SHARED: {
        prepare,
        batch: vi.fn().mockResolvedValue([]),
      },
    } as unknown as Env;

    const app = createApp();

    const dumpResponse = await app.request(
      '/admin/api/data/backup/dump-data',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EdgeBase-Service-Key': 'sk-root',
        },
        body: JSON.stringify({ namespace: 'shared' }),
      },
      env,
    );

    expect(dumpResponse.status).toBe(200);
    await expect(dumpResponse.json()).resolves.toMatchObject({
      namespace: 'shared',
      tables: {
        posts: [{ id: '1', title: 'Hello' }],
        _meta: [{ key: 'schemaHash:posts', value: 'abc' }],
      },
    });

    const restoreResponse = await app.request(
      '/admin/api/data/backup/restore-data',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EdgeBase-Service-Key': 'sk-root',
        },
        body: JSON.stringify({
          namespace: 'shared',
          tables: {
            posts: [{ id: '1', title: 'Hello' }],
            _meta: [{ key: 'schemaHash:posts', value: 'abc' }],
          },
        }),
      },
      env,
    );

    expect(restoreResponse.status).toBe(200);
    await expect(restoreResponse.json()).resolves.toMatchObject({
      ok: true,
      namespace: 'shared',
      restored: 2,
    });

    expect((env as unknown as { DB_D1_SHARED: { batch: ReturnType<typeof vi.fn> } }).DB_D1_SHARED.batch).toHaveBeenCalled();
  });

  it('lists table-backed instance suggestions for dynamic namespaces', async () => {
    setConfig(
      createConfig({
        shared: {
          tables: {
            workspaces: {
              schema: {
                name: { type: 'string' },
                slug: { type: 'string' },
              },
            },
          },
        },
        workspace: {
          instance: true,
          admin: {
            instances: {
              source: 'table',
              targetLabel: 'Workspace',
              namespace: 'shared',
              table: 'workspaces',
              labelField: 'name',
              searchFields: ['name', 'slug'],
              helperText: 'Pick a workspace.',
            },
          },
          tables: {
            members: { schema: { userId: { type: 'string' } } },
          },
        },
      }),
    );

    const stmt: {
      bind: ReturnType<typeof vi.fn>;
      all: ReturnType<typeof vi.fn>;
    } = {
      bind: vi.fn(() => stmt),
      all: vi.fn().mockResolvedValue({
        results: [
          { __edgebase_id: 'ws_1', __edgebase_label: 'Acme' },
          { __edgebase_id: 'ws_2', __edgebase_label: 'Beta' },
        ],
      }),
    };
    const env = {
      DB_D1_SHARED: {
        prepare: vi.fn(() => stmt),
      },
    } as unknown as Env;

    const app = createApp();
    const response = await app.request(
      '/admin/api/data/namespaces/workspace/instances?q=ac&limit=5',
      {
        headers: {
          'X-EdgeBase-Service-Key': 'sk-root',
        },
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      discovery: {
        source: 'table',
        targetLabel: 'Workspace',
        helperText: 'Pick a workspace.',
      },
      items: [
        { id: 'ws_1', label: 'Acme' },
        { id: 'ws_2', label: 'Beta' },
      ],
    });

    expect((env as unknown as { DB_D1_SHARED: { prepare: ReturnType<typeof vi.fn> } }).DB_D1_SHARED.prepare).toHaveBeenCalledWith(
      expect.stringContaining('FROM "workspaces"'),
    );
  });

  it('lists function-backed instance suggestions for dynamic namespaces', async () => {
    setConfig(
      createConfig({
        workspace: {
          instance: true,
          admin: {
            instances: {
              source: 'function',
              targetLabel: 'Workspace',
              helperText: 'Recent workspaces',
              resolve: ({ query, limit }) => [
                { id: 'ws_recent', label: `Recent ${query}` },
                { id: 'ws_recent', label: 'Duplicate should be dropped' },
                { id: 'bad:id', label: 'Invalid' },
              ].slice(0, limit),
            },
          },
          tables: {
            members: { schema: { userId: { type: 'string' } } },
          },
        },
      }),
    );

    const app = createApp();
    const response = await app.request(
      '/admin/api/data/namespaces/workspace/instances?q=team&limit=3',
      {
        headers: {
          'X-EdgeBase-Service-Key': 'sk-root',
        },
      },
      {} as Env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      discovery: {
        source: 'function',
        targetLabel: 'Workspace',
        helperText: 'Recent workspaces',
      },
      items: [
        { id: 'ws_recent', label: 'Recent team' },
      ],
    });
  });
});
