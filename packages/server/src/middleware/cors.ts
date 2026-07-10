import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types.js';
import { parseConfig } from '../lib/do-router.js';

type HonoEnv = { Bindings: Env };

interface CorsConfig {
  origin?: string | string[];
  methods?: string[];
  credentials?: boolean;
  maxAge?: number;
}

interface ResolvedCorsHeaders {
  allowOrigin: string;
  allowMethods: string;
  allowHeaders: string;
  allowCredentials: boolean;
  maxAge: string;
}

/**
 * Convert wildcard origin pattern to regex.
 * e.g. '*.example.com' → /^https?:\/\/.*\.example\.com$/
 */
export function wildcardToRegex(pattern: string): RegExp {
  const explicitScheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(pattern)?.[0].toLowerCase();
  if (explicitScheme && explicitScheme !== 'http://' && explicitScheme !== 'https://') {
    return /$a/;
  }
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(explicitScheme ? `^${escaped}$` : `^https?:\\/\\/${escaped}$`);
}

/**
 * Match an origin against the allowed-origins config, distinguishing an exact
 * match from a wildcard (`*` / `*.example.com`) match.
 *
 * The distinction is security-critical: browsers forbid credentialed CORS with a
 * wildcard, and reflecting the requester's origin *with* credentials whenever a
 * wildcard matched would let any site read authenticated cross-origin responses.
 * Credentials are therefore only ever emitted for an exact-origin match.
 */
export function matchOrigin(
  origin: string,
  allowedOrigins: string | string[],
): { allowed: boolean; viaWildcard: boolean } {
  if (allowedOrigins === '*') return { allowed: true, viaWildcard: true };

  const origins = Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins];

  // Exact entries always win, independent of array order. This preserves
  // credentialed access when a broader wildcard is also configured.
  if (origins.includes(origin)) return { allowed: true, viaWildcard: false };

  for (const pattern of origins) {
    if (pattern === '*') return { allowed: true, viaWildcard: true };
    // Wildcard match — allowed, but never with credentials.
    if (pattern.includes('*') && wildcardToRegex(pattern).test(origin)) {
      return { allowed: true, viaWildcard: true };
    }
  }
  return { allowed: false, viaWildcard: false };
}

/**
 * Check if origin matches allowed origins list.
 */
export function isOriginAllowed(origin: string, allowedOrigins: string | string[]): boolean {
  return matchOrigin(origin, allowedOrigins).allowed;
}

function resolveCorsHeaders(
  origin: string,
  configuredOrigins: CorsConfig['origin'],
  methods: string[],
  credentials: boolean,
  maxAge: number,
): ResolvedCorsHeaders | null {
  if (!origin) return null;

  let allowed = false;
  let viaWildcard = false;
  if (configuredOrigins) {
    const match = matchOrigin(origin, configuredOrigins);
    allowed = match.allowed;
    viaWildcard = match.viaWildcard;
  } else {
    // Default dev behavior: allow localhost loopback origins (treated as exact).
    allowed =
      /^http:\/\/localhost(:[0-9]+)?(\/|$)/.test(origin) ||
      /^http:\/\/127\.0\.0\.1(:[0-9]+)?(\/|$)/.test(origin);
  }

  if (!allowed) return null;

  // Credentials are only safe for an exact-origin match. Any wildcard match
  // (bare '*', array containing '*', or 'https://*.example.com') drops
  // credentials regardless of the configured `credentials` flag.
  const effectiveCredentials = credentials && !viaWildcard;

  return {
    // A credentialed response must echo the specific origin (never '*'); a
    // non-credentialed wildcard match may safely return '*'.
    allowOrigin: viaWildcard && !effectiveCredentials ? '*' : origin,
    allowMethods: methods.join(', '),
    allowHeaders: 'Content-Type, Authorization, X-EdgeBase-Service-Key, X-EdgeBase-Auth-Transport',
    allowCredentials: effectiveCredentials,
    maxAge: String(maxAge),
  };
}

function applyCorsHeaders(
  target: { set(name: string, value: string): void; get?(name: string): string | null | undefined },
  headers: ResolvedCorsHeaders | null,
): void {
  if (!headers) return;

  target.set('Access-Control-Allow-Origin', headers.allowOrigin);
  target.set('Access-Control-Allow-Methods', headers.allowMethods);
  target.set('Access-Control-Allow-Headers', headers.allowHeaders);
  target.set('Access-Control-Max-Age', headers.maxAge);
  if (headers.allowCredentials) {
    target.set('Access-Control-Allow-Credentials', 'true');
  }
  target.set('Vary', 'Origin');
}

export function decorateResponseHeaders(
  response: Response,
  headers: ResolvedCorsHeaders | null,
): Response {
  // WebSocket upgrade responses are not normal fetch responses:
  // Response() cannot be re-constructed with status 101, and browsers do not
  // use CORS response headers for successful WS upgrades.
  if (response.status === 101) {
    return response;
  }

  try {
    applyCorsHeaders(response.headers, headers);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
  } catch {
    const cloned = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
    applyCorsHeaders(cloned.headers, headers);
    cloned.headers.set('X-Content-Type-Options', 'nosniff');
    return cloned;
  }
}

/**
 * CORS middleware — config-aware.
 *
 * Reads cors config from bundled edgebase.config.ts.
 * Default: allow localhost origins for development.
 *
 * Validates:
 * - origin: '*' + credentials: true conflict (browser policy violation)
 * - Wildcard patterns converted to regex matching
 */
export const corsMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const origin = c.req.header('Origin') || '';

  // ── Parse config ──
  const config = parseConfig(c.env);
  const corsConfig = (config as Record<string, unknown>).cors as CorsConfig | undefined;

  // ── Determine allowed origins ──
  const configuredOrigins = corsConfig?.origin;
  const methods = corsConfig?.methods ?? ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'];
  const credentials = corsConfig?.credentials ?? true;
  const maxAge = corsConfig?.maxAge ?? 86400;
  const corsHeaders = resolveCorsHeaders(origin, configuredOrigins, methods, credentials, maxAge);

  // Handle preflight
  if (c.req.method === 'OPTIONS') {
    applyCorsHeaders({ set: c.header.bind(c) }, corsHeaders);
    return c.body(null, 204);
  }

  await next();
  c.res = decorateResponseHeaders(c.res, corsHeaders);
};
