import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { EdgeBaseError } from '@edge-base/shared';
import type { Env } from '../types.js';
import { parseConfig } from './do-router.js';
import { parseDuration } from './jwt.js';
import { matchOrigin } from '../middleware/cors.js';
import { trustsSelfHostedProxyHeaders } from './public-origin.js';
import { getTrustedClientIp } from './client-ip.js';

const AUTH_TRANSPORT_HEADER = 'X-EdgeBase-Auth-Transport';
const COOKIE_AUTH_TRANSPORT = 'cookie';
const AUTH_COOKIE_PATH = '/api/auth';
const OAUTH_COOKIE_PATH = `${AUTH_COOKIE_PATH}/oauth`;

type AuthContext = Context<{ Bindings: Env }>;
type SameSite = 'strict' | 'lax' | 'none';

interface SessionCookieConfig {
  enabled: boolean;
  allowInsecureLocalhost: boolean;
  name: string;
  legacyNames: string[];
  sameSite: SameSite;
}

export interface SessionResponsePayload {
  accessToken: string;
  refreshToken: string;
  sessionId?: string;
}

function cookieConfig(c: AuthContext): SessionCookieConfig {
  const configured = parseConfig(c.env)?.auth?.session?.cookie;
  return {
    enabled: configured?.enabled === true,
    allowInsecureLocalhost: configured?.allowInsecureLocalhost === true,
    name: configured?.name ?? 'edgebase-refresh',
    legacyNames: configured?.legacyNames ?? [],
    sameSite: configured?.sameSite ?? 'strict',
  };
}

function isSecureRequest(c: AuthContext): boolean {
  if (new URL(c.req.url).protocol === 'https:') return true;
  if (!trustsSelfHostedProxyHeaders(c.env)) return false;
  const forwardedProto = c.req.header('X-Forwarded-Proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  return forwardedProto === 'https';
}

function requestUsesSecureCookies(c: AuthContext): boolean {
  return isSecureRequest(c);
}

function isExplicitLocalDevelopmentLoopback(c: AuthContext): boolean {
  if (c.env?.EDGEBASE_RUNTIME_MODE !== 'local-development') return false;
  const url = new URL(c.req.raw.url);
  const ip = getTrustedClientIp(c.env, c.req.raw);
  const loopbackPeer = ip === '::1' || ip === '[::1]' || ip?.startsWith('127.') === true;
  return loopbackPeer && url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
}

function isExplicitSelfHostedLocalhost(c: AuthContext): boolean {
  if (c.env?.EDGEBASE_RUNTIME_MODE !== 'self-hosted') return false;
  if (!cookieConfig(c).allowInsecureLocalhost) return false;
  const url = new URL(c.req.raw.url);
  return url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
}

function refreshCookieName(c: AuthContext): string {
  const config = cookieConfig(c);
  return requestUsesSecureCookies(c)
    ? `__Host-${config.name}`
    : config.name;
}

function cookieOptions(c: AuthContext, maxAge: number) {
  const config = cookieConfig(c);
  const secure = requestUsesSecureCookies(c);
  return {
    httpOnly: true,
    secure,
    sameSite: config.sameSite,
    path: secure ? '/' : AUTH_COOKIE_PATH,
    maxAge,
    expires: new Date(Date.now() + Math.max(0, maxAge) * 1000),
    priority: 'high' as const,
  };
}

function rawTransport(c: AuthContext): string | null {
  return c.req.header(AUTH_TRANSPORT_HEADER)?.trim().toLowerCase() ?? null;
}

export function isCookieAuthTransport(c: AuthContext): boolean {
  return rawTransport(c) === COOKIE_AUTH_TRANSPORT;
}

export function assertCookieAuthEnabled(c: AuthContext): void {
  const config = cookieConfig(c);
  if (!config.enabled) {
    throw new EdgeBaseError(400, 'Refresh cookie transport is not enabled.', undefined, 'feature-not-enabled');
  }
  if (
    parseConfig(c.env)?.release === true
    && !isSecureRequest(c)
    && !isExplicitLocalDevelopmentLoopback(c)
    && !isExplicitSelfHostedLocalhost(c)
  ) {
    throw new EdgeBaseError(
      400,
      'Cookie authentication requires HTTPS in release mode.',
      undefined,
      'insecure-cookie-config',
    );
  }
  if (config.sameSite === 'none' && !isSecureRequest(c)) {
    throw new EdgeBaseError(
      400,
      'auth.session.cookie.sameSite="none" requires HTTPS or an explicitly trusted TLS proxy.',
      undefined,
      'insecure-cookie-config',
    );
  }
}

/**
 * Validate the opt-in cookie transport before a route performs any mutation.
 * Merely carrying a cookie never opts a request in: the custom header is an
 * intentional, preflighted CSRF boundary.
 */
export function assertAuthTransportAllowed(c: AuthContext): void {
  const transport = rawTransport(c);
  if (transport === null) return;
  if (transport !== COOKIE_AUTH_TRANSPORT) {
    throw new EdgeBaseError(400, `Unsupported auth transport '${transport}'.`, undefined, 'invalid-input');
  }

  assertCookieAuthEnabled(c);

  const rawOrigin = c.req.header('Origin')?.trim();
  if (!rawOrigin) {
    throw new EdgeBaseError(
      403,
      'Cookie auth requests require an Origin header.',
      undefined,
      'cookie-auth-origin-required',
    );
  }

  let browserOrigin: URL;
  let requestUrl: URL;
  try {
    browserOrigin = new URL(rawOrigin);
    if (browserOrigin.protocol !== 'http:' && browserOrigin.protocol !== 'https:') {
      throw new Error('unsupported origin scheme');
    }
    requestUrl = new URL(c.req.url);
    // A trusted TLS-terminating proxy makes the browser-facing origin HTTPS
    // even though the upstream request is HTTP. Reconstruct only the scheme
    // covered by the explicit proxy-trust contract; never trust a forwarded
    // host here.
    if (requestUrl.protocol === 'http:' && isSecureRequest(c)) {
      requestUrl.protocol = 'https:';
    }
  } catch {
    throw new EdgeBaseError(
      403,
      'Cookie auth request origin could not be verified.',
      undefined,
      'cookie-auth-origin-unverifiable',
    );
  }
  if (browserOrigin.origin === requestUrl.origin) return;

  const cors = parseConfig(c.env)?.cors;
  if (cors?.credentials === false || !cors?.origin) {
    throw new EdgeBaseError(
      403,
      'Cookie auth origin is not trusted.',
      undefined,
      'cookie-auth-origin-untrusted',
    );
  }
  const match = matchOrigin(browserOrigin.origin, cors.origin);
  if (!match.allowed || match.viaWildcard) {
    throw new EdgeBaseError(
      403,
      'Cookie auth requires an exact trusted origin.',
      undefined,
      'cookie-auth-origin-untrusted',
    );
  }

  const crossSite = c.req.header('Sec-Fetch-Site')?.trim().toLowerCase() === 'cross-site'
    || browserOrigin.protocol !== requestUrl.protocol
    || browserOrigin.hostname !== requestUrl.hostname;
  if (crossSite && cookieConfig(c).sameSite !== 'none') {
    throw new EdgeBaseError(
      400,
      'Cross-site cookie auth requires auth.session.cookie.sameSite="none".',
      undefined,
      'incompatible-cookie-config',
    );
  }
}

export function readRefreshCookie(c: AuthContext): string | null {
  return getCookie(c, refreshCookieName(c)) ?? null;
}

export function setRefreshCookie(c: AuthContext, refreshToken: string): void {
  assertCookieAuthEnabled(c);
  const ttl = parseDuration(parseConfig(c.env)?.auth?.session?.refreshTokenTTL ?? '28d');
  setCookie(c, refreshCookieName(c), refreshToken, cookieOptions(c, ttl));
  expireLegacyRefreshCookies(c);
}

export function clearRefreshCookie(c: AuthContext): void {
  const currentName = refreshCookieName(c);
  const options = cookieOptions(c, 0);
  setCookie(c, currentName, '', { ...options, expires: new Date(0) });

  expireLegacyRefreshCookies(c);
}

function expireCookieAtPath(
  c: AuthContext,
  name: string,
  path: string,
  secure: boolean,
  sameSite: SameSite = 'strict',
): void {
  setCookie(c, name, '', {
    httpOnly: true,
    secure,
    sameSite,
    path,
    maxAge: 0,
    expires: new Date(0),
    priority: 'high',
  });
}

/** Expire predecessor names/paths without ever accepting or migrating them. */
function expireLegacyRefreshCookies(c: AuthContext): void {
  const config = cookieConfig(c);
  const secure = isSecureRequest(c);

  // On HTTPS the current cookie is __Host-prefixed, so retire predecessor
  // variants of its base name left by older EdgeBase cookie handling.
  if (secure) {
    expireCookieAtPath(c, `__Secure-${config.name}`, AUTH_COOKIE_PATH, true);
    expireCookieAtPath(c, config.name, AUTH_COOKIE_PATH, false);
  }

  // Product cookie renames are deletion-only compatibility. Never read any of
  // these names: expire every formerly issued variant that the current request
  // can safely overwrite, including the old __Host cookie at Path=/.
  for (const legacyName of config.legacyNames) {
    if (secure) {
      expireCookieAtPath(c, `__Host-${legacyName}`, '/', true);
      expireCookieAtPath(c, `__Secure-${legacyName}`, AUTH_COOKIE_PATH, true);
    }
    expireCookieAtPath(c, legacyName, AUTH_COOKIE_PATH, false);
  }
}

export function applyAuthNoStore(c: AuthContext): void {
  c.header('Cache-Control', 'no-store');
  c.header('Pragma', 'no-cache');
}

export function sessionResponse<T extends SessionResponsePayload>(
  c: AuthContext,
  payload: T,
  status: number = 200,
): Response {
  applyAuthNoStore(c);
  if (!isCookieAuthTransport(c)) {
    return c.json(payload, status as never);
  }

  return cookieSessionResponse(c, payload, status);
}

export function cookieSessionResponse<T extends SessionResponsePayload>(
  c: AuthContext,
  payload: T,
  status: number = 200,
): Response {
  applyAuthNoStore(c);
  const requestPath = new URL(c.req.raw.url).pathname;
  if (!requestPath.endsWith('/auth/refresh')) {
    // Any authoritative non-refresh session transition supersedes OAuth flows
    // initiated under the previous browser identity generation.
    rotateOAuthBrowserGeneration(c);
  }
  setRefreshCookie(c, payload.refreshToken);
  const { refreshToken: _refreshToken, ...safePayload } = payload;
  return c.json(
    { ...safePayload, sessionTransport: COOKIE_AUTH_TRANSPORT },
    status as never,
  );
}

function oauthStateCookieName(c: AuthContext, state: string): string {
  const secure = isSecureRequest(c);
  const base = `${cookieConfig(c).name}-oauth-${state.slice(0, 32)}`;
  return secure ? `__Host-${base}` : base;
}

function oauthBrowserGenerationCookieName(c: AuthContext): string {
  const secure = isSecureRequest(c);
  const base = `${cookieConfig(c).name}-oauth-generation`;
  return secure ? `__Host-${base}` : base;
}

function generateOAuthBrowserGeneration(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function setOAuthBrowserGenerationCookie(c: AuthContext, value: string): void {
  const secure = isSecureRequest(c);
  setCookie(c, oauthBrowserGenerationCookieName(c), value, {
    httpOnly: true,
    secure,
    // Secure deployments use None so Apple's cross-site form_post carries the
    // generation fence. The value is random, HttpOnly, and validated together
    // with the per-flow state cookie.
    sameSite: secure ? 'none' : 'lax',
    path: secure ? '/' : OAUTH_COOKIE_PATH,
    maxAge: 86_400,
    expires: new Date(Date.now() + 86_400_000),
    priority: 'high',
  });
}

export function ensureOAuthBrowserGeneration(c: AuthContext): string {
  const existing = getCookie(c, oauthBrowserGenerationCookieName(c));
  const value = existing && /^[0-9a-f]{64}$/.test(existing)
    ? existing
    : generateOAuthBrowserGeneration();
  setOAuthBrowserGenerationCookie(c, value);
  expireLegacyOAuthGenerationCookies(c);
  return value;
}

/** Read the existing generation without minting authority during completion. */
export function readOAuthBrowserGeneration(c: AuthContext): string | null {
  const value = getCookie(c, oauthBrowserGenerationCookieName(c));
  return value && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

export function verifyOAuthBrowserGeneration(c: AuthContext, expected: string): boolean {
  return getCookie(c, oauthBrowserGenerationCookieName(c)) === expected;
}

/** Fence OAuth flows started before any authoritative browser session transition. */
export function setOAuthBrowserGeneration(c: AuthContext, value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new EdgeBaseError(500, 'Invalid OAuth browser generation.', undefined, 'internal-error');
  }
  setOAuthBrowserGenerationCookie(c, value);
  expireLegacyOAuthGenerationCookies(c);
}

export function rotateOAuthBrowserGeneration(c: AuthContext): string {
  const value = generateOAuthBrowserGeneration();
  setOAuthBrowserGeneration(c, value);
  return value;
}

export function setOAuthStateCookie(
  c: AuthContext,
  state: string,
  options: { crossSitePost?: boolean } = {},
): void {
  const secure = isSecureRequest(c);
  if (options.crossSitePost && !secure) {
    throw new EdgeBaseError(
      400,
      'Cross-site OAuth POST callbacks require HTTPS for secure state binding.',
      undefined,
      'validation-failed',
    );
  }
  setCookie(c, oauthStateCookieName(c, state), state, {
    httpOnly: true,
    secure,
    sameSite: options.crossSitePost ? 'none' : 'lax',
    path: secure ? '/' : OAUTH_COOKIE_PATH,
    maxAge: 300,
    expires: new Date(Date.now() + 300_000),
    priority: 'high',
  });
  if (secure) {
    const base = `${cookieConfig(c).name}-oauth-${state.slice(0, 32)}`;
    expireCookieAtPath(c, `__Secure-${base}`, OAUTH_COOKIE_PATH, true, options.crossSitePost ? 'none' : 'lax');
    expireCookieAtPath(c, base, OAUTH_COOKIE_PATH, false);
  }
}

export function verifyOAuthStateCookie(
  c: AuthContext,
  state: string,
): boolean {
  return getCookie(c, oauthStateCookieName(c, state)) === state;
}

export function clearOAuthStateCookie(
  c: AuthContext,
  state: string,
  options: { crossSitePost?: boolean } = {},
): void {
  const secure = isSecureRequest(c);
  const name = oauthStateCookieName(c, state);
  setCookie(c, name, '', {
    httpOnly: true,
    secure,
    sameSite: options.crossSitePost ? 'none' : 'lax',
    path: secure ? '/' : OAUTH_COOKIE_PATH,
    maxAge: 0,
    expires: new Date(0),
  });
  if (secure) {
    const base = `${cookieConfig(c).name}-oauth-${state.slice(0, 32)}`;
    expireCookieAtPath(c, `__Secure-${base}`, OAUTH_COOKIE_PATH, true, options.crossSitePost ? 'none' : 'lax');
    expireCookieAtPath(c, base, OAUTH_COOKIE_PATH, false);
  }
}

export function verifyAndClearOAuthStateCookie(
  c: AuthContext,
  state: string,
  options: { crossSitePost?: boolean } = {},
): boolean {
  const verified = verifyOAuthStateCookie(c, state);
  clearOAuthStateCookie(c, state, options);
  return verified;
}

function expireLegacyOAuthGenerationCookies(c: AuthContext): void {
  if (!isSecureRequest(c)) return;
  const base = `${cookieConfig(c).name}-oauth-generation`;
  expireCookieAtPath(c, `__Secure-${base}`, OAUTH_COOKIE_PATH, true, 'none');
  expireCookieAtPath(c, base, OAUTH_COOKIE_PATH, false);
}
