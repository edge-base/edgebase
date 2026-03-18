import { afterEach, describe, expect, it } from 'vitest';
import { defineConfig, type AuthContext } from '@edge-base/shared';
import { setConfig } from '../lib/do-router.js';
import { OpenAPIHono, type HonoEnv } from '../lib/hono.js';
import { roomRoute } from '../routes/room.js';
import type { Env } from '../types.js';

function createRoomEnv(): Env {
  return {
    ROOMS: {
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get: () => ({
        fetch: async () => new Response(JSON.stringify({ visibility: 'public' }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      }),
    } as unknown as DurableObjectNamespace,
  } as Env;
}

function createApp(auth?: AuthContext | null) {
  const app = new OpenAPIHono<HonoEnv>();
  app.use('/api/room/*', async (c, next) => {
    c.set('auth', (auth ?? null) as never);
    await next();
  });
  app.route('/api/room', roomRoute);
  return app;
}

describe('Room route access policy', () => {
  afterEach(() => {
    setConfig({});
  });

  it('denies metadata in release mode without access.metadata or public.metadata', async () => {
    setConfig(defineConfig({
      release: true,
      rooms: {
        game: {},
      },
    }));

    const app = createApp();
    const response = await app.request('/api/room/metadata?namespace=game&id=room-1', {
      method: 'GET',
    }, createRoomEnv());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Room metadata requires access.metadata or public.metadata in release mode',
    });
  });

  it('allows metadata when public.metadata is explicitly enabled', async () => {
    setConfig(defineConfig({
      release: true,
      rooms: {
        game: {
          public: {
            metadata: true,
          },
        },
      },
    }));

    const app = createApp();
    const response = await app.request('/api/room/metadata?namespace=game&id=room-1', {
      method: 'GET',
    }, createRoomEnv());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ visibility: 'public' });
  });

  it('passes enriched auth context into metadata access rules', async () => {
    setConfig(defineConfig({
      release: true,
      rooms: {
        game: {
          access: {
            metadata: (auth, roomId) => auth?.meta?.tenant === 'team-1' && roomId === 'room-1',
          },
        },
      },
    }));

    const app = createApp({
      id: 'user-1',
      role: 'user',
      isAnonymous: false,
      meta: { tenant: 'team-1' },
    });
    const response = await app.request('/api/room/metadata?namespace=game&id=room-1', {
      method: 'GET',
    }, createRoomEnv());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ visibility: 'public' });
  });
});
