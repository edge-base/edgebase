import { afterEach, describe, expect, it, vi } from 'vitest';

describe('buildFunctionContext admin.db D1 routing', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('routes single-instance namespaces through handleD1Request when env is available', async () => {
    const handleD1Request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'sig-1', title: 'Inserted via D1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    vi.doMock('../lib/d1-handler.js', () => ({
      handleD1Request,
    }));

    const workerFetch = vi.fn().mockRejectedValue(new Error('worker fetch should not be used'));
    vi.stubGlobal('fetch', workerFetch);

    const databaseFetch = vi.fn().mockRejectedValue(new Error('database DO should not be used'));
    const { buildFunctionContext } = await import('../lib/functions.js');

    const ctx = buildFunctionContext({
      request: new Request('http://localhost/api/functions/save-room-signal'),
      auth: null,
      databaseNamespace: {
        idFromName: vi.fn(() => 'shared-id'),
        get: vi.fn(() => ({ fetch: databaseFetch })),
      } as unknown as DurableObjectNamespace,
      authNamespace: {
        idFromName: vi.fn(() => 'auth-id'),
        get: vi.fn(() => ({ fetch: vi.fn() })),
      } as unknown as DurableObjectNamespace,
      d1Database: {} as D1Database,
      env: {
        DATABASE: {} as DurableObjectNamespace,
        AUTH: {} as DurableObjectNamespace,
        AUTH_DB: {} as D1Database,
        DB_D1_SHARED: {} as D1Database,
      } as never,
      executionCtx: { waitUntil: vi.fn() } as unknown as ExecutionContext,
      config: {
        databases: {
          shared: {
            tables: {
              signals: {
                schema: {
                  title: { type: 'string', required: true },
                },
              },
            },
          },
        },
      },
    });

    const inserted = await ctx.admin.db('shared').table('signals').insert({ title: 'Inserted via D1' });

    expect(inserted).toEqual({ id: 'sig-1', title: 'Inserted via D1' });
    expect(handleD1Request).toHaveBeenCalledTimes(1);
    expect(handleD1Request).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          DB_D1_SHARED: expect.anything(),
        }),
      }),
      'shared',
      'signals',
      '/tables/signals',
    );
    expect(workerFetch).not.toHaveBeenCalled();
    expect(databaseFetch).not.toHaveBeenCalled();
  });

  it('routes upsert through handleD1Request with upsert query params', async () => {
    const handleD1Request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'sig-1', title: 'Upserted via D1', action: 'updated' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    vi.doMock('../lib/d1-handler.js', () => ({
      handleD1Request,
    }));

    const workerFetch = vi.fn().mockRejectedValue(new Error('worker fetch should not be used'));
    vi.stubGlobal('fetch', workerFetch);

    const databaseFetch = vi.fn().mockRejectedValue(new Error('database DO should not be used'));
    const { buildFunctionContext } = await import('../lib/functions.js');

    const ctx = buildFunctionContext({
      request: new Request('http://localhost/api/functions/save-room-signal'),
      auth: null,
      databaseNamespace: {
        idFromName: vi.fn(() => 'shared-id'),
        get: vi.fn(() => ({ fetch: databaseFetch })),
      } as unknown as DurableObjectNamespace,
      authNamespace: {
        idFromName: vi.fn(() => 'auth-id'),
        get: vi.fn(() => ({ fetch: vi.fn() })),
      } as unknown as DurableObjectNamespace,
      d1Database: {} as D1Database,
      env: {
        DATABASE: {} as DurableObjectNamespace,
        AUTH: {} as DurableObjectNamespace,
        AUTH_DB: {} as D1Database,
        DB_D1_SHARED: {} as D1Database,
      } as never,
      executionCtx: { waitUntil: vi.fn() } as unknown as ExecutionContext,
      config: {
        databases: {
          shared: {
            tables: {
              signals: {
                schema: {
                  title: { type: 'string', required: true },
                },
              },
            },
          },
        },
      },
    });

    const upserted = await ctx.admin.db('shared').table('signals').upsert({
      id: 'sig-1',
      title: 'Upserted via D1',
    });

    expect(upserted).toEqual({ id: 'sig-1', title: 'Upserted via D1', action: 'updated' });
    expect(handleD1Request).toHaveBeenCalledTimes(1);
    expect(handleD1Request).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          DB_D1_SHARED: expect.anything(),
        }),
        req: expect.objectContaining({
          url: 'http://internal/api/db/shared/tables/signals?upsert=true',
        }),
      }),
      'shared',
      'signals',
      '/tables/signals',
    );
    expect(workerFetch).not.toHaveBeenCalled();
    expect(databaseFetch).not.toHaveBeenCalled();
  });

  it('preserves bounded list query params through the direct D1 handler', async () => {
    const handleD1Request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        items: [{ id: 'sig-1' }],
        total: null,
        hasMore: false,
        cursor: null,
        page: null,
        perPage: 5,
        returnedBytes: 132,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.doMock('../lib/d1-handler.js', () => ({ handleD1Request }));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('worker fetch should not be used')));

    const { buildFunctionContext } = await import('../lib/functions.js');
    const ctx = buildFunctionContext({
      request: new Request('http://localhost/api/functions/list-signals'),
      auth: null,
      databaseNamespace: {} as DurableObjectNamespace,
      authNamespace: {} as DurableObjectNamespace,
      d1Database: {} as D1Database,
      env: {
        DATABASE: {} as DurableObjectNamespace,
        AUTH: {} as DurableObjectNamespace,
        AUTH_DB: {} as D1Database,
        DB_D1_SHARED: {} as D1Database,
      } as never,
      config: {
        databases: {
          shared: {
            provider: 'd1',
            tables: { signals: { schema: { title: { type: 'string' } } } },
          },
        },
      },
    });

    await ctx.admin
      .db('shared')
      .table('signals')
      .select('id')
      .limit(5)
      .includeTotal(false)
      .maxResponseBytes(4096)
      .getList();

    const handlerContext = handleD1Request.mock.calls[0]?.[0] as { req: { url: string } };
    expect(handlerContext.req.url).toBe(
      'http://internal/api/db/shared/tables/signals?fields=id&limit=5&includeTotal=false&maxResponseBytes=4096',
    );
  });

  it('preserves bounded list query params through the direct PostgreSQL handler', async () => {
    const handlePgRequest = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        items: [{ id: 'sig-1' }],
        total: null,
        hasMore: false,
        cursor: null,
        page: null,
        perPage: 5,
        returnedBytes: 132,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.doMock('../lib/postgres-handler.js', () => ({ handlePgRequest }));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('worker fetch should not be used')));

    const { buildFunctionContext } = await import('../lib/functions.js');
    const ctx = buildFunctionContext({
      request: new Request('http://localhost/api/functions/list-signals'),
      auth: null,
      databaseNamespace: {} as DurableObjectNamespace,
      authNamespace: {} as DurableObjectNamespace,
      d1Database: {} as D1Database,
      env: {
        DB_POSTGRES_SHARED_URL: 'postgres://edgebase:test@localhost/shared',
      } as never,
      config: {
        databases: {
          shared: {
            provider: 'postgres',
            connectionString: 'DB_POSTGRES_SHARED_URL',
            tables: { signals: { schema: { title: { type: 'string' } } } },
          },
        },
      },
    });

    await ctx.admin
      .db('shared')
      .table('signals')
      .select('id')
      .limit(5)
      .includeTotal(false)
      .maxResponseBytes(4096)
      .getList();

    const handlerContext = handlePgRequest.mock.calls[0]?.[0] as { req: { url: string } };
    expect(handlerContext.req.url).toBe(
      'http://internal/api/db/shared/tables/signals?fields=id&limit=5&includeTotal=false&maxResponseBytes=4096',
    );
  });

  it('routes admin DB proxy through handleD1Request without an execution context', async () => {
    const handleD1Request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'sig-2', title: 'Upserted without execution context', action: 'inserted' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    vi.doMock('../lib/d1-handler.js', () => ({
      handleD1Request,
    }));

    const workerFetch = vi.fn().mockRejectedValue(new Error('worker fetch should not be used'));
    vi.stubGlobal('fetch', workerFetch);

    const databaseFetch = vi.fn().mockRejectedValue(new Error('database DO should not be used'));
    const { buildAdminDbProxy } = await import('../lib/functions.js');

    const adminDb = buildAdminDbProxy({
      databaseNamespace: {
        idFromName: vi.fn(() => 'shared-id'),
        get: vi.fn(() => ({ fetch: databaseFetch })),
      } as unknown as DurableObjectNamespace,
      env: {
        DATABASE: {} as DurableObjectNamespace,
        AUTH: {} as DurableObjectNamespace,
        AUTH_DB: {} as D1Database,
        DB_D1_SHARED: {} as D1Database,
      } as never,
      config: {
        databases: {
          shared: {
            tables: {
              signals: {
                schema: {
                  title: { type: 'string', required: true },
                },
              },
            },
          },
        },
      },
    });

    const upserted = await adminDb('shared').table('signals').upsert({
      title: 'Upserted without execution context',
    });

    expect(upserted).toEqual({
      id: 'sig-2',
      title: 'Upserted without execution context',
      action: 'inserted',
    });
    expect(handleD1Request).toHaveBeenCalledTimes(1);
    expect(handleD1Request).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          DB_D1_SHARED: expect.anything(),
        }),
        executionCtx: expect.objectContaining({
          waitUntil: expect.any(Function),
        }),
        req: expect.objectContaining({
          url: 'http://internal/api/db/shared/tables/signals?upsert=true',
        }),
      }),
      'shared',
      'signals',
      '/tables/signals',
    );
    expect(workerFetch).not.toHaveBeenCalled();
    expect(databaseFetch).not.toHaveBeenCalled();
  });

  it('falls back to the database durable object for implicit D1 namespaces when the D1 binding is absent', async () => {
    const handleD1Request = vi.fn().mockRejectedValue(new Error('D1 handler should not be used'));
    vi.doMock('../lib/d1-handler.js', () => ({
      handleD1Request,
    }));

    const workerFetch = vi.fn().mockRejectedValue(new Error('worker fetch should not be used'));
    vi.stubGlobal('fetch', workerFetch);

    const databaseFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: 'sig-do', title: 'Read via DO' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const databaseNamespace = {
      idFromName: vi.fn(() => 'shared-id'),
      get: vi.fn(() => ({ fetch: databaseFetch })),
    } as unknown as DurableObjectNamespace;

    const { buildFunctionContext } = await import('../lib/functions.js');

    const ctx = buildFunctionContext({
      request: new Request('http://localhost/api/functions/save-room-signal'),
      auth: null,
      databaseNamespace,
      authNamespace: {
        idFromName: vi.fn(() => 'auth-id'),
        get: vi.fn(() => ({ fetch: vi.fn() })),
      } as unknown as DurableObjectNamespace,
      d1Database: {} as D1Database,
      env: {
        DATABASE: databaseNamespace,
        AUTH: {} as DurableObjectNamespace,
        AUTH_DB: {} as D1Database,
      } as never,
      executionCtx: { waitUntil: vi.fn() } as unknown as ExecutionContext,
      config: {
        databases: {
          shared: {
            tables: {
              signals: {
                schema: {
                  title: { type: 'string', required: true },
                },
              },
            },
          },
        },
      },
    });

    const result = await ctx.admin
      .db('shared')
      .table('signals')
      .limit(5)
      .includeTotal(false)
      .maxResponseBytes(4096)
      .getList();

    expect(result.items).toEqual([{ id: 'sig-do', title: 'Read via DO' }]);
    expect(handleD1Request).not.toHaveBeenCalled();
    expect(workerFetch).not.toHaveBeenCalled();
    expect(databaseNamespace.idFromName).toHaveBeenCalledWith('shared');
    expect(databaseFetch).toHaveBeenCalledWith(
      'http://do/tables/signals?limit=5&includeTotal=false&maxResponseBytes=4096',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'X-DO-Name': 'shared',
          'X-EdgeBase-Internal': 'true',
        }),
      }),
    );
  });

  it('rejects instance ids for single-instance namespaces before touching D1 handlers', async () => {
    const handleD1Request = vi.fn();
    vi.doMock('../lib/d1-handler.js', () => ({
      handleD1Request,
    }));

    const workerFetch = vi.fn();
    vi.stubGlobal('fetch', workerFetch);

    const databaseFetch = vi.fn();
    const { buildFunctionContext } = await import('../lib/functions.js');

    const ctx = buildFunctionContext({
      request: new Request('http://localhost/api/functions/save-room-signal'),
      auth: null,
      databaseNamespace: {
        idFromName: vi.fn(() => 'shared-id'),
        get: vi.fn(() => ({ fetch: databaseFetch })),
      } as unknown as DurableObjectNamespace,
      authNamespace: {
        idFromName: vi.fn(() => 'auth-id'),
        get: vi.fn(() => ({ fetch: vi.fn() })),
      } as unknown as DurableObjectNamespace,
      d1Database: {} as D1Database,
      env: {
        DATABASE: {} as DurableObjectNamespace,
        AUTH: {} as DurableObjectNamespace,
        AUTH_DB: {} as D1Database,
        DB_D1_SHARED: {} as D1Database,
      } as never,
      executionCtx: { waitUntil: vi.fn() } as unknown as ExecutionContext,
      config: {
        databases: {
          shared: {
            tables: {
              signals: {
                schema: {
                  title: { type: 'string', required: true },
                },
              },
            },
          },
        },
      },
    });

    await expect(
      ctx.admin.db('shared', 'shadow').table('signals').getList(),
    ).rejects.toThrow("instanceId is not allowed for single-instance namespace 'shared'");
    expect(handleD1Request).not.toHaveBeenCalled();
    expect(workerFetch).not.toHaveBeenCalled();
    expect(databaseFetch).not.toHaveBeenCalled();
  });
});
