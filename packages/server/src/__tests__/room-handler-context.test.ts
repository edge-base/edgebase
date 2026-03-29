import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {},
}));

describe('RoomsDO handler context', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('routes admin.db() through the database durable object instead of worker fetch', async () => {
    const { RoomsDO } = await import('../durable-objects/rooms-do.js');
    const workerFetch = vi.fn().mockRejectedValue(new Error('worker fetch should not be used'));
    vi.stubGlobal('fetch', workerFetch);

    const databaseFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'sig-1', title: 'Room inserted' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const room: any = Object.create(RoomsDO.prototype);

    room.env = {
      DATABASE: {
        idFromName: vi.fn(() => 'shared-id'),
        get: vi.fn(() => ({ fetch: databaseFetch })),
      },
      AUTH: {
        idFromName: vi.fn(() => 'auth-id'),
        get: vi.fn(() => ({ fetch: vi.fn() })),
      },
      AUTH_DB: {},
    };
    room.config = {
      databases: {
        shared: {
          tables: {
            signals: {
              schema: {
                title: { type: 'string' },
              },
            },
          },
        },
      },
    };

    const ctx = await room.buildHandlerContext();
    const inserted = await ctx.admin.db('shared').table('signals').insert({ title: 'Room inserted' });

    expect(inserted).toEqual({ id: 'sig-1', title: 'Room inserted' });
    expect(workerFetch).not.toHaveBeenCalled();
    expect(databaseFetch).toHaveBeenCalledWith(
      'http://do/tables/signals',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-DO-Name': 'shared',
          'X-EdgeBase-Internal': 'true',
        }),
      }),
    );
  }, 15_000);

  it('routes admin.db().upsert() through the database durable object', async () => {
    const { RoomsDO } = await import('../durable-objects/rooms-do.js');
    const workerFetch = vi.fn().mockRejectedValue(new Error('worker fetch should not be used'));
    vi.stubGlobal('fetch', workerFetch);

    const databaseFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'sig-1', title: 'Room upserted', action: 'updated' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const room: any = Object.create(RoomsDO.prototype);

    room.env = {
      DATABASE: {
        idFromName: vi.fn(() => 'shared-id'),
        get: vi.fn(() => ({ fetch: databaseFetch })),
      },
      AUTH: {
        idFromName: vi.fn(() => 'auth-id'),
        get: vi.fn(() => ({ fetch: vi.fn() })),
      },
      AUTH_DB: {},
    };
    room.config = {
      databases: {
        shared: {
          tables: {
            signals: {
              schema: {
                title: { type: 'string' },
              },
            },
          },
        },
      },
    };

    const ctx = await room.buildHandlerContext();
    const upserted = await ctx.admin.db('shared').table('signals').upsert({
      id: 'sig-1',
      title: 'Room upserted',
    });

    expect(upserted).toEqual({ id: 'sig-1', title: 'Room upserted', action: 'updated' });
    expect(workerFetch).not.toHaveBeenCalled();
    expect(databaseFetch).toHaveBeenCalledWith(
      'http://do/tables/signals?upsert=true',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-DO-Name': 'shared',
          'X-EdgeBase-Internal': 'true',
        }),
        body: JSON.stringify({
          id: 'sig-1',
          title: 'Room upserted',
        }),
      }),
    );
  }, 15_000);
});
