import {
  getRoomHooks,
  type AuthContext as SharedAuthContext,
  type RoomMemberInfo,
  type RoomSender,
  type RoomServerAPI,
} from '@edge-base/shared';
import {
  createCloudflareRealtimeClient,
  type CloudflareRealtimeCloseTracksRequest,
  type CloudflareRealtimeNewSessionRequest,
  type CloudflareRealtimeNewSessionResponse,
  type CloudflareRealtimeRenegotiateRequest,
  type CloudflareRealtimeTracksRequest,
  type CloudflareRealtimeTracksResponse,
} from '../lib/cloudflare-realtime.js';
import { resolveAuthContextFromToken } from '../middleware/auth.js';
import type { Env } from '../types.js';
import { RoomRuntimeBaseDO, type RoomWSMeta } from './room-runtime-base.js';

/**
 * Parallel `rooms` runtime entrypoint.
 *
 * It currently preserves legacy Room behavior while giving rollout routing a
 * separate Durable Object class to target. New room-runtime capabilities can
 * evolve here without mutating the legacy RoomDO class in place.
 */

interface SignalMessage {
  type: 'signal';
  event: string;
  payload?: unknown;
  memberId?: string | null;
  includeSelf?: boolean;
  requestId?: string;
}

interface MemberStateMessage {
  type: 'member_state';
  state?: Record<string, unknown>;
  requestId?: string;
}

interface MemberStateClearMessage {
  type: 'member_state_clear';
  requestId?: string;
}

interface AdminMessage {
  type: 'admin';
  operation: string;
  memberId?: string | null;
  payload?: Record<string, unknown>;
  requestId?: string;
}

type MediaKind = 'audio' | 'video' | 'screen';

interface MediaMessage {
  type: 'media';
  operation: 'publish' | 'unpublish' | 'mute' | 'device';
  kind?: MediaKind;
  payload?: Record<string, unknown>;
  requestId?: string;
}

interface SignalFrameMeta {
  memberId: string | null;
  userId: string | null;
  connectionId: string | null;
  sentAt: number;
  serverSent: boolean;
}

interface RoomMemberMediaKindState {
  published: boolean;
  muted: boolean;
  trackId?: string;
  deviceId?: string;
  publishedAt?: number;
  adminDisabled?: boolean;
  providerSessionId?: string;
}

interface RoomMemberMediaState {
  audio?: RoomMemberMediaKindState;
  video?: RoomMemberMediaKindState;
  screen?: RoomMemberMediaKindState;
}

interface RoomMemberPresence {
  memberId: string;
  userId: string;
  joinedAt: number;
  connectionIds: Set<string>;
  state: Record<string, unknown>;
}

interface RoomMemberRealtimeSession {
  sessionId: string;
  connectionId?: string;
  createdAt: number;
  updatedAt: number;
}

type RoomMemberSnapshot = RoomMemberInfo & { state: Record<string, unknown> };
type RoomMemberLeaveReason = 'leave' | 'timeout' | 'kicked';

const SYSTEM_SIGNAL_SENDER: RoomSender = {
  userId: 'system',
  connectionId: 'server',
};

const DEFAULT_MEMBER_RECONNECT_TIMEOUT_MS = 30000;
const SIGNAL_DENIED = Symbol('rooms.signal.denied');
const MEDIA_DENIED = Symbol('rooms.media.denied');
const WEBSOCKET_OPEN = 1;
const CLOUDFLARE_REALTIME_KIT_MEETING_STORAGE_KEY = 'cloudflareRealtimeKitMeetingId';

function computeStateDelta(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> | null {
  const delta: Record<string, unknown> = {};
  let hasChanges = false;

  for (const key of Object.keys(next)) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      delta[key] = next[key];
      hasChanges = true;
    }
  }
  for (const key of Object.keys(previous)) {
    if (!(key in next)) {
      delta[key] = null;
      hasChanges = true;
    }
  }

  return hasChanges ? delta : null;
}

export class RoomsDO extends RoomRuntimeBaseDO {
  private readonly joinedConnectionIds = new Set<string>();
  private readonly members = new Map<string, RoomMemberPresence>();
  private readonly blockedMembers = new Set<string>();
  private readonly memberRoles = new Map<string, string>();
  private readonly memberMediaStates = new Map<string, RoomMemberMediaState>();
  private readonly memberRealtimeSessions = new Map<string, RoomMemberRealtimeSession>();
  private cloudflareRealtimeKitMeetingId: string | null = null;
  private cloudflareRealtimeKitMeetingIdPromise: Promise<string> | null = null;

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/media/cloudflare_realtimekit/session' && request.method === 'POST') {
      return this.handleCloudflareRealtimeKitSessionCreate(request, url);
    }

    if (url.pathname === '/media/realtime/session') {
      if (request.method === 'POST') return this.handleRealtimeSessionCreate(request, url);
      if (request.method === 'GET') return this.handleRealtimeSessionGet(request, url);
      return this.jsonResponse(405, { code: 405, message: 'Method not allowed' });
    }

    if (url.pathname === '/media/realtime/turn' && request.method === 'POST') {
      return this.handleRealtimeTurn(request, url);
    }

    if (url.pathname === '/media/realtime/tracks/new' && request.method === 'POST') {
      return this.handleRealtimeTracksNew(request, url);
    }

    if (url.pathname === '/media/realtime/renegotiate' && request.method === 'PUT') {
      return this.handleRealtimeRenegotiate(request, url);
    }

    if (url.pathname === '/media/realtime/tracks/close' && request.method === 'PUT') {
      return this.handleRealtimeTracksClose(request, url);
    }

    return super.fetch(request);
  }

  private async handleCloudflareRealtimeKitSessionCreate(request: Request, url: URL): Promise<Response> {
    try {
      const body = await this.readJsonBody<{
        connectionId?: string;
        customParticipantId?: string;
        name?: string;
        picture?: string;
      }>(request);
      const { memberId, connectionId, meta } = await this.authenticateRealtimeRequest(
        request,
        url,
        typeof body.connectionId === 'string' ? body.connectionId : undefined,
      );
      if (this.hasPublishedTracks(memberId)) {
        return this.jsonResponse(409, {
          code: 409,
          message: 'Unpublish existing room media before creating a new Cloudflare RealtimeKit session',
        });
      }

      const config = this.getCloudflareRealtimeKitConfig();
      const meetingId = await this.ensureCloudflareRealtimeKitMeetingId(config);
      const participant = await this.createCloudflareRealtimeKitParticipant(config, meetingId, {
        customParticipantId: this.buildCloudflareRealtimeKitParticipantId(memberId, body.customParticipantId),
        name: typeof body.name === 'string' && body.name.trim()
          ? body.name.trim()
          : meta.auth?.email ?? meta.userId ?? memberId,
        picture: typeof body.picture === 'string' && body.picture.trim() ? body.picture.trim() : undefined,
      });

      return this.jsonResponse(200, {
        sessionId: participant.id,
        meetingId,
        participantId: participant.id,
        authToken: participant.token,
        presetName: participant.presetName ?? config.presetName,
        connectionId,
        reused: false,
      });
    } catch (err) {
      return this.jsonResponse(400, {
        code: 400,
        message: err instanceof Error ? err.message : 'Failed to create Cloudflare RealtimeKit session',
      });
    }
  }

  private async handleRealtimeSessionCreate(request: Request, url: URL): Promise<Response> {
    try {
      const body = await this.readJsonBody<{
        connectionId?: string;
        correlationId?: string;
        thirdparty?: boolean;
        sessionDescription?: CloudflareRealtimeNewSessionRequest['sessionDescription'];
      }>(request);
      const { memberId, connectionId } = await this.authenticateRealtimeRequest(
        request,
        url,
        typeof body.connectionId === 'string' ? body.connectionId : undefined,
      );

      if (this.hasPublishedTracks(memberId)) {
        return this.jsonResponse(409, {
          code: 409,
          message: 'Unpublish existing room media before replacing the active realtime session.',
        });
      }

      const client = this.buildRealtimeClient();
      const response = await client.createSession(
        {
          sessionDescription: body.sessionDescription,
        },
        {
          thirdparty: body.thirdparty === true,
          correlationId:
            typeof body.correlationId === 'string' && body.correlationId.trim()
              ? body.correlationId.trim()
              : `${this.namespace ?? 'room'}::${this.roomId ?? 'unknown'}::${memberId}`,
        },
      );

      this.memberRealtimeSessions.set(memberId, {
        sessionId: response.sessionId,
        connectionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      return this.jsonResponse<CloudflareRealtimeNewSessionResponse & {
        connectionId: string;
        reused: false;
      }>(200, {
        ...response,
        connectionId,
        reused: false,
      });
    } catch (err) {
      return this.jsonResponse(400, {
        code: 400,
        message: err instanceof Error ? err.message : 'Failed to create realtime session',
      });
    }
  }

  private async handleRealtimeSessionGet(request: Request, url: URL): Promise<Response> {
    try {
      const requestedConnectionId = url.searchParams.get('connectionId') ?? undefined;
      const { memberId } = await this.authenticateRealtimeRequest(request, url, requestedConnectionId);
      const session = this.memberRealtimeSessions.get(memberId);
      if (!session) {
        return this.jsonResponse(404, {
          code: 404,
          message: 'No active realtime session for this room member.',
        });
      }
      return this.jsonResponse(200, session);
    } catch (err) {
      return this.jsonResponse(400, {
        code: 400,
        message: err instanceof Error ? err.message : 'Failed to read realtime session',
      });
    }
  }

  private async handleRealtimeTurn(request: Request, url: URL): Promise<Response> {
    try {
      const body = await this.readJsonBody<{ ttl?: number }>(request);
      await this.authenticateRealtimeRequest(request, url);
      const client = this.buildRealtimeClient();
      const ttl = typeof body.ttl === 'number' && Number.isFinite(body.ttl) && body.ttl > 0
        ? Math.floor(body.ttl)
        : 3600;
      const response = await client.generateIceServers(ttl);
      return this.jsonResponse(200, response);
    } catch (err) {
      return this.jsonResponse(400, {
        code: 400,
        message: err instanceof Error ? err.message : 'Failed to generate ICE servers',
      });
    }
  }

  private async handleRealtimeTracksNew(request: Request, url: URL): Promise<Response> {
    try {
      const body = await this.readJsonBody<CloudflareRealtimeTracksRequest & {
        sessionId?: string;
        connectionId?: string;
        publish?: {
          kind?: MediaKind;
          trackId?: string;
          deviceId?: string;
          muted?: boolean;
        };
      }>(request);

      const { memberId, meta } = await this.authenticateRealtimeRequest(
        request,
        url,
        typeof body.connectionId === 'string' ? body.connectionId : undefined,
      );

      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      if (!sessionId) {
        throw new Error('sessionId is required');
      }
      this.assertRealtimeSessionOwnership(memberId, sessionId);

      if (!Array.isArray(body.tracks) || body.tracks.length === 0) {
        throw new Error('tracks is required');
      }

      const response = await this.buildRealtimeClient().addTracks(sessionId, {
        sessionDescription: body.sessionDescription,
        tracks: body.tracks,
        autoDiscover: body.autoDiscover === true,
      });
      this.assertRealtimeTracksResponseSuccess(response);

      const publishPayload = body.publish;
      const publishKind = publishPayload?.kind;
      if (publishKind) {
        if (!(await this.canPublishMedia(meta, publishKind, publishPayload ?? {}))) {
          throw new Error('Denied by room media publish access rule');
        }
        const localTrackName = publishPayload.trackId?.trim()
          || body.tracks.find((track) => track.location === 'local')?.trackName?.trim()
          || response.tracks?.find((track) => track.location === 'local')?.trackName?.trim();
        await this.publishMedia(meta, publishKind, {
          trackId: localTrackName,
          deviceId: publishPayload.deviceId,
          muted: publishPayload.muted,
          providerSessionId: sessionId,
        });
      }

      const session = this.memberRealtimeSessions.get(memberId);
      if (session) {
        session.updatedAt = Date.now();
      }

      return this.jsonResponse(200, response);
    } catch (err) {
      return this.jsonResponse(400, {
        code: 400,
        message: err instanceof Error ? err.message : 'Failed to add realtime tracks',
      });
    }
  }

  private async handleRealtimeRenegotiate(request: Request, url: URL): Promise<Response> {
    try {
      const body = await this.readJsonBody<CloudflareRealtimeRenegotiateRequest & {
        sessionId?: string;
        connectionId?: string;
      }>(request);
      const { memberId } = await this.authenticateRealtimeRequest(
        request,
        url,
        typeof body.connectionId === 'string' ? body.connectionId : undefined,
      );
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      if (!sessionId) throw new Error('sessionId is required');
      this.assertRealtimeSessionOwnership(memberId, sessionId);
      if (!body.sessionDescription) {
        throw new Error('sessionDescription is required');
      }

      const response = await this.buildRealtimeClient().renegotiate(sessionId, {
        sessionDescription: body.sessionDescription,
      });
      this.assertRealtimeTracksResponseSuccess(response);

      const session = this.memberRealtimeSessions.get(memberId);
      if (session) {
        session.updatedAt = Date.now();
      }
      return this.jsonResponse(200, response);
    } catch (err) {
      return this.jsonResponse(400, {
        code: 400,
        message: err instanceof Error ? err.message : 'Failed to renegotiate realtime session',
      });
    }
  }

  private async handleRealtimeTracksClose(request: Request, url: URL): Promise<Response> {
    try {
      const body = await this.readJsonBody<CloudflareRealtimeCloseTracksRequest & {
        sessionId?: string;
        connectionId?: string;
        unpublish?: { kind?: MediaKind };
      }>(request);
      const { memberId } = await this.authenticateRealtimeRequest(
        request,
        url,
        typeof body.connectionId === 'string' ? body.connectionId : undefined,
      );
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      if (!sessionId) throw new Error('sessionId is required');
      this.assertRealtimeSessionOwnership(memberId, sessionId);
      if (!Array.isArray(body.tracks) || body.tracks.length === 0) {
        throw new Error('tracks is required');
      }

      const response = await this.buildRealtimeClient().closeTracks(sessionId, {
        sessionDescription: body.sessionDescription,
        tracks: body.tracks,
        force: body.force === true,
      });
      this.assertRealtimeTracksResponseSuccess(response);

      const unpublishKind = body.unpublish?.kind;
      if (unpublishKind) {
        await this.unpublishMedia(memberId, unpublishKind);
      }

      const session = this.memberRealtimeSessions.get(memberId);
      if (session) {
        session.updatedAt = Date.now();
      }
      return this.jsonResponse(200, response);
    } catch (err) {
      return this.jsonResponse(400, {
        code: 400,
        message: err instanceof Error ? err.message : 'Failed to close realtime tracks',
      });
    }
  }

  private buildRealtimeClient() {
    return createCloudflareRealtimeClient(this.env as unknown as Env);
  }

  private getCloudflareRealtimeKitConfig(): {
    accountId: string;
    apiToken: string;
    appId: string;
    presetName: string;
  } {
    const env = this.env as unknown as Env;
    const accountId = env.CF_ACCOUNT_ID?.trim();
    const apiToken = env.CF_API_TOKEN?.trim();
    const appId = env.CF_REALTIME_APP_ID?.trim();
    const presetName = env.CF_REALTIME_PRESET_NAME?.trim() || 'group_call_participant';

    if (!accountId || !apiToken || !appId) {
      throw new Error(
        'Cloudflare Realtime is not configured. Set CF_ACCOUNT_ID, CF_API_TOKEN, and CF_REALTIME_APP_ID.',
      );
    }

    return { accountId, apiToken, appId, presetName };
  }

  private buildCloudflareRealtimeKitParticipantId(memberId: string, provided?: string): string {
    const trimmed = typeof provided === 'string' ? provided.trim() : '';
    if (trimmed) {
      return trimmed;
    }

    return [
      this.namespace ?? 'room',
      this.roomId ?? 'unknown',
      memberId,
      Date.now().toString(36),
    ].join(':');
  }

  private async ensureCloudflareRealtimeKitMeetingId(config: {
    accountId: string;
    apiToken: string;
    appId: string;
  }): Promise<string> {
    if (this.cloudflareRealtimeKitMeetingId) {
      return this.cloudflareRealtimeKitMeetingId;
    }

    if (this.cloudflareRealtimeKitMeetingIdPromise) {
      return this.cloudflareRealtimeKitMeetingIdPromise;
    }

    this.cloudflareRealtimeKitMeetingIdPromise = (async () => {
      const storedMeetingId = await this.ctx.storage.get<string>(CLOUDFLARE_REALTIME_KIT_MEETING_STORAGE_KEY);
      if (storedMeetingId) {
        this.cloudflareRealtimeKitMeetingId = storedMeetingId;
        return storedMeetingId;
      }

      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}`
          + `/realtime/kit/${encodeURIComponent(config.appId)}/meetings`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: `${this.namespace ?? 'room'}::${this.roomId ?? 'unknown'}`,
          }),
        },
      );
      const data = await this.parseCloudflareApiEnvelope<{ id: string }>(response);
      this.cloudflareRealtimeKitMeetingId = data.id;
      await this.ctx.storage.put(CLOUDFLARE_REALTIME_KIT_MEETING_STORAGE_KEY, data.id);
      return data.id;
    })();

    try {
      return await this.cloudflareRealtimeKitMeetingIdPromise;
    } finally {
      this.cloudflareRealtimeKitMeetingIdPromise = null;
    }
  }

  private async createCloudflareRealtimeKitParticipant(
    config: {
      accountId: string;
      apiToken: string;
      appId: string;
      presetName: string;
    },
    meetingId: string,
    payload: {
      customParticipantId: string;
      name?: string;
      picture?: string;
    },
  ): Promise<{ id: string; token: string; presetName?: string }> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}`
        + `/realtime/kit/${encodeURIComponent(config.appId)}`
        + `/meetings/${encodeURIComponent(meetingId)}/participants`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          custom_participant_id: payload.customParticipantId,
          preset_name: config.presetName,
          name: payload.name,
          picture: payload.picture,
        }),
      },
    );

    const data = await this.parseCloudflareApiEnvelope<{
      id: string;
      token: string;
      preset_name?: string;
    }>(response);

    return {
      id: data.id,
      token: data.token,
      presetName: data.preset_name,
    };
  }

  private async parseCloudflareApiEnvelope<T>(response: Response): Promise<T> {
    const payload = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      errors?: Array<{ message?: string }>;
      messages?: Array<{ message?: string }>;
      result?: T;
      data?: T;
    };

    if (!response.ok || payload.success === false) {
      const message =
        payload.errors?.find((entry) => typeof entry.message === 'string')?.message
        ?? payload.messages?.find((entry) => typeof entry.message === 'string')?.message
        ?? `Cloudflare API request failed (${response.status})`;
      throw new Error(message);
    }

    return (payload.data ?? payload.result ?? {}) as T;
  }

  private async authenticateRealtimeRequest(
    request: Request,
    url: URL,
    requestedConnectionId?: string,
  ): Promise<{ memberId: string; connectionId: string; meta: RoomWSMeta }> {
    this.hydrateRoomFromUrl(url);

    const token = this.extractBearerToken(request);
    if (!token) {
      throw new Error('Authentication required');
    }

    const auth = await resolveAuthContextFromToken(this.env, token, request);
    const memberId = auth.id;
    const member = this.members.get(memberId);
    if (!member || member.connectionIds.size === 0) {
      throw new Error('Join the room WebSocket before using realtime media');
    }

    const connectionId = requestedConnectionId?.trim()
      || (member.connectionIds.values().next().value as string | undefined);
    if (!connectionId) {
      throw new Error('No active room connection for this member');
    }
    if (!member.connectionIds.has(connectionId)) {
      throw new Error('connectionId does not belong to the authenticated room member');
    }

    const existingMeta = this.findConnectionMeta(connectionId);
    const meta: RoomWSMeta = existingMeta
      ? {
          ...existingMeta,
          authenticated: true,
          userId: memberId,
          role: auth.role,
          auth,
        }
      : {
          authenticated: true,
          userId: memberId,
          role: auth.role,
          auth,
          connectionId,
          ip: request.headers.get('CF-Connecting-IP')
            || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
            || undefined,
          userAgent: request.headers.get('User-Agent') || undefined,
        };

    return { memberId, connectionId, meta };
  }

  private assertRealtimeSessionOwnership(memberId: string, sessionId: string): RoomMemberRealtimeSession {
    const session = this.memberRealtimeSessions.get(memberId);
    if (!session || session.sessionId !== sessionId) {
      throw new Error('Realtime session is not owned by the authenticated room member');
    }
    return session;
  }

  private assertRealtimeTracksResponseSuccess(response: CloudflareRealtimeTracksResponse): void {
    if (response.errorCode) {
      throw new Error(response.errorDescription || response.errorCode);
    }
    const trackFailure = response.tracks?.find((track) => track.errorCode);
    if (trackFailure?.errorCode) {
      throw new Error(trackFailure.errorDescription || trackFailure.errorCode);
    }
  }

  private hasPublishedTracks(memberId: string): boolean {
    const state = this.memberMediaStates.get(memberId);
    return !!state?.audio?.published || !!state?.video?.published || !!state?.screen?.published;
  }

  private hydrateRoomFromUrl(url: URL): void {
    const roomFullName = url.searchParams.get('room');
    if (!roomFullName || this.namespace) {
      return;
    }

    const separatorIdx = roomFullName.indexOf('::');
    if (separatorIdx >= 0) {
      this.namespace = roomFullName.substring(0, separatorIdx);
      this.roomId = roomFullName.substring(separatorIdx + 2);
    } else {
      this.namespace = roomFullName;
      this.roomId = roomFullName;
    }
    this.namespaceConfig = this.config.rooms?.[this.namespace] ?? null;
  }

  private extractBearerToken(request: Request): string | null {
    const header = request.headers.get('Authorization');
    if (!header) return null;
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() ?? null;
  }

  private async readJsonBody<T>(request: Request): Promise<T> {
    if (request.method === 'GET' || request.method === 'HEAD') {
      return {} as T;
    }
    try {
      return await request.json() as T;
    } catch {
      return {} as T;
    }
  }

  private jsonResponse<T>(status: number, body: T): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(message);
    } catch {
      this.safeSend(ws, { type: 'error', code: 'INVALID_JSON', message: 'Invalid JSON' });
      return;
    }

    if (msg.type === 'signal') {
      const meta = this.requireAuthenticatedMeta(ws);
      if (!meta) return;

      const event = typeof msg.event === 'string' ? msg.event : '';
      const requestId = typeof msg.requestId === 'string' ? msg.requestId : undefined;
      if (!this.checkRateLimit(meta.connectionId)) {
        this.safeSend(ws, {
          type: 'signal_error',
          event,
          message: 'Rate limited',
          requestId,
        });
        return;
      }

      await this.handleSignal(ws, meta, {
        type: 'signal',
        event,
        payload: msg.payload,
        memberId: typeof msg.memberId === 'string' ? msg.memberId : null,
        includeSelf: msg.includeSelf === true,
        requestId,
      });
      return;
    }

    if (msg.type === 'member_state') {
      const meta = this.requireAuthenticatedMeta(ws);
      if (!meta) return;
      await this.handleMemberState(ws, meta, {
        type: 'member_state',
        state: this.asRecord(msg.state),
        requestId: typeof msg.requestId === 'string' ? msg.requestId : undefined,
      });
      return;
    }

    if (msg.type === 'member_state_clear') {
      const meta = this.requireAuthenticatedMeta(ws);
      if (!meta) return;
      await this.handleMemberState(ws, meta, {
        type: 'member_state_clear',
        requestId: typeof msg.requestId === 'string' ? msg.requestId : undefined,
      });
      return;
    }

    if (msg.type === 'admin') {
      const meta = this.requireAuthenticatedMeta(ws);
      if (!meta) return;

      const operation = typeof msg.operation === 'string' ? msg.operation : '';
      const requestId = typeof msg.requestId === 'string' ? msg.requestId : undefined;
      if (!this.checkRateLimit(meta.connectionId)) {
        this.safeSend(ws, {
          type: 'admin_error',
          operation,
          message: 'Rate limited',
          requestId,
        });
        return;
      }

      await this.handleAdmin(ws, meta, {
        type: 'admin',
        operation,
        memberId: typeof msg.memberId === 'string' ? msg.memberId : null,
        payload: this.asRecord(msg.payload),
        requestId,
      });
      return;
    }

    if (msg.type === 'media') {
      const meta = this.requireAuthenticatedMeta(ws);
      if (!meta) return;

      const operation = this.normalizeMediaOperation(msg.operation);
      const kind = this.normalizeMediaKind(msg.kind);
      const requestId = typeof msg.requestId === 'string' ? msg.requestId : undefined;
      if (!this.checkRateLimit(meta.connectionId)) {
        this.safeSend(ws, {
          type: 'media_error',
          operation: operation ?? '',
          kind: kind ?? null,
          message: 'Rate limited',
          requestId,
        });
        return;
      }

      await this.handleMedia(ws, meta, {
        type: 'media',
        operation: operation ?? 'publish',
        kind: kind ?? undefined,
        payload: this.asRecord(msg.payload),
        requestId,
      });
      return;
    }

    await super.webSocketMessage(ws, message);
  }

  protected override async handleJoin(
    ws: WebSocket,
    meta: RoomWSMeta,
    msg: Record<string, unknown>,
  ): Promise<void> {
    const userId = meta.userId;
    if (userId && this.blockedMembers.has(userId)) {
      this.safeSend(ws, {
        type: 'error',
        code: 'JOIN_DENIED',
        message: 'Blocked from this room',
      });
      ws.close(4003, 'Join denied');
      return;
    }

    const existingMember = userId ? this.members.get(userId) : undefined;
    const hadMember = !!existingMember;
    const wasReconnecting = !!existingMember && existingMember.connectionIds.size === 0;

    await super.handleJoin(ws, meta, msg);

    if (!userId || !meta.authenticated || !this.isSocketOpen(ws)) {
      return;
    }

    const member = this.ensureMember(userId);
    this.joinedConnectionIds.add(meta.connectionId);
    member.connectionIds.add(meta.connectionId);

    if (!hadMember) {
      const snapshot = this.buildMemberSnapshot(member);
      await this.runMemberJoinHook(snapshot);
      this.broadcastToJoined({ type: 'member_join', member: snapshot }, meta.connectionId);
    }

    this.broadcastMembersSync();
    await this.sendMediaSyncToConnection(ws, meta);

    if (wasReconnecting) {
      await this.runSessionReconnectHook(this.buildSender(meta));
    }
  }

  protected override async handleExplicitLeave(ws: WebSocket, meta: RoomWSMeta): Promise<void> {
    const userId = meta.userId;
    const wasJoined = this.isJoinedConnection(meta.connectionId);

    await super.handleExplicitLeave(ws, meta);

    if (!userId || !wasJoined) {
      return;
    }

    const member = this.removeMemberConnection(userId, meta.connectionId);
    if (member) {
      if (member.connectionIds.size === 0) {
        await this.clearPublishedMedia(userId);
      }
      this.broadcastMembersSync();
    }
  }

  protected override async handleDisconnect(
    meta: RoomWSMeta,
    kicked = false,
    explicitLeave = false,
  ): Promise<void> {
    const userId = meta.userId;
    const wasJoined = this.isJoinedConnection(meta.connectionId);

    await super.handleDisconnect(meta, kicked, explicitLeave);

    if (!userId || !wasJoined || explicitLeave) {
      return;
    }

    const member = this.removeMemberConnection(userId, meta.connectionId);
    if (!member) {
      return;
    }

    if (member.connectionIds.size > 0) {
      this.broadcastMembersSync();
      return;
    }

    await this.clearPublishedMedia(userId);

    const reconnectTimeout = this.namespaceConfig?.reconnectTimeout ?? DEFAULT_MEMBER_RECONNECT_TIMEOUT_MS;
    if (!kicked && reconnectTimeout > 0) {
      this.broadcastMembersSync();
    }
  }

  protected override async finalizePlayerLeave(
    userId: string,
    connectionId: string,
    reason: 'leave' | 'disconnect' | 'kicked',
  ): Promise<void> {
    const member = this.members.get(userId);
    const snapshot = member ? this.buildMemberSnapshot(member, connectionId) : null;

    await super.finalizePlayerLeave(userId, connectionId, reason);

    if (!snapshot) {
      return;
    }

    if (reason === 'disconnect') {
      await this.runSessionDisconnectTimeoutHook({
        userId,
        connectionId,
        role: this.memberRoles.get(userId),
      });
    }

    this.deleteMember(userId);
    this.memberMediaStates.delete(userId);
    this.memberRealtimeSessions.delete(userId);

    const leaveReason: RoomMemberLeaveReason = reason === 'disconnect' ? 'timeout' : reason;
    await this.runMemberLeaveHook(snapshot, leaveReason);
    this.broadcastToJoined({
      type: 'member_leave',
      member: snapshot,
      reason: leaveReason,
    });
    this.broadcastMembersSync();
  }

  protected override buildRoomServerAPI(): RoomServerAPI {
    const roomApi = super.buildRoomServerAPI();
    return {
      ...roomApi,
      setSharedState: (updater: (state: Record<string, unknown>) => Record<string, unknown>): void => {
        const previous = roomApi.getSharedState();
        roomApi.setSharedState(updater);
        const next = roomApi.getSharedState();
        const delta = computeStateDelta(previous, next);
        if (delta) {
          void this.runSharedStateHook(delta, roomApi);
        }
      },
      sendMessage: (event: string, payload?: unknown, options?: { exclude?: string[] }): void => {
        roomApi.sendMessage(event, payload, options);
        void this.sendServerSignal({
          event,
          payload: payload ?? {},
          excludeUserIds: options?.exclude,
        });
      },
      sendMessageTo: (memberId: string, event: string, payload?: unknown): void => {
        roomApi.sendMessageTo(memberId, event, payload);
        void this.sendServerSignal({
          event,
          payload: payload ?? {},
          memberId,
        });
      },
    };
  }

  protected override buildSender(meta: RoomWSMeta): RoomSender {
    const sender = super.buildSender(meta);
    const role = meta.userId ? this.memberRoles.get(meta.userId) : undefined;
    return role ? { ...sender, role } : sender;
  }

  protected override buildAuthFromMeta(meta: RoomWSMeta): SharedAuthContext {
    const auth = super.buildAuthFromMeta(meta);
    const role = meta.userId ? this.memberRoles.get(meta.userId) ?? auth.role : auth.role;
    return role === auth.role ? auth : { ...auth, role };
  }

  private async handleAdmin(
    ws: WebSocket,
    meta: RoomWSMeta,
    msg: AdminMessage,
  ): Promise<void> {
    const operation = msg.operation.trim();
    const requestId = msg.requestId;
    if (!operation) {
      this.safeSend(ws, {
        type: 'admin_error',
        operation: '',
        message: 'operation is required',
        requestId,
      });
      return;
    }

    if (!meta.userId || !this.roomId) {
      this.safeSend(ws, {
        type: 'admin_error',
        operation,
        message: 'User not authenticated',
        requestId,
      });
      return;
    }

    if (!this.isJoinedConnection(meta.connectionId)) {
      this.safeSend(ws, {
        type: 'admin_error',
        operation,
        message: 'Join the room before issuing admin commands',
        requestId,
      });
      return;
    }

    const memberId = this.normalizeMemberId(msg.memberId);
    if (!memberId) {
      this.safeSend(ws, {
        type: 'admin_error',
        operation,
        message: 'memberId is required',
        requestId,
      });
      return;
    }

    const payload = msg.payload ?? {};
    if (!(await this.canRunAdmin(meta, operation, { memberId, ...payload }))) {
      this.safeSend(ws, {
        type: 'admin_error',
        operation,
        message: 'Denied by room admin access rule',
        requestId,
      });
      return;
    }

    try {
      switch (operation) {
        case 'kick':
          await this.kickPlayer(memberId);
          break;
        case 'block':
          this.blockedMembers.add(memberId);
          await this.kickPlayer(memberId);
          break;
        case 'setRole': {
          const role = typeof payload.role === 'string' ? payload.role.trim() : '';
          if (!role) {
            throw new Error('role is required');
          }
          this.syncMemberRole(memberId, role);
          this.broadcastMembersSync();
          break;
        }
        case 'mute':
          await this.applyMuteChange(memberId, 'audio', true);
          break;
        case 'disableVideo':
          await this.applyAdminUnpublish(memberId, 'video');
          break;
        case 'stopScreenShare':
          await this.applyAdminUnpublish(memberId, 'screen');
          break;
        default:
          throw new Error(`Unsupported admin operation '${operation}'`);
      }

      this.safeSend(ws, {
        type: 'admin_result',
        operation,
        memberId,
        requestId,
        result: { ok: true },
      });
    } catch (err) {
      this.safeSend(ws, {
        type: 'admin_error',
        operation,
        memberId,
        requestId,
        message: err instanceof Error ? err.message : 'Admin operation failed',
      });
    }
  }

  private async handleMedia(
    ws: WebSocket,
    meta: RoomWSMeta,
    msg: MediaMessage,
  ): Promise<void> {
    const operation = msg.operation;
    const kind = msg.kind;
    const requestId = msg.requestId;
    if (!operation || !kind) {
      this.safeSend(ws, {
        type: 'media_error',
        operation: operation ?? '',
        kind: kind ?? null,
        message: 'operation and kind are required',
        requestId,
      });
      return;
    }

    if (!meta.userId || !this.roomId) {
      this.safeSend(ws, {
        type: 'media_error',
        operation,
        kind,
        message: 'User not authenticated',
        requestId,
      });
      return;
    }

    if (!this.isJoinedConnection(meta.connectionId)) {
      this.safeSend(ws, {
        type: 'media_error',
        operation,
        kind,
        message: 'Join the room before using media controls',
        requestId,
      });
      return;
    }

    try {
      const payload = msg.payload ?? {};
      if (operation === 'publish') {
        if (!(await this.canPublishMedia(meta, kind, payload))) {
          throw new Error('Denied by room media publish access rule');
        }
      } else if (!(await this.canControlMedia(meta, operation, { kind, ...payload }))) {
        throw new Error('Denied by room media control access rule');
      }

      switch (operation) {
        case 'publish':
          await this.publishMedia(meta, kind, payload);
          break;
        case 'unpublish':
          await this.unpublishMedia(meta.userId, kind);
          break;
        case 'mute': {
          const muted = payload.muted === true;
          await this.applyMuteChange(meta.userId, kind, muted);
          break;
        }
        case 'device':
          await this.applyDeviceChange(meta.userId, kind, payload);
          break;
        default:
          throw new Error(`Unsupported media operation '${operation}'`);
      }

      this.safeSend(ws, {
        type: 'media_result',
        operation,
        kind,
        requestId,
        result: { ok: true },
      });
    } catch (err) {
      this.safeSend(ws, {
        type: 'media_error',
        operation,
        kind,
        requestId,
        message: err instanceof Error ? err.message : 'Media operation failed',
      });
    }
  }

  private async handleSignal(
    ws: WebSocket,
    meta: RoomWSMeta,
    msg: SignalMessage,
  ): Promise<void> {
    const event = typeof msg.event === 'string' ? msg.event.trim() : '';
    const requestId = typeof msg.requestId === 'string' ? msg.requestId : undefined;

    if (!event) {
      this.safeSend(ws, {
        type: 'signal_error',
        event: '',
        message: 'event is required',
        requestId,
      });
      return;
    }

    if (!meta.userId || !this.roomId) {
      this.safeSend(ws, {
        type: 'signal_error',
        event,
        message: 'User not authenticated',
        requestId,
      });
      return;
    }

    if (!this.isJoinedConnection(meta.connectionId)) {
      this.safeSend(ws, {
        type: 'signal_error',
        event,
        message: 'Join the room before sending signals',
        requestId,
      });
      return;
    }

    if (!(await this.canSendSignal(meta, event, msg.payload))) {
      this.safeSend(ws, {
        type: 'signal_error',
        event,
        message: 'Denied by room signal access rule',
        requestId,
      });
      return;
    }

    const sender = this.buildSender(meta);
    const roomApi = this.buildRoomServerAPI();
    const signalCtx = {
      event,
      payload: msg.payload,
      sender,
      roomApi,
      memberId: this.normalizeMemberId(msg.memberId),
      includeSelf: msg.includeSelf === true,
      meta: this.buildSignalFrameMeta(sender, false),
    };
    const transformedPayload = await this.applySignalBeforeSend(signalCtx);
    if (transformedPayload === SIGNAL_DENIED) {
      this.safeSend(ws, {
        type: 'signal_error',
        event,
        message: 'Rejected by room signal hook',
        requestId,
      });
      return;
    }

    this.deliverSignal(
      {
        type: 'signal',
        event,
        payload: transformedPayload,
        meta: signalCtx.meta,
      },
      {
        memberId: signalCtx.memberId,
        includeSelf: signalCtx.includeSelf,
        senderConnectionId: meta.connectionId,
      },
    );

    this.safeSend(ws, {
      type: 'signal_sent',
      event,
      memberId: signalCtx.memberId,
      requestId,
    });

    await this.runSignalOnSend(event, transformedPayload, sender, roomApi);
  }

  private async handleMemberState(
    ws: WebSocket,
    meta: RoomWSMeta,
    msg: MemberStateMessage | MemberStateClearMessage,
  ): Promise<void> {
    if (!meta.userId) {
      this.safeSend(ws, {
        type: 'member_state_error',
        message: 'User not authenticated',
        requestId: msg.requestId,
      });
      return;
    }

    if (!this.isJoinedConnection(meta.connectionId)) {
      this.safeSend(ws, {
        type: 'member_state_error',
        message: 'Join the room before updating member state',
        requestId: msg.requestId,
      });
      return;
    }

    const member = this.ensureMember(meta.userId);
    if (msg.type === 'member_state') {
      if (!msg.state) {
        this.safeSend(ws, {
          type: 'member_state_error',
          message: 'state must be an object',
          requestId: msg.requestId,
        });
        return;
      }

      member.state = {
        ...member.state,
        ...msg.state,
      };
    } else {
      member.state = {};
    }

    const snapshot = this.buildMemberSnapshot(member);
    const state = { ...member.state };
    this.broadcastToJoined({
      type: 'member_state',
      member: snapshot,
      state,
      requestId: msg.requestId,
    });
    this.broadcastMembersSync();
    await this.runMemberStateHook(snapshot, state);
  }

  private async sendServerSignal(input: {
    event: string;
    payload: unknown;
    memberId?: string;
    excludeUserIds?: string[];
  }): Promise<void> {
    const event = input.event.trim();
    if (!event) return;

    const roomApi = this.buildRoomServerAPI();
    const signalCtx = {
      event,
      payload: input.payload,
      sender: SYSTEM_SIGNAL_SENDER,
      roomApi,
      memberId: this.normalizeMemberId(input.memberId),
      includeSelf: true,
      meta: this.buildSignalFrameMeta(SYSTEM_SIGNAL_SENDER, true),
    };
    const transformedPayload = await this.applySignalBeforeSend(signalCtx);
    if (transformedPayload === SIGNAL_DENIED) return;

    this.deliverSignal(
      {
        type: 'signal',
        event,
        payload: transformedPayload,
        meta: signalCtx.meta,
      },
      {
        memberId: signalCtx.memberId,
        includeSelf: true,
        excludeUserIds: input.excludeUserIds,
      },
    );

    await this.runSignalOnSend(event, transformedPayload, SYSTEM_SIGNAL_SENDER, roomApi);
  }

  private async canSendSignal(
    meta: RoomWSMeta,
    event: string,
    payload: unknown,
  ): Promise<boolean> {
    if (!this.namespaceConfig?.access?.signal || !this.roomId) {
      return !this.config.release;
    }

    try {
      return await Promise.resolve(
        this.namespaceConfig.access.signal(
          this.buildAuthFromMeta(meta),
          this.roomId,
          event,
          payload,
        ),
      );
    } catch {
      return false;
    }
  }

  private async applySignalBeforeSend(signal: {
    event: string;
    payload: unknown;
    sender: RoomSender;
    roomApi: RoomServerAPI;
    memberId?: string;
    includeSelf: boolean;
    meta: SignalFrameMeta;
  }): Promise<unknown | typeof SIGNAL_DENIED> {
    const beforeSend = getRoomHooks(this.namespaceConfig ?? undefined)?.signals?.beforeSend;
    if (!beforeSend) return signal.payload;

    const ctx = this.buildHandlerContext();
    const result = await Promise.resolve(
      beforeSend(signal.event, signal.payload, signal.sender, signal.roomApi, ctx),
    );
    if (result === false) return SIGNAL_DENIED;
    return result === undefined ? signal.payload : result;
  }

  private async runSignalOnSend(
    event: string,
    payload: unknown,
    sender: RoomSender,
    roomApi: RoomServerAPI,
  ): Promise<void> {
    const onSend = getRoomHooks(this.namespaceConfig ?? undefined)?.signals?.onSend;
    if (!onSend) return;

    try {
      const ctx = this.buildHandlerContext();
      await Promise.resolve(onSend(event, payload, sender, roomApi, ctx));
    } catch (err) {
      console.error(`[Rooms] signal.onSend error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async runMemberJoinHook(member: RoomMemberSnapshot): Promise<void> {
    const onJoin = getRoomHooks(this.namespaceConfig ?? undefined)?.members?.onJoin;
    if (!onJoin) return;

    try {
      const roomApi = this.buildRoomServerAPI();
      const ctx = this.buildHandlerContext();
      await Promise.resolve(onJoin(member, roomApi, ctx));
    } catch (err) {
      console.error(`[Rooms] members.onJoin error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async runMemberLeaveHook(
    member: RoomMemberSnapshot,
    reason: RoomMemberLeaveReason,
  ): Promise<void> {
    const onLeave = getRoomHooks(this.namespaceConfig ?? undefined)?.members?.onLeave;
    if (!onLeave) return;

    try {
      const roomApi = this.buildRoomServerAPI();
      const ctx = this.buildHandlerContext();
      await Promise.resolve(onLeave(member, roomApi, ctx, reason));
    } catch (err) {
      console.error(`[Rooms] members.onLeave error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async runMemberStateHook(
    member: RoomMemberSnapshot,
    state: Record<string, unknown>,
  ): Promise<void> {
    const onStateChange = getRoomHooks(this.namespaceConfig ?? undefined)?.members?.onStateChange;
    if (!onStateChange) return;

    try {
      const roomApi = this.buildRoomServerAPI();
      const ctx = this.buildHandlerContext();
      await Promise.resolve(onStateChange(member, state, roomApi, ctx));
    } catch (err) {
      console.error(`[Rooms] members.onStateChange error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async runSharedStateHook(
    delta: Record<string, unknown>,
    roomApi: RoomServerAPI,
  ): Promise<void> {
    const onStateChange = getRoomHooks(this.namespaceConfig ?? undefined)?.state?.onStateChange;
    if (!onStateChange) return;

    try {
      const ctx = this.buildHandlerContext();
      await Promise.resolve(onStateChange(delta, roomApi, ctx));
    } catch (err) {
      console.error(`[Rooms] state.onStateChange error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async runSessionReconnectHook(sender: RoomSender): Promise<void> {
    const onReconnect = getRoomHooks(this.namespaceConfig ?? undefined)?.session?.onReconnect;
    if (!onReconnect) return;

    try {
      const roomApi = this.buildRoomServerAPI();
      const ctx = this.buildHandlerContext();
      await Promise.resolve(onReconnect(sender, roomApi, ctx));
    } catch (err) {
      console.error(`[Rooms] session.onReconnect error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async runSessionDisconnectTimeoutHook(sender: RoomSender): Promise<void> {
    const onDisconnectTimeout = getRoomHooks(this.namespaceConfig ?? undefined)?.session?.onDisconnectTimeout;
    if (!onDisconnectTimeout) return;

    try {
      const roomApi = this.buildRoomServerAPI();
      const ctx = this.buildHandlerContext();
      await Promise.resolve(onDisconnectTimeout(sender, roomApi, ctx));
    } catch (err) {
      console.error(`[Rooms] session.onDisconnectTimeout error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async canRunAdmin(
    meta: RoomWSMeta,
    operation: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const adminAccess = this.namespaceConfig?.access?.admin;
    if (!adminAccess || !this.roomId) {
      return !this.config.release;
    }

    try {
      return await Promise.resolve(
        adminAccess(this.buildAuthFromMeta(meta), this.roomId, operation, payload),
      );
    } catch {
      return false;
    }
  }

  private async canPublishMedia(
    meta: RoomWSMeta,
    kind: MediaKind,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const publishAccess = this.namespaceConfig?.access?.media?.publish;
    if (!publishAccess || !this.roomId) {
      return !this.config.release;
    }

    try {
      return await Promise.resolve(
        publishAccess(this.buildAuthFromMeta(meta), this.roomId, kind, payload),
      );
    } catch {
      return false;
    }
  }

  private async canControlMedia(
    meta: RoomWSMeta,
    operation: MediaMessage['operation'],
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const controlAccess = this.namespaceConfig?.access?.media?.control;
    if (!controlAccess || !this.roomId) {
      return !this.config.release;
    }

    try {
      return await Promise.resolve(
        controlAccess(this.buildAuthFromMeta(meta), this.roomId, operation, payload),
      );
    } catch {
      return false;
    }
  }

  private async canSubscribeToMedia(
    meta: RoomWSMeta,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    if (meta.userId && payload.memberId === meta.userId) {
      return true;
    }

    const subscribeAccess = this.namespaceConfig?.access?.media?.subscribe;
    if (!subscribeAccess || !this.roomId) {
      return !this.config.release;
    }

    try {
      return await Promise.resolve(
        subscribeAccess(this.buildAuthFromMeta(meta), this.roomId, payload),
      );
    } catch {
      return false;
    }
  }

  private ensureMemberMediaState(memberId: string): RoomMemberMediaState {
    let mediaState = this.memberMediaStates.get(memberId);
    if (!mediaState) {
      mediaState = {};
      this.memberMediaStates.set(memberId, mediaState);
    }
    return mediaState;
  }

  private getKindState(memberId: string, kind: MediaKind): RoomMemberMediaKindState {
    const mediaState = this.ensureMemberMediaState(memberId);
    mediaState[kind] ??= {
      published: false,
      muted: false,
    };
    return mediaState[kind]!;
  }

  private pruneMediaKindState(memberId: string, kind: MediaKind): void {
    const mediaState = this.memberMediaStates.get(memberId);
    const kindState = mediaState?.[kind];
    if (!mediaState || !kindState) {
      return;
    }

    if (
      !kindState.published &&
      !kindState.muted &&
      !kindState.trackId &&
      !kindState.deviceId &&
      !kindState.publishedAt &&
      !kindState.adminDisabled &&
      !kindState.providerSessionId
    ) {
      delete mediaState[kind];
    }

    if (!mediaState.audio && !mediaState.video && !mediaState.screen) {
      this.memberMediaStates.delete(memberId);
    }
  }

  private buildMediaStateSnapshot(memberId: string): RoomMemberMediaState {
    const mediaState = this.memberMediaStates.get(memberId);
    if (!mediaState) {
      return {};
    }

    const snapshot: RoomMemberMediaState = {};
    for (const kind of ['audio', 'video', 'screen'] as const) {
      const kindState = mediaState[kind];
      if (kindState) {
        snapshot[kind] = { ...kindState };
      }
    }
    return snapshot;
  }

  private buildMediaTrackFrame(memberId: string, kind: MediaKind): {
    kind: MediaKind;
    trackId?: string;
    deviceId?: string;
    muted: boolean;
    publishedAt?: number;
    adminDisabled?: boolean;
    providerSessionId?: string;
  } | null {
    const kindState = this.memberMediaStates.get(memberId)?.[kind];
    if (!kindState?.published) {
      return null;
    }

    return {
      kind,
      trackId: kindState.trackId,
      deviceId: kindState.deviceId,
      muted: kindState.muted,
      publishedAt: kindState.publishedAt,
      adminDisabled: kindState.adminDisabled,
      providerSessionId: kindState.providerSessionId,
    };
  }

  private listPublishedTracks(memberId: string): Array<{
    kind: MediaKind;
    trackId?: string;
    deviceId?: string;
    muted: boolean;
    publishedAt?: number;
    adminDisabled?: boolean;
    providerSessionId?: string;
  }> {
    const tracks: Array<{
      kind: MediaKind;
      trackId?: string;
      deviceId?: string;
      muted: boolean;
      publishedAt?: number;
      adminDisabled?: boolean;
      providerSessionId?: string;
    }> = [];
    for (const kind of ['audio', 'video', 'screen'] as const) {
      const track = this.buildMediaTrackFrame(memberId, kind);
      if (track) {
        tracks.push(track);
      }
    }
    return tracks;
  }

  private buildMemberSender(memberId: string): RoomSender {
    const member = this.members.get(memberId);
    const info = member
      ? this.buildMemberInfo(member)
      : { memberId, userId: memberId, connectionId: undefined, connectionCount: 0, role: this.memberRoles.get(memberId) };

    return {
      userId: info.userId,
      connectionId: info.connectionId ?? 'server',
      role: info.role,
    };
  }

  private async publishMedia(
    meta: RoomWSMeta,
    kind: MediaKind,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!meta.userId) {
      throw new Error('User not authenticated');
    }

    const member = this.members.get(meta.userId);
    if (!member) {
      throw new Error('Member is not joined');
    }

    const sender = this.buildSender(meta);
    const roomApi = this.buildRoomServerAPI();
    const beforePublish = await this.applyMediaBeforePublish(kind, sender, roomApi);
    if (beforePublish === MEDIA_DENIED) {
      throw new Error('Rejected by room media hook');
    }

    const nextPayload = beforePublish && typeof beforePublish === 'object' && !Array.isArray(beforePublish)
      ? { ...payload, ...(beforePublish as Record<string, unknown>) }
      : payload;
    const previousTrack = this.buildMediaTrackFrame(meta.userId, kind);
    const kindState = this.getKindState(meta.userId, kind);
    const trackId = typeof nextPayload.trackId === 'string' && nextPayload.trackId.trim()
      ? nextPayload.trackId.trim()
      : kindState.trackId ?? `${kind}-${crypto.randomUUID()}`;
    const deviceId = typeof nextPayload.deviceId === 'string' && nextPayload.deviceId.trim()
      ? nextPayload.deviceId.trim()
      : kindState.deviceId;
    const providerSessionId =
      typeof nextPayload.providerSessionId === 'string' && nextPayload.providerSessionId.trim()
        ? nextPayload.providerSessionId.trim()
        : kindState.providerSessionId;

    kindState.published = true;
    kindState.muted = nextPayload.muted === true ? true : kindState.muted;
    kindState.trackId = trackId;
    kindState.deviceId = deviceId;
    kindState.publishedAt = Date.now();
    kindState.adminDisabled = false;
    kindState.providerSessionId = providerSessionId;

    if (previousTrack && previousTrack.trackId !== trackId) {
      await this.broadcastMediaTrackRemoved(meta.userId, kind, previousTrack);
    }

    await this.broadcastMediaTrack(meta.userId, kind);
    await this.broadcastMediaState(meta.userId);
    await this.runMediaPublishedHook(kind, sender, roomApi);
  }

  private async unpublishMedia(memberId: string, kind: MediaKind): Promise<void> {
    const mediaState = this.memberMediaStates.get(memberId);
    const kindState = mediaState?.[kind];
    if (!kindState) {
      return;
    }

    const previousTrack = this.buildMediaTrackFrame(memberId, kind);
    if (!kindState.published && !previousTrack) {
      kindState.trackId = undefined;
      kindState.publishedAt = undefined;
      kindState.adminDisabled = false;
      kindState.providerSessionId = undefined;
      this.pruneMediaKindState(memberId, kind);
      return;
    }

    kindState.published = false;
    kindState.trackId = undefined;
    kindState.publishedAt = undefined;
    kindState.adminDisabled = false;
    kindState.providerSessionId = undefined;
    this.pruneMediaKindState(memberId, kind);

    if (previousTrack) {
      await this.broadcastMediaTrackRemoved(memberId, kind, previousTrack);
      await this.broadcastMediaState(memberId);
      await this.runMediaUnpublishedHook(kind, this.buildMemberSender(memberId), this.buildRoomServerAPI());
    }
  }

  private async applyMuteChange(
    memberId: string,
    kind: MediaKind,
    muted: boolean,
  ): Promise<void> {
    if (!this.members.has(memberId) && !this.memberMediaStates.has(memberId)) {
      throw new Error('Unknown member');
    }

    const kindState = this.getKindState(memberId, kind);
    if (kindState.muted === muted) {
      return;
    }

    kindState.muted = muted;
    this.pruneMediaKindState(memberId, kind);
    await this.broadcastMediaState(memberId);
    await this.runMediaMuteChangeHook(
      kind,
      this.buildMemberSender(memberId),
      muted,
      this.buildRoomServerAPI(),
    );
  }

  private async applyDeviceChange(
    memberId: string,
    kind: MediaKind,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.members.has(memberId) && !this.memberMediaStates.has(memberId)) {
      throw new Error('Unknown member');
    }

    const deviceId = typeof payload.deviceId === 'string' ? payload.deviceId.trim() : '';
    if (!deviceId) {
      throw new Error('deviceId is required');
    }

    const kindState = this.getKindState(memberId, kind);
    if (kindState.deviceId === deviceId) {
      return;
    }

    kindState.deviceId = deviceId;
    await this.broadcastMediaState(memberId);
    await this.broadcastMediaDevice(memberId, kind, deviceId);
  }

  private async applyAdminUnpublish(memberId: string, kind: MediaKind): Promise<void> {
    const kindState = this.getKindState(memberId, kind);
    kindState.adminDisabled = true;
    await this.unpublishMedia(memberId, kind);
  }

  private async clearPublishedMedia(memberId: string): Promise<void> {
    for (const kind of ['audio', 'video', 'screen'] as const) {
      await this.unpublishMedia(memberId, kind);
    }
  }

  private async applyMediaBeforePublish(
    kind: MediaKind,
    sender: RoomSender,
    roomApi: RoomServerAPI,
  ): Promise<unknown | typeof MEDIA_DENIED> {
    const beforePublish = getRoomHooks(this.namespaceConfig ?? undefined)?.media?.beforePublish;
    if (!beforePublish) {
      return undefined;
    }

    const ctx = this.buildHandlerContext();
    const result = await Promise.resolve(beforePublish(kind, sender, roomApi, ctx));
    if (result === false) {
      return MEDIA_DENIED;
    }
    return result;
  }

  private async runMediaPublishedHook(
    kind: MediaKind,
    sender: RoomSender,
    roomApi: RoomServerAPI,
  ): Promise<void> {
    const onPublished = getRoomHooks(this.namespaceConfig ?? undefined)?.media?.onPublished;
    if (!onPublished) return;

    try {
      const ctx = this.buildHandlerContext();
      await Promise.resolve(onPublished(kind, sender, roomApi, ctx));
    } catch (err) {
      console.error(`[Rooms] media.onPublished error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async runMediaUnpublishedHook(
    kind: MediaKind,
    sender: RoomSender,
    roomApi: RoomServerAPI,
  ): Promise<void> {
    const onUnpublished = getRoomHooks(this.namespaceConfig ?? undefined)?.media?.onUnpublished;
    if (!onUnpublished) return;

    try {
      const ctx = this.buildHandlerContext();
      await Promise.resolve(onUnpublished(kind, sender, roomApi, ctx));
    } catch (err) {
      console.error(`[Rooms] media.onUnpublished error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async runMediaMuteChangeHook(
    kind: MediaKind,
    sender: RoomSender,
    muted: boolean,
    roomApi: RoomServerAPI,
  ): Promise<void> {
    const onMuteChange = getRoomHooks(this.namespaceConfig ?? undefined)?.media?.onMuteChange;
    if (!onMuteChange) return;

    try {
      const ctx = this.buildHandlerContext();
      await Promise.resolve(onMuteChange(kind, sender, muted, roomApi, ctx));
    } catch (err) {
      console.error(`[Rooms] media.onMuteChange error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async broadcastMediaTrack(memberId: string, kind: MediaKind): Promise<void> {
    const member = this.members.get(memberId);
    const track = this.buildMediaTrackFrame(memberId, kind);
    if (!member || !track) {
      return;
    }

    await this.broadcastMediaFrame(
      {
        type: 'media_track',
        member: this.buildMemberInfo(member),
        track,
      },
      {
        event: 'track',
        memberId,
        kind,
        track,
      },
    );
  }

  private async broadcastMediaTrackRemoved(
    memberId: string,
    kind: MediaKind,
    track?: {
      kind: MediaKind;
      trackId?: string;
      deviceId?: string;
      muted: boolean;
      publishedAt?: number;
      adminDisabled?: boolean;
    } | null,
  ): Promise<void> {
    const member = this.members.get(memberId);
    if (!member) {
      return;
    }

    await this.broadcastMediaFrame(
      {
        type: 'media_track_removed',
        member: this.buildMemberInfo(member),
        track: track ?? { kind },
      },
      {
        event: 'track_removed',
        memberId,
        kind,
        track: track ?? { kind },
      },
    );
  }

  private async broadcastMediaState(memberId: string): Promise<void> {
    const member = this.members.get(memberId);
    if (!member) {
      return;
    }

    const state = this.buildMediaStateSnapshot(memberId);
    await this.broadcastMediaFrame(
      {
        type: 'media_state',
        member: this.buildMemberInfo(member),
        state,
      },
      {
        event: 'state',
        memberId,
        state,
      },
    );
  }

  private async broadcastMediaDevice(
    memberId: string,
    kind: MediaKind,
    deviceId: string,
  ): Promise<void> {
    const member = this.members.get(memberId);
    if (!member) {
      return;
    }

    await this.broadcastMediaFrame(
      {
        type: 'media_device',
        member: this.buildMemberInfo(member),
        kind,
        deviceId,
      },
      {
        event: 'device',
        memberId,
        kind,
        deviceId,
      },
    );
  }

  private async broadcastMediaFrame(
    frame: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const json = JSON.stringify(frame);
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.getWSMeta(ws);
      if (!meta?.authenticated || !this.joinedConnectionIds.has(meta.connectionId)) {
        continue;
      }
      if (!(await this.canSubscribeToMedia(meta, payload))) {
        continue;
      }
      this.safeSendRaw(ws, json);
    }
  }

  private async sendMediaSyncToConnection(ws: WebSocket, meta: RoomWSMeta): Promise<void> {
    if (!this.isSocketOpen(ws) || !meta.userId) {
      return;
    }

    const members: Array<{
      member: RoomMemberInfo;
      state: RoomMemberMediaState;
      tracks: Array<{
        kind: MediaKind;
        trackId?: string;
        deviceId?: string;
        muted: boolean;
        publishedAt?: number;
        adminDisabled?: boolean;
      }>;
    }> = [];

    for (const member of this.listMembers()) {
      const state = this.buildMediaStateSnapshot(member.memberId);
      const tracks = this.listPublishedTracks(member.memberId);
      if (Object.keys(state).length === 0 && tracks.length === 0) {
        continue;
      }
      if (!(await this.canSubscribeToMedia(meta, {
        event: 'sync',
        memberId: member.memberId,
        state,
        tracks,
      }))) {
        continue;
      }
      members.push({ member, state, tracks });
    }

    this.safeSend(ws, {
      type: 'media_sync',
      members,
    });
  }

  private normalizeMediaOperation(operation: unknown): MediaMessage['operation'] | null {
    if (typeof operation !== 'string') {
      return null;
    }
    switch (operation.trim()) {
      case 'publish':
      case 'unpublish':
      case 'mute':
      case 'device':
        return operation.trim() as MediaMessage['operation'];
      default:
        return null;
    }
  }

  private normalizeMediaKind(kind: unknown): MediaKind | null {
    if (typeof kind !== 'string') {
      return null;
    }
    switch (kind.trim()) {
      case 'audio':
      case 'video':
      case 'screen':
        return kind.trim() as MediaKind;
      default:
        return null;
    }
  }

  private deliverSignal(
    frame: {
      type: 'signal';
      event: string;
      payload: unknown;
      meta: SignalFrameMeta;
    },
    options: {
      memberId?: string;
      includeSelf: boolean;
      senderConnectionId?: string;
      excludeUserIds?: string[];
    },
  ): void {
    if (options.memberId) {
      this.sendSignalToMember(options.memberId, frame);
      return;
    }

    this.broadcastToJoined(
      frame,
      options.includeSelf ? undefined : options.senderConnectionId,
      options.excludeUserIds,
    );
  }

  private sendSignalToMember(
    memberId: string,
    frame: {
      type: 'signal';
      event: string;
      payload: unknown;
      meta: SignalFrameMeta;
    },
  ): void {
    const member = this.members.get(memberId);
    if (!member || member.connectionIds.size === 0) {
      return;
    }

    const json = JSON.stringify(frame);
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.getWSMeta(ws);
      if (meta?.authenticated && member.connectionIds.has(meta.connectionId)) {
        this.safeSendRaw(ws, json);
      }
    }
  }

  private broadcastMembersSync(): void {
    this.broadcastToJoined({
      type: 'members_sync',
      members: this.listMembers(),
    });
  }

  private broadcastToJoined(
    msg: Record<string, unknown>,
    excludeConnectionId?: string,
    excludeUserIds?: string[],
  ): void {
    if (this.joinedConnectionIds.size === 0) {
      return;
    }

    const json = JSON.stringify(msg);
    const excludeSet = excludeUserIds?.length ? new Set(excludeUserIds) : null;
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.getWSMeta(ws);
      if (!meta?.authenticated || !this.joinedConnectionIds.has(meta.connectionId)) {
        continue;
      }
      if (excludeConnectionId && meta.connectionId === excludeConnectionId) {
        continue;
      }
      if (excludeSet && meta.userId && excludeSet.has(meta.userId)) {
        continue;
      }
      this.safeSendRaw(ws, json);
    }
  }

  private ensureMember(userId: string): RoomMemberPresence {
    let member = this.members.get(userId);
    if (!member) {
      member = {
        memberId: userId,
        userId,
        joinedAt: Date.now(),
        connectionIds: new Set<string>(),
        state: {},
      };
      this.members.set(userId, member);
    }
    return member;
  }

  private removeMemberConnection(userId: string, connectionId: string): RoomMemberPresence | null {
    this.joinedConnectionIds.delete(connectionId);
    const member = this.members.get(userId);
    if (!member) {
      return null;
    }

    member.connectionIds.delete(connectionId);
    return member;
  }

  private deleteMember(userId: string): void {
    const member = this.members.get(userId);
    if (!member) {
      return;
    }

    for (const connectionId of member.connectionIds) {
      this.joinedConnectionIds.delete(connectionId);
    }
    this.members.delete(userId);
  }

  private listMembers(): RoomMemberSnapshot[] {
    return Array.from(this.members.values())
      .sort((left, right) => left.joinedAt - right.joinedAt || left.memberId.localeCompare(right.memberId))
      .map((member) => this.buildMemberSnapshot(member));
  }

  private buildMemberSnapshot(
    member: RoomMemberPresence,
    fallbackConnectionId?: string,
  ): RoomMemberSnapshot {
    return {
      ...this.buildMemberInfo(member, fallbackConnectionId),
      state: { ...member.state },
    };
  }

  private buildMemberInfo(
    member: RoomMemberPresence,
    fallbackConnectionId?: string,
  ): RoomMemberInfo {
    const activeConnectionId = member.connectionIds.values().next().value as string | undefined;
    const connectionId = activeConnectionId ?? fallbackConnectionId;
    const meta = connectionId ? this.findConnectionMeta(connectionId) : null;
    const role = this.memberRoles.get(member.memberId) ?? meta?.role;

    return {
      memberId: member.memberId,
      userId: member.userId,
      connectionId,
      connectionCount: member.connectionIds.size,
      role,
    };
  }

  private findConnectionMeta(connectionId: string): RoomWSMeta | null {
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.getWSMeta(ws);
      if (meta?.connectionId === connectionId) {
        return meta;
      }
    }
    return null;
  }

  private buildSignalFrameMeta(sender: RoomSender, serverSent: boolean): SignalFrameMeta {
    return {
      memberId: serverSent ? null : sender.userId,
      userId: serverSent ? null : sender.userId,
      connectionId: serverSent ? null : sender.connectionId,
      sentAt: Date.now(),
      serverSent,
    };
  }

  private normalizeMemberId(memberId: string | null | undefined): string | undefined {
    if (typeof memberId !== 'string') return undefined;
    const trimmed = memberId.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private requireAuthenticatedMeta(ws: WebSocket): RoomWSMeta | null {
    const meta = this.getWSMeta(ws);
    if (!meta) {
      ws.close(4000, 'No metadata');
      return null;
    }

    if (!meta.authenticated) {
      this.safeSend(ws, { type: 'error', code: 'NOT_AUTHENTICATED', message: 'Authenticate first' });
      return null;
    }

    return meta;
  }

  private isJoinedConnection(connectionId: string): boolean {
    return this.joinedConnectionIds.has(connectionId);
  }

  private isSocketOpen(ws: WebSocket): boolean {
    return ws.readyState === WEBSOCKET_OPEN;
  }

  private syncMemberRole(memberId: string, role: string): void {
    this.memberRoles.set(memberId, role);

    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.getWSMeta(ws);
      if (!meta || meta.userId !== memberId) {
        continue;
      }

      meta.role = role;
      if (meta.auth) {
        meta.auth = { ...meta.auth, role };
      }
      this.setWSMeta(ws, meta);
    }
  }
}
