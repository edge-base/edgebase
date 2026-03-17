/**
 * SmsProvider — Adapter pattern for external SMS services.
 *
 * Workers cannot use direct telephony. Instead, we use HTTP REST API-based
 * external SMS services via a common interface.
 *
 * Supported: Twilio (default), MessageBird, Vonage
 */

// ─── Interface ───

export interface SmsSendOptions {
  to: string;
  body: string;
}

export interface SmsSendResult {
  success: boolean;
  messageId?: string;
}

export interface SmsProvider {
  send(options: SmsSendOptions): Promise<SmsSendResult>;
}

interface SmsProviderEnv {
  EDGEBASE_SMS_API_URL?: string;
}

// ─── Twilio Provider ───

export class TwilioProvider implements SmsProvider {
  constructor(
    private accountSid: string,
    private authToken: string,
    private from: string,
  ) {}

  async send(options: SmsSendOptions): Promise<SmsSendResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;

    const body = new URLSearchParams();
    body.append('To', options.to);
    body.append('From', this.from);
    body.append('Body', options.body);

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${this.accountSid}:${this.authToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('[SmsProvider:Twilio] Failed:', resp.status, text);
      return { success: false };
    }

    const data = (await resp.json()) as { sid?: string };
    return { success: true, messageId: data.sid };
  }
}

export class MockSmsProvider implements SmsProvider {
  private endpoint: string;

  constructor(
    endpoint: string,
    private from: string,
  ) {
    this.endpoint = endpoint.replace(/\/$/, '');
  }

  async send(options: SmsSendOptions): Promise<SmsSendResult> {
    const resp = await fetch(`${this.endpoint}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: options.to,
        body: options.body,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('[SmsProvider:Mock] Failed:', resp.status, text);
      return { success: false };
    }

    const data = await resp.json().catch(() => ({})) as { sid?: string; messageId?: string };
    return { success: true, messageId: data.messageId ?? data.sid };
  }
}

// ─── MessageBird Provider ───

export class MessageBirdProvider implements SmsProvider {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async send(options: SmsSendOptions): Promise<SmsSendResult> {
    const resp = await fetch('https://rest.messagebird.com/messages', {
      method: 'POST',
      headers: {
        Authorization: `AccessKey ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        originator: this.from,
        recipients: [options.to],
        body: options.body,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('[SmsProvider:MessageBird] Failed:', resp.status, text);
      return { success: false };
    }

    const data = (await resp.json()) as { id?: string };
    return { success: true, messageId: data.id };
  }
}

// ─── Vonage Provider ───

export class VonageProvider implements SmsProvider {
  constructor(
    private apiKey: string,
    private apiSecret: string,
    private from: string,
  ) {}

  async send(options: SmsSendOptions): Promise<SmsSendResult> {
    const resp = await fetch('https://rest.nexmo.com/sms/json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: this.apiKey,
        api_secret: this.apiSecret,
        from: this.from,
        to: options.to,
        text: options.body,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('[SmsProvider:Vonage] Failed:', resp.status, text);
      return { success: false };
    }

    const data = (await resp.json()) as {
      messages?: Array<{ 'message-id'?: string; status?: string }>;
    };
    const msg = data.messages?.[0];
    if (msg?.status !== '0') {
      console.error('[SmsProvider:Vonage] Send failed:', msg);
      return { success: false };
    }
    return { success: true, messageId: msg['message-id'] };
  }
}

// ─── Factory ───

export interface SmsConfig {
  provider: 'twilio' | 'messagebird' | 'vonage';
  accountSid?: string;   // Twilio
  authToken?: string;    // Twilio
  apiKey?: string;       // MessageBird, Vonage
  apiSecret?: string;    // Vonage
  from: string;          // Sender phone number (E.164)
}

/**
 * Create an SmsProvider instance from config.
 * Returns null if config is missing (SMS features disabled).
 */
export function createSmsProvider(
  config?: SmsConfig,
  env?: SmsProviderEnv,
): SmsProvider | null {
  const mockEndpoint = env?.EDGEBASE_SMS_API_URL?.trim()?.replace(/\/$/, '');
  if (mockEndpoint) {
    return new MockSmsProvider(mockEndpoint, config?.from ?? 'mock');
  }

  if (!config) {
    return null;
  }

  switch (config.provider) {
    case 'twilio': {
      if (!config.accountSid || !config.authToken) {
        console.warn('[SmsProvider] Twilio requires accountSid and authToken.');
        return null;
      }
      return new TwilioProvider(config.accountSid, config.authToken, config.from);
    }
    case 'messagebird': {
      if (!config.apiKey) {
        console.warn('[SmsProvider] MessageBird requires apiKey.');
        return null;
      }
      return new MessageBirdProvider(config.apiKey, config.from);
    }
    case 'vonage': {
      if (!config.apiKey || !config.apiSecret) {
        console.warn('[SmsProvider] Vonage requires apiKey and apiSecret.');
        return null;
      }
      return new VonageProvider(config.apiKey, config.apiSecret, config.from);
    }
    default:
      console.warn(`[SmsProvider] Unknown provider: ${config.provider}. SMS features disabled.`);
      return null;
  }
}
