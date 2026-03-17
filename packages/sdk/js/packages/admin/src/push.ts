/**
 * PushClient — Push notification management for Admin/Server SDK
 *
 * Usage:
 *   const admin = createAdminClient(url, { serviceKey });
 *   await admin.push.send('userId', { title: 'Hello', body: 'World' });
 *   await admin.push.sendMany(['u1', 'u2'], { title: 'News' });
 *   const logs = await admin.push.getLogs('userId');
 */
import type { HttpClient } from '@edgebase/core';
import { HttpClientAdapter } from '@edgebase/core';
import { DefaultAdminApi } from './generated/admin-api-core.js';

// ─── Types ───

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
  fcm?: Record<string, unknown>;
}

export interface PushResult {
  sent: number;
  failed: number;
  removed: number;
}

export interface PushLogEntry {
  sentAt: string;
  userId: string;
  platform: string;
  status: 'sent' | 'failed' | 'removed';
  collapseId?: string;
  error?: string;
}

/** Device token info returned by getTokens() — token value is NOT exposed. */
export interface DeviceTokenInfo {
  deviceId: string;
  platform: string;
  updatedAt: string;
  deviceInfo?: {
    name?: string;
    osVersion?: string;
    appVersion?: string;
    locale?: string;
  };
  metadata?: Record<string, unknown>;
}

// ─── PushClient ───

export class PushClient {
  private adminCore: DefaultAdminApi;

  constructor(httpClient: HttpClient) {
    this.adminCore = new DefaultAdminApi(new HttpClientAdapter(httpClient));
  }

  /** Send a push notification to a single user's devices. */
  async send(userId: string, payload: PushPayload): Promise<PushResult> {
    return this.adminCore.pushSend({ userId, payload }) as Promise<PushResult>;
  }

  /** Send a push notification to multiple users (no limit — server chunks internally). */
  async sendMany(userIds: string[], payload: PushPayload): Promise<PushResult> {
    return this.adminCore.pushSendMany({ userIds, payload }) as Promise<PushResult>;
  }

  /** Send a push notification directly to a specific FCM token. */
  async sendToToken(token: string, payload: PushPayload, platform?: string): Promise<PushResult> {
    return this.adminCore.pushSendToToken({ token, payload, platform }) as Promise<PushResult>;
  }

  /** Get registered device tokens for a user -- token values are NOT exposed. */
  async getTokens(userId: string): Promise<DeviceTokenInfo[]> {
    const query: Record<string, string> = { userId };
    const res = await this.adminCore.getPushTokens(query) as { items: DeviceTokenInfo[] };
    return res.items;
  }

  /** Get push send logs for a user (last 24 hours). */
  async getLogs(userId: string, limit?: number): Promise<PushLogEntry[]> {
    const query: Record<string, string> = { userId };
    if (limit !== undefined) query.limit = String(limit);
    const res = await this.adminCore.getPushLogs(query) as { items: PushLogEntry[] };
    return res.items;
  }

  /** Send a push notification to an FCM topic. */
  async sendToTopic(topic: string, payload: PushPayload): Promise<{ success: boolean; error?: string }> {
    return this.adminCore.pushSendToTopic({ topic, payload }) as Promise<{ success: boolean; error?: string }>;
  }

  /** Broadcast a push notification to all devices via /topics/all. */
  async broadcast(payload: PushPayload): Promise<{ success: boolean; error?: string }> {
    return this.adminCore.pushBroadcast({ payload }) as Promise<{ success: boolean; error?: string }>;
  }
}
