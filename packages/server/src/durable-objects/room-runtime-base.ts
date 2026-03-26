/**
 * RoomsDO v2 — Durable Object for ephemeral, in-memory real-time state rooms.
 *
 * Each room is isolated to its own DO instance, identified by namespace::roomId.
 *: Complete redesign from v1.
 *
 * Key changes from v1:
 *   - 3 state areas: sharedState (all clients), playerState (per-player), serverState (server-only)
 *   - Client can only read + subscribe + send(). All writes are server-only.
 *   - No Direct/Authoritative mode distinction — single path: send → onAction → state change → broadcast
 *   - Config-driven namespace handlers (onCreate, onJoin, onLeave, onDestroy, onAction)
 *   - namespace::roomId identification (replaces tenant + room name)
 *   - Updater function pattern for state mutations: setSharedState(s => { s.x = 1; return s; })
 */
import { DurableObject } from 'cloudflare:workers';
import {
  type AuthContext as SharedAuthContext,
  type EdgeBaseConfig,
  type RoomNamespaceConfig,
  type RoomServerAPI,
  type RoomSender,
  type RoomHandlerContext,
} from '@edge-base/shared';
import {
  persistRoomMonitoringSnapshot,
  type RoomMonitoringSnapshot,
} from '../lib/room-monitoring.js';
import { parseConfig as getGlobalConfig } from '../lib/do-router.js';
import { ensureServerStartup } from '../lib/runtime-startup.js';

// ─── Types ───

export interface RoomDOEnv {
  JWT_USER_SECRET?: string;
  ROOM: DurableObjectNamespace;
  KV: KVNamespace;
  DATABASE?: DurableObjectNamespace;
  AUTH?: DurableObjectNamespace;
  AUTH_DB?: unknown;
  SERVICE_KEY?: string;
}

export interface RoomWSMeta {
  authenticated: boolean;
  authStateLost?: boolean;
  userId?: string;
  role?: string;
  auth?: SharedAuthContext;
  ip?: string;
  userAgent?: string;
  connectionId: string;
}

interface PlayerInfo {
  userId: string;
  connectionId: string;
  joinedAt: number;
}

// ─── Constants ───

const DEFAULT_MAX_PLAYERS = 100;
const DEFAULT_MAX_STATE_SIZE = 1048576; // 1MB
const DEFAULT_RATE_LIMIT_ACTIONS = 10;
const DEFAULT_RECONNECT_TIMEOUT_MS = 30000;
const ROOM_CLIENT_LEAVE_CLOSE_CODE = 4005;
const ROOM_AUTH_STATE_LOST_CLOSE_CODE = 4006;
const ROOM_AUTH_STATE_LOST_CLOSE_REASON = 'Room authentication state lost';
const EMPTY_ROOM_CLEANUP_DELAY_MS = 100;
const DEFAULT_IDLE_TIMEOUT_SEC = 300;
const ACTION_TIMEOUT_MS = 5000;
const DEFAULT_ROOM_AUTH_TIMEOUT_MS = 5000;
const DEFAULT_STATE_SAVE_INTERVAL_MS = 60000; // 1 minute
const DEFAULT_STATE_TTL_MS = 86400000; // 24 hours
const ROOM_EPHEMERAL_TIMERS_STORAGE_KEY = 'roomEphemeralTimers';
const roomFallbackWarnings = new Set<string>();
type RoomRateLimitScope = 'actions' | 'signals' | 'media' | 'admin';

interface PendingDisconnectDeadline {
  fireAt: number;
  connectionId: string;
}

interface PersistedRoomEphemeralTimers {
  pendingAuth?: Record<string, number>;
  disconnects?: Record<string, PendingDisconnectDeadline>;
  stateSaveAt?: number | null;
  emptyRoomCleanupAt?: number | null;
  stateTTLAlarmAt?: number | null;
}

function isRoomOperationPublic(
  namespaceConfig: RoomNamespaceConfig | null,
  operation: 'metadata' | 'join' | 'action',
): boolean {
  if (!namespaceConfig?.public) return false;
  if (namespaceConfig.public === true) return true;
  return !!namespaceConfig.public[operation];
}

function getRoomHooks(namespaceConfig?: RoomNamespaceConfig | null) {
  return namespaceConfig?.hooks;
}

function getRoomLifecycleHandlers(namespaceConfig?: RoomNamespaceConfig | null) {
  return getRoomHooks(namespaceConfig)?.lifecycle ?? namespaceConfig?.handlers?.lifecycle;
}

function getRoomActionHandlers(namespaceConfig?: RoomNamespaceConfig | null) {
  return namespaceConfig?.state?.actions ?? namespaceConfig?.handlers?.actions;
}

function getRoomTimerHandlers(namespaceConfig?: RoomNamespaceConfig | null) {
  return namespaceConfig?.state?.timers ?? namespaceConfig?.handlers?.timers;
}

function resolveRoomAuthTimeoutMs(config?: EdgeBaseConfig): number {
  const value = config?.databaseLive?.authTimeoutMs;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_ROOM_AUTH_TIMEOUT_MS;
  }
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : DEFAULT_ROOM_AUTH_TIMEOUT_MS;
}

// ─── Compute delta between two states ───

function computeDelta(
  oldState: Record<string, unknown>,
  newState: Record<string, unknown>,
): Record<string, unknown> | null {
  const delta: Record<string, unknown> = {};
  let hasChanges = false;

  for (const key of Object.keys(newState)) {
    if (JSON.stringify(oldState[key]) !== JSON.stringify(newState[key])) {
      delta[key] = newState[key];
      hasChanges = true;
    }
  }
  for (const key of Object.keys(oldState)) {
    if (!(key in newState)) {
      delta[key] = null;
      hasChanges = true;
    }
  }

  return hasChanges ? delta : null;
}

// ─── structuredClone polyfill (in case not available in older runtimes) ───

function cloneState(obj: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(obj));
}

// ─── Shared Room Runtime Base ───

export class RoomRuntimeBaseDO extends DurableObject<RoomDOEnv> {
  protected config: EdgeBaseConfig;

  // ─── Room identification ───
  protected namespace: string | null = null;
  protected roomId: string | null = null;
  protected namespaceConfig: RoomNamespaceConfig | null = null;

  // ─── 3 state areas ───
  private sharedState: Record<string, unknown> = {};
  private sharedVersion = 0;
  private playerStates = new Map<string, Record<string, unknown>>(); // userId → state
  private playerVersions = new Map<string, number>(); // userId → version
  private serverState: Record<string, unknown> = {};

  // ─── Player tracking ───
  private players = new Map<string, PlayerInfo>(); // connectionId → PlayerInfo
  private userToConnections = new Map<string, Set<string>>(); // userId → Set<connectionId>

  // ─── Lifecycle ───
  private roomCreated = false;
  private runtimeReadyPromise: Promise<void> | null = null;

  // ─── State persistence (alarm-based, hibernation-friendly) ───
  private dirty = false;
  private _stateSaveAt: number | null = null;
  private stateRecoveryNeeded = false;

  // ─── WebSocket metadata cache ───
  private _metaCache = new Map<WebSocket, RoomWSMeta>();

  // ─── Auth timeout tracking ───
  private pendingAuth = new Map<string, number>();

  // ─── Delta batching (shared state) ───
  private pendingSharedDelta: Record<string, unknown> | null = null;
  private sharedDeltaFlushQueued = false;

  // ─── Rate limiting (per connection, token bucket) ───
  private rateBuckets = new Map<string, { tokens: number; lastRefill: number }>();

  // ─── Reconnect timers ───
  private disconnectTimers = new Map<string, PendingDisconnectDeadline>(); // userId → deadline

  // ─── Named Timers (alarm multiplexer) ───
  private _timers = new Map<string, { fireAt: number; data?: unknown }>();
  private _emptyRoomCleanupAt: number | null = null;
  private _stateTTLAlarmAt: number | null = null;

  // ─── Room Metadata (queryable via HTTP without joining) ───
  private _metadata: Record<string, unknown> = {};

  constructor(ctx: DurableObjectState, env: RoomDOEnv) {
    super(ctx, env);
    this.config = this.parseConfig(env);

    // Detect hibernation wake-up
    if (ctx.getWebSockets().length > 0) {
      this.stateRecoveryNeeded = true;
    }
  }

  // ─── HTTP Fetch Handler ───

  async fetch(request: Request): Promise<Response> {
    await this.ensureRuntimeReady();
    const url = new URL(request.url);
    if (url.pathname === '/websocket') {
      return this.handleWebSocketUpgrade(request);
    }
    if (url.pathname === '/metadata' && request.method === 'GET') {
      return this.handleGetMetadata(url);
    }
    if (url.pathname === '/internal/stats' && request.method === 'GET') {
      return this.handleGetStats();
    }
    return new Response('Not found', { status: 404 });
  }

  // ─── Stats HTTP Handler (for admin monitoring) ───

  private handleGetStats(): Response {
    const snapshot = this.collectRoomMonitoringSnapshot();
    return new Response(JSON.stringify({
      subsystem: 'rooms',
      activeConnections: snapshot?.activeConnections ?? 0,
      authenticatedConnections: snapshot?.authenticatedConnections ?? 0,
      channels: snapshot ? 1 : 0,
      channelDetails: snapshot
        ? [{ channel: snapshot.room, subscribers: snapshot.activeConnections }]
        : [],
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  private resolveRoomMonitoringRoom(): string | null {
    if (this.namespace && this.roomId) {
      return `${this.namespace}::${this.roomId}`;
    }

    for (const ws of this.ctx.getWebSockets()) {
      this.getWSMeta(ws);
      if (this.namespace && this.roomId) {
        return `${this.namespace}::${this.roomId}`;
      }
    }

    return null;
  }

  private collectRoomMonitoringSnapshot(excludeWs?: WebSocket): RoomMonitoringSnapshot | null {
    const room = this.resolveRoomMonitoringRoom();
    if (!room) return null;

    let activeConnections = 0;
    let authenticatedConnections = 0;

    for (const ws of this.ctx.getWebSockets()) {
      if (excludeWs && ws === excludeWs) continue;
      activeConnections++;
      const meta = this.getWSMeta(ws);
      if (meta?.authenticated) authenticatedConnections++;
    }

    return {
      room,
      activeConnections,
      authenticatedConnections,
      updatedAt: new Date().toISOString(),
    };
  }

  private syncRoomMonitoringSnapshot(excludeWs?: WebSocket): void {
    if (!this.env.KV) return;

    const snapshot = this.collectRoomMonitoringSnapshot(excludeWs);
    const fallbackRoom = this.resolveRoomMonitoringRoom();
    const snapshotToPersist = snapshot ?? (
      fallbackRoom
        ? {
            room: fallbackRoom,
            activeConnections: 0,
            authenticatedConnections: 0,
            updatedAt: new Date().toISOString(),
          }
        : null
    );

    if (!snapshotToPersist) return;
    this.ctx.waitUntil(persistRoomMonitoringSnapshot(this.env.KV, snapshotToPersist));
  }

  // ─── Metadata HTTP Handler ───

  private async handleGetMetadata(url: URL): Promise<Response> {
    // Resolve namespace if not set (DO may have been cold-started via HTTP)
    const roomFullName = url.searchParams.get('room');
    if (roomFullName && !this.namespace) {
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

    // Metadata may not be in memory if DO was evicted/hibernated
    if (Object.keys(this._metadata).length === 0) {
      const saved = await this.ctx.storage.get('roomMetadata') as Record<string, unknown> | undefined;
      if (saved) this._metadata = saved;
    }

    return new Response(JSON.stringify(this._metadata), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ─── WebSocket Upgrade (Hibernation API) ───

  private handleWebSocketUpgrade(request: Request): Response {
    const url = new URL(request.url);
    const roomFullName = url.searchParams.get('room');

    if (roomFullName) {
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

    // Check max players
    const maxPlayers = this.namespaceConfig?.maxPlayers ?? DEFAULT_MAX_PLAYERS;
    if (this.players.size >= maxPlayers) {
      return new Response(JSON.stringify({
        type: 'error',
        code: 'ROOM_FULL',
        message: `Room is full (${maxPlayers} max)`,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const connectionId = crypto.randomUUID();
    const meta: RoomWSMeta = {
      authenticated: false,
      authStateLost: false,
      connectionId,
      ip: request.headers.get('CF-Connecting-IP')
        || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
        || undefined,
      userAgent: request.headers.get('User-Agent') || undefined,
    };

    // Accept with Hibernation API
    const tags = [
      `conn:${connectionId}`,
      `room:${roomFullName || ''}`,
    ];
    if (meta.ip) {
      tags.push(`ip:${encodeURIComponent(meta.ip)}`);
    }
    this.ctx.acceptWebSocket(server, tags);
    this._metaCache.set(server, meta);
    this.syncRoomMonitoringSnapshot();

    // Set auth timeout without pinning the DO with a JS timer.
    const authTimeoutMs = resolveRoomAuthTimeoutMs(this.config);
    this.pendingAuth.set(connectionId, Date.now() + authTimeoutMs);
    this.syncEphemeralTimersToStorage();
    this._scheduleNextAlarm();

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── Hibernation API Callbacks ───

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ensureRuntimeReady();
    if (typeof message !== 'string') return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(message);
    } catch {
      this.safeSend(ws, { type: 'error', code: 'INVALID_JSON', message: 'Invalid JSON' });
      return;
    }

    const meta = this.getWSMeta(ws);
    if (!meta) {
      ws.close(4000, 'No metadata');
      return;
    }

    const type = msg.type as string;

    // Auth must be first
    if (type === 'auth') {
      await this.handleAuth(ws, meta, msg.token as string);
      return;
    }

    // Join — must be authenticated
    if (type === 'join') {
      await this.handleJoin(ws, meta, msg);
      return;
    }

    // Everything else requires authentication
    if (!meta.authenticated) {
      this.handleUnauthenticatedSocket(ws, meta);
      return;
    }

    switch (type) {
      case 'leave':
        await this.handleExplicitLeave(ws, meta);
        break;
      case 'send':
        // Rate limiting (token bucket)
        if (!this.checkRateLimit(meta.connectionId)) {
          this.safeSend(ws, {
            type: 'action_error',
            actionType: msg.actionType as string,
            message: 'Rate limited',
            requestId: msg.requestId,
          });
          return;
        }
        await this.handleSend(ws, meta, msg);
        break;
      case 'ping':
        this.safeSend(ws, { type: 'pong' });
        break;
      default:
        this.safeSend(ws, { type: 'error', code: 'UNKNOWN_TYPE', message: `Unknown message type: ${type}` });
    }
  }

  webSocketClose(ws: WebSocket, code: number, _reason: string): void {
    const meta = this.getWSMeta(ws);
    if (meta) {
      const kicked = code === 4004;
      const explicitLeave = code === ROOM_CLIENT_LEAVE_CLOSE_CODE;
      this.handleDisconnect(meta, kicked, explicitLeave);
      this._metaCache.delete(ws);
      if (this.pendingAuth.delete(meta.connectionId)) {
        this.syncEphemeralTimersToStorage();
        this._scheduleNextAlarm();
      }
    }
    this.syncRoomMonitoringSnapshot(ws);
  }

  webSocketError(ws: WebSocket, _error: unknown): void {
    const meta = this.getWSMeta(ws);
    if (meta) {
      this.handleDisconnect(meta);
      this._metaCache.delete(ws);
      if (this.pendingAuth.delete(meta.connectionId)) {
        this.syncEphemeralTimersToStorage();
        this._scheduleNextAlarm();
      }
    }
    this.syncRoomMonitoringSnapshot(ws);
  }

  // ─── Alarm Multiplexer ───
  // Single DO alarm is shared among: named timers, state save, empty room cleanup, state TTL.

  /**
   * Recalculate and set the single DO alarm to the earliest pending event.
   */
  private _scheduleNextAlarm(): void {
    let earliest = Infinity;

    for (const timer of this._timers.values()) {
      if (timer.fireAt < earliest) earliest = timer.fireAt;
    }
    for (const fireAt of this.pendingAuth.values()) {
      if (fireAt < earliest) earliest = fireAt;
    }
    for (const timer of this.disconnectTimers.values()) {
      if (timer.fireAt < earliest) earliest = timer.fireAt;
    }
    if (this._emptyRoomCleanupAt !== null && this._emptyRoomCleanupAt < earliest) {
      earliest = this._emptyRoomCleanupAt;
    }
    if (this._stateSaveAt !== null && this._stateSaveAt < earliest) {
      earliest = this._stateSaveAt;
    }
    if (this._stateTTLAlarmAt !== null && this._stateTTLAlarmAt < earliest) {
      earliest = this._stateTTLAlarmAt;
    }

    if (earliest < Infinity) {
      this.ctx.storage.setAlarm(earliest);
    }
  }

  async alarm(): Promise<void> {
    await this.ensureRuntimeReady();

    if (this.shouldRecoverBeforeAlarm()) {
      await this.recoverFromStorage();
      this.stateRecoveryNeeded = false;
    }

    const now = Date.now();

    // 1. Close unauthenticated sockets whose auth deadline expired.
    const expiredAuthConnectionIds: string[] = [];
    for (const [connectionId, fireAt] of this.pendingAuth) {
      if (fireAt <= now) {
        expiredAuthConnectionIds.push(connectionId);
        this.pendingAuth.delete(connectionId);
      }
    }
    for (const connectionId of expiredAuthConnectionIds) {
      const ws = this.findWebSocketByConnectionId(connectionId);
      const currentMeta = ws ? this.getWSMeta(ws) : null;
      if (ws && currentMeta && !currentMeta.authenticated) {
        try {
          this.safeSend(ws, {
            type: 'error',
            code: 'AUTH_TIMEOUT',
            message: `Authentication required within ${resolveRoomAuthTimeoutMs(this.config)}ms`,
          });
          ws.close(4001, 'Authentication timeout');
        } catch {
          // WebSocket already closed by client.
        }
      }
    }
    if (expiredAuthConnectionIds.length > 0) {
      this.syncEphemeralTimersToStorage();
    }

    // 2. Fire expired named timers
    const expiredTimers: Array<{ name: string; data?: unknown }> = [];
    for (const [name, timer] of this._timers) {
      if (timer.fireAt <= now) {
        expiredTimers.push({ name, data: timer.data });
        this._timers.delete(name);
      }
    }

    for (const { name, data } of expiredTimers) {
      const handler = getRoomTimerHandlers(this.namespaceConfig ?? undefined)?.[name];
      if (handler) {
        try {
          const roomApi = this.buildRoomServerAPI();
          const ctx = await this.buildHandlerContext();
          await handler(roomApi, ctx, data);
        } catch (err) {
          console.error(`[Room] onTimer['${name}'] error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (expiredTimers.length > 0) {
      this.markDirty();
    }

    // 3. Finalize disconnect grace periods without pinning the DO.
    const expiredDisconnects: Array<{ userId: string; connectionId: string }> = [];
    for (const [userId, timer] of this.disconnectTimers) {
      if (timer.fireAt <= now) {
        expiredDisconnects.push({ userId, connectionId: timer.connectionId });
        this.disconnectTimers.delete(userId);
      }
    }
    for (const { userId, connectionId } of expiredDisconnects) {
      await this.finalizePlayerLeave(userId, connectionId, 'disconnect');
    }
    if (expiredDisconnects.length > 0) {
      this.syncEphemeralTimersToStorage();
    }

    // 4. Empty room cleanup
    if (this._emptyRoomCleanupAt !== null && this._emptyRoomCleanupAt <= now) {
      this._emptyRoomCleanupAt = null;
      if (this.players.size === 0) {
        if (Object.keys(this.sharedState).length > 0 || this.playerStates.size > 0 || Object.keys(this.serverState).length > 0) {
          // Phase 1: Clear all in-memory state
          this.sharedState = {};
          this.sharedVersion = 0;
          this.playerStates.clear();
          this.playerVersions.clear();
          this.serverState = {};
          this.roomCreated = false;
          this._timers.clear();
          this._metadata = {};
          this.pendingAuth.clear();
          this.disconnectTimers.clear();
          this.pendingSharedDelta = null;
          this.sharedDeltaFlushQueued = false;
          this.dirty = false;
          this._stateSaveAt = null;
          // Clean up persisted state
          await this.ctx.storage.delete('roomState');
          await this.ctx.storage.delete('roomTimers');
          await this.ctx.storage.delete('roomMetadata');
          await this.ctx.storage.delete(ROOM_EPHEMERAL_TIMERS_STORAGE_KEY);
          // Phase 2: Schedule idleTimeout alarm
          this._stateTTLAlarmAt = Date.now() + DEFAULT_IDLE_TIMEOUT_SEC * 1000;
          this.syncEphemeralTimersToStorage();
        } else {
          // TTL safety net alarm: room is empty and state already cleared
          this.dirty = false;
          this._stateSaveAt = null;
          await this.ctx.storage.delete('roomState');
          await this.ctx.storage.delete('roomTimers');
          await this.ctx.storage.delete('roomMetadata');
          await this.ctx.storage.delete(ROOM_EPHEMERAL_TIMERS_STORAGE_KEY);
          this._stateTTLAlarmAt = null;
        }
      }
      this.syncEphemeralTimersToStorage();
    }

    // 5. Persist dirty state without keeping the DO awake via setInterval.
    if (this._stateSaveAt !== null && this._stateSaveAt <= now) {
      this._stateSaveAt = null;
      if (this.dirty) {
        await this.persistState();
      }
    }

    // 6. State TTL safety net
    if (this._stateTTLAlarmAt !== null && this._stateTTLAlarmAt <= now) {
      this._stateTTLAlarmAt = null;
      if (this.players.size === 0) {
        await this.ctx.storage.delete('roomState');
        await this.ctx.storage.delete('roomTimers');
        await this.ctx.storage.delete('roomMetadata');
        await this.ctx.storage.delete(ROOM_EPHEMERAL_TIMERS_STORAGE_KEY);
      }
      this.syncEphemeralTimersToStorage();
    }

    // 7. Reschedule for next pending event
    this._scheduleNextAlarm();
  }

  // ─── Auth Handler ───

  private async handleAuth(ws: WebSocket, meta: RoomWSMeta, token: string): Promise<void> {
    const isReAuth = meta.authenticated;

    if (!token) {
      this.safeSend(ws, { type: 'error', code: 'AUTH_FAILED', message: 'Token required' });
      ws.close(4002, 'Authentication failed');
      return;
    }

    const secret = this.env.JWT_USER_SECRET;
    if (!secret) {
      this.safeSend(ws, { type: 'error', code: 'SERVER_ERROR', message: 'JWT secret not configured' });
      ws.close(4003, 'Server configuration error');
      return;
    }

    try {
      const headers = new Headers();
      if (meta.ip) headers.set('CF-Connecting-IP', meta.ip);
      if (meta.userAgent) headers.set('User-Agent', meta.userAgent);
      headers.set('Authorization', `Bearer ${token}`);
      const { resolveAuthContextFromToken } = await import('../middleware/auth.js');
      const auth = await resolveAuthContextFromToken(
        this.env,
        token,
        new Request('http://internal/api/room/auth', { headers }),
      );
      meta.authenticated = true;
      meta.authStateLost = false;
      meta.userId = auth.id;
      meta.role = auth.role;
      meta.auth = {
        id: auth.id,
        role: auth.role,
        email: auth.email ?? undefined,
        isAnonymous: auth.isAnonymous,
        custom: auth.custom ?? undefined,
        meta: auth.meta,
      };
      this.setWSMeta(ws, meta);

      // Clear auth timeout
      if (this.pendingAuth.delete(meta.connectionId)) {
        this.syncEphemeralTimersToStorage();
        this._scheduleNextAlarm();
      }

      // Register player (only on first auth)
      if (!isReAuth && meta.userId) {
        // Cancel disconnect timer if this user is reconnecting
        if (this.disconnectTimers.delete(meta.userId)) {
          this.syncEphemeralTimersToStorage();
          this._scheduleNextAlarm();
        }

        this.addPlayer(meta.connectionId, meta.userId);
      }

      // Send auth response
      this.safeSend(ws, {
        type: isReAuth ? 'auth_refreshed' : 'auth_success',
        userId: auth.id,
        connectionId: meta.connectionId,
      });
      this.syncRoomMonitoringSnapshot();

      // Recover state from storage if needed (after hibernation wake-up)
      if (this.stateRecoveryNeeded) {
        await this.recoverFromStorage();
        this.stateRecoveryNeeded = false;
      }
      // Note: full sync is sent during handleJoin(), not here
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error('[Room] handleAuth failed', {
        room: this.namespace && this.roomId ? `${this.namespace}::${this.roomId}` : null,
        connectionId: meta.connectionId,
        isReAuth,
        userId: meta.userId ?? null,
        message: detail,
        stack: error instanceof Error ? error.stack : undefined,
      });
      if (isReAuth) {
        this.safeSend(ws, {
          type: 'error',
          code: 'AUTH_REFRESH_FAILED',
          message: this.config.release ? 'Token refresh failed' : detail,
        });
      } else {
        this.safeSend(ws, {
          type: 'error',
          code: 'AUTH_FAILED',
          message: this.config.release ? 'Invalid or expired token' : detail,
        });
        ws.close(4002, 'Authentication failed');
      }
    }
  }

  // ─── Join Handler ───

  protected async handleJoin(
    ws: WebSocket,
    meta: RoomWSMeta,
    msg: Record<string, unknown>,
  ): Promise<void> {
    if (!meta.authenticated || !meta.userId) {
      this.handleUnauthenticatedSocket(ws, meta);
      return;
    }

    const joinAccess = this.namespaceConfig?.access?.join;
    if (this.roomId && this.namespaceConfig && !joinAccess) {
      if (this.config.release && !isRoomOperationPublic(this.namespaceConfig, 'join')) {
        this.safeSend(ws, {
          type: 'error',
          code: 'JOIN_DENIED',
          message: 'Room join requires access.join or public.join in release mode',
        });
        ws.close(4003, 'Join denied');
        return;
      }
      if (!this.config.release && this.namespace) {
        const warningKey = `${this.namespace}:join`;
        if (!roomFallbackWarnings.has(warningKey)) {
          roomFallbackWarnings.add(warningKey);
          console.warn(`[Room] ${warningKey} is using development-mode allow-by-default. Add rooms.${this.namespace}.access.join or public.join to make this explicit.`);
        }
      }
    }
    if (joinAccess && this.roomId) {
      try {
        const allowed = await Promise.resolve(joinAccess(this.buildAuthFromMeta(meta), this.roomId));
        if (!allowed) {
          this.safeSend(ws, {
            type: 'error',
            code: 'JOIN_DENIED',
            message: 'Denied by room join access rule',
          });
          ws.close(4003, 'Join denied');
          return;
        }
      } catch {
        this.safeSend(ws, {
          type: 'error',
          code: 'JOIN_DENIED',
          message: 'Denied by room join access rule',
        });
        ws.close(4003, 'Join denied');
        return;
      }
    }

    // Lifecycle: onCreate (first time only)
    if (!this.roomCreated) {
      this.roomCreated = true;
      const onCreate = getRoomLifecycleHandlers(this.namespaceConfig ?? undefined)?.onCreate;
      if (onCreate) {
        try {
          const roomApi = this.buildRoomServerAPI();
          const ctx = await this.buildHandlerContext();
          await onCreate(roomApi, ctx);
        } catch (err) {
          console.error(`[Room] onCreate error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Lifecycle: onJoin (throw to reject)
    const onJoin = getRoomLifecycleHandlers(this.namespaceConfig ?? undefined)?.onJoin;
    if (onJoin) {
      try {
        const sender = this.buildSender(meta);
        const roomApi = this.buildRoomServerAPI();
        const ctx = await this.buildHandlerContext();
        await onJoin(sender, roomApi, ctx);
      } catch (err) {
        this.safeSend(ws, {
          type: 'error',
          code: 'JOIN_DENIED',
          message: err instanceof Error ? err.message : 'Join denied',
        });
        ws.close(4003, 'Join denied');
        return;
      }
    }

    // Eviction recovery (DO was evicted, state empty, client has state)
    const lastSharedState = msg.lastSharedState as Record<string, unknown> | undefined;
    const lastSharedVersion = (msg.lastSharedVersion as number) ?? 0;
    const lastPlayerState = msg.lastPlayerState as Record<string, unknown> | undefined;
    const lastPlayerVersion = (msg.lastPlayerVersion as number) ?? 0;

    if (
      Object.keys(this.sharedState).length === 0 &&
      this.sharedVersion === 0 &&
      lastSharedState &&
      Object.keys(lastSharedState).length > 0 &&
      lastSharedVersion > 0
    ) {
      this.sharedState = lastSharedState;
      this.sharedVersion = lastSharedVersion;
    }

    // Restore player state if provided (e.g. after reconnect)
    if (lastPlayerState && Object.keys(lastPlayerState).length > 0 && lastPlayerVersion > 0) {
      const currentVer = this.playerVersions.get(meta.userId) ?? 0;
      if (currentVer === 0) {
        this.playerStates.set(meta.userId, lastPlayerState);
        this.playerVersions.set(meta.userId, lastPlayerVersion);
      }
    }

    // Initialize player state if not exists
    if (!this.playerStates.has(meta.userId)) {
      this.playerStates.set(meta.userId, {});
      this.playerVersions.set(meta.userId, 0);
    }

    // Flush any pending deltas from onJoin so other clients receive
    // the state change immediately (not after batch timer)
    this.flushSharedDelta();

    // Send full sync to this client
    this.safeSend(ws, {
      type: 'sync',
      sharedState: this.sharedState,
      sharedVersion: this.sharedVersion,
      playerState: this.playerStates.get(meta.userId) ?? {},
      playerVersion: this.playerVersions.get(meta.userId) ?? 0,
    });
  }

  // ─── Send Handler (replaces setState/patchState/sendAction) ───

  private async handleSend(
    ws: WebSocket,
    meta: RoomWSMeta,
    msg: Record<string, unknown>,
  ): Promise<void> {
    const actionType = msg.actionType as string | undefined;
    const payload = msg.payload;
    const requestId = msg.requestId as string | undefined;

    if (!actionType || typeof actionType !== 'string') {
      this.safeSend(ws, {
        type: 'action_error',
        actionType: actionType ?? '',
        message: 'actionType is required',
        requestId,
      });
      return;
    }

    if (!meta.userId) {
      this.safeSend(ws, {
        type: 'action_error',
        actionType,
        message: 'User not authenticated',
        requestId,
      });
      return;
    }

    const actionAccess = this.namespaceConfig?.access?.action;
    if (this.roomId && this.namespaceConfig && !actionAccess) {
      if (this.config.release && !isRoomOperationPublic(this.namespaceConfig, 'action')) {
        this.safeSend(ws, {
          type: 'action_error',
          actionType,
          message: 'Room action requires access.action or public.action in release mode',
          requestId,
        });
        return;
      }
      if (!this.config.release && this.namespace) {
        const warningKey = `${this.namespace}:action`;
        if (!roomFallbackWarnings.has(warningKey)) {
          roomFallbackWarnings.add(warningKey);
          console.warn(`[Room] ${warningKey} is using development-mode allow-by-default. Add rooms.${this.namespace}.access.action or public.action to make this explicit.`);
        }
      }
    }
    if (actionAccess && this.roomId) {
      try {
        const allowed = await Promise.resolve(actionAccess(
          this.buildAuthFromMeta(meta),
          this.roomId,
          actionType,
          payload,
        ));
        if (!allowed) {
          this.safeSend(ws, {
            type: 'action_error',
            actionType,
            message: 'Denied by room action access rule',
            requestId,
          });
          return;
        }
      } catch {
        this.safeSend(ws, {
          type: 'action_error',
          actionType,
          message: 'Denied by room action access rule',
          requestId,
        });
        return;
      }
    }

    // Resolve handler from config
    const handler = getRoomActionHandlers(this.namespaceConfig ?? undefined)?.[actionType];
    if (!handler) {
      this.safeSend(ws, {
        type: 'action_error',
        actionType,
        message: `No handler for action '${actionType}'`,
        requestId,
      });
      return;
    }

    const sender = this.buildSender(meta);
    const roomApi = this.buildRoomServerAPI();
    const ctx = await this.buildHandlerContext();

    try {
      const result = await Promise.race([
        handler(payload, roomApi, sender, ctx),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Action timeout')), ACTION_TIMEOUT_MS),
        ),
      ]);

      // Flush any pending shared delta immediately so clients receive
      // state changes in the same round-trip as the action_result
      this.flushSharedDelta();

      this.safeSend(ws, {
        type: 'action_result',
        actionType,
        result: result ?? null,
        requestId,
      });
    } catch (err) {
      this.flushSharedDelta();

      this.safeSend(ws, {
        type: 'action_error',
        actionType,
        message: err instanceof Error ? err.message : 'Action execution failed',
        requestId,
      });
    }
  }

  protected async handleExplicitLeave(ws: WebSocket, meta: RoomWSMeta): Promise<void> {
    const player = this.players.get(meta.connectionId);
    if (!player) {
      try {
        ws.close(ROOM_CLIENT_LEAVE_CLOSE_CODE, 'Client left room');
      } catch {
        // Socket already closed.
      }
      return;
    }

    this.players.delete(meta.connectionId);
    const conns = this.userToConnections.get(player.userId);
    if (conns) {
      conns.delete(meta.connectionId);
      if (conns.size === 0) {
        this.userToConnections.delete(player.userId);
      }
    }

    if (this.disconnectTimers.delete(player.userId)) {
      this.syncEphemeralTimersToStorage();
      this._scheduleNextAlarm();
    }

    const remainingConns = this.userToConnections.get(player.userId);
    if (!remainingConns || remainingConns.size === 0) {
      await this.finalizePlayerLeave(player.userId, meta.connectionId, 'leave');
    }

    if (this.players.size === 0 && this.disconnectTimers.size === 0) {
      this.scheduleEmptyRoomCleanup();
    }

    try {
      ws.close(ROOM_CLIENT_LEAVE_CLOSE_CODE, 'Client left room');
    } catch {
      // Socket already closed.
    }
  }

  // ─── RoomServerAPI Implementation ───

  protected buildRoomServerAPI(): RoomServerAPI {
    return {
      getSharedState: (): Record<string, unknown> => {
        return cloneState(this.sharedState);
      },

      setSharedState: (updater: (s: Record<string, unknown>) => Record<string, unknown>): void => {
        const oldState = cloneState(this.sharedState);
        const prevVersion = this.sharedVersion;
        const prevDirty = this.dirty;
        const prevStateSaveAt = this._stateSaveAt;
        this.sharedState = updater(cloneState(this.sharedState));
        this.sharedVersion++;
        this.markDirty();
        try {
          this.checkStateSizeLimit();
        } catch (err) {
          // Revert mutation
          this.sharedState = oldState;
          this.sharedVersion = prevVersion;
          this.dirty = prevDirty;
          this._stateSaveAt = prevStateSaveAt;
          this.syncEphemeralTimersToStorage();
          this._scheduleNextAlarm();
          throw err;
        }
        const delta = computeDelta(oldState, this.sharedState);
        if (delta) {
          this.queueSharedDelta(delta);
        }
      },

      player: (userId: string): Record<string, unknown> => {
        return cloneState(this.playerStates.get(userId) ?? {});
      },

      players: (): Array<[string, Record<string, unknown>]> => {
        return Array.from(this.playerStates.entries()).map(
          ([uid, state]) => [uid, cloneState(state)] as [string, Record<string, unknown>],
        );
      },

      setPlayerState: (userId: string, updater: (s: Record<string, unknown>) => Record<string, unknown>): void => {
        const oldState = cloneState(this.playerStates.get(userId) ?? {});
        const hadPrevState = this.playerStates.has(userId);
        const newState = updater(cloneState(this.playerStates.get(userId) ?? {}));
        this.playerStates.set(userId, newState);
        const prevVer = this.playerVersions.get(userId) ?? 0;
        const ver = prevVer + 1;
        this.playerVersions.set(userId, ver);
        const prevDirty = this.dirty;
        const prevStateSaveAt = this._stateSaveAt;
        this.markDirty();
        try {
          this.checkStateSizeLimit();
        } catch (err) {
          // Revert mutation
          if (hadPrevState) {
            this.playerStates.set(userId, oldState);
          } else {
            this.playerStates.delete(userId);
          }
          this.playerVersions.set(userId, prevVer);
          this.dirty = prevDirty;
          this._stateSaveAt = prevStateSaveAt;
          this.syncEphemeralTimersToStorage();
          this._scheduleNextAlarm();
          throw err;
        }
        const delta = computeDelta(oldState, newState);
        if (delta) {
          this.sendPlayerDelta(userId, delta, ver);
        }
      },

      getServerState: (): Record<string, unknown> => {
        return cloneState(this.serverState);
      },

      setServerState: (updater: (s: Record<string, unknown>) => Record<string, unknown>): void => {
        const oldState = this.serverState;
        const prevDirty = this.dirty;
        const prevStateSaveAt = this._stateSaveAt;
        this.serverState = updater(cloneState(this.serverState));
        this.markDirty();
        try {
          this.checkStateSizeLimit();
        } catch (err) {
          // Revert mutation
          this.serverState = oldState;
          this.dirty = prevDirty;
          this._stateSaveAt = prevStateSaveAt;
          this.syncEphemeralTimersToStorage();
          this._scheduleNextAlarm();
          throw err;
        }
        // No broadcast — server-only state
      },

      sendMessage: (type: string, data?: unknown, options?: { exclude?: string[] }): void => {
        this.broadcastToAuthenticated(
          {
            type: 'message',
            messageType: type,
            data: data ?? {},
          },
          undefined,
          options?.exclude,
        );
      },

      sendMessageTo: (userId: string, type: string, data?: unknown): void => {
        this.sendMessageToUser(userId, {
          type: 'message',
          messageType: type,
          data: data ?? {},
        });
      },

      kick: async (userId: string): Promise<void> => {
        await this.kickPlayer(userId);
      },

      saveState: async (): Promise<void> => {
        await this.persistState();
      },

      setTimer: (name: string, ms: number, data?: unknown): void => {
        if (ms < 0) throw new Error('Timer delay must be non-negative');
        if (!getRoomTimerHandlers(this.namespaceConfig ?? undefined)?.[name]) {
          throw new Error(`No onTimer handler for '${name}'`);
        }
        this._timers.set(name, { fireAt: Date.now() + ms, data });
        this.markDirty();
        this._scheduleNextAlarm();
      },

      clearTimer: (name: string): void => {
        this._timers.delete(name);
        this._scheduleNextAlarm();
      },

      setMetadata: (data: Record<string, unknown>): void => {
        this._metadata = data;
        void this.ctx.storage.put('roomMetadata', data);
      },

      getMetadata: (): Record<string, unknown> => {
        return cloneState(this._metadata);
      },
    };
  }

  // ─── Handler Context Builder ───

  protected async buildHandlerContext(): Promise<RoomHandlerContext> {
    const [{ buildFunctionContext }, { resolveRootServiceKey }] = await Promise.all([
      import('../lib/functions.js'),
      import('../lib/service-key.js'),
    ]);
    const ctx = buildFunctionContext({
      request: new Request('http://internal/room/action'),
      auth: null,
      /* eslint-disable @typescript-eslint/no-explicit-any */
      databaseNamespace: this.env.DATABASE as any,
      authNamespace: this.env.AUTH as any,
      d1Database: this.env.AUTH_DB as any,
      /* eslint-enable @typescript-eslint/no-explicit-any */
      config: this.config,
      env: this.env as never,
      executionCtx: this.ctx as never,
      serviceKey: resolveRootServiceKey(this.config, this.env as never),
      // Room handlers run inside a DO and should always talk to DB DOs directly.
      preferDirectDoDb: true,
    });
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: ctx.admin as any,
    };
  }

  // ─── Sender Builder ───

  protected buildSender(meta: RoomWSMeta): RoomSender {
    return {
      userId: meta.userId!,
      connectionId: meta.connectionId,
      role: meta.role,
    };
  }

  protected buildAuthFromMeta(meta: RoomWSMeta): SharedAuthContext {
    return meta.auth ?? {
      id: meta.userId ?? '',
      role: meta.role,
    };
  }

  // ─── State Persistence (DO Storage) ───

  private markDirty(): void {
    this.dirty = true;
    if (this._stateSaveAt === null) {
      const interval = this.namespaceConfig?.stateSaveInterval ?? DEFAULT_STATE_SAVE_INTERVAL_MS;
      this._stateSaveAt = Date.now() + interval;
    }
    this.syncEphemeralTimersToStorage();
    this._scheduleNextAlarm();
  }

  private async persistState(): Promise<void> {
    await this.ctx.storage.put('roomState', {
      sharedState: this.sharedState,
      playerStates: Object.fromEntries(this.playerStates),
      serverState: this.serverState,
      sharedVersion: this.sharedVersion,
      playerVersions: Object.fromEntries(this.playerVersions),
      savedAt: Date.now(),
    });
    // Persist named timers
    if (this._timers.size > 0) {
      await this.ctx.storage.put('roomTimers', Object.fromEntries(this._timers));
    } else {
      await this.ctx.storage.delete('roomTimers');
    }
    this.dirty = false;
    this._stateSaveAt = null;
    // Set TTL alarm as safety net for orphaned storage cleanup
    const ttl = this.namespaceConfig?.stateTTL ?? DEFAULT_STATE_TTL_MS;
    this._stateTTLAlarmAt = Date.now() + ttl;
    this.syncEphemeralTimersToStorage();
    this._scheduleNextAlarm();
  }

  private async recoverFromStorage(): Promise<void> {
    const saved = await this.ctx.storage.get('roomState') as Record<string, unknown> | undefined;
    const ttl = this.namespaceConfig?.stateTTL ?? DEFAULT_STATE_TTL_MS;

    if (saved && typeof saved.savedAt === 'number' && (Date.now() - saved.savedAt) < ttl) {
      // TTL valid — recover all 3 state areas
      this.sharedState = (saved.sharedState as Record<string, unknown>) ?? {};
      this.serverState = (saved.serverState as Record<string, unknown>) ?? {};
      this.sharedVersion = (saved.sharedVersion as number) ?? 0;

      const playerStatesObj = (saved.playerStates as Record<string, Record<string, unknown>>) ?? {};
      this.playerStates = new Map(Object.entries(playerStatesObj));

      const playerVersionsObj = (saved.playerVersions as Record<string, number>) ?? {};
      this.playerVersions = new Map(Object.entries(playerVersionsObj));
    } else {
      // TTL expired — discard and start fresh
      await this.ctx.storage.delete('roomState');
      await this.ctx.storage.delete('roomTimers');
    }

    // Recover named timers
    const savedTimers = await this.ctx.storage.get('roomTimers') as Record<string, { fireAt: number; data?: unknown }> | undefined;
    if (savedTimers) {
      this._timers = new Map(Object.entries(savedTimers));
    }

    // Recover metadata
    const savedMeta = await this.ctx.storage.get('roomMetadata') as Record<string, unknown> | undefined;
    if (savedMeta) {
      this._metadata = savedMeta;
    }

    const savedEphemeral = await this.ctx.storage.get(ROOM_EPHEMERAL_TIMERS_STORAGE_KEY) as PersistedRoomEphemeralTimers | undefined;
    if (savedEphemeral?.pendingAuth) {
      this.pendingAuth = new Map(
        Object.entries(savedEphemeral.pendingAuth)
          .map(([connectionId, fireAt]) => [connectionId, Number(fireAt)]),
      );
    } else {
      this.pendingAuth.clear();
    }
    if (savedEphemeral?.disconnects) {
      this.disconnectTimers = new Map(
        Object.entries(savedEphemeral.disconnects)
          .map(([userId, timer]) => [userId, { fireAt: Number(timer.fireAt), connectionId: timer.connectionId }]),
      );
    } else {
      this.disconnectTimers.clear();
    }
    this._stateSaveAt = typeof savedEphemeral?.stateSaveAt === 'number'
      ? savedEphemeral.stateSaveAt
      : null;
    this._emptyRoomCleanupAt = typeof savedEphemeral?.emptyRoomCleanupAt === 'number'
      ? savedEphemeral.emptyRoomCleanupAt
      : null;
    this._stateTTLAlarmAt = typeof savedEphemeral?.stateTTLAlarmAt === 'number'
      ? savedEphemeral.stateTTLAlarmAt
      : null;

    this._scheduleNextAlarm();
  }

  // ─── Delta Broadcasting ───

  /** Queue shared state delta and flush it at the end of the current turn. */
  private queueSharedDelta(delta: Record<string, unknown>): void {
    if (!this.pendingSharedDelta) {
      this.pendingSharedDelta = {};
    }
    Object.assign(this.pendingSharedDelta, delta);

    if (!this.sharedDeltaFlushQueued) {
      this.sharedDeltaFlushQueued = true;
      queueMicrotask(() => {
        this.sharedDeltaFlushQueued = false;
        this.flushSharedDelta();
      });
    }
  }

  private flushSharedDelta(): void {
    if (!this.pendingSharedDelta) return;

    this.broadcastToAuthenticated({
      type: 'shared_delta',
      delta: this.pendingSharedDelta,
      version: this.sharedVersion,
    });

    this.pendingSharedDelta = null;
  }

  /** Send player state delta directly (unicast, no batching) */
  private sendPlayerDelta(userId: string, delta: Record<string, unknown>, version: number): void {
    const msg = JSON.stringify({
      type: 'player_delta',
      delta,
      version,
    });

    // Find WebSocket(s) for this userId
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.getWSMeta(ws);
      if (meta?.authenticated && meta.userId === userId) {
        this.safeSendRaw(ws, msg);
      }
    }
  }

  // ─── Send Message To User (unicast) ───

  protected sendMessageToUser(userId: string, msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.getWSMeta(ws);
      if (meta?.authenticated && meta.userId === userId) {
        this.safeSendRaw(ws, json);
      }
    }
  }

  // ─── Kick Player ───

  protected async kickPlayer(userId: string): Promise<void> {
    // Collect all connection IDs for this user before closing
    const connectionsToClose: Array<{ ws: WebSocket; connectionId: string }> = [];
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.getWSMeta(ws);
      if (meta?.userId === userId) {
        connectionsToClose.push({ ws, connectionId: meta.connectionId });
      }
    }

    // Remove player and finalize leave BEFORE closing WS
    // This ensures onLeave fires synchronously and delta is queued
    for (const { connectionId } of connectionsToClose) {
      this.players.delete(connectionId);
    }
    const conns = this.userToConnections.get(userId);
    if (conns) {
      for (const { connectionId } of connectionsToClose) {
        conns.delete(connectionId);
      }
      if (conns.size === 0) {
        this.userToConnections.delete(userId);
      }
    }
    // Cancel any existing reconnect timer
    if (this.disconnectTimers.delete(userId)) {
      this.syncEphemeralTimersToStorage();
      this._scheduleNextAlarm();
    }

    // Fire onLeave with 'kicked' reason
    const firstConn = connectionsToClose[0];
    if (firstConn) {
      await this.finalizePlayerLeave(userId, firstConn.connectionId, 'kicked');
    }

    // Now close WebSockets (webSocketClose will find no player and skip)
    for (const { ws } of connectionsToClose) {
      try {
        this.safeSend(ws, { type: 'kicked' });
        ws.close(4004, 'Kicked');
      } catch {
        // Already closed
      }
    }
  }

  // ─── Player Management ───

  protected addPlayer(connectionId: string, userId: string): void {
    this.players.set(connectionId, {
      userId,
      connectionId,
      joinedAt: Date.now(),
    });

    // Track userId → connectionIds
    let conns = this.userToConnections.get(userId);
    if (!conns) {
      conns = new Set();
      this.userToConnections.set(userId, conns);
    }
    conns.add(connectionId);
  }

  protected async handleDisconnect(meta: RoomWSMeta, kicked = false, explicitLeave = false): Promise<void> {
    const player = this.players.get(meta.connectionId);
    if (!player) return;

    // Remove this connection
    this.players.delete(meta.connectionId);
    const conns = this.userToConnections.get(player.userId);
    if (conns) {
      conns.delete(meta.connectionId);
      if (conns.size === 0) {
        this.userToConnections.delete(player.userId);
      }
    }

    // Check if user has any remaining connections
    const remainingConns = this.userToConnections.get(player.userId);
    if (!remainingConns || remainingConns.size === 0) {
      if (kicked) {
        // Kicked — immediate leave, no reconnect timer
        // Cancel any existing reconnect timer for this user
        if (this.disconnectTimers.delete(player.userId)) {
          this.syncEphemeralTimersToStorage();
          this._scheduleNextAlarm();
        }
        await this.finalizePlayerLeave(player.userId, meta.connectionId, 'kicked');
      } else if (explicitLeave) {
        if (this.disconnectTimers.delete(player.userId)) {
          this.syncEphemeralTimersToStorage();
          this._scheduleNextAlarm();
        }
        await this.finalizePlayerLeave(player.userId, meta.connectionId, 'leave');
      } else {
        // Normal disconnect — start reconnect timer
        const reconnectTimeout = this.namespaceConfig?.reconnectTimeout ?? DEFAULT_RECONNECT_TIMEOUT_MS;

        if (reconnectTimeout > 0) {
          this.disconnectTimers.set(player.userId, {
            fireAt: Date.now() + reconnectTimeout,
            connectionId: meta.connectionId,
          });
          this.syncEphemeralTimersToStorage();
          this._scheduleNextAlarm();
        } else {
          // Immediate leave
          await this.finalizePlayerLeave(player.userId, meta.connectionId, 'disconnect');
        }
      }
    }

    // Schedule empty room cleanup if no players remain
    if (this.players.size === 0 && this.disconnectTimers.size === 0) {
      this.scheduleEmptyRoomCleanup();
    }
  }

  /** Finalize player removal: onLeave callback + cleanup */
  protected async finalizePlayerLeave(userId: string, connectionId: string, reason: 'leave' | 'disconnect' | 'kicked'): Promise<void> {
    // Call onLeave
    const onLeave = getRoomLifecycleHandlers(this.namespaceConfig ?? undefined)?.onLeave;
    if (onLeave) {
      try {
        const sender: RoomSender = { userId, connectionId };
        const roomApi = this.buildRoomServerAPI();
        const ctx = await this.buildHandlerContext();
        await onLeave(sender, roomApi, ctx, reason);
      } catch (err) {
        console.error(`[Room] onLeave error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Clean up player state
    this.playerStates.delete(userId);
    this.playerVersions.delete(userId);

    // Check if room is empty
    if (this.players.size === 0 && this.disconnectTimers.size === 0) {
      await this.handleRoomEmpty();
    }
  }

  /** Handle room becoming completely empty */
  private async handleRoomEmpty(): Promise<void> {
    // Call onDestroy
    const onDestroy = getRoomLifecycleHandlers(this.namespaceConfig ?? undefined)?.onDestroy;
    if (onDestroy) {
      try {
        const roomApi = this.buildRoomServerAPI();
        const ctx = await this.buildHandlerContext();
        await onDestroy(roomApi, ctx);
      } catch (err) {
        console.error(`[Room] onDestroy error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Clean up state persistence
    this.dirty = false;
    this._stateSaveAt = null;
    this._timers.clear();
    this.pendingAuth.clear();
    this.disconnectTimers.clear();
    this._metadata = {};
    await this.ctx.storage.delete('roomState');
    await this.ctx.storage.delete('roomTimers');
    await this.ctx.storage.delete('roomMetadata');
    await this.ctx.storage.delete(ROOM_EPHEMERAL_TIMERS_STORAGE_KEY);

    this.scheduleEmptyRoomCleanup();
  }

  private syncEphemeralTimersToStorage(): void {
    const pendingAuth = Object.fromEntries(this.pendingAuth);
    const disconnects = Object.fromEntries(this.disconnectTimers);
    const stateSaveAt = this._stateSaveAt;
    const emptyRoomCleanupAt = this._emptyRoomCleanupAt;
    const stateTTLAlarmAt = this._stateTTLAlarmAt;
    this.ctx.waitUntil((async () => {
      try {
        if (
          Object.keys(pendingAuth).length === 0
          && Object.keys(disconnects).length === 0
          && stateSaveAt === null
          && emptyRoomCleanupAt === null
          && stateTTLAlarmAt === null
        ) {
          await this.ctx.storage.delete(ROOM_EPHEMERAL_TIMERS_STORAGE_KEY);
          return;
        }

        await this.ctx.storage.put(ROOM_EPHEMERAL_TIMERS_STORAGE_KEY, {
          pendingAuth,
          disconnects,
          stateSaveAt,
          emptyRoomCleanupAt,
          stateTTLAlarmAt,
        } satisfies PersistedRoomEphemeralTimers);
      } catch (error) {
        console.warn('[Room] Ephemeral timer persistence skipped', {
          room: this.namespace && this.roomId ? `${this.namespace}::${this.roomId}` : null,
          pendingAuthCount: this.pendingAuth.size,
          disconnectCount: this.disconnectTimers.size,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })());
  }

  private findWebSocketByConnectionId(connectionId: string): WebSocket | null {
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.getWSMeta(ws);
      if (meta?.connectionId === connectionId) {
        return ws;
      }
    }
    return null;
  }

  private getPlayersArray(): Array<{ userId: string; connectionId: string }> {
    return Array.from(this.players.values()).map(p => ({
      userId: p.userId,
      connectionId: p.connectionId,
    }));
  }

  protected safeSend(ws: WebSocket, msg: Record<string, unknown>): void {
    this.safeSendRaw(ws, JSON.stringify(msg));
  }

  protected safeSendRaw(ws: WebSocket, msg: string): void {
    try {
      ws.send(msg);
    } catch {
      // Socket may already be closed while async work is finishing.
    }
  }

  // ─── Broadcast Helpers ───

  private broadcastToAll(msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      this.safeSendRaw(ws, json);
    }
  }

  protected broadcastToAuthenticated(
    msg: Record<string, unknown>,
    excludeConnectionId?: string,
    excludeUserIds?: string[],
  ): void {
    const json = JSON.stringify(msg);
    const excludeSet = excludeUserIds?.length ? new Set(excludeUserIds) : null;
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.getWSMeta(ws);
      if (
        meta?.authenticated &&
        meta.connectionId !== excludeConnectionId &&
        (!excludeSet || !excludeSet.has(meta.userId!))
      ) {
        this.safeSendRaw(ws, json);
      }
    }
  }

  // ─── State Size Enforcement ───

  private getTotalStateSize(): number {
    let size = JSON.stringify(this.sharedState).length;
    for (const state of this.playerStates.values()) {
      size += JSON.stringify(state).length;
    }
    size += JSON.stringify(this.serverState).length;
    return size;
  }

  private checkStateSizeLimit(): void {
    const limit = this.namespaceConfig?.maxStateSize ?? DEFAULT_MAX_STATE_SIZE;
    const size = this.getTotalStateSize();
    if (size > limit) {
      throw new Error(
        `Room state size (${size} bytes) exceeds maxStateSize limit (${limit} bytes)`,
      );
    }
  }

  // ─── Rate Limiting (Token Bucket) ───

  protected checkRateLimit(
    connectionId: string,
    scope: RoomRateLimitScope = 'actions',
  ): boolean {
    const now = Date.now();
    const rateLimit = this.namespaceConfig?.rateLimit as
      | { actions: number; signals?: number; media?: number; admin?: number }
      | undefined;
    const maxActions = (
      scope === 'signals'
        ? rateLimit?.signals
        : scope === 'media'
          ? rateLimit?.media
          : scope === 'admin'
            ? rateLimit?.admin
            : undefined
    ) ?? rateLimit?.actions ?? DEFAULT_RATE_LIMIT_ACTIONS;
    const bucketKey = `${connectionId}:${scope}`;
    let bucket = this.rateBuckets.get(bucketKey);

    if (!bucket) {
      bucket = { tokens: maxActions, lastRefill: now };
      this.rateBuckets.set(bucketKey, bucket);
    }

    // Refill tokens (1 token per 1000/maxActions ms)
    const elapsed = now - bucket.lastRefill;
    const refill = (elapsed / 1000) * maxActions;
    bucket.tokens = Math.min(maxActions, bucket.tokens + refill);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  // ─── Empty Room Cleanup ───

  private scheduleEmptyRoomCleanup(): void {
    this._emptyRoomCleanupAt = Date.now() + EMPTY_ROOM_CLEANUP_DELAY_MS;
    this.syncEphemeralTimersToStorage();
    this._scheduleNextAlarm();
  }

  // ─── WebSocket Metadata (Hibernation API) ───

  protected getWSMeta(ws: WebSocket): RoomWSMeta | null {
    const cached = this._metaCache.get(ws);
    if (cached) return cached;

    // After hibernation wake-up: rebuild from tags
    try {
      const tags = this.ctx.getTags(ws);
      if (tags.length === 0) return null;

      const connTag = tags.find(t => t.startsWith('conn:'));
      const connectionId = connTag ? connTag.substring(5) : tags[0];
      const ipTag = tags.find(t => t.startsWith('ip:'));
      const ip = ipTag ? decodeURIComponent(ipTag.substring(3)) : undefined;

      // Recover room name if lost due to hibernation
      if (!this.namespace) {
        const roomTag = tags.find(t => t.startsWith('room:'));
        if (roomTag) {
          const roomFullName = roomTag.substring(5);
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
      }

      const meta: RoomWSMeta = {
        authenticated: false, // Must re-auth after hibernation
        authStateLost: true,
        connectionId,
        ip,
      };
      this._metaCache.set(ws, meta);
      return meta;
    } catch {
      return null;
    }
  }

  protected setWSMeta(ws: WebSocket, meta: RoomWSMeta): void {
    this._metaCache.set(ws, meta);
  }

  protected handleUnauthenticatedSocket(ws: WebSocket, meta: RoomWSMeta): void {
    if (meta.authStateLost) {
      this.safeSend(ws, {
        type: 'error',
        code: 'AUTH_STATE_LOST',
        message: 'Room authentication state lost. Reconnect required.',
      });
      try {
        ws.close(ROOM_AUTH_STATE_LOST_CLOSE_CODE, ROOM_AUTH_STATE_LOST_CLOSE_REASON);
      } catch {
        // Socket may already be closing.
      }
      return;
    }

    this.safeSend(ws, { type: 'error', code: 'NOT_AUTHENTICATED', message: 'Authenticate first' });
  }

  // ─── Config ───

  private parseConfig(env: RoomDOEnv): EdgeBaseConfig {
    return getGlobalConfig(env);
  }

  private async ensureRuntimeReady(): Promise<void> {
    if (!this.runtimeReadyPromise) {
      this.runtimeReadyPromise = (async () => {
        await ensureServerStartup();
        this.config = this.parseConfig(this.env);
        if (this.namespace) {
          this.namespaceConfig = this.config.rooms?.[this.namespace] ?? null;
        }
      })();
    }

    await this.runtimeReadyPromise;
  }

  private shouldRecoverBeforeAlarm(): boolean {
    if (this.stateRecoveryNeeded) {
      return true;
    }

    if (this.ctx.getWebSockets().length > 0) {
      return false;
    }

    return (
      !this.roomCreated
      && Object.keys(this.sharedState).length === 0
      && this.playerStates.size === 0
      && Object.keys(this.serverState).length === 0
      && this.players.size === 0
      && this.userToConnections.size === 0
      && this.pendingAuth.size === 0
      && this.disconnectTimers.size === 0
      && this._timers.size === 0
      && this._stateSaveAt === null
      && this._emptyRoomCleanupAt === null
      && this._stateTTLAlarmAt === null
      && Object.keys(this._metadata).length === 0
    );
  }
}
