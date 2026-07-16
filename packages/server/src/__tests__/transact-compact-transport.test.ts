import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineConfig } from '@edge-base/shared';

const OPERATIONS = [{ table: 'docs', op: 'delete' as const, id: 'doc-1' }];
const COMPACT_RESULT = { committed: true as const, operationCount: 1 };

function namespaceWith(fetch: ReturnType<typeof vi.fn>): DurableObjectNamespace {
  return {
    idFromName: vi.fn((name: string) => name),
    get: vi.fn(() => ({ fetch })),
  } as unknown as DurableObjectNamespace;
}

function functionContextOptions(
  config: ReturnType<typeof defineConfig>,
  databaseNamespace: DurableObjectNamespace,
  extra: Record<string, unknown> = {},
) {
  return {
    request: new Request('http://internal/api/functions/compact'),
    auth: null,
    databaseNamespace,
    authNamespace: {} as DurableObjectNamespace,
    config,
    ...extra,
  };
}

describe('compact transact internal and HTTP transports', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves resultMode through the direct D1 handler transport', async () => {
    const handleD1Request = vi.fn().mockResolvedValue(Response.json(COMPACT_RESULT));
    vi.doMock('../lib/d1-handler.js', () => ({ handleD1Request }));
    const config = defineConfig({
      databases: {
        shared: { provider: 'd1', tables: { docs: {} } },
      },
    });
    const env = {
      EDGEBASE_CONFIG: config,
      DB_D1_SHARED: {} as D1Database,
    };
    const { buildFunctionContext } = await import('../lib/functions.js');
    const ctx = buildFunctionContext(functionContextOptions(
      config,
      namespaceWith(vi.fn()),
      { env },
    ) as never);

    await expect(
      ctx.admin.db('shared').transact(OPERATIONS, { resultMode: 'compact' }),
    ).resolves.toEqual(COMPACT_RESULT);
    expect(handleD1Request).toHaveBeenCalledTimes(1);
    const directContext = handleD1Request.mock.calls[0]![0] as { req: { json(): Promise<unknown> } };
    await expect(directContext.req.json()).resolves.toEqual({
      operations: OPERATIONS,
      resultMode: 'compact',
    });
    expect(handleD1Request.mock.calls[0]!.slice(1)).toEqual(['shared', '', '/transact']);
  });

  it('preserves resultMode through the direct PostgreSQL handler transport', async () => {
    const handlePgRequest = vi.fn().mockResolvedValue(Response.json(COMPACT_RESULT));
    vi.doMock('../lib/postgres-handler.js', () => ({ handlePgRequest }));
    const config = defineConfig({
      databases: {
        shared: {
          provider: 'postgres',
          connectionString: 'DB_POSTGRES_SHARED_URL',
          tables: { docs: {} },
        },
      },
    });
    const env = {
      EDGEBASE_CONFIG: config,
      DB_POSTGRES_SHARED_URL: 'postgres://edgebase:test@localhost/shared',
    };
    const { buildFunctionContext } = await import('../lib/functions.js');
    const ctx = buildFunctionContext(functionContextOptions(
      config,
      namespaceWith(vi.fn()),
      { env },
    ) as never);

    await expect(
      ctx.admin.db('shared').transact(OPERATIONS, { resultMode: 'compact' }),
    ).resolves.toEqual(COMPACT_RESULT);
    expect(handlePgRequest).toHaveBeenCalledTimes(1);
    const directContext = handlePgRequest.mock.calls[0]![0] as { req: { json(): Promise<unknown> } };
    await expect(directContext.req.json()).resolves.toEqual({
      operations: OPERATIONS,
      resultMode: 'compact',
    });
    expect(handlePgRequest.mock.calls[0]!.slice(1)).toEqual(['shared', '', '/transact']);
  });

  it('preserves resultMode through the direct Durable Object transport', async () => {
    const databaseFetch = vi.fn().mockResolvedValue(Response.json(COMPACT_RESULT));
    const databaseNamespace = namespaceWith(databaseFetch);
    const config = defineConfig({
      databases: {
        shared: { provider: 'do', tables: { docs: {} } },
      },
    });
    const { buildFunctionContext } = await import('../lib/functions.js');
    const ctx = buildFunctionContext(functionContextOptions(
      config,
      databaseNamespace,
      { env: { EDGEBASE_CONFIG: config } },
    ) as never);

    await expect(
      ctx.admin.db('shared').transact(OPERATIONS, { resultMode: 'compact' }),
    ).resolves.toEqual(COMPACT_RESULT);
    expect(databaseFetch).toHaveBeenCalledTimes(1);
    const [url, init] = databaseFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://do/transact');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      operations: OPERATIONS,
      resultMode: 'compact',
    });
  });

  it('preserves resultMode through the worker HTTP fallback', async () => {
    const workerFetch = vi.fn().mockResolvedValue(Response.json(COMPACT_RESULT));
    vi.stubGlobal('fetch', workerFetch);
    const config = defineConfig({
      databases: {
        shared: { provider: 'do', tables: { docs: {} } },
      },
    });
    const { buildFunctionContext } = await import('../lib/functions.js');
    const ctx = buildFunctionContext(functionContextOptions(
      config,
      namespaceWith(vi.fn()),
      { workerUrl: 'https://edgebase.example' },
    ) as never);

    await expect(
      ctx.admin.db('shared').transact(OPERATIONS, { resultMode: 'compact' }),
    ).resolves.toEqual(COMPACT_RESULT);
    expect(workerFetch).toHaveBeenCalledTimes(1);
    const [url, init] = workerFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://edgebase.example/api/db/shared/transact');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      operations: OPERATIONS,
      resultMode: 'compact',
    });
  });
});
