/**
 * Regression tests for CORS helpers.
 *
 * Key regression: when user explicitly configures cors.origin,
 * localhost must NOT be auto-allowed as an override.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { setConfig } from '../lib/do-router.js';
import { corsMiddleware, decorateResponseHeaders, isOriginAllowed, wildcardToRegex } from '../middleware/cors.js';

// ─── wildcardToRegex ───

describe('wildcardToRegex', () => {
  it('matches wildcard subdomain pattern', () => {
    const re = wildcardToRegex('*.example.com');
    expect(re.test('https://app.example.com')).toBe(true);
    expect(re.test('http://app.example.com')).toBe(true);
    expect(re.test('https://sub.app.example.com')).toBe(true);
    expect(re.test('https://evil.com')).toBe(false);
  });

  it('escapes dots in pattern', () => {
    const re = wildcardToRegex('app.example.com');
    // Should NOT match appXexampleXcom (dots are literal)
    expect(re.test('https://appXexampleXcom')).toBe(false);
    expect(re.test('https://app.example.com')).toBe(true);
  });
});

// ─── isOriginAllowed ───

describe('isOriginAllowed', () => {
  it('allows everything with wildcard "*"', () => {
    expect(isOriginAllowed('https://anything.com', '*')).toBe(true);
  });

  it('matches exact origin', () => {
    expect(isOriginAllowed('https://app.example.com', 'https://app.example.com')).toBe(true);
    expect(isOriginAllowed('https://other.com', 'https://app.example.com')).toBe(false);
  });

  it('matches against array of origins', () => {
    const origins = ['https://app.example.com', 'https://staging.example.com'];
    expect(isOriginAllowed('https://app.example.com', origins)).toBe(true);
    expect(isOriginAllowed('https://staging.example.com', origins)).toBe(true);
    expect(isOriginAllowed('https://evil.com', origins)).toBe(false);
  });

  it('supports wildcard patterns in array', () => {
    const origins = ['*.example.com'];
    expect(isOriginAllowed('https://app.example.com', origins)).toBe(true);
    expect(isOriginAllowed('https://evil.com', origins)).toBe(false);
  });

  // ── REGRESSION: localhost must NOT be allowed when not in config ──
  it('rejects localhost when not in configured origins', () => {
    const origins = ['https://app.example.com'];
    expect(isOriginAllowed('http://localhost:3000', origins)).toBe(false);
    expect(isOriginAllowed('http://127.0.0.1:3000', origins)).toBe(false);
  });

  it('allows localhost only when explicitly configured', () => {
    const origins = ['https://app.example.com', 'http://localhost:3000'];
    expect(isOriginAllowed('http://localhost:3000', origins)).toBe(true);
  });
});

describe('corsMiddleware', () => {
  it('applies CORS headers to downstream JSON responses', async () => {
    setConfig({
      cors: {
        origin: ['http://localhost:5174'],
        credentials: true,
      },
    });

    const app = new Hono();
    app.use('*', corsMiddleware as never);
    app.get('/json', (c) => c.json({ ok: true }));

    const res = await app.request('http://localhost/json', {
      headers: { Origin: 'http://localhost:5174' },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5174');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('applies CORS headers even when downstream returns a raw Response', async () => {
    setConfig({
      cors: {
        origin: ['http://localhost:5174'],
        credentials: true,
      },
    });

    const app = new Hono();
    app.use('*', corsMiddleware as never);
    app.get('/raw', () => new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    }));

    const res = await app.request('http://localhost/raw', {
      headers: { Origin: 'http://localhost:5174' },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5174');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('includes canonical auth headers in preflight allow-headers', async () => {
    setConfig({
      cors: {
        origin: ['http://localhost:5174'],
        credentials: true,
      },
    });

    const app = new Hono();
    app.use('*', corsMiddleware as never);
    app.options('/preflight', (c) => c.body(null, 204));

    const res = await app.request('http://localhost/preflight', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5174',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'X-EdgeBase-Service-Key',
      },
    });

    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-EdgeBase-Service-Key');
  });

  it('leaves websocket upgrade responses untouched', () => {
    const upgradeResponse = {
      status: 101,
      headers: new Headers(),
    } as Response;

    const decorated = decorateResponseHeaders(upgradeResponse, {
      allowOrigin: 'http://localhost:5174',
      allowMethods: 'GET, POST',
      allowHeaders: 'Content-Type',
      allowCredentials: true,
      maxAge: '86400',
    });

    expect(decorated).toBe(upgradeResponse);
  });
});
