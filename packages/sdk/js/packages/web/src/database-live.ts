import type { TokenManager, TokenUser } from './token-manager.js';
import { createSubscription } from '@edge-base/core';
import type { ContextManager, IDatabaseLiveSubscriber, Subscription as CoreSubscription } from '@edge-base/core';
import { EdgeBaseError } from '@edge-base/core';
import { refreshAccessToken } from './auth-refresh.js';

export type ChangeType = 'added' | 'modified' | 'removed';
export type FilterTuple = [string, string, unknown];
export type ErrorHandler = (error: { code: string; message: string }) => void;

interface DbChange<T = Record<string, unknown>> {
  changeType: ChangeType;
  table: string;
  docId: string;
  data: T | null;
  timestamp: string;
}

interface InternalSubscription {
  channel: string;
  handler: (change: DbChange) => void;
  filters?: Record<string, unknown>;
  serverFilters?: FilterTuple[];
  serverOrFilters?: FilterTuple[];
}

export interface DatabaseLiveOptions {
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectBaseDelay?: number;
}

export class DatabaseLiveClient implements IDatabaseLiveSubscriber {
  private ws: WebSocket | null = null;
  private connectingPromise: Promise<void> | null = null;
  private subscriptions = new Map<string, InternalSubscription[]>();
  private connectedChannels = new Set<string>();
  private channelFilters = new Map<string, FilterTuple[]>();
  private channelOrFilters = new Map<string, FilterTuple[]>();
  private errorHandlers: ErrorHandler[] = [];
  private reconnectAttempts = 0;
  private connected = false;
  private authenticated = false;
  private waitingForAuth = false;
  private authRecoveryPromise: Promise<void> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private unsubAuthState: (() => void) | null = null;

  private options: Required<DatabaseLiveOptions>;

  constructor(
    private baseUrl: string,
    private tokenManager: TokenManager,
    options?: DatabaseLiveOptions,
    contextManager?: ContextManager,
  ) {
    this.options = {
      autoReconnect: options?.autoReconnect ?? true,
      maxReconnectAttempts: options?.maxReconnectAttempts ?? 10,
      reconnectBaseDelay: options?.reconnectBaseDelay ?? 1000,
    };

    if (contextManager) {
      contextManager.onContextChange(() => this.handleContextChange());
    }

    this.unsubAuthState = this.tokenManager.onAuthStateChange((user) => {
      this.handleAuthStateChange(user);
    });
  }

  onSnapshot<T>(
    channel: string,
    callback: (change: DbChange<T>) => void,
    clientFilters?: unknown,
    serverFilters?: unknown,
    serverOrFilters?: unknown,
  ): CoreSubscription {
    const sub: InternalSubscription = {
      channel,
      handler: callback as (change: DbChange) => void,
      filters: clientFilters as Record<string, unknown> | undefined,
      serverFilters: serverFilters as FilterTuple[] | undefined,
      serverOrFilters: serverOrFilters as FilterTuple[] | undefined,
    };

    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, []);
    }
    this.subscriptions.get(channel)!.push(sub);

    // Recompute merged channel filters from all active subscriptions.
    this.recomputeChannelFilters(channel);

    this.connect(channel).catch(() => {
      // Errors surface through the normal auth/socket flow.
    });

    return createSubscription(() => {
      const subs = this.subscriptions.get(channel);
      if (!subs) return;
      const idx = subs.indexOf(sub);
      if (idx >= 0) subs.splice(idx, 1);
      if (subs.length === 0) {
        this.subscriptions.delete(channel);
        this.channelFilters.delete(channel);
        this.channelOrFilters.delete(channel);
        this.sendUnsubscribe(channel);
      } else {
        // Recompute filters from remaining subscribers and re-send to server
        this.recomputeChannelFilters(channel);
        this.sendSubscribe(channel);
      }
    });
  }

  onError(handler: ErrorHandler): CoreSubscription {
    this.errorHandlers.push(handler);
    return createSubscription(() => {
      const idx = this.errorHandlers.indexOf(handler);
      if (idx >= 0) this.errorHandlers.splice(idx, 1);
    });
  }

  async connect(channel: string): Promise<void> {
    this.connectedChannels.add(channel);

    if (this.ws && this.connected) {
      this.sendSubscribe(channel);
      return;
    }

    if (!this.hasAuthContext()) {
      this.waitingForAuth = true;
      return;
    }

    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    const connection = this.establishConnection(channel).finally(() => {
      if (this.connectingPromise === connection) {
        this.connectingPromise = null;
      }
    });
    this.connectingPromise = connection;
    return connection;
  }

  reconnect(): void {
    if (this.connected || this.connectedChannels.size === 0) return;
    const firstChannel = this.connectedChannels.values().next().value as string | undefined;
    if (!firstChannel) return;
    this.reconnectAttempts = 0;
    this.options.autoReconnect = true;
    this.connect(firstChannel).catch(() => {
      // Normal socket lifecycle will surface errors.
    });
  }

  disconnect(): void {
    this.options.autoReconnect = false;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
    this.connectingPromise = null;
    this.connectedChannels.clear();
    this.subscriptions.clear();
    this.channelFilters.clear();
    this.channelOrFilters.clear();
    this.errorHandlers = [];
    this.unsubAuthState?.();
    this.unsubAuthState = null;
  }

  private async establishConnection(channel: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.buildWsUrl(channel));
      this.ws = ws;

      ws.onopen = () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.authenticate()
          .then(() => {
            this.waitingForAuth = false;
            resolve();
          })
          .catch((error) => {
            this.handleAuthenticationFailure(error);
            reject(error);
          });
      };

      ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data as string);
      };

      ws.onclose = () => {
        this.connected = false;
        this.authenticated = false;
        this.ws = null;
        this.stopHeartbeat();

        if (
          this.options.autoReconnect
          && !this.waitingForAuth
          && this.reconnectAttempts < this.options.maxReconnectAttempts
        ) {
          this.scheduleReconnect(channel);
        }
      };

      ws.onerror = () => {
        reject(
          new EdgeBaseError(
            500,
            'Database live WebSocket connection failed. Check that the EdgeBase server is running and that database-live is enabled for this URL.',
          ),
        );
      };
    });
  }

  private async authenticate(): Promise<void> {
    const token = await this.tokenManager.getAccessToken((refreshToken) =>
      refreshAccessToken(this.baseUrl, refreshToken),
    );
    if (!token) {
      throw new EdgeBaseError(
        401,
        'Database live subscriptions require a signed-in session. Sign in before opening live subscriptions.',
      );
    }

    this.sendRaw({ type: 'auth', token, sdkVersion: '0.2.7' });

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.ws) this.ws.onmessage = originalOnMessage ?? null;
        reject(
          new EdgeBaseError(
            401,
            'Database live authentication timed out. Check the server auth response and WebSocket connectivity.',
          ),
        );
      }, 10000);

      const originalOnMessage = this.ws?.onmessage;
      if (!this.ws) return;

      const messageQueue: MessageEvent[] = [];

      this.ws.onmessage = (event: MessageEvent) => {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        if (msg.type === 'auth_success' || msg.type === 'auth_refreshed') {
          clearTimeout(timeout);
          this.authenticated = true;
          if (this.ws) this.ws.onmessage = originalOnMessage ?? null;

          if (msg.type === 'auth_refreshed') {
            const revoked = (msg.revokedChannels as string[] | undefined) ?? [];
            for (const channel of revoked) {
              this.subscriptions.delete(channel);
              this.channelFilters.delete(channel);
              this.channelOrFilters.delete(channel);
              this.connectedChannels.delete(channel);
            }
          }

          this.resubscribeAll();
          resolve();

          // Replay queued non-auth messages
          for (const queued of messageQueue) {
            if (this.ws?.onmessage) {
              this.ws.onmessage(queued);
            }
          }
          return;
        }

        if (msg.type === 'error') {
          clearTimeout(timeout);
          if (this.ws) this.ws.onmessage = originalOnMessage ?? null;
          reject(new EdgeBaseError(401, msg.message as string));
          return;
        }

        // Queue non-auth messages for replay after auth completes
        messageQueue.push(event);
      };
    });
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const type = msg.type as string;

    if (type === 'db_change') {
      const change: DbChange = {
        changeType: msg.changeType as ChangeType,
        table: msg.table as string,
        docId: msg.docId as string,
        data: msg.data as Record<string, unknown> | null,
        timestamp: msg.timestamp as string,
      };

      const messageChannel = typeof msg.channel === 'string' ? msg.channel : undefined;
      for (const [channel, subs] of this.subscriptions.entries()) {
        if (!matchesDatabaseLiveChannel(channel, change, messageChannel)) continue;
        for (const sub of subs) {
          if (sub.filters && change.data && !matchesClientFilter(change.data, sub.filters)) continue;
          sub.handler(change);
        }
      }
      return;
    }

    if (type === 'batch_changes') {
      const changes = msg.changes as Array<{
        event: string;
        docId: string;
        data: Record<string, unknown> | null;
        timestamp: string;
      }>;
      if (!Array.isArray(changes)) return;

      for (const entry of changes) {
        const change: DbChange = {
          changeType: entry.event as ChangeType,
          table: (msg.table as string | undefined) ?? '',
          docId: entry.docId,
          data: entry.data,
          timestamp: entry.timestamp,
        };

        const messageChannel = typeof msg.channel === 'string' ? msg.channel : undefined;
        for (const [channel, subs] of this.subscriptions.entries()) {
          if (!matchesDatabaseLiveChannel(channel, change, messageChannel)) continue;
          for (const sub of subs) {
            if (sub.filters && change.data && !matchesClientFilter(change.data, sub.filters)) continue;
            sub.handler(change);
          }
        }
      }
      return;
    }

    if (type === 'FILTER_RESYNC') {
      this.resyncFilters();
      return;
    }

    if (type === 'auth_refreshed') {
      const revoked = (msg.revokedChannels as string[] | undefined) ?? [];
      for (const channel of revoked) {
        this.subscriptions.delete(channel);
        this.channelFilters.delete(channel);
        this.channelOrFilters.delete(channel);
        this.connectedChannels.delete(channel);
      }
      return;
    }

    if (type === 'error') {
      if ((msg.code as string | undefined) === 'NOT_AUTHENTICATED' && this.hasAuthContext()) {
        this.recoverAuthentication();
        return;
      }

      for (const handler of this.errorHandlers) {
        handler({ code: msg.code as string, message: msg.message as string });
      }
    }
  }

  /**
   * Recompute channel-level server filters by picking the filters from the
   * first active subscription that has them.  When a subscriber is removed,
   * this ensures the next subscriber's filters take effect instead of leaving
   * stale filters from the removed subscriber.
   */
  private recomputeChannelFilters(channel: string): void {
    const subs = this.subscriptions.get(channel);
    if (!subs || subs.length === 0) {
      this.channelFilters.delete(channel);
      this.channelOrFilters.delete(channel);
      return;
    }

    // Pick the first subscription that provides each filter type
    const firstWithFilters = subs.find((s) => s.serverFilters && s.serverFilters.length > 0);
    if (firstWithFilters?.serverFilters) {
      this.channelFilters.set(channel, firstWithFilters.serverFilters);
    } else {
      this.channelFilters.delete(channel);
    }

    const firstWithOrFilters = subs.find((s) => s.serverOrFilters && s.serverOrFilters.length > 0);
    if (firstWithOrFilters?.serverOrFilters) {
      this.channelOrFilters.set(channel, firstWithOrFilters.serverOrFilters);
    } else {
      this.channelOrFilters.delete(channel);
    }
  }

  private sendSubscribe(channel: string): void {
    if (!this.authenticated) return;
    const filters = this.channelFilters.get(channel);
    const orFilters = this.channelOrFilters.get(channel);
    const msg: Record<string, unknown> = { type: 'subscribe', channel };
    if (filters && filters.length > 0) msg.filters = filters;
    if (orFilters && orFilters.length > 0) msg.orFilters = orFilters;
    this.sendRaw(msg);
  }

  private sendUnsubscribe(channel: string): void {
    this.connectedChannels.delete(channel);
    if (this.authenticated) {
      this.sendRaw({ type: 'unsubscribe', channel });
    }
  }

  private resubscribeAll(): void {
    for (const channel of this.connectedChannels) {
      this.sendSubscribe(channel);
    }
  }

  private refreshAuth(): void {
    const token = this.tokenManager.currentAccessToken;
    if (!token || !this.ws || !this.connected) return;
    this.sendRaw({ type: 'auth', token, sdkVersion: '0.2.7' });
  }

  private handleAuthStateChange(user: TokenUser | null): void {
    if (user) {
      if (this.ws && this.connected && this.authenticated) {
        this.refreshAuth();
        return;
      }

      this.waitingForAuth = false;
      if (this.connectedChannels.size > 0 && (!this.ws || !this.connected)) {
        const firstChannel = this.connectedChannels.values().next().value as string | undefined;
        if (firstChannel) {
          this.reconnectAttempts = 0;
          this.connect(firstChannel).catch(() => {
            // Connection errors are surfaced through the normal socket lifecycle.
          });
        }
      }
      return;
    }

    this.waitingForAuth = this.connectedChannels.size > 0;
    if (this.ws) {
      const socket = this.ws;
      this.stopHeartbeat();
      this.ws = null;
      this.connected = false;
      this.authenticated = false;
      try {
        socket.close(1000, 'Signed out');
      } catch {
        // Ignore close failures.
      }
      return;
    }

    this.connected = false;
    this.authenticated = false;
  }

  private handleAuthenticationFailure(error: unknown): void {
    const authError =
      error instanceof EdgeBaseError
        ? error
        : new EdgeBaseError(500, 'Database live authentication failed.');

    this.waitingForAuth = authError.code === 401
      && this.connectedChannels.size > 0
      && !this.hasAuthContext();
    this.stopHeartbeat();
    this.connected = false;
    this.authenticated = false;

    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      try {
        socket.close(4001, authError.message);
      } catch {
        // Ignore close failures.
      }
    }
  }

  private resyncFilters(): void {
    for (const [channel] of this.channelFilters) {
      const filters = this.channelFilters.get(channel) ?? [];
      const orFilters = this.channelOrFilters.get(channel) ?? [];
      if (filters.length > 0 || orFilters.length > 0) {
        const msg: Record<string, unknown> = { type: 'subscribe', channel };
        if (filters.length > 0) msg.filters = filters;
        if (orFilters.length > 0) msg.orFilters = orFilters;
        this.sendRaw(msg);
      }
    }
  }

  private scheduleReconnect(channel: string): void {
    const baseDelay = this.options.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts);
    const jitter = Math.random() * baseDelay * 0.25;
    const delay = baseDelay + jitter;
    this.reconnectAttempts++;
    setTimeout(() => {
      this.connect(channel).catch(() => {
        // Retried through normal socket lifecycle.
      });
    }, Math.min(delay, 30000));
  }

  private buildWsUrl(channel: string): string {
    const wsUrl = this.baseUrl.replace(/\/$/, '').replace(/^http/, 'ws');
    return `${wsUrl}/api/db/subscribe?channel=${encodeURIComponent(channel)}`;
  }

  private sendRaw(msg: Record<string, unknown>): void {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private hasAuthContext(): boolean {
    return Boolean(this.tokenManager.getCurrentUser() || this.tokenManager.getRefreshToken());
  }

  private recoverAuthentication(): void {
    if (this.authRecoveryPromise || !this.ws || !this.connected || !this.hasAuthContext()) {
      return;
    }

    this.authenticated = false;
    this.waitingForAuth = true;
    this.authRecoveryPromise = this.authenticate()
      .then(() => {
        this.waitingForAuth = false;
      })
      .catch((error) => {
        this.handleAuthenticationFailure(error);
        for (const handler of this.errorHandlers) {
          handler({
            code: 'NOT_AUTHENTICATED',
            message: 'Database live authentication was lost and recovery failed.',
          });
        }
      })
      .finally(() => {
        this.authRecoveryPromise = null;
      });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.connected) {
        this.sendRaw({ type: 'ping' });
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handleContextChange(): void {
    if (!this.ws || !this.connected) return;
    if (this.connectedChannels.size === 0) return;
    this.stopHeartbeat();
    this.ws.close(1000, 'Context change');
    this.ws = null;
    this.connected = false;
    this.authenticated = false;
    this.reconnectAttempts = 0;
    const firstChannel = this.connectedChannels.values().next().value as string | undefined;
    if (firstChannel) {
      this.connect(firstChannel).catch(() => {
        // Connection errors are surfaced through normal reconnect flow.
      });
    }
  }
}

function matchesClientFilter(data: Record<string, unknown>, filters: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(filters)) {
    if (data[key] !== expected) return false;
  }
  return true;
}

function matchesDatabaseLiveChannel(channel: string, change: DbChange, messageChannel?: string): boolean {
  if (messageChannel) return channel === messageChannel;
  const parts = channel.split(':');
  if (parts[0] !== 'dblive') return false;
  if (parts.length === 2) return parts[1] === change.table;
  if (parts.length === 3) return parts[2] === change.table;
  if (parts.length === 4) {
    // Could be dblive:ns:table:docId or dblive:ns:instanceId:table
    // Try table:docId first (more specific)
    if (parts[2] === change.table && change.docId === parts[3]) return true;
    // Try instanceId:table
    if (parts[3] === change.table) return true;
    return false;
  }
  return parts[3] === change.table && change.docId === parts[4];
}
