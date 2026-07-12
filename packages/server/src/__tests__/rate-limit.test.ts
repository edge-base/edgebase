/**
 * Regression tests for rate-limit helpers.
 *
 * Key regression: requests=0 must be honoured (ban-mode),
 * not silently swallowed by a truthy check.
 */
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import {
  counter,
  getLimit,
  parseWindow,
  FixedWindowCounter,
  RATE_LIMIT_DEV_DEFAULTS,
  isRateLimitExemptStaticRequest,
  rateLimitMiddleware,
} from '../middleware/rate-limit.js';
import type { EdgeBaseConfig } from '@edge-base/shared';
import { setConfig } from '../lib/do-router.js';

// ─── parseWindow ───

describe('parseWindow', () => {
  it('parses seconds', () => {
    expect(parseWindow('30s')).toBe(30);
  });

  it('parses minutes', () => {
    expect(parseWindow('5m')).toBe(300);
  });

  it('parses hours', () => {
    expect(parseWindow('1h')).toBe(3600);
  });

  it('falls back to 60 for invalid format', () => {
    expect(parseWindow('abc')).toBe(60);
    expect(parseWindow('')).toBe(60);
    expect(parseWindow('10')).toBe(60);
  });
});

// ─── getLimit ───

describe('getLimit', () => {
  it('returns defaults when config is undefined', () => {
    const result = getLimit(undefined, 'db');
    expect(result).toEqual(RATE_LIMIT_DEV_DEFAULTS['db']);
  });

  it('returns defaults when rateLimiting is not set', () => {
    const config = {} as EdgeBaseConfig;
    const result = getLimit(config, 'db');
    expect(result).toEqual(RATE_LIMIT_DEV_DEFAULTS['db']);
  });

  it('returns defaults for unknown group', () => {
    const result = getLimit(undefined, 'nonexistent');
    expect(result).toEqual({ requests: 10_000_000, windowSec: 60 });
  });

  it('uses config values when set', () => {
    const config = {
      rateLimiting: {
        db: { requests: 500, window: '2m' },
      },
    } as EdgeBaseConfig;
    expect(getLimit(config, 'db')).toEqual({ requests: 500, windowSec: 120 });
  });

  // ── REGRESSION: requests=0 must NOT fall through to defaults ──
  it('honours requests=0 (ban-mode) — does not treat 0 as falsy', () => {
    const config = {
      rateLimiting: {
        db: { requests: 0, window: '60s' },
      },
    } as EdgeBaseConfig;
    const result = getLimit(config, 'db');
    expect(result).toEqual({ requests: 0, windowSec: 60 });
  });

  it('falls back when group exists but has no requests/window', () => {
    const config = {
      rateLimiting: {
        db: undefined,
      },
    } as EdgeBaseConfig;
    expect(getLimit(config, 'db')).toEqual(RATE_LIMIT_DEV_DEFAULTS['db']);
  });
});

describe('static asset rate-limit exemption', () => {
  const frontendConfig = {
    release: true,
    frontend: {
      directory: './web/dist',
      spaFallback: true,
    },
  } as EdgeBaseConfig;

  it.each([
    '/',
    '/index.html',
    '/assets/app-abc123def456.js',
    '/mark-128.png',
    '/manifest.webmanifest',
    '/sw.js',
    '/dashboard/settings',
    '/admin',
    '/admin/_app/app-abc123def456.js',
    '/harness/assets/test.js',
    '/favicon.ico',
  ])('exempts frontend/admin GET assets: %s', (path) => {
    expect(isRateLimitExemptStaticRequest(path, {
      method: 'GET',
      accept: 'text/html,application/xhtml+xml',
      config: frontendConfig,
    })).toBe(true);
  });

  it.each([
    '/api/health',
    '/api/auth/refresh',
    '/admin/api/data/tables',
    '/internal/backup',
    '/openapi.json',
    '/.well-known/oauth-authorization-server',
    '/cdn-cgi/trace',
  ])('keeps API/control GET routes limited: %s', (path) => {
    expect(isRateLimitExemptStaticRequest(path, {
      method: 'GET',
      accept: 'text/html',
      config: frontendConfig,
    })).toBe(false);
  });

  it('does not exempt writes to static-looking paths', () => {
    expect(isRateLimitExemptStaticRequest('/assets/upload.js', {
      method: 'POST',
      config: frontendConfig,
    })).toBe(false);
  });

  it('does not exempt extensionless non-navigation probes', () => {
    expect(isRateLimitExemptStaticRequest('/unknown-probe', {
      method: 'GET',
      accept: 'application/json',
      config: frontendConfig,
    })).toBe(false);
  });

  it('honours custom frontend mounts without exempting unrelated paths', () => {
    const config = {
      frontend: {
        directory: './web/dist',
        mountPath: '/app',
        spaFallback: true,
      },
    } as EdgeBaseConfig;

    expect(isRateLimitExemptStaticRequest('/app/assets/main.js', { config })).toBe(true);
    expect(isRateLimitExemptStaticRequest('/app/settings', {
      accept: 'text/html',
      config,
    })).toBe(true);
    expect(isRateLimitExemptStaticRequest('/', { config })).toBe(false);
    expect(isRateLimitExemptStaticRequest('/assets/main.js', { config })).toBe(false);
  });

  it('does not charge static loads to the global API budget', async () => {
    const config = {
      release: true,
      frontend: {
        directory: './web/dist',
        spaFallback: true,
      },
      rateLimiting: {
        global: { requests: 1, window: '60s' },
      },
    } as EdgeBaseConfig;
    setConfig(config);
    const app = new Hono();
    app.use('*', rateLimitMiddleware as never);
    app.get('*', (c) => c.text('ok'));
    const ip = `static-budget-${Date.now()}`;
    const globalBindingLimit = vi.fn().mockResolvedValue({ success: true });
    const env = {
      ENVIRONMENT: 'test',
      EDGEBASE_RUNTIME_MODE: 'cloudflare',
      GLOBAL_RATE_LIMITER: { limit: globalBindingLimit },
    };

    for (const path of ['/', '/assets/app-abc123def456.js', '/manifest.webmanifest', '/admin']) {
      const response = await app.fetch(new Request(`http://localhost${path}`, {
        headers: { 'cf-connecting-ip': ip, accept: 'text/html' },
      }), env as never);
      expect(response.status).toBe(200);
    }
    expect(globalBindingLimit).not.toHaveBeenCalled();

    const firstApi = await app.fetch(new Request('http://localhost/api/health', {
      headers: { 'cf-connecting-ip': ip },
    }), env as never);
    const secondApi = await app.fetch(new Request('http://localhost/api/health', {
      headers: { 'cf-connecting-ip': ip },
    }), env as never);

    expect(firstApi.status).toBe(200);
    expect(secondApi.status).toBe(429);
    expect(globalBindingLimit).toHaveBeenCalledTimes(1);
    expect((await secondApi.json() as { group: string }).group).toBe('global');
  });
});

// ─── FixedWindowCounter ───

describe('FixedWindowCounter', () => {
  it('allows requests within limit', () => {
    const counter = new FixedWindowCounter();
    expect(counter.check('test:key', 3, 60)).toBe(true);
    expect(counter.check('test:key', 3, 60)).toBe(true);
    expect(counter.check('test:key', 3, 60)).toBe(true);
  });

  it('blocks requests over limit', () => {
    const counter = new FixedWindowCounter();
    counter.check('over:key', 2, 60);
    counter.check('over:key', 2, 60);
    expect(counter.check('over:key', 2, 60)).toBe(false);
  });

  // ── REGRESSION: limit=0 must block all requests (ban-mode) ──
  it('blocks all requests when limit=0 (ban-mode)', () => {
    const counter = new FixedWindowCounter();
    expect(counter.check('ban:key', 0, 60)).toBe(false);
  });
});

// ─── rateLimitMiddleware ───

describe('rateLimitMiddleware — valid Service Key bypass', () => {
  function createApp(config: EdgeBaseConfig) {
    setConfig(config);
    const app = new Hono();
    app.use('*', rateLimitMiddleware as never);
    app.get('/api/health', (c) => c.json({ ok: true }));
    app.get('/api/db/shared/tables/posts', (c) => c.json({ ok: true }));
    return app;
  }

  const env = {
    SERVICE_KEY: 'sk-root-test',
    ENVIRONMENT: 'test',
    EDGEBASE_RUNTIME_MODE: 'cloudflare',
  };

  const config = {
    rateLimiting: {
      global: { requests: 1, window: '60s' },
      db: { requests: 1, window: '60s' },
    },
    serviceKeys: {
      keys: [
        {
          kid: 'root-test',
          tier: 'root',
          scopes: ['*'],
          secretSource: 'dashboard',
          secretRef: 'SERVICE_KEY',
        },
        {
          kid: 'db-scoped',
          tier: 'scoped',
          scopes: ['db:table:posts:read'],
          secretSource: 'inline',
          inlineSecret: 'jb_db-scoped_payload',
        },
        {
          kid: 'constrained-db',
          tier: 'scoped',
          scopes: ['db:table:posts:read'],
          secretSource: 'inline',
          inlineSecret: 'jb_constrained-db_payload',
          constraints: {
            env: ['prod'],
            ipCidr: ['10.0.0.0/8'],
          },
        },
      ],
    },
  } as EdgeBaseConfig;

  it('bypasses the global limiter for valid service key requests', async () => {
    const app = createApp(config);
    const ip = `rl-sk-global-${Date.now()}`;
    counter.check(`global:${ip}`, 1, 60);

    const response = await app.fetch(
      new Request('http://localhost/api/health', {
        headers: {
          'cf-connecting-ip': ip,
          'X-EdgeBase-Service-Key': 'sk-root-test',
        },
      }),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
  });

  it('bypasses group-specific limiters for valid service key requests', async () => {
    const app = createApp(config);
    const ip = `rl-sk-db-${Date.now()}`;
    counter.check(`db:${ip}`, 1, 60);
    counter.check(`global:${ip}`, 1, 60);

    const response = await app.fetch(
      new Request('http://localhost/api/db/shared/tables/posts', {
        headers: {
          'cf-connecting-ip': ip,
          'X-EdgeBase-Service-Key': 'sk-root-test',
        },
      }),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
  });

  it('bypasses for scoped service key requests too', async () => {
    const app = createApp(config);
    const ip = `rl-sk-scoped-${Date.now()}`;
    counter.check(`db:${ip}`, 1, 60);
    counter.check(`global:${ip}`, 1, 60);

    const response = await app.fetch(
      new Request('http://localhost/api/db/shared/tables/posts', {
        headers: {
          'cf-connecting-ip': ip,
          'X-EdgeBase-Service-Key': 'jb_db-scoped_payload',
        },
      }),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
  });

  it('still requires constraints to pass before bypassing', async () => {
    const app = createApp(config);
    const allowedIp = '10.1.2.3';
    counter.check(`db:${allowedIp}`, 1, 60);
    counter.check(`global:${allowedIp}`, 1, 60);
    const prodEnv = { ...env, ENVIRONMENT: 'prod' };
    const devEnv = { ...env, ENVIRONMENT: 'dev' };

    const allowed = await app.fetch(
      new Request('http://localhost/api/db/shared/tables/posts', {
        headers: {
          'cf-connecting-ip': allowedIp,
          'X-EdgeBase-Service-Key': 'jb_constrained-db_payload',
        },
      }),
      prodEnv as never,
      {} as ExecutionContext,
    );

    const denied = await app.fetch(
      new Request('http://localhost/api/db/shared/tables/posts', {
        headers: {
          'cf-connecting-ip': allowedIp,
          'X-EdgeBase-Service-Key': 'jb_constrained-db_payload',
        },
      }),
      devEnv as never,
      {} as ExecutionContext,
    );

    expect(allowed.status).toBe(200);
    expect(denied.status).toBe(429);
  });

  it('rejects a self-hosted CF header forged to satisfy a service-key IP constraint', async () => {
    counter.reset();
    const app = createApp(config);
    const selfHostedEnv = {
      ...env,
      ENVIRONMENT: 'prod',
      EDGEBASE_RUNTIME_MODE: 'self-hosted',
    };

    const first = await app.fetch(
      new Request('http://localhost/api/db/shared/tables/posts', {
        headers: { 'cf-connecting-ip': '10.1.2.3' },
      }),
      selfHostedEnv as never,
      {} as ExecutionContext,
    );
    const forgedBypass = await app.fetch(
      new Request('http://localhost/api/db/shared/tables/posts', {
        headers: {
          'cf-connecting-ip': '10.1.2.3',
          'X-EdgeBase-Service-Key': 'jb_constrained-db_payload',
        },
      }),
      selfHostedEnv as never,
      {} as ExecutionContext,
    );

    expect(first.status).toBe(200);
    expect(forgedBypass.status).toBe(429);
  });
});

describe('rateLimitMiddleware — runtime client-IP boundary', () => {
  function createApp() {
    setConfig({
      release: true,
      rateLimiting: {
        global: { requests: 1, window: '60s' },
      },
    });
    const app = new Hono();
    app.use('*', rateLimitMiddleware as never);
    app.get('/api/health', (c) => c.json({ ok: true }));
    return app;
  }

  it('collapses rotating forged CF headers into the fail-closed self-hosted bucket', async () => {
    counter.reset();
    const app = createApp();
    const env = { EDGEBASE_RUNTIME_MODE: 'self-hosted' };

    const first = await app.fetch(new Request('http://localhost/api/health', {
      headers: { 'cf-connecting-ip': '198.51.100.10' },
    }), env as never);
    const rotated = await app.fetch(new Request('http://localhost/api/health', {
      headers: { 'cf-connecting-ip': '198.51.100.11' },
    }), env as never);

    expect(first.status).toBe(200);
    expect(rotated.status).toBe(429);
  });

  it('preserves distinct authoritative CF client keys in Cloudflare mode', async () => {
    counter.reset();
    const app = createApp();
    const env = { EDGEBASE_RUNTIME_MODE: 'cloudflare' };

    const first = await app.fetch(new Request('http://localhost/api/health', {
      headers: { 'cf-connecting-ip': '198.51.100.20' },
    }), env as never);
    const second = await app.fetch(new Request('http://localhost/api/health', {
      headers: { 'cf-connecting-ip': '198.51.100.21' },
    }), env as never);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });
});
