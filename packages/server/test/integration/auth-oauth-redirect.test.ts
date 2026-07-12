import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMock } from 'cloudflare:test';
import { setConfig } from '../../src/lib/do-router.js';
import testConfig, {
  getOAuthLifecycleEventCounts,
  resetOAuthLifecycleEventCounts,
} from '../../edgebase.test.config.ts';
import { getRedirectFragmentParams } from './redirect-fragment.js';

const BASE = 'https://localhost';
const APP_CALLBACK = 'https://app.example.com/auth/callback';
const RECOVERY_NONCE = 'ab'.repeat(32);

function cookieHeader(response: Response): string {
  const values = typeof (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (response.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
    : [response.headers.get('set-cookie') ?? ''];
  return values
    .flatMap((value) => value.match(/(?:__Host-)?edgebase-[^=;,\s]+=[^;,\s]*/g) ?? [])
    .join('; ');
}

function installGoogleOAuthConfig(): void {
  setConfig({
    ...testConfig,
    baseUrl: BASE,
    auth: {
      ...(testConfig.auth ?? {}),
      allowedRedirectUrls: [APP_CALLBACK],
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
    baseUrl: BASE,
    auth: {
      ...(testConfig.auth ?? {}),
      allowedRedirectUrls: [APP_CALLBACK],
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

function installInsecureOIDCConfig(): void {
  setConfig({
    ...testConfig,
    baseUrl: BASE,
    auth: {
      ...(testConfig.auth ?? {}),
      allowedRedirectUrls: [APP_CALLBACK],
      allowedOAuthProviders: ['oidc:insecure'],
      oauth: {
        oidc: {
          insecure: {
            clientId: 'oidc-client',
            clientSecret: 'oidc-secret',
            issuer: 'http://issuer.example.com',
          },
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

async function createGoogleCompletionTicket(
  providerUserId: string,
  email: string,
  recoveryNonce = RECOVERY_NONCE,
): Promise<string> {
  const start = await (globalThis as any).SELF.fetch(
    `${BASE}/api/auth/oauth/google?redirect_url=${encodeURIComponent(APP_CALLBACK)}&oauth_recovery_nonce=${recoveryNonce}`,
    { redirect: 'manual' },
  );
  expect(start.status).toBe(302);
  const state = new URL(start.headers.get('location')!).searchParams.get('state');
  expect(state).toMatch(/^[0-9a-f]{64}$/);
  mockGoogleExchange(providerUserId, email);
  const callback = await (globalThis as any).SELF.fetch(
    `${BASE}/api/auth/oauth/google/callback?code=code-${providerUserId}&state=${state}`,
    { redirect: 'manual', headers: { Cookie: cookieHeader(start) } },
  );
  expect(callback.status).toBe(302);
  const ticket = getRedirectFragmentParams(new URL(callback.headers.get('location')!))
    .get('oauth_exchange_ticket');
  expect(ticket).toMatch(/^[0-9a-f]{64}$/);
  return ticket!;
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
      `${BASE}/api/auth/oauth/x?redirect_url=${encodeURIComponent(APP_CALLBACK)}`,
      { redirect: 'manual' },
    );

    expect(start.status).toBe(302);
    expect(start.headers.get('referrer-policy')).toBe('no-referrer');
    const providerUrl = new URL(start.headers.get('location')!);
    expect(providerUrl.origin).toBe('https://twitter.com');
    expect(providerUrl.pathname).toBe('/i/oauth2/authorize');
    expect(providerUrl.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/oauth/x/callback`);
    expect(providerUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(providerUrl.searchParams.get('code_challenge')).toBeTruthy();
  });

  it('rejects a release HTTP OIDC issuer at callback time before token fetch', async () => {
    installInsecureOIDCConfig();
    const state = 'cd'.repeat(32);
    const generation = 'ef'.repeat(32);
    await (globalThis as any).env.KV.put(
      `oauth:state:oidc:insecure:${state}`,
      JSON.stringify({
        provider: 'oidc:insecure',
        redirectUri: `${BASE}/api/auth/oauth/oidc:insecure/callback`,
        codeVerifier: null,
        authTransport: 'body',
        browserGeneration: generation,
      }),
      { expirationTtl: 300 },
    );
    const response = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/oidc:insecure/callback?code=must-not-fetch&state=${state}`,
      {
        redirect: 'manual',
        headers: {
          Cookie: [
            `__Host-edgebase-test-refresh-oauth-${state.slice(0, 32)}=${state}`,
            `__Host-edgebase-test-refresh-oauth-generation=${generation}`,
          ].join('; '),
        },
      },
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      message: 'OAuth flow failed unexpectedly. Check the worker logs for the original exception.',
    });
    expect(await (globalThis as any).env.KV.get(`oauth:state:oidc:insecure:${state}`))
      .not.toBeNull();
  });

  it('OAuth sign-in completion is concurrent-safe and replayable after response loss', async () => {
    const start = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google?redirect_url=${encodeURIComponent(APP_CALLBACK)}&oauth_recovery_nonce=${RECOVERY_NONCE}`,
      { redirect: 'manual' },
    );

    expect(start.status).toBe(302);
    const providerUrl = new URL(start.headers.get('location')!);
    expect(providerUrl.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/oauth/google/callback`);
    const state = providerUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    const cookies = cookieHeader(start);
    expect(await (globalThis as any).env.KV.get(`oauth:state:google:${state}`)).toBeNull();
    expect(cookies).toContain('-oauth-');

    mockGoogleExchange('google-user-redirect', 'oauth-redirect@test.com');

    const callback = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google/callback?code=fake-code&state=${state}`,
      { redirect: 'manual', headers: { Cookie: cookies } },
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.get('Cache-Control')).toBe('no-store');
    const appUrl = new URL(callback.headers.get('location')!);
    const redirectParams = getRedirectFragmentParams(appUrl);
    expect(appUrl.origin).toBe('https://app.example.com');
    expect(appUrl.pathname).toBe('/auth/callback');
    expect(redirectParams.get('access_token')).toBeNull();
    expect(redirectParams.get('refresh_token')).toBeNull();
    const ticket = redirectParams.get('oauth_exchange_ticket');
    expect(ticket).toMatch(/^[0-9a-f]{64}$/);
    expect(redirectParams.get('oauth_recovery_nonce')).toBe(RECOVERY_NONCE);

    const [exchange, concurrent] = await Promise.all([
      fetchJson('POST', '/api/auth/oauth/exchange', {
        ticket,
        oauthRecoveryNonce: RECOVERY_NONCE,
      }),
      fetchJson('POST', '/api/auth/oauth/exchange', {
        ticket,
        oauthRecoveryNonce: RECOVERY_NONCE,
      }),
    ]);
    expect([200, 201]).toContain(exchange.status);
    expect(concurrent.status).toBe(exchange.status);
    expect(exchange.data.accessToken).toBeTruthy();
    expect(exchange.data.refreshToken).toBeTruthy();
    expect(concurrent.data).toEqual(exchange.data);
    const replay = await fetchJson('POST', '/api/auth/oauth/exchange', {
      ticket,
      oauthRecoveryNonce: RECOVERY_NONCE,
    });
    expect(replay.status).toBe(exchange.status);
    expect(replay.data).toEqual(exchange.data);
  });

  it('retries the same OAuth signup ticket after beforeSignUp rejects without leaking reservations', async () => {
    const suffix = crypto.randomUUID();
    const email = `gate-reject-once-oauth-${suffix}@example.com`;
    const providerUserId = `oauth-hook-signup-${suffix}`;
    const ticket = await createGoogleCompletionTicket(providerUserId, email);

    const rejected = await fetchJson('POST', '/api/auth/oauth/exchange', {
      ticket,
      oauthRecoveryNonce: RECOVERY_NONCE,
    });
    expect(rejected.status).toBe(403);
    expect(rejected.data).toMatchObject({ slug: 'hook-rejected' });
    const pendingOAuth = await (globalThis as any).env.AUTH_DB.prepare(
      `SELECT status FROM _oauth_index WHERE provider = ? AND providerUserId = ?`,
    ).bind('google', providerUserId).first();
    const pendingEmail = await (globalThis as any).env.AUTH_DB.prepare(
      `SELECT status FROM _email_index WHERE email = ?`,
    ).bind(email).first();
    expect(pendingOAuth).toBeNull();
    expect(pendingEmail).toBeNull();

    const retry = await fetchJson('POST', '/api/auth/oauth/exchange', {
      ticket,
      oauthRecoveryNonce: RECOVERY_NONCE,
    });
    expect(retry.status).toBe(201);
    expect(retry.data.user.email).toBe(email);
    const publicUser = await (globalThis as any).env.AUTH_DB.prepare(
      `SELECT id FROM _users_public WHERE id = ?`,
    ).bind(retry.data.user.id).first<{ id: string }>();
    expect(publicUser?.id).toBe(retry.data.user.id);
  });

  it('retries OAuth auto-link after beforeSignIn rejects and keeps the existing account authoritative', async () => {
    const suffix = crypto.randomUUID();
    const email = `oauth-signin-hook-once-${suffix}@example.com`;
    const signup = await fetchJson('POST', '/api/auth/signup', {
      email,
      password: 'EdgeBase!1234',
    });
    expect(signup.status).toBe(201);
    const existingUserId = signup.data.user.id;
    const providerUserId = `oauth-hook-signin-${suffix}`;
    const ticket = await createGoogleCompletionTicket(providerUserId, email);

    const rejected = await fetchJson('POST', '/api/auth/oauth/exchange', {
      ticket,
      oauthRecoveryNonce: RECOVERY_NONCE,
    });
    expect(rejected.status).toBe(403);
    expect(rejected.data).toMatchObject({ slug: 'hook-rejected' });
    const pendingOAuth = await (globalThis as any).env.AUTH_DB.prepare(
      `SELECT status FROM _oauth_index WHERE provider = ? AND providerUserId = ?`,
    ).bind('google', providerUserId).first();
    expect(pendingOAuth).toBeNull();

    const retry = await fetchJson('POST', '/api/auth/oauth/exchange', {
      ticket,
      oauthRecoveryNonce: RECOVERY_NONCE,
    });
    expect(retry.status).toBe(200);
    expect(retry.data.user.id).toBe(existingUserId);
    const oauthAccount = await (globalThis as any).env.AUTH_DB.prepare(
      `SELECT userId FROM _oauth_accounts WHERE provider = ? AND providerUserId = ?`,
    ).bind('google', providerUserId).first<{ userId: string }>();
    expect(oauthAccount?.userId).toBe(existingUserId);
  });

  it('classifies concurrent first OAuth completions from the committed identity transition', async () => {
    const suffix = crypto.randomUUID();
    const email = `oauth-lifecycle-race-${suffix}@example.com`;
    resetOAuthLifecycleEventCounts(email);
    const tickets = await Promise.all([
      createGoogleCompletionTicket(`oauth-lifecycle-race-a-${suffix}`, email),
      createGoogleCompletionTicket(`oauth-lifecycle-race-b-${suffix}`, email),
    ]);

    const firstAttempts = await Promise.all(tickets.map((ticket) => fetchJson(
      'POST',
      '/api/auth/oauth/exchange',
      { ticket, oauthRecoveryNonce: RECOVERY_NONCE },
    )));
    const winner = firstAttempts.find((response) => response.status === 201);
    const loserIndex = firstAttempts.findIndex((response) => response.status === 409);
    expect(winner?.data.user.id).toBeTruthy();
    expect(loserIndex).toBeGreaterThanOrEqual(0);

    const retry = await fetchJson('POST', '/api/auth/oauth/exchange', {
      ticket: tickets[loserIndex],
      oauthRecoveryNonce: RECOVERY_NONCE,
    });
    expect(retry.status).toBe(200);
    expect(retry.data.user.id).toBe(winner!.data.user.id);

    await vi.waitFor(() => {
      expect(getOAuthLifecycleEventCounts(email)).toEqual({
        beforeSignUp: 1,
        afterSignUp: 1,
        beforeSignIn: 1,
        afterSignIn: 1,
      });
    });
  });

  it('rejects a malformed browser recovery nonce before starting provider OAuth', async () => {
    const start = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google?redirect_url=${encodeURIComponent(APP_CALLBACK)}&oauth_recovery_nonce=not-a-valid-nonce`,
      { redirect: 'manual' },
    );

    expect(start.status).toBe(400);
    expect(await start.json()).toMatchObject({
      code: 400,
      message: expect.stringContaining('oauth_recovery_nonce'),
    });
    expect(start.headers.get('location')).toBeNull();
  });

  it('cookie OAuth binds state to the browser and redirects without URL tokens', async () => {
    const start = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google?redirect_url=${encodeURIComponent(APP_CALLBACK)}&auth_transport=cookie&oauth_recovery_nonce=${RECOVERY_NONCE}`,
      { redirect: 'manual' },
    );

    expect(start.status).toBe(302);
    const providerUrl = new URL(start.headers.get('location')!);
    const state = providerUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    const stateCookies = cookieHeader(start);
    expect(stateCookies).toContain('-oauth-');
    expect(start.headers.get('set-cookie')).toContain('HttpOnly');
    expect(start.headers.get('set-cookie')).toContain('Secure');

    mockGoogleExchange('google-user-cookie-redirect', 'oauth-cookie-redirect@test.com');
    const callback = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google/callback?code=fake-cookie-code&state=${state}`,
      {
        redirect: 'manual',
        headers: { Cookie: stateCookies },
      },
    );

    expect(callback.status).toBe(302);
    const appUrl = new URL(callback.headers.get('location')!);
    const redirectParams = getRedirectFragmentParams(appUrl);
    expect(redirectParams.get('auth_transport')).toBe('cookie');
    expect(redirectParams.get('oauth_recovery_nonce')).toBe(RECOVERY_NONCE);
    expect(redirectParams.get('access_token')).toBeNull();
    expect(redirectParams.get('refresh_token')).toBeNull();
    const ticket = redirectParams.get('oauth_exchange_ticket');
    expect(ticket).toMatch(/^[0-9a-f]{64}$/);
    const exchangeHeaders = {
      'Content-Type': 'application/json',
      'X-EdgeBase-Auth-Transport': 'cookie',
      Origin: BASE,
    };
    const withoutGeneration = stateCookies.split('; ')
      .filter((pair) => !pair.includes('-oauth-generation='))
      .join('; ');
    const missingGeneration = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/oauth/exchange`, {
      method: 'POST',
      headers: { ...exchangeHeaders, Cookie: withoutGeneration },
      body: JSON.stringify({ ticket, oauthRecoveryNonce: RECOVERY_NONCE }),
    });
    expect(missingGeneration.status).toBe(409);
    const wrongGenerationCookies = stateCookies.replace(
      /(-oauth-generation=)[0-9a-f]{64}/,
      `$1${'ff'.repeat(32)}`,
    );
    const wrongGeneration = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/oauth/exchange`, {
      method: 'POST',
      headers: { ...exchangeHeaders, Cookie: wrongGenerationCookies },
      body: JSON.stringify({ ticket, oauthRecoveryNonce: RECOVERY_NONCE }),
    });
    expect(wrongGeneration.status).toBe(409);
    const exchange = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/oauth/exchange`, {
      method: 'POST',
      headers: {
        ...exchangeHeaders,
        Cookie: stateCookies,
      },
      body: JSON.stringify({ ticket, oauthRecoveryNonce: RECOVERY_NONCE }),
    });
    const exchangeBody = await exchange.clone().json().catch(() => null);
    expect([200, 201], JSON.stringify(exchangeBody)).toContain(exchange.status);
    const setCookie = exchange.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('__Host-edgebase-test-refresh=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/');
    const retry = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/oauth/exchange`, {
      method: 'POST',
      headers: {
        ...exchangeHeaders,
        Cookie: cookieHeader(exchange),
      },
      body: JSON.stringify({ ticket, oauthRecoveryNonce: RECOVERY_NONCE }),
    });
    expect(retry.status).toBe(exchange.status);
    expect(await retry.json()).toEqual(exchangeBody);
  });

  it('rejects a cookie OAuth callback that lacks its browser-bound state cookie', async () => {
    const start = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google?redirect_url=${encodeURIComponent(APP_CALLBACK)}&auth_transport=cookie`,
      { redirect: 'manual' },
    );
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    expect(state).toBeTruthy();

    const callback = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google/callback?code=must-not-exchange&state=${state}`,
      { redirect: 'manual' },
    );

    expect(callback.status).toBe(400);
    expect(await callback.json()).toMatchObject({
      slug: 'invalid-token',
    });
  });

  it('retries OAuth signup when a pending oauth index row was left behind', async () => {
    const start = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google?redirect_url=${encodeURIComponent(APP_CALLBACK)}&oauth_recovery_nonce=${RECOVERY_NONCE}`,
      { redirect: 'manual' },
    );

    expect(start.status).toBe(302);
    const providerUrl = new URL(start.headers.get('location')!);
    const state = providerUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    const cookies = cookieHeader(start);

    await (globalThis as any).env.AUTH_DB.prepare(`
      INSERT OR REPLACE INTO _oauth_index (provider, providerUserId, userId, shardId, status, createdAt)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `)
      .bind('google', 'google-user-retry', 'stale-user', 0, new Date(Date.now() - 6 * 60_000).toISOString())
      .run();

    mockGoogleExchange('google-user-retry', 'oauth-retry@test.com');

    const callback = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google/callback?code=fake-retry-code&state=${state}`,
      { redirect: 'manual', headers: { Cookie: cookies } },
    );

    expect(callback.status).toBe(302);
    const appUrl = new URL(callback.headers.get('location')!);
    const redirectParams = getRedirectFragmentParams(appUrl);
    expect(appUrl.origin).toBe('https://app.example.com');
    expect(appUrl.pathname).toBe('/auth/callback');
    const ticket = redirectParams.get('oauth_exchange_ticket');
    expect(ticket).toMatch(/^[0-9a-f]{64}$/);
    const exchange = await fetchJson('POST', '/api/auth/oauth/exchange', {
      ticket,
      oauthRecoveryNonce: RECOVERY_NONCE,
    });
    expect([200, 201]).toContain(exchange.status);

    const oauthIndex = await (globalThis as any).env.AUTH_DB.prepare(
      `SELECT userId, status FROM _oauth_index WHERE provider = ? AND providerUserId = ?`,
    )
      .bind('google', 'google-user-retry')
      .first<{ userId: string; status: string }>();

    expect(oauthIndex?.status).toBe('confirmed');
    expect(oauthIndex?.userId).not.toBe('stale-user');
  });

  it('does not steal or delete a fresh OAuth reservation owned by another flow', async () => {
    const providerUserId = `google-fresh-${crypto.randomUUID()}`;
    const ownerUserId = `reservation-owner-${crypto.randomUUID()}`;
    const reservationId = crypto.randomUUID();
    const start = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google?redirect_url=${encodeURIComponent(APP_CALLBACK)}&oauth_recovery_nonce=${RECOVERY_NONCE}`,
      { redirect: 'manual' },
    );
    const providerUrl = new URL(start.headers.get('location')!);
    const state = providerUrl.searchParams.get('state');
    const cookies = cookieHeader(start);
    expect(state).toMatch(/^[0-9a-f]{64}$/);

    await (globalThis as any).env.AUTH_DB.prepare(`
      INSERT OR REPLACE INTO _oauth_index
        (provider, providerUserId, userId, shardId, status, reservationId, createdAt)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `)
      .bind('google', providerUserId, ownerUserId, 0, reservationId, new Date().toISOString())
      .run();
    mockGoogleExchange(providerUserId, `fresh-${crypto.randomUUID()}@example.com`);

    const callback = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google/callback?code=fake-fresh-code&state=${state}`,
      { redirect: 'manual', headers: { Cookie: cookies } },
    );
    expect(callback.status).toBe(302);
    const ticket = getRedirectFragmentParams(new URL(callback.headers.get('location')!))
      .get('oauth_exchange_ticket');
    const exchange = await fetchJson('POST', '/api/auth/oauth/exchange', {
      ticket,
      oauthRecoveryNonce: RECOVERY_NONCE,
    });
    expect(exchange.status).toBe(409);

    const pending = await (globalThis as any).env.AUTH_DB.prepare(
      `SELECT userId, status, reservationId FROM _oauth_index WHERE provider = ? AND providerUserId = ?`,
    )
      .bind('google', providerUserId)
      .first<{ userId: string; status: string; reservationId: string }>();
    expect(pending).toEqual({ userId: ownerUserId, status: 'pending', reservationId });
  });

  it('auto-links against an existing _users email even if _email_index is missing', async () => {
    const existingEmail = `oauth-existing-${crypto.randomUUID()}@example.com`;
    const signup = await fetchJson('POST', '/api/auth/signup', {
      email: existingEmail,
      password: 'EdgeBase!1234',
    });

    expect([200, 201]).toContain(signup.status);
    const existingUserId = signup.data.user.id as string;

    await (globalThis as any).env.AUTH_DB.prepare(
      `DELETE FROM _email_index WHERE email = ?`,
    )
      .bind(existingEmail)
      .run();

    const start = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google?redirect_url=${encodeURIComponent(APP_CALLBACK)}`,
      { redirect: 'manual' },
    );

    expect(start.status).toBe(302);
    const providerUrl = new URL(start.headers.get('location')!);
    const state = providerUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    const cookies = cookieHeader(start);

    mockGoogleExchange('google-user-existing', existingEmail);

    const callback = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google/callback?code=fake-existing-code&state=${state}`,
      { redirect: 'manual', headers: { Cookie: cookies } },
    );

    expect(callback.status).toBe(302);
    const ticket = getRedirectFragmentParams(new URL(callback.headers.get('location')!))
      .get('oauth_exchange_ticket');
    const exchange = await fetchJson('POST', '/api/auth/oauth/exchange', { ticket });
    expect([200, 201]).toContain(exchange.status);
    const oauthAccount = await (globalThis as any).env.AUTH_DB.prepare(
      `SELECT userId FROM _oauth_accounts WHERE provider = ? AND providerUserId = ?`,
    )
      .bind('google', 'google-user-existing')
      .first<{ userId: string }>();

    expect(oauthAccount?.userId).toBe(existingUserId);

    const healedEmailIndex = await (globalThis as any).env.AUTH_DB.prepare(
      `SELECT userId, status FROM _email_index WHERE email = ?`,
    )
      .bind(existingEmail)
      .first<{ userId: string; status: string }>();

    expect(healedEmailIndex?.userId).toBe(existingUserId);
    expect(healedEmailIndex?.status).toBe('confirmed');
  });

  it('OAuth callback redirects provider errors back to the app when redirect_url was provided', async () => {
    const start = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google?redirect_url=${encodeURIComponent(APP_CALLBACK)}&oauth_recovery_nonce=${RECOVERY_NONCE}`,
      { redirect: 'manual' },
    );

    const providerUrl = new URL(start.headers.get('location')!);
    const state = providerUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    const cookies = cookieHeader(start);

    const callback = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google/callback?error=access_denied&error_description=User%20denied&state=${state}`,
      { redirect: 'manual', headers: { Cookie: cookies } },
    );

    expect(callback.status).toBe(302);
    const appUrl = new URL(callback.headers.get('location')!);
    const redirectParams = getRedirectFragmentParams(appUrl);
    expect(appUrl.origin).toBe('https://app.example.com');
    expect(appUrl.pathname).toBe('/auth/callback');
    expect(redirectParams.get('error')).toBe('access_denied');
    expect(redirectParams.get('error_description')).toBe('User denied');
    expect(redirectParams.get('oauth_recovery_nonce')).toBe(RECOVERY_NONCE);
    expect(await (globalThis as any).env.KV.get(`oauth:state:google:${state}`)).toBeNull();

    const replay = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/google/callback?error=access_denied&state=${state}`,
      { redirect: 'manual' },
    );
    expect(replay.status).toBe(400);
  });

  it('anonymous link OAuth uses redirectUrl from POST body and redirects success back to the app', async () => {
    const anon = await fetchJson('POST', '/api/auth/signin/anonymous');
    expect([200, 201]).toContain(anon.status);
    const accessToken = anon.data.accessToken as string;

    const linkStart = await fetchJson(
      'POST',
      '/api/auth/oauth/link/google',
      {
        redirectUrl: APP_CALLBACK,
        oauthRecoveryNonce: RECOVERY_NONCE,
      },
      accessToken,
    );

    expect(linkStart.status).toBe(200);
    const continuation = await (globalThis as any).SELF.fetch(linkStart.data.redirectUrl, {
      redirect: 'manual',
    });
    expect(continuation.status).toBe(302);
    const providerUrl = new URL(continuation.headers.get('location')!);
    expect(providerUrl.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/oauth/link/google/callback`);
    const state = providerUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    const cookies = cookieHeader(continuation);

    mockGoogleExchange('google-user-link', 'oauth-link@test.com');

    const callback = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/link/google/callback?code=fake-link-code&state=${state}`,
      { redirect: 'manual', headers: { Cookie: cookies } },
    );

    expect(callback.status).toBe(302);
    const appUrl = new URL(callback.headers.get('location')!);
    const redirectParams = getRedirectFragmentParams(appUrl);
    expect(appUrl.origin).toBe('https://app.example.com');
    expect(appUrl.pathname).toBe('/auth/callback');
    expect(redirectParams.get('access_token')).toBeNull();
    expect(redirectParams.get('refresh_token')).toBeNull();
    const ticket = redirectParams.get('oauth_link_ticket');
    expect(ticket).toMatch(/^[0-9a-f]{64}$/);
    expect(redirectParams.get('oauth_recovery_nonce')).toBe(RECOVERY_NONCE);
    const complete = await fetchJson(
      'POST',
      '/api/auth/oauth/complete/link',
      { ticket, oauthRecoveryNonce: RECOVERY_NONCE },
      accessToken,
    );
    expect(complete.status).toBe(200);
    expect(complete.data.user.isAnonymous).toBe(false);
  });
});
