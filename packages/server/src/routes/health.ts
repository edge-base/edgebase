import { OpenAPIHono, createRoute, type HonoEnv } from '../lib/hono.js';
import { healthResponseSchema, zodDefaultHook } from '../lib/schemas.js';
import { SERVER_VERSION } from '../lib/version.js';


export const healthRoute = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

/**
 * GET /api/health — Health check endpoint.
 * Returns server status and version information.
 */
const getHealth = createRoute({
  operationId: 'getHealth',
  method: 'get',
  path: '/health',
  tags: ['client'],
  summary: 'Health check',
  responses: {
    200: {
      description: 'Server is healthy',
      content: { 'application/json': { schema: healthResponseSchema } },
    },
  },
});

healthRoute.openapi(getHealth, (c) => {
  return c.json({
    status: 'ok',
    version: SERVER_VERSION,
    timestamp: new Date().toISOString(),
  }, 200);
});
