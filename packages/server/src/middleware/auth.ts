/**
 * Auth Middleware — JWT Access Token verification + auth context injection
 *
 * Parses `Authorization: Bearer {token}` from request headers.
 * If valid → sets `auth` context with user info.
 * If missing → sets `auth` to null (allows public endpoints).
 * If invalid/expired → returns 401.
 * If token present but JWT_USER_SECRET not configured → returns 401 (fail-closed,).
 */
import type { Context, Next } from 'hono';
import { getAuthEnrichHandler, type AuthContext as SharedAuthContext } from '@edge-base/shared';
import type { Env } from '../types.js';
import {
  verifyAccessToken,
  TokenExpiredError,
  TokenInvalidError,
  type VerifiedToken,
} from '../lib/jwt.js';
import {
  buildKeymap,
  extractBearerToken,
  extractServiceKeyHeader,
  matchesConfiguredSecret,
} from '../lib/service-key.js';
import { parseConfig } from '../lib/do-router.js';
import { usesCustomBearerAuth } from '../lib/functions.js';
import {
  AuthSessionAuthorityUnavailableError,
  isAuthSessionActive,
} from '../lib/auth-session-authority.js';

// Extend Hono context variables
declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext | null;
    serviceKeyToken: string | null;
    rateLimitAccessToken: {
      token: string;
      payload: VerifiedToken;
    } | null;
  }
}

export interface AuthContext extends SharedAuthContext {
  role: string;
  isAnonymous: boolean;
  /** auth enrich hook output — request-scoped extension data (#133 §38). Default: {} */
  meta: Record<string, unknown>;
}

interface AuthResolutionEnv {
  JWT_USER_SECRET?: string;
}

export function buildAuthContextFromPayload(payload: Record<string, unknown>): AuthContext {
  return {
    id: payload.sub as string,
    sessionId: typeof payload.sid === 'string' ? payload.sid : undefined,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    role: (payload.role as string) ?? 'user',
    isAnonymous: (payload.isAnonymous as boolean) ?? false,
    custom: (payload.custom as Record<string, unknown> | undefined) ?? undefined,
    meta: {},
  };
}

export async function enrichAuthContext(
  env: AuthResolutionEnv,
  auth: AuthContext,
  request: Request,
): Promise<AuthContext> {
  const config = parseConfig(env);
  const enrich = getAuthEnrichHandler(config);
  if (!enrich) return auth;

  try {
    const meta = await Promise.race([
      Promise.resolve(enrich(auth, request)),
      new Promise<Record<string, unknown>>((_, reject) =>
        setTimeout(() => reject(new Error('auth.handlers.hooks.enrich timeout')), 50),
      ),
    ]);
    auth.meta = meta ?? {};
  } catch {
    auth.meta = {};
  }

  return auth;
}

export async function resolveAuthContextFromToken(
  env: AuthResolutionEnv,
  token: string,
  request: Request,
  options: {
    skipSessionValidation?: boolean;
    verifiedPayload?: VerifiedToken;
  } = {},
): Promise<AuthContext> {
  const secret = env.JWT_USER_SECRET;
  if (!secret) {
    throw new TokenInvalidError('Authentication service not configured.');
  }

  const payload = options.verifiedPayload ?? await verifyAccessToken(token, secret);
  const auth = buildAuthContextFromPayload(payload as Record<string, unknown>);
  if (auth.sessionId && !options.skipSessionValidation) {
    const active = await isAuthSessionActive(
      env as Record<string, unknown>,
      auth.id,
      auth.sessionId,
    );
    if (!active) throw new TokenInvalidError('Session was revoked or expired.');
  }
  return enrichAuthContext(env, auth, request);
}

function matchesConfiguredServiceKeyCandidate(token: string, c: Context<{ Bindings: Env }>): boolean {
  const config = parseConfig(c.env);
  const keymap = buildKeymap(config, c.env);
  return matchesConfiguredSecret(token, keymap);
}

/**
 * Auth middleware — extracts and verifies JWT Access Token.
 * Non-blocking: if no token, sets auth to null (for public endpoints).
 * If token present but invalid/expired, returns 401.
 */
export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> {
  c.set('serviceKeyToken', null);

  // An explicit service key header wins over Bearer auth. Route-specific scope
  // validation happens downstream, but we must avoid parsing the paired
  // Authorization header as a user JWT first.
  const serviceKeyHeader =
    c.req.header('X-EdgeBase-Service-Key') ??
    c.req.header('x-edgebase-service-key') ??
    c.req.raw.headers.get('X-EdgeBase-Service-Key') ??
    c.req.raw.headers.get('x-edgebase-service-key') ??
    extractServiceKeyHeader(c.req);
  if (serviceKeyHeader !== undefined && serviceKeyHeader !== null) {
    c.set('serviceKeyToken', serviceKeyHeader);
    c.set('auth', null);
    return next();
  }

  // No token → public request
  const token = extractBearerToken(c.req);
  if (token === null) {
    c.set('auth', null);
    return next();
  }

  // Service Key shortcut — exact Service Key secret matches bypass JWT parsing
  // and are validated by downstream route/rules middleware.
  if (matchesConfiguredServiceKeyCandidate(token, c)) {
    c.set('serviceKeyToken', token);
    c.set('auth', null);
    return next();
  }

  // Some protocol endpoints (for example OAuth-protected MCP servers) issue
  // and validate their own Bearer tokens. This opt-in is route-specific and
  // delegates the raw header to the matched function without weakening the
  // fail-closed default for any other API route. Configured Service Keys keep
  // their normal precedence above this protocol-specific delegation.
  if (usesCustomBearerAuth(new URL(c.req.url).pathname, c.req.method)) {
    c.set('auth', null);
    return next();
  }

  try {
    if (!c.env.JWT_USER_SECRET) {
      // Fail-closed: token provided but cannot verify — reject
      return c.json(
        { code: 401, message: 'Authentication service not configured.', error: 'AUTH_NOT_CONFIGURED' },
        401,
      );
    }

    const pathname = new URL(c.req.url).pathname;
    const skipSessionValidation = c.req.method === 'POST' && (
      pathname === '/api/auth/oauth/complete/link' ||
      // The anonymous phone-upgrade transaction revokes the initiating sid.
      // This exact endpoint must be able to recover its encrypted completion
      // checkpoint after a lost response. The route revalidates the sid before
      // any fresh mutation and permits a revoked sid only for a matching,
      // already-committed phone/code checkpoint.
      pathname === '/api/auth/verify-link-phone' ||
      // Email/password anonymous upgrades have the same response-loss shape:
      // the route permits a revoked sid only to replay an exact bounded
      // initiating-sid/user/email/password checkpoint, then revalidates the
      // sid before any fresh mutation.
      pathname === '/api/auth/link/email'
    );
    const rateLimitAccessToken = c.get('rateLimitAccessToken');
    const auth = await resolveAuthContextFromToken(
      c.env,
      token,
      c.req.raw,
      {
        skipSessionValidation,
        verifiedPayload: rateLimitAccessToken?.token === token
          ? rateLimitAccessToken.payload
          : undefined,
      },
    );
    c.set('auth', auth);
    return next();
  } catch (err) {
    if (err instanceof AuthSessionAuthorityUnavailableError) {
      return c.json(
        {
          code: 503,
          message: 'Authentication session validation is temporarily unavailable.',
          error: 'AUTH_AUTHORITY_UNAVAILABLE',
        },
        503,
      );
    }
    // In non-release (dev) mode, treat invalid/expired tokens as anonymous
    // instead of hard-rejecting. This prevents stale tokens from blocking
    // the demo/dev experience while still validating in production.
    const config = parseConfig(c.env);
    if (!config.release) {
      c.set('auth', null);
      return next();
    }

    if (err instanceof TokenExpiredError) {
      return c.json(
        { code: 401, message: 'Token expired.', error: 'TOKEN_EXPIRED' },
        401,
      );
    }
    if (err instanceof TokenInvalidError) {
      return c.json(
        { code: 401, message: 'Invalid token.', error: 'TOKEN_INVALID' },
        401,
      );
    }
    return c.json(
      { code: 401, message: 'Authentication failed.', error: 'AUTH_FAILED' },
      401,
    );
  }
}
