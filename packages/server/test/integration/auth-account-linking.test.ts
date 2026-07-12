import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fetchMock } from 'cloudflare:test';
import { setConfig } from '../../src/lib/do-router.js';
import testConfig from '../../edgebase.test.config.ts';
import { getRedirectFragmentParams } from './redirect-fragment.js';
import { createSessionAndTokens } from '../../src/routes/auth.js';
import { D1AuthDb } from '../../src/lib/auth-db-adapter.js';
import { getEmailLinkUpgradeCompletion } from '../../src/lib/auth-d1-service.js';

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
      allowedOAuthProviders: ['google'],
      allowedRedirectUrls: [APP_CALLBACK],
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

async function createAnonymousLinkTicket(
  accessToken: string,
  providerUserId: string,
  email?: string,
): Promise<string> {
  const linkStart = await fetchJson(
    'POST',
    '/api/auth/oauth/link/google',
    { redirectUrl: APP_CALLBACK, oauthRecoveryNonce: RECOVERY_NONCE },
    accessToken,
  );
  expect(linkStart.status).toBe(200);
  const continuation = await (globalThis as any).SELF.fetch(linkStart.data.redirectUrl, {
    redirect: 'manual',
  });
  expect(continuation.status).toBe(302);
  const state = new URL(continuation.headers.get('location')!).searchParams.get('state');
  expect(state).toMatch(/^[0-9a-f]{64}$/);
  mockGoogleExchange(providerUserId, email);
  const callback = await (globalThis as any).SELF.fetch(
    `${BASE}/api/auth/oauth/link/google/callback?code=code-${providerUserId}&state=${state}`,
    { redirect: 'manual', headers: { Cookie: cookieHeader(continuation) } },
  );
  expect(callback.status).toBe(302);
  const ticket = getRedirectFragmentParams(new URL(callback.headers.get('location')!))
    .get('oauth_link_ticket');
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

describe('auth-account-linking', () => {
  it('replays an anonymous email upgrade exactly for the same normalized email and password', async () => {
    const anon = await fetchJson('POST', '/api/auth/signin/anonymous');
    expect([200, 201]).toContain(anon.status);
    const userId = anon.data.user.id as string;
    const initiatingAccessToken = anon.data.accessToken as string;
    const secondAnonymousSession = await createSessionAndTokens(
      (globalThis as any).env,
      userId,
      '127.0.0.1',
      'email-upgrade-response-loss-test',
    );
    const email = randomEmail('anonymous-email-upgrade');
    const password = 'AnonymousEmailUpgrade1234!';

    // Treat the first successful response as lost. The retry deliberately uses
    // the initiating access token whose sid was revoked by the atomic commit.
    const first = await fetchJson(
      'POST',
      '/api/auth/link/email',
      { email: email.toUpperCase(), password },
      initiatingAccessToken,
    );
    expect(first.status).toBe(200);
    const retry = await fetchJson(
      'POST',
      '/api/auth/link/email',
      { email, password },
      initiatingAccessToken,
    );
    expect(retry.status).toBe(200);
    expect(retry.data.sessionId).toBe(first.data.sessionId);
    expect(retry.data.accessToken).toBe(first.data.accessToken);
    expect(retry.data.refreshToken).toBe(first.data.refreshToken);
    expect(retry.data.user).toMatchObject({ id: userId, email, isAnonymous: false });

    const nonInitiatingAnonymousSession = await fetchJson(
      'POST',
      '/api/auth/link/email',
      { email, password },
      secondAnonymousSession.accessToken,
    );
    expect(nonInitiatingAnonymousSession.status).toBe(401);
    expect(nonInitiatingAnonymousSession.data).toMatchObject({ slug: 'invalid-credentials' });

    const wrongPassword = await fetchJson(
      'POST',
      '/api/auth/link/email',
      { email, password: 'WrongEmailUpgrade1234!' },
      initiatingAccessToken,
    );
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.data).toMatchObject({ slug: 'invalid-credentials' });
    const wrongEmail = await fetchJson(
      'POST',
      '/api/auth/link/email',
      { email: randomEmail('wrong-email-upgrade'), password },
      initiatingAccessToken,
    );
    expect(wrongEmail.status).toBe(401);
    expect(wrongEmail.data).toMatchObject({ slug: 'invalid-session' });

    const otherAnon = await fetchJson('POST', '/api/auth/signin/anonymous');
    const wrongUser = await fetchJson(
      'POST',
      '/api/auth/link/email',
      { email, password },
      otherAnon.data.accessToken,
    );
    expect(wrongUser.status).toBe(409);
    expect(wrongUser.data).toMatchObject({ slug: 'email-already-exists' });

    const staleFirstRefresh = await fetchJson('POST', '/api/auth/refresh', {
      refreshToken: anon.data.refreshToken,
    });
    expect(staleFirstRefresh.status).toBe(401);
    const staleSecondRefresh = await fetchJson('POST', '/api/auth/refresh', {
      refreshToken: secondAnonymousSession.refreshToken,
    });
    expect(staleSecondRefresh.status).toBe(401);

    const replacementSession = await fetchJson(
      'GET',
      '/api/auth/sessions',
      undefined,
      retry.data.accessToken,
    );
    expect(replacementSession.status).toBe(200);
    const dbBinding = (globalThis as any).env.AUTH_DB as D1Database;
    const sessions = await dbBinding.prepare(
      `SELECT id, refreshToken FROM _sessions WHERE userId = ?`,
    ).bind(userId).all<{ id: string; refreshToken: string }>();
    expect(sessions.results).toEqual([{
      id: first.data.sessionId,
      refreshToken: first.data.refreshToken,
    }]);

    const authDb = new D1AuthDb(dbBinding);
    const checkpoint = await getEmailLinkUpgradeCompletion(authDb, userId, email);
    expect(checkpoint).toMatchObject({
      kind: 'email-link-completion',
      userId,
      subject: email,
      secretHash: expect.stringMatching(/^hmac-sha256:[0-9a-f]{64}$/),
    });
    expect(checkpoint?.secretHash).not.toContain(password);
    expect(checkpoint?.payload).not.toContain(first.data.accessToken);
    expect(checkpoint?.payload).not.toContain(first.data.refreshToken);
    const linkedUser = await dbBinding.prepare(
      `SELECT passwordHash FROM _users WHERE id = ?`,
    ).bind(userId).first<{ passwordHash: string }>();
    expect(linkedUser?.passwordHash).toMatch(/^pbkdf2:sha256:/);
    expect(checkpoint?.secretHash).not.toBe(linkedUser?.passwordHash);
    expect(checkpoint?.payload).not.toContain(linkedUser!.passwordHash);

    const passwordSignin = await fetchJson('POST', '/api/auth/signin', { email, password });
    expect(passwordSignin.status).toBe(200);
    expect(passwordSignin.data.user).toMatchObject({ id: userId, email, isAnonymous: false });
    const permanentRelink = await fetchJson(
      'POST',
      '/api/auth/link/email',
      { email, password },
      passwordSignin.data.accessToken,
    );
    expect(permanentRelink.status).toBe(400);
    expect(permanentRelink.data).toMatchObject({ slug: 'invalid-input' });

    await dbBinding.prepare(
      `UPDATE _auth_challenges SET expiresAt = ? WHERE key = ?`,
    ).bind(new Date(Date.now() - 1_000).toISOString(), checkpoint!.key).run();
    const expiredRetry = await fetchJson(
      'POST',
      '/api/auth/link/email',
      { email, password },
      initiatingAccessToken,
    );
    expect(expiredRetry.status).toBe(401);
    expect(expiredRetry.data).toMatchObject({ slug: 'invalid-session' });
    await expect(getEmailLinkUpgradeCompletion(authDb, userId, email)).resolves.toBeNull();
  });

  it('concurrent anonymous email completions converge on one exact replacement pair', async () => {
    const anon = await fetchJson('POST', '/api/auth/signin/anonymous');
    expect([200, 201]).toContain(anon.status);
    const email = randomEmail('concurrent-anonymous-email-upgrade');
    const password = 'ConcurrentEmailUpgrade1234!';
    const input = { email, password };

    const [first, second] = await Promise.all([
      fetchJson('POST', '/api/auth/link/email', input, anon.data.accessToken),
      fetchJson('POST', '/api/auth/link/email', input, anon.data.accessToken),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.data.sessionId).toBe(first.data.sessionId);
    expect(second.data.accessToken).toBe(first.data.accessToken);
    expect(second.data.refreshToken).toBe(first.data.refreshToken);
    const count = await ((globalThis as any).env.AUTH_DB as D1Database).prepare(
      `SELECT COUNT(*) AS count FROM _sessions WHERE userId = ?`,
    ).bind(anon.data.user.id).first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it('rejects oversized email-upgrade authority before mutating the anonymous account', async () => {
    const anon = await fetchJson('POST', '/api/auth/signin/anonymous');
    expect([200, 201]).toContain(anon.status);
    const oversizedEmail = `${'a'.repeat(309)}@example.com`;
    expect(oversizedEmail.length).toBeGreaterThan(320);

    const emailResult = await fetchJson(
      'POST',
      '/api/auth/link/email',
      { email: oversizedEmail, password: 'OversizedEmail1234!' },
      anon.data.accessToken,
    );
    expect(emailResult.status).toBe(400);
    expect(emailResult.data).toMatchObject({ slug: 'invalid-email' });
    const passwordResult = await fetchJson(
      'POST',
      '/api/auth/link/email',
      { email: randomEmail('oversized-password'), password: `A1!${'x'.repeat(254)}` },
      anon.data.accessToken,
    );
    expect(passwordResult.status).toBe(400);
    expect(passwordResult.data).toMatchObject({ slug: 'password-too-long' });

    const db = (globalThis as any).env.AUTH_DB as D1Database;
    await expect(db.prepare(
      `SELECT email, isAnonymous FROM _users WHERE id = ?`,
    ).bind(anon.data.user.id).first()).resolves.toMatchObject({
      email: null,
      isAnonymous: 1,
    });
    await expect(db.prepare(
      `SELECT COUNT(*) AS count FROM _sessions WHERE userId = ?`,
    ).bind(anon.data.user.id).first<{ count: number }>()).resolves.toEqual({ count: 1 });
  });

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
      {
        redirectUrl: APP_CALLBACK,
        state: 'account-link-state',
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

    mockGoogleExchange('google-user-existing-account', randomEmail('google-profile'));

    const callback = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/link/google/callback?code=link-code&state=${state}`,
      { redirect: 'manual', headers: { Cookie: cookies } },
    );
    expect(callback.status).toBe(302);

    const appUrl = new URL(callback.headers.get('location')!);
    const redirectParams = getRedirectFragmentParams(appUrl);
    expect(appUrl.origin).toBe('https://app.example.com');
    expect(appUrl.pathname).toBe('/auth/callback');
    expect(redirectParams.get('state')).toBe('account-link-state');
    expect(redirectParams.get('access_token')).toBeNull();
    const linkTicket = redirectParams.get('oauth_link_ticket');
    expect(linkTicket).toMatch(/^[0-9a-f]{64}$/);
    const complete = await fetchJson(
      'POST',
      '/api/auth/oauth/complete/link',
      { ticket: linkTicket, oauthRecoveryNonce: RECOVERY_NONCE },
      accessToken,
    );
    expect(complete.status).toBe(200);
    const linkedAccessToken = complete.data.accessToken as string;
    expect(linkedAccessToken).toBeTruthy();
    const responseLossRetry = await fetchJson(
      'POST',
      '/api/auth/oauth/complete/link',
      { ticket: linkTicket, oauthRecoveryNonce: RECOVERY_NONCE },
      accessToken,
    );
    expect(responseLossRetry.status).toBe(200);
    expect(responseLossRetry.data).toEqual(complete.data);

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
    const secondAnonymousSession = await createSessionAndTokens(
      (globalThis as any).env,
      anon.data.user.id,
      '127.0.0.1',
      'account-linking-test',
    );

    const linkStart = await fetchJson(
      'POST',
      '/api/auth/oauth/link/google',
      { redirectUrl: APP_CALLBACK, oauthRecoveryNonce: RECOVERY_NONCE },
      accessToken,
    );
    expect(linkStart.status).toBe(200);
    const continuation = await (globalThis as any).SELF.fetch(linkStart.data.redirectUrl, {
      redirect: 'manual',
    });
    expect(continuation.status).toBe(302);
    const providerUrl = new URL(continuation.headers.get('location')!);
    const state = providerUrl.searchParams.get('state');
    expect(state).toBeTruthy();
    const cookies = cookieHeader(continuation);

    mockGoogleExchange('google-user-oauth-only');

    const callback = await (globalThis as any).SELF.fetch(
      `${BASE}/api/auth/oauth/link/google/callback?code=oauth-only-code&state=${state}`,
      { redirect: 'manual', headers: { Cookie: cookies } },
    );
    expect(callback.status).toBe(302);
    const appUrl = new URL(callback.headers.get('location')!);
    const redirectParams = getRedirectFragmentParams(appUrl);
    expect(redirectParams.get('access_token')).toBeNull();
    const ticket = redirectParams.get('oauth_link_ticket');
    expect(ticket).toMatch(/^[0-9a-f]{64}$/);
    const db = (globalThis as any).env.AUTH_DB as D1Database;
    await db.exec('DROP TRIGGER IF EXISTS fail_oauth_completion_session_once;');
    await db.prepare(`CREATE TRIGGER fail_oauth_completion_session_once
      BEFORE INSERT ON _sessions
      WHEN substr(NEW.id, 1, 6) = 'oauth_'
      BEGIN
        SELECT RAISE(FAIL, 'synthetic oauth session failure');
      END`).run();
    const failedAfterFinalize = await fetchJson(
      'POST',
      '/api/auth/oauth/complete/link',
      { ticket, oauthRecoveryNonce: RECOVERY_NONCE },
      accessToken,
    );
    await db.exec('DROP TRIGGER IF EXISTS fail_oauth_completion_session_once;');
    expect(failedAfterFinalize.status).toBe(500);
    const complete = await fetchJson(
      'POST',
      '/api/auth/oauth/complete/link',
      { ticket, oauthRecoveryNonce: RECOVERY_NONCE },
      accessToken,
    );
    expect(complete.status).toBe(200);
    expect(complete.data.sessionId).toMatch(/^oauth_[0-9a-f]{64}$/);
    const linkedAccessToken = complete.data.accessToken as string;
    const revokedAnonymousRefresh = await fetchJson('POST', '/api/auth/refresh', {
      refreshToken: anon.data.refreshToken,
    });
    expect(revokedAnonymousRefresh.status).toBe(401);
    const revokedSecondAnonymousRefresh = await fetchJson('POST', '/api/auth/refresh', {
      refreshToken: secondAnonymousSession.refreshToken,
    });
    expect(revokedSecondAnonymousRefresh.status).toBe(401);
    const publicProjection = await db.prepare(
      `SELECT id, isAnonymous FROM _users_public WHERE id = ?`,
    ).bind(anon.data.user.id).first<{ id: string; isAnonymous: number }>();
    expect(publicProjection).toMatchObject({ id: anon.data.user.id, isAnonymous: 0 });

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

  it('rejects completion when the initiating anonymous session is revoked after link start', async () => {
    const anon = await fetchJson('POST', '/api/auth/signin/anonymous');
    expect([200, 201]).toContain(anon.status);
    const providerUserId = `revoked-link-${crypto.randomUUID()}`;
    const ticket = await createAnonymousLinkTicket(
      anon.data.accessToken,
      providerUserId,
      randomEmail('revoked-link'),
    );
    const db = (globalThis as any).env.AUTH_DB as D1Database;
    await db.prepare('DELETE FROM _sessions WHERE id = ?').bind(anon.data.sessionId).run();

    const complete = await fetchJson(
      'POST',
      '/api/auth/oauth/complete/link',
      { ticket, oauthRecoveryNonce: RECOVERY_NONCE },
      anon.data.accessToken,
    );
    expect(complete.status).toBe(409);
    expect(complete.data).toMatchObject({ slug: 'auth-state-changed' });
    const linked = await db.prepare(
      `SELECT userId FROM _oauth_accounts WHERE provider = ? AND providerUserId = ?`,
    ).bind('google', providerUserId).first();
    expect(linked).toBeNull();
  });

  it('does not treat an identity linked before completion started as recovery authority', async () => {
    const anon = await fetchJson('POST', '/api/auth/signin/anonymous');
    expect([200, 201]).toContain(anon.status);
    const providerUserId = `prelinked-${crypto.randomUUID()}`;
    const db = (globalThis as any).env.AUTH_DB as D1Database;
    await db.prepare(`INSERT INTO _oauth_accounts
      (id, userId, provider, providerUserId, createdAt)
      VALUES (?, ?, 'google', ?, ?)`)
      .bind(crypto.randomUUID(), anon.data.user.id, providerUserId, new Date().toISOString())
      .run();
    await db.prepare(`INSERT INTO _oauth_index
      (provider, providerUserId, userId, shardId, status, reservationId, createdAt)
      VALUES ('google', ?, ?, 0, 'confirmed', NULL, ?)`)
      .bind(providerUserId, anon.data.user.id, new Date().toISOString())
      .run();
    const ticket = await createAnonymousLinkTicket(
      anon.data.accessToken,
      providerUserId,
      randomEmail('prelinked'),
    );
    await db.prepare('DELETE FROM _sessions WHERE id = ?').bind(anon.data.sessionId).run();

    const complete = await fetchJson(
      'POST',
      '/api/auth/oauth/complete/link',
      { ticket, oauthRecoveryNonce: RECOVERY_NONCE },
      anon.data.accessToken,
    );
    expect(complete.status).toBe(409);
    expect(complete.data).toMatchObject({ slug: 'auth-state-changed' });
    const user = await db.prepare('SELECT isAnonymous FROM _users WHERE id = ?')
      .bind(anon.data.user.id)
      .first<{ isAnonymous: number }>();
    expect(user?.isAnonymous).toBe(1);
  });
});
