import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { EdgeBaseError } from '@edge-base/shared';
import type { Env } from '../types.js';
import { parseConfig } from './do-router.js';
import { parseDuration } from './jwt.js';
import { matchOrigin } from '../middleware/cors.js';

const AUTH_TRANSPORT_HEADER = 'X-EdgeBase-Auth-Transport';
const COOKIE_AUTH_TRANSPORT = 'cookie';
const AUTH_COOKIE_PATH = '/api/auth';

type AuthContext = Context<{ Bindings: Env }>;
type SameSite = 'strict' | 'lax' | 'none';

interface SessionCookieConfig {
  enabled: boolean;
  name: string;
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
    name: configured?.name ?? 'edgebase-refresh',
    sameSite: configured?.sameSite ?? 'strict',
  };
}

function isSecureRequest(c: AuthContext): boolean {
  if (new URL(c.req.url).protocol === 'https:') return true;
  if (parseConfig(c.env)?.trustSelfHostedProxy !== true) return false;
  const forwardedProto = c.req.header('X-Forwarded-Proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  return forwardedProto === 'https';
}

function requestUsesSecureCookies(c: AuthContext): boolean {
  return isSecureRequest(c);
}

function refreshCookieName(c: AuthContext): string {
  const config = cookieConfig(c);
  return requestUsesSecureCookies(c)
    ? `__Secure-${config.name}`
    : config.name;
}

function cookieOptions(c: AuthContext, maxAge: number) {
  const config = cookieConfig(c);
  const secure = requestUsesSecureCookies(c);
  return {
    httpOnly: true,
    secure,
    sameSite: config.sameSite,
    path: AUTH_COOKIE_PATH,
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
    throw new EdgeBaseError(403, 'Cookie auth requests require an Origin header.', undefined, 'forbidden');
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
    throw new EdgeBaseError(403, 'Cookie auth request origin could not be verified.', undefined, 'forbidden');
  }
  if (browserOrigin.origin === requestUrl.origin) return;

  const cors = parseConfig(c.env)?.cors;
  if (cors?.credentials === false || !cors?.origin) {
    throw new EdgeBaseError(403, 'Cookie auth origin is not trusted.', undefined, 'forbidden');
  }
  const match = matchOrigin(browserOrigin.origin, cors.origin);
  if (!match.allowed || match.viaWildcard) {
    throw new EdgeBaseError(403, 'Cookie auth requires an exact trusted origin.', undefined, 'forbidden');
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
}

export function clearRefreshCookie(c: AuthContext): void {
  const currentName = refreshCookieName(c);
  const options = cookieOptions(c, 0);
  setCookie(c, currentName, '', { ...options, expires: new Date(0) });

  // When HTTPS is introduced after local HTTP development, also clear the
  // unprefixed development cookie. It is never accepted on the secure path.
  const baseName = cookieConfig(c).name;
  if (currentName !== baseName) {
    setCookie(c, baseName, '', {
      ...options,
      secure: false,
      sameSite: 'strict',
      expires: new Date(0),
    });
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
  return secure ? `__Secure-${base}` : base;
}

export function setOAuthStateCookie(c: AuthContext, state: string): void {
  const secure = isSecureRequest(c);
  setCookie(c, oauthStateCookieName(c, state), state, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: `${AUTH_COOKIE_PATH}/oauth`,
    maxAge: 300,
    expires: new Date(Date.now() + 300_000),
    priority: 'high',
  });
}

export function verifyAndClearOAuthStateCookie(c: AuthContext, state: string): boolean {
  const name = oauthStateCookieName(c, state);
  const value = getCookie(c, name);
  setCookie(c, name, '', {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: 'lax',
    path: `${AUTH_COOKIE_PATH}/oauth`,
    maxAge: 0,
    expires: new Date(0),
  });
  return value === state;
}
