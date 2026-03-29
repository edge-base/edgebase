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
import {
  EdgeBaseError,
  createSubscription,
  networkError,
  parseErrorResponse,
  type Subscription,
} from '@edge-base/core';
import { refreshAccessToken } from './auth-refresh.js';

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
  /** Heartbeat ping interval in ms (default: 8000) */
  heartbeatIntervalMs?: number;
  /** Consider the room socket stale if no pong is observed within this window. */
  heartbeatStaleTimeoutMs?: number;
  /** Grace period before reacting to browser network type changes. */
  networkRecoveryGraceMs?: number;
  /** Time to wait for recovery before surfacing a session reset recommendation. */
  disconnectResetTimeoutMs?: number;
}

// Re-export Subscription + helper from core for backwards compatibility
export type { Subscription };
export { createSubscription };

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

export interface RoomRecoveryFailureInfo {
  state: RoomConnectionState;
  timeoutMs: number;
}

export interface RoomConnectDiagnostic {
  ok: boolean;
  type: string;
  category: string;
  message: string;
  namespace?: string;
  roomId?: string;
  runtime?: string;
  pendingCount?: number;
  maxPending?: number;
}

export interface RoomSummary {
  namespace: string;
  roomId: string;
  metadata: Record<string, unknown>;
  occupancy: {
    activeMembers: number;
    activeConnections: number;
  };
  updatedAt: string;
}

export interface RoomSummaryCollection {
  namespace: string;
  items: RoomSummary[];
  deniedIds: string[];
  updatedAt: string;
}

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
const ROOM_AUTH_STATE_LOST_CLOSE_CODE = 4006;
const ROOM_EXPLICIT_LEAVE_REASON = 'Client left room';
const ROOM_HEARTBEAT_INTERVAL_MS = 8000;
const ROOM_HEARTBEAT_STALE_TIMEOUT_MS = 20_000;

function isSocketOpenOrConnecting(socket: Pick<WebSocket, 'readyState'> | null | undefined): boolean {
  return !!socket && (socket.readyState === WS_OPEN || socket.readyState === WS_CONNECTING);
}

function closeSocketAfterLeave(socket: Pick<WebSocket, 'close'>, reason: string): void {
  try {
    socket.close(ROOM_EXPLICIT_LEAVE_CLOSE_CODE, reason);
  } catch {
    // Socket already closed.
  }
}

function getDefaultHeartbeatStaleTimeoutMs(heartbeatIntervalMs: number): number {
  return Math.max(Math.floor(heartbeatIntervalMs * 2.5), ROOM_HEARTBEAT_STALE_TIMEOUT_MS);
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
  private lastLocalMemberState: Record<string, unknown> | null = null;
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
  private lastHeartbeatAckAt = Date.now();
  private disconnectResetTimer: ReturnType<typeof setTimeout> | null = null;
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
    onSuccess?: () => void;
  }>();

  // ─── Subscriptions ───
  private sharedStateHandlers: SharedStateHandler[] = [];
  private playerStateHandlers: PlayerStateHandler[] = [];
  private messageHandlers = new Map<string, MessageHandler[]>(); // messageType → handlers
  private allMessageHandlers: ((messageType: string, data: unknown) => void)[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private kickedHandlers: KickedHandler[] = [];
  private memberSyncHandlers: Array<(members: RoomMember[]) => void> = [];
  private memberSnapshotHandlers: Array<(members: RoomMember[]) => void> = [];
  private memberJoinHandlers: Array<(member: RoomMember) => void> = [];
  private memberLeaveHandlers: Array<(member: RoomMember, reason: RoomMemberLeaveReason) => void> = [];
  private memberStateHandlers: Array<(member: RoomMember, state: Record<string, unknown>) => void> = [];
  private signalHandlers = new Map<string, Array<(payload: unknown, meta: RoomSignalMeta) => void>>();
  private anySignalHandlers: Array<(event: string, payload: unknown, meta: RoomSignalMeta) => void> = [];
  private reconnectHandlers: Array<(info: RoomReconnectInfo) => void> = [];
  private recoveryFailureHandlers: Array<(info: RoomRecoveryFailureInfo) => void> = [];
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
    summary: (): Promise<RoomSummary> => this.getSummary(),
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
    list: (): RoomMember[] => this._members.map((member) => cloneValue(member)),
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
    awaitCurrent: (timeoutMs = 10_000): Promise<RoomMember | null> => this.waitForCurrentMember(timeoutMs),
    onSync: (handler: (members: RoomMember[]) => void): Subscription => this.onMembersSync(handler),
    onSnapshot: (handler: (members: RoomMember[]) => void): Subscription => this.onMemberSnapshot(handler),
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
    block: (memberId: string): Promise<void> => this.sendAdmin('block', memberId),
    setRole: (memberId: string, role: string): Promise<void> =>
      this.sendAdmin('setRole', memberId, { role }),
  };

  readonly session = {
    onError: (handler: ErrorHandler): Subscription => this.onError(handler),
    onKicked: (handler: KickedHandler): Subscription => this.onKicked(handler),
    onReconnect: (handler: (info: RoomReconnectInfo) => void): Subscription => this.onReconnect(handler),
    onConnectionStateChange: (handler: (state: RoomConnectionState) => void): Subscription =>
      this.onConnectionStateChange(handler),
    onRecoveryFailure: (handler: (info: RoomRecoveryFailureInfo) => void): Subscription =>
      this.onRecoveryFailure(handler),
    getDebugSnapshot: (): unknown => this.getDebugSnapshot(),
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
      heartbeatIntervalMs: options?.heartbeatIntervalMs ?? ROOM_HEARTBEAT_INTERVAL_MS,
      heartbeatStaleTimeoutMs:
        options?.heartbeatStaleTimeoutMs
        ?? getDefaultHeartbeatStaleTimeoutMs(options?.heartbeatIntervalMs ?? ROOM_HEARTBEAT_INTERVAL_MS),
      networkRecoveryGraceMs: options?.networkRecoveryGraceMs ?? 3500,
      disconnectResetTimeoutMs: options?.disconnectResetTimeoutMs ?? 8000,
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

  private async waitForCurrentMember(timeoutMs = 10_000): Promise<RoomMember | null> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const member = this.members.current();
      if (member) {
        return member;
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
    }
    return this.members.current();
  }

  // ─── Metadata (HTTP, no WebSocket needed) ───

  /**
   * Get room metadata without joining (HTTP GET).
   * Returns developer-defined metadata set by room.setMetadata() on the server.
   */
  async getMetadata(): Promise<Record<string, unknown>> {
    return RoomClient.getMetadata(this.baseUrl, this.namespace, this.roomId);
  }

  async getSummary(): Promise<RoomSummary> {
    return RoomClient.getSummary(this.baseUrl, this.namespace, this.roomId);
  }

  async checkConnection(): Promise<RoomConnectDiagnostic> {
    return RoomClient.checkConnection(this.baseUrl, this.namespace, this.roomId);
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
    return RoomClient.requestPublicRoomResource<Record<string, unknown>>(
      baseUrl,
      'metadata',
      namespace,
      roomId,
      'Failed to get room metadata',
    );
  }

  static async getSummary(
    baseUrl: string,
    namespace: string,
    roomId: string,
  ): Promise<RoomSummary> {
    return RoomClient.requestPublicRoomResource<RoomSummary>(
      baseUrl,
      'summary',
      namespace,
      roomId,
      'Failed to get room summary',
    );
  }

  static async getSummaries(
    baseUrl: string,
    namespace: string,
    roomIds: string[],
  ): Promise<RoomSummaryCollection> {
    const url = `${baseUrl.replace(/\/$/, '')}/api/room/summaries`;
    let res: Response;

    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace, ids: roomIds }),
      });
    } catch (error) {
      throw networkError(
        `Failed to get room summaries. Could not reach ${baseUrl.replace(/\/$/, '')}. Make sure the EdgeBase server is running and reachable.`,
        { cause: error },
      );
    }

    const data = (await res.json().catch(() => null)) as RoomSummaryCollection | null;
    if (!res.ok) {
      const parsed = parseErrorResponse(res.status, data);
      parsed.message = `Failed to get room summaries: ${parsed.message}`;
      throw parsed;
    }

    return data as RoomSummaryCollection;
  }

  static async checkConnection(
    baseUrl: string,
    namespace: string,
    roomId: string,
  ): Promise<RoomConnectDiagnostic> {
    const url = `${baseUrl.replace(/\/$/, '')}/api/room/connect-check?namespace=${encodeURIComponent(namespace)}&id=${encodeURIComponent(roomId)}`;
    let response: Response;

    try {
      response = await fetch(url);
    } catch (error) {
      throw networkError(
        `Room connect-check could not reach ${baseUrl.replace(/\/$/, '')}. Make sure the EdgeBase server is running and reachable.`,
        { cause: error },
      );
    }

    const data = (await response.json().catch(() => null)) as Partial<RoomConnectDiagnostic> | null;
    if (!response.ok) {
      throw parseErrorResponse(response.status, data);
    }

    if (
      typeof data?.ok !== 'boolean'
      || typeof data?.type !== 'string'
      || typeof data?.category !== 'string'
      || typeof data?.message !== 'string'
    ) {
      throw new EdgeBaseError(
        response.status || 500,
        'Room connect-check returned an unexpected response. The EdgeBase server and SDK may be out of sync.',
      );
    }

    const diagnostic = data as RoomConnectDiagnostic;

    return {
      ok: diagnostic.ok,
      type: diagnostic.type,
      category: diagnostic.category,
      message: diagnostic.message,
      namespace: typeof diagnostic.namespace === 'string' ? diagnostic.namespace : undefined,
      roomId: typeof diagnostic.roomId === 'string' ? diagnostic.roomId : undefined,
      runtime: typeof diagnostic.runtime === 'string' ? diagnostic.runtime : undefined,
      pendingCount: typeof diagnostic.pendingCount === 'number' ? diagnostic.pendingCount : undefined,
      maxPending: typeof diagnostic.maxPending === 'number' ? diagnostic.maxPending : undefined,
    };
  }

  private static async requestPublicRoomResource<T>(
    baseUrl: string,
    resource: 'metadata' | 'summary',
    namespace: string,
    roomId: string,
    failureMessage: string,
  ): Promise<T> {
    const url = `${baseUrl.replace(/\/$/, '')}/api/room/${resource}?namespace=${encodeURIComponent(namespace)}&id=${encodeURIComponent(roomId)}`;
    let res: Response;

    try {
      res = await fetch(url);
    } catch (error) {
      throw networkError(
        `${failureMessage}. Could not reach ${baseUrl.replace(/\/$/, '')}. Make sure the EdgeBase server is running and reachable.`,
        { cause: error },
      );
    }

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const parsed = parseErrorResponse(res.status, data);
      parsed.message = `${failureMessage}: ${parsed.message}`;
      throw parsed;
    }
    return res.json() as Promise<T>;
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
    this.clearDisconnectResetTimer();

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
    this.lastLocalMemberState = null;
    this.currentUserId = null;
    this.currentConnectionId = null;
    this.reconnectInfo = null;
    this.setConnectionState('disconnected');
  }

  private assertConnected(action: string): void {
    if (!this.ws || !this.connected || !this.authenticated) {
      throw new EdgeBaseError(
        400,
        `Room connection required before ${action}. Call room.join() and wait for the connection to finish.`,
      );
    }
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
    this.assertConnected(`sending action '${actionType}'`);

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
   * @returns Subscription (callable & .unsubscribe())
   */
  onSharedState(handler: SharedStateHandler): Subscription {
    this.sharedStateHandlers.push(handler);
    return createSubscription(() => {
        const idx = this.sharedStateHandlers.indexOf(handler);
        if (idx >= 0) this.sharedStateHandlers.splice(idx, 1);
      });
  }

  /**
   * Subscribe to player state changes.
   * Called on full sync and on each player_delta.
   *
   * @returns Subscription (callable & .unsubscribe())
   */
  onPlayerState(handler: PlayerStateHandler): Subscription {
    this.playerStateHandlers.push(handler);
    return createSubscription(() => {
        const idx = this.playerStateHandlers.indexOf(handler);
        if (idx >= 0) this.playerStateHandlers.splice(idx, 1);
      });
  }

  /**
   * Subscribe to messages of a specific type sent by room.sendMessage().
   *
   * @example
   * room.onMessage('game_over', (data) => { console.log(data.winner); });
   *
   * @returns Subscription (callable & .unsubscribe())
   */
  onMessage(messageType: string, handler: MessageHandler): Subscription {
    if (!this.messageHandlers.has(messageType)) {
      this.messageHandlers.set(messageType, []);
    }
    this.messageHandlers.get(messageType)!.push(handler);
    return createSubscription(() => {
        const handlers = this.messageHandlers.get(messageType);
        if (handlers) {
          const idx = handlers.indexOf(handler);
          if (idx >= 0) handlers.splice(idx, 1);
        }
      });
  }

  /**
   * Subscribe to ALL messages regardless of type.
   *
   * @returns Subscription (callable & .unsubscribe())
   */
  onAnyMessage(handler: (messageType: string, data: unknown) => void): Subscription {
    this.allMessageHandlers.push(handler);
    return createSubscription(() => {
        const idx = this.allMessageHandlers.indexOf(handler);
        if (idx >= 0) this.allMessageHandlers.splice(idx, 1);
      });
  }

  /** Subscribe to errors */
  onError(handler: ErrorHandler): Subscription {
    this.errorHandlers.push(handler);
    return createSubscription(() => {
        const idx = this.errorHandlers.indexOf(handler);
        if (idx >= 0) this.errorHandlers.splice(idx, 1);
      });
  }

  /** Subscribe to kick events */
  onKicked(handler: KickedHandler): Subscription {
    this.kickedHandlers.push(handler);
    return createSubscription(() => {
        const idx = this.kickedHandlers.indexOf(handler);
        if (idx >= 0) this.kickedHandlers.splice(idx, 1);
      });
  }

  private onSignal(
    event: string,
    handler: (payload: unknown, meta: RoomSignalMeta) => void,
  ): Subscription {
    if (!this.signalHandlers.has(event)) {
      this.signalHandlers.set(event, []);
    }
    this.signalHandlers.get(event)!.push(handler);
    return createSubscription(() => {
        const handlers = this.signalHandlers.get(event);
        if (!handlers) return;
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
      });
  }

  private onAnySignal(
    handler: (event: string, payload: unknown, meta: RoomSignalMeta) => void,
  ): Subscription {
    this.anySignalHandlers.push(handler);
    return createSubscription(() => {
        const index = this.anySignalHandlers.indexOf(handler);
        if (index >= 0) this.anySignalHandlers.splice(index, 1);
      });
  }

  private onMembersSync(handler: (members: RoomMember[]) => void): Subscription {
    this.memberSyncHandlers.push(handler);
    return createSubscription(() => {
        const index = this.memberSyncHandlers.indexOf(handler);
        if (index >= 0) this.memberSyncHandlers.splice(index, 1);
      });
  }

  private onMemberSnapshot(handler: (members: RoomMember[]) => void): Subscription {
    this.memberSnapshotHandlers.push(handler);
    return createSubscription(() => {
      const index = this.memberSnapshotHandlers.indexOf(handler);
      if (index >= 0) this.memberSnapshotHandlers.splice(index, 1);
    });
  }

  private onMemberJoin(handler: (member: RoomMember) => void): Subscription {
    this.memberJoinHandlers.push(handler);
    return createSubscription(() => {
        const index = this.memberJoinHandlers.indexOf(handler);
        if (index >= 0) this.memberJoinHandlers.splice(index, 1);
      });
  }

  private onMemberLeave(
    handler: (member: RoomMember, reason: RoomMemberLeaveReason) => void,
  ): Subscription {
    this.memberLeaveHandlers.push(handler);
    return createSubscription(() => {
        const index = this.memberLeaveHandlers.indexOf(handler);
        if (index >= 0) this.memberLeaveHandlers.splice(index, 1);
      });
  }

  private onMemberStateChange(
    handler: (member: RoomMember, state: Record<string, unknown>) => void,
  ): Subscription {
    this.memberStateHandlers.push(handler);
    return createSubscription(() => {
        const index = this.memberStateHandlers.indexOf(handler);
        if (index >= 0) this.memberStateHandlers.splice(index, 1);
      });
  }

  private onReconnect(handler: (info: RoomReconnectInfo) => void): Subscription {
    this.reconnectHandlers.push(handler);
    return createSubscription(() => {
        const index = this.reconnectHandlers.indexOf(handler);
        if (index >= 0) this.reconnectHandlers.splice(index, 1);
      });
  }

  private onRecoveryFailure(handler: (info: RoomRecoveryFailureInfo) => void): Subscription {
    this.recoveryFailureHandlers.push(handler);
    return createSubscription(() => {
      const index = this.recoveryFailureHandlers.indexOf(handler);
      if (index >= 0) this.recoveryFailureHandlers.splice(index, 1);
    });
  }

  private onConnectionStateChange(handler: (state: RoomConnectionState) => void): Subscription {
    this.connectionStateHandlers.push(handler);
    return createSubscription(() => {
        const index = this.connectionStateHandlers.indexOf(handler);
        if (index >= 0) this.connectionStateHandlers.splice(index, 1);
      });
  }

  private async sendSignal(
    event: string,
    payload?: unknown,
    options?: { includeSelf?: boolean; memberId?: string },
  ): Promise<void> {
    this.assertConnected(`sending signal '${event}'`);

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
    const nextState = {
      ...(this.lastLocalMemberState ?? {}),
      ...cloneRecord(state),
    };
    return this.sendMemberStateRequest({
      type: 'member_state',
      state,
    }, () => {
      this.lastLocalMemberState = nextState;
    });
  }

  private async clearMemberState(): Promise<void> {
    const clearedState = {};
    return this.sendMemberStateRequest({
      type: 'member_state_clear',
    }, () => {
      this.lastLocalMemberState = clearedState;
    });
  }

  private async sendMemberStateRequest(
    payload: { type: 'member_state'; state: Record<string, unknown> } | { type: 'member_state_clear' },
    onSuccess?: () => void,
  ): Promise<void> {
    this.assertConnected('updating member state');

    const requestId = generateRequestId();
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingMemberStateRequests.delete(requestId);
        reject(new EdgeBaseError(408, 'Member state update timed out'));
      }, this.options.sendTimeout);

      this.pendingMemberStateRequests.set(requestId, { resolve, reject, timeout, onSuccess });
      this.sendRaw({ ...payload, requestId });
    });
  }

  private async sendAdmin(
    operation: string,
    memberId: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    this.assertConnected(`running admin operation '${operation}'`);

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

        const closeMessage = event.reason?.trim()
          ? `Room authentication lost: ${event.reason}`
          : 'Room authentication lost';
        const closeError = event.code === ROOM_AUTH_STATE_LOST_CLOSE_CODE
          ? new EdgeBaseError(401, closeMessage)
          : new EdgeBaseError(499, 'WebSocket connection lost');

        if (event.code === ROOM_AUTH_STATE_LOST_CLOSE_CODE && this.connectionState !== 'auth_lost') {
          this.setConnectionState('auth_lost');
        }

        // Reject pending requests immediately so callers don't hang until timeout
        if (!this.intentionallyLeft) {
          this.rejectAllPendingRequests(closeError);
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
      throw new EdgeBaseError(
        401,
        'Room authentication requires a signed-in session. Sign in before joining the room.',
      );
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new EdgeBaseError(
            401,
            'Room authentication timed out. Check the server auth response and room connectivity.',
          ),
        );
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
                            lastMemberState: this.getReconnectMemberState(),
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
        this.lastHeartbeatAckAt = Date.now();
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
    const snapshot = this._members.map((member) => cloneValue(member));
    for (const handler of this.memberSyncHandlers) {
      handler(snapshot);
    }
    for (const handler of this.memberSnapshotHandlers) {
      handler(snapshot);
    }
  }

  private handleMemberJoinFrame(msg: Record<string, unknown>): void {
    const member = this.normalizeMember(msg.member);
    if (!member) return;
    this.upsertMember(member);
    const snapshot = cloneValue(member);
    for (const handler of this.memberJoinHandlers) {
      handler(snapshot);
    }
  }

  private handleMemberLeaveFrame(msg: Record<string, unknown>): void {
    const member = this.normalizeMember(msg.member);
    if (!member) return;
    this.removeMember(member.memberId);
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

    const requestId = msg.requestId as string | undefined;
    if (requestId) {
      const pending = this.pendingMemberStateRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingMemberStateRequests.delete(requestId);
        pending.onSuccess?.();
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
    const code = typeof msg.code === 'string' ? msg.code : '';
    const message = typeof msg.message === 'string' ? msg.message : '';
    if (this.shouldTreatErrorAsAuthLoss(code)) {
      this.handleRoomAuthStateLoss(message);
    }

    for (const handler of this.errorHandlers) {
      handler({ code, message });
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

  private shouldTreatErrorAsAuthLoss(code: string): boolean {
    if (code === 'AUTH_STATE_LOST') {
      return true;
    }
    if (code !== 'NOT_AUTHENTICATED') {
      return false;
    }
    return this.authenticated || this.hasPendingRequests();
  }

  private hasPendingRequests(): boolean {
    return this.pendingRequests.size > 0
      || this.pendingSignalRequests.size > 0
      || this.pendingAdminRequests.size > 0
      || this.pendingMemberStateRequests.size > 0;
  }

  private handleRoomAuthStateLoss(message?: string): void {
    const detail = message?.trim();
    const authLossMessage = detail
      ? `Room authentication lost: ${detail}`
      : 'Room authentication lost';

    this.setConnectionState('auth_lost');
    this.rejectAllPendingRequests(new EdgeBaseError(401, authLossMessage));

    if (this.ws && this.ws.readyState === WS_OPEN) {
      try {
        this.ws.close(ROOM_AUTH_STATE_LOST_CLOSE_CODE, authLossMessage);
      } catch {
        // Socket may already be closing.
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

  private getDebugSnapshot(): unknown {
    return {
      connectionState: this.connectionState,
      connected: this.connected,
      authenticated: this.authenticated,
      joined: this.joined,
      currentUserId: this.currentUserId,
      currentConnectionId: this.currentConnectionId,
      membersCount: this._members.length,
      reconnectAttempts: this.reconnectAttempts,
      joinRequested: this.joinRequested,
      waitingForAuth: this.waitingForAuth,
    };
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

  private shouldScheduleDisconnectReset(next: RoomConnectionState): boolean {
    if (this.intentionallyLeft || !this.joinRequested) {
      return false;
    }
    return next === 'disconnected';
  }

  private clearDisconnectResetTimer(): void {
    if (this.disconnectResetTimer) {
      clearTimeout(this.disconnectResetTimer);
      this.disconnectResetTimer = null;
    }
  }

  private scheduleDisconnectReset(stateAtSchedule: RoomConnectionState): void {
    this.clearDisconnectResetTimer();
    const timeoutMs = this.options.disconnectResetTimeoutMs;
    if (!(timeoutMs > 0)) {
      return;
    }
    this.disconnectResetTimer = setTimeout(() => {
      this.disconnectResetTimer = null;
      if (this.intentionallyLeft || !this.joinRequested) {
        return;
      }
      if (this.connectionState !== stateAtSchedule) {
        return;
      }
      if (this.connectionState === 'connected') {
        return;
      }
      for (const handler of this.recoveryFailureHandlers) {
        try {
          handler({
            state: this.connectionState,
            timeoutMs,
          });
        } catch {
          // Ignore recovery failure handler errors.
        }
      }
    }, timeoutMs);
  }

  private setConnectionState(next: RoomConnectionState): void {
    if (this.connectionState === next) {
      return;
    }
    this.connectionState = next;
    if (this.shouldScheduleDisconnectReset(next)) {
      this.scheduleDisconnectReset(next);
    } else {
      this.clearDisconnectResetTimer();
    }
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
    this.lastHeartbeatAckAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.connected) {
        if (Date.now() - this.lastHeartbeatAckAt > this.options.heartbeatStaleTimeoutMs) {
          try {
            this.ws.close();
          } catch {
            // Socket may already be closing.
          }
          return;
        }
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, this.options.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private getReconnectMemberState(): Record<string, unknown> | undefined {
    if (!this.lastLocalMemberState) {
      return undefined;
    }

    return cloneRecord(this.lastLocalMemberState);
  }
}
