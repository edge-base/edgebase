import { afterEach, describe, expect, it, vi } from 'vitest';
import {
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
});
