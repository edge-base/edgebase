/**
 * Tests for fetchWithTimeout utility (fetch-with-timeout.ts).
 * Covers: successful passthrough, init forwarding, timeout error,
 * non-abort error passthrough, default timeout / signal passing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithTimeout } from '../src/lib/fetch-with-timeout.js';

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchWithTimeout', () => {
  it('passes through a successful response', async () => {
    const mockResponse = new Response('hello', { status: 200 });
    fetchSpy.mockResolvedValue(mockResponse);

    const result = await fetchWithTimeout('https://example.com/api');

    expect(result).toBe(mockResponse);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('forwards init options (headers, method) to fetch', async () => {
    fetchSpy.mockResolvedValue(new Response('ok'));

    await fetchWithTimeout('https://example.com/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'value' }),
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://example.com/api');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'value' }),
    });
    // signal should also be present
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws a descriptive timeout error when the request hangs', async () => {
    // Mock fetch to respect the abort signal, just like real fetch would
    fetchSpy.mockImplementation((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }
      });
    });

    await expect(
      fetchWithTimeout('https://slow.example.com/data', undefined, 50),
    ).rejects.toThrow(/Request timed out after 0s: https:\/\/slow\.example\.com\/data/);
  });

  it('passes through non-abort errors unchanged', async () => {
    const networkError = new TypeError('Failed to fetch');
    fetchSpy.mockRejectedValue(networkError);

    await expect(
      fetchWithTimeout('https://down.example.com'),
    ).rejects.toThrow(networkError);
  });

  it('passes an AbortSignal to fetch (default 30s timeout)', async () => {
    fetchSpy.mockResolvedValue(new Response('ok'));

    await fetchWithTimeout('https://example.com');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    expect(init).toBeDefined();
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });
});
