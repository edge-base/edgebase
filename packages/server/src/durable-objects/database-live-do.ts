import { DurableObject } from 'cloudflare:workers';
import {
  getTableAccess,
  type EdgeBaseConfig,
} from '@edgebase/shared';
import { verifyAccessToken } from '../lib/jwt.js';
import { parseConfig as getGlobalConfig } from '../lib/do-router.js';
import { isDbLiveChannel } from '../lib/database-live-emitter.js';
import { resolveDbLiveAuthTimeoutMs } from '../lib/database-live-config.js';

interface DOEnv {
  JWT_USER_SECRET?: string;
}

interface DatabaseLiveEvent {
  type: 'added' | 'modified' | 'removed';
  channel: string;
  table: string;
  docId: string;
  data: Record<string, unknown> | null;
  timestamp: string;
}

export type DatabaseLiveFilterCondition = [
  string,
  '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'contains' | 'contains-any' | 'not in',
  unknown,
];
type FilterCondition = DatabaseLiveFilterCondition;
type FilterOperator = FilterCondition[1];

interface WSMeta {
  authenticated: boolean;
  userId?: string;
  role?: string;
  connectionId: string;
  subscribedChannels: string[];
  channelFilters: Map<string, FilterCondition[]>;
  channelOrFilters: Map<string, FilterCondition[]>;
  sdkVersion?: string;
  supportsBatch: boolean;
}

const MAX_FILTER_CONDITIONS = 5;
const VALID_FILTER_OPERATORS = new Set<FilterOperator>([
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'in',
  'contains',
  'contains-any',
  'not in',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFilterCondition(input: unknown): FilterCondition | null {
  if (Array.isArray(input)) {
    if (input.length !== 3) return null;
    const [field, op, value] = input;
    if (typeof field !== 'string' || typeof op !== 'string' || !VALID_FILTER_OPERATORS.has(op as FilterOperator)) {
      return null;
    }
    return [field, op as FilterOperator, value];
  }

  if (!isRecord(input)) return null;

  const field = input.field;
  const op = input.op;
  if (typeof field !== 'string' || typeof op !== 'string' || !VALID_FILTER_OPERATORS.has(op as FilterOperator)) {
    return null;
  }
  return [field, op as FilterOperator, input.value];
}

export function normalizeDatabaseLiveFilterPayload(
  input: unknown,
  label: string,
): { ok: true; value: FilterCondition[] | null | undefined } | { ok: false; message: string } {
  if (input === undefined) {
    return { ok: true, value: undefined };
  }

  if (input === null) {
    return { ok: true, value: null };
  }

  if (Array.isArray(input)) {
    if (input.length > MAX_FILTER_CONDITIONS) {
      return {
        ok: false,
        message: `${label} must be an array with at most ${MAX_FILTER_CONDITIONS} conditions`,
      };
    }
    const normalized = input.map(normalizeFilterCondition);
    if (normalized.some((condition) => condition === null)) {
      return {
        ok: false,
        message: `${label} must contain [field, op, value] tuples or { field, op, value } objects`,
      };
    }
    return { ok: true, value: normalized as FilterCondition[] };
  }

  if (isRecord(input)) {
    const singleCondition = normalizeFilterCondition(input);
    if (singleCondition) {
      return { ok: true, value: [singleCondition] };
    }

    const entries = Object.entries(input);
    if (entries.length > MAX_FILTER_CONDITIONS) {
      return {
        ok: false,
        message: `${label} must define at most ${MAX_FILTER_CONDITIONS} equality conditions`,
      };
    }
    return {
      ok: true,
      value: entries.map(([field, value]) => [field, '==', value] as FilterCondition),
    };
  }

  return {
    ok: false,
    message: `${label} must be an array, a filter object, or an equality map`,
  };
}

export class DatabaseLiveDO extends DurableObject<DOEnv> {
  private config: EdgeBaseConfig;
  private filterRecoveryNeeded = true;
  private pendingAuth = new Map<string, ReturnType<typeof setTimeout>>();
  private metaCache = new Map<WebSocket, WSMeta>();

  constructor(ctx: DurableObjectState, env: DOEnv) {
    super(ctx, env);
    this.config = getGlobalConfig(env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/internal/event') {
      return this.handleInternalEvent(request);
    }

    if (url.pathname === '/internal/batch-event') {
      return this.handleInternalBatchEvent(request);
    }

    if (url.pathname === '/internal/broadcast') {
      return this.handleInternalBroadcast(request);
    }

    if (url.pathname === '/internal/stats') {
      return this.handleStats();
    }

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade();
    }

    return Response.json({ error: 'Expected WebSocket or internal request' }, { status: 400 });
  }

  private handleWebSocketUpgrade(): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const connectionId = crypto.randomUUID();
    const meta: WSMeta = {
      authenticated: false,
      connectionId,
      subscribedChannels: [],
      channelFilters: new Map(),
      channelOrFilters: new Map(),
      supportsBatch: false,
    };

    this.ctx.acceptWebSocket(server, [connectionId]);
    this.metaCache.set(server, meta);

    const authTimeoutMs = resolveDbLiveAuthTimeoutMs(this.config);
    const timer = setTimeout(() => {
      const currentMeta = this.getWSMeta(server);
      if (currentMeta && !currentMeta.authenticated) {
        try {
          server.send(JSON.stringify({
            type: 'error',
            code: 'AUTH_TIMEOUT',
            message: `Authentication required within ${authTimeoutMs}ms`,
          }));
        } catch {
          // Socket may already be closed.
        }
        try {
          server.close(4001, 'Authentication timeout');
        } catch {
          // Ignore redundant close attempts.
        }
      }
      this.pendingAuth.delete(connectionId);
    }, authTimeoutMs);
    this.pendingAuth.set(connectionId, timer);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(message);
    } catch {
      ws.send(JSON.stringify({ type: 'error', code: 'INVALID_JSON', message: 'Invalid JSON' }));
      return;
    }

    const meta = this.getWSMeta(ws);
    if (!meta) return;

    if (msg.type === 'auth') {
      await this.handleAuth(ws, meta, msg.token as string, msg.sdkVersion as string | undefined);
      return;
    }

    if (!meta.authenticated) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'NOT_AUTHENTICATED',
        message: 'Send auth message first',
      }));
      return;
    }

    if (this.filterRecoveryNeeded) {
      this.broadcastToAuthenticated({ type: 'FILTER_RESYNC' });
      this.filterRecoveryNeeded = false;
    }

    switch (msg.type) {
      case 'subscribe':
        await this.handleSubscribe(
          ws,
          meta,
          msg.channel as string,
          msg.filters as FilterCondition[] | undefined,
          msg.orFilters as FilterCondition[] | undefined,
        );
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(ws, meta, msg.channel as string);
        break;
      case 'update_filters':
        this.handleUpdateFilters(
          ws,
          meta,
          msg.channel as string,
          msg.filters as FilterCondition[] | null,
          msg.orFilters as FilterCondition[] | null,
        );
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      default:
        ws.send(JSON.stringify({ type: 'error', code: 'UNKNOWN_TYPE', message: `Unknown message type: ${msg.type}` }));
    }
  }

  webSocketClose(ws: WebSocket): void {
    const meta = this.getWSMeta(ws);
    if (!meta) return;

    const timer = this.pendingAuth.get(meta.connectionId);
    if (timer) {
      clearTimeout(timer);
      this.pendingAuth.delete(meta.connectionId);
    }

    this.metaCache.delete(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.webSocketClose(ws);
  }

  private async handleAuth(
    ws: WebSocket,
    meta: WSMeta,
    token: string,
    sdkVersion?: string,
  ): Promise<void> {
    const isReAuth = meta.authenticated;

    if (!token) {
      ws.send(JSON.stringify({ type: 'error', code: 'AUTH_FAILED', message: 'Token required' }));
      ws.close(4002, 'Authentication failed');
      return;
    }

    const secret = this.env.JWT_USER_SECRET;
    if (!secret) {
      ws.send(JSON.stringify({ type: 'error', code: 'SERVER_ERROR', message: 'JWT secret not configured' }));
      ws.close(4003, 'Server configuration error');
      return;
    }

    try {
      const verified = await verifyAccessToken(token, secret);
      meta.authenticated = true;
      meta.userId = verified.sub;
      meta.role = (verified as Record<string, unknown>).role as string | undefined;
      if (sdkVersion) {
        meta.sdkVersion = sdkVersion;
        meta.supportsBatch = true;
      }
      this.setWSMeta(ws, meta);

      const timer = this.pendingAuth.get(meta.connectionId);
      if (timer) {
        clearTimeout(timer);
        this.pendingAuth.delete(meta.connectionId);
      }

      if (isReAuth) {
        const revokedChannels: string[] = [];
        for (const channel of [...meta.subscribedChannels]) {
          const allowed = await this.evaluateChannelAccess(channel, meta);
          if (!allowed) {
            meta.subscribedChannels = meta.subscribedChannels.filter((value) => value !== channel);
            meta.channelFilters.delete(channel);
            meta.channelOrFilters.delete(channel);
            revokedChannels.push(channel);
          }
        }
        this.setWSMeta(ws, meta);
        ws.send(JSON.stringify({
          type: 'auth_refreshed',
          userId: verified.sub,
          revokedChannels,
        }));
        return;
      }

      ws.send(JSON.stringify({
        type: 'auth_success',
        userId: verified.sub,
      }));
    } catch {
      if (isReAuth) {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'AUTH_REFRESH_FAILED',
          message: 'Token refresh failed — existing auth preserved',
        }));
        return;
      }

      ws.send(JSON.stringify({ type: 'error', code: 'AUTH_FAILED', message: 'Invalid or expired token' }));
      ws.close(4002, 'Authentication failed');
    }
  }

  private async handleSubscribe(
    ws: WebSocket,
    meta: WSMeta,
    channel: string,
    filters?: unknown,
    orFilters?: unknown,
  ): Promise<void> {
    if (!channel) {
      ws.send(JSON.stringify({ type: 'error', code: 'INVALID_CHANNEL', message: 'Channel name required' }));
      return;
    }

    if (!isDbLiveChannel(channel)) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'INVALID_CHANNEL',
        message: `Database live only supports DB channels: ${channel}`,
      }));
      return;
    }

    const normalizedFilters = normalizeDatabaseLiveFilterPayload(filters, 'Filters');
    if (!normalizedFilters.ok) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'INVALID_FILTERS',
        message: normalizedFilters.message,
      }));
      return;
    }

    const normalizedOrFilters = normalizeDatabaseLiveFilterPayload(orFilters, 'OR filters');
    if (!normalizedOrFilters.ok) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'INVALID_FILTERS',
        message: normalizedOrFilters.message,
      }));
      return;
    }

    if (!(await this.evaluateChannelAccess(channel, meta))) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'CHANNEL_ACCESS_DENIED',
        message: `Access denied to channel: ${channel}`,
      }));
      return;
    }

    if (!meta.subscribedChannels.includes(channel)) {
      meta.subscribedChannels.push(channel);
    }

    if (normalizedFilters.value && normalizedFilters.value.length > 0) {
      meta.channelFilters.set(channel, normalizedFilters.value);
    } else {
      meta.channelFilters.delete(channel);
    }

    if (normalizedOrFilters.value && normalizedOrFilters.value.length > 0) {
      meta.channelOrFilters.set(channel, normalizedOrFilters.value);
    } else {
      meta.channelOrFilters.delete(channel);
    }

    this.setWSMeta(ws, meta);
    ws.send(JSON.stringify({
      type: 'subscribed',
      channel,
      serverFilter: meta.channelFilters.has(channel) || meta.channelOrFilters.has(channel),
    }));
  }

  private handleUnsubscribe(ws: WebSocket, meta: WSMeta, channel: string): void {
    meta.subscribedChannels = meta.subscribedChannels.filter((value) => value !== channel);
    meta.channelFilters.delete(channel);
    meta.channelOrFilters.delete(channel);
    this.setWSMeta(ws, meta);
    ws.send(JSON.stringify({ type: 'unsubscribed', channel }));
  }

  private handleUpdateFilters(
    ws: WebSocket,
    meta: WSMeta,
    channel: string,
    filters: unknown,
    orFilters?: unknown,
  ): void {
    if (!channel || !meta.subscribedChannels.includes(channel)) {
      ws.send(JSON.stringify({ type: 'error', code: 'NOT_SUBSCRIBED', message: `Not subscribed to channel: ${channel}` }));
      return;
    }

    if (filters === null) {
      meta.channelFilters.delete(channel);
    } else if (filters !== undefined) {
      const normalizedFilters = normalizeDatabaseLiveFilterPayload(filters, 'Filters');
      if (!normalizedFilters.ok || normalizedFilters.value === null) {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'INVALID_FILTERS',
          message: normalizedFilters.ok ? 'Filters update must not be null.' : normalizedFilters.message,
        }));
        return;
      }
      const nextFilters = normalizedFilters.value ?? [];
      if (nextFilters.length > 0) {
        meta.channelFilters.set(channel, nextFilters);
      } else {
        meta.channelFilters.delete(channel);
      }
    }

    if (orFilters === null) {
      meta.channelOrFilters.delete(channel);
    } else if (orFilters !== undefined) {
      const normalizedOrFilters = normalizeDatabaseLiveFilterPayload(orFilters, 'OR filters');
      if (!normalizedOrFilters.ok || normalizedOrFilters.value === null) {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'INVALID_FILTERS',
          message: normalizedOrFilters.ok ? 'OR filters update must not be null.' : normalizedOrFilters.message,
        }));
        return;
      }
      const nextOrFilters = normalizedOrFilters.value ?? [];
      if (nextOrFilters.length > 0) {
        meta.channelOrFilters.set(channel, nextOrFilters);
      } else {
        meta.channelOrFilters.delete(channel);
      }
    }

    this.setWSMeta(ws, meta);
    ws.send(JSON.stringify({
      type: 'filters_updated',
      channel,
      serverFilter: meta.channelFilters.has(channel) || meta.channelOrFilters.has(channel),
    }));
  }

  private async handleInternalEvent(request: Request): Promise<Response> {
    let event: DatabaseLiveEvent;
    try {
      event = await request.json() as DatabaseLiveEvent;
    } catch {
      return Response.json({ error: 'Invalid event body' }, { status: 400 });
    }

    await this.broadcastWithFilters({
      type: 'db_change',
      channel: event.channel,
      changeType: event.type,
      table: event.table,
      docId: event.docId,
      data: event.data,
      timestamp: event.timestamp,
    }, event.data);

    return Response.json({ ok: true });
  }

  private async handleInternalBatchEvent(request: Request): Promise<Response> {
    let batch: {
      type: 'batch_changes';
      channel: string;
      table: string;
      changes: Array<{ type: string; docId: string; data: Record<string, unknown> | null; timestamp: string }>;
      total: number;
    };
    try {
      batch = await request.json() as typeof batch;
    } catch {
      return Response.json({ error: 'Invalid batch event body' }, { status: 400 });
    }

    const sockets = this.ctx.getWebSockets();
    const batchMsg = {
      type: 'batch_changes' as const,
      channel: batch.channel,
      changes: batch.changes.map((change) => ({
        event: change.type,
        docId: change.docId,
        data: change.data,
        timestamp: change.timestamp,
      })),
      total: batch.total,
    };
    const batchMsgStr = JSON.stringify(batchMsg);

    for (const ws of sockets) {
      const meta = this.getWSMeta(ws);
      if (!meta?.authenticated) continue;
      if (!meta.subscribedChannels.includes(batch.channel)) continue;

      if (meta.supportsBatch) {
        const filteredChanges: typeof batchMsg.changes = [];
        for (const change of batchMsg.changes) {
          const canRead = await this.evaluateRowReadAccess(batch.table, meta, change.data as Record<string, unknown> | null);
          if (!canRead) continue;

          let shouldSend = true;
          if (change.data && (meta.channelFilters.size > 0 || meta.channelOrFilters.size > 0)) {
            const filters = meta.channelFilters.get(batch.channel) || [];
            const orFilters = meta.channelOrFilters.get(batch.channel) || [];
            if (filters.length > 0 || orFilters.length > 0) {
              shouldSend = evaluateDatabaseLiveFilters(change.data as Record<string, unknown>, filters, orFilters);
            }
          }

          if (shouldSend) {
            filteredChanges.push(change);
          }
        }

        if (filteredChanges.length > 0) {
          const payload = filteredChanges.length === batchMsg.changes.length
            ? batchMsgStr
            : JSON.stringify({
                ...batchMsg,
                changes: filteredChanges,
                total: filteredChanges.length,
              });
          try {
            ws.send(payload);
          } catch {
            // Socket may be closing.
          }
        }
        continue;
      }

      for (const change of batch.changes) {
        const canRead = await this.evaluateRowReadAccess(batch.table, meta, change.data);
        if (!canRead) continue;

        let shouldSend = true;
        if (change.data && (meta.channelFilters.size > 0 || meta.channelOrFilters.size > 0)) {
          const filters = meta.channelFilters.get(batch.channel) || [];
          const orFilters = meta.channelOrFilters.get(batch.channel) || [];
          if (filters.length > 0 || orFilters.length > 0) {
            shouldSend = evaluateDatabaseLiveFilters(change.data as Record<string, unknown>, filters, orFilters);
          }
        }

        if (!shouldSend) continue;

        try {
          ws.send(JSON.stringify({
            type: 'db_change',
            channel: batch.channel,
            changeType: change.type,
            table: batch.table,
            docId: change.docId,
            data: change.data,
            timestamp: change.timestamp,
          }));
        } catch {
          // Socket may be closing.
        }
      }
    }

    return Response.json({ ok: true });
  }

  /**
   * Handle server-side broadcast from HookCtx.databaseLive.broadcast().
   * Sends a custom broadcast_event to all clients subscribed to matching DB channels.
   */
  private async handleInternalBroadcast(request: Request): Promise<Response> {
    let body: { channel?: string; event?: string; payload?: Record<string, unknown> };
    try {
      body = await request.json() as typeof body;
    } catch {
      return Response.json({ error: 'Invalid broadcast body' }, { status: 400 });
    }

    const { channel, event, payload } = body;
    if (!channel || typeof channel !== 'string') {
      return Response.json({ error: 'channel is required' }, { status: 400 });
    }
    if (!event || typeof event !== 'string') {
      return Response.json({ error: 'event is required' }, { status: 400 });
    }

    const msg = JSON.stringify({
      type: 'broadcast_event',
      channel,
      event,
      payload: payload ?? {},
    });

    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      const meta = this.getWSMeta(ws);
      if (!meta?.authenticated) continue;
      // Deliver to clients subscribed to the target channel or any parent channel
      if (!meta.subscribedChannels.some(sub => channel === sub || channel.startsWith(`${sub}:`))) {
        continue;
      }
      try {
        ws.send(msg);
      } catch {
        // Socket may be closing.
      }
    }

    return Response.json({ ok: true });
  }

  private handleStats(): Response {
    const sockets = this.ctx.getWebSockets();
    const channelMap = new Map<string, number>();
    let authenticated = 0;

    for (const ws of sockets) {
      const meta = this.getWSMeta(ws);
      if (!meta) continue;
      if (meta.authenticated) authenticated++;
      for (const channel of meta.subscribedChannels) {
        channelMap.set(channel, (channelMap.get(channel) ?? 0) + 1);
      }
    }

    const channelDetails = Array.from(channelMap.entries())
      .map(([channel, subscribers]) => ({ channel, subscribers }))
      .sort((a, b) => b.subscribers - a.subscribers);

    return Response.json({
      subsystem: 'database-live',
      activeConnections: sockets.length,
      authenticatedConnections: authenticated,
      channels: channelMap.size,
      channelDetails,
    });
  }

  private async broadcastWithFilters(
    msg: Record<string, unknown>,
    eventData: Record<string, unknown> | null,
  ): Promise<void> {
    const msgStr = JSON.stringify(msg);
    const sockets = this.ctx.getWebSockets();
    const msgChannel = typeof msg.channel === 'string' ? msg.channel : null;
    const tableName = typeof msg.table === 'string' ? msg.table : '';

    for (const ws of sockets) {
      const meta = this.getWSMeta(ws);
      if (!meta?.authenticated) continue;
      if (msgChannel && !meta.subscribedChannels.includes(msgChannel)) continue;

      const canRead = await this.evaluateRowReadAccess(tableName, meta, eventData);
      if (!canRead) continue;

      let shouldSend = true;
      if (eventData && (meta.channelFilters.size > 0 || meta.channelOrFilters.size > 0) && msgChannel) {
        const filters = meta.channelFilters.get(msgChannel) || [];
        const orFilters = meta.channelOrFilters.get(msgChannel) || [];
        if (filters.length > 0 || orFilters.length > 0) {
          shouldSend = evaluateDatabaseLiveFilters(eventData, filters, orFilters);
        }
      }

      if (!shouldSend) continue;

      try {
        ws.send(msgStr);
      } catch {
        // Socket may be closing.
      }
    }
  }

  private broadcastToAuthenticated(msg: Record<string, unknown>): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.getWSMeta(ws);
      if (!meta?.authenticated) continue;
      try {
        ws.send(payload);
      } catch {
        // Socket may be closing.
      }
    }
  }

  private getWSMeta(ws: WebSocket): WSMeta | null {
    const cached = this.metaCache.get(ws);
    if (cached) return cached;

    try {
      const tags = this.ctx.getTags(ws);
      if (tags.length === 0) return null;
      const connectionId = tags[0];
      const meta: WSMeta = {
        authenticated: false,
        connectionId,
        subscribedChannels: [],
        channelFilters: new Map(),
        channelOrFilters: new Map(),
        supportsBatch: false,
      };
      this.metaCache.set(ws, meta);
      return meta;
    } catch {
      return null;
    }
  }

  private setWSMeta(ws: WebSocket, meta: WSMeta): void {
    this.metaCache.set(ws, meta);
  }

  private getTableReadRule(tableName: string):
    | ((auth: Record<string, unknown> | null, row: Record<string, unknown>) => boolean | Promise<boolean>)
    | boolean
    | undefined {
    for (const dbBlock of Object.values(this.config.databases ?? {})) {
      const tableConfig = dbBlock.tables?.[tableName];
      if (tableConfig) {
        return getTableAccess(tableConfig)?.read as
          | ((auth: Record<string, unknown> | null, row: Record<string, unknown>) => boolean | Promise<boolean>)
          | boolean
          | undefined;
      }
    }

    return undefined;
  }

  private async evaluateRowReadAccess(
    tableName: string,
    meta: WSMeta,
    row: Record<string, unknown> | null,
  ): Promise<boolean> {
    const rule = this.getTableReadRule(tableName);
    if (rule === undefined) return meta.authenticated;
    if (typeof rule === 'boolean') return rule;
    if (!row) return false;

    const authCtx = meta.authenticated
      ? { id: meta.userId ?? '', role: meta.role ?? null, email: null }
      : null;

    try {
      const result = await Promise.race([
        Promise.resolve(rule(authCtx as Record<string, unknown> | null, row)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Database live row access timeout')), 50),
        ),
      ]);
      return Boolean(result);
    } catch {
      return false;
    }
  }

  private async evaluateChannelAccess(channel: string, meta: WSMeta): Promise<boolean> {
    if (!meta.authenticated || !meta.userId) return false;
    if (!isDbLiveChannel(channel)) return false;

    const tableName = this.extractTableName(channel.split(':'));
    if (!tableName) return false;

    const tableRules = this.getTableReadRule(tableName);
    if (tableRules === undefined) return meta.authenticated;
    if (typeof tableRules === 'boolean') return tableRules;

    const authCtx = meta.authenticated
      ? { id: meta.userId ?? '', role: meta.role ?? null, email: null }
      : null;

    try {
      const result = await Promise.race([
        Promise.resolve(tableRules(authCtx as Record<string, unknown> | null, {})),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Database live channel access timeout')), 50),
        ),
      ]);
      return Boolean(result);
    } catch {
      return false;
    }
  }

  private extractTableName(parts: string[]): string | null {
    if (parts.length === 3) return parts[2];
    if (parts.length === 4) {
      return parts[1] === 'shared' ? parts[2] : parts[3];
    }
    if (parts.length >= 5) return parts[3];
    return null;
  }
}

export function evaluateDatabaseLiveFilters(
  data: Record<string, unknown>,
  filters: readonly unknown[],
  orFilters?: readonly unknown[],
): boolean {
  const normalizedFilters = filters
    .map(normalizeFilterCondition)
    .filter((condition): condition is FilterCondition => condition !== null);
  if (normalizedFilters.length !== filters.length) return false;

  const andPass = normalizedFilters.every(([field, op, value]) => {
    const fieldValue = data[field];
    switch (op) {
      case '==':
        return fieldValue === value;
      case '!=':
        return fieldValue !== value;
      case '<':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue < value;
      case '<=':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue <= value;
      case '>':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue > value;
      case '>=':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue >= value;
      case 'in':
        return Array.isArray(value) && value.includes(fieldValue);
      case 'contains':
        if (typeof fieldValue === 'string') return fieldValue.includes(String(value));
        return Array.isArray(fieldValue) && fieldValue.includes(value);
      case 'contains-any':
        return Array.isArray(fieldValue) && Array.isArray(value)
          ? value.some((entry) => fieldValue.includes(entry))
          : false;
      case 'not in':
        return Array.isArray(value) ? !value.includes(fieldValue) : true;
      default:
        return false;
    }
  });

  if (!andPass) return false;
  if (!orFilters || orFilters.length === 0) return true;

  const normalizedOrFilters = orFilters
    .map(normalizeFilterCondition)
    .filter((condition): condition is FilterCondition => condition !== null);
  if (normalizedOrFilters.length !== orFilters.length) return false;

  return normalizedOrFilters.some(([field, op, value]) => {
    const fieldValue = data[field];
    switch (op) {
      case '==':
        return fieldValue === value;
      case '!=':
        return fieldValue !== value;
      case '<':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue < value;
      case '<=':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue <= value;
      case '>':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue > value;
      case '>=':
        return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue >= value;
      case 'in':
        return Array.isArray(value) && value.includes(fieldValue);
      case 'contains':
        if (typeof fieldValue === 'string') return fieldValue.includes(String(value));
        return Array.isArray(fieldValue) && fieldValue.includes(value);
      case 'contains-any':
        return Array.isArray(fieldValue) && Array.isArray(value)
          ? value.some((entry) => fieldValue.includes(entry))
          : false;
      case 'not in':
        return Array.isArray(value) ? !value.includes(fieldValue) : true;
      default:
        return false;
    }
  });
}
