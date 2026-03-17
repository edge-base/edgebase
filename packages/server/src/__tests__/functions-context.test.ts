import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFunctionContext, getWorkerUrl } from '../lib/functions.js';

describe('buildFunctionContext admin.db', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('routes table proxy calls through the worker when workerUrl is available', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: 'p1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const ctx = buildFunctionContext({
      request: new Request('http://localhost/api/functions/feed-summary'),
      auth: null,
      databaseNamespace: {} as DurableObjectNamespace,
      authNamespace: {} as DurableObjectNamespace,
      d1Database: {} as D1Database,
      config: {
        databases: {
          shared: {
            tables: {
              posts: { schema: { title: { type: 'string' } } },
            },
          },
        },
      },
      workerUrl: 'http://localhost:8787',
    });

    const result = await ctx.admin.db('shared').table('posts').list({ limit: 5 });

    expect(result.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/api/db/shared/tables/posts?limit=5',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-EdgeBase-Internal': 'true',
        }),
      }),
    );
  });

  it('routes upsert calls through the worker with upsert query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'p1', title: 'Upserted', action: 'inserted' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const ctx = buildFunctionContext({
      request: new Request('http://localhost/api/functions/feed-summary'),
      auth: null,
      databaseNamespace: {} as DurableObjectNamespace,
      authNamespace: {} as DurableObjectNamespace,
      d1Database: {} as D1Database,
      config: {
        databases: {
          shared: {
            tables: {
              posts: { schema: { title: { type: 'string' } } },
            },
          },
        },
      },
      workerUrl: 'http://localhost:8787',
    });

    const result = await ctx.admin.db('shared').table('posts').upsert({
      id: 'p1',
      title: 'Upserted',
    });

    expect(result).toEqual({ id: 'p1', title: 'Upserted', action: 'inserted' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/api/db/shared/tables/posts?upsert=true',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-EdgeBase-Internal': 'true',
        }),
        body: JSON.stringify({
          id: 'p1',
          title: 'Upserted',
        }),
      }),
    );
  });

  it('normalizes admin.sql worker responses to row arrays', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        rows: [{ total: 2 }],
        items: [{ total: 2 }],
        results: [{ total: 2 }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const ctx = buildFunctionContext({
      request: new Request('http://localhost/api/functions/feed-summary'),
      auth: null,
      databaseNamespace: {} as DurableObjectNamespace,
      authNamespace: {} as DurableObjectNamespace,
      d1Database: {} as D1Database,
      config: {
        databases: {
          shared: {
            tables: {
              posts: { schema: { title: { type: 'string' } } },
            },
          },
        },
      },
      workerUrl: 'http://localhost:8787',
      serviceKey: 'sk-test',
    });

    const rows = await ctx.admin.sql('shared', undefined, 'SELECT COUNT(*) AS total FROM posts');

    expect(rows).toEqual([{ total: 2 }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/api/sql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-EdgeBase-Service-Key': 'sk-test',
        }),
      }),
    );
  });

  it('routes admin.sql through the database DO when env is available', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const stub = {
      fetch: vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            needsCreate: true,
            namespace: 'workspace',
            id: 'ws-1',
          }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
        new Response(JSON.stringify({
          rows: [{ total: 3 }],
          items: [{ total: 3 }],
          results: [{ total: 3 }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
        ),
    };
    const databaseNamespace = {
      idFromName: vi.fn().mockReturnValue('do-id'),
      get: vi.fn().mockReturnValue(stub),
    } as unknown as DurableObjectNamespace;

    const ctx = buildFunctionContext({
      request: new Request('http://localhost/api/functions/feed-summary'),
      auth: null,
      databaseNamespace,
      authNamespace: {} as DurableObjectNamespace,
      d1Database: {} as D1Database,
      config: {
        databases: {
          workspace: {
            tables: {
              members: { schema: { userId: { type: 'string' } } },
            },
          },
        },
      },
      env: {} as never,
      workerUrl: 'http://localhost:8787',
      serviceKey: 'sk-test',
    });

    const rows = await ctx.admin.sql('workspace', 'ws-1', 'SELECT COUNT(*) AS total FROM members', []);

    expect(rows).toEqual([{ total: 3 }]);
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
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes admin.kv through the configured KV binding when env is available', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const kvBinding = {
      get: vi.fn().mockResolvedValue('value-1'),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({
        keys: [{ name: 'debug:key' }],
        list_complete: true,
        cursor: '',
      }),
    };

    const ctx = buildFunctionContext({
      request: new Request('http://localhost/api/functions/feed-summary'),
      auth: null,
      databaseNamespace: {} as DurableObjectNamespace,
      authNamespace: {} as DurableObjectNamespace,
      d1Database: {} as D1Database,
      config: {
        kv: {
          lab: { binding: 'KV' },
        },
      },
      env: { KV: kvBinding } as never,
      workerUrl: 'http://localhost:8787',
      serviceKey: 'sk-test',
    });

    await ctx.admin.kv('lab').set('debug:key', 'value-1', { ttl: 3600 });
    const value = await ctx.admin.kv('lab').get('debug:key');
    const listed = await ctx.admin.kv('lab').list({ prefix: 'debug:' });
    await ctx.admin.kv('lab').delete('debug:key');

    expect(value).toBe('value-1');
    expect(listed.keys).toEqual(['debug:key']);
    expect(kvBinding.put).toHaveBeenCalledWith('debug:key', 'value-1', { expirationTtl: 3600 });
    expect(kvBinding.delete).toHaveBeenCalledWith('debug:key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes admin.d1 through the configured D1 binding when env is available', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const d1Binding = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: [{ total: 4 }] }),
        }),
        all: vi.fn().mockResolvedValue({ results: [{ total: 4 }] }),
      }),
    };

    const ctx = buildFunctionContext({
      request: new Request('http://localhost/api/functions/feed-summary'),
      auth: null,
      databaseNamespace: {} as DurableObjectNamespace,
      authNamespace: {} as DurableObjectNamespace,
      d1Database: {} as D1Database,
      config: {
        d1: {
          analytics: { binding: 'DB_D1_SHARED' },
        },
      },
      env: { DB_D1_SHARED: d1Binding } as never,
      workerUrl: 'http://localhost:8787',
      serviceKey: 'sk-test',
    });

    const rows = await ctx.admin.d1('analytics').exec('SELECT COUNT(*) AS total FROM rollups WHERE runId = ?', ['r1']);

    expect(rows).toEqual([{ total: 4 }]);
    expect(d1Binding.prepare).toHaveBeenCalledWith('SELECT COUNT(*) AS total FROM rollups WHERE runId = ?');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes admin.d1(auth) through AUTH_DB when no custom d1 binding is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const authBinding = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: [{ token: 'tok-1' }] }),
        }),
        all: vi.fn().mockResolvedValue({ results: [{ token: 'tok-1' }] }),
      }),
    };

    const ctx = buildFunctionContext({
      request: new Request('http://localhost/api/functions/mock/email/inbox/user@test.edgebase.fun'),
      auth: null,
      databaseNamespace: {} as DurableObjectNamespace,
      authNamespace: {} as DurableObjectNamespace,
      d1Database: {} as D1Database,
      config: {},
      env: { AUTH_DB: authBinding } as never,
      workerUrl: 'http://localhost:8787',
      serviceKey: 'sk-test',
    });

    const rows = await ctx.admin.d1('auth').exec('SELECT token FROM _email_tokens WHERE userId = ?', ['u1']);

    expect(rows).toEqual([{ token: 'tok-1' }]);
    expect(authBinding.prepare).toHaveBeenCalledWith('SELECT token FROM _email_tokens WHERE userId = ?');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers EDGEBASE_INTERNAL_WORKER_URL for internal self-calls', () => {
    expect(
      getWorkerUrl('http://localhost:9787/api/functions/lab/bootstrap', {
        EDGEBASE_INTERNAL_WORKER_URL: 'http://127.0.0.1:8787/',
      }),
    ).toBe('http://127.0.0.1:8787');
  });
});
