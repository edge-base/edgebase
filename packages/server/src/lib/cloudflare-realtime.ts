import type { Env } from '../types.js';

const DEFAULT_CLOUDFLARE_REALTIME_BASE_URL = 'https://rtc.live.cloudflare.com/v1';

export interface CloudflareRealtimeSessionDescription {
  sdp: string;
  type: 'offer' | 'answer';
}

export interface CloudflareRealtimeTrackObject {
  location: 'local' | 'remote';
  mid?: string;
  sessionId?: string;
  trackName?: string;
  bidirectionalMediaStream?: boolean;
  kind?: string;
  simulcast?: {
    preferredRid?: string;
    priorityOrdering?: 'none' | 'asciibetical';
    ridNotAvailable?: 'none' | 'asciibetical';
  };
}

export interface CloudflareRealtimeNewSessionRequest {
  sessionDescription?: CloudflareRealtimeSessionDescription;
}

export interface CloudflareRealtimeNewSessionResponse {
  errorCode?: string;
  errorDescription?: string;
  sessionDescription?: CloudflareRealtimeSessionDescription;
  sessionId: string;
}

export interface CloudflareRealtimeTracksRequest {
  sessionDescription?: CloudflareRealtimeSessionDescription;
  tracks: CloudflareRealtimeTrackObject[];
  autoDiscover?: boolean;
}

export interface CloudflareRealtimeTracksResponse {
  errorCode?: string;
  errorDescription?: string;
  requiresImmediateRenegotiation?: boolean;
  sessionDescription?: CloudflareRealtimeSessionDescription;
  tracks?: Array<CloudflareRealtimeTrackObject & {
    errorCode?: string;
    errorDescription?: string;
  }>;
}

export interface CloudflareRealtimeRenegotiateRequest {
  sessionDescription: CloudflareRealtimeSessionDescription;
}

export interface CloudflareRealtimeCloseTracksRequest {
  sessionDescription?: CloudflareRealtimeSessionDescription;
  tracks: Array<{ mid: string }>;
  force?: boolean;
}

export interface CloudflareRealtimeIceServer {
  urls: string[] | string;
  username?: string;
  credential?: string;
}

export interface CloudflareRealtimeIceServersResponse {
  iceServers: CloudflareRealtimeIceServer[];
}

export interface CloudflareRealtimeEnv {
  CF_REALTIME_APP_ID?: string;
  CF_REALTIME_APP_SECRET?: string;
  CF_REALTIME_BASE_URL?: string;
  CF_REALTIME_TURN_KEY_ID?: string;
  CF_REALTIME_TURN_API_TOKEN?: string;
}

function trimString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function parseRealtimeResponse<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      (typeof data.errorDescription === 'string' && data.errorDescription)
      || (typeof data.message === 'string' && data.message)
      || `Cloudflare Realtime request failed (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

export function hasCloudflareRealtimeConfig(env: CloudflareRealtimeEnv): boolean {
  return !!trimString(env.CF_REALTIME_APP_ID) && !!trimString(env.CF_REALTIME_APP_SECRET);
}

export function assertCloudflareRealtimeConfig(env: CloudflareRealtimeEnv): {
  appId: string;
  appSecret: string;
  baseUrl: string;
  turnKeyId?: string;
  turnApiToken?: string;
} {
  const appId = trimString(env.CF_REALTIME_APP_ID);
  const appSecret = trimString(env.CF_REALTIME_APP_SECRET);
  if (!appId || !appSecret) {
    throw new Error('Cloudflare Realtime is not configured. Set CF_REALTIME_APP_ID and CF_REALTIME_APP_SECRET.');
  }

  return {
    appId,
    appSecret,
    baseUrl: trimString(env.CF_REALTIME_BASE_URL) ?? DEFAULT_CLOUDFLARE_REALTIME_BASE_URL,
    turnKeyId: trimString(env.CF_REALTIME_TURN_KEY_ID),
    turnApiToken: trimString(env.CF_REALTIME_TURN_API_TOKEN),
  };
}

export class CloudflareRealtimeClient {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly baseUrl: string;
  private readonly turnKeyId?: string;
  private readonly turnApiToken?: string;

  constructor(env: CloudflareRealtimeEnv) {
    const config = assertCloudflareRealtimeConfig(env);
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.baseUrl = config.baseUrl;
    this.turnKeyId = config.turnKeyId;
    this.turnApiToken = config.turnApiToken;
  }

  async createSession(
    body: CloudflareRealtimeNewSessionRequest = {},
    query?: { thirdparty?: boolean; correlationId?: string },
  ): Promise<CloudflareRealtimeNewSessionResponse> {
    const url = this.buildSessionUrl('/sessions/new', query);
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildAuthHeaders(),
      body: JSON.stringify(body),
    });
    return parseRealtimeResponse<CloudflareRealtimeNewSessionResponse>(response);
  }

  async addTracks(
    sessionId: string,
    body: CloudflareRealtimeTracksRequest,
  ): Promise<CloudflareRealtimeTracksResponse> {
    const response = await fetch(
      this.buildSessionUrl(`/sessions/${encodeURIComponent(sessionId)}/tracks/new`),
      {
        method: 'POST',
        headers: this.buildAuthHeaders(),
        body: JSON.stringify(body),
      },
    );
    return parseRealtimeResponse<CloudflareRealtimeTracksResponse>(response);
  }

  async renegotiate(
    sessionId: string,
    body: CloudflareRealtimeRenegotiateRequest,
  ): Promise<CloudflareRealtimeTracksResponse> {
    const response = await fetch(
      this.buildSessionUrl(`/sessions/${encodeURIComponent(sessionId)}/renegotiate`),
      {
        method: 'PUT',
        headers: this.buildAuthHeaders(),
        body: JSON.stringify(body),
      },
    );
    return parseRealtimeResponse<CloudflareRealtimeTracksResponse>(response);
  }

  async closeTracks(
    sessionId: string,
    body: CloudflareRealtimeCloseTracksRequest,
  ): Promise<CloudflareRealtimeTracksResponse> {
    const response = await fetch(
      this.buildSessionUrl(`/sessions/${encodeURIComponent(sessionId)}/tracks/close`),
      {
        method: 'PUT',
        headers: this.buildAuthHeaders(),
        body: JSON.stringify(body),
      },
    );
    return parseRealtimeResponse<CloudflareRealtimeTracksResponse>(response);
  }

  async getSession(sessionId: string): Promise<{
    tracks?: Array<CloudflareRealtimeTrackObject & { status?: string }>;
  }> {
    const response = await fetch(
      this.buildSessionUrl(`/sessions/${encodeURIComponent(sessionId)}`),
      {
        method: 'GET',
        headers: this.buildAuthHeaders(),
      },
    );
    return parseRealtimeResponse<{ tracks?: Array<CloudflareRealtimeTrackObject & { status?: string }> }>(response);
  }

  async generateIceServers(ttl = 3600): Promise<CloudflareRealtimeIceServersResponse> {
    if (!this.turnKeyId || !this.turnApiToken) {
      throw new Error('Cloudflare TURN is not configured. Set CF_REALTIME_TURN_KEY_ID and CF_REALTIME_TURN_API_TOKEN.');
    }

    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, '')}/turn/keys/${encodeURIComponent(this.turnKeyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.turnApiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl }),
      },
    );
    return parseRealtimeResponse<CloudflareRealtimeIceServersResponse>(response);
  }

  private buildSessionUrl(pathname: string, query?: { thirdparty?: boolean; correlationId?: string }): string {
    const url = new URL(
      `${this.baseUrl.replace(/\/$/, '')}/apps/${encodeURIComponent(this.appId)}${pathname}`,
    );
    if (query?.thirdparty !== undefined) {
      url.searchParams.set('thirdparty', String(query.thirdparty));
    }
    if (query?.correlationId) {
      url.searchParams.set('correlationId', query.correlationId);
    }
    return url.toString();
  }

  private buildAuthHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.appSecret}`,
      'Content-Type': 'application/json',
    };
  }
}

export function createCloudflareRealtimeClient(env: Env): CloudflareRealtimeClient {
  return new CloudflareRealtimeClient(env);
}
