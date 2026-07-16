import type { HonoEnv } from './lib/hono.js';
import type { OpenApiSpec } from './lib/openapi.js';
import type { Env } from './types.js';
import type { FrontendConfigLike } from './lib/frontend-config.js';
import { ensureServerStartup } from './lib/runtime-startup.js';

// ─── DO Re-exports (wrangler needs exports from main entry) ───
export { DatabaseDO } from './durable-objects/database-do.js';
export { DatabaseLiveDO } from './durable-objects/database-live-do.js';
export { AuthDO } from './durable-objects/auth-do.js';
export { RoomsDO } from './durable-objects/rooms-do.js';
export { LogsDO } from './durable-objects/logs-do.js';

let appPromise: Promise<Awaited<ReturnType<typeof buildApp>>> | null = null;
const FRONTEND_ASSET_REDIRECT_STATUSES = new Set([301, 302, 307, 308]);
const FRONTEND_ASSET_REDIRECT_LIMIT = 4;

function assetUnavailableMessage(
  assetName: 'admin dashboard' | 'frontend bundle' | 'harness assets',
): string {
  const label = `${assetName[0].toUpperCase()}${assetName.slice(1)}`;
  const verb = assetName === 'harness assets' ? 'are' : 'is';
  return `${label} ${verb} not deployed for this worker. Deploy the assets bundle or configure ADMIN_ORIGIN if they are hosted elsewhere.`;
}

async function buildApp() {
  await ensureServerStartup();

  const [
    honoModule,
    httpExceptionModule,
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
    captchaChallengeRouteModule,
    pushRouteModule,
    roomRouteModule,
    analyticsRouteModule,
    adminAssetsModule,
    adminRoutingModule,
    frontendAssetsModule,
    schemasModule,
    pluginMigrationsModule,
    pluginMigrationRoutingModule,
    functionsModule,
    openApiModule,
    doRouterModule,
    selfHostControlRouteModule,
  ] = await Promise.all([
    import('./lib/hono.js'),
    import('hono/http-exception'),
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
    import('./routes/captcha.js'),
    import('./routes/push.js'),
    import('./routes/room.js'),
    import('./routes/analytics-api.js'),
    import('./lib/admin-assets.js'),
    import('./lib/admin-routing.js'),
    import('./lib/frontend-assets.js'),
    import('./lib/schemas.js'),
    import('./lib/plugin-migrations.js'),
    import('./lib/plugin-migration-routing.js'),
    import('./lib/functions.js'),
    import('./lib/openapi.js'),
    import('./lib/do-router.js'),
    import('./routes/self-host-control.js'),
  ]);

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
  const { applyFrontendAssetHeaders, createFrontendAssetRequest } = frontendAssetsModule;
  const { zodDefaultHook } = schemasModule;
  const { executePluginMigrations } = pluginMigrationsModule;
  const { shouldRunPluginMigrationsForRequestPath } = pluginMigrationRoutingModule;
  const { getWorkerUrl } = functionsModule;
  const { normalizeOpenApiDocument } = openApiModule;

  const app = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

  // This loopback-only authenticated control plane must not inherit public
  // CORS, rate-limit, auth, plugin-migration, or frontend fallthrough paths.
  app.route('/__edgebase/internal/self-host', selfHostControlRouteModule.selfHostControlRoute);

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
  app.route('/api/captcha', captchaChallengeRouteModule.captchaChallengeRoute);
  app.route('/api/push', pushRouteModule.pushRoute);
  app.route('/api/room', roomRouteModule.roomRoute);
  app.route('/api/analytics', analyticsRouteModule.analyticsApi);
  app.route('/admin/api', adminRouteModule.adminRoute);
  app.route('/admin/api/backup', backupRouteModule.backupRoute);
  function getFrontendConfig(env: Env): FrontendConfigLike | undefined {
    return (doRouterModule.parseConfig(env) as { frontend?: FrontendConfigLike } | undefined)?.frontend;
  }

  async function fetchFrontendAssetResponse(
    assetsBinding: { fetch(request: Request): Promise<Response> },
    assetRequest: Request,
  ): Promise<Response> {
    let currentRequest = assetRequest;
    const visitedUrls = new Set<string>();

    for (let attempt = 0; attempt <= FRONTEND_ASSET_REDIRECT_LIMIT; attempt += 1) {
      visitedUrls.add(currentRequest.url);
      const assetResponse = await assetsBinding.fetch(currentRequest);
      if (!FRONTEND_ASSET_REDIRECT_STATUSES.has(assetResponse.status)) {
        return assetResponse;
      }

      const location = assetResponse.headers.get('location');
      if (!location) {
        return assetResponse;
      }

      const nextUrl = new URL(location, currentRequest.url);
      if (nextUrl.origin !== new URL(currentRequest.url).origin) {
        return assetResponse;
      }

      if (visitedUrls.has(nextUrl.toString())) {
        return assetResponse;
      }

      currentRequest = new Request(nextUrl.toString(), currentRequest);
    }

    return assetsBinding.fetch(currentRequest);
  }

  async function serveFrontendAsset(c: { env: Env; req: { raw: Request } }): Promise<Response | null> {
    const frontend = getFrontendConfig(c.env);
    if (!frontend) {
      return null;
    }

    if (!c.env.ASSETS) {
      return new Response(
        JSON.stringify({ code: 404, message: assetUnavailableMessage('frontend bundle') }),
        {
          status: 404,
          headers: { 'content-type': 'application/json; charset=UTF-8' },
        },
      );
    }

    const assetRequest = createFrontendAssetRequest(c.req.raw, frontend);
    if (!assetRequest) {
      return null;
    }

    const assetResponse = await fetchFrontendAssetResponse(c.env.ASSETS, assetRequest);
    return applyFrontendAssetHeaders(
      assetResponse,
      new URL(assetRequest.url).pathname,
      frontend.headers,
    );
  }

  app.get('/', async (c) => {
    const env = c.env as Env;
    const frontendResponse = await serveFrontendAsset({ env, req: c.req });
    if (frontendResponse) {
      return frontendResponse;
    }
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
    const frontendResponse = await serveFrontendAsset({ env, req: c.req });
    if (frontendResponse) {
      return frontendResponse;
    }
    const externalFaviconUrl = resolveAdminFaviconTarget(env.ADMIN_ORIGIN);
    if (externalFaviconUrl) {
      return c.redirect(externalFaviconUrl, 302);
    }

    if (!env.ASSETS) {
      return c.json({ code: 404, message: assetUnavailableMessage('admin dashboard') }, 404);
    }

    const url = new URL(c.req.url);
    url.pathname = '/admin/favicon.svg';
    return env.ASSETS.fetch(createAdminAssetRequest(new Request(url.toString(), c.req.raw)));
  });

  app.get('/favicon.svg', async (c) => {
    const env = c.env as Env;
    const frontendResponse = await serveFrontendAsset({ env, req: c.req });
    if (frontendResponse) {
      return frontendResponse;
    }
    const externalFaviconUrl = resolveAdminFaviconTarget(env.ADMIN_ORIGIN);
    if (externalFaviconUrl) {
      return c.redirect(externalFaviconUrl, 302);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(c.req.raw);
    }

    return c.json({ code: 404, message: assetUnavailableMessage('admin dashboard') }, 404);
  });

  app.get('/_app/*', async (c) => {
    const env = c.env as Env;
    if (env.ASSETS) {
      return env.ASSETS.fetch(c.req.raw);
    }

    return c.json({ code: 404, message: assetUnavailableMessage('admin dashboard') }, 404);
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
    return c.json({ code: 404, message: assetUnavailableMessage('admin dashboard') }, 404);
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
    return c.json({ code: 404, message: assetUnavailableMessage('admin dashboard') }, 404);
  });

  app.get('/harness', (c) => {
    return c.redirect('/harness/', 302);
  });

  app.get('/harness/', async (c) => {
    const env = c.env as Env;
    if (env.ASSETS) {
      return env.ASSETS.fetch(c.req.raw);
    }
    return c.json({ code: 404, message: assetUnavailableMessage('harness assets') }, 404);
  });

  app.get('/harness/assets/*', async (c) => {
    const env = c.env as Env;
    if (env.ASSETS) {
      return env.ASSETS.fetch(c.req.raw);
    }
    return c.json({ code: 404, message: assetUnavailableMessage('harness assets') }, 404);
  });

  app.get('/harness/*', (c) => {
    return c.redirect('/harness/', 302);
  });

  app.get('/openapi.json', (c) => {
    const spec = app.getOpenAPI31Document({
      openapi: '3.1.0',
      info: { title: 'EdgeBase API', version: SERVER_VERSION },
    });

    return c.json(normalizeOpenApiDocument(spec as OpenApiSpec, new URL(c.req.url).origin));
  });

  app.on(['GET', 'HEAD'], '*', async (c) => {
    const env = c.env as Env;
    const frontendResponse = await serveFrontendAsset({ env, req: c.req });
    if (frontendResponse) {
      return frontendResponse;
    }

    return c.json({
      code: 404,
      message: `Path '${new URL(c.req.url).pathname}' was not found on this EdgeBase server.`,
    }, 404);
  });

  app.notFound((c) => {
    return c.json({
      code: 404,
      message: `Path '${new URL(c.req.url).pathname}' was not found on this EdgeBase server.`,
    }, 404);
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
    return c.json({
      code: 500,
      message: `Internal server error while handling '${new URL(c.req.url).pathname}'. Check the worker logs for the original exception.`,
    }, 500);
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
    void ctx;
    const { executeManagedScheduledEnvelopes } = await import('./lib/managed-scheduled-runtime.js');
    const report = await executeManagedScheduledEnvelopes([{
      cron: event.cron,
      scheduledTime: event.scheduledTime,
    }], env, ctx);

    if (!report.complete) {
      throw new Error(
        `Scheduled delivery '${event.cron}' did not complete: ${report.outcomes
          .filter(({ status }) => status !== 'succeeded' && status !== 'duplicate')
          .map(({ itemId, status }) => `${itemId}=${status}`)
          .join(', ')}.`,
      );
    }
  },
};
