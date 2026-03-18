/**
 * @edge-base/web — Client-side EdgeBase SDK (browser / React Native / mobile)
 *
 * @example
 * import { createClient } from '@edge-base/web';
 * const client = createClient('https://my-app.edgebase.fun');
 * await client.auth.signUp({ email: 'user@test.com', password: 'pass123' });
 * const posts = await client.db('shared').table('posts').where('status', '==', 'published').get();
 */

import { HttpClient } from '@edge-base/core';
import { ContextManager } from '@edge-base/core';
import type { ContextValue } from '@edge-base/core';
import { DbRef } from '@edge-base/core';
import { StorageClient } from '@edge-base/core';
import { FunctionsClient } from '@edge-base/core';
import { DefaultDbApi, HttpClientAdapter, PublicHttpClientAdapter } from '@edge-base/core';
import { DatabaseLiveClient, type DatabaseLiveOptions } from './database-live.js';
import type { RoomOptions } from './room.js';
import { RoomClient } from './room.js';
import { matchesFilter } from './match-filter.js';
import { TokenManager } from './token-manager.js';
import { AuthClient } from './auth.js';
import { ClientAnalytics } from './analytics.js';
import { createBrowserStorage } from './browser-storage.js';

// ─── Option types ───

/** Options for createClient() */
export interface JuneClientOptions {
  /** Schema from typegen (build-time metadata) */
  schema?: Record<string, unknown>;
  /** Database live subscription options (auto-reconnect, delays, etc.) */
  databaseLive?: DatabaseLiveOptions;
}

// ─── Client SDK (browser / mobile) ───

/**
 * Client-side EdgeBase SDK.
 * Exposes: auth, db, storage, room, push, destroy.
 * Does NOT expose: adminAuth, sql (admin-only).
 *
 * @example
 * const client = createClient('https://my-app.edgebase.fun');
 * const posts = await client.db('shared').table('posts').where('status', '==', 'published').get();
 */
export class ClientEdgeBase {
  readonly auth: AuthClient;
  readonly storage: StorageClient;
  readonly functions: FunctionsClient;
  readonly analytics: ClientAnalytics;
  private baseUrl: string;
  private databaseLive: DatabaseLiveClient;

  /** Push notification management. */
  readonly push: {
    /**
     * Set the FCM token provider. Must be called before register().
     * @example
     * import { getToken, getMessaging } from 'firebase/messaging';
     * const messaging = getMessaging(app);
     * client.push.setTokenProvider(() => getToken(messaging, { vapidKey: '...' }));
     */
    setTokenProvider: (provider: () => Promise<string>) => void;
    /**
     * Register for push notifications.
     * Requires setTokenProvider() first. Token is cached; network request only happens on change.
     */
    register: (options?: { metadata?: Record<string, unknown> }) => Promise<void>;
    /** Unregister the current device. Pass deviceId to unregister a specific device. */
    unregister: (deviceId?: string) => Promise<void>;
    /** Subscribe to a push notification topic (server-side via FCM IID API). */
    subscribeTopic: (topic: string) => Promise<void>;
    /** Unsubscribe from a push notification topic (server-side via FCM IID API). */
    unsubscribeTopic: (topic: string) => Promise<void>;
    /** Listen for push messages in foreground. */
    onMessage: (callback: (message: { title?: string; body?: string; data?: Record<string, unknown> }) => void) => void;
    /** Listen for notification taps that opened the app. */
    onMessageOpenedApp: (callback: (message: { title?: string; body?: string; data?: Record<string, unknown> }) => void) => void;
    /** Get current notification permission status. */
    getPermissionStatus: () => 'granted' | 'denied' | 'notDetermined';
    /** Request notification permission from the user. */
    requestPermission: () => Promise<'granted' | 'denied'>;
  };

  private tokenManager: TokenManager;
  private httpClient: HttpClient;
  private contextManager: ContextManager;
  private core: DefaultDbApi;

  constructor(url: string, options?: JuneClientOptions) {
    const baseUrl = url.replace(/\/$/, '');
    this.tokenManager = new TokenManager(baseUrl);
    this.contextManager = new ContextManager();
    this.httpClient = new HttpClient({
      baseUrl,
      tokenManager: this.tokenManager,
      contextManager: this.contextManager,
    });
    this.core = new DefaultDbApi(new HttpClientAdapter(this.httpClient));
    const corePublic = new DefaultDbApi(new PublicHttpClientAdapter(this.httpClient));
    this.auth = new AuthClient(this.httpClient, this.tokenManager, this.core, corePublic);
    this.databaseLive = new DatabaseLiveClient(baseUrl, this.tokenManager, options?.databaseLive, this.contextManager);
    this.storage = new StorageClient(this.httpClient, this.core);
    this.functions = new FunctionsClient(this.httpClient);
    this.analytics = new ClientAnalytics(this.httpClient, baseUrl, this.core);
    this.baseUrl = baseUrl;
    const storage = createBrowserStorage();

    // Push — closures over generated core (no hardcoded paths)
    const core = this.core;
    const messageListeners: Array<(msg: { title?: string; body?: string; data?: Record<string, unknown> }) => void> = [];
    const openedAppListeners: Array<(msg: { title?: string; body?: string; data?: Record<string, unknown> }) => void> = [];

    // Listen for Service Worker messages (foreground push)
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'push') {
          const msg = event.data.payload ?? event.data;
          for (const cb of messageListeners) cb(msg);
        }
        if (event.data?.type === 'notificationclick') {
          const msg = event.data.payload ?? event.data;
          for (const cb of openedAppListeners) cb(msg);
        }
      });
    }

    // Helper: get or create persistent device ID
    const getDeviceId = (): string => {
      const key = 'eb_push_device_id';
      let id = storage.getItem(key);
      if (!id) {
        id = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        storage.setItem(key, id);
      }
      return id;
    };

    // Helper: token cache (skip network if unchanged)
    const CACHE_KEY = 'eb_push_token_cache';
    const getCachedToken = (): string | null => storage.getItem(CACHE_KEY);
    const setCachedToken = (token: string) => {
      storage.setItem(CACHE_KEY, token);
    };

    // FCM token provider — set by app via setTokenProvider()
    let tokenProvider: (() => Promise<string>) | null = null;

    // Helper: detect browser name + version from User-Agent
    const detectBrowser = (): string => {
      if (typeof navigator === 'undefined') return 'unknown';
      const ua = navigator.userAgent;
      // Order matters — Edge includes Chrome, Chrome includes Safari
      if (ua.includes('Edg/')) return 'Edge ' + (ua.match(/Edg\/(\d+)/)?.[1] ?? '');
      if (ua.includes('OPR/') || ua.includes('Opera/')) return 'Opera ' + (ua.match(/OPR\/(\d+)/)?.[1] ?? '');
      if (ua.includes('Firefox/')) return 'Firefox ' + (ua.match(/Firefox\/(\d+)/)?.[1] ?? '');
      if (ua.includes('Chrome/') && !ua.includes('Edg/')) return 'Chrome ' + (ua.match(/Chrome\/(\d+)/)?.[1] ?? '');
      if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'Safari ' + (ua.match(/Version\/(\d+)/)?.[1] ?? '');
      return 'Browser';
    };

    // Helper: detect OS from User-Agent
    const detectOS = (): string => {
      if (typeof navigator === 'undefined') return 'unknown';
      const ua = navigator.userAgent;
      if (ua.includes('Mac OS X')) {
        const ver = ua.match(/Mac OS X (\d+[._]\d+)/)?.[1]?.replace(/_/g, '.') ?? '';
        return 'macOS ' + ver;
      }
      if (ua.includes('Windows NT')) {
        const ver = ua.match(/Windows NT (\d+\.\d+)/)?.[1] ?? '';
        return 'Windows ' + ver;
      }
      if (ua.includes('Android')) return 'Android ' + (ua.match(/Android (\d+)/)?.[1] ?? '');
      if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS ' + (ua.match(/OS (\d+)/)?.[1] ?? '');
      if (ua.includes('Linux')) return 'Linux';
      return 'unknown';
    };

    // Helper: collect device info automatically
    const collectDeviceInfo = (): { name: string; osVersion: string; locale: string } => ({
      name: detectBrowser(),
      osVersion: detectOS(),
      locale: typeof navigator !== 'undefined' ? navigator.language : 'unknown',
    });

    this.push = {
      setTokenProvider(provider: () => Promise<string>): void {
        tokenProvider = provider;
      },

      // register — Decision §5/§9/§10 (FCM 일원화)
      async register(options?: { metadata?: Record<string, unknown> }): Promise<void> {
        // 1. Request permission
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          const perm = await Notification.requestPermission();
          if (perm !== 'granted') return;
        }
        if (typeof Notification !== 'undefined' && Notification.permission === 'denied') return;

        // 2. Get FCM token via provider (must be set by app using setTokenProvider)
        if (!tokenProvider) {
          throw new Error('Token provider not set. Call client.push.setTokenProvider() first.');
        }
        const token = await tokenProvider();

        // 3. Check token cache — skip if unchanged (§9)
        if (getCachedToken() === token && !options?.metadata) return;

        // 4. Register with server — auto-collect deviceInfo
        const deviceId = getDeviceId();
        await core.pushRegister({
          deviceId,
          token,
          platform: 'web',
          deviceInfo: collectDeviceInfo(),
          metadata: options?.metadata,
        });
        setCachedToken(token);
      },

      async unregister(deviceId?: string): Promise<void> {
        const id = deviceId ?? getDeviceId();
        await core.pushUnregister({ deviceId: id });
        storage.removeItem(CACHE_KEY);
      },

      async subscribeTopic(topic: string): Promise<void> {
        await core.pushTopicSubscribe({ topic });
      },

      async unsubscribeTopic(topic: string): Promise<void> {
        await core.pushTopicUnsubscribe({ topic });
      },

      onMessage(callback) {
        messageListeners.push(callback);
      },
      onMessageOpenedApp(callback) {
        openedAppListeners.push(callback);
      },
      getPermissionStatus(): 'granted' | 'denied' | 'notDetermined' {
        if (typeof Notification === 'undefined') return 'notDetermined';
        if (Notification.permission === 'granted') return 'granted';
        if (Notification.permission === 'denied') return 'denied';
        return 'notDetermined';
      },
      async requestPermission(): Promise<'granted' | 'denied'> {
        if (typeof Notification === 'undefined') return 'denied';
        const result = await Notification.requestPermission();
        return result === 'granted' ? 'granted' : 'denied';
      },
    };

    // ─── Auto-unregister push on signOut ───
    // Wrap auth.signOut so the current device token is removed before clearing
    // session tokens. This prevents stale tokens accumulating in KV.
    const originalSignOut = this.auth.signOut.bind(this.auth);
    const pushRef = this.push;
    const cacheKey = CACHE_KEY;
    this.auth.signOut = async function (): Promise<void> {
      // Best-effort push unregister — never fail signOut because of push
      try {
        if (storage.getItem(cacheKey)) {
          await pushRef.unregister();
        }
      } catch { /* ignore */ }
      return originalSignOut();
    };
  }

  /**
   * Access a DB block by namespace + optional instance ID. (§2)
   *
   * @example
   * // Static shared DB (id omitted)
   * const posts = await client.db('shared').table('posts').get();
   *
   * // Dynamic workspace DB
   * const docs = await client.db('workspace', 'ws-456').table('documents').get();
   *
   * // Per-user DB
   * const notes = await client.db('user', userId).table('notes').get();
   */
  db(namespace: string, id?: string): DbRef {
    return new DbRef(this.core, namespace, id, this.databaseLive, matchesFilter);
  }

  /**
   * Create a RoomClient for a specific namespace and room ID.
   *
   * @param namespace - The room namespace (e.g. 'game', 'chat')
   * @param roomId - The room instance ID within the namespace
   * @param options - Connection options
   *
   * @example
   * const room = client.room('game', 'room-123');
   * await room.join();
   * const result = await room.send('SET_SCORE', { score: 42 });
   */
  room(namespace: string, roomId: string, options?: RoomOptions): RoomClient {
    return new RoomClient(this.baseUrl, namespace, roomId, this.tokenManager, options);
  }

  /**
   * Get room metadata without joining (HTTP GET). No WebSocket connection needed.
   * Useful for lobby screens where you need room info before joining.
   *
   * @param namespace - The room namespace (e.g. 'game')
   * @param roomId - The room instance ID
   * @returns Developer-defined metadata set by room.setMetadata() on the server
   */
  async getRoomMetadata(namespace: string, roomId: string): Promise<Record<string, unknown>> {
    return RoomClient.getMetadata(this.baseUrl, namespace, roomId);
  }

  /**
   * Set locale for i18n. Auth emails (verification, password reset, magic link, etc.)
   * will be sent in this language. Also sent as Accept-Language header on all requests.
   *
   * @param locale - BCP 47 language tag (e.g. 'ko', 'ja', 'fr') or undefined to clear
   *
   * @example
   * client.setLocale('ko'); // Korean
   * await client.auth.signUp({ email, password }); // verification email in Korean
   * client.setLocale(undefined); // clear — falls back to user's stored locale
   */
  setLocale(locale: string | undefined): void {
    this.httpClient.setLocale(locale);
  }

  /** Get the currently set locale (undefined = using server default) */
  getLocale(): string | undefined {
    return this.httpClient.getLocale();
  }

  /** Set legacy isolateBy context state. HTTP DB routing uses db(namespace, id). */
  setContext(context: ContextValue): void {
    this.contextManager.setContext(context);
  }

  /** Get the currently configured legacy isolateBy context state. */
  getContext(): ContextValue {
    return this.contextManager.getContext();
  }

  destroy(): void {
    this.analytics.destroy();
    this.tokenManager.destroy();
    this.databaseLive.disconnect();
  }
}

// ─── Factory ───

/** Create a client-side EdgeBase SDK instance. */
export function createClient(url: string, options?: JuneClientOptions): ClientEdgeBase {
  return new ClientEdgeBase(url, options);
}
