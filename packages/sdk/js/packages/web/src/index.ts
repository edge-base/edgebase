/**
 * @edge-base/web — Client-side EdgeBase SDK (browser / mobile / React Native).
 *: 독립 패키지
 *
 * Usage:
 * ```ts
 * import { createClient } from '@edge-base/web';
 * const client = createClient('https://my-app.edgebase.fun');
 * ```
 */

// Client entry point
export { ClientEdgeBase, createClient, type JuneClientOptions } from './client.js';

// Auth
export { AuthClient, isAuthResult, isMfaRequired, type AuthResult, type SignInResult, type MfaRequiredResult, type MfaFactor, type SignUpOptions, type SignInOptions, type Session } from './auth.js';
export { TokenManager, type TokenPair, type TokenUser, type AuthStateChangeHandler, type TokenManagerOptions } from './token-manager.js';

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
  type RoomConnectDiagnostic,
  type RoomSummary,
} from './room.js';

// Analytics
export { ClientAnalytics } from './analytics.js';

// Errors (re-exported for convenience)
export { EdgeBaseError, ResumableUploadError } from '@edge-base/core';
export type { EdgeBaseTableMap, EdgeBaseTableRecord } from '@edge-base/core';
