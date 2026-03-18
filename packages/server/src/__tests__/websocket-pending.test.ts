import { afterEach, describe, expect, it } from 'vitest';
import { defineConfig } from '@edge-base/shared';
import { OpenAPIHono, type HonoEnv } from '../lib/hono.js';
import { setConfig } from '../lib/do-router.js';
import {
  acquirePendingWebSocketSlot,
  getPendingWebSocketCount,
  releasePendingWebSocketSlot,
} from '../lib/websocket-pending.js';
import { roomRoute } from '../routes/room.js';
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

function createMockRoomEnv(
  kv: KVNamespace & { _store: MockKVStore },
  response = new Response(null, { status: 200 }),
): Env {
  const roomNamespace = {
    idFromName: (name: string) => name as unknown as DurableObjectId,
    get: () => ({
      fetch: async () => response,
    }),
  } as unknown as DurableObjectNamespace;

  return {
    KV: kv,
    ROOMS: roomNamespace,
  } as unknown as Env;
}

function createRoomApp() {
  const app = new OpenAPIHono<HonoEnv>();
  app.route('/api/room', roomRoute);
  return app;
}

describe('websocket pending connection counters', () => {
  afterEach(() => {
    setConfig({});
  });

  it('releases the room pending slot after proxying the upgrade request', async () => {
    setConfig(defineConfig({
      release: true,
      rooms: {
        game: {},
      },
    }));

    const kv = createMockKV();
    const app = createRoomApp();
    const response = await app.request('/api/room?namespace=game&id=room-1', {
      method: 'GET',
      headers: {
        Upgrade: 'websocket',
        'CF-Connecting-IP': '127.0.0.1',
      },
    }, createMockRoomEnv(kv));

    expect(response.status).toBe(200);
    expect(kv._store.data['ws:room:pending:127.0.0.1']).toBeUndefined();
  });

  it('restores the prior room pending count after a proxied request completes', async () => {
    setConfig(defineConfig({
      release: true,
      rooms: {
        game: {},
      },
    }));

    const kv = createMockKV();
    kv._store.data['ws:room:pending:127.0.0.1'] = { value: '4' };

    const app = createRoomApp();
    const response = await app.request('/api/room?namespace=game&id=room-1', {
      method: 'GET',
      headers: {
        Upgrade: 'websocket',
        'CF-Connecting-IP': '127.0.0.1',
      },
    }, createMockRoomEnv(kv));

    expect(response.status).toBe(200);
    expect(kv._store.data['ws:room:pending:127.0.0.1']?.value).toBe('4');
  });

  it('reports room rate-limit diagnostics without consuming a slot', async () => {
    setConfig(defineConfig({
      release: true,
      rooms: {
        game: {},
      },
    }));

    const kv = createMockKV();
    kv._store.data['ws:room:pending:127.0.0.1'] = { value: '5' };

    const app = createRoomApp();
    const response = await app.request('/api/room/connect-check?namespace=game&id=room-1', {
      method: 'GET',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
      },
    }, createMockRoomEnv(kv));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      type: 'room_connect_rate_limited',
      category: 'rate_limit',
      pendingCount: 5,
      maxPending: 5,
    });
    expect(kv._store.data['ws:room:pending:127.0.0.1']?.value).toBe('5');
  });
});

describe('websocket pending helper functions', () => {
  it('reads a missing pending counter as zero', async () => {
    const kv = createMockKV();

    await expect(getPendingWebSocketCount(kv, 'ws:pending:127.0.0.1')).resolves.toBe(0);
  });

  it('acquires slots until the max pending threshold is reached', async () => {
    const kv = createMockKV();

    await expect(acquirePendingWebSocketSlot(kv, 'ws:pending:127.0.0.1', 2, 30)).resolves.toBe(true);
    await expect(acquirePendingWebSocketSlot(kv, 'ws:pending:127.0.0.1', 2, 30)).resolves.toBe(true);
    await expect(acquirePendingWebSocketSlot(kv, 'ws:pending:127.0.0.1', 2, 30)).resolves.toBe(false);
    expect(kv._store.data['ws:pending:127.0.0.1']?.value).toBe('2');
  });

  it('releases the final pending slot by deleting the key', async () => {
    const kv = createMockKV();
    kv._store.data['ws:pending:127.0.0.1'] = { value: '1' };

    await releasePendingWebSocketSlot(kv, 'ws:pending:127.0.0.1', 30);

    expect(kv._store.data['ws:pending:127.0.0.1']).toBeUndefined();
  });
});
