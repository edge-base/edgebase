import { afterEach, describe, expect, it } from 'vitest';
import { OpenAPIHono, type HonoEnv } from '../lib/hono.js';
import { setConfig } from '../lib/do-router.js';
import { databaseLiveRoute } from '../routes/database-live.js';
import type { Env } from '../types.js';

interface MockKVStore {
  data: Record<string, { value: string; options?: { expirationTtl?: number } }>;
}

function createMockKV(): KVNamespace & { _store: MockKVStore } {
  const store: MockKVStore = { data: {} };

  return {
    get: async (key: string) => store.data[key]?.value ?? null,
    put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
      store.data[key] = { value, options };
    },
    delete: async (key: string) => {
      delete store.data[key];
    },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
    _store: store,
  } as unknown as KVNamespace & { _store: MockKVStore };
}

function createMockEnv(
  kv: KVNamespace & { _store: MockKVStore },
  onFetch?: (request: Request) => Response | Promise<Response>,
): Env {
  return {
    KV: kv,
    DATABASE_LIVE: {
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get: () => ({
        fetch: async (request: Request) => onFetch?.(request) ?? new Response(null, { status: 200 }),
      }),
    } as unknown as DurableObjectNamespace,
  } as unknown as Env;
}

function createApp() {
  const app = new OpenAPIHono<HonoEnv>();
  app.route('/api/db', databaseLiveRoute);
  return app;
}

describe('database live subscription route', () => {
  afterEach(() => {
    setConfig({});
  });

  it('reports connect-check readiness for explicit database params', async () => {
    const kv = createMockKV();
    const app = createApp();

    const response = await app.request('/api/db/connect-check?namespace=shared&table=posts', {
      method: 'GET',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
      },
    }, createMockEnv(kv));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      type: 'db_connect_ready',
      category: 'ready',
      channel: 'dblive:shared:posts',
    });
  });

  it('rejects non-database-live channels on database entrypoints', async () => {
    const kv = createMockKV();
    const app = createApp();

    const response = await app.request('/api/db/connect-check?channel=dblive:presence:lobby', {
      method: 'GET',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
      },
    }, createMockEnv(kv));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      type: 'db_connect_invalid_request',
      category: 'request',
    });
  });

  it('proxies websocket subscribe requests through the database-owned path and releases pending slots', async () => {
    const kv = createMockKV();
    const app = createApp();
    let forwardedUrl = '';

    const response = await app.request('/api/db/subscribe?namespace=workspace&instanceId=ws-9&table=posts&docId=doc-1', {
      method: 'GET',
      headers: {
        Upgrade: 'websocket',
        'CF-Connecting-IP': '127.0.0.1',
      },
    }, createMockEnv(kv, async (request) => {
      forwardedUrl = request.url;
      return new Response(null, { status: 200 });
    }));

    expect(response.status).toBe(200);
    expect(forwardedUrl).toContain('/websocket?channel=dblive%3Aworkspace%3Aws-9%3Aposts%3Adoc-1');
    expect(kv._store.data['ws:pending:127.0.0.1']).toBeUndefined();
  });
});
