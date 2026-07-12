import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types.js';
import type { EdgeBaseConfig } from '@edge-base/shared';
import {
  buildKeymap,
  extractBearerToken,
  extractServiceKeyHeader,
  validateConfiguredKey,
  type ConstraintContext,
} from '../lib/service-key.js';
import { parseConfig } from '../lib/do-router.js';
import { getTrustedClientIp } from '../lib/client-ip.js';
import { resolveFrontendAssetPath } from '../lib/frontend-assets.js';
import { normalizeFrontendMountPath } from '../lib/frontend-config.js';

type HonoEnv = { Bindings: Env };

/**
 * Rate Limiting middleware — 2-layer architecture.
 *
 * Layer 1: Software counter (per-isolate FixedWindowCounter)
 *   - Reads limits from the bundled runtime config (user-configurable)
 *   - Falls back to sensible defaults if config is not set
 *
 * Layer 2: Cloudflare Rate Limiting Binding (ceiling safety net)
 *   - All Bindings set to 10,000,000/60s in wrangler.toml
 *   - Catches cases where isolate restarts reset software counters
 *   - Miniflare emulates in all environments (Edge, dev, self-hosting)
 *
 * Groups handled here:
 *   - `global`      — API/control routes (last-resort safety net)
 *   - `db` — /api/db/* table CRUD
 *   - `storage`     — /api/storage/*
 *   - `functions`   — /api/functions/*
 *
 * Auth-specific groups (auth, authSignin, authSignup) are applied
 * directly in auth routes using the exported counter and helpers.
 *
 * Valid Service Key requests bypass app-level rate limits entirely.
 */

// ─── Defaults (used when config.rateLimiting is not set) ───

export const RATE_LIMIT_DEFAULTS: Record<string, { requests: number; windowSec: number }> = {
  global:      { requests: 10_000_000, windowSec: 60 },
  db:          { requests: 100,        windowSec: 60 },
  storage:     { requests: 50,         windowSec: 60 },
  functions:   { requests: 50,         windowSec: 60 },
  auth:        { requests: 30,         windowSec: 60 },
  authSignin:  { requests: 10,         windowSec: 60 },
  authSignup:  { requests: 10,         windowSec: 60 },
  events:      { requests: 100,        windowSec: 60 },
  realtime:    { requests: 120,        windowSec: 60 },
};

// Dev mode defaults: significantly higher to accommodate React strict mode double-rendering,
// hot-reload page refreshes, onSnapshot polling, and multi-client testing during development.
export const RATE_LIMIT_DEV_DEFAULTS: Record<string, { requests: number; windowSec: number }> = {
  global:      { requests: 10_000_000, windowSec: 60 },
  db:          { requests: 5000,       windowSec: 60 },
  storage:     { requests: 1000,       windowSec: 60 },
  functions:   { requests: 1000,       windowSec: 60 },
  auth:        { requests: 500,        windowSec: 60 },
  authSignin:  { requests: 100,        windowSec: 60 },
  authSignup:  { requests: 100,        windowSec: 60 },
  events:      { requests: 5000,       windowSec: 60 },
  realtime:    { requests: 5000,       windowSec: 60 },
};

// ─── Window parser ───

/** Parse window string ('60s', '5m', '1h') or number (seconds) to seconds */
export function parseWindow(window: string | number): number {
  if (typeof window === 'number') return window > 0 ? window : 60;
  const match = window.match(/^(\d+)(s|m|h)$/);
  if (!match) return 60; // fallback
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    default:  return 60;
  }
}

// ─── Fixed Window Counter (per-isolate memory) ───

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Per-isolate in-memory Fixed Window Counter.
 * Provides config-driven rate limiting with automatic expiry cleanup.
 *
 * Accuracy:
 * - Self-hosting (single process): exact
 * - Cloudflare Edge (multiple isolates): approximate (each isolate has own counter)
 * - Binding ceiling provides absolute safety regardless of counter accuracy
 */
export class FixedWindowCounter {
  private buckets = new Map<string, Bucket>();
  private lastCleanup = Date.now();
  private static readonly CLEANUP_INTERVAL = 120_000; // 2 minutes

  /**
   * Check and increment counter. Returns true if within limit.
   * @param key Unique key (e.g., 'db:1.2.3.4')
   * @param limit Max requests per window
   * @param windowSec Window size in seconds
   */
  check(key: string, limit: number, windowSec: number): boolean {
    const now = Date.now();
    this.maybeCleanup(now);

    // limit=0 means "always blocked" (ban-mode) — never allow any request
    if (limit <= 0) return false;

    const windowMs = windowSec * 1000;
    const bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (bucket.count >= limit) {
      return false;
    }

    bucket.count++;
    return true;
  }

  /** Get remaining seconds until reset for a key (for Retry-After header).
   * Returns 0 if key has never been seen — no active rate-limit window exists. */
  getRetryAfter(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    return Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000));
  }

  /** Clear all buckets. Called when config changes to avoid stale limits blocking requests. */
  reset(): void {
    this.buckets.clear();
  }

  private maybeCleanup(now: number): void {
    if (now - this.lastCleanup < FixedWindowCounter.CLEANUP_INTERVAL) return;
    this.lastCleanup = now;
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }
}

// ─── Singleton counter (shared within isolate) ───

export const counter = new FixedWindowCounter();

// ─── Helpers ───

/** Get config-based limit for a group, with fallback to defaults.
 * In dev mode (release !== true), uses relaxed defaults to avoid
 * rate limiting during development with hot-reload and strict mode. */
export function getLimit(
  config: EdgeBaseConfig | undefined,
  group: string,
): { requests: number; windowSec: number } {
  const rl = config?.rateLimiting;
  if (rl) {
    const configGroup = rl[group as keyof typeof rl];
    if (configGroup?.requests != null && configGroup?.window) {
      return {
        requests: configGroup.requests,
        windowSec: parseWindow(configGroup.window),
      };
    }
  }
  const isDevMode = config?.release !== true;
  const defaults = isDevMode ? RATE_LIMIT_DEV_DEFAULTS : RATE_LIMIT_DEFAULTS;
  return defaults[group] ?? { requests: 10_000_000, windowSec: 60 };
}

/** Map group name to the corresponding env binding */
function getBinding(env: Env, group: string): RateLimit | undefined {
  if (!env) return undefined;
  switch (group) {
    case 'global':      return env.GLOBAL_RATE_LIMITER;
    case 'db': return env.DB_RATE_LIMITER;
    case 'storage':     return env.STORAGE_RATE_LIMITER;
    case 'functions':   return env.FUNCTIONS_RATE_LIMITER;
    case 'events':      return env.EVENTS_RATE_LIMITER;
    default:            return undefined;
  }
}

const RATE_LIMITED_CONTROL_PATHS = [
  '/api',
  '/admin/api',
  '/internal',
  '/.well-known',
  '/cdn-cgi',
] as const;

function isPathAtOrBelow(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Static bytes must not consume the API-wide per-IP budget. A single frontend
 * cold load can request hundreds of immutable chunks, and charging those
 * requests to `global` lets ordinary page loads starve auth/API traffic.
 *
 * Only GET/HEAD requests that are actually owned by the configured frontend or
 * the built-in admin/harness asset mounts bypass the limiter. API, admin API,
 * internal, metadata, and Cloudflare control paths always remain limited.
 */
export function isRateLimitExemptStaticRequest(
  path: string,
  options: {
    method?: string;
    accept?: string | null;
    config?: EdgeBaseConfig;
  } = {},
): boolean {
  const method = (options.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;

  if (
    path === '/openapi.json'
    || RATE_LIMITED_CONTROL_PATHS.some((prefix) => isPathAtOrBelow(path, prefix))
  ) {
    return false;
  }

  // Built-in dashboard and integration-harness assets are served by ASSETS.
  if (
    path === '/admin'
    || path.startsWith('/admin/')
    || path === '/harness'
    || path.startsWith('/harness/')
    || path === '/favicon.ico'
    || path === '/favicon.svg'
    || path.startsWith('/_app/')
  ) {
    return true;
  }

  const frontend = options.config?.frontend;
  if (!frontend) return false;

  const resolvedAssetPath = resolveFrontendAssetPath(path, {
    method,
    accept: options.accept,
    mountPath: frontend.mountPath,
    spaFallback: frontend.spaFallback,
  });
  if (resolvedAssetPath === null) return false;

  const mountPath = normalizeFrontendMountPath(frontend.mountPath);
  const isMountRoot = mountPath === '/'
    ? path === '/'
    : path === mountPath || path === `${mountPath}/`;
  const isExplicitAsset = (path.split('/').pop() ?? '').includes('.');
  const isHtmlNavigation = frontend.spaFallback === true
    && !!options.accept
    && (options.accept.includes('text/html') || options.accept.includes('application/xhtml+xml'));

  return isMountRoot || isExplicitAsset || isHtmlNavigation;
}

/** Determine the rate limit group for a request path */
export function getGroup(path: string): string {
  if (path.startsWith('/api/db/')) {
    // Database-live endpoints live under /api/db/ but are not database CRUD
    // operations. They still need a finite limit — `broadcast` in particular
    // fans out to every subscriber, so leaving it in the unlimited `global`
    // bucket is a DoS/amplification vector.
    if (path === '/api/db/subscribe' || path === '/api/db/connect-check' || path === '/api/db/broadcast') {
      return 'realtime';
    }
    return 'db';
  }
  if (path.startsWith('/api/storage/'))         return 'storage';
  if (path.startsWith('/api/functions/'))        return 'functions';
  if (path.startsWith('/api/analytics/track'))   return 'events';
  return 'global';
}

/**
 * Rate Limiting middleware — 2-layer architecture.
 *
 * 1. Software counter: config-driven (runtime config)
 * 2. Binding: ceiling safety net (wrangler.toml, 10M/60s)
 *
 * Auth routes are included in global group.
 * Valid Service Key requests bypass app-level rate limits.
 * Identifier: always IP-based (auth middleware runs after rate limit).
 */
export const rateLimitMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const config = c.env ? parseConfig(c.env) : undefined;
  if (isRateLimitExemptStaticRequest(path, {
    method: c.req.method,
    accept: c.req.header('accept'),
    config,
  })) {
    await next();
    return;
  }
  const group = getGroup(path);

  // ── Determine identifier — always IP ──
  // Security: the CLI-managed runtime mode decides whether CF-Connecting-IP is
  // authoritative. Self-hosted runtimes ignore it and X-Forwarded-For unless
  // trustSelfHostedProxy is explicitly enabled for a proxy that overwrites XFF.
  // Unknown/missing runtime modes collapse to one `unknown` bucket rather than
  // accepting a client-selected rate-limit key.
  const ip = getTrustedClientIp(c.env, c.req) ?? 'unknown';

  // ── Service Key check ──
  const serviceKeyHeader = extractServiceKeyHeader(c.req) ?? extractBearerToken(c.req) ?? undefined;
  let isServiceKey = false;
  if (serviceKeyHeader) {
    const constraintCtx: ConstraintContext = {
      env: c.env?.ENVIRONMENT,
      ip: ip !== 'unknown' ? ip : undefined,
    };
    const keymap = c.env ? buildKeymap(config ?? {}, c.env as never) : null;
    isServiceKey = validateConfiguredKey(serviceKeyHeader, keymap, constraintCtx) === 'valid';
  }

  if (isServiceKey) {
    await next();
    return;
  }

  // ── Layer 1: Software counter (config-driven) ──
  const { requests, windowSec } = getLimit(config, group);
  const counterKey = `${group}:${ip}`;

  if (!counter.check(counterKey, requests, windowSec)) {
    c.header('Retry-After', String(counter.getRetryAfter(counterKey)));
    return c.json(
      { code: 429, message: 'Too many requests. Please try again later.', group },
      429,
    );
  }

  // ── Layer 2: Binding ceiling ──
  const limiter = getBinding(c.env, group);
  if (limiter) {
    const { success } = await limiter.limit({ key: ip });
    if (!success) {
      c.header('Retry-After', '60');
      return c.json(
        { code: 429, message: 'Too many requests. Please try again later.', group },
        429,
      );
    }
  }

  // ── Also check global for non-global groups ──
  if (group !== 'global') {
    // Software counter for global
    const globalLimit = getLimit(config, 'global');
    const globalKey = `global:${ip}`;
    if (!counter.check(globalKey, globalLimit.requests, globalLimit.windowSec)) {
      c.header('Retry-After', String(counter.getRetryAfter(globalKey)));
      return c.json(
        { code: 429, message: 'Too many requests. Please try again later.', group: 'global' },
        429,
      );
    }

    // Binding ceiling for global
    const globalLimiter = getBinding(c.env, 'global');
    if (globalLimiter) {
      const { success } = await globalLimiter.limit({ key: ip });
      if (!success) {
        c.header('Retry-After', '60');
        return c.json(
          { code: 429, message: 'Too many requests. Please try again later.', group: 'global' },
          429,
        );
      }
    }
  }

  await next();
};
