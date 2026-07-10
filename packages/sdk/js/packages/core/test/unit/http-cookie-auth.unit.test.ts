import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextManager } from '../../src/context.js';
import { HttpClient } from '../../src/http.js';
import type { ITokenManager, ITokenPair } from '../../src/types.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('HttpClient HttpOnly-cookie auth transport', () => {
  it('adds the transport header and credentials only to POST auth endpoints', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      contextManager: new ContextManager(),
      refreshTokenTransport: 'httpOnlyCookie',
    });

    await client.postPublic('/api/auth/signin', { email: 'user@example.com' });
    await client.get('/api/auth/sessions');
    await client.patch('/api/auth/profile', { displayName: 'Updated' });
    await client.delete('/api/auth/sessions/session-2');
    await client.get('/api/db/shared/tables/posts');

    const authInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(authInit.credentials).toBe('include');
    expect(new Headers(authInit.headers).get('X-EdgeBase-Auth-Transport')).toBe('cookie');

    const safeAuthInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(safeAuthInit.credentials).toBeUndefined();
    expect(new Headers(safeAuthInit.headers).has('X-EdgeBase-Auth-Transport')).toBe(false);

    const patchAuthInit = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(patchAuthInit.credentials).toBeUndefined();
    expect(new Headers(patchAuthInit.headers).has('X-EdgeBase-Auth-Transport')).toBe(false);

    const deleteAuthInit = fetchMock.mock.calls[3]?.[1] as RequestInit;
    expect(deleteAuthInit.credentials).toBeUndefined();
    expect(new Headers(deleteAuthInit.headers).has('X-EdgeBase-Auth-Transport')).toBe(false);

    const dbInit = fetchMock.mock.calls[4]?.[1] as RequestInit;
    expect(dbInit.credentials).toBeUndefined();
    expect(new Headers(dbInit.headers).has('X-EdgeBase-Auth-Transport')).toBe(false);
  });

  it('refreshes with the cookie, accepts a response without a refresh token, and keeps it out of the request body', async () => {
    const accessToken = 'header.payload.signature';
    let currentAccessToken: string | null = null;
    const tokenManager: ITokenManager = {
      getAccessToken: vi.fn(async (refreshFn?: (refreshToken: string) => Promise<ITokenPair>) => {
        if (currentAccessToken) return currentAccessToken;
        const pair = await refreshFn?.('');
        currentAccessToken = pair?.accessToken ?? null;
        return currentAccessToken;
      }),
      getRefreshToken: () => null,
      invalidateAccessToken: () => {
        currentAccessToken = null;
      },
      setTokens: () => {},
      clearTokens: () => {},
    };
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/refresh')) {
        return new Response(JSON.stringify({
          accessToken,
          sessionTransport: 'cookie',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      contextManager: new ContextManager(),
      tokenManager,
      refreshTokenTransport: 'httpOnlyCookie',
    });
    await client.get('/api/db/shared/tables/posts');

    const refreshInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(refreshInit.credentials).toBe('include');
    expect(new Headers(refreshInit.headers).get('X-EdgeBase-Auth-Transport')).toBe('cookie');
    expect(refreshInit.body).toBe('{}');

    const dbInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(dbInit.headers).get('Authorization')).toBe(`Bearer ${accessToken}`);
  });

  it('preserves the legacy body transport by default', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      contextManager: new ContextManager(),
    });

    await client.postPublic('/api/auth/signin', {});

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBeUndefined();
    expect(new Headers(init.headers).has('X-EdgeBase-Auth-Transport')).toBe(false);
  });

  it('normalizes cookie refresh fetch failures as code-0 network errors', async () => {
    const tokenManager: ITokenManager = {
      getAccessToken: async (refreshFn) => {
        const pair = await refreshFn?.('');
        return pair?.accessToken ?? null;
      },
      getRefreshToken: () => null,
      invalidateAccessToken: () => {},
      setTokens: () => {},
      clearTokens: () => {},
    };
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('offline');
    }));
    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      contextManager: new ContextManager(),
      tokenManager,
      refreshTokenTransport: 'httpOnlyCookie',
    });

    await expect(client.get('/api/db/shared/tables/posts')).rejects.toMatchObject({
      code: 0,
      slug: 'network-error',
    });
  });

  it('times out when cookie auth headers arrive but the response body stalls', async () => {
    vi.useFakeTimers();
    const stalledBody = new ReadableStream<Uint8Array>({ start() { /* never close */ } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stalledBody, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      contextManager: new ContextManager(),
      refreshTokenTransport: 'httpOnlyCookie',
    });

    const outcome = client.postPublic('/api/auth/signin', {}).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(14_999);
    let settled = false;
    void outcome.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(outcome).resolves.toMatchObject({ code: 0, slug: 'network-error' });
  });
});
