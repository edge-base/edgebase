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
    expect(cookie).toContain('__Secure-edgebase-admin-refresh=admin-refresh');
    expect(cookie).toContain('Path=/admin/api/auth');
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

  it('reads and expires only the negotiated admin cookie', async () => {
    const headers = {
      Origin: 'https://api.example.com',
      'X-EdgeBase-Auth-Transport': 'cookie',
      Cookie: '__Secure-edgebase-admin-refresh=admin-refresh',
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
});
