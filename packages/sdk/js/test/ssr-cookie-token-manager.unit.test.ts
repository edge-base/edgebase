import { describe, expect, it } from 'vitest';
import { CookieTokenManager } from '../packages/ssr/src/cookie-token-manager.js';

function encodeBase64UrlJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = encodeBase64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const body = encodeBase64UrlJson(payload);
  return `${header}.${body}.fakesig`;
}

class MockCookieStore {
  values = new Map<string, string>();
  writes: Array<{ name: string; value: string; options?: Record<string, unknown> }> = [];
  deletes: string[] = [];

  get(name: string): string | null {
    return this.values.get(name) ?? null;
  }

  set(name: string, value: string, options?: Record<string, unknown>): void {
    this.values.set(name, value);
    this.writes.push({ name, value, options });
  }

  delete(name: string): void {
    this.values.delete(name);
    this.deletes.push(name);
  }
}

describe('CookieTokenManager', () => {
  it('returns an unexpired access token without refreshing', () => {
    const cookies = new MockCookieStore();
    const accessToken = makeJwt({
      sub: 'u-1',
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    cookies.values.set('eb_access_token', accessToken);

    const manager = new CookieTokenManager(cookies);

    expect(manager.getAccessToken()).toBe(accessToken);
  });

  it('refreshes when the access token cookie is expired', async () => {
    const cookies = new MockCookieStore();
    cookies.values.set('eb_access_token', makeJwt({
      sub: 'u-expired',
      exp: Math.floor(Date.now() / 1000) - 10,
    }));
    const refreshToken = makeJwt({
      sub: 'u-expired',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    cookies.values.set('eb_refresh_token', refreshToken);

    const manager = new CookieTokenManager(cookies);
    const refreshedAccessToken = makeJwt({
      sub: 'u-expired',
      exp: Math.floor(Date.now() / 1000) + 900,
    });

    const result = await manager.getAccessToken(async (incomingRefreshToken) => {
      expect(incomingRefreshToken).toBe(refreshToken);
      return {
        accessToken: refreshedAccessToken,
        refreshToken,
      };
    });

    expect(result).toBe(refreshedAccessToken);
    expect(cookies.deletes).toContain('eb_access_token');
  });

  it('derives cookie maxAge from JWT expiry', () => {
    const cookies = new MockCookieStore();
    const accessToken = makeJwt({
      sub: 'u-ttl',
      exp: Math.floor(Date.now() / 1000) + 321,
    });
    const refreshToken = makeJwt({
      sub: 'u-ttl',
      exp: Math.floor(Date.now() / 1000) + 654,
    });

    const manager = new CookieTokenManager(cookies);
    manager.setTokens({ accessToken, refreshToken });

    const accessWrite = cookies.writes.find((entry) => entry.name === 'eb_access_token');
    const refreshWrite = cookies.writes.find((entry) => entry.name === 'eb_refresh_token');

    expect(accessWrite?.options?.maxAge).toBeTypeOf('number');
    expect(refreshWrite?.options?.maxAge).toBeTypeOf('number');
    expect(accessWrite!.options!.maxAge as number).toBeGreaterThan(0);
    expect(accessWrite!.options!.maxAge as number).toBeLessThanOrEqual(321);
    expect(refreshWrite!.options!.maxAge as number).toBeGreaterThan(0);
    expect(refreshWrite!.options!.maxAge as number).toBeLessThanOrEqual(654);
  });
});
