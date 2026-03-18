/**
 * @edgebase-fun/web — Client-side EdgeBase SDK (browser / mobile / React Native).
 *: 독립 패키지
 *
 * Usage:
 * ```ts
 * import { createClient } from '@edgebase-fun/web';
 * const client = createClient('https://my-app.edgebase.fun');
 * ```
 */

// Client entry point
export { ClientEdgeBase, createClient, type JuneClientOptions } from './client.js';

// Auth
export { AuthClient, type AuthResult, type SignInResult, type MfaRequiredResult, type MfaFactor, type SignUpOptions, type SignInOptions, type Session } from './auth.js';
export { TokenManager, type TokenPair, type TokenUser, type AuthStateChangeHandler } from './token-manager.js';

// Database Live
export { DatabaseLiveClient, type DatabaseLiveOptions } from './database-live.js';
export { matchesFilter, type FilterOperator, type FilterEntry } from './match-filter.js';

// Captcha
export { getCaptchaToken, fetchSiteKey, resolveCaptchaToken } from './turnstile.js';

// Room
export {
  RoomClient,
  type RoomOptions,
  type Subscription,
  type RoomConnectionState,
  type RoomMemberLeaveReason,
  type RoomSignalMeta,
  type RoomMember,
  type RoomReconnectInfo,
  type RoomMediaKind,
  type RoomMediaTrack,
  type RoomMemberMediaKindState,
  type RoomMemberMediaState,
  type RoomMediaMember,
  type RoomMediaDeviceChange,
  type RoomRealtimeSessionDescription,
  type RoomRealtimeTrackObject,
  type RoomRealtimeCreateSessionRequest,
  type RoomRealtimeCreateSessionResponse,
  type RoomRealtimeIceServer,
  type RoomRealtimeIceServersRequest,
  type RoomRealtimeIceServersResponse,
  type RoomRealtimeTracksRequest,
  type RoomRealtimeTracksResponse,
  type RoomRealtimeRenegotiateRequest,
  type RoomRealtimeCloseTracksRequest,
} from './room.js';
export {
  RoomRealtimeMediaTransport,
  type RoomRealtimeMediaTransportOptions,
  type RoomRealtimeRemoteTrackEvent,
} from './room-realtime-media.js';

// Analytics
export { ClientAnalytics } from './analytics.js';

// Errors (re-exported for convenience)
export { EdgeBaseError } from '@edgebase-fun/core';
