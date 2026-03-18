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
 *   - `global`      — all routes (last-resort safety net)
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
  db: { requests: 100,        windowSec: 60 },
  storage:     { requests: 50,         windowSec: 60 },
  functions:   { requests: 50,         windowSec: 60 },
  auth:        { requests: 30,         windowSec: 60 },
  authSignin:  { requests: 10,         windowSec: 60 },
  authSignup:  { requests: 10,         windowSec: 60 },
  events:      { requests: 100,        windowSec: 60 },
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

/** Get config-based limit for a group, with fallback to defaults */
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
  return RATE_LIMIT_DEFAULTS[group] ?? { requests: 10_000_000, windowSec: 60 };
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

/** Determine the rate limit group for a request path */
export function getGroup(path: string): string {
  if (path.startsWith('/api/db/')) {
    // Database-live endpoints live under /api/db/ but are not database CRUD operations
    if (path === '/api/db/subscribe' || path === '/api/db/connect-check' || path === '/api/db/broadcast') {
      return 'global';
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
  const group = getGroup(path);

  // ── Determine identifier — always IP ──
  // Security: CF-Connecting-IP is set by Cloudflare and cannot be spoofed by clients.
  // X-Forwarded-For is only used as a fallback for self-hosted environments and
  // MUST be set by a trusted reverse proxy (Nginx/Caddy). If EdgeBase is exposed
  // directly without a proxy, clients can forge this header to bypass rate limits.
  const ip = getTrustedClientIp(c.env, c.req) ?? 'unknown';

  // ── Service Key check ──
  const serviceKeyHeader = extractServiceKeyHeader(c.req) ?? extractBearerToken(c.req) ?? undefined;
  let isServiceKey = false;
  if (serviceKeyHeader) {
    const config = c.env ? parseConfig(c.env) : {};
    const constraintCtx: ConstraintContext = {
      env: c.env?.ENVIRONMENT,
      ip: ip !== 'unknown' ? ip : undefined,
    };
    const keymap = c.env ? buildKeymap(config, c.env as never) : null;
    isServiceKey = validateConfiguredKey(serviceKeyHeader, keymap, constraintCtx) === 'valid';
  }

  if (isServiceKey) {
    await next();
    return;
  }

  // ── Parse config ──
  const config = c.env ? parseConfig(c.env) : undefined;

  // ── Layer 1: Software counter (config-driven) ──
  const { requests, windowSec } = getLimit(config, group);
  const counterKey = `${group}:${ip}`;

  if (!counter.check(counterKey, requests, windowSec)) {
    c.header('Retry-After', String(counter.getRetryAfter(counterKey)));
    return c.json(
      { code: 429, message: 'Too many requests. Please try again later.' },
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
        { code: 429, message: 'Too many requests. Please try again later.' },
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
        { code: 429, message: 'Too many requests. Please try again later.' },
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
          { code: 429, message: 'Too many requests. Please try again later.' },
          429,
        );
      }
    }
  }

  await next();
};
