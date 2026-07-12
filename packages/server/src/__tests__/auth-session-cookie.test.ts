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
  ensureOAuthBrowserGeneration,
  isCookieAuthTransport,
  readOAuthBrowserGeneration,
  readRefreshCookie,
  rotateOAuthBrowserGeneration,
  sessionResponse,
  setOAuthStateCookie,
  setOAuthBrowserGeneration,
  setRefreshCookie,
  verifyAndClearOAuthStateCookie,
  verifyOAuthBrowserGeneration,
  verifyOAuthStateCookie,
  clearOAuthStateCookie,
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
  app.get('/oauth-state-post/:state', (c) => {
    setOAuthStateCookie(c as never, c.req.param('state'), { crossSitePost: true });
    return c.json({ ok: true });
  });
  app.post('/oauth-state-post/:state/verify', (c) => c.json({
    valid: verifyAndClearOAuthStateCookie(c as never, c.req.param('state'), { crossSitePost: true }),
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
  app.get('/oauth-generation/:expected', (c) => c.json({
    value: readOAuthBrowserGeneration(c as never),
    valid: verifyOAuthBrowserGeneration(c as never, c.req.param('expected')),
  }));
  app.get('/oauth-generation-ensure', (c) => c.json({
    first: ensureOAuthBrowserGeneration(c as never),
    second: ensureOAuthBrowserGeneration(c as never),
  }));
  app.get('/oauth-generation-set/:value', (c) => {
    setOAuthBrowserGeneration(c as never, c.req.param('value'));
    return c.json({ value: c.req.param('value') });
  });
  app.get('/oauth-generation-rotate', (c) => c.json({
    value: rotateOAuthBrowserGeneration(c as never),
  }));
  app.get('/oauth-state/:state/verify-only', (c) => c.json({
    valid: verifyOAuthStateCookie(c as never, c.req.param('state')),
  }));
  app.get('/oauth-state/:state/clear-only', (c) => {
    clearOAuthStateCookie(c as never, c.req.param('state'));
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
    expect(cookie).toContain('__Host-test-refresh=refresh-token');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('__Secure-test-refresh=; Max-Age=0; Path=/api/auth');
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
    expect(await wildcard.json()).toMatchObject({ slug: 'cookie-auth-origin-untrusted' });

    const missing = await createApp().request('https://api.example.com/issue', {
      method: 'POST',
      headers: { 'X-EdgeBase-Auth-Transport': 'cookie' },
    });
    expect(missing.status).toBe(403);
    expect(await missing.json()).toMatchObject({ slug: 'cookie-auth-origin-required' });
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
    expect(await res.json()).toMatchObject({ slug: 'cookie-auth-origin-unverifiable' });
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

  it('permits release cookie auth only on the CLI-owned local loopback boundary', async () => {
    const headers = {
      Origin: 'http://127.0.0.1:8787',
      'CF-Connecting-IP': '127.0.0.1',
      'X-EdgeBase-Auth-Transport': 'cookie',
    };
    const local = await createApp().request('http://127.0.0.1:8787/issue', {
      method: 'POST',
      headers,
    }, { EDGEBASE_RUNTIME_MODE: 'local-development' });

    expect(local.status).toBe(200);
    expect(local.headers.get('Set-Cookie')).toContain('test-refresh=refresh-token');
    expect(local.headers.get('Set-Cookie')).not.toContain('Secure');

    const forgedPublicHost = await createApp().request('http://api.example.com/issue', {
      method: 'POST',
      headers: { ...headers, Origin: 'http://api.example.com' },
    }, { EDGEBASE_RUNTIME_MODE: 'local-development' });
    expect(forgedPublicHost.status).toBe(400);
    expect(await forgedPublicHost.json()).toMatchObject({ slug: 'insecure-cookie-config' });

    const nonLoopbackPeer = await createApp().request('http://127.0.0.1:8787/issue', {
      method: 'POST',
      headers: { ...headers, 'CF-Connecting-IP': '203.0.113.7' },
    }, { EDGEBASE_RUNTIME_MODE: 'local-development' });
    expect(nonLoopbackPeer.status).toBe(400);
    expect(await nonLoopbackPeer.json()).toMatchObject({ slug: 'insecure-cookie-config' });
  });

  it('reads and expires the negotiated cookie', async () => {
    const headers = {
      Origin: 'https://api.example.com',
      'X-EdgeBase-Auth-Transport': 'cookie',
      Cookie: '__Host-test-refresh=refresh-token',
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

  it('reads only __Host cookies when attacker-controlled legacy names are also present', async () => {
    const common = {
      Origin: 'https://api.example.com',
      'X-EdgeBase-Auth-Transport': 'cookie',
    };
    const preferred = await createApp().request('https://api.example.com/read', {
      method: 'POST',
      headers: {
        ...common,
        Cookie: '__Secure-test-refresh=legacy-attacker; test-refresh=plain-attacker; __Host-test-refresh=host-valid',
      },
    });
    expect(await preferred.json()).toEqual({ refreshToken: 'host-valid' });

    const legacyOnly = await createApp().request('https://api.example.com/read', {
      method: 'POST',
      headers: { ...common, Cookie: '__Secure-test-refresh=legacy-only; test-refresh=plain-only' },
    });
    expect(await legacyOnly.json()).toEqual({ refreshToken: null });

    const state = 'state-precedence';
    const stateName = `test-refresh-oauth-${state.slice(0, 32)}`;
    const statePreferred = await createApp().request(
      `https://api.example.com/oauth-state/${state}/verify`,
      {
        headers: {
          Cookie: `__Secure-${stateName}=attacker; ${stateName}=plain; __Host-${stateName}=${state}`,
        },
      },
    );
    expect(await statePreferred.json()).toEqual({ valid: true });
    const stateLegacyOnly = await createApp().request(
      `https://api.example.com/oauth-state/${state}/verify`,
      { headers: { Cookie: `__Secure-${stateName}=${state}; ${stateName}=${state}` } },
    );
    expect(await stateLegacyOnly.json()).toEqual({ valid: false });

    const generation = 'ab'.repeat(32);
    const generationName = 'test-refresh-oauth-generation';
    const generationPreferred = await createApp().request(
      `https://api.example.com/oauth-generation/${generation}`,
      {
        headers: {
          Cookie: `__Secure-${generationName}=${'cd'.repeat(32)}; ${generationName}=${'ef'.repeat(32)}; __Host-${generationName}=${generation}`,
        },
      },
    );
    expect(await generationPreferred.json()).toEqual({ value: generation, valid: true });
    const generationLegacyOnly = await createApp().request(
      `https://api.example.com/oauth-generation/${generation}`,
      { headers: { Cookie: `__Secure-${generationName}=${generation}; ${generationName}=${generation}` } },
    );
    expect(await generationLegacyOnly.json()).toEqual({ value: null, valid: false });
  });

  it('expires configured predecessor cookie names without ever reading them', async () => {
    setConfig({
      release: true,
      auth: {
        session: {
          cookie: {
            enabled: true,
            name: 'hanji-refresh',
            legacyNames: ['former-product-refresh'],
            sameSite: 'strict',
          },
        },
      },
    });
    const common = {
      Origin: 'https://api.example.com',
      'X-EdgeBase-Auth-Transport': 'cookie',
    };
    const read = await createApp().request('https://api.example.com/read', {
      method: 'POST',
      headers: {
        ...common,
        Cookie: '__Host-former-product-refresh=must-not-be-read',
      },
    });
    expect(await read.json()).toEqual({ refreshToken: null });

    const issued = await createApp().request('https://api.example.com/issue', {
      method: 'POST',
      headers: common,
    });
    const cookie = issued.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('__Host-hanji-refresh=refresh-token');
    expect(cookie).toContain('__Host-former-product-refresh=; Max-Age=0; Path=/');
    expect(cookie).toContain('__Secure-former-product-refresh=; Max-Age=0; Path=/api/auth');
    expect(cookie).toContain('former-product-refresh=; Max-Age=0; Path=/api/auth');

    const cleared = await createApp().request('https://api.example.com/clear', {
      method: 'POST',
      headers: common,
    });
    expect(cleared.headers.get('Set-Cookie')).toContain('__Host-former-product-refresh=; Max-Age=0');
  });

  it('expires a predecessor plain cookie during local HTTP development', async () => {
    setConfig({
      release: true,
      auth: {
        session: {
          cookie: {
            enabled: true,
            name: 'hanji-refresh',
            legacyNames: ['former-product-refresh'],
            sameSite: 'strict',
          },
        },
      },
    });
    const issued = await createApp().request('http://127.0.0.1:8787/issue', {
      method: 'POST',
      headers: {
        Origin: 'http://127.0.0.1:8787',
        'CF-Connecting-IP': '127.0.0.1',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    }, { EDGEBASE_RUNTIME_MODE: 'local-development' });
    const cookie = issued.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('hanji-refresh=refresh-token');
    expect(cookie).toContain('former-product-refresh=; Max-Age=0; Path=/api/auth');
    expect(cookie).not.toContain('__Host-former-product-refresh');
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

  it('mints, preserves, explicitly sets, and rotates browser generations', async () => {
    const ensured = await createApp().request('https://api.example.com/oauth-generation-ensure');
    const ensuredBody = await ensured.json() as { first: string; second: string };
    expect(ensuredBody.first).toMatch(/^[0-9a-f]{64}$/);
    expect(ensuredBody.second).toMatch(/^[0-9a-f]{64}$/);

    const generation = '12'.repeat(32);
    const set = await createApp().request(
      `https://api.example.com/oauth-generation-set/${generation}`,
    );
    expect(set.status).toBe(200);
    expect(set.headers.get('Set-Cookie')).toContain(`__Host-test-refresh-oauth-generation=${generation}`);
    const rotated = await createApp().request('https://api.example.com/oauth-generation-rotate');
    const rotatedBody = await rotated.json() as { value: string };
    expect(rotatedBody.value).toMatch(/^[0-9a-f]{64}$/);
    expect(rotatedBody.value).not.toBe(generation);
    expect(() => setOAuthBrowserGeneration({} as never, 'invalid')).toThrow('Invalid OAuth browser generation');
  });

  it('can verify a state without consuming it and clear the exact bound cookie separately', async () => {
    const state = 'separate-state-value';
    const issued = await createApp().request(`https://api.example.com/oauth-state/${state}`);
    const cookie = (issued.headers.get('Set-Cookie') ?? '').split(';', 1)[0];
    const verified = await createApp().request(
      `https://api.example.com/oauth-state/${state}/verify-only`,
      { headers: { Cookie: cookie } },
    );
    expect(await verified.json()).toEqual({ valid: true });
    expect(verified.headers.get('Set-Cookie')).toBeNull();

    const cleared = await createApp().request(
      `https://api.example.com/oauth-state/${state}/clear-only`,
      { headers: { Cookie: cookie } },
    );
    expect(cleared.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('uses Secure SameSite=None binding for cross-site OAuth form POST callbacks', async () => {
    const state = 'apple-state-value-123';
    const issued = await createApp().request(`https://api.example.com/oauth-state-post/${state}`);
    const setCookie = issued.headers.get('Set-Cookie') ?? '';
    const stateCookie = setCookie.split(';', 1)[0];
    expect(setCookie).toContain('SameSite=None');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('HttpOnly');

    const verified = await createApp().request(
      `https://api.example.com/oauth-state-post/${state}/verify`,
      { method: 'POST', headers: { Cookie: stateCookie } },
    );
    expect(await verified.json()).toEqual({ valid: true });
    expect(verified.headers.get('Set-Cookie')).toContain('SameSite=None');
    expect(verified.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('rejects cross-site OAuth POST binding on insecure origins', async () => {
    const response = await createApp().request('http://api.example.com/oauth-state-post/insecure');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining('require HTTPS'),
    });
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
    expect(untrusted.status).toBe(400);
    expect(await untrusted.json()).toMatchObject({ slug: 'insecure-cookie-config' });
    expect(untrusted.headers.get('Set-Cookie')).toBeNull();

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
    }, { EDGEBASE_RUNTIME_MODE: 'self-hosted' });
    expect(res.headers.get('Set-Cookie')).toContain('__Host-proxy-refresh=');
    expect(res.headers.get('Set-Cookie')).toContain('Secure');

    for (const mode of ['cloudflare', 'local-development']) {
      const spoofed = await createApp().request('http://api.example.com/issue', {
        method: 'POST',
        headers: {
          Origin: 'http://api.example.com',
          'X-Forwarded-Proto': 'https',
          'X-EdgeBase-Auth-Transport': 'cookie',
        },
      }, { EDGEBASE_RUNTIME_MODE: mode });
      expect(spoofed.status).toBe(400);
      expect(await spoofed.json()).toMatchObject({ slug: 'insecure-cookie-config' });
      expect(spoofed.headers.get('Set-Cookie')).toBeNull();
    }
  });
});
