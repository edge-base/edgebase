import { beforeAll, describe, expect, it } from 'vitest';

const BASE = 'http://localhost';
const ORIGIN = 'http://localhost';
const COOKIE_HEADER = 'X-EdgeBase-Auth-Transport';

function randomEmail(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

function responseCookie(response: Response): string {
  const setCookie = response.headers.get('Set-Cookie') ?? '';
  return setCookie.split(';', 1)[0] ?? '';
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1] ?? '';
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

async function request(
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await (globalThis as { SELF: { fetch(input: string, init?: RequestInit): Promise<Response> } })
    .SELF.fetch(`${BASE}/api/auth${path}`, init);
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { response, body };
}

describe('user refresh HttpOnly cookie transport', () => {
  let cookie = '';
  let sessionId = '';

  beforeAll(async () => {
    const { response, body } = await request('/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        [COOKIE_HEADER]: 'cookie',
      },
      body: JSON.stringify({
        email: randomEmail('cookie-session'),
        password: 'CookieSession123!',
      }),
    });

    expect(response.status).toBe(201);
    expect(body.refreshToken).toBeUndefined();
    expect(body.sessionTransport).toBe('cookie');
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.sessionId).toBe('string');
    expect(decodeJwtPayload(body.accessToken as string).sid).toBe(body.sessionId);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(response.headers.get('Set-Cookie')).toContain('SameSite=Strict');
    expect(response.headers.get('Set-Cookie')).toContain('Path=/api/auth');
    cookie = responseCookie(response);
    sessionId = body.sessionId as string;
  });

  it('supports an exact credentialed cross-origin browser sign-in', async () => {
    const { response, body } = await request('/signin/anonymous', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:4173',
        [COOKIE_HEADER]: 'cookie',
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(201);
    expect(body.refreshToken).toBeUndefined();
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4173');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('rotates using only the cookie and keeps the session identifier', async () => {
    const { response, body } = await request('/refresh', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: cookie,
        [COOKIE_HEADER]: 'cookie',
      },
    });

    expect(response.status).toBe(200);
    expect(body.refreshToken).toBeUndefined();
    expect(body.sessionTransport).toBe('cookie');
    expect(body.sessionId).toBe(sessionId);
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
    cookie = responseCookie(response);
  });

  it('rejects cookie transport from an untrusted origin', async () => {
    const { response } = await request('/refresh', {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        'Sec-Fetch-Site': 'cross-site',
        Cookie: cookie,
        [COOKIE_HEADER]: 'cookie',
      },
    });

    expect(response.status).toBe(403);
  });

  it('clears the cookie and revokes the server session on signout', async () => {
    const { response } = await request('/signout', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: cookie,
        [COOKIE_HEADER]: 'cookie',
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');

    const retry = await request('/refresh', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: cookie,
        [COOKIE_HEADER]: 'cookie',
      },
    });
    expect(retry.response.status).toBe(401);
    expect(retry.response.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('exchanges a legacy body token only when no cookie is present', async () => {
    const signup = await request('/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: randomEmail('cookie-migration'),
        password: 'CookieMigration123!',
      }),
    });
    expect(typeof signup.body.refreshToken).toBe('string');

    const migrated = await request('/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        [COOKIE_HEADER]: 'cookie',
      },
      body: JSON.stringify({ refreshToken: signup.body.refreshToken }),
    });

    expect(migrated.response.status).toBe(200);
    expect(migrated.body.refreshToken).toBeUndefined();
    expect(migrated.response.headers.get('Set-Cookie')).toContain('HttpOnly');

    const migratedCookie = responseCookie(migrated.response);
    const cookieWins = await request('/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: migratedCookie,
        [COOKIE_HEADER]: 'cookie',
      },
      body: JSON.stringify({ refreshToken: 'body-must-not-override-cookie' }),
    });
    expect(cookieWins.response.status).toBe(200);
  });

  it('revokes a legacy body session through negotiated cookie signout when no cookie exists', async () => {
    const signup = await request('/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: randomEmail('cookie-legacy-signout'),
        password: 'CookieLegacySignout123!',
      }),
    });
    const legacyRefreshToken = signup.body.refreshToken as string;
    expect(typeof legacyRefreshToken).toBe('string');

    const signedOut = await request('/signout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        [COOKIE_HEADER]: 'cookie',
      },
      body: JSON.stringify({ refreshToken: legacyRefreshToken }),
    });
    expect(signedOut.response.status).toBe(200);
    expect(signedOut.response.headers.get('Set-Cookie')).toContain('Max-Age=0');

    const reused = await request('/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: legacyRefreshToken }),
    });
    expect(reused.response.status).toBe(401);
  });

  it('keeps the cookie and session valid when signout policy rejects the request', async () => {
    const signup = await request('/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        [COOKIE_HEADER]: 'cookie',
      },
      body: JSON.stringify({
        email: randomEmail('cookie-policy-signout'),
        password: 'CookiePolicy123!',
      }),
    });
    const policyCookie = responseCookie(signup.response);

    const denied = await request('/signout', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: policyCookie,
        [COOKIE_HEADER]: 'cookie',
        'x-edgebase-test-deny-signout': '1',
      },
    });

    expect(denied.response.status).toBe(403);
    expect(denied.response.headers.get('Set-Cookie')).toBeNull();

    const stillValid = await request('/refresh', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: policyCookie,
        [COOKIE_HEADER]: 'cookie',
      },
    });
    expect(stillValid.response.status).toBe(200);
    expect(stillValid.body.sessionTransport).toBe('cookie');
  });

  it('keeps the cookie on a transient signout failure so a retry can revoke the session', async () => {
    const signup = await request('/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        [COOKIE_HEADER]: 'cookie',
      },
      body: JSON.stringify({
        email: randomEmail('cookie-transient-signout'),
        password: 'CookieTransient123!',
      }),
    });
    const retryCookie = responseCookie(signup.response);

    const failed = await request('/signout', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: retryCookie,
        [COOKIE_HEADER]: 'cookie',
        'x-edgebase-test-error-signout': '1',
      },
    });
    expect(failed.response.status).toBe(500);
    expect(failed.response.headers.get('Set-Cookie')).toBeNull();

    const retried = await request('/signout', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: retryCookie,
        [COOKIE_HEADER]: 'cookie',
      },
    });
    expect(retried.response.status).toBe(200);
    expect(retried.response.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('expires the browser cookie on a definitive refresh policy rejection', async () => {
    const signup = await request('/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        [COOKIE_HEADER]: 'cookie',
      },
      body: JSON.stringify({
        email: randomEmail('cookie-policy-refresh'),
        password: 'CookiePolicy123!',
      }),
    });

    const denied = await request('/refresh', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Cookie: responseCookie(signup.response),
        [COOKIE_HEADER]: 'cookie',
        'x-edgebase-test-deny-refresh': '1',
      },
    });

    expect(denied.response.status).toBe(403);
    expect(denied.response.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('expires the cookie when the current session is revoked by id', async () => {
    const signup = await request('/signup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        [COOKIE_HEADER]: 'cookie',
      },
      body: JSON.stringify({
        email: randomEmail('cookie-current-revoke'),
        password: 'CookieRevoke123!',
      }),
    });

    const revoked = await request(`/sessions/${signup.body.sessionId}`, {
      method: 'DELETE',
      headers: {
        Origin: ORIGIN,
        Cookie: responseCookie(signup.response),
        Authorization: `Bearer ${signup.body.accessToken}`,
        [COOKIE_HEADER]: 'cookie',
      },
    });

    expect(revoked.response.status).toBe(200);
    expect(revoked.response.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('atomically converges concurrent same-token refreshes on one winning rotation', async () => {
    const signup = await request('/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: randomEmail('atomic-refresh'),
        password: 'AtomicRefresh123!',
      }),
    });
    const originalToken = signup.body.refreshToken as string;

    const [first, second] = await Promise.all([
      request('/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: originalToken }),
      }),
      request('/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: originalToken }),
      }),
    ]);

    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(200);
    expect(first.body.refreshToken).not.toBe(originalToken);
    expect(second.body.refreshToken).toBe(first.body.refreshToken);
    expect(second.body.sessionId).toBe(first.body.sessionId);
  });

  it('revokes the verified session id even when its token rotates twice during beforeSignOut', async () => {
    const signup = await request('/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: randomEmail('signout-rotation-race'),
        password: 'SignoutRotation123!',
      }),
    });
    const originalToken = signup.body.refreshToken as string;

    const signout = request('/signout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-edgebase-test-gate-signout': '1',
      },
      body: JSON.stringify({ refreshToken: originalToken }),
    });
    const firstRotation = await request('/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-edgebase-test-wait-for-signout-gate': '1',
      },
      body: JSON.stringify({ refreshToken: originalToken }),
    });
    expect(firstRotation.response.status, JSON.stringify(firstRotation.body)).toBe(200);

    const secondRotation = await request('/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-edgebase-test-release-signout': '1',
      },
      body: JSON.stringify({ refreshToken: firstRotation.body.refreshToken }),
    });
    const signedOut = await signout;
    expect(secondRotation.response.status).toBe(200);
    expect(signedOut.response.status).toBe(200);

    const reused = await request('/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: secondRotation.body.refreshToken }),
    });
    expect(reused.response.status).toBe(401);
  });
});
