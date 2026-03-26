/**
 * Captcha (Turnstile) verification middleware.
 *
 * NOT a global middleware — applied internally within auth and function routes.
 * Validates Turnstile tokens via siteverify API.
 *
 * Token extraction order: body.captchaToken → query.captcha_token → X-EdgeBase-Captcha-Token header.
 */
import type { Context, Next } from 'hono';
import type { Env } from '../types.js';
import { parseConfig } from '../lib/do-router.js';

interface CaptchaConfig {
  siteKey: string;
  secretKey: string;
  failMode?: 'open' | 'closed';
  siteverifyTimeout?: number;
}

type HonoContext = Context<{ Bindings: Env }>;
const captchaWarnings = new Set<string>();

interface SiteverifyResponse {
  success: boolean;
  action?: string;
  'error-codes'?: string[];
}

/**
 * Resolve captcha config. (#133 §31: uses parseConfig() singleton)
 */
function resolveCaptchaConfig(env: Env): CaptchaConfig | null {
  try {
    const config = parseConfig(env);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const captcha = (config as any)?.captcha;

    if (!captcha) return null;
    if (captcha === false) return null;

    // captcha: true — check for auto-provisioned keys
    if (captcha === true) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const siteKey = (config as any)?.captchaSiteKey as string | undefined;
      const secretKey = env.TURNSTILE_SECRET;
      if (!siteKey || !secretKey) return null;
      return { siteKey, secretKey };
    }

    // captcha: { siteKey, secretKey, ... }
    if (typeof captcha === 'object' && captcha.siteKey && captcha.secretKey) {
      return captcha as CaptchaConfig;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract captcha token from request.
 * Order: body.captchaToken → query.captcha_token → X-EdgeBase-Captcha-Token header
 */
async function extractCaptchaToken(c: HonoContext): Promise<string | null> {
  // Try body (POST requests)
  if (c.req.method === 'POST' || c.req.method === 'PUT' || c.req.method === 'PATCH') {
    try {
      const body = await c.req.json();
      if (body?.captchaToken) return body.captchaToken;
    } catch {
      // Body parsing failed — try other sources
    }
  }

  // Try query parameter (GET requests, e.g. OAuth)
  const queryToken = c.req.query('captcha_token');
  if (queryToken) return queryToken;

  // Try header (fallback)
  const headerToken = c.req.header('X-EdgeBase-Captcha-Token');
  if (headerToken) return headerToken;

  return null;
}

/**
 * Call Cloudflare Turnstile siteverify API.
 */
async function siteverify(
  secretKey: string,
  token: string,
  remoteip: string | undefined,
  timeout: number,
): Promise<SiteverifyResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: secretKey,
        response: token,
        ...(remoteip ? { remoteip } : {}),
      }),
      signal: controller.signal,
    });
    return (await response.json()) as SiteverifyResponse;
  } catch {
    // Timeout or network error
    return { success: false, 'error-codes': ['timeout-or-network-error'] };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check if request has a Service Key (bypass captcha per).
 */
function hasServiceKey(c: HonoContext): boolean {
  return !!(
    c.req.header('X-EdgeBase-Service-Key') ||
    c.req.header('Authorization')?.startsWith('ServiceKey ')
  );
}

/**
 * Create a captcha middleware for Auth routes.
 * @param expectedAction - Expected Turnstile action value (e.g. 'signup', 'signin')
 */
export function captchaMiddleware(expectedAction: string) {
  return async (c: HonoContext, next: Next) => {
    const captchaConfig = resolveCaptchaConfig(c.env);

    // Step 1-2: No config or keys not provisioned → pass through
    if (!captchaConfig) {
      // Log warning if captcha is enabled but keys missing
      try {
        const config = parseConfig(c.env);
        if (config?.captcha === true) {
          if (!captchaWarnings.has('missing-turnstile-keys')) {
            captchaWarnings.add('missing-turnstile-keys');
            console.warn(
              '[Auth] CAPTCHA is enabled, but Turnstile keys are missing. '
              + 'Requests will continue without CAPTCHA in local dev. '
              + 'Add captchaSiteKey and TURNSTILE_SECRET, or set captcha: false to silence this warning.',
            );
          }
        }
      } catch { /* ignore */ }
      await next();
      return;
    }

    // Step 3: Service Key → bypass
    if (hasServiceKey(c)) {
      await next();
      return;
    }

    // Step 4: Extract token
    const token = await extractCaptchaToken(c);

    // Step 5: No token → 403
    if (!token) {
      return c.json({ code: 403, message: 'Captcha verification required.', data: { captcha_required: true } }, 403);
    }

    // Step 6: siteverify
    const timeout = captchaConfig.siteverifyTimeout ?? 3000;
    const failMode = captchaConfig.failMode ?? 'open';
    const remoteip = c.req.header('cf-connecting-ip') || undefined;

    const result = await siteverify(captchaConfig.secretKey, token, remoteip, timeout);

    // Handle siteverify API failure (timeout, network error)
    if (result['error-codes']?.includes('timeout-or-network-error')) {
      if (failMode === 'open') {
        if (!captchaWarnings.has('siteverify-fail-open')) {
          captchaWarnings.add('siteverify-fail-open');
          console.warn(
            '[Auth] Turnstile siteverify failed because of a timeout or network error. '
            + 'The request is being allowed because captcha.failMode is set to "open".',
          );
        }
        await next();
        return;
      }
      return c.json({ code: 503, message: 'Captcha service unavailable.' }, 503);
    }

    // Step 7: Verify success + action
    if (!result.success) {
      return c.json({ code: 403, message: 'Captcha verification failed.', data: { captcha_required: true } }, 403);
    }

    // Action verification
    if (result.action && result.action !== expectedAction) {
      return c.json({
        code: 403,
        message: `Captcha action mismatch: expected '${expectedAction}'.`,
        data: { captcha_required: true },
      }, 403);
    }

    // Step 8: Passed
    await next();
  };
}

/**
 * Captcha middleware for Functions routes.
 * Checks the function definition's captcha flag before verifying.
 */
export function functionCaptchaMiddleware(functionName: string, captchaEnabled: boolean) {
  if (!captchaEnabled) {
    return async (_c: HonoContext, next: Next) => { await next(); };
  }
  return captchaMiddleware(`function:${functionName}`);
}

// ─── Test exports (for unit testing only) ───
export const _test = {
  resolveCaptchaConfig,
  extractCaptchaToken,
  hasServiceKey,
  siteverify,
};
