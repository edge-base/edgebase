import { OpenAPIHono, type HonoEnv } from './lib/hono.js';
import { HTTPException } from 'hono/http-exception';
import { initFunctionRegistry } from './_functions-registry.js';
import { corsMiddleware } from './middleware/cors.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { errorHandlerMiddleware } from './middleware/error-handler.js';
import { internalGuardMiddleware } from './middleware/internal-guard.js';
import { authMiddleware } from './middleware/auth.js';
import { rulesMiddleware } from './middleware/rules.js';

import { loggerMiddleware } from './middleware/logger.js';
import { EdgeBaseError } from '@edge-base/shared';
import { SERVER_VERSION } from './lib/version.js';
import { healthRoute } from './routes/health.js';
import { tablesRoute } from './routes/tables.js';
import { schemaRoute } from './routes/schema-endpoint.js';
import { authRoute } from './routes/auth.js';
import { adminAuthRoute } from './routes/admin-auth.js';
import { oauthRoute } from './routes/oauth.js';
import { databaseLiveRoute } from './routes/database-live.js';
import { storageRoute } from './routes/storage.js';
import { functionsRoute } from './routes/functions.js';
import { adminRoute } from './routes/admin.js';
import { backupRoute } from './routes/backup.js';
import { sqlRoute } from './routes/sql.js';
import { kvRoute } from './routes/kv.js';
import { d1Route } from './routes/d1.js';
import { vectorizeRoute } from './routes/vectorize.js';
import { configRoute } from './routes/config.js';
import { pushRoute } from './routes/push.js';
import { roomRoute } from './routes/room.js';
import { analyticsApi } from './routes/analytics-api.js';
import { parseConfig, setConfig } from './lib/do-router.js';
import { createAdminAssetRequest } from './lib/admin-assets.js';
import { resolveAdminFaviconTarget, resolveAdminRedirectTarget } from './lib/admin-routing.js';
import { zodDefaultHook } from './lib/schemas.js';
import { executePluginMigrations } from './lib/plugin-migrations.js';
import { shouldRunPluginMigrationsForRequestPath } from './lib/plugin-migration-routing.js';
import { getFunctionsByTrigger, buildFunctionContext, getWorkerUrl } from './lib/functions.js';
import { parseCron, matchesCron } from './lib/cron.js';
import { parseDuration } from './lib/jwt.js';
import { resolveStartupConfig } from './lib/startup-config.js';
import * as authService from './lib/auth-d1-service.js';
import { ensureAuthSchema, deleteAnon } from './lib/auth-d1.js';
import { resolveAuthDb } from './lib/auth-db-adapter.js';
import { resolveRootServiceKey } from './lib/service-key.js';
import { normalizeOpenApiDocument, type OpenApiSpec } from './lib/openapi.js';
import generatedConfig from './generated-config.js';
import type { Env } from './types.js';

// Compile-time constant — injected by wrangler [define] in wrangler.test.toml
declare const EDGEBASE_TEST_BUILD: boolean | undefined;

// ─── DO Re-exports (wrangler needs exports from main entry) ───
export { DatabaseDO } from './durable-objects/database-do.js';
export { DatabaseLiveDO } from './durable-objects/database-live-do.js';
export { AuthDO } from './durable-objects/auth-do.js';
export { RoomsDO } from './durable-objects/rooms-do.js';
export { LogsDO } from './durable-objects/logs-do.js';

try {
  const processEnv = typeof process !== 'undefined' ? process.env : undefined;
  // EDGEBASE_TEST_BUILD is a compile-time constant injected by wrangler [define]
  // in wrangler.test.toml. typeof is safe for undefined identifiers.
  const isTestBuild = typeof EDGEBASE_TEST_BUILD !== 'undefined';
  const preferTestConfig = await detectWorkersTestRuntime() || isTestBuild;
  const resolvedConfig = await resolveStartupConfig(
    generatedConfig,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async () => import('../edgebase.test.config.ts' as any),
    processEnv,
    { preferTestConfig },
  );

  if (resolvedConfig) {
    setConfig(resolvedConfig);
  }
} catch (err) {
  console.error('[EdgeBase] Failed to initialize config at startup:', err);
  throw err;
}

async function detectWorkersTestRuntime(): Promise<boolean> {
  try {
    await import('cloudflare:test');
    return true;
  } catch {
    return false;
  }
}

initFunctionRegistry();

const app = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

// ─── Global Middleware Chain ───
// Order: Error Handler → Logger → CORS → Strip Internal Header → Rate Limit → Auth → Context → Rules

app.use('*', errorHandlerMiddleware);
app.use('*', loggerMiddleware);
app.use('*', corsMiddleware);

// NOTE: X-EdgeBase-Internal header stripping via c.req.raw.headers.delete() is NOT
// possible in Workers — Request.headers are immutable. Instead, the internal guard
// middleware below rejects any request with this header unless it comes via internal
// stub.fetch (which is allowed by the x-internal whitelist). No stripping needed.

// Plugin migration middleware — lazily reconciles plugin control state before
// routes that can execute plugin code or touch plugin-managed tables.
app.use('*', async (c, next) => {
  const config = parseConfig(c.env);
  const requestPath = new URL(c.req.url).pathname;
  if (config?.plugins?.length && shouldRunPluginMigrationsForRequestPath(requestPath)) {
    await executePluginMigrations(config.plugins, c.env, config, getWorkerUrl(c.req.url, c.env));
  }
  return next();
});

app.use('*', rateLimitMiddleware);

// Auth middleware — JWT verification + auth context injection (M3)
app.use('/api/*', authMiddleware);

// Context middleware removed — DB-level access rules (§4,) handle multi-tenancy.

// Rules middleware — access rules evaluation (M4,)
app.use('/api/db/*', rulesMiddleware);

// ─── Internal Guard ───
app.use('/internal/*', internalGuardMiddleware);

// ─── Routes ───
app.route('/api', healthRoute);
app.route('/api/auth', authRoute);
app.route('/api/auth/admin', adminAuthRoute);
app.route('/api/auth/oauth', oauthRoute);
app.route('/api/db', tablesRoute);
app.route('/api/db', databaseLiveRoute);
app.route('/api/schema', schemaRoute);
app.route('/api/storage', storageRoute);
app.route('/api/functions', functionsRoute);
app.route('/api/sql', sqlRoute);
app.route('/api/kv', kvRoute);
app.route('/api/d1', d1Route);
app.route('/api/vectorize', vectorizeRoute);
app.route('/api/config', configRoute);
app.route('/api/push', pushRoute);
app.route('/api/room', roomRoute);
app.route('/api/analytics', analyticsApi);
// ─── Admin Dashboard (M12,) ───
app.route('/admin/api', adminRoute);
app.route('/admin/api/backup', backupRoute);

app.get('/', (c) => {
  const externalAdminUrl = resolveAdminRedirectTarget(c.req.url, c.env.ADMIN_ORIGIN);
  if (externalAdminUrl) {
    return c.redirect(externalAdminUrl, 302);
  }
  if (c.env.ASSETS) {
    return c.redirect('/admin', 302);
  }
  return c.json({
    name: 'EdgeBase API',
    docs: '/openapi.json',
    admin: null,
  });
});

// Admin static assets — SvelteKit SPA served via Workers Static Assets
app.get('/favicon.ico', async (c) => {
  const externalFaviconUrl = resolveAdminFaviconTarget(c.env.ADMIN_ORIGIN);
  if (externalFaviconUrl) {
    return c.redirect(externalFaviconUrl, 302);
  }

  if (!c.env.ASSETS) {
    return c.json({ code: 404, message: 'Admin dashboard not deployed.' }, 404);
  }

  const url = new URL(c.req.url);
  url.pathname = '/admin/favicon.svg';
  return c.env.ASSETS.fetch(createAdminAssetRequest(new Request(url.toString(), c.req.raw)));
});

app.get('/favicon.svg', async (c) => {
  const externalFaviconUrl = resolveAdminFaviconTarget(c.env.ADMIN_ORIGIN);
  if (externalFaviconUrl) {
    return c.redirect(externalFaviconUrl, 302);
  }

  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }

  return c.json({ code: 404, message: 'Admin dashboard not deployed.' }, 404);
});

app.get('/_app/*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }

  return c.json({ code: 404, message: 'Admin dashboard not deployed.' }, 404);
});

app.get('/admin/*', async (c) => {
  const externalAdminUrl = resolveAdminRedirectTarget(c.req.url, c.env.ADMIN_ORIGIN);
  if (externalAdminUrl) {
    return c.redirect(externalAdminUrl, 302);
  }
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(createAdminAssetRequest(c.req.raw));
  }
  return c.json({ code: 404, message: 'Admin dashboard not deployed.' }, 404);
});
app.get('/admin', async (c) => {
  const externalAdminUrl = resolveAdminRedirectTarget(c.req.url, c.env.ADMIN_ORIGIN);
  if (externalAdminUrl) {
    return c.redirect(externalAdminUrl, 302);
  }
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(createAdminAssetRequest(c.req.raw));
  }
  return c.json({ code: 404, message: 'Admin dashboard not deployed.' }, 404);
});

app.get('/harness', (c) => {
  return c.redirect('/harness/', 302);
});
app.get('/harness/', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.json({ code: 404, message: 'Harness assets not deployed.' }, 404);
});
app.get('/harness/assets/*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.json({ code: 404, message: 'Harness assets not deployed.' }, 404);
});
app.get('/harness/*', (c) => {
  return c.redirect('/harness/', 302);
});

// ─── OpenAPI Spec ───
app.get('/openapi.json', (c) => {
  const spec = app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: { title: 'EdgeBase API', version: SERVER_VERSION },
  });

  return c.json(normalizeOpenApiDocument(spec as OpenApiSpec, new URL(c.req.url).origin));
});

// ─── 404 Fallback ───
app.notFound((c) => {
  return c.json({ code: 404, message: 'Not found.' }, 404);
});

// ─── Hono-level onError (safety net for Workers cross-module instanceof issues) ───
app.onError((err, c) => {
  if (err instanceof SyntaxError) {
    return c.json(
      {
        code: 400,
        message: 'Invalid JSON payload. Please ensure your request body is valid JSON.',
      },
      400,
    );
  }
  if (err instanceof EdgeBaseError) {
    return c.json(err.toJSON(), err.code as 400);
  }
  // Hono HTTPException (thrown by @hono/zod-openapi validators on malformed JSON, etc.)
  if (err instanceof HTTPException) {
    return c.json({ code: err.status, message: err.message }, err.status as 400);
  }
  // Duck-type fallback
  const e = err as unknown as Record<string, unknown>;
  if (
    typeof e.code === 'number' &&
    e.code >= 400 &&
    e.code < 600 &&
    typeof e.message === 'string'
  ) {
    const body: { code: number; message: string; data?: unknown } = {
      code: e.code as number,
      message: e.message as string,
    };
    if (e.data) body.data = e.data;
    return c.json(body, e.code as number as 400);
  }
  console.error('Unhandled error:', err);
  return c.json({ code: 500, message: 'Internal server error.' }, 500);
});

export default {
  fetch: app.fetch,

  /**
   * Cloudflare Cron Triggers — replaces db:_system alarm-based scheduling.
   * CLI generates [triggers] section in wrangler.toml from config schedule functions.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const config = parseConfig(env);
    if (config.plugins?.length) {
      await executePluginMigrations(
        config.plugins,
        env,
        config,
        getWorkerUrl('http://internal/scheduled', env),
      );
    }
    const scheduleFns = getFunctionsByTrigger('schedule');

    const now = new Date(event.scheduledTime);

    // Schedule function timeout (default: 10s)
    const timeoutStr = config.functions?.scheduleFunctionTimeout ?? '10s';
    const timeoutMs = parseDuration(timeoutStr) * 1000;

    // ── System cron: session cleanup + anonymous account cleanup ──
    ctx.waitUntil(
      (async () => {
        try {
          const authDb = resolveAuthDb(env as unknown as Record<string, unknown>);
          await ensureAuthSchema(authDb);
          // Clean expired sessions
          await authService.cleanExpiredSessions(authDb);
          // Clean stale anonymous accounts
          if (config?.auth?.anonymousAuth) {
            const retentionDays = config.auth.anonymousRetentionDays ?? 30;
            const deletedIds = await authService.cleanStaleAnonymousAccounts(authDb, retentionDays);
            for (const id of deletedIds) {
              await deleteAnon(authDb, id).catch(() => {});
            }
          }
        } catch (err) {
          console.error('[EdgeBase] Session/anonymous cleanup failed:', err);
        }
      })(),
    );

    if (scheduleFns.length === 0) return;

    for (const { name, definition } of scheduleFns) {
      const trigger = definition.trigger as { type: 'schedule'; cron: string };
      try {
        const schedule = parseCron(trigger.cron);
        if (!matchesCron(now, schedule)) continue;

        const fnCtx = buildFunctionContext({
          request: new Request('http://internal/schedule/' + name),
          auth: null,
          databaseNamespace: env.DATABASE,
          authNamespace: env.AUTH,
          d1Database: env.AUTH_DB,
          kvNamespace: env.KV,
          env: env as never,
          executionCtx: ctx as never,
          config,
          serviceKey: resolveRootServiceKey(config, env),
          data: {
            before: undefined,
            after: { scheduledTime: now.toISOString(), cron: trigger.cron },
          },
        });

        ctx.waitUntil(
          Promise.race([
            definition.handler(fnCtx),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error(`Schedule function '${name}' timed out (${timeoutStr})`)),
                timeoutMs,
              ),
            ),
          ]).catch((err) => {
            console.error(`[EdgeBase] Schedule function '${name}' failed:`, err);
          }),
        );
      } catch (err) {
        console.error(`[EdgeBase] Schedule function '${name}' failed:`, err);
      }
    }
  },
};
