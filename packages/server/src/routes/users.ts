import type { Env } from '../types.js';
import { ensureAuthSchema } from '../lib/auth-d1.js';
import { resolveAuthDb, type AuthDb } from '../lib/auth-db-adapter.js';
import { getPublicProfileWithCache as getCachedPublicProfile } from '../lib/public-user-profile.js';

function getAuthDbFromEnv(env: unknown): AuthDb {
  return resolveAuthDb(env as Record<string, unknown>);
}

export async function getPublicProfileWithCache(
  userId: string,
  env: Env,
  executionCtx: ExecutionContext,
): Promise<Record<string, unknown> | null> {
  const authDb = getAuthDbFromEnv(env as unknown as Record<string, unknown>);
  await ensureAuthSchema(authDb);
  return getCachedPublicProfile(authDb, userId, {
    executionCtx,
    kv: env.KV,
  });
}
