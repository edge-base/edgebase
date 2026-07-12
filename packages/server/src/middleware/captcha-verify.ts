/**
 * Captcha (Turnstile) verification middleware.
 *
 * NOT a global middleware — applied internally within auth and function routes.
 * Validates Turnstile tokens via siteverify API.
 *
 * Token extraction order: X-EdgeBase-Captcha-Token header → OAuth-only
 * query.captcha_token → bounded JSON body.captchaToken.
 */
import type { Context, Next } from 'hono';
import type { Env } from '../types.js';
import { parseConfig } from '../lib/do-router.js';
import { resolveServiceKeyCandidate, validateKey, buildConstraintCtx } from '../lib/service-key.js';
import { getTrustedClientIp } from '../lib/client-ip.js';
import { EdgeBaseError, resolveCaptchaHostnames } from '@edge-base/shared';

interface CaptchaConfig {
  siteKey: string;
  secretKey: string;
  hostnames: string[];
  failMode?: 'open' | 'closed';
  siteverifyTimeout?: number;
}

type HonoContext = Context<{ Bindings: Env }>;
const captchaWarnings = new Set<string>();

interface SiteverifyResponse {
  success: boolean;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
}

const MAX_CAPTCHA_TOKEN_LENGTH = 2048;
const MAX_CAPTCHA_JSON_BODY_BYTES = 64 * 1024;
const MAX_SITEVERIFY_RESPONSE_BYTES = 64 * 1024;

function normalizeHostname(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('*')) return null;
  try {
    const parsed = new URL(`https://${trimmed}`);
    if (
      parsed.username
      || parsed.password
      || parsed.port
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) return null;
    return parsed.hostname
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '')
      .toLowerCase();
  } catch {
    return null;
  }
}

function parseEnvHostnames(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const result: string[] = [];
  for (const entry of value.split(',')) {
    const hostname = normalizeHostname(entry);
    if (!hostname) {
      throw new EdgeBaseError(
        500,
        'CAPTCHA_HOSTNAMES contains an invalid hostname.',
        undefined,
        'invalid-config',
      );
    }
    result.push(hostname);
  }
  return result;
}

/**
 * Resolve captcha config. (#133 §31: uses parseConfig() singleton)
 */
export function resolveCaptchaConfig(env: Env | undefined, request?: Request): CaptchaConfig | null {
  const config = parseConfig(env);
  const captcha = config?.captcha;
  if (!captcha) return null;

  const configured = typeof captcha === 'object' && !Array.isArray(captcha)
    ? captcha
    : null;
  const siteKey = env?.CAPTCHA_SITE_KEY?.trim() || configured?.siteKey?.trim();
  const secretKey = env?.TURNSTILE_SECRET?.trim()
    || (config.release === true ? undefined : configured?.secretKey?.trim());
  const hostnames = new Set<string>([
    ...resolveCaptchaHostnames(config),
    ...parseEnvHostnames(env?.CAPTCHA_HOSTNAMES),
  ]);
  if (hostnames.size > 10) {
    throw new EdgeBaseError(
      500,
      'CAPTCHA hostname allowlist must contain at most 10 exact hostnames.',
      undefined,
      'invalid-config',
    );
  }

  // `edgebase dev` owns the listener and trusted client-IP header. Permit a
  // loopback hostname fallback only there; deployed/self-hosted runtimes must
  // declare exact hostnames before accepting any token.
  if (hostnames.size === 0 && request && env?.EDGEBASE_RUNTIME_MODE === 'local-development') {
    const requestUrl = new URL(request.url);
    const peerIp = getTrustedClientIp(env, request);
    const peerLoopback = peerIp === '::1' || peerIp === '[::1]' || peerIp?.startsWith('127.') === true;
    const requestHostname = normalizeHostname(requestUrl.hostname);
    if (peerLoopback && requestHostname && ['localhost', '127.0.0.1', '::1'].includes(requestHostname)) {
      hostnames.add(requestHostname);
    }
  }

  if (!siteKey || !secretKey || hostnames.size === 0) {
    if (env?.EDGEBASE_RUNTIME_MODE === 'local-development' && config.release !== true) {
      return null;
    }
    throw new EdgeBaseError(
      500,
      'CAPTCHA is enabled but its site key, secret key, or exact hostname allowlist is missing.',
      undefined,
      'invalid-config',
    );
  }

  const siteverifyTimeout = configured?.siteverifyTimeout ?? 3000;
  if (
    !Number.isInteger(siteverifyTimeout)
    || siteverifyTimeout < 250
    || siteverifyTimeout > 30_000
  ) {
    throw new EdgeBaseError(500, 'Invalid CAPTCHA siteverify timeout.', undefined, 'invalid-config');
  }

  const localDevelopment = env?.EDGEBASE_RUNTIME_MODE === 'local-development';
  if (configured?.failMode === 'open' && !localDevelopment) {
    throw new EdgeBaseError(
      500,
      'captcha.failMode="open" is allowed only in the trusted local-development runtime.',
      undefined,
      'invalid-config',
    );
  }

  return {
    siteKey,
    secretKey,
    hostnames: Array.from(hostnames),
    failMode: configured?.failMode ?? (localDevelopment && config.release !== true ? 'open' : 'closed'),
    siteverifyTimeout,
  };
}

function normalizeCaptchaToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  return token.length > 0 && token.length <= MAX_CAPTCHA_TOKEN_LENGTH ? token : null;
}

async function readBoundedJson(request: Request): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) return null;
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_CAPTCHA_JSON_BODY_BYTES) return null;

  const body = request.clone().body;
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_CAPTCHA_JSON_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function readBoundedResponseJson(
  response: Response,
): Promise<Record<string, unknown> | null> {
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_SITEVERIFY_RESPONSE_BYTES) return null;
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SITEVERIFY_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Extract captcha token from request.
 * Query tokens are accepted only for the OAuth browser-navigation route. They
 * are forbidden for JSON auth endpoints and Functions because URLs are copied
 * into access logs/history/referrers and a Turnstile token is single-use.
 */
async function extractCaptchaToken(
  c: HonoContext,
  allowOAuthQueryToken = false,
): Promise<string | null> {
  // Headers and query parameters do not consume a protected function's body.
  // If a dedicated location is present but malformed, fail closed instead of
  // falling back to a second attacker-controlled token source.
  const headerToken = c.req.header('X-EdgeBase-Captcha-Token');
  if (headerToken !== undefined) return normalizeCaptchaToken(headerToken);

  const requestUrl = new URL(c.req.url);
  if (requestUrl.searchParams.has('captcha_token')) {
    return allowOAuthQueryToken
      ? normalizeCaptchaToken(requestUrl.searchParams.get('captcha_token'))
      : null;
  }

  // Auth JSON bodies retain backward compatibility. Read a bounded clone so
  // user functions can still consume the original raw Request exactly once.
  if (c.req.method === 'POST' || c.req.method === 'PUT' || c.req.method === 'PATCH') {
    const body = await readBoundedJson(c.req.raw);
    if (body && Object.prototype.hasOwnProperty.call(body, 'captchaToken')) {
      return normalizeCaptchaToken(body.captchaToken);
    }
  }
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
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: secretKey,
        response: token,
        ...(remoteip ? { remoteip } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        success: false,
        'error-codes': response.status >= 500 || response.status === 429
          ? ['timeout-or-network-error']
          : ['siteverify-service-error'],
      };
    }
    const record = await readBoundedResponseJson(response);
    if (!record) {
      return { success: false, 'error-codes': ['siteverify-service-error'] };
    }
    return {
      success: record.success === true,
      ...(typeof record.action === 'string' ? { action: record.action } : {}),
      ...(typeof record.hostname === 'string' ? { hostname: record.hostname } : {}),
      ...(
        Array.isArray(record['error-codes'])
          ? { 'error-codes': record['error-codes'].filter((value): value is string => typeof value === 'string') }
          : {}
      ),
    };
  } catch {
    // Timeout or network error
    return { success: false, 'error-codes': ['timeout-or-network-error'] };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check if the request carries a VALID Service Key (which bypasses captcha).
 *
 * Presence of the header is not sufficient — a bot could send an arbitrary
 * `X-EdgeBase-Service-Key` value to skip Turnstile. The candidate is validated
 * against the configured keys with the same `auth:*:*:bypass` scope the auth
 * rate limiter uses, so only a genuine server-to-server key bypasses captcha.
 */
function hasValidServiceKey(c: HonoContext): boolean {
  const provided = resolveServiceKeyCandidate(
    c.req,
    c.get('serviceKeyToken') as string | null | undefined,
  );
  if (!provided) return false;
  try {
    const config = parseConfig(c.env);
    const { result } = validateKey(
      provided,
      'auth:*:*:bypass',
      config,
      c.env as never,
      undefined,
      buildConstraintCtx((c.env ?? {}) as { ENVIRONMENT?: string }, c.req),
    );
    return result === 'valid';
  } catch {
    return false;
  }
}

/**
 * Create a captcha middleware for Auth routes.
 * @param expectedAction - Expected Turnstile action value (e.g. 'signup', 'signin')
 */
export function captchaMiddleware(expectedAction: string) {
  return async (c: HonoContext, next: Next) => {
    const captchaConfig = resolveCaptchaConfig(c.env, c.req.raw);

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
              + 'Requests will continue without CAPTCHA only in local development mode. '
              + 'Add CAPTCHA_SITE_KEY, TURNSTILE_SECRET, and CAPTCHA_HOSTNAMES, or set captcha: false.',
            );
          }
        }
      } catch { /* ignore */ }
      await next();
      return;
    }

    // Step 3: Valid Service Key → bypass
    if (hasValidServiceKey(c)) {
      await next();
      return;
    }

    // Step 4: Extract token
    const token = await extractCaptchaToken(c, expectedAction === 'oauth');

    // Step 5: No token → 403
    if (!token) {
      return c.json({ code: 403, message: 'Captcha verification required.', data: { captcha_required: true } }, 403);
    }

    // Step 6: siteverify
    const timeout = captchaConfig.siteverifyTimeout ?? 3000;
    const failMode = captchaConfig.failMode ?? 'closed';
    const remoteip = getTrustedClientIp(c.env, c.req);

    const result = await siteverify(captchaConfig.secretKey, token, remoteip, timeout);

    // Handle siteverify API failure (timeout, network error)
    if (
      result['error-codes']?.includes('timeout-or-network-error')
    ) {
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

    if (
      result['error-codes']?.includes('siteverify-service-error')
      || result['error-codes']?.includes('internal-error')
    ) {
      return c.json({ code: 503, message: 'Captcha service unavailable.' }, 503);
    }

    // Step 7: Verify success + action
    if (result.success !== true) {
      return c.json({ code: 403, message: 'Captcha verification failed.', data: { captcha_required: true } }, 403);
    }

    // Action + hostname verification are mandatory domain-separation checks.
    if (result.action !== expectedAction) {
      return c.json({
        code: 403,
        message: `Captcha action mismatch: expected '${expectedAction}'.`,
        data: { captcha_required: true },
      }, 403);
    }
    const expectedHostnames = captchaConfig.hostnames;
    const resultHostname = typeof result.hostname === 'string'
      ? normalizeHostname(result.hostname)
      : null;
    if (!resultHostname || !expectedHostnames.includes(resultHostname)) {
      return c.json({
        code: 403,
        message: 'Captcha hostname verification failed.',
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
  // Turnstile actions accept only [A-Za-z0-9_-] and are capped at 32 bytes.
  // Keep one stable domain-separation value for all protected HTTP functions;
  // the matched route remains the authorization boundary in EdgeBase itself.
  void functionName;
  return captchaMiddleware('function');
}

// ─── Test exports (for unit testing only) ───
export const _test = {
  resolveCaptchaConfig,
  extractCaptchaToken,
  hasValidServiceKey,
  siteverify,
  readBoundedResponseJson,
};
