import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { EdgeBaseError } from '@edge-base/shared';
import { setConfig } from '../lib/do-router.js';
import {
  applyAuthNoStore,
  assertAuthTransportAllowed,
  assertCookieAuthEnabled,
  clearRefreshCookie,
  cookieSessionResponse,
  isCookieAuthTransport,
  readRefreshCookie,
  sessionResponse,
  setOAuthStateCookie,
  setRefreshCookie,
  verifyAndClearOAuthStateCookie,
} from '../lib/auth-session-cookie.js';

function createApp() {
  const app = new Hono();
  app.onError((err, c) => err instanceof EdgeBaseError
    ? c.json(err.toJSON(), err.code as 403)
    : c.json({ message: err.message }, 500));
  app.post('/issue', (c) => {
    assertAuthTransportAllowed(c as never);
    if (isCookieAuthTransport(c as never)) assertCookieAuthEnabled(c as never);
    return sessionResponse(c as never, {
      user: { id: 'user-1' },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      sessionId: 'session-1',
    });
  });
  app.post('/force-cookie', (c) => cookieSessionResponse(c as never, {
    accessToken: 'forced-access',
    refreshToken: 'forced-refresh',
  }));
  app.post('/direct-cookie', (c) => {
    applyAuthNoStore(c as never);
    setRefreshCookie(c as never, 'direct-refresh');
    return c.json({ ok: true });
  });
  app.get('/oauth-state/:state', (c) => {
    setOAuthStateCookie(c as never, c.req.param('state'));
    return c.json({ ok: true });
  });
  app.get('/oauth-state/:state/verify', (c) => c.json({
    valid: verifyAndClearOAuthStateCookie(c as never, c.req.param('state')),
  }));
  app.post('/read', (c) => {
    assertAuthTransportAllowed(c as never);
    return c.json({ refreshToken: readRefreshCookie(c as never) });
  });
  app.post('/clear', (c) => {
    assertAuthTransportAllowed(c as never);
    clearRefreshCookie(c as never);
    return c.json({ ok: true });
  });
  return app;
}

beforeEach(() => {
  setConfig({
    release: true,
    auth: {
      session: {
        refreshTokenTTL: '7d',
        cookie: {
          enabled: true,
          name: 'test-refresh',
          sameSite: 'strict',
        },
      },
    },
    cors: {
      origin: ['https://app.example.com', 'https://*.wild.example.com'],
      credentials: true,
    },
  });
});

describe('refresh cookie session transport', () => {
  it('keeps legacy body transport unchanged', async () => {
    const res = await createApp().request('https://api.example.com/issue', { method: 'POST' });
    const body = await res.json() as Record<string, unknown>;

    expect(body.refreshToken).toBe('refresh-token');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('issues only an HttpOnly secure host-only cookie on HTTPS', async () => {
    const res = await createApp().request('https://api.example.com/issue', {
      method: 'POST',
      headers: {
        Origin: 'https://api.example.com',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });
    const body = await res.json() as Record<string, unknown>;
    const cookie = res.headers.get('Set-Cookie') ?? '';

    expect(body).toMatchObject({
      accessToken: 'access-token',
      sessionId: 'session-1',
      sessionTransport: 'cookie',
    });
    expect(body).not.toHaveProperty('refreshToken');
    expect(cookie).toContain('__Secure-test-refresh=refresh-token');
    expect(cookie).toContain('Path=/api/auth');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Domain=');
  });

  it('accepts only same-origin or exact credentialed CORS origins', async () => {
    const exact = await createApp().request('https://api.example.com/issue', {
      method: 'POST',
      headers: {
        Origin: 'https://app.example.com',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });
    expect(exact.status).toBe(400);
    expect(await exact.json()).toMatchObject({ slug: 'incompatible-cookie-config' });

    const wildcard = await createApp().request('https://api.example.com/issue', {
      method: 'POST',
      headers: {
        Origin: 'https://foo.wild.example.com',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });
    expect(wildcard.status).toBe(403);

    const missing = await createApp().request('https://api.example.com/issue', {
      method: 'POST',
      headers: { 'X-EdgeBase-Auth-Transport': 'cookie' },
    });
    expect(missing.status).toBe(403);
  });

  it('allows an explicitly trusted cross-site origin with SameSite=None and rejects an untrusted one', async () => {
    setConfig({
      release: true,
      auth: {
        session: {
          cookie: {
            enabled: true,
            name: 'cross-site-refresh',
            sameSite: 'none',
          },
        },
      },
      cors: {
        origin: ['https://app.other-site.example'],
        credentials: true,
      },
    });

    const exact = await createApp().request('https://api.example.com/issue', {
      method: 'POST',
      headers: {
        Origin: 'https://app.other-site.example',
        'Sec-Fetch-Site': 'cross-site',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });
    expect(exact.status).toBe(200);
    expect(exact.headers.get('Set-Cookie')).toContain('SameSite=None');
    expect(exact.headers.get('Set-Cookie')).toContain('Secure');

    const untrusted = await createApp().request('https://api.example.com/issue', {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        'Sec-Fetch-Site': 'cross-site',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });
    expect(untrusted.status).toBe(403);
  });

  it('rejects opaque null origins even if CORS lists the literal string', async () => {
    setConfig({
      release: true,
      auth: {
        session: {
          cookie: { enabled: true, name: 'test-refresh', sameSite: 'none' },
        },
      },
      cors: { origin: ['null'], credentials: true },
    });
    const res = await createApp().request('https://api.example.com/issue', {
      method: 'POST',
      headers: {
        Origin: 'null',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });

    expect(res.status).toBe(403);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('fails fast when a trusted cross-site request uses a Strict cookie', async () => {
    const res = await createApp().request('https://api.example.com/issue', {
      method: 'POST',
      headers: {
        Origin: 'https://app.example.com',
        'Sec-Fetch-Site': 'cross-site',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ slug: 'incompatible-cookie-config' });
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('rejects SameSite=None cookie auth over insecure HTTP instead of issuing a dropped Secure cookie', async () => {
    setConfig({
      release: true,
      auth: {
        session: {
          cookie: {
            enabled: true,
            name: 'cross-site-refresh',
            sameSite: 'none',
          },
        },
      },
    });

    const insecure = await createApp().request('http://api.example.com/issue', {
      method: 'POST',
      headers: {
        Origin: 'http://api.example.com',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });

    expect(insecure.status).toBe(400);
    expect(await insecure.json()).toMatchObject({
      slug: 'insecure-cookie-config',
    });
    expect(insecure.headers.get('Set-Cookie')).toBeNull();
  });

  it('reads and expires the negotiated cookie', async () => {
    const headers = {
      Origin: 'https://api.example.com',
      'X-EdgeBase-Auth-Transport': 'cookie',
      Cookie: '__Secure-test-refresh=refresh-token',
    };
    const read = await createApp().request('https://api.example.com/read', {
      method: 'POST',
      headers,
    });
    expect(await read.json()).toEqual({ refreshToken: 'refresh-token' });

    const cleared = await createApp().request('https://api.example.com/clear', {
      method: 'POST',
      headers,
    });
    expect(cleared.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('supports direct cookie responses and browser-bound OAuth state cookies', async () => {
    const forced = await createApp().request('https://api.example.com/force-cookie', {
      method: 'POST',
    });
    expect(await forced.json()).toMatchObject({
      accessToken: 'forced-access',
      sessionTransport: 'cookie',
    });

    const direct = await createApp().request('https://api.example.com/direct-cookie', {
      method: 'POST',
    });
    expect(direct.headers.get('Cache-Control')).toBe('no-store');
    expect(direct.headers.get('Set-Cookie')).toContain('direct-refresh');

    const state = 'state-value-123';
    const issued = await createApp().request(`https://api.example.com/oauth-state/${state}`);
    const stateCookie = (issued.headers.get('Set-Cookie') ?? '').split(';', 1)[0];
    expect(stateCookie).toContain('-oauth-');

    const verified = await createApp().request(
      `https://api.example.com/oauth-state/${state}/verify`,
      { headers: { Cookie: stateCookie } },
    );
    expect(await verified.json()).toEqual({ valid: true });
    expect(verified.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('trusts forwarded HTTPS only when the self-hosted proxy contract is enabled', async () => {
    setConfig({
      release: true,
      auth: {
        session: {
          cookie: { enabled: true, name: 'proxy-refresh', sameSite: 'strict' },
        },
      },
    });

    const untrusted = await createApp().request('http://api.example.com/issue', {
      method: 'POST',
      headers: {
        Origin: 'http://api.example.com',
        'X-Forwarded-Proto': 'https',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });
    expect(untrusted.status).toBe(200);
    expect(untrusted.headers.get('Set-Cookie')).toContain('proxy-refresh=');
    expect(untrusted.headers.get('Set-Cookie')).not.toContain('__Secure-');
    expect(untrusted.headers.get('Set-Cookie')).not.toContain('Secure');

    setConfig({
      release: true,
      trustSelfHostedProxy: true,
      auth: {
        session: {
          cookie: { enabled: true, name: 'proxy-refresh', sameSite: 'strict' },
        },
      },
    });

    const res = await createApp().request('http://api.example.com/issue', {
      method: 'POST',
      headers: {
        Origin: 'https://api.example.com',
        'X-Forwarded-Proto': 'https',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });
    expect(res.headers.get('Set-Cookie')).toContain('__Secure-proxy-refresh=');
    expect(res.headers.get('Set-Cookie')).toContain('Secure');
  });
});
