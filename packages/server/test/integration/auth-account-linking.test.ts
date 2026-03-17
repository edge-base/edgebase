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
      allowedRedirectUrls: ['http://localhost:4173'],
      oauth: {
        google: {
          clientId: 'google-client-id',
          clientSecret: 'google-client-secret',
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
  if (body !== undefined) headers['Content-Type'] = 'application/json';
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

function mockGoogleExchange(userId: string, email?: string): void {
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

  const payload: Record<string, unknown> = {
    id: userId,
    name: `OAuth ${userId}`,
    picture: 'https://example.com/avatar.png',
  };
  if (email) {
    payload.email = email;
    payload.verified_email = true;
  }

  fetchMock.get('https://www.googleapis.com')
    .intercept({ path: '/oauth2/v2/userinfo', method: 'GET' })
    .reply(200, JSON.stringify(payload), {
      headers: { 'content-type': 'application/json' },
    });
}

function randomEmail(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}@example.com`;
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

describe('auth-account-linking', () => {
  it('links OAuth to an existing authenticated user, lists identities, and unlinks it', async () => {
    const email = randomEmail('account-link');
    const signup = await fetchJson('POST', '/api/auth/signup', {
      email,
      password: 'AccountLink1234!',
    });
    expect(signup.status).toBe(201);
    const accessToken = signup.data.accessToken as string;

    const linkStart = await fetchJson(
      'POST',
      '/api/auth/oauth/link/google',
      { redirectUrl: 'http://localhost:4173/auth/callback', state: 'account-link-state' },
      accessToken,
    );
    expect(linkStart.status).toBe(200);

    const providerUrl = new URL(linkStart.data.redirectUrl);
    expect(providerUrl.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/oauth/link/google/callback`);
    const state = providerUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    mockGoogleExchange('google-user-existing-account', randomEmail('google-profile'));

    const callback = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/link/google/callback?code=link-code&state=${state}`,
      { redirect: 'manual' },
    );
    expect(callback.status).toBe(302);

    const appUrl = new URL(callback.headers.get('location')!);
    const redirectParams = getRedirectFragmentParams(appUrl);
    expect(appUrl.origin).toBe('http://localhost:4173');
    expect(appUrl.pathname).toBe('/auth/callback');
    expect(redirectParams.get('state')).toBe('account-link-state');
    const linkedAccessToken = redirectParams.get('access_token')!;
    expect(linkedAccessToken).toBeTruthy();

    const identities = await fetchJson('GET', '/api/auth/identities', undefined, linkedAccessToken);
    expect(identities.status).toBe(200);
    expect(identities.data.identities).toHaveLength(1);
    expect(identities.data.identities[0].provider).toBe('google');
    expect(identities.data.methods.hasPassword).toBe(true);

    const unlink = await fetchJson(
      'DELETE',
      `/api/auth/identities/${encodeURIComponent(identities.data.identities[0].id)}`,
      undefined,
      linkedAccessToken,
    );
    expect(unlink.status).toBe(200);
    expect(unlink.data.identities).toHaveLength(0);
    expect(unlink.data.methods.hasPassword).toBe(true);
  });

  it('blocks unlinking the last remaining sign-in method', async () => {
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
    const state = providerUrl.searchParams.get('state');
    expect(state).toBeTruthy();

    mockGoogleExchange('google-user-oauth-only');

    const callback = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/link/google/callback?code=oauth-only-code&state=${state}`,
      { redirect: 'manual' },
    );
    expect(callback.status).toBe(302);
    const appUrl = new URL(callback.headers.get('location')!);
    const redirectParams = getRedirectFragmentParams(appUrl);
    const linkedAccessToken = redirectParams.get('access_token')!;

    const identities = await fetchJson('GET', '/api/auth/identities', undefined, linkedAccessToken);
    expect(identities.status).toBe(200);
    expect(identities.data.identities).toHaveLength(1);
    expect(identities.data.methods.total).toBe(1);

    const unlink = await fetchJson(
      'DELETE',
      `/api/auth/identities/${encodeURIComponent(identities.data.identities[0].id)}`,
      undefined,
      linkedAccessToken,
    );
    expect(unlink.status).toBe(400);
    expect(unlink.data.message).toContain('last sign-in method');
  });
});
