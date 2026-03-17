import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSmsProvider } from '../lib/sms-provider.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createSmsProvider', () => {
  it('returns a mock sms provider when EDGEBASE_SMS_API_URL is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sid: 'mock-sid-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createSmsProvider(undefined, {
      EDGEBASE_SMS_API_URL: 'https://mock.example/sms',
    });
    expect(provider).not.toBeNull();

    const result = await provider!.send({
      to: '+821012341234',
      body: 'Your code is: 123456',
    });

    expect(result).toEqual({ success: true, messageId: 'mock-sid-1' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mock.example/sms/send',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});
