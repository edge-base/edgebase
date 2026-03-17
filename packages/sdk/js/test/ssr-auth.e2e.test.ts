// @vitest-environment node

import { afterAll, describe, expect, it } from 'vitest';
import { ContextManager, HttpClient } from '../packages/core/src/index.js';
import { CookieTokenManager, createServerClient } from '../packages/ssr/src/index.js';

function resolveBaseUrl() {
  const candidate = process.env['BASE_URL'];
  return candidate && /^https?:\/\//i.test(candidate) ? candidate : 'http://localhost:8688';
}

const SERVER = resolveBaseUrl();
class MemoryCookieStore {
  private values = new Map<string, string>();

  get(name: string): string | null {
    return this.values.get(name) ?? null;
  }

  set(name: string, value: string): void {
    this.values.set(name, value);
  }

  delete(name: string): void {
    this.values.delete(name);
  }
}

async function rawJson(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
) {
  const response = await fetch(`${SERVER}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}

async function signUpUser(email: string, password: string) {
  const { response, data } = await rawJson('POST', '/api/auth/signup', { email, password });
  expect(response.ok).toBe(true);
  expect(typeof data?.accessToken).toBe('string');
  expect(typeof data?.refreshToken).toBe('string');
  return data as { accessToken: string; refreshToken: string; user: { email: string } };
}

async function getProfile(accessToken: string) {
  const { response, data } = await rawJson('GET', '/api/auth/me', undefined, {
    'Authorization': `Bearer ${accessToken}`,
  });
  expect(response.ok).toBe(true);
  return ((data?.user ?? data) ?? null) as { email?: string; id?: string } | null;
}

afterAll(() => {
  // Keep the lifecycle explicit for future suite growth.
});

describe('js-ssr:auth — cookie session lifecycle', () => {
  it('setSession hydrates getUser and getSession', async () => {
    const cookies = new MemoryCookieStore();
    const client = createServerClient(SERVER, { cookies });
    const email = `jsssr-auth-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const session = await signUpUser(email, 'SsrAuth123!');

    client.setSession({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    });

    expect(client.getUser()?.email).toBe(email);
    expect(client.getSession()).toEqual({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    });
  });

  it('exported session tokens authorize authenticated routes', async () => {
    const cookies = new MemoryCookieStore();
    const client = createServerClient(SERVER, { cookies });
    const email = `jsssr-db-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const session = await signUpUser(email, 'SsrDb123!');

    client.setSession({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    });

    const profile = await getProfile(client.getSession().accessToken!);
    expect(profile?.id).toBeTruthy();
  });

  it('stale access token refreshes through the stored refresh token', async () => {
    const cookies = new MemoryCookieStore();
    const email = `jsssr-refresh-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const session = await signUpUser(email, 'SsrRefresh123!');
    const tokenManager = new CookieTokenManager(cookies);
    const http = new HttpClient({
      baseUrl: SERVER,
      tokenManager,
      contextManager: new ContextManager(),
    });

    tokenManager.setTokens({
      accessToken: 'stale-access-token',
      refreshToken: session.refreshToken,
    });

    const headers = await http.getAuthHeaders();
    const refreshedAccessToken = headers['Authorization']?.replace(/^Bearer /u, '') ?? null;

    expect(refreshedAccessToken).toBeTruthy();
    expect(refreshedAccessToken).not.toBe('stale-access-token');
    expect(tokenManager.getRefreshToken()).toBeTruthy();
  });

  it('clearSession removes cookie-backed auth state', async () => {
    const cookies = new MemoryCookieStore();
    const client = createServerClient(SERVER, { cookies });
    const email = `jsssr-clear-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const session = await signUpUser(email, 'SsrClear123!');

    client.setSession({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    });
    client.clearSession();

    expect(client.getUser()).toBeNull();
    expect(client.getSession()).toEqual({
      accessToken: null,
      refreshToken: null,
    });
  });
});
