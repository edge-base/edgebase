import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextManager } from '../../src/context.js';
import { FunctionsClient } from '../../src/functions.js';
import { HttpClient } from '../../src/http.js';
import type { ITokenManager } from '../../src/types.js';

function createFunctionsClient(): FunctionsClient {
  return new FunctionsClient(new HttpClient({
    baseUrl: 'https://api.example.test',
    contextManager: new ContextManager(),
  }));
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('FunctionsClient caller AbortSignal', () => {
  it.each(['call', 'callRaw'] as const)(
    'rejects an already-aborted %s before auth or network I/O',
    async (operation) => {
      const reason = new DOMException('Synthetic request was superseded.', 'AbortError');
      const controller = new AbortController();
      controller.abort(reason);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{"ok":true}', {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const functions = createFunctionsClient();

      const outcome = operation === 'call'
        ? functions.call('search', { method: 'GET', signal: controller.signal })
        : functions.callRaw('search', { method: 'GET', signal: controller.signal });

      await expect(outcome).rejects.toBe(reason);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('preserves caller abort identity while response headers are in flight', async () => {
    const reason = new DOMException('Synthetic header wait was superseded.', 'AbortError');
    const controller = new AbortController();
    let releaseFetch: (() => void) | undefined;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => (
      new Promise<Response>((resolve, reject) => {
        const requestSignal = init?.signal;
        requestSignal?.addEventListener('abort', () => reject(requestSignal.reason), { once: true });
        releaseFetch = () => resolve(new Response('{"ok":true}', {
          headers: { 'Content-Type': 'application/json' },
        }));
      })
    ));
    const functions = createFunctionsClient();
    const outcome = functions.call('search', {
      method: 'GET',
      signal: controller.signal,
    }).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );

    await flushAsyncWork();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    controller.abort(reason);
    releaseFetch?.();

    await expect(outcome).resolves.toEqual({ status: 'rejected', error: reason });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('stops an authentication preflight before it can issue the Function fetch', async () => {
    const reason = new DOMException('Synthetic auth wait was superseded.', 'AbortError');
    const controller = new AbortController();
    let releaseAccessToken: ((value: string | null) => void) | undefined;
    const accessToken = new Promise<string | null>((resolve) => {
      releaseAccessToken = resolve;
    });
    const tokenManager: ITokenManager = {
      getAccessToken: vi.fn(() => accessToken),
      getRefreshToken: vi.fn(() => null),
      setTokens: vi.fn(),
      clearTokens: vi.fn(),
      invalidateAccessToken: vi.fn(),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const functions = new FunctionsClient(new HttpClient({
      baseUrl: 'https://api.example.test',
      contextManager: new ContextManager(),
      tokenManager,
    }));
    const outcome = functions.call('search', {
      method: 'GET',
      signal: controller.signal,
    }).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );

    await flushAsyncWork();
    expect(tokenManager.getAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    controller.abort(reason);

    await expect(outcome).resolves.toEqual({ status: 'rejected', error: reason });
    expect(fetchSpy).not.toHaveBeenCalled();
    releaseAccessToken?.(null);
  });

  it('cancels a 401 refresh wait before any authenticated retry fetch', async () => {
    const reason = new DOMException('Synthetic refresh wait was superseded.', 'AbortError');
    const controller = new AbortController();
    let authCalls = 0;
    let releaseRefresh: ((value: string | null) => void) | undefined;
    const refresh = new Promise<string | null>((resolve) => {
      releaseRefresh = resolve;
    });
    const tokenManager: ITokenManager = {
      getAccessToken: vi.fn(() => {
        authCalls += 1;
        return authCalls === 1 ? 'stale-access-token' : refresh;
      }),
      getRefreshToken: vi.fn(() => 'synthetic-refresh-token'),
      setTokens: vi.fn(),
      clearTokens: vi.fn(),
      invalidateAccessToken: vi.fn(),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"message":"Unauthorized."}', {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const functions = new FunctionsClient(new HttpClient({
      baseUrl: 'https://api.example.test',
      contextManager: new ContextManager(),
      tokenManager,
    }));
    const outcome = functions.call('search', {
      method: 'GET',
      signal: controller.signal,
    }).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );

    await vi.waitFor(() => expect(tokenManager.getAccessToken).toHaveBeenCalledTimes(2));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(tokenManager.invalidateAccessToken).toHaveBeenCalledTimes(1);
    controller.abort(reason);

    await expect(outcome).resolves.toEqual({ status: 'rejected', error: reason });
    releaseRefresh?.('fresh-access-token');
    await flushAsyncWork();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('preserves caller abort identity while the JSON response body is in flight', async () => {
    const reason = new DOMException('Synthetic body read was superseded.', 'AbortError');
    const controller = new AbortController();
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let requestObservedCallerAbort = false;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      const requestSignal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          bodyController = streamController;
          requestSignal?.addEventListener('abort', () => {
            requestObservedCallerAbort = true;
            streamController.error(requestSignal.reason);
          }, { once: true });
        },
      });
      return Promise.resolve(new Response(body, {
        headers: { 'Content-Type': 'application/json' },
      }));
    });
    const functions = createFunctionsClient();
    const outcome = functions.call('search', {
      method: 'GET',
      signal: controller.signal,
    }).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );

    await flushAsyncWork();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    controller.abort(reason);
    if (!requestObservedCallerAbort) {
      bodyController?.error(new Error('Synthetic control release: request signal was absent.'));
    }

    await expect(outcome).resolves.toEqual({ status: 'rejected', error: reason });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps a raw response body bound to the caller signal after header handoff', async () => {
    const reason = new DOMException('Synthetic raw body was superseded.', 'AbortError');
    const controller = new AbortController();
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let requestObservedCallerAbort = false;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      const requestSignal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          bodyController = streamController;
          requestSignal?.addEventListener('abort', () => {
            requestObservedCallerAbort = true;
            streamController.error(requestSignal.reason);
          }, { once: true });
        },
      });
      return Promise.resolve(new Response(body, {
        headers: { 'Content-Type': 'application/octet-stream' },
      }));
    });
    const functions = createFunctionsClient();

    const response = await functions.callRaw('archive', {
      method: 'GET',
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    const bodyOutcome = response.arrayBuffer().then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );
    controller.abort(reason);
    if (!requestObservedCallerAbort) {
      bodyController?.error(new Error('Synthetic control release: raw signal was detached.'));
    }

    await expect(bodyOutcome).resolves.toEqual({ status: 'rejected', error: reason });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('cancels a 429 backoff without issuing another fetch', async () => {
    vi.useFakeTimers();
    const reason = new DOMException('Synthetic retry wait was superseded.', 'AbortError');
    const controller = new AbortController();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"message":"Synthetic rate limit."}', {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '10',
        },
      }),
    );
    const functions = createFunctionsClient();
    const outcome = functions.call('search', {
      method: 'GET',
      signal: controller.signal,
    }).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(40_000);

    await expect(outcome).resolves.toEqual({ status: 'rejected', error: reason });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retains the typed request timeout when the caller signal does not abort', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>(() => { /* response headers never arrive */ }),
    );
    const functions = createFunctionsClient();
    const outcome = functions.call('slow-mutation', {
      method: 'POST',
      body: { value: 'synthetic' },
      signal: controller.signal,
      timeoutMs: 1_000,
    }).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(outcome).resolves.toMatchObject({
      status: 'rejected',
      error: {
        status: 0,
        slug: 'request-timeout',
        message: expect.stringContaining('confirm its state before retrying'),
      },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
