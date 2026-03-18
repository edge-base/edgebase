/**
 * @edge-base/react-native — Public API
 * iOS, Android, Web (React Native Web) 모두 지원
 */

// ─── Client ───
export { createClient, ClientEdgeBase } from './client.js';
export type { JuneClientOptions } from './client.js';

// ─── Token Manager ───
export { TokenManager } from './token-manager.js';
export type { TokenPair, TokenUser, AuthStateChangeHandler, AsyncStorageAdapter } from './token-manager.js';

// ─── Auth ───
export { AuthClient } from './auth.js';
export type {
  SignUpOptions, SignInOptions, AuthResult, Session,
  UpdateProfileOptions, LinkingAdapter, PasskeysAuthOptions,
} from './auth.js';

// ─── Database Live ───
export { DatabaseLiveClient, type DatabaseLiveOptions } from './database-live.js';
export { matchesFilter } from './match-filter.js';
export type { FilterOperator, FilterEntry } from './match-filter.js';

// ─── Room ───
export { RoomClient } from './room.js';
export type {
  RoomOptions,
  Subscription,
  RoomConnectionState,
  RoomMemberLeaveReason,
  RoomSignalMeta,
  RoomMember,
  RoomReconnectInfo,
  RoomMediaKind,
  RoomMediaTrack,
  RoomMemberMediaKindState,
  RoomMemberMediaState,
  RoomMediaMember,
  RoomMediaDeviceChange,
} from './room.js';

// ─── Turnstile / Captcha ───
export { TurnstileWebView, useTurnstile, isPlatformWeb } from './turnstile.js';
export type { TurnstileWebViewProps, UseTurnstileOptions, UseTurnstileResult } from './turnstile.js';

// ─── Lifecycle ───
export { LifecycleManager, useLifecycle } from './lifecycle.js';
export type { AppStateAdapter, DatabaseLiveClientAdapter, UseLifecycleOptions } from './lifecycle.js';

// ─── Push Notifications ───
export { PushClient } from './push.js';
export type {
  PushMessage, PushMessageHandler, PushTokenProvider, PushPlatform,
  PushPermissionStatus, PushPermissionProvider,
} from './push.js';

// ─── Analytics ───
export { ClientAnalytics } from './analytics.js';
