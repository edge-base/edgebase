import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextManager } from '../../src/context.js';
import { FunctionsClient } from '../../src/functions.js';
import { HttpClient } from '../../src/http.js';
import type { ITokenManager, ITokenPair } from '../../src/types.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('FunctionsClient.callRaw', () => {
  it('forwards every Function option through one raw-response transport lane', async () => {
    const httpClient = new HttpClient({
      baseUrl: 'https://api.example.test',
      contextManager: new ContextManager(),
    });
    const response = new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    const requestFunctionRaw = vi.spyOn(httpClient, 'requestFunctionRaw').mockResolvedValue(response);
    const functionsClient = new FunctionsClient(httpClient);

    const result = await functionsClient.callRaw('exports/archive', {
      method: 'PUT',
      body: { pageId: 'page-synthetic' },
      query: { disposition: 'attachment' },
      captchaToken: 'synthetic-captcha-token',
      timeoutMs: 12_000,
    });

    expect(result).toBe(response);
    expect(requestFunctionRaw).toHaveBeenCalledWith(
      'PUT',
      '/api/functions/exports/archive',
      { pageId: 'page-synthetic' },
      { disposition: 'attachment' },
      'synthetic-captcha-token',
      12_000,
    );
  });
});

describe('HttpClient.requestFunctionRaw', () => {
  it('returns the exact successful Response without consuming its streaming body', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
        controller.close();
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/zip' },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const client = new HttpClient({
      baseUrl: 'https://api.example.test',
      serviceKey: 'synthetic-service-key',
      contextManager: new ContextManager(),
    });
    client.setLocale('ko');

    const result = await client.requestFunctionRaw(
      'POST',
      '/api/functions/exports/archive',
      { pageId: 'page-synthetic' },
      { disposition: 'attachment' },
      'synthetic-captcha-token',
    );

    expect(result).toBe(response);
    expect(result.bodyUsed).toBe(false);
    expect(result.headers.get('Content-Type')).toBe('application/zip');

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(url).toBe('https://api.example.test/api/functions/exports/archive?disposition=attachment');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"pageId":"page-synthetic"}');
    expect(headers.get('X-EdgeBase-Service-Key')).toBe('synthetic-service-key');
    expect(headers.get('X-EdgeBase-Captcha-Token')).toBe('synthetic-captcha-token');
    expect(headers.get('Accept-Language')).toBe('ko');
    expect(Array.from(new Uint8Array(await result.arrayBuffer()))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('normalizes a non-success response without exposing its body as a raw success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      message: 'Synthetic archive rejected.',
      data: { field: 'pageId' },
    }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new HttpClient({
      baseUrl: 'https://api.example.test',
      contextManager: new ContextManager(),
    });

    await expect(client.requestFunctionRaw(
      'POST',
      '/api/functions/exports/archive',
      { pageId: 'page-synthetic' },
    )).rejects.toMatchObject({
      status: 422,
      message: 'Synthetic archive rejected.',
      data: { field: 'pageId' },
    });
  });

  it('uses the shared one-refresh auth path and leaves the retried success unread', async () => {
    let accessToken = 'stale-access-token';
    let refreshToken = 'synthetic-refresh-token';
    const tokenManager: ITokenManager = {
      getAccessToken: vi.fn(async (refreshFn?: (token: string) => Promise<ITokenPair>) => {
        if (accessToken) return accessToken;
        if (!refreshFn || !refreshToken) return null;
        const tokens = await refreshFn(refreshToken);
        tokenManager.setTokens(tokens);
        return tokens.accessToken;
      }),
      getRefreshToken: () => refreshToken,
      invalidateAccessToken: vi.fn(() => {
        accessToken = '';
      }),
      setTokens: vi.fn((tokens: ITokenPair) => {
        accessToken = tokens.accessToken;
        refreshToken = tokens.refreshToken;
      }),
      clearTokens: vi.fn(() => {
        accessToken = '';
        refreshToken = '';
      }),
    };
    const success = new Response(new Uint8Array([7, 8, 9]), {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Unauthorized.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accessToken: 'fresh-access-token',
        refreshToken: 'fresh-refresh-token',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(success);
    const client = new HttpClient({
      baseUrl: 'https://api.example.test',
      contextManager: new ContextManager(),
      tokenManager,
    });

    const result = await client.requestFunctionRaw(
      'GET',
      '/api/functions/exports/archive',
    );

    expect(result).toBe(success);
    expect(result.bodyUsed).toBe(false);
    expect(tokenManager.invalidateAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const retryHeaders = new Headers(fetchSpy.mock.calls[2]?.[1]?.headers);
    expect(retryHeaders.get('Authorization')).toBe('Bearer fresh-access-token');
  });

  it('retries ambiguous GET transport failures but never replays an ambiguous POST', async () => {
    const getSuccess = new Response(new Uint8Array([4, 5, 6]));
    const getFetch = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('synthetic network reset'))
      .mockRejectedValueOnce(new TypeError('synthetic network reset'))
      .mockResolvedValueOnce(getSuccess);
    const client = new HttpClient({
      baseUrl: 'https://api.example.test',
      contextManager: new ContextManager(),
    });

    const result = await client.requestFunctionRaw(
      'GET',
      '/api/functions/exports/archive',
    );
    expect(result).toBe(getSuccess);
    expect(getFetch).toHaveBeenCalledTimes(3);

    getFetch.mockReset();
    getFetch.mockRejectedValue(new TypeError('synthetic network reset'));
    await expect(client.requestFunctionRaw(
      'POST',
      '/api/functions/exports/archive',
      { pageId: 'page-synthetic' },
    )).rejects.toMatchObject({ status: 0, slug: 'network-error' });
    expect(getFetch).toHaveBeenCalledTimes(1);
  });

  it('never replays a single-use CAPTCHA token after a raw Function is rate-limited', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      message: 'Acquire a new synthetic token before retrying.',
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '1',
      },
    }));
    const client = new HttpClient({
      baseUrl: 'https://api.example.test',
      contextManager: new ContextManager(),
    });

    await expect(client.requestFunctionRaw(
      'POST',
      '/api/functions/protected-archive',
      { pageId: 'page-synthetic' },
      undefined,
      'single-use-synthetic-token',
    )).rejects.toMatchObject({ status: 429 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('hands off a successful stalled body unread while retaining the header deadline', async () => {
    const stalledBody = new ReadableStream<Uint8Array>({ start() { /* caller-owned stream */ } });
    const response = new Response(stalledBody, {
      status: 200,
      headers: { 'Content-Type': 'application/zip' },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const client = new HttpClient({
      baseUrl: 'https://api.example.test',
      contextManager: new ContextManager(),
    });

    const result = await client.requestFunctionRaw(
      'GET',
      '/api/functions/exports/archive',
      undefined,
      undefined,
      undefined,
      1_000,
    );

    expect(result).toBe(response);
    expect(result.bodyUsed).toBe(false);
  });

  it('returns the typed timeout error when response headers miss the deadline', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>(() => { /* headers never arrive */ }),
    );
    const client = new HttpClient({
      baseUrl: 'https://api.example.test',
      contextManager: new ContextManager(),
    });

    const outcome = client.requestFunctionRaw(
      'POST',
      '/api/functions/exports/archive',
      { pageId: 'page-synthetic' },
      undefined,
      undefined,
      1_000,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(outcome).resolves.toMatchObject({
      status: 0,
      slug: 'request-timeout',
      message: expect.stringContaining('confirm its state before retrying'),
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('HttpClient storage raw-response control', () => {
  it('keeps the existing storage download Response exact and unread', async () => {
    const response = new Response(new Uint8Array([10, 11, 12]), {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const client = new HttpClient({
      baseUrl: 'https://api.example.test',
      serviceKey: 'synthetic-service-key',
      contextManager: new ContextManager(),
    });

    const result = await client.getRaw('/api/storage/uploads/synthetic.bin');

    expect(result).toBe(response);
    expect(result.bodyUsed).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const headers = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers);
    expect(headers.get('X-EdgeBase-Service-Key')).toBe('synthetic-service-key');
  });
});
