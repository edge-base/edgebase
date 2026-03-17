/**
 * EmailProvider — Adapter pattern for external email services
 *
 * Workers cannot use SMTP directly. Instead, we use HTTP REST API-based
 * external email services via a common interface.
 *
 * Supported: Resend (default), SendGrid, Mailgun, AWS SES
 */

// ─── Interface ───

export interface EmailSendOptions {
  to: string;
  subject: string;
  html: string;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
}

export interface EmailProvider {
  send(options: EmailSendOptions): Promise<EmailSendResult>;
}

interface EmailProviderEnv {
  EDGEBASE_EMAIL_API_URL?: string;
}

const encoder = new TextEncoder();

function toUint8Array(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function toHex(value: ArrayBuffer | Uint8Array): string {
  return Array.from(toUint8Array(value))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return toHex(digest);
}

async function hmacSha256(
  key: string | Uint8Array,
  value: string,
): Promise<Uint8Array> {
  const keyData = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyData),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value));
  return new Uint8Array(signature);
}

type SESCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

function parseSesCredentials(apiKey: string): SESCredentials | null {
  const [accessKeyId, secretAccessKey, ...rest] = apiKey.split(':');
  if (!accessKeyId || !secretAccessKey) {
    return null;
  }
  const sessionToken = rest.length > 0 ? rest.join(':') : undefined;
  return { accessKeyId, secretAccessKey, sessionToken };
}

// ─── Resend Provider (Recommended, 3,000/month free) ───

export class ResendProvider implements EmailProvider {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: options.to,
        subject: options.subject,
        html: options.html,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('[EmailProvider:Resend] Failed:', resp.status, text);
      return { success: false };
    }

    const data = (await resp.json()) as { id?: string };
    return { success: true, messageId: data.id };
  }
}

export class MockEmailProvider implements EmailProvider {
  private endpoint: string;

  constructor(
    endpoint: string,
    private from: string,
  ) {
    this.endpoint = endpoint.replace(/\/$/, '');
  }

  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    const resp = await fetch(`${this.endpoint}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: options.to,
        subject: options.subject,
        html: options.html,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('[EmailProvider:Mock] Failed:', resp.status, text);
      return { success: false };
    }

    const data = await resp.json().catch(() => ({})) as { id?: string; messageId?: string };
    return { success: true, messageId: data.messageId ?? data.id };
  }
}

// ─── SendGrid Provider (100/day free) ───

export class SendGridProvider implements EmailProvider {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: options.to }] }],
        from: { email: this.from },
        subject: options.subject,
        content: [{ type: 'text/html', value: options.html }],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('[EmailProvider:SendGrid] Failed:', resp.status, text);
      return { success: false };
    }

    // SendGrid returns 202 with x-message-id header
    return {
      success: true,
      messageId: resp.headers.get('x-message-id') ?? undefined,
    };
  }
}

// ─── Mailgun Provider (1,000/month free for 3 months) ───

export class MailgunProvider implements EmailProvider {
  private domain: string;

  constructor(
    private apiKey: string,
    private from: string,
    domain?: string,
  ) {
    // Extract domain from "from" address if not explicitly provided
    this.domain = domain ?? from.split('@')[1] ?? 'example.com';
  }

  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    const formData = new FormData();
    formData.append('from', this.from);
    formData.append('to', options.to);
    formData.append('subject', options.subject);
    formData.append('html', options.html);

    const resp = await fetch(
      `https://api.mailgun.net/v3/${this.domain}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`api:${this.apiKey}`)}`,
        },
        body: formData,
      },
    );

    if (!resp.ok) {
      const text = await resp.text();
      console.error('[EmailProvider:Mailgun] Failed:', resp.status, text);
      return { success: false };
    }

    const data = (await resp.json()) as { id?: string };
    return { success: true, messageId: data.id };
  }
}

// ─── AWS SES Provider ($0.10/1,000 emails) ───

export class SESProvider implements EmailProvider {
  constructor(
    private apiKey: string,
    private from: string,
    private region: string = 'us-east-1',
  ) {}

  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    const credentials = parseSesCredentials(this.apiKey);
    if (!credentials) {
      console.error(
        '[EmailProvider:SES] Invalid apiKey format. Expected accessKeyId:secretAccessKey[:sessionToken].',
      );
      return { success: false };
    }

    const host = `email.${this.region}.amazonaws.com`;
    const path = '/v2/email/outbound-emails';
    const endpoint = `https://${host}${path}`;
    const payload = JSON.stringify({
      FromEmailAddress: this.from,
      Destination: { ToAddresses: [options.to] },
      Content: {
        Simple: {
          Subject: { Data: options.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: options.html, Charset: 'UTF-8' },
          },
        },
      },
    });

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = await sha256Hex(payload);
    const credentialScope = `${dateStamp}/${this.region}/ses/aws4_request`;
    const canonicalHeadersEntries = [
      ['host', host],
      ['x-amz-content-sha256', payloadHash],
      ['x-amz-date', amzDate],
      ...(credentials.sessionToken
        ? [['x-amz-security-token', credentials.sessionToken] as const]
        : []),
    ];
    const canonicalHeaders = canonicalHeadersEntries
      .map(([name, value]) => `${name}:${value}\n`)
      .join('');
    const signedHeaders = canonicalHeadersEntries.map(([name]) => name).join(';');
    const canonicalRequest = [
      'POST',
      path,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      await sha256Hex(canonicalRequest),
    ].join('\n');

    const dateKey = await hmacSha256(`AWS4${credentials.secretAccessKey}`, dateStamp);
    const regionKey = await hmacSha256(dateKey, this.region);
    const serviceKey = await hmacSha256(regionKey, 'ses');
    const signingKey = await hmacSha256(serviceKey, 'aws4_request');
    const signature = toHex(await hmacSha256(signingKey, stringToSign));
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Host: host,
      'X-Amz-Date': amzDate,
      'X-Amz-Content-Sha256': payloadHash,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, `
        + `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };

    if (credentials.sessionToken) {
      headers['X-Amz-Security-Token'] = credentials.sessionToken;
    }

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: payload,
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('[EmailProvider:SES] Failed:', resp.status, text);
      return { success: false };
    }

    const data = (await resp.json()) as { MessageId?: string };
    return { success: true, messageId: data.MessageId };
  }
}

// ─── Factory ───

export interface EmailConfig {
  provider: 'resend' | 'sendgrid' | 'mailgun' | 'ses';
  apiKey: string;    // SES uses accessKeyId:secretAccessKey[:sessionToken]
  from: string;
  domain?: string;    // Mailgun domain
  region?: string;    // SES region
}

/**
 * Create an EmailProvider instance from config.
 * Returns null if config is missing (email features disabled).
 */
export function createEmailProvider(
  config?: EmailConfig,
  env?: EmailProviderEnv,
): EmailProvider | null {
  const mockEndpoint = env?.EDGEBASE_EMAIL_API_URL?.trim()?.replace(/\/$/, '');
  if (mockEndpoint) {
    return new MockEmailProvider(mockEndpoint, config?.from ?? 'noreply@example.com');
  }

  if (!config) {
    return null;
  }

  if (!config.apiKey || !config.from) {
    console.warn('[EmailProvider] apiKey and from are required. Email features disabled.');
    return null;
  }

  switch (config.provider) {
    case 'resend':
      return new ResendProvider(config.apiKey, config.from);
    case 'sendgrid':
      return new SendGridProvider(config.apiKey, config.from);
    case 'mailgun':
      return new MailgunProvider(config.apiKey, config.from, config.domain);
    case 'ses':
      return new SESProvider(config.apiKey, config.from, config.region);
    default:
      console.warn(`[EmailProvider] Unknown provider: ${config.provider}. Email features disabled.`);
      return null;
  }
}
