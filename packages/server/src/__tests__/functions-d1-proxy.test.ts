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
});
