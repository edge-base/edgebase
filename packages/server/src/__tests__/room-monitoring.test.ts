import { describe, expect, it } from 'vitest';
import {
  fetchRoomMonitoringStatsFromKv,
  persistRoomMonitoringSnapshot,
} from '../lib/room-monitoring.js';

interface MockKvEntry {
  value: string;
  options?: { expirationTtl?: number };
}

function createMockKv(pageSize = 50): KVNamespace & { _store: Record<string, MockKvEntry> } {
  const store: Record<string, MockKvEntry> = {};

  return {
    get: async (key: string, type?: 'text' | 'json') => {
      const entry = store[key];
      if (!entry) return null;
      if (type === 'json') {
        try {
          return JSON.parse(entry.value);
        } catch {
          return null;
        }
      }
      return entry.value;
    },
    put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
      store[key] = { value, options };
    },
    delete: async (key: string) => {
      delete store[key];
    },
    list: async ({ prefix = '', cursor }: { prefix?: string; cursor?: string } = {}) => {
      const names = Object.keys(store)
        .filter((name) => name.startsWith(prefix))
        .sort();
      const start = cursor ? Number(cursor) : 0;
      const page = names.slice(start, start + pageSize);
      const nextCursor = start + pageSize;

      return {
        keys: page.map((name) => ({ name })),
        list_complete: nextCursor >= names.length,
        cursor: nextCursor >= names.length ? undefined : String(nextCursor),
        cacheStatus: null,
      };
    },
    _store: store,
  } as unknown as KVNamespace & { _store: Record<string, MockKvEntry> };
}

describe('room monitoring helpers', () => {
  it('persists active room snapshots with a monitoring TTL', async () => {
    const kv = createMockKv();

    await persistRoomMonitoringSnapshot(kv, {
      room: 'incident-1',
      activeConnections: 3,
      authenticatedConnections: 2,
      updatedAt: '2026-03-12T00:00:00.000Z',
    });

    const stored = kv._store['monitoring:room:incident-1'];
    expect(stored).toBeDefined();
    expect(stored.options?.expirationTtl).toBe(600);
    expect(JSON.parse(stored!.value)).toMatchObject({
      room: 'incident-1',
      activeConnections: 3,
      authenticatedConnections: 2,
    });
  });

  it('deletes room snapshots when the room is no longer active', async () => {
    const kv = createMockKv();

    await persistRoomMonitoringSnapshot(kv, {
      room: 'incident-2',
      activeConnections: 1,
      authenticatedConnections: 1,
      updatedAt: '2026-03-12T00:00:00.000Z',
    });

    await persistRoomMonitoringSnapshot(kv, {
      room: 'incident-2',
      activeConnections: 0,
      authenticatedConnections: 0,
      updatedAt: '2026-03-12T00:01:00.000Z',
    });

    expect(kv._store['monitoring:room:incident-2']).toBeUndefined();
  });

  it('aggregates paginated room snapshots and ignores invalid entries', async () => {
    const kv = createMockKv(1);

    await kv.put('monitoring:room:alpha', JSON.stringify({
      room: 'alpha',
      activeConnections: 2,
      authenticatedConnections: 1,
      updatedAt: '2026-03-12T00:00:00.000Z',
    }));
    await kv.put('monitoring:room:beta', JSON.stringify({
      room: 'beta',
      activeConnections: 4,
      authenticatedConnections: 3,
      updatedAt: '2026-03-12T00:00:00.000Z',
    }));
    await kv.put('monitoring:room:gamma', JSON.stringify({
      room: 'gamma',
      activeConnections: 0,
      authenticatedConnections: 0,
      updatedAt: '2026-03-12T00:00:00.000Z',
    }));
    await kv.put('monitoring:room:broken', JSON.stringify({
      room: 'broken',
      activeConnections: 'many',
      authenticatedConnections: 1,
      updatedAt: '2026-03-12T00:00:00.000Z',
    }));
    await kv.put('unrelated:key', JSON.stringify({
      room: 'ignored',
      activeConnections: 99,
      authenticatedConnections: 99,
      updatedAt: '2026-03-12T00:00:00.000Z',
    }));

    await expect(fetchRoomMonitoringStatsFromKv(kv)).resolves.toEqual({
      activeConnections: 6,
      authenticatedConnections: 4,
      channels: 2,
      channelDetails: [
        { channel: 'beta', subscribers: 4 },
        { channel: 'alpha', subscribers: 2 },
      ],
    });
  });
});
