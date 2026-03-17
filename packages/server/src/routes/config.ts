/**
 * Public Config Route
 *
 * GET /api/config — Returns publicly-safe configuration.
 * No authentication required.
 * Currently exposes captcha siteKey for client-side Turnstile rendering.
 *
 * siteKey is served from CAPTCHA_SITE_KEY env var (set by deploy.ts after provisioning).
 * Falls back to bundled runtime config for advanced captcha object configs.
 */
import { OpenAPIHono, createRoute, type HonoEnv } from '../lib/hono.js';
import { parseConfig } from '../lib/do-router.js';
import { zodDefaultHook, jsonResponseSchema } from '../lib/schemas.js';


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
  let captcha: { siteKey: string } | null = null;

  try {
    // §34: CAPTCHA_SITE_KEY env var takes priority (set by deploy.ts)
    if (c.env.CAPTCHA_SITE_KEY) {
      captcha = { siteKey: c.env.CAPTCHA_SITE_KEY };
    } else {
      // Fallback: parseConfig() singleton for advanced captcha object configs
      const config = parseConfig(c.env);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const captchaCfg = (config as any)?.captcha;
      if (captchaCfg && typeof captchaCfg === 'object' && captchaCfg.siteKey) {
        captcha = { siteKey: captchaCfg.siteKey };
      }
    }
  } catch {
    // Return null captcha on error
  }

  return c.json({ captcha }, 200, {
    'Cache-Control': 'public, max-age=60, s-maxage=60',
    'CDN-Cache-Control': 'public, max-age=60',
  });
});
