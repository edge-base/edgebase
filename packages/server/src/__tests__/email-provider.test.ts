import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CloudflareEmailProvider,
  MailgunProvider,
  MockEmailProvider,
  ResendProvider,
  SESProvider,
  SendGridProvider,
  createEmailProvider,
} from '../lib/email-provider.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createEmailProvider', () => {
  it('returns null when config is missing', () => {
    expect(createEmailProvider()).toBeNull();
  });

  it('returns null when apiKey or from is missing', () => {
    expect(
      createEmailProvider({ provider: 'sendgrid', apiKey: '', from: 'noreply@example.com' }),
    ).toBeNull();
    expect(
      createEmailProvider({ provider: 'sendgrid', apiKey: 'SG.key', from: '' }),
    ).toBeNull();
  });

  it('returns a mock email provider when EDGEBASE_EMAIL_API_URL is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messageId: 'mock-mail-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmailProvider(undefined, {
      EDGEBASE_EMAIL_API_URL: 'https://mock.example/email',
    });
    expect(provider).not.toBeNull();

    const result = await provider!.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: true, messageId: 'mock-mail-1' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mock.example/email/send',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});

describe('SendGridProvider', () => {
  it('returns x-message-id header on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 202,
        headers: { 'x-message-id': 'sg-message-1' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SendGridProvider('SG.key', 'noreply@example.com');
    const result = await provider.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: true, messageId: 'sg-message-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('CloudflareEmailProvider', () => {
  it('uses the Workers send_email binding when available', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'cf-binding-1' });

    const provider = createEmailProvider(
      { provider: 'cloudflare', from: 'noreply@example.com' },
      { EMAIL: { send } },
    );
    expect(provider).not.toBeNull();

    const result = await provider!.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: true, messageId: 'cf-binding-1' });
    expect(send).toHaveBeenCalledWith({
      to: 'user@example.com',
      from: 'noreply@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });
  });

  it('sends through the Cloudflare Email Service REST API when no binding exists', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        errors: [],
        messages: [],
        result: { delivered: ['user@example.com'], permanent_bounces: [], queued: [] },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new CloudflareEmailProvider({
      from: 'noreply@example.com',
      accountId: 'acct-1',
      apiKey: 'cf-token',
    });
    const result = await provider.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/acct-1/email/sending/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer cf-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('fails without REST credentials when no Workers binding exists', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmailProvider({ provider: 'cloudflare', from: 'noreply@example.com' });
    expect(provider).not.toBeNull();

    const result = await provider!.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('SESProvider', () => {
  it('signs the outbound request with AWS SigV4 headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ MessageId: 'ses-message-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SESProvider(
      'AKIAEXAMPLE:wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      'noreply@example.com',
      'us-east-1',
    );
    const result = await provider.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: true, messageId: 'ses-message-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://email.us-east-1.amazonaws.com/v2/email/outbound-emails');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(headers.get('x-amz-content-sha256')).toMatch(/^[a-f0-9]{64}$/);
    expect(headers.get('x-amz-date')).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers.get('host')).toBe('email.us-east-1.amazonaws.com');
  });

  it('fails fast when the SES apiKey format is invalid', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SESProvider('not-a-valid-key', 'noreply@example.com', 'us-east-1');
    const result = await provider.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports failure and does not throw when SES responds non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('AccessDenied', { status: 403 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SESProvider(
      'AKIAEXAMPLE:secret-key',
      'noreply@example.com',
      'eu-west-1',
    );
    const result = await provider.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails');
  });

  it('includes the session token header for temporary credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ MessageId: 'ses-message-2' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SESProvider(
      'AKIAEXAMPLE:secret-key:session-token-value',
      'noreply@example.com',
    );
    const result = await provider.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: true, messageId: 'ses-message-2' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('x-amz-security-token')).toBe('session-token-value');
    expect(headers.get('authorization')).toContain('x-amz-security-token');
  });
});

describe('ResendProvider', () => {
  it('advertises and forwards one stable provider idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'resend-stable-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new ResendProvider('re_key', 'noreply@example.com');
    expect((provider as unknown as { supportsIdempotency?: boolean }).supportsIdempotency).toBe(true);
    const message = {
      to: 'user@example.com',
      subject: 'Stable delivery',
      html: '<p>hello</p>',
      idempotencyKey: 'database-automation-delivery-synthetic',
    };
    await expect(provider.send(message)).resolves.toEqual({
      success: true,
      messageId: 'resend-stable-1',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('idempotency-key')).toBe(
      'database-automation-delivery-synthetic',
    );
  });

  it('posts to the Resend API and returns the message id on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'resend-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new ResendProvider('re_key', 'noreply@example.com');
    const result = await provider.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: true, messageId: 'resend-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer re_key');
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'noreply@example.com',
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });
  });

  it('returns failure without throwing when Resend responds non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new ResendProvider('bad_key', 'noreply@example.com');
    const result = await provider.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: false });
  });
});

describe('MailgunProvider', () => {
  it('derives the domain from the from address and sends multipart form data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: '<mailgun-1@mg.example.com>' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new MailgunProvider('mg-key', 'noreply@mg.example.com');
    const result = await provider.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: true, messageId: '<mailgun-1@mg.example.com>' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.mailgun.net/v3/mg.example.com/messages');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(`Basic ${btoa('api:mg-key')}`);
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get('from')).toBe('noreply@mg.example.com');
    expect(form.get('to')).toBe('user@example.com');
    expect(form.get('subject')).toBe('Hello');
    expect(form.get('html')).toBe('<p>hello</p>');
  });

  it('prefers an explicitly provided domain over the from address domain', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'mailgun-2' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new MailgunProvider('mg-key', 'noreply@example.com', 'sending.example.org');
    await provider.send({ to: 'user@example.com', subject: 'Hello', html: '<p>hi</p>' });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.mailgun.net/v3/sending.example.org/messages');
  });

  it('returns failure without throwing when Mailgun responds non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Forbidden', { status: 403 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new MailgunProvider('mg-key', 'noreply@mg.example.com');
    const result = await provider.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: false });
  });
});

describe('SendGridProvider failure path', () => {
  it('returns failure without throwing when SendGrid responds non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Bad Request', { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SendGridProvider('SG.key', 'noreply@example.com');
    const result = await provider.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: false });
  });

  it('omits messageId when the x-message-id header is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SendGridProvider('SG.key', 'noreply@example.com');
    const result = await provider.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: true, messageId: undefined });
  });
});

describe('MockEmailProvider', () => {
  it('advertises and forwards one stable provider idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ messageId: 'mock-stable-1' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new MockEmailProvider('https://mock.example/email', 'noreply@example.com');
    expect((provider as unknown as { supportsIdempotency?: boolean }).supportsIdempotency).toBe(true);
    const message = {
      to: 'user@example.com',
      subject: 'Stable delivery',
      html: '<p>hello</p>',
      idempotencyKey: 'database-automation-delivery-synthetic',
    };
    await provider.send(message);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('idempotency-key')).toBe(
      'database-automation-delivery-synthetic',
    );
  });

  it('normalizes a trailing slash in the endpoint and returns failure on non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('nope', { status: 500 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new MockEmailProvider('https://mock.example/email/', 'noreply@example.com');
    const result = await provider.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: false });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://mock.example/email/send',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('falls back to an empty body when the mock response is not JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('not json', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new MockEmailProvider('https://mock.example/email', 'noreply@example.com');
    const result = await provider.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: true, messageId: undefined });
  });
});

describe('CloudflareEmailProvider failure paths', () => {
  it('returns failure when the Workers binding throws', async () => {
    const send = vi.fn().mockRejectedValue(new Error('binding boom'));
    const provider = new CloudflareEmailProvider({ from: 'noreply@example.com', binding: { send } });

    const result = await provider.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: false });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('returns failure when the REST API responds non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('boom', { status: 500 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new CloudflareEmailProvider({
      from: 'noreply@example.com',
      accountId: 'acct-1',
      apiKey: 'cf-token',
    });
    const result = await provider.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hello</p>',
    });

    expect(result).toEqual({ success: false });
  });

  it('honours a custom apiBaseUrl and encodes the account id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new CloudflareEmailProvider({
      from: 'noreply@example.com',
      accountId: 'acct/with space',
      apiKey: 'cf-token',
      apiBaseUrl: 'https://gateway.example.com/v4/',
    });
    await provider.send({ to: 'user@example.com', subject: 'Hello', html: '<p>hi</p>' });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://gateway.example.com/v4/accounts/${encodeURIComponent('acct/with space')}/email/sending/send`,
    );
  });
});

describe('createEmailProvider provider selection', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  });

  it('constructs a ResendProvider for the resend provider', () => {
    const provider = createEmailProvider({
      provider: 'resend',
      apiKey: 're_key',
      from: 'noreply@example.com',
    });
    expect(provider).toBeInstanceOf(ResendProvider);
  });

  it('constructs a SendGridProvider for the sendgrid provider', () => {
    const provider = createEmailProvider({
      provider: 'sendgrid',
      apiKey: 'SG.key',
      from: 'noreply@example.com',
    });
    expect(provider).toBeInstanceOf(SendGridProvider);
  });

  it('constructs a MailgunProvider for the mailgun provider', () => {
    const provider = createEmailProvider({
      provider: 'mailgun',
      apiKey: 'mg-key',
      from: 'noreply@mg.example.com',
    });
    expect(provider).toBeInstanceOf(MailgunProvider);
  });

  it('constructs a SESProvider for the ses provider', () => {
    const provider = createEmailProvider({
      provider: 'ses',
      apiKey: 'AKIA:secret',
      from: 'noreply@example.com',
      region: 'us-west-2',
    });
    expect(provider).toBeInstanceOf(SESProvider);
  });

  it('constructs a CloudflareEmailProvider even without an apiKey', () => {
    const provider = createEmailProvider({ provider: 'cloudflare', from: 'noreply@example.com' });
    expect(provider).toBeInstanceOf(CloudflareEmailProvider);
  });

  it('does not advertise guaranteed idempotency for unsupported providers', () => {
    const providers = [
      createEmailProvider({ provider: 'sendgrid', apiKey: 'SG.key', from: 'noreply@example.com' }),
      createEmailProvider({ provider: 'mailgun', apiKey: 'mg-key', from: 'noreply@example.com' }),
      createEmailProvider({ provider: 'ses', apiKey: 'AKIA:secret', from: 'noreply@example.com' }),
      createEmailProvider({ provider: 'cloudflare', from: 'noreply@example.com' }),
    ];
    expect(providers.map((provider) => (
      (provider as unknown as { supportsIdempotency?: boolean })?.supportsIdempotency
    ))).toEqual([false, false, false, false]);
  });

  it('returns null for an unknown provider', () => {
    const provider = createEmailProvider({
      provider: 'unknown' as unknown as EmailProviderName,
      apiKey: 'key',
      from: 'noreply@example.com',
    });
    expect(provider).toBeNull();
  });

  it('returns null when a keyed provider is missing its apiKey', () => {
    expect(
      createEmailProvider({ provider: 'resend', from: 'noreply@example.com' }),
    ).toBeNull();
    expect(
      createEmailProvider({ provider: 'mailgun', from: 'noreply@example.com' }),
    ).toBeNull();
    expect(
      createEmailProvider({ provider: 'ses', from: 'noreply@example.com' }),
    ).toBeNull();
  });

  it('resolves the Cloudflare binding by a custom name from config', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'cf-custom-binding' });
    const provider = createEmailProvider(
      { provider: 'cloudflare', from: 'noreply@example.com', binding: 'MY_EMAIL' },
      { MY_EMAIL: { send } } as unknown as Record<string, unknown>,
    );
    expect(provider).toBeInstanceOf(CloudflareEmailProvider);

    const result = await provider!.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hi</p>',
    });
    expect(result).toEqual({ success: true, messageId: 'cf-custom-binding' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('resolves the Cloudflare binding name from the environment', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'cf-env-binding' });
    const provider = createEmailProvider(
      { provider: 'cloudflare', from: 'noreply@example.com' },
      {
        EDGEBASE_EMAIL_CLOUDFLARE_BINDING: 'ENV_EMAIL',
        ENV_EMAIL: { send },
      } as unknown as Record<string, unknown>,
    );
    const result = await provider!.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hi</p>',
    });
    expect(result).toEqual({ success: true, messageId: 'cf-env-binding' });
  });

  it('falls back to Cloudflare REST credentials from the environment when no binding matches', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmailProvider(
      { provider: 'cloudflare', from: 'noreply@example.com' },
      {
        EDGEBASE_EMAIL_CLOUDFLARE_API_TOKEN: 'env-token',
        EDGEBASE_EMAIL_CLOUDFLARE_ACCOUNT_ID: 'env-acct',
      },
    );
    const result = await provider!.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>hi</p>',
    });

    expect(result).toEqual({ success: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/env-acct/email/sending/send');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer env-token');
  });

  it('prefers the mock provider even when a real provider config is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messageId: 'mock-over-real' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmailProvider(
      { provider: 'resend', apiKey: 're_key', from: 'noreply@example.com' },
      { EDGEBASE_EMAIL_API_URL: 'https://mock.example/email' },
    );
    expect(provider).toBeInstanceOf(MockEmailProvider);

    await provider!.send({ to: 'user@example.com', subject: 'Hi', html: '<p>hi</p>' });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://mock.example/email/send');
  });
});

type EmailProviderName = 'resend' | 'sendgrid' | 'mailgun' | 'ses' | 'cloudflare';
