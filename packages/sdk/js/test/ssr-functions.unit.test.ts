import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServerClient } from '../packages/ssr/src/index.js';

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ServerEdgeBase functions surface', () => {
  it('routes function calls through the authenticated SSR http client', async () => {
    const accessToken = makeJwt({
      sub: 'u-ssr-functions',
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const refreshToken = makeJwt({
      sub: 'u-ssr-functions',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchSpy);

    const client = createServerClient('http://localhost:8688', {
      cookies: new MemoryCookieStore(),
    });
    client.setSession({ accessToken, refreshToken });

    const result = await client.functions.get('public/ping', { probeId: 'ssr-functions' });

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8688/api/functions/public/ping?probeId=ssr-functions',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: `Bearer ${accessToken}`,
        }),
      }),
    );
  });

  it('uses the service key path for functions when configured', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchSpy);

    const client = createServerClient('http://localhost:8688', {
      cookies: new MemoryCookieStore(),
      serviceKey: 'test-service-key',
    });

    await client.functions.post('secure/profile', { probeId: 'service-key' });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8688/api/functions/secure/profile',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-EdgeBase-Service-Key': 'test-service-key',
        }),
      }),
    );

    const requestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = requestInit?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBeUndefined();
  });
});
