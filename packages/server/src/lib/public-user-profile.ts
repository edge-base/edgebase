import type { AuthDb } from './auth-db-adapter.js';
import { batchDeleteUserPublic, upsertUserPublic } from './auth-d1.js';
import type { UserPublicData } from './auth-d1.js';

const L1_TTL_MS = 60_000;
const L1_MAX = 500;
const KV_TTL_SECONDS = 3600;

type PublicProfile = Record<string, unknown>;

interface CacheEntry {
  data: PublicProfile;
  expiresAt: number;
}

interface PublicProfileOptions {
  executionCtx?: ExecutionContext;
  kv?: KVNamespace;
}

interface SyncPublicProfileOptions extends PublicProfileOptions {
  awaitCacheWrites?: boolean;
}

const l1Cache = new Map<string, CacheEntry>();

function kvKey(userId: string): string {
  return `kv:users_public:${userId}`;
}

function l1Get(userId: string): PublicProfile | null {
  const entry = l1Cache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    l1Cache.delete(userId);
    return null;
  }
  return entry.data;
}

function l1Set(userId: string, data: PublicProfile): void {
  if (l1Cache.size >= L1_MAX) {
    const firstKey = l1Cache.keys().next().value;
    if (firstKey !== undefined) l1Cache.delete(firstKey);
  }
  l1Cache.set(userId, { data, expiresAt: Date.now() + L1_TTL_MS });
}

function l1Delete(userId: string): void {
  l1Cache.delete(userId);
}

async function runOrSchedule(
  promiseFactory: () => Promise<void>,
  options: SyncPublicProfileOptions,
  errorMessage: string,
): Promise<void> {
  const task = Promise.resolve().then(promiseFactory);
  if (options.awaitCacheWrites) {
    await task;
    return;
  }

  const handledTask = task.catch((err) => {
    console.error(errorMessage, err);
  });

  if (options.executionCtx) {
    options.executionCtx.waitUntil(handledTask);
    return;
  }

  void handledTask;
}

export async function getPublicProfileWithCache(
  authDb: AuthDb,
  userId: string,
  options: PublicProfileOptions,
): Promise<PublicProfile | null> {
  const cached = l1Get(userId);
  if (cached) return cached;

  if (options.kv) {
    const kvRaw = await options.kv.get(kvKey(userId), 'json').catch(() => null);
    if (kvRaw) {
      const profile = kvRaw as PublicProfile;
      l1Set(userId, profile);
      return profile;
    }
  }

  const profile = await authDb.first<PublicProfile>(
    'SELECT id, email, displayName, avatarUrl, role, isAnonymous, createdAt, updatedAt FROM _users_public WHERE id = ?',
    [userId],
  );

  if (!profile) return null;

  l1Set(userId, profile);

  if (options.kv) {
    await runOrSchedule(
      () =>
        options.kv!.put(kvKey(userId), JSON.stringify(profile), {
          expirationTtl: KV_TTL_SECONDS,
        }),
      { ...options, awaitCacheWrites: false },
      `[EdgeBase] Failed to populate public profile cache for ${userId}:`,
    );
  }

  return profile;
}

export async function syncPublicUserProjection(
  authDb: AuthDb,
  userId: string,
  profile: PublicProfile,
  options: SyncPublicProfileOptions = {},
): Promise<void> {
  await upsertUserPublic(authDb, userId, profile as unknown as UserPublicData);
  const cachedProfile: PublicProfile = { id: userId, ...profile };
  l1Set(userId, cachedProfile);

  if (!options.kv) return;

  await runOrSchedule(
    () =>
      options.kv!.put(kvKey(userId), JSON.stringify(cachedProfile), {
        expirationTtl: KV_TTL_SECONDS,
      }),
    options,
    `[EdgeBase] Failed to write public profile cache for ${userId}:`,
  );
}

export async function invalidatePublicUserCache(
  userId: string,
  options: SyncPublicProfileOptions = {},
): Promise<void> {
  l1Delete(userId);

  if (!options.kv) return;

  await runOrSchedule(
    () => options.kv!.delete(kvKey(userId)),
    options,
    `[EdgeBase] Failed to invalidate public profile cache for ${userId}:`,
  );
}

export function queuePublicUserProjectionSync(
  authDb: AuthDb,
  userId: string,
  profile: PublicProfile,
  options: PublicProfileOptions,
): void {
  void syncPublicUserProjection(authDb, userId, profile, {
    ...options,
    awaitCacheWrites: false,
  }).catch((err) => {
    console.error(`[EdgeBase] Failed to sync public user projection for ${userId}:`, err);
  });
}

export async function deletePublicUserProjection(
  authDb: AuthDb,
  userId: string,
  options: SyncPublicProfileOptions = {},
): Promise<void> {
  await batchDeleteUserPublic(authDb, [userId]);
  await invalidatePublicUserCache(userId, options);
}

export function queuePublicUserProjectionDelete(
  authDb: AuthDb,
  userId: string,
  options: PublicProfileOptions,
): void {
  void deletePublicUserProjection(authDb, userId, {
    ...options,
    awaitCacheWrites: false,
  }).catch((err) => {
    console.error(`[EdgeBase] Failed to delete public user projection for ${userId}:`, err);
  });
}
