/**
 * PushProvider — FCM 단일 프로바이더 (FCM 일원화,)
 *
 * 모든 플랫폼(iOS, Android, Web)에서 Firebase 클라이언트 SDK로 FCM Registration Token을
 * 발급받고, 서버는 FCM HTTP v1 API로만 발송한다.
 *
 * Workers에서는 firebase-admin 불가 → FCM HTTP v1 REST API 직접 호출.
 * 토픽 구독은 모바일: 클라이언트 직접, 웹: 서버 경유 FCM IID API.
 */

import type { PushConfig } from '@edgebase/shared';
import type { Env } from '../types.js';

// ─── Interfaces ───

export interface PushPayload {
  title?: string;
  body?: string;
  image?: string;
  sound?: string;
  badge?: number;
  data?: Record<string, unknown>;
  silent?: boolean;
  collapseId?: string;
  ttl?: number;
  /** FCM-specific overrides (merged into android config) */
  fcm?: Record<string, unknown>;
}

export interface PushSendOptions {
  token: string;
  platform: string;
  payload: PushPayload;
}

export interface PushSendResult {
  success: boolean;
  /** true → token is invalid, should be removed from KV */
  remove?: boolean;
  /** true → transient error, should retry */
  retry?: boolean;
  error?: string;
}

// ─── FCM Provider ───

export class FcmProvider {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private endpoints: { oauth2TokenUrl: string; fcmSendUrl: string; iidBaseUrl: string };

  constructor(
    private projectId: string,
    private serviceAccountJson: string,
    endpoints?: { oauth2TokenUrl?: string; fcmSendUrl?: string; iidBaseUrl?: string },
    private useMockAccessToken: boolean = false,
  ) {
    this.endpoints = {
      oauth2TokenUrl: endpoints?.oauth2TokenUrl ?? 'https://oauth2.googleapis.com/token',
      fcmSendUrl: endpoints?.fcmSendUrl ?? `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      iidBaseUrl: endpoints?.iidBaseUrl ?? 'https://iid.googleapis.com',
    };
  }

  async send(options: PushSendOptions): Promise<PushSendResult> {
    const token = await this.getAccessToken();
    if (!token) {
      return { success: false, error: 'Failed to obtain FCM access token' };
    }

    const message = this.buildMessage(options.payload, { token: options.token });

    return this.sendMessage(token, message, { canRemove: true });
  }

  /**
   * Send to an FCM topic. Topic subscription is client-driven (mobile)
   * or server-driven via IID API (web).
   */
  async sendToTopic(topic: string, payload: PushPayload): Promise<PushSendResult> {
    const token = await this.getAccessToken();
    if (!token) {
      return { success: false, error: 'Failed to obtain FCM access token' };
    }

    const message = this.buildMessage(payload, { topic });

    return this.sendMessage(token, message, { canRemove: false });
  }

  /**
   * Broadcast to all devices via /topics/all.
   * Clients auto-subscribe to 'all' topic on register.
   */
  async broadcast(payload: PushPayload): Promise<PushSendResult> {
    return this.sendToTopic('all', payload);
  }

  /**
   * Subscribe a token to an FCM topic via Instance ID API.
   * Used for web clients (Firebase JS SDK doesn't support client-side subscribeToTopic).
   */
  async subscribeTokenToTopic(fcmToken: string, topic: string): Promise<{ success: boolean; error?: string }> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'Failed to obtain FCM access token' };
    }

    const url = `${this.endpoints.iidBaseUrl}/iid/v1/${encodeURIComponent(fcmToken)}/rel/topics/${encodeURIComponent(topic)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (resp.ok) return { success: true };
    const text = await resp.text().catch(() => '');
    return { success: false, error: `IID ${resp.status}: ${text}` };
  }

  /**
   * Unsubscribe a token from an FCM topic via Instance ID API.
   */
  async unsubscribeTokenFromTopic(fcmToken: string, topic: string): Promise<{ success: boolean; error?: string }> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'Failed to obtain FCM access token' };
    }

    const url = `${this.endpoints.iidBaseUrl}/iid/v1:batchRemove`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: `/topics/${topic}`,
        registration_tokens: [fcmToken],
      }),
    });

    if (resp.ok) return { success: true };
    const text = await resp.text().catch(() => '');
    return { success: false, error: `IID ${resp.status}: ${text}` };
  }

  // ─── Private helpers ───

  private buildMessage(
    payload: PushPayload,
    target: { token?: string; topic?: string },
  ): Record<string, unknown> {
    const message: Record<string, unknown> = { ...target };

    // Notification payload
    if (payload.title || payload.body) {
      message.notification = {
        title: payload.title,
        body: payload.body,
        ...(payload.image ? { image: payload.image } : {}),
      };
    }

    // Data payload — FCM data values must be strings
    if (payload.data) {
      const stringData: Record<string, string> = {};
      for (const [k, v] of Object.entries(payload.data)) {
        stringData[k] = typeof v === 'string' ? v : JSON.stringify(v);
      }
      message.data = stringData;
    }

    // Android-specific
    const androidConfig: Record<string, unknown> = {};
    if (payload.collapseId) androidConfig.collapse_key = payload.collapseId;
    if (payload.ttl !== undefined) androidConfig.ttl = `${payload.ttl}s`;
    if (payload.sound || payload.image) {
      androidConfig.notification = {
        ...(payload.sound ? { sound: payload.sound } : {}),
        ...(payload.image ? { image: payload.image } : {}),
      };
    }
    if (payload.fcm) Object.assign(androidConfig, payload.fcm);
    if (Object.keys(androidConfig).length > 0) message.android = androidConfig;

    const aps: Record<string, unknown> = {};
    if (payload.sound) aps.sound = payload.sound;
    if (payload.badge !== undefined) aps.badge = payload.badge;
    if (Object.keys(aps).length > 0) {
      message.apns = {
        payload: {
          aps,
        },
      };
    }

    // Silent push → data-only message (no notification key)
    if (payload.silent) {
      delete message.notification;
    }

    return message;
  }

  private async sendMessage(
    accessToken: string,
    message: Record<string, unknown>,
    opts: { canRemove: boolean },
  ): Promise<PushSendResult> {
    const url = this.endpoints.fcmSendUrl;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });

    if (resp.ok) {
      return { success: true };
    }

    const status = resp.status;
    // Token invalid — should be removed (only for individual sends, not topics)
    if (opts.canRemove && (status === 404 || status === 410)) {
      return { success: false, remove: true, error: `FCM ${status}: token invalid` };
    }
    // Also check for UNREGISTERED error in response body
    if (status === 400) {
      try {
        const body = await resp.json() as { error?: { details?: Array<{ errorCode?: string }> } };
        if (opts.canRemove && body.error?.details?.some(d => d.errorCode === 'UNREGISTERED')) {
          return { success: false, remove: true, error: 'FCM: UNREGISTERED' };
        }
      } catch { /* skip body parse errors */ }
      return { success: false, error: `FCM ${status}: bad request` };
    }
    // Transient errors — should retry
    if (status === 429 || status === 503) {
      return { success: false, retry: true, error: `FCM ${status}: transient error` };
    }
    // Auth errors
    if (status === 401 || status === 403) {
      this.accessToken = null; // Force token refresh
      return { success: false, error: `FCM ${status}: authentication error` };
    }

    return { success: false, error: `FCM ${status}: unexpected error` };
  }

  /**
   * Get a cached or fresh OAuth2 access token.
   * FCM v1 requires: Service Account JWT (RS256) → Google OAuth2 token exchange.
   */
  private async getAccessToken(): Promise<string | null> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    if (this.useMockAccessToken) {
      this.accessToken = 'mock-access-token';
      this.tokenExpiry = Date.now() + 55 * 60 * 1000;
      return this.accessToken;
    }

    try {
      const sa = JSON.parse(this.serviceAccountJson) as {
        client_email: string;
        private_key: string;
      };

      // Import RS256 private key
      const pemContent = sa.private_key
        .replace(/-----BEGIN PRIVATE KEY-----/g, '')
        .replace(/-----END PRIVATE KEY-----/g, '')
        .replace(/\n/g, '');
      const keyData = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0));

      const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        keyData,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
      );

      // Create JWT
      const now = Math.floor(Date.now() / 1000);
      const header = { alg: 'RS256', typ: 'JWT' };
      const claimSet = {
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: this.endpoints.oauth2TokenUrl,
        iat: now,
        exp: now + 3600,
      };

      const encHeader = base64urlEncode(JSON.stringify(header));
      const encClaims = base64urlEncode(JSON.stringify(claimSet));
      const signInput = `${encHeader}.${encClaims}`;

      const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        privateKey,
        new TextEncoder().encode(signInput),
      );

      const jwt = `${signInput}.${base64urlEncode(signature)}`;

      // Exchange JWT for access token
      const tokenResp = await fetch(this.endpoints.oauth2TokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
      });

      if (!tokenResp.ok) {
        console.error(
          '[PushProvider:FCM] Token exchange failed:',
          tokenResp.status,
          this.endpoints.oauth2TokenUrl,
        );
        return null;
      }

      const tokenData = await tokenResp.json() as { access_token: string; expires_in: number };
      this.accessToken = tokenData.access_token;
      this.tokenExpiry = Date.now() + (tokenData.expires_in - 60) * 1000; // 1 min buffer
      return this.accessToken;
    } catch (err) {
      console.error('[PushProvider:FCM] getAccessToken error:', err, this.endpoints.oauth2TokenUrl);
      return null;
    }
  }
}

// ─── Factory ───

export function resolveFcmEndpoints(
  projectId: string,
  endpoints?: { oauth2TokenUrl?: string; fcmSendUrl?: string; iidBaseUrl?: string },
  env?: Env,
): { oauth2TokenUrl: string; fcmSendUrl: string; iidBaseUrl: string } {
  const mockBaseUrl = env?.MOCK_FCM_BASE_URL?.trim()?.replace(/\/$/, '');
  if (mockBaseUrl) {
    return {
      oauth2TokenUrl: `${mockBaseUrl}/token`,
      fcmSendUrl: `${mockBaseUrl}/v1/projects/${projectId}/messages:send`,
      iidBaseUrl: mockBaseUrl,
    };
  }

  return {
    oauth2TokenUrl: endpoints?.oauth2TokenUrl ?? 'https://oauth2.googleapis.com/token',
    fcmSendUrl: endpoints?.fcmSendUrl ?? `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    iidBaseUrl: endpoints?.iidBaseUrl ?? 'https://iid.googleapis.com',
  };
}

/**
 * Create FCM push provider from config + env.
 * Returns null if FCM is not configured.
 *
 * Service account resolution order:
 *   1. env.PUSH_FCM_SERVICE_ACCOUNT  — direct Worker env binding (production)
 *   2. config.fcm.serviceAccount     — config-embedded fallback (test/Docker)
 */
export function createPushProvider(
  config?: PushConfig,
  env?: Env,
): FcmProvider | null {
  if (!config?.fcm) return null;

  // Primary: direct env binding
  const serviceAccountJson =
    env?.PUSH_FCM_SERVICE_ACCOUNT ?? config.fcm.serviceAccount;

  if (!serviceAccountJson) return null;

  const mockBaseUrl = env?.MOCK_FCM_BASE_URL?.trim()?.replace(/\/$/, '');

  return new FcmProvider(
    config.fcm.projectId,
    serviceAccountJson,
    resolveFcmEndpoints(config.fcm.projectId, config.fcm.endpoints, env),
    Boolean(mockBaseUrl),
  );
}

// ─── Helpers ───

function base64urlEncode(input: string | ArrayBuffer): string {
  let base64: string;
  if (typeof input === 'string') {
    base64 = btoa(input);
  } else {
    const bytes = new Uint8Array(input);
    let binary = '';
    for (const b of bytes) {
      binary += String.fromCharCode(b);
    }
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
