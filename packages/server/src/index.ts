import type { HonoEnv } from './lib/hono.js';
import type { OpenApiSpec } from './lib/openapi.js';
import type { Env } from './types.js';

// Compile-time constant — injected by wrangler [define] in wrangler.test.toml
declare const EDGEBASE_TEST_BUILD: boolean | undefined;

// ─── DO Re-exports (wrangler needs exports from main entry) ───
export { DatabaseDO } from './durable-objects/database-do.js';
export { DatabaseLiveDO } from './durable-objects/database-live-do.js';
export { AuthDO } from './durable-objects/auth-do.js';
export { RoomsDO } from './durable-objects/rooms-do.js';
export { LogsDO } from './durable-objects/logs-do.js';

let startupPromise: Promise<void> | null = null;
let appPromise: Promise<Awaited<ReturnType<typeof buildApp>>> | null = null;

async function detectWorkersTestRuntime(): Promise<boolean> {
  try {
    await import('cloudflare:test');
    return true;
  } catch {
    return false;
  }
}

async function ensureServerStartup(): Promise<void> {
  if (startupPromise) {
    return startupPromise;
  }

  startupPromise = (async () => {
    const [{ resolveStartupConfig }, generatedConfigModule, { initFunctionRegistry }, doRouterModule] = await Promise.all([
      import('./lib/startup-config.js'),
      import('./generated-config.js'),
      import('./_functions-registry.js'),
      import('./lib/do-router.js'),
    ]);

    try {
      const processEnv = typeof process !== 'undefined' ? process.env : undefined;
      const isTestBuild = typeof EDGEBASE_TEST_BUILD !== 'undefined';
      const preferTestConfig = await detectWorkersTestRuntime() || isTestBuild;
      const resolvedConfig = await resolveStartupConfig(
        generatedConfigModule.default,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async () => import('../edgebase.test.config.ts' as any),
        processEnv,
        { preferTestConfig },
      );

      if (resolvedConfig) {
        doRouterModule.setConfig(resolvedConfig);
      }
    } catch (err) {
      console.error('[EdgeBase] Failed to initialize config at startup:', err);
      throw err;
    }

    initFunctionRegistry();
  })();

  return startupPromise;
}

async function buildApp() {
    await ensureServerStartup();

    const [
      honoModule,
      httpExceptionModule,
      functionsRegistryModule,
      corsModule,
      rateLimitModule,
      errorHandlerModule,
      internalGuardModule,
      authMiddlewareModule,
      rulesMiddlewareModule,
      loggerModule,
      sharedModule,
      versionModule,
      healthRouteModule,
      tablesRouteModule,
      schemaRouteModule,
      authRouteModule,
      adminAuthRouteModule,
      oauthRouteModule,
      databaseLiveRouteModule,
      storageRouteModule,
      functionsRouteModule,
      adminRouteModule,
      backupRouteModule,
      sqlRouteModule,
      kvRouteModule,
      d1RouteModule,
      vectorizeRouteModule,
      configRouteModule,
      pushRouteModule,
      roomRouteModule,
      analyticsRouteModule,
      adminAssetsModule,
      adminRoutingModule,
      schemasModule,
      pluginMigrationsModule,
      pluginMigrationRoutingModule,
      functionsModule,
      openApiModule,
      doRouterModule,
    ] = await Promise.all([
      import('./lib/hono.js'),
      import('hono/http-exception'),
      import('./_functions-registry.js'),
      import('./middleware/cors.js'),
      import('./middleware/rate-limit.js'),
      import('./middleware/error-handler.js'),
      import('./middleware/internal-guard.js'),
      import('./middleware/auth.js'),
      import('./middleware/rules.js'),
      import('./middleware/logger.js'),
      import('@edge-base/shared'),
      import('./lib/version.js'),
      import('./routes/health.js'),
      import('./routes/tables.js'),
      import('./routes/schema-endpoint.js'),
      import('./routes/auth.js'),
      import('./routes/admin-auth.js'),
      import('./routes/oauth.js'),
      import('./routes/database-live.js'),
      import('./routes/storage.js'),
      import('./routes/functions.js'),
      import('./routes/admin.js'),
      import('./routes/backup.js'),
      import('./routes/sql.js'),
      import('./routes/kv.js'),
      import('./routes/d1.js'),
      import('./routes/vectorize.js'),
      import('./routes/config.js'),
      import('./routes/push.js'),
      import('./routes/room.js'),
      import('./routes/analytics-api.js'),
      import('./lib/admin-assets.js'),
      import('./lib/admin-routing.js'),
      import('./lib/schemas.js'),
      import('./lib/plugin-migrations.js'),
      import('./lib/plugin-migration-routing.js'),
      import('./lib/functions.js'),
      import('./lib/openapi.js'),
      import('./lib/do-router.js'),
    ]);

    functionsRegistryModule.initFunctionRegistry();

    const { OpenAPIHono } = honoModule;
    const { HTTPException } = httpExceptionModule;
    const { corsMiddleware } = corsModule;
    const { rateLimitMiddleware } = rateLimitModule;
    const { errorHandlerMiddleware } = errorHandlerModule;
    const { internalGuardMiddleware } = internalGuardModule;
    const { authMiddleware } = authMiddlewareModule;
    const { rulesMiddleware } = rulesMiddlewareModule;
    const { loggerMiddleware } = loggerModule;
    const { EdgeBaseError } = sharedModule;
    const { SERVER_VERSION } = versionModule;
    const { createAdminAssetRequest } = adminAssetsModule;
    const { resolveAdminFaviconTarget, resolveAdminRedirectTarget } = adminRoutingModule;
    const { zodDefaultHook } = schemasModule;
    const { executePluginMigrations } = pluginMigrationsModule;
    const { shouldRunPluginMigrationsForRequestPath } = pluginMigrationRoutingModule;
    const { getWorkerUrl } = functionsModule;
    const { normalizeOpenApiDocument } = openApiModule;

    const app = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

    app.use('*', errorHandlerMiddleware);
    app.use('*', loggerMiddleware);
    app.use('*', corsMiddleware);

    app.use('*', async (c, next) => {
      const env = c.env as Env;
      const config = doRouterModule.parseConfig(env);
      const requestPath = new URL(c.req.url).pathname;
      if (config?.plugins?.length && shouldRunPluginMigrationsForRequestPath(requestPath)) {
        await executePluginMigrations(config.plugins, env, config, getWorkerUrl(c.req.url, env));
      }
      return next();
    });

    app.use('*', rateLimitMiddleware);
    app.use('/api/*', authMiddleware);
    app.use('/api/db/*', rulesMiddleware);
    app.use('/internal/*', internalGuardMiddleware);

    app.route('/api', healthRouteModule.healthRoute);
    app.route('/api/auth', authRouteModule.authRoute);
    app.route('/api/auth/admin', adminAuthRouteModule.adminAuthRoute);
    app.route('/api/auth/oauth', oauthRouteModule.oauthRoute);
    app.route('/api/db', tablesRouteModule.tablesRoute);
    app.route('/api/db', databaseLiveRouteModule.databaseLiveRoute);
    app.route('/api/schema', schemaRouteModule.schemaRoute);
    app.route('/api/storage', storageRouteModule.storageRoute);
    app.route('/api/functions', functionsRouteModule.functionsRoute);
    app.route('/api/sql', sqlRouteModule.sqlRoute);
    app.route('/api/kv', kvRouteModule.kvRoute);
    app.route('/api/d1', d1RouteModule.d1Route);
    app.route('/api/vectorize', vectorizeRouteModule.vectorizeRoute);
    app.route('/api/config', configRouteModule.configRoute);
    app.route('/api/push', pushRouteModule.pushRoute);
    app.route('/api/room', roomRouteModule.roomRoute);
    app.route('/api/analytics', analyticsRouteModule.analyticsApi);
    app.route('/admin/api', adminRouteModule.adminRoute);
    app.route('/admin/api/backup', backupRouteModule.backupRoute);

    app.get('/', (c) => {
      const env = c.env as Env;
      const externalAdminUrl = resolveAdminRedirectTarget(c.req.url, env.ADMIN_ORIGIN);
      if (externalAdminUrl) {
        return c.redirect(externalAdminUrl, 302);
      }
      if (env.ASSETS) {
        return c.redirect('/admin', 302);
      }
      return c.json({
        name: 'EdgeBase API',
        docs: '/openapi.json',
        admin: null,
      });
    });

    app.get('/favicon.ico', async (c) => {
      const env = c.env as Env;
      const externalFaviconUrl = resolveAdminFaviconTarget(env.ADMIN_ORIGIN);
      if (externalFaviconUrl) {
        return c.redirect(externalFaviconUrl, 302);
      }

      if (!env.ASSETS) {
        return c.json({ code: 404, message: 'Admin dashboard not deployed.' }, 404);
      }

      const url = new URL(c.req.url);
      url.pathname = '/admin/favicon.svg';
      return env.ASSETS.fetch(createAdminAssetRequest(new Request(url.toString(), c.req.raw)));
    });

    app.get('/favicon.svg', async (c) => {
      const env = c.env as Env;
      const externalFaviconUrl = resolveAdminFaviconTarget(env.ADMIN_ORIGIN);
      if (externalFaviconUrl) {
        return c.redirect(externalFaviconUrl, 302);
      }

      if (env.ASSETS) {
        return env.ASSETS.fetch(c.req.raw);
      }

      return c.json({ code: 404, message: 'Admin dashboard not deployed.' }, 404);
    });

    app.get('/_app/*', async (c) => {
      const env = c.env as Env;
      if (env.ASSETS) {
        return env.ASSETS.fetch(c.req.raw);
      }

      return c.json({ code: 404, message: 'Admin dashboard not deployed.' }, 404);
    });

    app.get('/admin/*', async (c) => {
      const env = c.env as Env;
      const externalAdminUrl = resolveAdminRedirectTarget(c.req.url, env.ADMIN_ORIGIN);
      if (externalAdminUrl) {
        return c.redirect(externalAdminUrl, 302);
      }
      if (env.ASSETS) {
        return env.ASSETS.fetch(createAdminAssetRequest(c.req.raw));
      }
      return c.json({ code: 404, message: 'Admin dashboard not deployed.' }, 404);
    });

    app.get('/admin', async (c) => {
      const env = c.env as Env;
      const externalAdminUrl = resolveAdminRedirectTarget(c.req.url, env.ADMIN_ORIGIN);
      if (externalAdminUrl) {
        return c.redirect(externalAdminUrl, 302);
      }
      if (env.ASSETS) {
        return env.ASSETS.fetch(createAdminAssetRequest(c.req.raw));
      }
      return c.json({ code: 404, message: 'Admin dashboard not deployed.' }, 404);
    });

    app.get('/harness', () => {
      return Response.redirect('/harness/', 302);
    });

    app.get('/harness/', async (c) => {
      const env = c.env as Env;
      if (env.ASSETS) {
        return env.ASSETS.fetch(c.req.raw);
      }
      return c.json({ code: 404, message: 'Harness assets not deployed.' }, 404);
    });

    app.get('/harness/assets/*', async (c) => {
      const env = c.env as Env;
      if (env.ASSETS) {
        return env.ASSETS.fetch(c.req.raw);
      }
      return c.json({ code: 404, message: 'Harness assets not deployed.' }, 404);
    });

    app.get('/harness/*', () => {
      return Response.redirect('/harness/', 302);
    });

    app.get('/openapi.json', (c) => {
      const spec = app.getOpenAPI31Document({
        openapi: '3.1.0',
        info: { title: 'EdgeBase API', version: SERVER_VERSION },
      });

      return c.json(normalizeOpenApiDocument(spec as OpenApiSpec, new URL(c.req.url).origin));
    });

    app.notFound((c) => {
      return c.json({ code: 404, message: 'Not found.' }, 404);
    });

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
      if (err instanceof HTTPException) {
        return c.json({ code: err.status, message: err.message }, err.status as 400);
      }
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

    return app;
}

async function getApp() {
  if (!appPromise) {
    appPromise = buildApp();
  }
  return appPromise;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const app = await getApp();
    return app.fetch(request, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await ensureServerStartup();

    const [
      pluginMigrationsModule,
      functionsModule,
      cronModule,
      jwtModule,
      authServiceModule,
      authD1Module,
      authDbAdapterModule,
      serviceKeyModule,
      doRouterModule,
    ] = await Promise.all([
      import('./lib/plugin-migrations.js'),
      import('./lib/functions.js'),
      import('./lib/cron.js'),
      import('./lib/jwt.js'),
      import('./lib/auth-d1-service.js'),
      import('./lib/auth-d1.js'),
      import('./lib/auth-db-adapter.js'),
      import('./lib/service-key.js'),
      import('./lib/do-router.js'),
    ]);

    const { executePluginMigrations } = pluginMigrationsModule;
    const { getFunctionsByTrigger, buildFunctionContext, getWorkerUrl } = functionsModule;
    const { parseCron, matchesCron } = cronModule;
    const { parseDuration } = jwtModule;
    const { ensureAuthSchema, deleteAnon } = authD1Module;
    const { resolveAuthDb } = authDbAdapterModule;
    const { resolveRootServiceKey } = serviceKeyModule;

    const config = doRouterModule.parseConfig(env);
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
    const timeoutStr = config.functions?.scheduleFunctionTimeout ?? '10s';
    const timeoutMs = parseDuration(timeoutStr) * 1000;

    ctx.waitUntil(
      (async () => {
        try {
          const authDb = resolveAuthDb(env as unknown as Record<string, unknown>);
          await ensureAuthSchema(authDb);
          await authServiceModule.cleanExpiredSessions(authDb);
          if (config?.auth?.anonymousAuth) {
            const retentionDays = config.auth.anonymousRetentionDays ?? 30;
            const deletedIds = await authServiceModule.cleanStaleAnonymousAccounts(authDb, retentionDays);
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
          request: new Request(`http://internal/schedule/${name}`),
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
