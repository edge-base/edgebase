import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineConfig } from '@edge-base/shared';
import { OpenAPIHono, type HonoEnv } from '../lib/hono.js';
import { setConfig } from '../lib/do-router.js';
import { resolveRoomRuntime } from '../lib/room-runtime.js';
import { roomRoute } from '../routes/room.js';
import type { Env } from '../types.js';

function createRoomRuntimeEnv(): Env {
  return {
    KV: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
      list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
      getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
    } as unknown as KVNamespace,
    ROOMS: {
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get: () => ({
        fetch: async () => new Response(JSON.stringify({ runtime: 'rooms' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 201,
        }),
      }),
    } as unknown as DurableObjectNamespace,
  } as unknown as Env;
}

function createRoomApp() {
  const app = new OpenAPIHono<HonoEnv>();
  app.route('/api/room', roomRoute);
  return app;
}

function createAuthedRoomApp() {
  const app = new OpenAPIHono<HonoEnv>();
  app.use('/api/*', async (c, next) => {
    c.set('auth', {
      id: 'user-1',
      role: 'user',
      isAnonymous: false,
      meta: {},
    });
    await next();
  });
  app.route('/api/room', roomRoute);
  return app;
}

describe('room runtime selection', () => {
  afterEach(() => {
    setConfig({});
  });

  it('always resolves to the rooms runtime', () => {
    const env = createRoomRuntimeEnv();
    const resolved = resolveRoomRuntime(env);

    expect(resolved.target).toBe('rooms');
    expect(resolved.binding).toBe(env.ROOMS);
  });

  it('resolves the ROOMS binding regardless of namespace config', () => {
    const env = createRoomRuntimeEnv();
    const resolved = resolveRoomRuntime(env);

    expect(resolved.target).toBe('rooms');
    expect(resolved.binding).toBe(env.ROOMS);
  });
});

describe('room route runtime routing', () => {
  afterEach(() => {
    setConfig({});
  });

  it('routes metadata requests to the rooms runtime', async () => {
    setConfig(defineConfig({
      rooms: {
        game: {
          runtime: {
            target: 'rooms',
          },
          public: {
            metadata: true,
          },
        },
      },
    }));

    const app = createRoomApp();
    const response = await app.request('/api/room/metadata?namespace=game&id=room-1', {
      method: 'GET',
    }, createRoomRuntimeEnv());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ runtime: 'rooms' });
  });

  it('routes summary requests to the rooms runtime', async () => {
    setConfig(defineConfig({
      rooms: {
        game: {
          runtime: {
            target: 'rooms',
          },
          public: {
            metadata: true,
          },
        },
      },
    }));

    const app = createRoomApp();
    const response = await app.request('/api/room/summary?namespace=game&id=room-1', {
      method: 'GET',
    }, createRoomRuntimeEnv());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ runtime: 'rooms' });
  });

  it('routes websocket upgrades to the rooms runtime', async () => {
    setConfig(defineConfig({
      rooms: {
        game: {
          runtime: {
            target: 'rooms',
          },
        },
      },
    }));

    const app = createRoomApp();
    const response = await app.request('/api/room?namespace=game&id=room-1', {
      method: 'GET',
      headers: {
        Upgrade: 'websocket',
      },
    }, createRoomRuntimeEnv());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ runtime: 'rooms' });
  });

  it('returns an error when ROOMS binding is missing', async () => {
    setConfig(defineConfig({
      rooms: {
        game: {
          runtime: {
            target: 'rooms',
          },
          public: {
            metadata: true,
          },
        },
      },
    }));

    const env = createRoomRuntimeEnv();
    delete (env as unknown as Record<string, unknown>).ROOMS;

    const app = createRoomApp();
    const response = await app.request('/api/room/metadata?namespace=game&id=room-1', {
      method: 'GET',
    }, env);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      message: "Room runtime 'rooms' not configured",
    });
  });

  it('reports the rooms runtime in connect-check diagnostics', async () => {
    setConfig(defineConfig({
      rooms: {
        game: {
          runtime: {
            target: 'rooms',
          },
        },
      },
    }));

    const app = createRoomApp();
    const response = await app.request('/api/room/connect-check?namespace=game&id=room-1', {
      method: 'GET',
    }, createRoomRuntimeEnv());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      runtime: 'rooms',
    });
  });

});
