import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSmsProvider,
  TwilioProvider,
  MessageBirdProvider,
  VonageProvider,
  MockSmsProvider,
} from '../lib/sms-provider.js';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(response: Response | (() => Response | Promise<Response>)) {
  const fetchMock = vi.fn(async (
    _input: unknown,
    _init: { method: string; headers: Record<string, string>; body: string },
  ) =>
    typeof response === 'function' ? await response() : response,
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  it('prefers the mock endpoint over configured provider when env url is set', () => {
    const provider = createSmsProvider(
      { provider: 'twilio', accountSid: 'AC', authToken: 'tok', from: '+100' },
      { EDGEBASE_SMS_API_URL: 'https://mock.example/sms/' },
    );
    expect(provider).toBeInstanceOf(MockSmsProvider);
  });

  it('ignores a whitespace-only mock endpoint', () => {
    const provider = createSmsProvider(
      { provider: 'twilio', accountSid: 'AC', authToken: 'tok', from: '+100' },
      { EDGEBASE_SMS_API_URL: '   ' },
    );
    expect(provider).toBeInstanceOf(TwilioProvider);
  });

  it('returns null when no config and no env are provided', () => {
    expect(createSmsProvider()).toBeNull();
    expect(createSmsProvider(undefined, {})).toBeNull();
  });

  it('selects TwilioProvider for a valid twilio config', () => {
    const provider = createSmsProvider({
      provider: 'twilio',
      accountSid: 'AC123',
      authToken: 'secret',
      from: '+100',
    });
    expect(provider).toBeInstanceOf(TwilioProvider);
  });

  it('returns null when twilio config is missing credentials', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      createSmsProvider({ provider: 'twilio', authToken: 'tok', from: '+100' }),
    ).toBeNull();
    expect(
      createSmsProvider({ provider: 'twilio', accountSid: 'AC', from: '+100' }),
    ).toBeNull();
  });

  it('selects MessageBirdProvider for a valid messagebird config', () => {
    const provider = createSmsProvider({
      provider: 'messagebird',
      apiKey: 'key',
      from: '+100',
    });
    expect(provider).toBeInstanceOf(MessageBirdProvider);
  });

  it('returns null when messagebird config is missing apiKey', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      createSmsProvider({ provider: 'messagebird', from: '+100' }),
    ).toBeNull();
  });

  it('selects VonageProvider for a valid vonage config', () => {
    const provider = createSmsProvider({
      provider: 'vonage',
      apiKey: 'key',
      apiSecret: 'secret',
      from: '+100',
    });
    expect(provider).toBeInstanceOf(VonageProvider);
  });

  it('returns null when vonage config is missing credentials', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      createSmsProvider({ provider: 'vonage', apiKey: 'key', from: '+100' }),
    ).toBeNull();
    expect(
      createSmsProvider({ provider: 'vonage', apiSecret: 'secret', from: '+100' }),
    ).toBeNull();
  });

  it('returns null for an unknown provider', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = createSmsProvider({
      // deliberately invalid provider value
      provider: 'nexmo' as never,
      from: '+100',
    });
    expect(provider).toBeNull();
  });
});

describe('TwilioProvider', () => {
  it('posts to the account messages endpoint and returns the sid on success', async () => {
    const fetchMock = stubFetch(jsonResponse({ sid: 'SM123' }));
    const provider = new TwilioProvider('AC1', 'auth-token', '+1555');

    const result = await provider.send({ to: '+1444', body: 'hello' });

    expect(result).toEqual({ success: true, messageId: 'SM123' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Basic ${btoa('AC1:auth-token')}`);
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(init.body as string);
    expect(params.get('To')).toBe('+1444');
    expect(params.get('From')).toBe('+1555');
    expect(params.get('Body')).toBe('hello');
  });

  it('returns failure when Twilio responds with a non-ok status', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(new Response('bad request', { status: 400 }));
    const provider = new TwilioProvider('AC1', 'auth-token', '+1555');

    const result = await provider.send({ to: '+1444', body: 'hello' });
    expect(result).toEqual({ success: false });
  });
});

describe('MessageBirdProvider', () => {
  it('posts to the messagebird endpoint and returns the id on success', async () => {
    const fetchMock = stubFetch(jsonResponse({ id: 'mb-42' }));
    const provider = new MessageBirdProvider('mb-key', '+1555');

    const result = await provider.send({ to: '+1444', body: 'hi there' });

    expect(result).toEqual({ success: true, messageId: 'mb-42' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://rest.messagebird.com/messages');
    expect(init.headers.Authorization).toBe('AccessKey mb-key');
    const payload = JSON.parse(init.body as string);
    expect(payload).toEqual({
      originator: '+1555',
      recipients: ['+1444'],
      body: 'hi there',
    });
  });

  it('returns failure when MessageBird responds with a non-ok status', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(new Response('unauthorized', { status: 401 }));
    const provider = new MessageBirdProvider('mb-key', '+1555');

    expect(await provider.send({ to: '+1444', body: 'hi' })).toEqual({
      success: false,
    });
  });
});

describe('VonageProvider', () => {
  it('posts to the nexmo endpoint and returns the message-id on success', async () => {
    const fetchMock = stubFetch(
      jsonResponse({ messages: [{ status: '0', 'message-id': 'vn-7' }] }),
    );
    const provider = new VonageProvider('vk', 'vs', 'EdgeBase');

    const result = await provider.send({ to: '+1444', body: 'yo' });

    expect(result).toEqual({ success: true, messageId: 'vn-7' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://rest.nexmo.com/sms/json');
    const payload = JSON.parse(init.body as string);
    expect(payload).toEqual({
      api_key: 'vk',
      api_secret: 'vs',
      from: 'EdgeBase',
      to: '+1444',
      text: 'yo',
    });
  });

  it('returns failure when the first message status is not "0"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(
      jsonResponse({ messages: [{ status: '4', 'message-id': 'vn-8' }] }),
    );
    const provider = new VonageProvider('vk', 'vs', 'EdgeBase');

    expect(await provider.send({ to: '+1444', body: 'yo' })).toEqual({
      success: false,
    });
  });

  it('returns failure when Vonage responds with a non-ok status', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(new Response('server error', { status: 500 }));
    const provider = new VonageProvider('vk', 'vs', 'EdgeBase');

    expect(await provider.send({ to: '+1444', body: 'yo' })).toEqual({
      success: false,
    });
  });
});

describe('MockSmsProvider', () => {
  it('strips a trailing slash from the endpoint and falls back to sid', async () => {
    const fetchMock = stubFetch(jsonResponse({ sid: 'mock-sid' }));
    const provider = new MockSmsProvider('https://mock.example/sms/', '+1555');

    const result = await provider.send({ to: '+1444', body: 'hi' });

    expect(result).toEqual({ success: true, messageId: 'mock-sid' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://mock.example/sms/send');
  });

  it('prefers messageId over sid in the response', async () => {
    stubFetch(jsonResponse({ messageId: 'mid-1', sid: 'sid-1' }));
    const provider = new MockSmsProvider('https://mock.example/sms', '+1555');

    expect(await provider.send({ to: '+1444', body: 'hi' })).toEqual({
      success: true,
      messageId: 'mid-1',
    });
  });

  it('treats a non-json success body as an empty result', async () => {
    stubFetch(new Response('not-json', { status: 200 }));
    const provider = new MockSmsProvider('https://mock.example/sms', '+1555');

    expect(await provider.send({ to: '+1444', body: 'hi' })).toEqual({
      success: true,
      messageId: undefined,
    });
  });

  it('returns failure when the mock endpoint responds with a non-ok status', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(new Response('nope', { status: 502 }));
    const provider = new MockSmsProvider('https://mock.example/sms', '+1555');

    expect(await provider.send({ to: '+1444', body: 'hi' })).toEqual({
      success: false,
    });
  });
});
