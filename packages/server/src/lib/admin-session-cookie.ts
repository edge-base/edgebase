import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { EdgeBaseError } from '@edge-base/shared';
import type { Env } from '../types.js';
import { parseConfig } from './do-router.js';
import { parseDuration } from './jwt.js';
import { matchOrigin } from '../middleware/cors.js';

const AUTH_TRANSPORT_HEADER = 'X-EdgeBase-Auth-Transport';
const COOKIE_AUTH_TRANSPORT = 'cookie';
const ADMIN_REFRESH_COOKIE = 'edgebase-admin-refresh';
const ADMIN_AUTH_COOKIE_PATH = '/admin/api/auth';
const ADMIN_REFRESH_TOKEN_TTL = '28d';

type AdminAuthContext = Context<{ Bindings: Env }>;

export interface AdminSessionResponsePayload {
  accessToken: string;
  refreshToken: string;
  admin?: { id: string; email: string };
}

function rawTransport(c: AdminAuthContext): string | null {
  return c.req.header(AUTH_TRANSPORT_HEADER)?.trim().toLowerCase() ?? null;
}

function isSecureRequest(c: AdminAuthContext): boolean {
  if (new URL(c.req.url).protocol === 'https:') return true;
  if (parseConfig(c.env)?.trustSelfHostedProxy !== true) return false;
  const forwardedProto = c.req.header('X-Forwarded-Proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  return forwardedProto === 'https';
}

function requestOrigin(c: AdminAuthContext): URL {
  const url = new URL(c.req.url);
  if (url.protocol === 'http:' && isSecureRequest(c)) url.protocol = 'https:';
  return url;
}

function browserOrigin(c: AdminAuthContext): URL | null {
  const raw = c.req.header('Origin')?.trim();
  if (!raw) return null;
  try {
    const origin = new URL(raw);
    return origin.protocol === 'http:' || origin.protocol === 'https:'
      ? origin
      : null;
  } catch {
    return null;
  }
}

function usesCrossSiteCookie(c: AdminAuthContext): boolean {
  const origin = browserOrigin(c);
  if (!origin) return false;
  const target = requestOrigin(c);
  // SameSite is schemeful: http://example.com and https://example.com are
  // different sites even though their hostnames match.
  return origin.protocol !== target.protocol || origin.hostname !== target.hostname;
}

function adminRefreshCookieName(c: AdminAuthContext): string {
  return isSecureRequest(c)
    ? `__Secure-${ADMIN_REFRESH_COOKIE}`
    : ADMIN_REFRESH_COOKIE;
}

function cookieOptions(c: AdminAuthContext, maxAge: number) {
  const secure = isSecureRequest(c);
  const crossSite = usesCrossSiteCookie(c);
  if (crossSite && !secure) {
    throw new EdgeBaseError(
      400,
      'Cross-site admin cookie auth requires HTTPS or an explicitly trusted TLS proxy.',
      undefined,
      'insecure-cookie-config',
    );
  }
  return {
    httpOnly: true,
    secure,
    sameSite: crossSite ? 'none' as const : 'strict' as const,
    path: ADMIN_AUTH_COOKIE_PATH,
    maxAge,
    expires: new Date(Date.now() + Math.max(0, maxAge) * 1000),
    priority: 'high' as const,
  };
}

export function isAdminCookieAuthTransport(c: AdminAuthContext): boolean {
  return rawTransport(c) === COOKIE_AUTH_TRANSPORT;
}

/**
 * Cookie transport is explicitly negotiated and origin-bound. Merely carrying
 * the ambient cookie never authorizes a request.
 */
export function assertAdminAuthTransportAllowed(c: AdminAuthContext): void {
  const transport = rawTransport(c);
  if (transport === null) return;
  if (transport !== COOKIE_AUTH_TRANSPORT) {
    throw new EdgeBaseError(400, `Unsupported auth transport '${transport}'.`, undefined, 'invalid-input');
  }

  const origin = browserOrigin(c);
  if (!origin) {
    throw new EdgeBaseError(403, 'Admin cookie auth requests require a valid Origin header.', undefined, 'forbidden');
  }

  const target = requestOrigin(c);
  if (origin.origin === target.origin) {
    cookieOptions(c, 0);
    return;
  }

  const config = parseConfig(c.env);
  const cors = config.cors;
  if (cors?.credentials === false || !cors?.origin) {
    throw new EdgeBaseError(403, 'Admin cookie auth origin is not trusted.', undefined, 'forbidden');
  }
  const match = matchOrigin(origin.origin, cors.origin);
  if (!match.allowed || match.viaWildcard) {
    throw new EdgeBaseError(
      403,
      'Admin cookie auth requires an exact credentialed CORS origin.',
      undefined,
      'forbidden',
    );
  }
  cookieOptions(c, 0);
}

export function readAdminRefreshCookie(c: AdminAuthContext): string | null {
  return getCookie(c, adminRefreshCookieName(c)) ?? null;
}

export function setAdminRefreshCookie(c: AdminAuthContext, refreshToken: string): void {
  setCookie(
    c,
    adminRefreshCookieName(c),
    refreshToken,
    cookieOptions(c, parseDuration(ADMIN_REFRESH_TOKEN_TTL)),
  );
}

export function clearAdminRefreshCookie(c: AdminAuthContext): void {
  const currentName = adminRefreshCookieName(c);
  const options = cookieOptions(c, 0);
  setCookie(c, currentName, '', { ...options, expires: new Date(0) });

  // Clear the local-development name after an HTTP -> HTTPS transition too.
  if (currentName !== ADMIN_REFRESH_COOKIE) {
    setCookie(c, ADMIN_REFRESH_COOKIE, '', {
      ...options,
      secure: false,
      sameSite: 'strict',
      expires: new Date(0),
    });
  }
}

export function applyAdminAuthNoStore(c: AdminAuthContext): void {
  c.header('Cache-Control', 'no-store');
  c.header('Pragma', 'no-cache');
}

export function adminSessionResponse<T extends AdminSessionResponsePayload>(
  c: AdminAuthContext,
  payload: T,
  status: number = 200,
): Response {
  applyAdminAuthNoStore(c);
  if (!isAdminCookieAuthTransport(c)) return c.json(payload, status as never);

  setAdminRefreshCookie(c, payload.refreshToken);
  const { refreshToken: _refreshToken, ...safePayload } = payload;
  return c.json(
    { ...safePayload, sessionTransport: COOKIE_AUTH_TRANSPORT },
    status as never,
  );
}
