import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { EdgeBaseError } from '@edge-base/shared';
import { setConfig } from '../lib/do-router.js';
import {
  adminSessionResponse,
  applyAdminAuthNoStore,
  assertAdminAuthTransportAllowed,
  clearAdminRefreshCookie,
  isAdminCookieAuthTransport,
  readAdminRefreshCookie,
  setAdminRefreshCookie,
} from '../lib/admin-session-cookie.js';

function createApp() {
  const app = new Hono();
  app.onError((err, c) => err instanceof EdgeBaseError
    ? c.json(err.toJSON(), err.code as 403)
    : c.json({ message: err.message }, 500));
  app.post('/issue', (c) => {
    assertAdminAuthTransportAllowed(c as never);
    return adminSessionResponse(c as never, {
      accessToken: 'admin-access',
      refreshToken: 'admin-refresh',
      admin: { id: 'admin-1', email: 'admin@example.com' },
    });
  });
  app.post('/read', (c) => {
    assertAdminAuthTransportAllowed(c as never);
    return c.json({ refreshToken: readAdminRefreshCookie(c as never) });
  });
  app.post('/clear', (c) => {
    assertAdminAuthTransportAllowed(c as never);
    clearAdminRefreshCookie(c as never);
    return c.json({ ok: true });
  });
  app.post('/direct', (c) => {
    assertAdminAuthTransportAllowed(c as never);
    applyAdminAuthNoStore(c as never);
    setAdminRefreshCookie(c as never, 'direct-admin-refresh');
    return c.json({ cookieTransport: isAdminCookieAuthTransport(c as never) });
  });
  return app;
}

beforeEach(() => {
  setConfig({
    release: true,
    cors: {
      origin: ['https://dashboard.example.com', 'https://*.wild.example.com'],
      credentials: true,
    },
  });
});

describe('admin refresh cookie transport', () => {
  it('preserves legacy body-token clients', async () => {
    const res = await createApp().request('https://api.example.com/issue', { method: 'POST' });
    const body = await res.json() as Record<string, unknown>;

    expect(body.refreshToken).toBe('admin-refresh');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('issues a host-only HttpOnly Strict cookie and hides the refresh token', async () => {
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
      accessToken: 'admin-access',
      sessionTransport: 'cookie',
      admin: { id: 'admin-1' },
    });
    expect(body).not.toHaveProperty('refreshToken');
    expect(cookie).toContain('__Host-edgebase-admin-refresh=admin-refresh');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('__Secure-edgebase-admin-refresh=; Max-Age=0; Path=/admin/api/auth');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Domain=');
  });

  it('requires a custom header plus a valid exact credentialed origin', async () => {
    const missingOrigin = await createApp().request('https://api.example.com/issue', {
      method: 'POST',
      headers: { 'X-EdgeBase-Auth-Transport': 'cookie' },
    });
    expect(missingOrigin.status).toBe(403);

    const opaqueOrigin = await createApp().request('https://api.example.com/issue', {
      method: 'POST',
      headers: {
        Origin: 'null',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });
    expect(opaqueOrigin.status).toBe(403);

    const wildcard = await createApp().request('https://api.example.com/issue', {
      method: 'POST',
      headers: {
        Origin: 'https://foo.wild.example.com',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });
    expect(wildcard.status).toBe(403);

    setConfig({
      release: true,
      cors: { origin: ['https://dashboard.example.com'], credentials: false },
    });
    const credentialsDisabled = await createApp().request('https://api.example.com/issue', {
      method: 'POST',
      headers: {
        Origin: 'https://dashboard.example.com',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });
    expect(credentialsDisabled.status).toBe(403);
  });

  it('does not trust an arbitrary localhost port in development', async () => {
    setConfig({ release: false });
    const res = await createApp().request('http://localhost:8787/issue', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:6666',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });

    expect(res.status).toBe(403);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('uses SameSite=None only for an exact cross-site HTTPS origin', async () => {
    const res = await createApp().request('https://api.example.com/issue', {
      method: 'POST',
      headers: {
        Origin: 'https://dashboard.example.com',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('SameSite=None');
    expect(res.headers.get('Set-Cookie')).toContain('Secure');
  });

  it('treats a same-host mixed-scheme origin as schemeful cross-site', async () => {
    setConfig({
      release: true,
      cors: { origin: ['http://api.example.com'], credentials: true },
    });
    const res = await createApp().request('https://api.example.com/issue', {
      method: 'POST',
      headers: {
        Origin: 'http://api.example.com',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('SameSite=None');
    expect(res.headers.get('Set-Cookie')).toContain('Secure');
  });

  it('rejects cross-site cookie auth over plain HTTP', async () => {
    setConfig({
      release: true,
      cors: { origin: ['http://dashboard.example.com'], credentials: true },
    });
    const res = await createApp().request('http://api.example.com/issue', {
      method: 'POST',
      headers: {
        Origin: 'http://dashboard.example.com',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ slug: 'insecure-cookie-config' });
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('permits release admin cookie auth only on the CLI-owned local loopback boundary', async () => {
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
    expect(local.headers.get('Set-Cookie')).toContain('edgebase-admin-refresh=admin-refresh');
    expect(local.headers.get('Set-Cookie')).not.toContain('Secure');

    const forgedPublicHost = await createApp().request('http://api.example.com/issue', {
      method: 'POST',
      headers: { ...headers, Origin: 'http://api.example.com' },
    }, { EDGEBASE_RUNTIME_MODE: 'local-development' });
    expect(forgedPublicHost.status).toBe(400);
    expect(await forgedPublicHost.json()).toMatchObject({ slug: 'insecure-cookie-config' });

    const nonLoopbackPeer = await createApp().request('http://127.0.0.1:8787/issue', {
      method: 'POST',
      headers: { ...headers, 'CF-Connecting-IP': '198.51.100.9' },
    }, { EDGEBASE_RUNTIME_MODE: 'local-development' });
    expect(nonLoopbackPeer.status).toBe(400);
    expect(await nonLoopbackPeer.json()).toMatchObject({ slug: 'insecure-cookie-config' });
  });

  it('reads and expires only the negotiated admin cookie', async () => {
    const headers = {
      Origin: 'https://api.example.com',
      'X-EdgeBase-Auth-Transport': 'cookie',
      Cookie: '__Host-edgebase-admin-refresh=admin-refresh',
    };
    const read = await createApp().request('https://api.example.com/read', {
      method: 'POST',
      headers,
    });
    expect(await read.json()).toEqual({ refreshToken: 'admin-refresh' });

    const cleared = await createApp().request('https://api.example.com/clear', {
      method: 'POST',
      headers,
    });
    expect(cleared.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('ignores legacy admin cookies even when they precede the valid __Host cookie', async () => {
    const common = {
      Origin: 'https://api.example.com',
      'X-EdgeBase-Auth-Transport': 'cookie',
    };
    const preferred = await createApp().request('https://api.example.com/read', {
      method: 'POST',
      headers: {
        ...common,
        Cookie: '__Secure-edgebase-admin-refresh=legacy-attacker; edgebase-admin-refresh=plain-attacker; __Host-edgebase-admin-refresh=host-valid',
      },
    });
    expect(await preferred.json()).toEqual({ refreshToken: 'host-valid' });

    const legacyOnly = await createApp().request('https://api.example.com/read', {
      method: 'POST',
      headers: {
        ...common,
        Cookie: '__Secure-edgebase-admin-refresh=legacy-only; edgebase-admin-refresh=plain-only',
      },
    });
    expect(await legacyOnly.json()).toEqual({ refreshToken: null });
  });

  it('supports direct negotiated cookie issuance with no-store headers', async () => {
    const res = await createApp().request('https://api.example.com/direct', {
      method: 'POST',
      headers: {
        Origin: 'https://api.example.com',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    });

    expect(await res.json()).toEqual({ cookieTransport: true });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Set-Cookie')).toContain('direct-admin-refresh');
  });

  it('trusts forwarded HTTPS only for the trusted self-hosted runtime', async () => {
    setConfig({ release: true, trustSelfHostedProxy: true });

    const trusted = await createApp().request('http://api.example.com/issue', {
      method: 'POST',
      headers: {
        Origin: 'https://api.example.com',
        'X-Forwarded-Proto': 'https',
        'X-EdgeBase-Auth-Transport': 'cookie',
      },
    }, { EDGEBASE_RUNTIME_MODE: 'self-hosted' });
    expect(trusted.status).toBe(200);
    expect(trusted.headers.get('Set-Cookie')).toContain('__Host-edgebase-admin-refresh=');
    expect(trusted.headers.get('Set-Cookie')).toContain('Secure');

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
