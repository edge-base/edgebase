import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthDb } from '../lib/auth-db-adapter.js';
import {
  deletePublicUserProjection,
  getPublicProfileWithCache,
  invalidatePublicUserCache,
  queuePublicUserProjectionDelete,
  queuePublicUserProjectionSync,
  syncPublicUserProjection,
} from '../lib/public-user-profile.js';

type PublicProfile = Record<string, unknown>;

function createMockAuthDb(
  initialProfiles: Array<[string, PublicProfile]> = [],
): AuthDb & {
  _profiles: Map<string, PublicProfile>;
  _firstCalls: number;
} {
  const profiles = new Map(initialProfiles);
  let firstCalls = 0;

  const db = {
    dialect: 'sqlite' as const,
    async query<T = Record<string, unknown>>(): Promise<T[]> {
      return [];
    },
    async first<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
      firstCalls++;
      if (sql.includes('FROM _users_public WHERE id = ?')) {
        return (profiles.get(String(params?.[0] ?? '')) ?? null) as T | null;
      }
      return null;
    },
    async run(sql: string, params?: unknown[]): Promise<void> {
      if (sql.includes('INSERT OR REPLACE INTO _users_public')) {
        const [userId, email, displayName, avatarUrl, role, isAnonymous, createdAt, updatedAt] = params ?? [];
        profiles.set(String(userId), {
          id: userId,
          email,
          displayName,
          avatarUrl,
          role,
          isAnonymous,
          createdAt,
          updatedAt,
        });
        return;
      }
      if (sql.includes('DELETE FROM _users_public WHERE id = ?')) {
        profiles.delete(String(params?.[0] ?? ''));
      }
    },
    async batch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
      for (const statement of statements) {
        if (statement.sql.includes('DELETE FROM _users_public WHERE id = ?')) {
          profiles.delete(String(statement.params?.[0] ?? ''));
        }
      }
    },
    _profiles: profiles,
    get _firstCalls() {
      return firstCalls;
    },
  };

  return db;
}

function createMockKv(options: {
  putError?: Error;
  deleteError?: Error;
  initial?: Record<string, string>;
} = {}): KVNamespace & { _store: Record<string, string> } {
  const store = { ...(options.initial ?? {}) };
  return {
    get: async (key: string) => store[key] ?? null,
    put: async (key: string, value: string) => {
      if (options.putError) throw options.putError;
      store[key] = value;
    },
    delete: async (key: string) => {
      if (options.deleteError) throw options.deleteError;
      delete store[key];
    },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
    _store: store,
  } as unknown as KVNamespace & { _store: Record<string, string> };
}

function createExecutionContext(): {
  ctx: ExecutionContext;
  pending: Promise<unknown>[];
} {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    ctx: {
      waitUntil(promise: Promise<unknown>) {
        pending.push(Promise.resolve(promise));
      },
    } as ExecutionContext,
  };
}

let userIdCounter = 0;

function nextUserId(): string {
  userIdCounter += 1;
  return `public-user-${userIdCounter}`;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getPublicProfileWithCache', () => {
  it('reads from auth DB once and then serves the L1 cache', async () => {
    const userId = nextUserId();
    const profile = {
      id: userId,
      email: 'public@example.com',
      displayName: 'Public User',
      avatarUrl: null,
      role: 'user',
      isAnonymous: 0,
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
    };
    const authDb = createMockAuthDb([[userId, profile]]);

    const first = await getPublicProfileWithCache(authDb, userId, {});
    authDb._profiles.delete(userId);
    const second = await getPublicProfileWithCache(authDb, userId, {});

    expect(first).toEqual(profile);
    expect(second).toEqual(profile);
    expect(authDb._firstCalls).toBe(1);
  });

  it('treats KV population failures as best-effort when no execution context is available', async () => {
    const userId = nextUserId();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const authDb = createMockAuthDb([[
      userId,
      {
        id: userId,
        email: null,
        displayName: 'KV Fallback',
        avatarUrl: null,
        role: 'user',
        isAnonymous: 0,
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      },
    ]]);
    const kv = createMockKv({ putError: new Error('kv-put-failed') });

    await expect(getPublicProfileWithCache(authDb, userId, { kv })).resolves.toMatchObject({
      id: userId,
      displayName: 'KV Fallback',
    });

    await flushMicrotasks();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('syncPublicUserProjection', () => {
  it('writes the auth projection and mirrors KV via waitUntil', async () => {
    const userId = nextUserId();
    const authDb = createMockAuthDb();
    const kv = createMockKv();
    const { ctx, pending } = createExecutionContext();
    const profile = {
      email: 'public@example.com',
      displayName: 'Mirror User',
      avatarUrl: null,
      role: 'admin',
      isAnonymous: 0,
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
    };

    await syncPublicUserProjection(authDb, userId, profile, {
      kv,
      executionCtx: ctx,
      awaitCacheWrites: false,
    });

    expect(authDb._profiles.get(userId)).toEqual({ id: userId, ...profile });
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(JSON.parse(kv._store[`kv:users_public:${userId}`])).toEqual({ id: userId, ...profile });
  });

  it('does not fail the caller when KV mirroring rejects without an execution context', async () => {
    const userId = nextUserId();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const authDb = createMockAuthDb();
    const kv = createMockKv({ putError: new Error('kv-put-failed') });

    await expect(syncPublicUserProjection(authDb, userId, {
      displayName: 'Best Effort Sync',
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
    }, { kv })).resolves.toBeUndefined();

    expect(authDb._profiles.get(userId)).toMatchObject({ id: userId, displayName: 'Best Effort Sync' });
    await flushMicrotasks();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('queuePublicUserProjectionSync', () => {
  it('queues projection syncing without surfacing async failures to the caller', async () => {
    const userId = nextUserId();
    const authDb = createMockAuthDb();
    const kv = createMockKv();
    const { ctx, pending } = createExecutionContext();

    queuePublicUserProjectionSync(authDb, userId, {
      displayName: 'Queued Sync',
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
    }, {
      kv,
      executionCtx: ctx,
    });

    await flushMicrotasks();
    await Promise.all(pending);
    expect(authDb._profiles.get(userId)).toMatchObject({ id: userId, displayName: 'Queued Sync' });
    expect(JSON.parse(kv._store[`kv:users_public:${userId}`])).toMatchObject({ id: userId, displayName: 'Queued Sync' });
  });
});

describe('deletePublicUserProjection', () => {
  it('removes the auth projection and treats cache invalidation as best-effort', async () => {
    const userId = nextUserId();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const authDb = createMockAuthDb([[
      userId,
      {
        id: userId,
        email: null,
        displayName: 'To Delete',
        avatarUrl: null,
        role: 'user',
        isAnonymous: 0,
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      },
    ]]);
    const kv = createMockKv({
      deleteError: new Error('kv-delete-failed'),
      initial: {
        [`kv:users_public:${userId}`]: JSON.stringify({ id: userId, displayName: 'To Delete' }),
      },
    });

    await expect(deletePublicUserProjection(authDb, userId, { kv })).resolves.toBeUndefined();

    expect(authDb._profiles.has(userId)).toBe(false);
    await flushMicrotasks();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('invalidatePublicUserCache', () => {
  it('clears the in-memory cache and removes the KV mirror', async () => {
    const userId = nextUserId();
    const authDb = createMockAuthDb([[
      userId,
      {
        id: userId,
        email: null,
        displayName: 'Invalidate Cache',
        avatarUrl: null,
        role: 'user',
        isAnonymous: 0,
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      },
    ]]);
    const kv = createMockKv();

    await getPublicProfileWithCache(authDb, userId, { kv });
    await flushMicrotasks();
    authDb._profiles.delete(userId);

    await invalidatePublicUserCache(userId, { kv });

    const profileAfterInvalidation = await getPublicProfileWithCache(authDb, userId, { kv });
    expect(profileAfterInvalidation).toBeNull();
    expect(kv._store[`kv:users_public:${userId}`]).toBeUndefined();
  });
});

describe('queuePublicUserProjectionDelete', () => {
  it('queues cache invalidation and projection deletion in the background', async () => {
    const userId = nextUserId();
    const authDb = createMockAuthDb([[
      userId,
      {
        id: userId,
        email: null,
        displayName: 'Queued Delete',
        avatarUrl: null,
        role: 'user',
        isAnonymous: 0,
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      },
    ]]);
    const kv = createMockKv({
      initial: {
        [`kv:users_public:${userId}`]: JSON.stringify({ id: userId, displayName: 'Queued Delete' }),
      },
    });
    const { ctx, pending } = createExecutionContext();

    queuePublicUserProjectionDelete(authDb, userId, {
      kv,
      executionCtx: ctx,
    });

    await flushMicrotasks();
    await Promise.all(pending);
    expect(authDb._profiles.has(userId)).toBe(false);
    expect(kv._store[`kv:users_public:${userId}`]).toBeUndefined();
  });
});
