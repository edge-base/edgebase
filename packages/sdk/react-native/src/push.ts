/**
 * React Native Push Notification client.
 *
 * Platform support (FCM 일원화):
 * - iOS: FCM token via Firebase iOS SDK bridge (tokenProvider callback)
 * - Android: FCM token via FirebaseMessaging bridge (tokenProvider callback)
 *
 * Zero-parameter register() design: tokenProvider closure is set by native
 * app code (AppDelegate / Application) before register() is called.
 * SDK never calls native APIs directly — avoids hard dependency on firebase-messaging.
 *
 * @example
 * // In AppDelegate (iOS) or Application (Android):
 * client.push.setTokenProvider(async () => {
 *   const token = await messaging().getToken();  // FCM or APNs
 *   return { token, platform: 'android' };
 * });
 * // Then anywhere:
 * await client.push.register();
 */

import { ApiPaths, type HttpClient, type GeneratedDbApi } from '@edge-base/core';
import type { AsyncStorageAdapter, SecureRandomProvider } from './token-manager.js';

// ─── Types ───

export type PushPlatform = 'ios' | 'android' | 'web';

export interface PushTokenProvider {
  (): Promise<{ token: string; platform: PushPlatform }>;
}

export type PushPermissionStatus = 'granted' | 'denied' | 'not-determined' | 'provisional';

export interface PushPermissionProvider {
  getPermissionStatus(): Promise<PushPermissionStatus>;
  requestPermission(): Promise<PushPermissionStatus>;
}

export interface PushMessage {
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}

export type PushMessageHandler = (message: PushMessage) => void;

export interface PushTopicProvider {
  subscribeTopic(topic: string): Promise<void>;
  unsubscribeTopic(topic: string): Promise<void>;
}

interface CachedPushRegistration {
  version: 1;
  token: string;
  platform: PushPlatform;
  deviceId: string;
}

function parseCachedRegistration(value: string | null): CachedPushRegistration | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CachedPushRegistration>;
    if (
      parsed.version !== 1
      || typeof parsed.token !== 'string'
      || !parsed.token
      || !['ios', 'android', 'web'].includes(parsed.platform ?? '')
      || typeof parsed.deviceId !== 'string'
      || !parsed.deviceId
    ) return null;
    return parsed as CachedPushRegistration;
  } catch {
    // Legacy caches stored only the token. They deliberately miss the device
    // binding and therefore force one safe re-registration/migration.
    return null;
  }
}

const PUSH_DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const pushMutationQueues = new WeakMap<AsyncStorageAdapter, Map<string, Promise<void>>>();

function enqueuePushMutation<T>(
  storage: AsyncStorageAdapter,
  scope: string,
  operation: () => Promise<T>,
): Promise<T> {
  let queues = pushMutationQueues.get(storage);
  if (!queues) {
    queues = new Map();
    pushMutationQueues.set(storage, queues);
  }
  const previous = queues.get(scope) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  queues.set(scope, result.then(() => undefined, () => undefined));
  return result;
}

// ─── PushClient ───

export class PushClient {
  private tokenProvider: PushTokenProvider | null = null;
  private permissionProvider: PushPermissionProvider | null = null;
  private topicProvider: PushTopicProvider | null = null;
  private messageListeners: PushMessageHandler[] = [];
  private openedAppListeners: PushMessageHandler[] = [];
  private readonly tokenCacheKey: string;
  private readonly deviceIdKey: string;

  constructor(
    private http: HttpClient,
    private storage: AsyncStorageAdapter,
    private core?: GeneratedDbApi,
    namespace?: string,
    private secureRandom?: SecureRandomProvider,
  ) {
    const projectNamespace = namespace?.trim()
      || (typeof http.getBaseUrl === 'function' ? http.getBaseUrl().replace(/\/$/, '') : 'default');
    const prefix = `edgebase:${encodeURIComponent(projectNamespace)}`;
    this.tokenCacheKey = `${prefix}:push-token-cache`;
    this.deviceIdKey = `${prefix}:push-device-id`;
  }


  /**
   * Set the native token provider.
   * Must be called before register() — typically in App.tsx or native bootstrapping.
   *
   * @example (Firebase Messaging)
   * client.push.setTokenProvider(async () => ({
   *   token: await messaging().getToken(),
   *   platform: 'android',
   * }));
   *
   * @example (APNs via native bridge)
   * client.push.setTokenProvider(async () => ({
   *   token: nativeBridge.getAPNsToken(),
   *   platform: 'ios',
   * }));
   */
  setTokenProvider(provider: PushTokenProvider): void {
    this.tokenProvider = provider;
  }

  /**
   * Set the native permission provider.
   * Call this with your FCM / @notifee/react-native permission handler.
   *
   * @example (Firebase Messaging)
   * client.push.setPermissionProvider({
   *   getPermissionStatus: async () => {
   *     const status = await messaging().hasPermission();
   *     if (status === messaging.AuthorizationStatus.AUTHORIZED) return 'granted';
   *     if (status === messaging.AuthorizationStatus.PROVISIONAL) return 'provisional';
   *     if (status === messaging.AuthorizationStatus.DENIED) return 'denied';
   *     return 'not-determined';
   *   },
   *   requestPermission: async () => {
   *     const status = await messaging().requestPermission();
   *     if (status === messaging.AuthorizationStatus.AUTHORIZED) return 'granted';
   *     if (status === messaging.AuthorizationStatus.PROVISIONAL) return 'provisional';
   *     return 'denied';
   *   },
   * });
   */
  setPermissionProvider(provider: PushPermissionProvider): void {
    this.permissionProvider = provider;
  }

  /**
   * Get current push notification permission status.
   * Uses custom provider if set via setPermissionProvider(), otherwise uses
   * built-in platform defaults (PermissionsAndroid on Android, auto-grant on iOS).
   */
  async getPermissionStatus(): Promise<PushPermissionStatus> {
    if (this.permissionProvider) {
      return this.permissionProvider.getPermissionStatus();
    }
    return this._defaultGetPermissionStatus();
  }

  /**
   * Request push notification permission from the user.
   * Uses custom provider if set via setPermissionProvider(), otherwise uses
   * built-in platform defaults (PermissionsAndroid on Android, auto-grant on iOS).
   */
  async requestPermission(): Promise<PushPermissionStatus> {
    if (this.permissionProvider) {
      return this.permissionProvider.requestPermission();
    }
    return this._defaultRequestPermission();
  }


  /**
   * Register for push notifications.
   * Zero-parameter — token is acquired via setTokenProvider().
   * Token is cached; network request only fires if token changes.
   */
  async register(options?: { metadata?: Record<string, unknown> }): Promise<void> {
    if (!this.tokenProvider) {
      throw new Error(
        '[EdgeBase] push.register(): No token provider set. ' +
        'Call client.push.setTokenProvider(async () => ({ token, platform })) first.',
      );
    }

    return enqueuePushMutation(this.storage, this.tokenCacheKey, async () => {
      // Auto-request permission before token acquisition
      const permStatus = await this.requestPermission();
      if (permStatus === 'denied') return;

      const { token, platform } = await this.tokenProvider!();

      // Cache check — skip network if token unchanged and no new metadata
      const cachedRaw = await this.storage.getItem(this.tokenCacheKey);
      const cached = parseCachedRegistration(cachedRaw);
      const storedDeviceId = await this.storage.getItem(this.deviceIdKey);
      if (
        cached?.token === token
        && cached.platform === platform
        && cached.deviceId === storedDeviceId
        && !options?.metadata
      ) return;

      const deviceId = await this.getOrCreateDeviceId();

      if (this.core) {
        await this.core.pushRegister({
          deviceId,
          token,
          platform,
          metadata: options?.metadata,
        });
      } else {
        await this.http.post(ApiPaths.PUSH_REGISTER, {
          deviceId,
          token,
          platform,
          metadata: options?.metadata,
        });
      }

      await this.storage.setItem(this.tokenCacheKey, JSON.stringify({
        version: 1,
        token,
        platform,
        deviceId,
      } satisfies CachedPushRegistration));
    });
  }

  /**
   * Unregister the current device from push notifications.
   * Called automatically on signOut.
   */
  async unregister(deviceId?: string): Promise<void> {
    return enqueuePushMutation(this.storage, this.tokenCacheKey, async () => {
      const cachedRaw = await this.storage.getItem(this.tokenCacheKey);
      const cached = parseCachedRegistration(cachedRaw);
      const storedDeviceId = await this.storage.getItem(this.deviceIdKey);
      const id = deviceId ?? cached?.deviceId ?? storedDeviceId;
      if (!id) {
        if (cachedRaw) {
          throw new Error('[EdgeBase] Push registration cannot be removed because its scoped device ID is missing. The cached registration was retained for retry.');
        }
        return;
      }
      if (!PUSH_DEVICE_ID_PATTERN.test(id)) {
        throw new Error('[EdgeBase] Push registration has an invalid scoped device ID. The cached registration was retained for retry.');
      }
      if (this.core) {
        await this.core.pushUnregister({ deviceId: id });
      } else {
        await this.http.post(ApiPaths.PUSH_UNREGISTER, { deviceId: id });
      }
      await this.storage.removeItem(this.tokenCacheKey);
    });
  }

  /** Whether this EdgeBase project has a cached device registration. */
  async hasCachedRegistration(): Promise<boolean> {
    return Boolean(await this.storage.getItem(this.tokenCacheKey));
  }

  /** @internal Resolve only an already-registered device; never creates one during sign-out. */
  async getCachedRegistrationDeviceId(): Promise<string | null> {
    return enqueuePushMutation(this.storage, this.tokenCacheKey, async () => {
      const cachedRaw = await this.storage.getItem(this.tokenCacheKey);
      if (!cachedRaw) return null;
      const cached = parseCachedRegistration(cachedRaw);
      const storedDeviceId = await this.storage.getItem(this.deviceIdKey);
      const deviceId = cached?.deviceId ?? storedDeviceId;
      if (!deviceId || !PUSH_DEVICE_ID_PATTERN.test(deviceId)) {
        throw new Error('[EdgeBase] Push registration has no valid scoped device ID. The cached registration was retained for retry.');
      }
      return deviceId;
    });
  }

  /** @internal Clear a registration cache only after combined server cleanup succeeds. */
  async completeSignOutCleanup(deviceId: string): Promise<void> {
    return enqueuePushMutation(this.storage, this.tokenCacheKey, async () => {
      const cachedRaw = await this.storage.getItem(this.tokenCacheKey);
      if (!cachedRaw) return;
      const cached = parseCachedRegistration(cachedRaw);
      const storedDeviceId = await this.storage.getItem(this.deviceIdKey);
      const cachedDeviceId = cached?.deviceId ?? storedDeviceId;
      if (cachedDeviceId === deviceId) {
        await this.storage.removeItem(this.tokenCacheKey);
      }
    });
  }

  /** Listen for push messages while app is in foreground. */
  onMessage(callback: PushMessageHandler): () => void {
    this.messageListeners.push(callback);
    return () => {
      this.messageListeners = this.messageListeners.filter((h) => h !== callback);
    };
  }

  /** Listen for notification taps that opened the app. */
  onMessageOpenedApp(callback: PushMessageHandler): () => void {
    this.openedAppListeners.push(callback);
    return () => {
      this.openedAppListeners = this.openedAppListeners.filter((h) => h !== callback);
    };
  }

  /**
   * Dispatch a foreground message to all onMessage listeners.
   * Call this from your native FCM/APNs foreground handler.
   *
   * @example (Firebase Messaging)
   * messaging().onMessage(async (remoteMessage) => {
   *   client.push._dispatchForegroundMessage({
   *     title: remoteMessage.notification?.title,
   *     body: remoteMessage.notification?.body,
   *     data: remoteMessage.data,
   *   });
   * });
   */
  _dispatchForegroundMessage(message: PushMessage): void {
    for (const handler of this.messageListeners) {
      handler(message);
    }
  }

  /**
   * Dispatch an opened-app notification to all onMessageOpenedApp listeners.
   * Call this from your notification tap handler.
   */
  _dispatchOpenedAppMessage(message: PushMessage): void {
    for (const handler of this.openedAppListeners) {
      handler(message);
    }
  }

  /**
   * Set topic subscription provider.
   * Inject your Firebase RN SDK's topic subscription handlers.
   *
   * @example
   * client.push.setTopicProvider({
   *   subscribeTopic: (topic) => messaging().subscribeToTopic(topic),
   *   unsubscribeTopic: (topic) => messaging().unsubscribeFromTopic(topic),
   * });
   */
  setTopicProvider(provider: PushTopicProvider): void {
    this.topicProvider = provider;
  }

  /**
   * Subscribe to a push notification topic.
   * Delegates to the topic provider set via setTopicProvider().
   */
  async subscribeTopic(topic: string): Promise<void> {
    if (!this.topicProvider) {
      throw new Error(
        '[EdgeBase] push.subscribeTopic(): No topic provider set. ' +
        'Call client.push.setTopicProvider({ subscribeTopic, unsubscribeTopic }) first.',
      );
    }
    return this.topicProvider.subscribeTopic(topic);
  }

  /**
   * Unsubscribe from a push notification topic.
   * Delegates to the topic provider set via setTopicProvider().
   */
  async unsubscribeTopic(topic: string): Promise<void> {
    if (!this.topicProvider) {
      throw new Error(
        '[EdgeBase] push.unsubscribeTopic(): No topic provider set. ' +
        'Call client.push.setTopicProvider({ subscribeTopic, unsubscribeTopic }) first.',
      );
    }
    return this.topicProvider.unsubscribeTopic(topic);
  }

  // ─── Built-in permission defaults ───
  //
  // Used when no custom permissionProvider is set.
  // Android: uses react-native PermissionsAndroid for POST_NOTIFICATIONS (API 33+).
  // iOS: returns 'granted' — Firebase messaging handles iOS permission internally
  //       when getToken() is called. Use setPermissionProvider() for explicit control.

  private async _defaultGetPermissionStatus(): Promise<PushPermissionStatus> {
    try {
      const { Platform, PermissionsAndroid } = require('react-native');
      if (Platform.OS === 'android') {
        if (Platform.Version < 33) return 'granted'; // Pre-Android 13: no runtime permission needed
        const granted = await PermissionsAndroid.check(
          'android.permission.POST_NOTIFICATIONS',
        );
        return granted ? 'granted' : 'not-determined';
      }
      // iOS: Firebase messaging handles permission during getToken()
      return 'granted';
    } catch {
      return 'not-determined';
    }
  }

  private async _defaultRequestPermission(): Promise<PushPermissionStatus> {
    try {
      const { Platform, PermissionsAndroid } = require('react-native');
      if (Platform.OS === 'android') {
        if (Platform.Version < 33) return 'granted'; // Pre-Android 13: no runtime permission needed
        const result = await PermissionsAndroid.request(
          'android.permission.POST_NOTIFICATIONS',
        );
        return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
      }
      // iOS: Firebase messaging handles permission during getToken()
      return 'granted';
    } catch {
      return 'not-determined';
    }
  }

  // ─── Private helpers ───

  private async getOrCreateDeviceId(): Promise<string> {
    const existing = await this.storage.getItem(this.deviceIdKey);
    if (existing) return existing;

    let bytes: Uint8Array;
    if (this.secureRandom) {
      bytes = await this.secureRandom(16);
    } else if (globalThis.crypto?.getRandomValues) {
      bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
    } else {
      throw new Error('[EdgeBase] A cryptographically secure random provider is required to create a push device ID.');
    }
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 16) {
      throw new Error('[EdgeBase] secureRandom must return exactly 16 bytes for a push device ID.');
    }
    const id = `rn-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    await this.storage.setItem(this.deviceIdKey, id);
    return id;
  }
}
