import type { Env } from '../types.js';
import {
  MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST,
  type SelfHostScheduleRequestTarget,
} from '@edge-base/shared';
import { ensureServerStartup } from './runtime-startup.js';
import { executePluginMigrations } from './plugin-migrations.js';
import {
  buildFunctionContext,
  getFunctionsByTrigger,
  getWorkerUrl,
} from './functions.js';
import {
  createD1ScheduledDeliveryStore,
  executeScheduledDeliveries,
  executeWithTrackedWaitUntil,
  resolveManagedScheduledTargets,
  type ScheduledDeliveryReport,
} from './scheduled-delivery.js';
import { parseDuration } from './jwt.js';
import * as authService from './auth-d1-service.js';
import { deleteAnon, ensureAuthSchema } from './auth-d1.js';
import { resolveAuthDb } from './auth-db-adapter.js';
import { resolveRootServiceKey } from './service-key.js';
import { parseConfig } from './do-router.js';
import { cleanupExpiredSignedUploadGrants } from './signed-upload-grants.js';

export interface ManagedScheduledRuntimeEnvelope {
  cron: string;
  scheduledTime: number;
  /** Exact manifest-owned subset. Hosted provider wakes omit this to run all owners. */
  targets?: SelfHostScheduleRequestTarget[];
}

/**
 * Execute one bounded, exact set of managed cron identities.
 *
 * Provider wakes and the authenticated self-host control plane share this
 * implementation so routing, durable completion, and reconciliation cannot
 * drift between hosted and appliance runtimes.
 */
export async function executeManagedScheduledEnvelopes(
  events: ManagedScheduledRuntimeEnvelope[],
  env: Env,
  executionContext?: Pick<ExecutionContext, 'waitUntil'>,
): Promise<ScheduledDeliveryReport> {
  await ensureServerStartup();
  const config = parseConfig(env);
  const scheduleFns = getFunctionsByTrigger('schedule');
  const pluginFunctions = new Map<string, { pluginName: string; functionName: string }>();
  for (const plugin of config.plugins ?? []) {
    for (const functionName of Object.keys(plugin.functions ?? {})) {
      pluginFunctions.set(`${plugin.name}/${functionName}`, {
        pluginName: plugin.name,
        functionName,
      });
    }
  }

  const resolved = events.map((event) => {
    const runtimeTargets = resolveManagedScheduledTargets({
      cron: event.cron,
      functions: scheduleFns,
      pluginFunctions,
      extraCrons: config.cloudflare?.extraCrons,
    });
    if (runtimeTargets.length === 0) {
      throw new Error(`No managed schedule owns triggering cron '${event.cron}'.`);
    }
    const runtimeById = new Map(runtimeTargets.map((target) => [target.id, target]));
    const targets = event.targets === undefined
      ? runtimeTargets.map((target) => ({ target, mode: 'execute' as const }))
      : event.targets.map((requested, index) => {
        const target = runtimeById.get(requested.id);
        if (!target) {
          throw new Error(
            `Requested schedule target '${requested.id}' is not owned by cron '${event.cron}' at runtime.`,
          );
        }
        if (event.targets?.findIndex(({ id }) => id === requested.id) !== index) {
          throw new Error(`Requested schedule target '${requested.id}' is duplicated.`);
        }
        return { target, mode: requested.mode };
      });
    return { event, targets };
  });

  const requestedTargetCount = resolved.reduce((count, { targets }) => count + targets.length, 0);
  if (requestedTargetCount > MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST) {
    throw new Error(
      `Managed schedule request contains ${requestedTargetCount} targets; maximum is ${MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST}.`,
    );
  }

  const systemEvent = resolved.some(({ targets }) => (
    targets.some(({ target, mode }) => mode === 'execute' && target.lane === 'system')
  ));
  const ownedPluginNames = new Set(
    resolved.flatMap(({ targets }) => targets)
      .filter(({ target, mode }) => mode === 'execute' && target.lane === 'plugin-function' && target.name)
      .map(({ target }) => pluginFunctions.get(target.name as string)?.pluginName)
      .filter((name): name is string => Boolean(name)),
  );
  const pluginsToMigrate = systemEvent
    ? (config.plugins ?? [])
    : (config.plugins ?? []).filter((plugin) => ownedPluginNames.has(plugin.name));
  if (pluginsToMigrate.length > 0) {
    await executePluginMigrations(
      pluginsToMigrate,
      env,
      config,
      getWorkerUrl('http://internal/scheduled', env),
    );
  }

  const timeoutStr = config.functions?.scheduleFunctionTimeout ?? '10s';
  const timeoutMs = parseDuration(timeoutStr) * 1000;
  const store = createD1ScheduledDeliveryStore(env);
  if (systemEvent) await store.prune?.(Date.now());

  const envelopes = resolved.map(({ event, targets }) => {
    const scheduledDate = new Date(event.scheduledTime);
    const runSystemMaintenance = async (): Promise<void> => {
      const operations = [
        (async () => {
          const authDb = resolveAuthDb(env as unknown as Record<string, unknown>);
          await ensureAuthSchema(authDb);
          await authService.cleanExpiredSessions(authDb);
          if (config.auth?.anonymousAuth) {
            const retentionDays = config.auth.anonymousRetentionDays ?? 30;
            const deletedIds = await authService.cleanStaleAnonymousAccounts(authDb, retentionDays);
            for (const id of deletedIds) await deleteAnon(authDb, id).catch(() => {});
          }
        })(),
        (async () => {
          if (env.STORAGE) {
            await cleanupExpiredSignedUploadGrants(env.STORAGE, event.scheduledTime);
          }
        })(),
      ];
      const settled = await Promise.allSettled(operations);
      const failures = settled
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason);
      if (failures.length > 0) {
        throw new AggregateError(failures, 'EdgeBase scheduled system maintenance failed.');
      }
    };

    return {
      cron: event.cron,
      scheduledTime: event.scheduledTime,
      items: targets.map(({ target, mode }) => ({
        id: target.id,
        lane: target.lane,
        mode,
        run: async (metadata: {
          cron: string;
          scheduledTime: number;
          itemId: string;
          attempt: number;
          deliveryId: string;
        }) => {
          if (target.lane === 'system') {
            await runSystemMaintenance();
            return;
          }
          if (!target.definition || !target.name) return;
          await executeWithTrackedWaitUntil(async (executionContext) => {
            const fnCtx = buildFunctionContext({
              request: new Request(`http://internal/schedule/${encodeURIComponent(target.name as string)}`),
              auth: null,
              databaseNamespace: env.DATABASE,
              authNamespace: env.AUTH,
              d1Database: env.AUTH_DB,
              kvNamespace: env.KV,
              env: env as never,
              executionCtx: executionContext as never,
              config,
              serviceKey: resolveRootServiceKey(config, env),
              data: {
                before: undefined,
                after: {
                  scheduledTime: scheduledDate.toISOString(),
                  cron: metadata.cron,
                  scheduleIdentity: metadata.itemId,
                  deliveryId: metadata.deliveryId,
                  attempt: metadata.attempt,
                },
              },
            });
            await target.definition?.handler(fnCtx);
          });
        },
      })),
    };
  });

  const report = await executeScheduledDeliveries(envelopes, {
    store,
    timeoutMs,
    ...(executionContext
      ? { waitUntil: (promise: Promise<unknown>) => executionContext.waitUntil(promise) }
      : {}),
  });
  console.info('[EdgeBase] Scheduled delivery completion', JSON.stringify({
    complete: report.complete,
    outcomes: report.outcomes.map(({
      cron,
      scheduledTime,
      itemId,
      lane,
      status,
      attempt,
      executed,
      retryable,
      error,
    }) => ({
      cron,
      scheduledTime,
      itemId,
      lane,
      status,
      attempt,
      executed,
      retryable,
      ...(error ? { error } : {}),
    })),
  }));
  return report;
}
