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
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^https?:\\/\\/${escaped}$`);
}

/**
 * Check if origin matches allowed origins list.
 */
export function isOriginAllowed(origin: string, allowedOrigins: string | string[]): boolean {
  if (allowedOrigins === '*') return true;

  const origins = Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins];

  for (const pattern of origins) {
    // Exact match
    if (pattern === origin) return true;
    // Wildcard match
    if (pattern.includes('*')) {
      if (wildcardToRegex(pattern).test(origin)) return true;
    }
  }
  return false;
}

function resolveCorsHeaders(
  origin: string,
  configuredOrigins: CorsConfig['origin'],
  methods: string[],
  credentials: boolean,
  maxAge: number,
): ResolvedCorsHeaders | null {
  if (!origin) return null;

  const isWildcardOrigin = configuredOrigins === '*';
  const effectiveCredentials = isWildcardOrigin ? false : credentials;

  let isAllowed = false;
  if (configuredOrigins) {
    isAllowed = isOriginAllowed(origin, configuredOrigins);
  } else {
    isAllowed =
      /^http:\/\/localhost(:[0-9]+)?(\/|$)/.test(origin) ||
      /^http:\/\/127\.0\.0\.1(:[0-9]+)?(\/|$)/.test(origin);
  }

  if (!isAllowed) return null;

  return {
    allowOrigin: effectiveCredentials ? origin : (isWildcardOrigin ? '*' : origin),
    allowMethods: methods.join(', '),
    allowHeaders: 'Content-Type, Authorization, X-EdgeBase-Service-Key',
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
