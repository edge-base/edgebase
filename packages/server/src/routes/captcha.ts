import { OpenAPIHono, createRoute, z, type HonoEnv } from '../lib/hono.js';
import { resolveCaptchaConfig } from '../middleware/captcha-verify.js';
import { parseConfig } from '../lib/do-router.js';
import { getTrustedClientIp } from '../lib/client-ip.js';

const ALLOWED_ACTIONS = new Set([
  'signup',
  'signin',
  'anonymous',
  'magic-link',
  'phone',
  'password-reset',
  'oauth',
  'function',
]);
const ALLOWED_APPEARANCES = new Set(['always', 'execute', 'interaction-only']);
const ALLOWED_SIZES = new Set(['normal', 'compact', 'flexible']);
const ALLOWED_BRIDGES = new Set([
  'rn',
  'webkit',
  'android',
  'flutter',
  'vuplex',
  'unity',
  'uniwebview',
  'uri',
]);
const CHANNEL_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

function safeJsonString(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function normalizedRequestHostname(request: Request): string {
  return new URL(request.url).hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

export function buildCaptchaChallengeHtml(input: {
  siteKey: string;
  action: string;
  appearance: string;
  size: string;
  channel: string;
  bridge: string;
  nonce: string;
}): string {
  const { siteKey, action, appearance, size, channel, bridge, nonce } = input;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Verification</title>
<style nonce="${nonce}">html,body{margin:0;min-height:100%;background:transparent;overflow:hidden}body{display:flex;align-items:center;justify-content:center}#edgebase-turnstile{min-height:65px}</style>
<script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
</head>
<body>
<div id="edgebase-turnstile" aria-label="Human verification"></div>
<script nonce="${nonce}">
(() => {
  'use strict';
  const channel = ${safeJsonString(channel)};
  const bridge = ${safeJsonString(bridge)};
  let terminalSent = false;
  const send = (type, value) => {
    if (terminalSent) return;
    let text = String(value ?? '');
    if (type === 'token' && (text.length === 0 || text.length > 2048)) {
      type = 'error';
      text = 'invalid_token';
    }
    if (type === 'error') text = text.slice(0, 256);
    const isTerminal = type === 'token' || type === 'error';
    const json = JSON.stringify({ v: 1, channel, type, value: text });
    try {
      switch (bridge) {
        case 'rn': window.ReactNativeWebView.postMessage(json); break;
        case 'webkit': window.webkit.messageHandlers.edgebaseCaptcha.postMessage(json); break;
        case 'android': window.EdgeBaseCaptchaBridge.postMessage(json); break;
        case 'flutter': window.flutter_inappwebview.callHandler('edgebaseCaptcha', json); break;
        case 'vuplex': window.vuplex.postMessage(json); break;
        case 'unity': window.Unity.call(json); break;
        case 'uniwebview': window.location.href = 'uniwebview://message?value=' + encodeURIComponent(json); break;
        case 'uri': window.location.href = 'edgebase://message/' + encodeURIComponent(json); break;
      }
      if (isTerminal) terminalSent = true;
    } catch (_) {
      terminalSent = true;
      try { window.location.href = 'edgebase://message/' + encodeURIComponent(JSON.stringify({ v: 1, channel, type: 'error', value: 'bridge_unavailable' })); } catch (_) {}
    }
  };
  const render = () => {
    if (terminalSent) return;
    if (!window.turnstile) { window.setTimeout(render, 50); return; }
    try {
      window.turnstile.render('#edgebase-turnstile', {
        sitekey: ${safeJsonString(siteKey)},
        action: ${safeJsonString(action)},
        appearance: ${safeJsonString(appearance)},
        size: ${safeJsonString(size)},
        callback: token => send('token', token),
        'error-callback': error => send('error', error),
        'before-interactive-callback': () => send('interactive', 'show'),
        'after-interactive-callback': () => send('interactive', 'hide'),
        'timeout-callback': () => send('error', 'timeout')
      });
      send('ready', 'ready');
    } catch (_) {
      send('error', 'render_failed');
    }
  };
  window.setTimeout(() => {
    if (!terminalSent && !window.turnstile) send('error', 'script_load_failed');
  }, 15000);
  render();
})();
</script>
</body>
</html>`;
}

export const captchaChallengeRoute = new OpenAPIHono<HonoEnv>();

const getCaptchaChallenge = createRoute({
  operationId: 'getCaptchaChallenge',
  method: 'get',
  path: '/challenge',
  tags: ['client'],
  summary: 'Render the hosted Turnstile page for native WebViews',
  request: {
    query: z.object({
      action: z.string(),
      channel: z.string(),
      bridge: z.enum(['rn', 'webkit', 'android', 'flutter', 'vuplex', 'unity', 'uniwebview', 'uri']),
      appearance: z.enum(['always', 'execute', 'interaction-only']).optional(),
      size: z.enum(['normal', 'compact', 'flexible']).optional(),
    }),
  },
  responses: {
    200: {
      description: 'No-store Turnstile challenge HTML',
      content: { 'text/html': { schema: z.string() } },
    },
    400: { description: 'Invalid action or display option' },
    403: { description: 'Hostname is not registered for this widget' },
    404: { description: 'CAPTCHA is not configured' },
    500: { description: 'CAPTCHA runtime configuration is incomplete' },
  },
});

captchaChallengeRoute.openapi(getCaptchaChallenge, (c) => {
  const action = c.req.query('action') ?? '';
  const appearance = c.req.query('appearance') ?? 'interaction-only';
  const size = c.req.query('size') ?? 'normal';
  const channel = c.req.query('channel') ?? '';
  const bridge = c.req.query('bridge') ?? '';
  if (!ALLOWED_ACTIONS.has(action)) {
    return c.json({ code: 400, message: 'Invalid CAPTCHA action.' }, 400);
  }
  if (!ALLOWED_APPEARANCES.has(appearance) || !ALLOWED_SIZES.has(size)) {
    return c.json({ code: 400, message: 'Invalid CAPTCHA display option.' }, 400);
  }
  if (!CHANNEL_PATTERN.test(channel) || !ALLOWED_BRIDGES.has(bridge)) {
    return c.json({ code: 400, message: 'Invalid CAPTCHA bridge channel.' }, 400);
  }

  const config = resolveCaptchaConfig(c.env, c.req.raw);
  if (!config) {
    return c.json({ code: 404, message: 'CAPTCHA is not configured.' }, 404);
  }
  if (!config.hostnames.includes(normalizedRequestHostname(c.req.raw))) {
    return c.json({ code: 403, message: 'CAPTCHA is not enabled for this hostname.' }, 403);
  }
  const requestUrl = new URL(c.req.url);
  if (requestUrl.protocol !== 'https:') {
    const runtimeConfig = parseConfig(c.env);
    const trustedIp = getTrustedClientIp(c.env, c.req.raw);
    const loopbackPeer = trustedIp === '::1' || trustedIp?.startsWith('127.') === true;
    const safeLocalDevelopment = c.env?.EDGEBASE_RUNTIME_MODE === 'local-development'
      && runtimeConfig.release !== true
      && loopbackPeer
      && ['localhost', '127.0.0.1', '::1'].includes(normalizedRequestHostname(c.req.raw));
    if (!safeLocalDevelopment) {
      return c.json({ code: 400, message: 'CAPTCHA challenge pages require HTTPS.' }, 400);
    }
  }

  const nonce = crypto.randomUUID().replace(/-/g, '');
  const html = buildCaptchaChallengeHtml({
    siteKey: config.siteKey,
    action,
    appearance,
    size,
    channel,
    bridge,
    nonce,
  });
  return c.body(html, 200, {
    'Content-Type': 'text/html; charset=UTF-8',
    'Cache-Control': 'no-store, max-age=0',
    'Content-Security-Policy': [
      "default-src 'none'",
      `script-src 'nonce-${nonce}' https://challenges.cloudflare.com`,
      `style-src 'nonce-${nonce}'`,
      'frame-src https://challenges.cloudflare.com',
      'connect-src https://challenges.cloudflare.com',
      'img-src https://challenges.cloudflare.com data:',
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
});

export const _test = { ALLOWED_ACTIONS, ALLOWED_BRIDGES, CHANNEL_PATTERN };
