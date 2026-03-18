/**
 * GET /api/schema — Table meta endpoint.
 * Default: disabled. Enable via config `api.schemaEndpoint: true | 'authenticated'`.
 */
import { OpenAPIHono, createRoute, type HonoEnv } from '../lib/hono.js';
import { parseConfig } from '../lib/do-router.js';
import { validateKey, buildConstraintCtx } from '../lib/service-key.js';
import { EdgeBaseError } from '@edge-base/shared';
import { zodDefaultHook, jsonResponseSchema, errorResponseSchema } from '../lib/schemas.js';


export const schemaRoute = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

const getSchema = createRoute({
  operationId: 'getSchema',
  method: 'get',
  path: '/',
  tags: ['client'],
  summary: 'Get table schema',
  responses: {
    200: { description: 'Table schema', content: { 'application/json': { schema: jsonResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

schemaRoute.openapi(getSchema, async (c) => {
  const config = parseConfig(c.env);

  // Check if endpoint is enabled
  const setting = config.api?.schemaEndpoint;
  if (!setting) {
    throw new EdgeBaseError(404, 'Schema endpoint is disabled.');
  }

  // Require JWT authentication when configured
  if (setting === 'authenticated') {
    // Service Key bypass — supports both legacy and scoped keys
    const { result: skResult } = validateKey(
      c.req.header('X-EdgeBase-Service-Key'),
      'schema:endpoint:*:read',
      config,
      c.env,
      undefined,
      buildConstraintCtx(c.env, c.req),
    );
    if (skResult === 'invalid') {
      throw new EdgeBaseError(401, 'Unauthorized. Invalid Service Key.');
    }
    const serviceKeyBypass = skResult === 'valid';

    if (!serviceKeyBypass) {
      const auth = c.get('auth');
      if (!auth) {
        throw new EdgeBaseError(401, 'Authentication required.');
      }
    }
  }

  // Build schema response from databases block (§1,)
  const tables: Record<string, {
    namespace: string;
    fts: boolean;
  }> = {};

  for (const [namespace, dbBlock] of Object.entries(config.databases ?? {})) {
    for (const [tableName, tableConfig] of Object.entries(dbBlock.tables ?? {})) {
      tables[tableName] = {
        namespace,
        fts: (tableConfig.fts?.length ?? 0) > 0,
      };
    }
  }

  return c.json({ tables });
});
