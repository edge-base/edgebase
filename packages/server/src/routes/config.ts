/**
 * Public Config Route
 *
 * GET /api/config — Returns publicly-safe configuration.
 * No authentication required.
 * Currently exposes captcha siteKey for client-side Turnstile rendering.
 *
 * The site key is exposed only when the runtime has a complete, hostname-bound
 * CAPTCHA configuration. A release misconfiguration therefore fails closed
 * instead of advertising a widget while protected routes silently bypass it.
 */
import { OpenAPIHono, createRoute, type HonoEnv } from '../lib/hono.js';
import { zodDefaultHook, jsonResponseSchema } from '../lib/schemas.js';
import { resolveCaptchaConfig } from '../middleware/captcha-verify.js';


export const configRoute = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

const getConfig = createRoute({
  operationId: 'getConfig',
  method: 'get',
  path: '/',
  tags: ['client'],
  summary: 'Get public configuration',
  responses: {
    200: { description: 'Public config', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

configRoute.openapi(getConfig, (c) => {
  const resolved = resolveCaptchaConfig(c.env, c.req.raw);
  const captcha = resolved ? { siteKey: resolved.siteKey } : null;

  return c.json({ captcha }, 200, {
    'Cache-Control': 'public, max-age=60, s-maxage=60',
    'CDN-Cache-Control': 'public, max-age=60',
  });
});
