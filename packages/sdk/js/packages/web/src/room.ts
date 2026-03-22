/**
 * RoomClient v2 — Client-side room connection for real-time multiplayer state.
 *
 *: Complete redesign from v1.
 *   - 3 state areas: sharedState (all clients), playerState (per-player), serverState (server-only, not sent)
 *   - Client can only read + subscribe + send(). All writes are server-only.
 *   - send() returns a Promise resolved by requestId matching
 *   - Subscription returns { unsubscribe() } object
 *   - namespace + roomId identification (replaces single roomId)
 */
import type { TokenManager, TokenUser } from './token-manager.js';
import { EdgeBaseError } from '@edge-base/core';
import { refreshAccessToken } from './auth-refresh.js';
import type { RoomRealtimeMediaTransportOptions } from './room-realtime-media.js';
import {
  RoomCloudflareMediaTransport,
  type RoomCloudflareMediaTransportOptions,
} from './room-cloudflare-media.js';
import {
  RoomP2PMediaTransport,
  type RoomP2PMediaTransportOptions,
} from './room-p2p-media.js';

// ─── Types ───

export interface RoomOptions {
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Max reconnect attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Base delay for reconnect backoff in ms (default: 1000) */
  reconnectBaseDelay?: number;
  /** Timeout for send() requests in ms (default: 10000) */
  sendTimeout?: number;
  /** Timeout for WebSocket connection establishment in ms (default: 15000) */
  connectionTimeout?: number;
}

export interface Subscription {
  unsubscribe(): void;
}

export type SharedStateHandler = (state: Record<string, unknown>, changes: Record<string, unknown>) => void;
export type PlayerStateHandler = (state: Record<string, unknown>, changes: Record<string, unknown>) => void;
export type MessageHandler = (data: unknown) => void;
export type ErrorHandler = (error: { code: string; message: string }) => void;
export type KickedHandler = () => void;
export type RoomConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'auth_lost'
  | 'kicked';
export type RoomMemberLeaveReason = 'leave' | 'timeout' | 'kicked';

export interface RoomSignalMeta {
  memberId?: string | null;
  userId?: string | null;
  connectionId?: string | null;
  sentAt?: number;
  serverSent?: boolean;
}

export interface RoomMember {
  memberId: string;
  userId: string;
  connectionId?: string;
  connectionCount?: number;
  role?: string;
  state: Record<string, unknown>;
}

export interface RoomReconnectInfo {
  attempt: number;
}

export type RoomMediaKind = 'audio' | 'video' | 'screen';

export interface RoomMediaTrack {
  kind: RoomMediaKind;
  trackId?: string;
  deviceId?: string;
  muted: boolean;
  publishedAt?: number;
  adminDisabled?: boolean;
  providerSessionId?: string;
}

export interface RoomMemberMediaKindState {
  published: boolean;
  muted: boolean;
  trackId?: string;
  deviceId?: string;
  publishedAt?: number;
  adminDisabled?: boolean;
  providerSessionId?: string;
}

export interface RoomMemberMediaState {
  audio?: RoomMemberMediaKindState;
  video?: RoomMemberMediaKindState;
  screen?: RoomMemberMediaKindState;
}

export interface RoomMediaMember {
  member: RoomMember;
  state: RoomMemberMediaState;
  tracks: RoomMediaTrack[];
}

export interface RoomMediaDeviceChange {
  kind: RoomMediaKind;
  deviceId: string;
}

export interface RoomRealtimeSessionDescription {
  sdp: string;
  type: 'offer' | 'answer';
}

export interface RoomRealtimeTrackObject {
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
  errorCode?: string;
  errorDescription?: string;
}

export interface RoomRealtimeCreateSessionRequest {
  connectionId?: string;
  correlationId?: string;
  thirdparty?: boolean;
  sessionDescription?: RoomRealtimeSessionDescription;
}

export interface RoomRealtimeCreateSessionResponse {
  sessionId: string;
  sessionDescription?: RoomRealtimeSessionDescription;
  errorCode?: string;
  errorDescription?: string;
  connectionId?: string;
  reused?: boolean;
}

export interface RoomRealtimeIceServer {
  urls: string[] | string;
  username?: string;
  credential?: string;
}

export interface RoomRealtimeIceServersRequest {
  ttl?: number;
}

export interface RoomRealtimeIceServersResponse {
  iceServers: RoomRealtimeIceServer[];
}

export interface RoomRealtimeTracksRequest {
  sessionId: string;
  connectionId?: string;
  sessionDescription?: RoomRealtimeSessionDescription;
  tracks: RoomRealtimeTrackObject[];
  autoDiscover?: boolean;
  publish?: {
    kind?: RoomMediaKind;
    trackId?: string;
    deviceId?: string;
    muted?: boolean;
  };
}

export interface RoomRealtimeTracksResponse {
  errorCode?: string;
  errorDescription?: string;
  requiresImmediateRenegotiation?: boolean;
  sessionDescription?: RoomRealtimeSessionDescription;
  tracks?: RoomRealtimeTrackObject[];
}

export interface RoomRealtimeRenegotiateRequest {
  sessionId: string;
  connectionId?: string;
  sessionDescription: RoomRealtimeSessionDescription;
}

export interface RoomRealtimeCloseTracksRequest {
  sessionId: string;
  connectionId?: string;
  sessionDescription?: RoomRealtimeSessionDescription;
  tracks: Array<{ mid: string }>;
  force?: boolean;
  unpublish?: { kind?: RoomMediaKind };
}

export interface RoomCloudflareRealtimeKitCreateSessionRequest {
  connectionId?: string;
  customParticipantId?: string;
  name?: string;
  picture?: string;
}

export interface RoomCloudflareRealtimeKitCreateSessionResponse {
  sessionId: string;
  meetingId: string;
  participantId: string;
  authToken: string;
  presetName: string;
  connectionId?: string;
  reused?: boolean;
}

export interface RoomMediaTransportConnectPayload {
  connectionId?: string;
  customParticipantId?: string;
  name?: string;
  picture?: string;
  correlationId?: string;
  thirdparty?: boolean;
  sessionDescription?: RoomRealtimeSessionDescription;
}

export interface RoomMediaRemoteTrackEvent {
  kind: RoomMediaKind;
  track: MediaStreamTrack;
  stream?: MediaStream;
  trackName?: string;
  providerSessionId?: string;
  participantId?: string;
  customParticipantId?: string;
  userId?: string;
}

export interface RoomMediaTransport {
  connect(payload?: RoomMediaTransportConnectPayload): Promise<string>;
  enableAudio(constraints?: MediaTrackConstraints | boolean): Promise<MediaStreamTrack>;
  enableVideo(constraints?: MediaTrackConstraints | boolean): Promise<MediaStreamTrack>;
  startScreenShare(constraints?: unknown): Promise<MediaStreamTrack>;
  disableAudio(): Promise<void>;
  disableVideo(): Promise<void>;
  stopScreenShare(): Promise<void>;
  setMuted(kind: Extract<RoomMediaKind, 'audio' | 'video'>, muted: boolean): Promise<void>;
  switchDevices(payload: {
    audioInputId?: string;
    videoInputId?: string;
    screenInputId?: string;
  }): Promise<void>;
  onRemoteTrack(handler: (event: RoomMediaRemoteTrackEvent) => void): Subscription;
  getSessionId(): string | null;
  getPeerConnection(): RTCPeerConnection | null;
  destroy(): void;
}

export type RoomMediaTransportProvider = 'cloudflare_realtimekit' | 'p2p';

export interface RoomCloudflareRealtimeKitTransportFactoryOptions {
  provider?: 'cloudflare_realtimekit';
  cloudflareRealtimeKit?: RoomCloudflareMediaTransportOptions;
}

export interface RoomP2PTransportFactoryOptions {
  provider: 'p2p';
  p2p?: RoomP2PMediaTransportOptions;
}

export type RoomMediaTransportOptions =
  | RoomCloudflareRealtimeKitTransportFactoryOptions
  | RoomP2PTransportFactoryOptions;

// ─── Helpers ───

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function deepSet(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  if (parts.some((p) => UNSAFE_KEYS.has(p))) return;
  let current: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key];
  }
  const lastKey = parts[parts.length - 1];
  if (value === null) {
    delete current[lastKey];
  } else {
    current[lastKey] = value;
  }
}

function generateRequestId(): string {
  // Use crypto.randomUUID if available, fallback to simple counter
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

function cloneRecord<T extends Record<string, unknown>>(value: T): T {
  return cloneValue(value);
}

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const ROOM_EXPLICIT_LEAVE_CLOSE_CODE = 4005;
const ROOM_EXPLICIT_LEAVE_REASON = 'Client left room';
const ROOM_EXPLICIT_LEAVE_CLOSE_DELAY_MS = 40;

function isSocketOpenOrConnecting(socket: Pick<WebSocket, 'readyState'> | null | undefined): boolean {
  return !!socket && (socket.readyState === WS_OPEN || socket.readyState === WS_CONNECTING);
}

function closeSocketAfterLeave(socket: Pick<WebSocket, 'close'>, reason: string): void {
  globalThis.setTimeout(() => {
    try {
      socket.close(ROOM_EXPLICIT_LEAVE_CLOSE_CODE, reason);
    } catch {
      // Socket already closed.
    }
  }, ROOM_EXPLICIT_LEAVE_CLOSE_DELAY_MS);
}

// ─── RoomClient v2 ───

export class RoomClient {
  private baseUrl: string;
  private tokenManager: TokenManager;
  private options: Required<RoomOptions>;

  /** Room namespace (e.g. 'game', 'chat') */
  public readonly namespace: string;
  /** Room instance ID within the namespace */
  public readonly roomId: string;

  // ─── State ───
  private _sharedState: Record<string, unknown> = {};
  private _sharedVersion = 0;
  private _playerState: Record<string, unknown> = {};
  private _playerVersion = 0;
  private _members: RoomMember[] = [];
  private _mediaMembers: RoomMediaMember[] = [];
  // ─── Connection ───
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private connected = false;
  private authenticated = false;
  private joined = false;
  private currentUserId: string | null = null;
  private currentConnectionId: string | null = null;
  private connectionState: RoomConnectionState = 'idle';
  private reconnectInfo: RoomReconnectInfo | null = null;
  private connectingPromise: Promise<void> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private intentionallyLeft = false;
  private waitingForAuth = false;
  private joinRequested = false;
  private unsubAuthState: (() => void) | null = null;
  private browserNetworkListenersAttached = false;
  private readonly browserOfflineHandler = () => {
    if (this.intentionallyLeft || !this.joinRequested) {
      return;
    }

    if (this.connectionState === 'connected') {
      this.setConnectionState('reconnecting');
    }

    if (isSocketOpenOrConnecting(this.ws)) {
      try {
        this.ws?.close();
      } catch {
        // Socket may already be closing.
      }
    }
  };
  private readonly browserOnlineHandler = () => {
    if (
      this.intentionallyLeft
      || !this.joinRequested
      || this.connectingPromise
      || isSocketOpenOrConnecting(this.ws)
    ) {
      return;
    }

    if (this.connectionState === 'reconnecting' || this.connectionState === 'disconnected') {
      this.ensureConnection().catch(() => {});
    }
  };

  // ─── Pending send() requests (requestId → { resolve, reject, timeout }) ───
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private pendingSignalRequests = new Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private pendingAdminRequests = new Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private pendingMemberStateRequests = new Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private pendingMediaRequests = new Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  // ─── Subscriptions ───
  private sharedStateHandlers: SharedStateHandler[] = [];
  private playerStateHandlers: PlayerStateHandler[] = [];
  private messageHandlers = new Map<string, MessageHandler[]>(); // messageType → handlers
  private allMessageHandlers: ((messageType: string, data: unknown) => void)[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private kickedHandlers: KickedHandler[] = [];
  private memberSyncHandlers: Array<(members: RoomMember[]) => void> = [];
  private memberJoinHandlers: Array<(member: RoomMember) => void> = [];
  private memberLeaveHandlers: Array<(member: RoomMember, reason: RoomMemberLeaveReason) => void> = [];
  private memberStateHandlers: Array<(member: RoomMember, state: Record<string, unknown>) => void> = [];
  private signalHandlers = new Map<string, Array<(payload: unknown, meta: RoomSignalMeta) => void>>();
  private anySignalHandlers: Array<(event: string, payload: unknown, meta: RoomSignalMeta) => void> = [];
  private mediaTrackHandlers: Array<(track: RoomMediaTrack, member: RoomMember) => void> = [];
  private mediaTrackRemovedHandlers: Array<(track: RoomMediaTrack, member: RoomMember) => void> = [];
  private mediaStateHandlers: Array<(member: RoomMember, state: RoomMemberMediaState) => void> = [];
  private mediaDeviceHandlers: Array<(member: RoomMember, change: RoomMediaDeviceChange) => void> = [];
  private reconnectHandlers: Array<(info: RoomReconnectInfo) => void> = [];
  private connectionStateHandlers: Array<(state: RoomConnectionState) => void> = [];

  readonly state = {
    getShared: (): Record<string, unknown> => this.getSharedState(),
    getMine: (): Record<string, unknown> => this.getPlayerState(),
    onSharedChange: (handler: SharedStateHandler): Subscription => this.onSharedState(handler),
    onMineChange: (handler: PlayerStateHandler): Subscription => this.onPlayerState(handler),
    send: (actionType: string, payload?: unknown): Promise<unknown> => this.send(actionType, payload),
  };

  readonly meta = {
    get: (): Promise<Record<string, unknown>> => this.getMetadata(),
  };

  readonly signals = {
    send: (event: string, payload?: unknown, options?: { includeSelf?: boolean }): Promise<void> =>
      this.sendSignal(event, payload, options),
    sendTo: (memberId: string, event: string, payload?: unknown): Promise<void> =>
      this.sendSignal(event, payload, { memberId }),
    on: (event: string, handler: (payload: unknown, meta: RoomSignalMeta) => void): Subscription =>
      this.onSignal(event, handler),
    onAny: (handler: (event: string, payload: unknown, meta: RoomSignalMeta) => void): Subscription =>
      this.onAnySignal(handler),
  };

  readonly members = {
    list: (): RoomMember[] => cloneValue(this._members),
    current: (): RoomMember | null => {
      const connectionId = this.currentConnectionId;
      if (connectionId) {
        const byConnection = this._members.find((member) => member.connectionId === connectionId);
        if (byConnection) {
          return cloneValue(byConnection);
        }
      }

      const userId = this.currentUserId;
      if (!userId) {
        return null;
      }
      const member = this._members.find((entry) => entry.userId === userId) ?? null;
      return member ? cloneValue(member) : null;
    },
    onSync: (handler: (members: RoomMember[]) => void): Subscription => this.onMembersSync(handler),
    onJoin: (handler: (member: RoomMember) => void): Subscription => this.onMemberJoin(handler),
    onLeave: (handler: (member: RoomMember, reason: RoomMemberLeaveReason) => void): Subscription =>
      this.onMemberLeave(handler),
    setState: (state: Record<string, unknown>): Promise<void> => this.sendMemberState(state),
    clearState: (): Promise<void> => this.clearMemberState(),
    onStateChange: (handler: (member: RoomMember, state: Record<string, unknown>) => void): Subscription =>
      this.onMemberStateChange(handler),
  };

  readonly admin = {
    kick: (memberId: string): Promise<void> => this.sendAdmin('kick', memberId),
    mute: (memberId: string): Promise<void> => this.sendAdmin('mute', memberId),
    block: (memberId: string): Promise<void> => this.sendAdmin('block', memberId),
    setRole: (memberId: string, role: string): Promise<void> =>
      this.sendAdmin('setRole', memberId, { role }),
    disableVideo: (memberId: string): Promise<void> => this.sendAdmin('disableVideo', memberId),
    stopScreenShare: (memberId: string): Promise<void> => this.sendAdmin('stopScreenShare', memberId),
  };

  readonly media = {
    list: (): RoomMediaMember[] => cloneValue(this._mediaMembers),
    audio: {
      enable: (payload?: { trackId?: string; deviceId?: string; providerSessionId?: string }): Promise<void> =>
        this.sendMedia('publish', 'audio', payload),
      disable: (): Promise<void> => this.sendMedia('unpublish', 'audio'),
      setMuted: (muted: boolean): Promise<void> => this.sendMedia('mute', 'audio', { muted }),
    },
    video: {
      enable: (payload?: { trackId?: string; deviceId?: string; providerSessionId?: string }): Promise<void> =>
        this.sendMedia('publish', 'video', payload),
      disable: (): Promise<void> => this.sendMedia('unpublish', 'video'),
      setMuted: (muted: boolean): Promise<void> => this.sendMedia('mute', 'video', { muted }),
    },
    screen: {
      start: (payload?: { trackId?: string; deviceId?: string; providerSessionId?: string }): Promise<void> =>
        this.sendMedia('publish', 'screen', payload),
      stop: (): Promise<void> => this.sendMedia('unpublish', 'screen'),
    },
    devices: {
      switch: (payload: {
        audioInputId?: string;
        videoInputId?: string;
        screenInputId?: string;
      }): Promise<void> => this.switchMediaDevices(payload),
    },
    cloudflareRealtimeKit: {
      createSession: (payload?: RoomCloudflareRealtimeKitCreateSessionRequest): Promise<RoomCloudflareRealtimeKitCreateSessionResponse> =>
        this.requestCloudflareRealtimeKitMedia('session', 'POST', payload),
    },
    transport: (options?: RoomMediaTransportOptions): RoomMediaTransport => {
      const provider = options?.provider ?? 'p2p';
      if (provider === 'p2p') {
        const p2pOptions = (options as RoomP2PTransportFactoryOptions | undefined)?.p2p;
        return new RoomP2PMediaTransport(this, p2pOptions);
      }

      const cloudflareOptions =
        (options as RoomCloudflareRealtimeKitTransportFactoryOptions | undefined)?.cloudflareRealtimeKit;
      return new RoomCloudflareMediaTransport(this, cloudflareOptions);
    },
    onTrack: (handler: (track: RoomMediaTrack, member: RoomMember) => void): Subscription =>
      this.onMediaTrack(handler),
    onTrackRemoved: (handler: (track: RoomMediaTrack, member: RoomMember) => void): Subscription =>
      this.onMediaTrackRemoved(handler),
    onStateChange: (handler: (member: RoomMember, state: RoomMemberMediaState) => void): Subscription =>
      this.onMediaStateChange(handler),
    onDeviceChange: (handler: (member: RoomMember, change: RoomMediaDeviceChange) => void): Subscription =>
      this.onMediaDeviceChange(handler),
  };

  readonly session = {
    onError: (handler: ErrorHandler): Subscription => this.onError(handler),
    onKicked: (handler: KickedHandler): Subscription => this.onKicked(handler),
    onReconnect: (handler: (info: RoomReconnectInfo) => void): Subscription => this.onReconnect(handler),
    onConnectionStateChange: (handler: (state: RoomConnectionState) => void): Subscription =>
      this.onConnectionStateChange(handler),
  };

  constructor(
    baseUrl: string,
    namespace: string,
    roomId: string,
    tokenManager: TokenManager,
    options?: RoomOptions,
  ) {
    this.baseUrl = baseUrl;
    this.namespace = namespace;
    this.roomId = roomId;
    this.tokenManager = tokenManager;
    this.options = {
      autoReconnect: options?.autoReconnect ?? true,
      maxReconnectAttempts: options?.maxReconnectAttempts ?? 10,
      reconnectBaseDelay: options?.reconnectBaseDelay ?? 1000,
      sendTimeout: options?.sendTimeout ?? 10000,
      connectionTimeout: options?.connectionTimeout ?? 15000,
    };

    this.unsubAuthState = this.tokenManager.onAuthStateChange((user) => {
      this.handleAuthStateChange(user);
    });
    this.attachBrowserNetworkListeners();
  }

  // ─── State Accessors ───

  /** Get current shared state (read-only snapshot) */
  getSharedState(): Record<string, unknown> {
    return cloneRecord(this._sharedState);
  }

  /** Get current player state (read-only snapshot) */
  getPlayerState(): Record<string, unknown> {
    return cloneRecord(this._playerState);
  }

  // ─── Metadata (HTTP, no WebSocket needed) ───

  /**
   * Get room metadata without joining (HTTP GET).
   * Returns developer-defined metadata set by room.setMetadata() on the server.
   */
  async getMetadata(): Promise<Record<string, unknown>> {
    return RoomClient.getMetadata(this.baseUrl, this.namespace, this.roomId);
  }

  /**
   * Static: Get room metadata without creating a RoomClient instance.
   * Useful for lobby screens where you need room info before joining.
   */
  static async getMetadata(
    baseUrl: string,
    namespace: string,
    roomId: string,
  ): Promise<Record<string, unknown>> {
    const url = `${baseUrl.replace(/\/$/, '')}/api/room/metadata?namespace=${encodeURIComponent(namespace)}&id=${encodeURIComponent(roomId)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new EdgeBaseError(res.status, `Failed to get room metadata: ${res.statusText}`);
    }
    return res.json() as Promise<Record<string, unknown>>;
  }

  private async requestCloudflareRealtimeKitMedia<T>(
    path: string,
    method: 'GET' | 'POST' | 'PUT',
    payload?: unknown,
  ): Promise<T> {
    return this.requestRoomMedia<T>('cloudflare_realtimekit', path, method, payload);
  }

  private async requestRoomMedia<T>(
    providerPath: string,
    path: string,
    method: 'GET' | 'POST' | 'PUT',
    payload?: unknown,
  ): Promise<T> {
    const token = await this.tokenManager.getAccessToken(
      (refreshToken) => refreshAccessToken(this.baseUrl, refreshToken),
    );
    if (!token) {
      throw new EdgeBaseError(401, 'Authentication required');
    }

    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}/api/room/media/${providerPath}/${path}`);
    url.searchParams.set('namespace', this.namespace);
    url.searchParams.set('id', this.roomId);

    const response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: method === 'GET' ? undefined : JSON.stringify(payload ?? {}),
    });

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new EdgeBaseError(
        response.status,
        (typeof data.message === 'string' && data.message) || `Room media request failed: ${response.statusText}`,
      );
    }

    return data as T;
  }

  // ─── Connection Lifecycle ───

  /** Connect to the room, authenticate, and join */
  async join(): Promise<void> {
    this.intentionallyLeft = false;
    this.joinRequested = true;
    if (isSocketOpenOrConnecting(this.ws)) {
      return this.connectingPromise ?? Promise.resolve();
    }
    this.setConnectionState(this.reconnectInfo ? 'reconnecting' : 'connecting');
    return this.ensureConnection();
  }

  /** Leave the room and disconnect. Cleans up all pending requests. */
  leave(): void {
    this.intentionallyLeft = true;
    this.joinRequested = false;
    this.waitingForAuth = false;
    this.stopHeartbeat();

    // Reject all pending send() requests
    this.rejectAllPendingRequests(new EdgeBaseError(499, 'Room left'));

    if (this.ws) {
      const socket = this.ws;
      this.sendRaw({ type: 'leave' });
      closeSocketAfterLeave(socket, ROOM_EXPLICIT_LEAVE_REASON);
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
    this.joined = false;
    this.connectingPromise = null;
    this._sharedState = {};
    this._sharedVersion = 0;
    this._playerState = {};
    this._playerVersion = 0;
    this._members = [];
    this._mediaMembers = [];
    this.currentUserId = null;
    this.currentConnectionId = null;
    this.reconnectInfo = null;
    this.setConnectionState('disconnected');
  }

  /**
   * Destroy the RoomClient and release all resources.
   * Calls leave() if still connected, unsubscribes from auth state changes,
   * and clears all handler arrays to allow garbage collection.
   */
  destroy(): void {
    this.leave();
    this.detachBrowserNetworkListeners();
    this.unsubAuthState?.();
    this.unsubAuthState = null;

    // Clear all handler arrays to break references
    this.sharedStateHandlers.length = 0;
    this.playerStateHandlers.length = 0;
    this.messageHandlers.clear();
    this.allMessageHandlers.length = 0;
    this.errorHandlers.length = 0;
    this.kickedHandlers.length = 0;
    this.memberSyncHandlers.length = 0;
    this.memberJoinHandlers.length = 0;
    this.memberLeaveHandlers.length = 0;
    this.memberStateHandlers.length = 0;
    this.signalHandlers.clear();
    this.anySignalHandlers.length = 0;
    this.mediaTrackHandlers.length = 0;
    this.mediaTrackRemovedHandlers.length = 0;
    this.mediaStateHandlers.length = 0;
    this.mediaDeviceHandlers.length = 0;
    this.reconnectHandlers.length = 0;
    this.connectionStateHandlers.length = 0;
  }

  // ─── Actions ───

  /**
   * Send an action to the server.
   * Returns a Promise that resolves with the action result from the server.
   *
   * @example
   * const result = await room.send('SET_SCORE', { score: 42 });
   */
  async send(actionType: string, payload?: unknown): Promise<unknown> {
    if (!this.ws || !this.connected || !this.authenticated) {
      throw new EdgeBaseError(400, 'Not connected to room');
    }

    const requestId = generateRequestId();

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new EdgeBaseError(408, `Action '${actionType}' timed out`));
      }, this.options.sendTimeout);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      this.sendRaw({
        type: 'send',
        actionType,
        payload: payload ?? {},
        requestId,
      });
    });
  }

  // ─── Subscriptions (v2 API) ───

  /**
   * Subscribe to shared state changes.
   * Called on full sync and on each shared_delta.
   *
   * @returns Subscription with unsubscribe()
   */
  onSharedState(handler: SharedStateHandler): Subscription {
    this.sharedStateHandlers.push(handler);
    return {
      unsubscribe: () => {
        const idx = this.sharedStateHandlers.indexOf(handler);
        if (idx >= 0) this.sharedStateHandlers.splice(idx, 1);
      },
    };
  }

  /**
   * Subscribe to player state changes.
   * Called on full sync and on each player_delta.
   *
   * @returns Subscription with unsubscribe()
   */
  onPlayerState(handler: PlayerStateHandler): Subscription {
    this.playerStateHandlers.push(handler);
    return {
      unsubscribe: () => {
        const idx = this.playerStateHandlers.indexOf(handler);
        if (idx >= 0) this.playerStateHandlers.splice(idx, 1);
      },
    };
  }

  /**
   * Subscribe to messages of a specific type sent by room.sendMessage().
   *
   * @example
   * room.onMessage('game_over', (data) => { console.log(data.winner); });
   *
   * @returns Subscription with unsubscribe()
   */
  onMessage(messageType: string, handler: MessageHandler): Subscription {
    if (!this.messageHandlers.has(messageType)) {
      this.messageHandlers.set(messageType, []);
    }
    this.messageHandlers.get(messageType)!.push(handler);
    return {
      unsubscribe: () => {
        const handlers = this.messageHandlers.get(messageType);
        if (handlers) {
          const idx = handlers.indexOf(handler);
          if (idx >= 0) handlers.splice(idx, 1);
        }
      },
    };
  }

  /**
   * Subscribe to ALL messages regardless of type.
   *
   * @returns Subscription with unsubscribe()
   */
  onAnyMessage(handler: (messageType: string, data: unknown) => void): Subscription {
    this.allMessageHandlers.push(handler);
    return {
      unsubscribe: () => {
        const idx = this.allMessageHandlers.indexOf(handler);
        if (idx >= 0) this.allMessageHandlers.splice(idx, 1);
      },
    };
  }

  /** Subscribe to errors */
  onError(handler: ErrorHandler): Subscription {
    this.errorHandlers.push(handler);
    return {
      unsubscribe: () => {
        const idx = this.errorHandlers.indexOf(handler);
        if (idx >= 0) this.errorHandlers.splice(idx, 1);
      },
    };
  }

  /** Subscribe to kick events */
  onKicked(handler: KickedHandler): Subscription {
    this.kickedHandlers.push(handler);
    return {
      unsubscribe: () => {
        const idx = this.kickedHandlers.indexOf(handler);
        if (idx >= 0) this.kickedHandlers.splice(idx, 1);
      },
    };
  }

  private onSignal(
    event: string,
    handler: (payload: unknown, meta: RoomSignalMeta) => void,
  ): Subscription {
    if (!this.signalHandlers.has(event)) {
      this.signalHandlers.set(event, []);
    }
    this.signalHandlers.get(event)!.push(handler);
    return {
      unsubscribe: () => {
        const handlers = this.signalHandlers.get(event);
        if (!handlers) return;
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
      },
    };
  }

  private onAnySignal(
    handler: (event: string, payload: unknown, meta: RoomSignalMeta) => void,
  ): Subscription {
    this.anySignalHandlers.push(handler);
    return {
      unsubscribe: () => {
        const index = this.anySignalHandlers.indexOf(handler);
        if (index >= 0) this.anySignalHandlers.splice(index, 1);
      },
    };
  }

  private onMembersSync(handler: (members: RoomMember[]) => void): Subscription {
    this.memberSyncHandlers.push(handler);
    return {
      unsubscribe: () => {
        const index = this.memberSyncHandlers.indexOf(handler);
        if (index >= 0) this.memberSyncHandlers.splice(index, 1);
      },
    };
  }

  private onMemberJoin(handler: (member: RoomMember) => void): Subscription {
    this.memberJoinHandlers.push(handler);
    return {
      unsubscribe: () => {
        const index = this.memberJoinHandlers.indexOf(handler);
        if (index >= 0) this.memberJoinHandlers.splice(index, 1);
      },
    };
  }

  private onMemberLeave(
    handler: (member: RoomMember, reason: RoomMemberLeaveReason) => void,
  ): Subscription {
    this.memberLeaveHandlers.push(handler);
    return {
      unsubscribe: () => {
        const index = this.memberLeaveHandlers.indexOf(handler);
        if (index >= 0) this.memberLeaveHandlers.splice(index, 1);
      },
    };
  }

  private onMemberStateChange(
    handler: (member: RoomMember, state: Record<string, unknown>) => void,
  ): Subscription {
    this.memberStateHandlers.push(handler);
    return {
      unsubscribe: () => {
        const index = this.memberStateHandlers.indexOf(handler);
        if (index >= 0) this.memberStateHandlers.splice(index, 1);
      },
    };
  }

  private onReconnect(handler: (info: RoomReconnectInfo) => void): Subscription {
    this.reconnectHandlers.push(handler);
    return {
      unsubscribe: () => {
        const index = this.reconnectHandlers.indexOf(handler);
        if (index >= 0) this.reconnectHandlers.splice(index, 1);
      },
    };
  }

  private onConnectionStateChange(handler: (state: RoomConnectionState) => void): Subscription {
    this.connectionStateHandlers.push(handler);
    return {
      unsubscribe: () => {
        const index = this.connectionStateHandlers.indexOf(handler);
        if (index >= 0) this.connectionStateHandlers.splice(index, 1);
      },
    };
  }

  private onMediaTrack(handler: (track: RoomMediaTrack, member: RoomMember) => void): Subscription {
    this.mediaTrackHandlers.push(handler);
    return {
      unsubscribe: () => {
        const index = this.mediaTrackHandlers.indexOf(handler);
        if (index >= 0) this.mediaTrackHandlers.splice(index, 1);
      },
    };
  }

  private onMediaTrackRemoved(handler: (track: RoomMediaTrack, member: RoomMember) => void): Subscription {
    this.mediaTrackRemovedHandlers.push(handler);
    return {
      unsubscribe: () => {
        const index = this.mediaTrackRemovedHandlers.indexOf(handler);
        if (index >= 0) this.mediaTrackRemovedHandlers.splice(index, 1);
      },
    };
  }

  private onMediaStateChange(
    handler: (member: RoomMember, state: RoomMemberMediaState) => void,
  ): Subscription {
    this.mediaStateHandlers.push(handler);
    return {
      unsubscribe: () => {
        const index = this.mediaStateHandlers.indexOf(handler);
        if (index >= 0) this.mediaStateHandlers.splice(index, 1);
      },
    };
  }

  private onMediaDeviceChange(
    handler: (member: RoomMember, change: RoomMediaDeviceChange) => void,
  ): Subscription {
    this.mediaDeviceHandlers.push(handler);
    return {
      unsubscribe: () => {
        const index = this.mediaDeviceHandlers.indexOf(handler);
        if (index >= 0) this.mediaDeviceHandlers.splice(index, 1);
      },
    };
  }

  private async sendSignal(
    event: string,
    payload?: unknown,
    options?: { includeSelf?: boolean; memberId?: string },
  ): Promise<void> {
    if (!this.ws || !this.connected || !this.authenticated) {
      throw new EdgeBaseError(400, 'Not connected to room');
    }

    const requestId = generateRequestId();
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingSignalRequests.delete(requestId);
        reject(new EdgeBaseError(408, `Signal '${event}' timed out`));
      }, this.options.sendTimeout);

      this.pendingSignalRequests.set(requestId, { resolve, reject, timeout });
      this.sendRaw({
        type: 'signal',
        event,
        payload: payload ?? {},
        includeSelf: options?.includeSelf === true,
        memberId: options?.memberId,
        requestId,
      });
    });
  }

  private async sendMemberState(state: Record<string, unknown>): Promise<void> {
    return this.sendMemberStateRequest({
      type: 'member_state',
      state,
    });
  }

  private async clearMemberState(): Promise<void> {
    return this.sendMemberStateRequest({
      type: 'member_state_clear',
    });
  }

  private async sendMemberStateRequest(
    payload: { type: 'member_state'; state: Record<string, unknown> } | { type: 'member_state_clear' },
  ): Promise<void> {
    if (!this.ws || !this.connected || !this.authenticated) {
      throw new EdgeBaseError(400, 'Not connected to room');
    }

    const requestId = generateRequestId();
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingMemberStateRequests.delete(requestId);
        reject(new EdgeBaseError(408, 'Member state update timed out'));
      }, this.options.sendTimeout);

      this.pendingMemberStateRequests.set(requestId, { resolve, reject, timeout });
      this.sendRaw({ ...payload, requestId });
    });
  }

  private async sendAdmin(
    operation: string,
    memberId: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.ws || !this.connected || !this.authenticated) {
      throw new EdgeBaseError(400, 'Not connected to room');
    }

    const requestId = generateRequestId();
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAdminRequests.delete(requestId);
        reject(new EdgeBaseError(408, `Admin operation '${operation}' timed out`));
      }, this.options.sendTimeout);

      this.pendingAdminRequests.set(requestId, { resolve, reject, timeout });
      this.sendRaw({
        type: 'admin',
        operation,
        memberId,
        payload: payload ?? {},
        requestId,
      });
    });
  }

  private async sendMedia(
    operation: 'publish' | 'unpublish' | 'mute' | 'device',
    kind: RoomMediaKind,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.ws || !this.connected || !this.authenticated) {
      throw new EdgeBaseError(400, 'Not connected to room');
    }

    const requestId = generateRequestId();
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingMediaRequests.delete(requestId);
        reject(new EdgeBaseError(408, `Media operation '${operation}' timed out`));
      }, this.options.sendTimeout);

      this.pendingMediaRequests.set(requestId, { resolve, reject, timeout });
      this.sendRaw({
        type: 'media',
        operation,
        kind,
        payload: payload ?? {},
        requestId,
      });
    });
  }

  private async switchMediaDevices(payload: {
    audioInputId?: string;
    videoInputId?: string;
    screenInputId?: string;
  }): Promise<void> {
    const operations: Promise<void>[] = [];
    if (payload.audioInputId) {
      operations.push(this.sendMedia('device', 'audio', { deviceId: payload.audioInputId }));
    }
    if (payload.videoInputId) {
      operations.push(this.sendMedia('device', 'video', { deviceId: payload.videoInputId }));
    }
    if (payload.screenInputId) {
      operations.push(this.sendMedia('device', 'screen', { deviceId: payload.screenInputId }));
    }
    await Promise.all(operations);
  }

  // ─── Private: Connection ───

  private async establishConnection(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const wsUrl = this.buildWsUrl();
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      let settled = false;

      const connectionTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { ws.close(); } catch (_) { /* ignore */ }
          this.ws = null;
          reject(new EdgeBaseError(408, `Room WebSocket connection timed out after ${this.options.connectionTimeout}ms. Is the server running?`));
        }
      }, this.options.connectionTimeout);

      ws.onopen = () => {
        clearTimeout(connectionTimer);
        this.connected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.authenticate()
          .then(() => {
            if (!settled) {
              settled = true;
              this.waitingForAuth = false;
              resolve();
            }
          })
          .catch((error) => {
            if (!settled) {
              settled = true;
              this.handleAuthenticationFailure(error);
              reject(error);
            }
          });
      };

      ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data as string);
      };

      ws.onclose = (event: CloseEvent) => {
        clearTimeout(connectionTimer);
        this.connected = false;
        this.authenticated = false;
        this.joined = false;
        this.ws = null;
        this.stopHeartbeat();

        // Reject pending requests immediately so callers don't hang until timeout
        if (!this.intentionallyLeft) {
          this.rejectAllPendingRequests(new EdgeBaseError(499, 'WebSocket connection lost'));
        }

        if (event.code === 4004 && this.connectionState !== 'kicked') {
          this.handleKicked();
        }

        if (
          !this.intentionallyLeft &&
          !this.waitingForAuth &&
          this.options.autoReconnect &&
          this.reconnectAttempts < this.options.maxReconnectAttempts
        ) {
          this.scheduleReconnect();
        } else if (!this.intentionallyLeft && this.connectionState !== 'kicked' && this.connectionState !== 'auth_lost') {
          this.setConnectionState('disconnected');
        }
      };

      ws.onerror = () => {
        clearTimeout(connectionTimer);
        if (!settled) {
          settled = true;
          reject(new EdgeBaseError(500, 'Room WebSocket connection error'));
        }
      };
    });
  }

  private ensureConnection(): Promise<void> {
    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    const nextPromise = this.establishConnection().finally(() => {
      if (this.connectingPromise === nextPromise) {
        this.connectingPromise = null;
      }
    });
    this.connectingPromise = nextPromise;
    return nextPromise;
  }

  private async authenticate(): Promise<void> {
    const token = await this.tokenManager.getAccessToken((refreshToken) =>
      refreshAccessToken(this.baseUrl, refreshToken),
    );
    if (!token) {
      throw new EdgeBaseError(401, 'No access token available. Sign in first.');
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new EdgeBaseError(401, 'Room auth timeout'));
      }, 10000);

      const originalOnMessage = this.ws?.onmessage;
      if (this.ws) {
        this.ws.onmessage = (event: MessageEvent) => {
          const msg = JSON.parse(event.data as string) as Record<string, unknown>;
          if (msg.type === 'auth_success' || msg.type === 'auth_refreshed') {
            clearTimeout(timeout);
            this.authenticated = true;
            this.currentUserId = typeof msg.userId === 'string' ? msg.userId : this.currentUserId;
            this.currentConnectionId = typeof msg.connectionId === 'string' ? msg.connectionId : this.currentConnectionId;
            if (this.ws) this.ws.onmessage = originalOnMessage ?? null;

            // Send join message with last known state for eviction recovery
            this.sendRaw({
              type: 'join',
              lastSharedState: this._sharedState,
              lastSharedVersion: this._sharedVersion,
              lastPlayerState: this._playerState,
              lastPlayerVersion: this._playerVersion,
            });
            this.joined = true;
            resolve();
          } else if (msg.type === 'error') {
            clearTimeout(timeout);
            reject(new EdgeBaseError(401, msg.message as string));
          }
        };
      }

      this.sendRaw({ type: 'auth', token });
    });
  }

  // ─── Private: Message Handling ───

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const type = msg.type as string;

    switch (type) {
      case 'auth_success':
      case 'auth_refreshed':
        this.handleAuthAck(msg);
        break;
      case 'sync':
        this.handleSync(msg);
        break;
      case 'shared_delta':
        this.handleSharedDelta(msg);
        break;
      case 'player_delta':
        this.handlePlayerDelta(msg);
        break;
      case 'action_result':
        this.handleActionResult(msg);
        break;
      case 'action_error':
        this.handleActionError(msg);
        break;
      case 'message':
        this.handleServerMessage(msg);
        break;
      case 'signal':
        this.handleSignalFrame(msg);
        break;
      case 'signal_sent':
        this.handleSignalSent(msg);
        break;
      case 'signal_error':
        this.handleSignalError(msg);
        break;
      case 'members_sync':
        this.handleMembersSync(msg);
        break;
      case 'media_sync':
        this.handleMediaSync(msg);
        break;
      case 'member_join':
        this.handleMemberJoinFrame(msg);
        break;
      case 'member_leave':
        this.handleMemberLeaveFrame(msg);
        break;
      case 'member_state':
        this.handleMemberStateFrame(msg);
        break;
      case 'member_state_error':
        this.handleMemberStateError(msg);
        break;
      case 'media_track':
        this.handleMediaTrackFrame(msg);
        break;
      case 'media_track_removed':
        this.handleMediaTrackRemovedFrame(msg);
        break;
      case 'media_state':
        this.handleMediaStateFrame(msg);
        break;
      case 'media_device':
        this.handleMediaDeviceFrame(msg);
        break;
      case 'media_result':
        this.handleMediaResult(msg);
        break;
      case 'media_error':
        this.handleMediaError(msg);
        break;
      case 'admin_result':
        this.handleAdminResult(msg);
        break;
      case 'admin_error':
        this.handleAdminError(msg);
        break;
      case 'kicked':
        this.handleKicked();
        break;
      case 'error':
        this.handleError(msg);
        break;
      case 'pong':
        // Heartbeat response — no action needed
        break;
    }
  }

  private handleSync(msg: Record<string, unknown>): void {
    this._sharedState = msg.sharedState as Record<string, unknown>;
    this._sharedVersion = msg.sharedVersion as number;
    this._playerState = msg.playerState as Record<string, unknown>;
    this._playerVersion = msg.playerVersion as number;
    const reconnectInfo = this.reconnectInfo;
    this.reconnectInfo = null;
    this.setConnectionState('connected');

    // Notify handlers with full state as changes
    const sharedSnapshot = cloneRecord(this._sharedState);
    const playerSnapshot = cloneRecord(this._playerState);
    for (const handler of this.sharedStateHandlers) {
      handler(sharedSnapshot, cloneRecord(sharedSnapshot));
    }
    for (const handler of this.playerStateHandlers) {
      handler(playerSnapshot, cloneRecord(playerSnapshot));
    }
    if (reconnectInfo) {
      for (const handler of this.reconnectHandlers) {
        handler(reconnectInfo);
      }
    }
  }

  private handleSharedDelta(msg: Record<string, unknown>): void {
    const delta = msg.delta as Record<string, unknown>;
    this._sharedVersion = msg.version as number;

    // Apply delta to local state
    for (const [path, value] of Object.entries(delta)) {
      deepSet(this._sharedState, path, value);
    }

    const sharedSnapshot = cloneRecord(this._sharedState);
    const deltaSnapshot = cloneRecord(delta);
    for (const handler of this.sharedStateHandlers) {
      handler(sharedSnapshot, deltaSnapshot);
    }
  }

  private handlePlayerDelta(msg: Record<string, unknown>): void {
    const delta = msg.delta as Record<string, unknown>;
    this._playerVersion = msg.version as number;

    // Apply delta to local player state
    for (const [path, value] of Object.entries(delta)) {
      deepSet(this._playerState, path, value);
    }

    const playerSnapshot = cloneRecord(this._playerState);
    const deltaSnapshot = cloneRecord(delta);
    for (const handler of this.playerStateHandlers) {
      handler(playerSnapshot, deltaSnapshot);
    }
  }

  private handleActionResult(msg: Record<string, unknown>): void {
    const requestId = msg.requestId as string;
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
      pending.resolve(msg.result);
    }
  }

  private handleActionError(msg: Record<string, unknown>): void {
    const requestId = msg.requestId as string;
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
      pending.reject(new EdgeBaseError(400, msg.message as string));
    }
  }

  private handleAuthAck(msg: Record<string, unknown>): void {
    this.currentUserId = typeof msg.userId === 'string' ? msg.userId : this.currentUserId;
    this.currentConnectionId =
      typeof msg.connectionId === 'string' ? msg.connectionId : this.currentConnectionId;
  }

  private handleServerMessage(msg: Record<string, unknown>): void {
    const messageType = msg.messageType as string;
    const data = msg.data;

    // Type-specific handlers
    const handlers = this.messageHandlers.get(messageType);
    if (handlers) {
      for (const handler of handlers) handler(data);
    }

    // All-message handlers
    for (const handler of this.allMessageHandlers) {
      handler(messageType, data);
    }
  }

  private handleSignalFrame(msg: Record<string, unknown>): void {
    const event = typeof msg.event === 'string' ? msg.event : '';
    if (!event) return;
    const meta = this.normalizeSignalMeta(msg.meta);
    const payload = msg.payload;

    const handlers = this.signalHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) handler(payload, meta);
    }
    for (const handler of this.anySignalHandlers) {
      handler(event, payload, meta);
    }
  }

  private handleSignalSent(msg: Record<string, unknown>): void {
    const requestId = msg.requestId as string | undefined;
    if (!requestId) return;
    const pending = this.pendingSignalRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingSignalRequests.delete(requestId);
    pending.resolve();
  }

  private handleSignalError(msg: Record<string, unknown>): void {
    const requestId = msg.requestId as string | undefined;
    if (!requestId) return;
    const pending = this.pendingSignalRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingSignalRequests.delete(requestId);
    pending.reject(new EdgeBaseError(400, (msg.message as string) || 'Signal failed'));
  }

  private handleMembersSync(msg: Record<string, unknown>): void {
    const members = this.normalizeMembers(msg.members);
    this._members = members;
    for (const member of members) {
      this.syncMediaMemberInfo(member);
    }
    const snapshot = cloneValue(this._members);
    for (const handler of this.memberSyncHandlers) {
      handler(snapshot);
    }
  }

  private handleMediaSync(msg: Record<string, unknown>): void {
    this._mediaMembers = this.normalizeMediaMembers(msg.members);
  }

  private handleMemberJoinFrame(msg: Record<string, unknown>): void {
    const member = this.normalizeMember(msg.member);
    if (!member) return;
    this.upsertMember(member);
    this.syncMediaMemberInfo(member);
    const snapshot = cloneValue(member);
    for (const handler of this.memberJoinHandlers) {
      handler(snapshot);
    }
  }

  private handleMemberLeaveFrame(msg: Record<string, unknown>): void {
    const member = this.normalizeMember(msg.member);
    if (!member) return;
    this.removeMember(member.memberId);
    this.removeMediaMember(member.memberId);
    const reason = this.normalizeLeaveReason(msg.reason);
    const snapshot = cloneValue(member);
    for (const handler of this.memberLeaveHandlers) {
      handler(snapshot, reason);
    }
  }

  private handleMemberStateFrame(msg: Record<string, unknown>): void {
    const member = this.normalizeMember(msg.member);
    const state = this.normalizeState(msg.state);
    if (!member) return;
    member.state = state;
    this.upsertMember(member);
    this.syncMediaMemberInfo(member);

    const requestId = msg.requestId as string | undefined;
    if (requestId) {
      const pending = this.pendingMemberStateRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingMemberStateRequests.delete(requestId);
        pending.resolve();
      }
    }

    const memberSnapshot = cloneValue(member);
    const stateSnapshot = cloneRecord(state);
    for (const handler of this.memberStateHandlers) {
      handler(memberSnapshot, stateSnapshot);
    }
  }

  private handleMemberStateError(msg: Record<string, unknown>): void {
    const requestId = msg.requestId as string | undefined;
    if (!requestId) return;
    const pending = this.pendingMemberStateRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingMemberStateRequests.delete(requestId);
    pending.reject(new EdgeBaseError(400, (msg.message as string) || 'Member state update failed'));
  }

  private handleMediaTrackFrame(msg: Record<string, unknown>): void {
    const member = this.normalizeMember(msg.member);
    const track = this.normalizeMediaTrack(msg.track);
    if (!member || !track) return;
    const mediaMember = this.ensureMediaMember(member);
    this.upsertMediaTrack(mediaMember, track);
    this.mergeMediaState(mediaMember, track.kind, {
      published: true,
      muted: track.muted,
      trackId: track.trackId,
      deviceId: track.deviceId,
      publishedAt: track.publishedAt,
      adminDisabled: track.adminDisabled,
      providerSessionId: track.providerSessionId,
    });

    const memberSnapshot = cloneValue(mediaMember.member);
    const trackSnapshot = cloneValue(track);
    for (const handler of this.mediaTrackHandlers) {
      handler(trackSnapshot, memberSnapshot);
    }
  }

  private handleMediaTrackRemovedFrame(msg: Record<string, unknown>): void {
    const member = this.normalizeMember(msg.member);
    const track = this.normalizeMediaTrack(msg.track);
    if (!member || !track) return;
    const mediaMember = this.ensureMediaMember(member);
    this.removeMediaTrack(mediaMember, track);
    mediaMember.state = {
      ...mediaMember.state,
      [track.kind]: {
        published: false,
        muted: false,
        adminDisabled: false,
        providerSessionId: undefined,
      },
    };

    const memberSnapshot = cloneValue(mediaMember.member);
    const trackSnapshot = cloneValue(track);
    for (const handler of this.mediaTrackRemovedHandlers) {
      handler(trackSnapshot, memberSnapshot);
    }
  }

  private handleMediaStateFrame(msg: Record<string, unknown>): void {
    const member = this.normalizeMember(msg.member);
    if (!member) return;
    const mediaMember = this.ensureMediaMember(member);
    mediaMember.state = this.normalizeMediaState(msg.state);

    const memberSnapshot = cloneValue(mediaMember.member);
    const stateSnapshot = cloneValue(mediaMember.state);
    for (const handler of this.mediaStateHandlers) {
      handler(memberSnapshot, stateSnapshot);
    }
  }

  private handleMediaDeviceFrame(msg: Record<string, unknown>): void {
    const member = this.normalizeMember(msg.member);
    const kind = this.normalizeMediaKind(msg.kind);
    const deviceId = typeof msg.deviceId === 'string' ? msg.deviceId : '';
    if (!member || !kind || !deviceId) return;

    const mediaMember = this.ensureMediaMember(member);
    this.mergeMediaState(mediaMember, kind, { deviceId });
    for (const track of mediaMember.tracks) {
      if (track.kind === kind) {
        track.deviceId = deviceId;
      }
    }

    const memberSnapshot = cloneValue(mediaMember.member);
    const change = { kind, deviceId } satisfies RoomMediaDeviceChange;
    for (const handler of this.mediaDeviceHandlers) {
      handler(memberSnapshot, change);
    }
  }

  private handleMediaResult(msg: Record<string, unknown>): void {
    const requestId = msg.requestId as string | undefined;
    if (!requestId) return;
    const pending = this.pendingMediaRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingMediaRequests.delete(requestId);
    pending.resolve();
  }

  private handleMediaError(msg: Record<string, unknown>): void {
    const requestId = msg.requestId as string | undefined;
    if (!requestId) return;
    const pending = this.pendingMediaRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingMediaRequests.delete(requestId);
    pending.reject(new EdgeBaseError(400, (msg.message as string) || 'Media operation failed'));
  }

  private handleAdminResult(msg: Record<string, unknown>): void {
    const requestId = msg.requestId as string | undefined;
    if (!requestId) return;
    const pending = this.pendingAdminRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingAdminRequests.delete(requestId);
    pending.resolve();
  }

  private handleAdminError(msg: Record<string, unknown>): void {
    const requestId = msg.requestId as string | undefined;
    if (!requestId) return;
    const pending = this.pendingAdminRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingAdminRequests.delete(requestId);
    pending.reject(new EdgeBaseError(400, (msg.message as string) || 'Admin operation failed'));
  }

  private handleKicked(): void {
    for (const handler of this.kickedHandlers) handler();
    // Don't auto-reconnect after being kicked
    this.intentionallyLeft = true;
    this.reconnectInfo = null;
    this.setConnectionState('kicked');
  }

  private handleError(msg: Record<string, unknown>): void {
    for (const handler of this.errorHandlers) {
      handler({ code: msg.code as string, message: msg.message as string });
    }
  }

  private refreshAuth(): void {
    const token = this.tokenManager.currentAccessToken;
    if (!token || !this.ws || !this.connected) return;
    this.sendRaw({ type: 'auth', token });
  }

  private handleAuthStateChange(user: TokenUser | null): void {
    if (user) {
      if (this.ws && this.connected && this.authenticated) {
        this.refreshAuth();
        return;
      }

      this.waitingForAuth = false;
      if (
        this.joinRequested
        && !this.connectingPromise
        && !isSocketOpenOrConnecting(this.ws)
      ) {
        this.reconnectAttempts = 0;
        this.ensureConnection().catch(() => {
          // Connection errors are surfaced through the normal socket lifecycle.
        });
      }
      return;
    }

    this.waitingForAuth = this.joinRequested;
    this.reconnectInfo = null;
    this.setConnectionState('auth_lost');

    // Reject pending requests — auth is gone, server won't respond
    this.rejectAllPendingRequests(new EdgeBaseError(401, 'Auth state lost'));

    if (this.ws) {
      const socket = this.ws;
      this.sendRaw({ type: 'leave' });
      this.stopHeartbeat();
      this.ws = null;
      this.connected = false;
      this.authenticated = false;
      this.joined = false;
      this._mediaMembers = [];
      this.currentUserId = null;
      this.currentConnectionId = null;
      try {
        closeSocketAfterLeave(socket, 'Signed out');
      } catch {
        // Ignore close failures — socket is already unusable.
      }
      return;
    }

    this.connected = false;
    this.authenticated = false;
    this.joined = false;
    this._mediaMembers = [];
  }

  private handleAuthenticationFailure(error: unknown): void {
    const authError =
      error instanceof EdgeBaseError
        ? error
        : new EdgeBaseError(500, 'Room authentication failed.');

    this.waitingForAuth = authError.code === 401 && this.joinRequested;
    this.stopHeartbeat();
    this.connected = false;
    this.authenticated = false;
    this.joined = false;
    this.connectingPromise = null;

    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      try {
        socket.close(4001, authError.message);
      } catch {
        // Ignore close failures — the server will time out stale sockets.
      }
    }
  }

  private normalizeMembers(value: unknown): RoomMember[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((member) => this.normalizeMember(member))
      .filter((member): member is RoomMember => !!member);
  }

  private normalizeMediaMembers(value: unknown): RoomMediaMember[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((member) => this.normalizeMediaMember(member))
      .filter((member): member is RoomMediaMember => !!member);
  }

  private normalizeMember(value: unknown): RoomMember | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const member = value as Record<string, unknown>;
    if (typeof member.memberId !== 'string' || typeof member.userId !== 'string') {
      return null;
    }
    return {
      memberId: member.memberId,
      userId: member.userId,
      connectionId: typeof member.connectionId === 'string' ? member.connectionId : undefined,
      connectionCount:
        typeof member.connectionCount === 'number' ? member.connectionCount : undefined,
      role: typeof member.role === 'string' ? member.role : undefined,
      state: this.normalizeState(member.state),
    };
  }

  private normalizeState(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return cloneRecord(value as Record<string, unknown>);
  }

  private normalizeMediaMember(value: unknown): RoomMediaMember | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const entry = value as Record<string, unknown>;
    const member = this.normalizeMember(entry.member);
    if (!member) {
      return null;
    }
    return {
      member,
      state: this.normalizeMediaState(entry.state),
      tracks: this.normalizeMediaTracks(entry.tracks),
    };
  }

  private normalizeMediaState(value: unknown): RoomMemberMediaState {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    const state = value as Record<string, unknown>;
    return {
      audio: this.normalizeMediaKindState(state.audio),
      video: this.normalizeMediaKindState(state.video),
      screen: this.normalizeMediaKindState(state.screen),
    };
  }

  private normalizeMediaKindState(value: unknown): RoomMemberMediaKindState | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const state = value as Record<string, unknown>;
    return {
      published: state.published === true,
      muted: state.muted === true,
      trackId: typeof state.trackId === 'string' ? state.trackId : undefined,
      deviceId: typeof state.deviceId === 'string' ? state.deviceId : undefined,
      publishedAt: typeof state.publishedAt === 'number' ? state.publishedAt : undefined,
      adminDisabled: state.adminDisabled === true,
      providerSessionId:
        typeof state.providerSessionId === 'string' ? state.providerSessionId : undefined,
    };
  }

  private normalizeMediaTracks(value: unknown): RoomMediaTrack[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((track) => this.normalizeMediaTrack(track))
      .filter((track): track is RoomMediaTrack => !!track);
  }

  private normalizeMediaTrack(value: unknown): RoomMediaTrack | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const track = value as Record<string, unknown>;
    const kind = this.normalizeMediaKind(track.kind);
    if (!kind) {
      return null;
    }
    return {
      kind,
      trackId: typeof track.trackId === 'string' ? track.trackId : undefined,
      deviceId: typeof track.deviceId === 'string' ? track.deviceId : undefined,
      muted: track.muted === true,
      publishedAt: typeof track.publishedAt === 'number' ? track.publishedAt : undefined,
      adminDisabled: track.adminDisabled === true,
      providerSessionId:
        typeof track.providerSessionId === 'string' ? track.providerSessionId : undefined,
    };
  }

  private normalizeMediaKind(value: unknown): RoomMediaKind | null {
    switch (value) {
      case 'audio':
      case 'video':
      case 'screen':
        return value;
      default:
        return null;
    }
  }

  private normalizeSignalMeta(value: unknown): RoomSignalMeta {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    const meta = value as Record<string, unknown>;
    return {
      memberId: typeof meta.memberId === 'string' || meta.memberId === null ? (meta.memberId as string | null) : undefined,
      userId: typeof meta.userId === 'string' || meta.userId === null ? (meta.userId as string | null) : undefined,
      connectionId:
        typeof meta.connectionId === 'string' || meta.connectionId === null
          ? (meta.connectionId as string | null)
          : undefined,
      sentAt: typeof meta.sentAt === 'number' ? meta.sentAt : undefined,
      serverSent: meta.serverSent === true,
    };
  }

  private normalizeLeaveReason(value: unknown): RoomMemberLeaveReason {
    switch (value) {
      case 'leave':
      case 'timeout':
      case 'kicked':
        return value;
      default:
        return 'leave';
    }
  }

  private upsertMember(member: RoomMember): void {
    const index = this._members.findIndex((entry) => entry.memberId === member.memberId);
    if (index >= 0) {
      this._members[index] = cloneValue(member);
      return;
    }
    this._members.push(cloneValue(member));
  }

  private removeMember(memberId: string): void {
    this._members = this._members.filter((member) => member.memberId !== memberId);
  }

  private syncMediaMemberInfo(member: RoomMember): void {
    const mediaMember = this._mediaMembers.find((entry) => entry.member.memberId === member.memberId);
    if (!mediaMember) {
      return;
    }
    mediaMember.member = cloneValue(member);
  }

  private ensureMediaMember(member: RoomMember): RoomMediaMember {
    const existing = this._mediaMembers.find((entry) => entry.member.memberId === member.memberId);
    if (existing) {
      existing.member = cloneValue(member);
      return existing;
    }
    const created: RoomMediaMember = {
      member: cloneValue(member),
      state: {},
      tracks: [],
    };
    this._mediaMembers.push(created);
    return created;
  }

  private removeMediaMember(memberId: string): void {
    this._mediaMembers = this._mediaMembers.filter((member) => member.member.memberId !== memberId);
  }

  private upsertMediaTrack(mediaMember: RoomMediaMember, track: RoomMediaTrack): void {
    const index = mediaMember.tracks.findIndex(
      (entry) =>
        entry.kind === track.kind &&
        entry.trackId === track.trackId,
    );
    if (index >= 0) {
      mediaMember.tracks[index] = cloneValue(track);
      return;
    }
    mediaMember.tracks = mediaMember.tracks
      .filter((entry) => !(entry.kind === track.kind && !track.trackId))
      .concat(cloneValue(track));
  }

  private removeMediaTrack(mediaMember: RoomMediaMember, track: RoomMediaTrack): void {
    mediaMember.tracks = mediaMember.tracks.filter((entry) => {
      if (track.trackId) {
        return !(entry.kind === track.kind && entry.trackId === track.trackId);
      }
      return entry.kind !== track.kind;
    });
  }

  private mergeMediaState(
    mediaMember: RoomMediaMember,
    kind: RoomMediaKind,
    partial: Partial<RoomMemberMediaKindState>,
  ): void {
    const next: RoomMemberMediaKindState = {
      published: partial.published ?? mediaMember.state[kind]?.published ?? false,
      muted: partial.muted ?? mediaMember.state[kind]?.muted ?? false,
      trackId: partial.trackId ?? mediaMember.state[kind]?.trackId,
      deviceId: partial.deviceId ?? mediaMember.state[kind]?.deviceId,
      publishedAt: partial.publishedAt ?? mediaMember.state[kind]?.publishedAt,
      adminDisabled: partial.adminDisabled ?? mediaMember.state[kind]?.adminDisabled,
      providerSessionId: partial.providerSessionId ?? mediaMember.state[kind]?.providerSessionId,
    };
    mediaMember.state = {
      ...mediaMember.state,
      [kind]: next,
    };
  }

  /** Reject all 5 pending request maps at once. */
  private rejectAllPendingRequests(error: EdgeBaseError): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    this.rejectPendingVoidRequests(this.pendingSignalRequests, error);
    this.rejectPendingVoidRequests(this.pendingAdminRequests, error);
    this.rejectPendingVoidRequests(this.pendingMemberStateRequests, error);
    this.rejectPendingVoidRequests(this.pendingMediaRequests, error);
  }

  private rejectPendingVoidRequests(
    pendingRequests: Map<string, {
      resolve: () => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }>,
    error: EdgeBaseError,
  ): void {
    for (const [, pending] of pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    pendingRequests.clear();
  }

  private setConnectionState(next: RoomConnectionState): void {
    if (this.connectionState === next) {
      return;
    }
    this.connectionState = next;
    for (const handler of this.connectionStateHandlers) {
      handler(next);
    }
  }

  // ─── Private: Helpers ───

  private sendRaw(data: Record<string, unknown>): void {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify(data));
      return;
    }
  }

  private buildWsUrl(): string {
    const httpUrl = this.baseUrl.replace(/\/$/, '');
    const wsUrl = httpUrl.replace(/^http/, 'ws');
    return `${wsUrl}/api/room?namespace=${encodeURIComponent(this.namespace)}&id=${encodeURIComponent(this.roomId)}`;
  }

  private attachBrowserNetworkListeners(): void {
    if (this.browserNetworkListenersAttached) {
      return;
    }

    const eventTarget = typeof globalThis !== 'undefined'
      && typeof (globalThis as typeof globalThis & {
        addEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
      }).addEventListener === 'function'
      ? globalThis as typeof globalThis & {
        addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
      }
      : null;

    if (!eventTarget) {
      return;
    }

    eventTarget.addEventListener('offline', this.browserOfflineHandler);
    eventTarget.addEventListener('online', this.browserOnlineHandler);
    this.browserNetworkListenersAttached = true;
  }

  private detachBrowserNetworkListeners(): void {
    if (!this.browserNetworkListenersAttached) {
      return;
    }

    const eventTarget = typeof globalThis !== 'undefined'
      && typeof (globalThis as typeof globalThis & {
        removeEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
      }).removeEventListener === 'function'
      ? globalThis as typeof globalThis & {
        removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
      }
      : null;

    if (!eventTarget) {
      return;
    }

    eventTarget.removeEventListener('offline', this.browserOfflineHandler);
    eventTarget.removeEventListener('online', this.browserOnlineHandler);
    this.browserNetworkListenersAttached = false;
  }

  private scheduleReconnect(): void {
    const attempt = this.reconnectAttempts + 1;
    const baseDelay = this.options.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts);
    const jitter = Math.random() * baseDelay * 0.25;
    const delay = baseDelay + jitter;
    this.reconnectAttempts++;
    this.reconnectInfo = { attempt };
    this.setConnectionState('reconnecting');
    setTimeout(() => {
      if (
        this.connectingPromise
        || !this.joinRequested
        || this.waitingForAuth
        || isSocketOpenOrConnecting(this.ws)
      ) {
        return;
      }
      this.ensureConnection().catch(() => {});
    }, Math.min(delay, 30000));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.connected) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
