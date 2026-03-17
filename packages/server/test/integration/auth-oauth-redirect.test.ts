import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fetchMock } from 'cloudflare:test';
import { setConfig } from '../../src/lib/do-router.js';
import testConfig from '../../edgebase.test.config.ts';
import { getRedirectFragmentParams } from './redirect-fragment.js';

const BASE = 'http://localhost';

function installGoogleOAuthConfig(): void {
  setConfig({
    ...testConfig,
    auth: {
      ...(testConfig.auth ?? {}),
      allowedOAuthProviders: ['google'],
      oauth: {
        google: {
          clientId: 'google-client-id',
          clientSecret: 'google-client-secret',
        },
      },
    },
  });
}

function installXOAuthConfig(): void {
  setConfig({
    ...testConfig,
    auth: {
      ...(testConfig.auth ?? {}),
      allowedOAuthProviders: ['x'],
      oauth: {
        x: {
          clientId: 'x-client-id',
          clientSecret: 'x-client-secret',
        },
      },
    },
  });
}

async function fetchJson(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: any; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  let data: any;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data, headers: res.headers };
}

function mockGoogleExchange(userId: string, email: string): void {
  fetchMock.get('https://oauth2.googleapis.com')
    .intercept({ path: '/token', method: 'POST' })
    .reply(200, JSON.stringify({
      access_token: `ya29.${userId}`,
      token_type: 'Bearer',
      refresh_token: `google-refresh-${userId}`,
      expires_in: 3600,
      id_token: `id-token-${userId}`,
    }), {
      headers: { 'content-type': 'application/json' },
    });

  fetchMock.get('https://www.googleapis.com')
    .intercept({ path: '/oauth2/v2/userinfo', method: 'GET' })
    .reply(200, JSON.stringify({
      id: userId,
      email,
      verified_email: true,
      name: `OAuth ${userId}`,
      picture: 'https://example.com/avatar.png',
    }), {
      headers: { 'content-type': 'application/json' },
    });
}

beforeAll(() => {
  installGoogleOAuthConfig();
});

afterAll(() => {
  setConfig(testConfig);
});

beforeEach(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  installGoogleOAuthConfig();
});

afterEach(() => {
  fetchMock.deactivate();
});

describe('auth-oauth redirect flow', () => {
  it('includes PKCE params for X OAuth redirects', async () => {
    installXOAuthConfig();

    const start = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/x?redirect_url=${encodeURIComponent('http://localhost:4173/auth/callback')}`,
      { redirect: 'manual' },
    );

    expect(start.status).toBe(302);
    const providerUrl = new URL(start.headers.get('location')!);
    expect(providerUrl.origin).toBe('https://twitter.com');
    expect(providerUrl.pathname).toBe('/i/oauth2/authorize');
    expect(providerUrl.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/oauth/x/callback`);
    expect(providerUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(providerUrl.searchParams.get('code_challenge')).toBeTruthy();
  });

  it('OAuth sign-in stores redirect_url and redirects callback back to the app with tokens', async () => {
    const start = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google?redirect_url=${encodeURIComponent('http://localhost:4173/auth/callback')}`,
      { redirect: 'manual' },
    );

    expect(start.status).toBe(302);
    const providerUrl = new URL(start.headers.get('location')!);
    expect(providerUrl.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/oauth/google/callback`);
    const state = providerUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    mockGoogleExchange('google-user-redirect', 'oauth-redirect@test.com');

    const callback = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google/callback?code=fake-code&state=${state}`,
      { redirect: 'manual' },
    );

    expect(callback.status).toBe(302);
    const appUrl = new URL(callback.headers.get('location')!);
    const redirectParams = getRedirectFragmentParams(appUrl);
    expect(appUrl.origin).toBe('http://localhost:4173');
    expect(appUrl.pathname).toBe('/auth/callback');
    expect(redirectParams.get('access_token')).toBeTruthy();
    expect(redirectParams.get('refresh_token')).toBeTruthy();
  });

  it('retries OAuth signup when a pending oauth index row was left behind', async () => {
    const start = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google?redirect_url=${encodeURIComponent('http://localhost:4173/auth/callback')}`,
      { redirect: 'manual' },
    );

    expect(start.status).toBe(302);
    const providerUrl = new URL(start.headers.get('location')!);
    const state = providerUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    await (globalThis as any).env.AUTH_DB.prepare(`
      INSERT OR REPLACE INTO _oauth_index (provider, providerUserId, userId, shardId, status, createdAt)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `)
      .bind('google', 'google-user-retry', 'stale-user', 0, new Date().toISOString())
      .run();

    mockGoogleExchange('google-user-retry', 'oauth-retry@test.com');

    const callback = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google/callback?code=fake-retry-code&state=${state}`,
      { redirect: 'manual' },
    );

    expect(callback.status).toBe(302);
    const appUrl = new URL(callback.headers.get('location')!);
    const redirectParams = getRedirectFragmentParams(appUrl);
    expect(appUrl.origin).toBe('http://localhost:4173');
    expect(appUrl.pathname).toBe('/auth/callback');
    expect(redirectParams.get('access_token')).toBeTruthy();
    expect(redirectParams.get('refresh_token')).toBeTruthy();

    const oauthIndex = await (globalThis as any).env.AUTH_DB.prepare(
      `SELECT userId, status FROM _oauth_index WHERE provider = ? AND providerUserId = ?`,
    )
      .bind('google', 'google-user-retry')
      .first<{ userId: string; status: string }>();

    expect(oauthIndex?.status).toBe('confirmed');
    expect(oauthIndex?.userId).not.toBe('stale-user');
  });

  it('auto-links against an existing _users email even if _email_index is missing', async () => {
    const signup = await fetchJson('POST', '/api/auth/signup', {
      email: 'oauth-existing@test.com',
      password: 'EdgeBase!1234',
    });

    expect([200, 201]).toContain(signup.status);
    const existingUserId = signup.data.user.id as string;

    await (globalThis as any).env.AUTH_DB.prepare(
      `DELETE FROM _email_index WHERE email = ?`,
    )
      .bind('oauth-existing@test.com')
      .run();

    const start = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google?redirect_url=${encodeURIComponent('http://localhost:4173/auth/callback')}`,
      { redirect: 'manual' },
    );

    expect(start.status).toBe(302);
    const providerUrl = new URL(start.headers.get('location')!);
    const state = providerUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    mockGoogleExchange('google-user-existing', 'oauth-existing@test.com');

    const callback = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google/callback?code=fake-existing-code&state=${state}`,
      { redirect: 'manual' },
    );

    expect(callback.status).toBe(302);
    const oauthAccount = await (globalThis as any).env.AUTH_DB.prepare(
      `SELECT userId FROM _oauth_accounts WHERE provider = ? AND providerUserId = ?`,
    )
      .bind('google', 'google-user-existing')
      .first<{ userId: string }>();

    expect(oauthAccount?.userId).toBe(existingUserId);

    const healedEmailIndex = await (globalThis as any).env.AUTH_DB.prepare(
      `SELECT userId, status FROM _email_index WHERE email = ?`,
    )
      .bind('oauth-existing@test.com')
      .first<{ userId: string; status: string }>();

    expect(healedEmailIndex?.userId).toBe(existingUserId);
    expect(healedEmailIndex?.status).toBe('confirmed');
  });

  it('OAuth callback redirects provider errors back to the app when redirect_url was provided', async () => {
    const start = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google?redirect_url=${encodeURIComponent('http://localhost:4173/auth/callback')}`,
      { redirect: 'manual' },
    );

    const providerUrl = new URL(start.headers.get('location')!);
    const state = providerUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    const callback = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google/callback?error=access_denied&error_description=User%20denied&state=${state}`,
      { redirect: 'manual' },
    );

    expect(callback.status).toBe(302);
    const appUrl = new URL(callback.headers.get('location')!);
    const redirectParams = getRedirectFragmentParams(appUrl);
    expect(appUrl.origin).toBe('http://localhost:4173');
    expect(appUrl.pathname).toBe('/auth/callback');
    expect(redirectParams.get('error')).toBe('access_denied');
    expect(redirectParams.get('error_description')).toBe('User denied');
  });

  it('anonymous link OAuth uses redirectUrl from POST body and redirects success back to the app', async () => {
    const anon = await fetchJson('POST', '/api/auth/signin/anonymous');
    expect([200, 201]).toContain(anon.status);
    const accessToken = anon.data.accessToken as string;

    const linkStart = await fetchJson(
      'POST',
      '/api/auth/oauth/link/google',
      { redirectUrl: 'http://localhost:4173/auth/callback' },
      accessToken,
    );

    expect(linkStart.status).toBe(200);
    const providerUrl = new URL(linkStart.data.redirectUrl);
    expect(providerUrl.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/oauth/link/google/callback`);
    const state = providerUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    mockGoogleExchange('google-user-link', 'oauth-link@test.com');

    const callback = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/link/google/callback?code=fake-link-code&state=${state}`,
      { redirect: 'manual' },
    );

    expect(callback.status).toBe(302);
    const appUrl = new URL(callback.headers.get('location')!);
    const redirectParams = getRedirectFragmentParams(appUrl);
    expect(appUrl.origin).toBe('http://localhost:4173');
    expect(appUrl.pathname).toBe('/auth/callback');
    expect(redirectParams.get('access_token')).toBeTruthy();
    expect(redirectParams.get('refresh_token')).toBeTruthy();
  });
});
