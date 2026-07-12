/**
 * @edge-base/react-native — Full-featured client.
 * All APIs: auth, database-live, storage, push, room, captcha (turnstile), lifecycle
 *
 * @example
 * import { createClient } from '@edge-base/react-native';
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 * import { Linking, AppState } from 'react-native';
 *
 * const client = createClient('https://my-app.edgebase.fun', {
 *   storage: AsyncStorage,
 *   secureStorage: keychainStorage,
 *   linking: Linking,
 *   appState: AppState,
 * });
 */

import {
  HttpClient,
  TableRef,
  DbRef,
  StorageClient,
  ContextManager,
  DefaultDbApi,
  HttpClientAdapter,
  PublicHttpClientAdapter,
  ApiPaths,
  FunctionsClient,
  type FilterMatchFn,
} from '@edge-base/core';
import type { ContextValue } from '@edge-base/core';
import {
  TokenManager,
  type AsyncStorageAdapter,
  type SecureRandomProvider,
} from './token-manager.js';
import { AuthClient, type LinkingAdapter } from './auth.js';
import { DatabaseLiveClient, type DatabaseLiveOptions } from './database-live.js';
import { RoomClient, type RoomOptions } from './room.js';
import { PushClient } from './push.js';
import { LifecycleManager, type AppStateAdapter } from './lifecycle.js';
import { ClientAnalytics } from './analytics.js';
import { matchesFilter } from './match-filter.js';
import type { UseTurnstileOptions } from './turnstile.js';

// ─── Options ───

export interface JuneClientOptions {
  /**
   * AsyncStorage adapter.
   * Pass `require('@react-native-async-storage/async-storage').default`
   */
  storage: AsyncStorageAdapter;

  /**
   * Keychain/Keystore-backed adapter used for refresh tokens and OAuth state.
   * Required for production; `storage` is used only as a development fallback.
   */
  secureStorage?: AsyncStorageAdapter;

  /** Explicit local-development escape hatch; never enable in production. */
  allowInsecureAuthStorageForDevelopment?: boolean;

  /** Optional explicit credential namespace; defaults to the normalized base URL. */
  authNamespace?: string;

  /** CSPRNG provider for Hermes runtimes without global crypto.getRandomValues. */
  secureRandom?: SecureRandomProvider;

  /**
   * Linking adapter — pass `require('react-native').Linking`
   * Required for OAuth sign-in.
   */
  linking?: LinkingAdapter;

  /**
   * AppState adapter — pass `require('react-native').AppState`
   * Enables auto lifecycle management:
   *   background → WebSocket disconnect
   *   foreground → reconnect + token refresh
   */
  appState?: AppStateAdapter;

  /** Database live subscription options (auto-reconnect, delays, etc.) */
  databaseLive?: DatabaseLiveOptions;

  /** Schema from typegen */
  schema?: Record<string, unknown>;
}

// ─── ClientEdgeBase ───

export class ClientEdgeBase {
  readonly auth: AuthClient;
  readonly storage: StorageClient;
  readonly push: PushClient;
  readonly functions: FunctionsClient;
  readonly analytics: ClientAnalytics;
  private databaseLive: DatabaseLiveClient;

  /** @internal exposed for advanced use (e.g. setDatabaseLive, testing) */
  readonly _tokenManager: TokenManager;
  /** @internal */
  readonly _httpClient: HttpClient;

  private lifecycleManager: LifecycleManager | null = null;
  private contextManager: ContextManager;
  private baseUrl: string;
  private core: DefaultDbApi;
  private readonly turnstileSecureRandom?: SecureRandomProvider;

  constructor(url: string, options: JuneClientOptions) {
    this.baseUrl = url.replace(/\/$/, '');
    this.turnstileSecureRandom = options.secureRandom;
    if (!options.secureStorage && !options.allowInsecureAuthStorageForDevelopment) {
      throw new Error(
        '[EdgeBase] secureStorage is required for refresh tokens and OAuth state. '
        + 'Use a Keychain/Keystore-backed adapter, or explicitly set '
        + 'allowInsecureAuthStorageForDevelopment only for local development.',
      );
    }
    this._tokenManager = new TokenManager(
      this.baseUrl,
      options.secureStorage ?? options.storage,
      {
        authNamespace: options.authNamespace,
        secureRandom: options.secureRandom,
      },
    );
    this.contextManager = new ContextManager();

    this._httpClient = new HttpClient({
      baseUrl: this.baseUrl,
      tokenManager: this._tokenManager,
      contextManager: this.contextManager,
    });

    this.core = new DefaultDbApi(new HttpClientAdapter(this._httpClient));
    const corePublic = new DefaultDbApi(new PublicHttpClientAdapter(this._httpClient));
    this.databaseLive = new DatabaseLiveClient(
      this.baseUrl,
      this._tokenManager,
      options.databaseLive,
      this.contextManager,
    );
    this.storage = new StorageClient(this._httpClient, this.core);
    const clientNamespace = options.authNamespace?.trim() || this.baseUrl;
    this.push = new PushClient(
      this._httpClient,
      options.storage,
      this.core,
      clientNamespace,
      options.secureRandom,
    );
    this.auth = new AuthClient(
      this._httpClient,
      this._tokenManager,
      this.core,
      corePublic,
      options.linking,
      this.push,
    );
    this.functions = new FunctionsClient(this._httpClient);
    this.analytics = new ClientAnalytics(this.core);

    // AppState lifecycle management
    if (options.appState) {
      const doRefresh = async (refreshToken: string) => {
        return this._httpClient.postPublic<{ accessToken: string; refreshToken: string }>(
          ApiPaths.AUTH_REFRESH,
          { refreshToken },
        );
      };

      this.lifecycleManager = new LifecycleManager(
        this._tokenManager,
        {
          disconnect: () => {
            this.databaseLive.disconnect();
          },
          reconnect: () => {
            this.databaseLive.reconnect?.();
          },
        },
        options.appState,
        doRefresh,
      );
      this.lifecycleManager.start();
    }
  }

  /**
   * Bind this client's backend origin and CSPRNG to useTurnstile().
   * The returned options mount captcha.webView when WebViewComponent is set.
   */
  turnstileOptions(
    options: Omit<UseTurnstileOptions, 'baseUrl' | 'secureRandom'>,
  ): UseTurnstileOptions {
    return {
      ...options,
      baseUrl: this.baseUrl,
      secureRandom: this.turnstileSecureRandom,
    };
  }

  /**
   * Select a DB block by namespace and optional instance ID (#133 §2).
   *
   * @example
   * const posts = await client.db('shared').table('posts').where('status', '==', 'published').getList();
   * client.db('shared').table('posts').onSnapshot((change) => { ... });
   */
  db(namespace: string, instanceId?: string): DbRef {
    return new DbRef(this.core, namespace, instanceId, this.databaseLive, matchesFilter as FilterMatchFn);
  }

  /**
   * Get a Room client for ephemeral stateful real-time sessions.
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
    return new RoomClient(this.baseUrl, namespace, roomId, this._tokenManager, options);
  }

  /** Set legacy isolateBy context state. HTTP DB routing uses db(namespace, id). */
  setContext(context: ContextValue): void {
    this.contextManager.setContext(context);
  }

  /** Set locale for auth email i18n and Accept-Language headers. */
  setLocale(locale: string | undefined): void {
    this._httpClient.setLocale(locale);
  }

  /** Get the currently configured locale override. */
  getLocale(): string | undefined {
    return this._httpClient.getLocale();
  }

  /** Get the currently configured legacy isolateBy context state. */
  getContext(): ContextValue {
    return this.contextManager.getContext();
  }

  /** Clean up all connections and listeners. */
  destroy(): void {
    this.analytics.destroy();
    this._tokenManager.destroy();
    this.lifecycleManager?.stop();
    this.databaseLive.disconnect();
  }
}

// ─── Factory ───

/** Create a React Native EdgeBase client. */
export function createClient(url: string, options: JuneClientOptions): ClientEdgeBase {
  return new ClientEdgeBase(url, options);
}
