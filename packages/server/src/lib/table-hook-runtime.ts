import type { EdgeBaseConfig, HookCtx } from '@edge-base/shared';
import { ensureAuthSchema } from './auth-d1.js';
import { resolveAuthDb, type AuthDb } from './auth-db-adapter.js';
import { sendToDatabaseLiveDO } from './database-live-emitter.js';
import { createPushProvider } from './push-provider.js';
import { getDevicesForUser } from './push-token.js';
import type { Env } from '../types.js';

type PushTokenStore = KVNamespace | { kv: KVNamespace; authDb?: AuthDb | null };

async function resolvePushTokenStore(env: Env): Promise<PushTokenStore | null> {
  if (!env.KV) {
    return null;
  }

  try {
    const authDb = resolveAuthDb(env as unknown as Record<string, unknown>);
    await ensureAuthSchema(authDb);
    return { kv: env.KV, authDb };
  } catch {
    return env.KV;
  }
}

export function buildTableHookRuntimeServices(
  config: EdgeBaseConfig,
  env: Env,
): Pick<HookCtx, 'databaseLive' | 'push'> {
  return {
    databaseLive: {
      async broadcast(channel: string, event: string, data: unknown): Promise<void> {
        await sendToDatabaseLiveDO(
          env,
          { channel, event, payload: data ?? {} },
          '/internal/broadcast',
        );
      },
    },
    push: {
      async send(userId: string, payload: { title?: string; body: string }): Promise<void> {
        try {
          const tokenStore = await resolvePushTokenStore(env);
          if (!tokenStore) return;

          const provider = createPushProvider(config.push, env);
          if (!provider) return;

          const devices = await getDevicesForUser(tokenStore, userId);
          if (devices.length === 0) return;

          await Promise.allSettled(
            devices.map((device) =>
              provider.send({ token: device.token, platform: device.platform, payload }),
            ),
          );
        } catch (error) {
          console.warn('[EdgeBase] table hook push.send failed:', error);
        }
      },
    },
  };
}
