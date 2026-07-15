/**
 * Token management with automatic refresh and cross-tab leader election.
 *
 * Body transport keeps the legacy contract (access token in memory, refresh
 * token in localStorage). HttpOnly-cookie transport keeps both credentials out
 * of persistent JavaScript storage and coordinates tabs with non-secret
 * session markers and nonce signals.
 */

import { EdgeBaseError } from '@edge-base/core';
import { createBrowserStorage } from './browser-storage.js';

/** Token pair returned from auth endpoints */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export type RefreshTokenTransport = 'body' | 'httpOnlyCookie';

/** User info extracted from JWT */
export interface TokenUser {
  id: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  role?: string;
  isAnonymous?: boolean;
  emailVisibility?: string;
  custom?: Record<string, unknown>;
  customClaims?: Record<string, unknown>;
}

/** Decode JWT payload without verification (base64url) */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new EdgeBaseError(0, 'Invalid JWT format');
  const payload = parts[1];
  // base64url → base64 → decode
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '=='.slice(0, (4 - (base64.length % 4)) % 4);

  // Decode via UTF-8 so non-ASCII claims (e.g. Korean display names) survive round-trips.
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Check if token is expired (with 30s buffer for pre-emptive refresh) */
function isTokenExpired(token: string, bufferSeconds = 30): boolean {
  try {
    const payload = decodeJwtPayload(token);
    const exp = payload.exp as number;
    if (!exp) return true;
    return Date.now() / 1000 >= exp - bufferSeconds;
  } catch {
    return true;
  }
}

/** Extract user info from JWT payload */
function extractUser(token: string): TokenUser | null {
  try {
    const payload = decodeJwtPayload(token);
    if (typeof payload.sub !== 'string' || !payload.sub) {
      return null;
    }
    const custom =
      payload.custom && typeof payload.custom === 'object'
        ? payload.custom as Record<string, unknown>
        : payload.customClaims && typeof payload.customClaims === 'object'
          ? payload.customClaims as Record<string, unknown>
          : undefined;
    return {
      id: payload.sub,
      email: payload.email as string | undefined,
      displayName: payload.displayName as string | undefined,
      avatarUrl: payload.avatarUrl as string | undefined,
      role: payload.role as string | undefined,
      isAnonymous: payload.isAnonymous as boolean | undefined,
      emailVisibility: payload.emailVisibility as string | undefined,
      custom,
      customClaims: custom,
    };
  } catch {
    return null;
  }
}

function extractSessionId(token: string): string | null {
  try {
    const payload = decodeJwtPayload(token);
    if (typeof payload.sid === 'string' && payload.sid) return payload.sid;
    return typeof payload.jti === 'string' && payload.jti ? payload.jti : null;
  } catch {
    return null;
  }
}

type StorageAdapter = ReturnType<typeof createBrowserStorage>;
const LOCK_TIMEOUT_MS = 10_000;
const REFRESH_IDLE_DEADLINE_MS = 20_000;
const LOCK_VERIFY_DELAY_MS = 16;
const OAUTH_RECOVERY_TTL_MS = 10 * 60_000;
const OAUTH_COMPLETION_TTL_MS = 5 * 60_000;
const OAUTH_RECOVERY_NONCE_BYTES = 32;
const OAUTH_RECOVERY_NONCE_HEX_LENGTH = OAUTH_RECOVERY_NONCE_BYTES * 2;
const OAUTH_RECOVERY_NONCE_PATTERN = /^[0-9a-f]{64}$/;
const OAUTH_PENDING_RECOVERY_LIMIT = 8;
/**
 * How long a fallback (no-BroadcastChannel) refresh-result stays valid for a
 * waiting tab to consume. Kept short: the result parks a bearer access token in
 * localStorage, so a stale entry a waiter blindly trusted would be a
 * token-at-rest hazard. Waiters reject entries older than this.
 */
const REFRESH_RESULT_TTL_MS = 5_000;

/**
 * Minimal cross-tab refresh signal for the no-BroadcastChannel fallback. Only
 * the (short-lived) access token is parked here; the rotating refresh token is
 * NOT — waiters re-read it from the canonical `refresh-token` store. Timestamped
 * so waiters can reject stale entries.
 */
interface StoredRefreshResult {
  accessToken: string;
  timestamp: number;
}

interface CookieRefreshSignal {
  nonce: string;
  timestamp: number;
}

interface CookieSessionMarker {
  version: 1;
  userId: string;
}

interface PendingOAuthRecoveryEntry {
  createdAt: number;
  nonce: string;
  version: 1;
  authEpoch: number;
}

export interface PendingOAuthCompletion {
  ticket: string;
  recoveryNonce: string | null;
  kind: 'signin' | 'link';
  authTransport: 'body' | 'cookie';
  createdAt: number;
  authEpoch: number;
}

interface InterimCookieOAuthRecoveryMarker {
  version: 2;
  kind: 'cookie-recovery';
  createdAt: number;
}

interface LegacyCookieOAuthRecoveryMarker {
  version: 1;
  createdAt: number;
}

type CookieOAuthRecoveryMarker =
  | InterimCookieOAuthRecoveryMarker
  | LegacyCookieOAuthRecoveryMarker;

function isExplicitlyOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function userFromCookieSessionMarker(marker: CookieSessionMarker): TokenUser | null {
  return isExplicitlyOffline() ? { id: marker.userId } : null;
}

function parseCookieRefreshSignal(value: string | null): CookieRefreshSignal | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { nonce?: unknown; timestamp?: unknown };
    if (typeof parsed.nonce !== 'string' || typeof parsed.timestamp !== 'number') return null;
    if (Date.now() - parsed.timestamp > REFRESH_RESULT_TTL_MS) return null;
    return { nonce: parsed.nonce, timestamp: parsed.timestamp };
  } catch {
    return null;
  }
}

function parseCookieSessionMarker(value: string | null): CookieSessionMarker | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { version?: unknown; userId?: unknown };
    if (parsed.version !== 1 || typeof parsed.userId !== 'string' || !parsed.userId) return null;
    // Ignore every other property. The marker is only a session-presence hint;
    // no PII, claims, or bearer credential is restored from localStorage.
    return { version: 1, userId: parsed.userId };
  } catch {
    return null;
  }
}

function isFreshOAuthRecoveryTimestamp(createdAt: unknown): createdAt is number {
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return false;
  const age = Date.now() - createdAt;
  return age >= -60_000 && age <= OAUTH_RECOVERY_TTL_MS;
}

function parseCookieOAuthRecoveryMarker(value: string | null): CookieOAuthRecoveryMarker | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as {
      version?: unknown;
      kind?: unknown;
      createdAt?: unknown;
    };
    if (!isFreshOAuthRecoveryTimestamp(parsed.createdAt)) return null;
    if (parsed.version === 1) {
      // Version 1 was written only after a verified cookie callback by the
      // previously released SDK. It is safe solely for parameterless cookie
      // refresh recovery; it must never authorize a bearer callback.
      return { version: 1, createdAt: parsed.createdAt };
    }
    if (parsed.version !== 2) return null;
    if (parsed.kind === 'cookie-recovery') {
      return { version: 2, kind: 'cookie-recovery', createdAt: parsed.createdAt };
    }
    return null;
  } catch {
    return null;
  }
}

function parsePendingOAuthRecoveryEntry(
  nonce: string,
  value: string | null,
): PendingOAuthRecoveryEntry | null {
  if (!value || !OAUTH_RECOVERY_NONCE_PATTERN.test(nonce)) return null;
  try {
    const parsed = JSON.parse(value) as {
      version?: unknown;
      createdAt?: unknown;
      authEpoch?: unknown;
    };
    if (
      parsed.version !== 1
      || !isFreshOAuthRecoveryTimestamp(parsed.createdAt)
      || typeof parsed.authEpoch !== 'number'
      || !Number.isSafeInteger(parsed.authEpoch)
      || parsed.authEpoch < 0
    ) return null;
    return {
      version: 1,
      createdAt: parsed.createdAt,
      nonce,
      authEpoch: parsed.authEpoch,
    };
  } catch {
    return null;
  }
}

function parsePendingOAuthCompletion(
  ticket: string,
  value: string | null,
): PendingOAuthCompletion | null {
  if (!value || !OAUTH_RECOVERY_NONCE_PATTERN.test(ticket)) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingOAuthCompletion> & { version?: unknown };
    const age = Date.now() - Number(parsed.createdAt);
    if (
      parsed.version !== 1
      || parsed.ticket !== ticket
      || (parsed.recoveryNonce !== null
        && (typeof parsed.recoveryNonce !== 'string'
          || !OAUTH_RECOVERY_NONCE_PATTERN.test(parsed.recoveryNonce)))
      || (parsed.kind !== 'signin' && parsed.kind !== 'link')
      || (parsed.authTransport !== 'body' && parsed.authTransport !== 'cookie')
      || typeof parsed.createdAt !== 'number'
      || !Number.isFinite(parsed.createdAt)
      || age < -60_000
      || age > OAUTH_COMPLETION_TTL_MS
      || typeof parsed.authEpoch !== 'number'
      || !Number.isSafeInteger(parsed.authEpoch)
      || parsed.authEpoch < 0
    ) return null;
    return {
      ticket,
      recoveryNonce: parsed.recoveryNonce,
      kind: parsed.kind,
      authTransport: parsed.authTransport,
      createdAt: parsed.createdAt,
      authEpoch: parsed.authEpoch,
    };
  } catch {
    return null;
  }
}

function createOAuthRecoveryNonce(): string {
  const secureCrypto = globalThis.crypto;
  if (!secureCrypto || typeof secureCrypto.getRandomValues !== 'function') {
    throw new EdgeBaseError(0, 'Secure random generation is required to start OAuth.');
  }
  const bytes = new Uint8Array(OAUTH_RECOVERY_NONCE_BYTES);
  secureCrypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Compare fixed-format OAuth nonces without data-dependent early exits. */
function oauthRecoveryNoncesMatch(expected: string, candidate: string | null): boolean {
  const actual = candidate ?? '';
  let mismatch = expected.length ^ actual.length;
  for (let index = 0; index < OAUTH_RECOVERY_NONCE_HEX_LENGTH; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ (actual.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function parseRefreshResult(value: string | null): StoredRefreshResult | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { accessToken?: unknown; timestamp?: unknown };
    if (typeof parsed.accessToken !== 'string' || typeof parsed.timestamp !== 'number') return null;
    if (Date.now() - parsed.timestamp > REFRESH_RESULT_TTL_MS) return null; // stale — reject
    return { accessToken: parsed.accessToken, timestamp: parsed.timestamp };
  } catch {
    return null;
  }
}

interface RefreshLock {
  ownerId: string;
  timestamp: number;
}

interface TokenManagerKeySet {
  refreshTokenKey: string;
  refreshLockKey: string;
  refreshResultKey: string;
  authMutationLockKey: string;
  cookieSessionKey: string;
  cookieOAuthRecoveryKey: string;
  oauthPendingRecoveryPrefix: string;
  oauthConsumeLockPrefix: string;
  oauthPendingCompletionPrefix: string;
  /** Rolling-upgrade cleanup only; new flows never write this shared key. */
  oauthPendingRecoveriesKey: string;
  pendingSignOutKey: string;
  authEpochKey: string;
  broadcastChannelName: string;
}

export interface TokenManagerOptions {
  authNamespace?: string;
  refreshTokenTransport?: RefreshTokenTransport;
}

function createRefreshOwnerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function parseRefreshLock(value: string | null): RefreshLock | null {
  if (!value) return null;

  const legacyTimestamp = Number.parseInt(value, 10);
  if (Number.isFinite(legacyTimestamp)) {
    return { ownerId: 'legacy', timestamp: legacyTimestamp };
  }

  try {
    const parsed = JSON.parse(value) as { ownerId?: unknown; owner?: unknown; timestamp?: unknown; time?: unknown };
    const ownerId =
      typeof parsed.ownerId === 'string'
        ? parsed.ownerId
        : typeof parsed.owner === 'string'
          ? parsed.owner
          : '';
    const timestamp =
      typeof parsed.timestamp === 'number'
        ? parsed.timestamp
        : typeof parsed.time === 'number'
          ? parsed.time
          : NaN;
    if (!ownerId || !Number.isFinite(timestamp)) return null;
    return { ownerId, timestamp };
  } catch {
    return null;
  }
}

function serializeRefreshLock(ownerId: string): string {
  return JSON.stringify({ ownerId, timestamp: Date.now() });
}

function isFreshRefreshLock(lock: RefreshLock): boolean {
  return Date.now() - lock.timestamp < LOCK_TIMEOUT_MS;
}

function isTerminalOAuthConsumeClaim(lock: RefreshLock | null): boolean {
  return lock?.ownerId === 'consumed' && isFreshOAuthRecoveryTimestamp(lock.timestamp);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTokenManagerKeys(baseUrl: string, authNamespace?: string): TokenManagerKeySet {
  const trimmedNamespace = authNamespace?.trim();
  let canonicalBaseUrl = baseUrl.replace(/\/$/, '');
  try {
    canonicalBaseUrl = new URL(baseUrl).toString().replace(/\/$/, '');
  } catch {
    // HttpClient will surface an invalid base URL; keep key construction
    // deterministic without falling back to the unsafe global legacy prefix.
  }
  const prefix = trimmedNamespace
    ? `edgebase:${trimmedNamespace}`
    : `edgebase:${encodeURIComponent(canonicalBaseUrl)}`;
  return {
    refreshTokenKey: `${prefix}:refresh-token`,
    refreshLockKey: `${prefix}:refresh-lock`,
    refreshResultKey: `${prefix}:refresh-result`,
    authMutationLockKey: `${prefix}:auth-mutation-lock`,
    cookieSessionKey: `${prefix}:cookie-session`,
    cookieOAuthRecoveryKey: `${prefix}:cookie-oauth-recovery`,
    oauthPendingRecoveryPrefix: `${prefix}:oauth-pending:`,
    oauthConsumeLockPrefix: `${prefix}:oauth-consume-lock:`,
    oauthPendingCompletionPrefix: `${prefix}:oauth-pending-completion:`,
    oauthPendingRecoveriesKey: `${prefix}:oauth-pending-recoveries`,
    pendingSignOutKey: `${prefix}:pending-signout`,
    authEpochKey: `${prefix}:auth-epoch`,
    broadcastChannelName: `${prefix}:auth`,
  };
}

export type AuthStateChangeHandler = (user: TokenUser | null) => void;

export class TokenManager {
  private accessToken: string | null = null;
  private storage: StorageAdapter;
  private refreshCoordinationPromise: Promise<string> | null = null;
  private refreshPromise: Promise<TokenPair> | null = null;
  private authStateListeners: AuthStateChangeHandler[] = [];
  private broadcastChannel: BroadcastChannel | null = null;
  private storageListener: ((e: StorageEvent) => void) | null = null;
  private cachedUser: TokenUser | null = null;
  private keys: TokenManagerKeySet;
  private readonly transport: RefreshTokenTransport;
  private pendingSignOutRetry: Promise<void> | null = null;
  private readonly refreshOwnerId = createRefreshOwnerId();
  private refreshLockHeartbeat: ReturnType<typeof setInterval> | null = null;
  private authEpoch = 0;
  private expectedCookieUserId: string | null = null;
  private cookieRevalidationHandler: (() => Promise<TokenPair>) | null = null;
  private cookiePrincipalRevalidation: Promise<void> | null = null;
  private lastOAuthRecoveryCreatedAt = 0;
  private readonly pendingOAuthCompletionMemory = new Map<string, PendingOAuthCompletion>();
  /**
   * Same-process replay fence for the rare case where browser storage fails
   * while a callback is being consumed. Durable storage remains the cross-tab
   * authority; this map prevents a recovered storage adapter from replaying
   * the same nonce in this TokenManager instance when both terminal-write and
   * pending-record deletion failed.
   */
  private readonly consumedOAuthRecoveryNonces = new Map<string, number>();

  private async withAuthMutationLock<T>(
    operation: () => Promise<T>,
    allowPendingSignOut: boolean,
  ): Promise<T> {
    const guarded = async (): Promise<T> => {
      if (!allowPendingSignOut && this.hasPendingSignOut()) {
        throw new EdgeBaseError(
          409,
          'A sign-out is pending server revocation.',
          undefined,
          'signout-pending',
        );
      }
      return operation();
    };
    const locks = typeof navigator !== 'undefined'
      ? (navigator as Navigator & {
        locks?: {
          request<T>(
            name: string,
            options: { mode: 'exclusive' },
            callback: () => T | Promise<T>,
          ): Promise<T>;
        };
      }).locks
      : undefined;
    if (locks && typeof locks.request === 'function') {
      return locks.request(this.keys.authMutationLockKey, { mode: 'exclusive' }, guarded);
    }

    const ownerId = createRefreshOwnerId();
    const deadline = Date.now() + REFRESH_IDLE_DEADLINE_MS;
    while (Date.now() < deadline) {
      const active = parseRefreshLock(this.storage.getItem(this.keys.authMutationLockKey));
      if (active && isFreshRefreshLock(active)) {
        await delay(25);
        continue;
      }
      if (active) this.storage.removeItem(this.keys.authMutationLockKey);
      this.storage.setItem(this.keys.authMutationLockKey, serializeRefreshLock(ownerId));
      await delay(LOCK_VERIFY_DELAY_MS);
      const acquired = parseRefreshLock(this.storage.getItem(this.keys.authMutationLockKey));
      if (acquired?.ownerId !== ownerId) continue;

      const heartbeat = setInterval(() => {
        const current = parseRefreshLock(this.storage.getItem(this.keys.authMutationLockKey));
        if (current?.ownerId === ownerId) {
          this.storage.setItem(this.keys.authMutationLockKey, serializeRefreshLock(ownerId));
        }
      }, Math.max(250, Math.floor(LOCK_TIMEOUT_MS / 3)));
      try {
        return await guarded();
      } finally {
        clearInterval(heartbeat);
        const current = parseRefreshLock(this.storage.getItem(this.keys.authMutationLockKey));
        if (current?.ownerId === ownerId) this.storage.removeItem(this.keys.authMutationLockKey);
      }
    }
    throw new EdgeBaseError(0, 'Timed out waiting for another authentication mutation.');
  }

  /** Serialize every token/cookie-creating auth response across tabs. */
  async runAuthMutation<T>(
    operation: () => Promise<T>,
    commit?: (result: T) => void,
    expectedEpoch?: number,
  ): Promise<T> {
    return this.withAuthMutationLock(async () => {
      const epoch = expectedEpoch ?? this.captureAuthEpoch();
      if (!this.isAuthEpochCurrent(epoch)) {
        throw new EdgeBaseError(
          401,
          'Authentication operation was superseded by a newer auth state.',
          undefined,
          'auth-state-changed',
        );
      }
      const result = await operation();
      if (!this.isAuthEpochCurrent(epoch)) {
        throw new EdgeBaseError(
          401,
          'Authentication response was superseded by a newer auth state.',
          undefined,
          'auth-state-changed',
        );
      }
      commit?.(result);
      return result;
    }, false);
  }

  /** Queue final cookie revocation after every earlier auth mutation settles. */
  runFinalSignOutMutation<T>(operation: () => Promise<T>): Promise<T> {
    return this.withAuthMutationLock(operation, true);
  }

  constructor(private baseUrl: string, options: TokenManagerOptions = {}) {
    this.storage = createBrowserStorage();
    this.keys = buildTokenManagerKeys(baseUrl, options.authNamespace);
    this.transport = options.refreshTokenTransport ?? 'body';
    this.authEpoch = this.readPersistedAuthEpoch();
    this.setupCrossTabListeners();

    if (this.usesHttpOnlyCookie) {
      // A previous offline sign-out is authoritative local state. Remove any
      // legacy credential left by an older SDK and never restore its user into
      // the UI while the non-secret tombstone is pending.
      if (this.hasPendingSignOut()) {
        this.storage.removeItem(this.keys.refreshTokenKey);
        return;
      }
      const marker = parseCookieSessionMarker(this.storage.getItem(this.keys.cookieSessionKey));
      if (marker) {
        this.cachedUser = userFromCookieSessionMarker(marker);
        return;
      }
    }

    // Restore user from an existing body refresh token. In cookie mode this is
    // also the one-time migration credential and is retained until a cookie
    // exchange succeeds or the server definitively rejects it.
    const existingRefresh = this.storage.getItem(this.keys.refreshTokenKey);
    if (existingRefresh && !isTokenExpired(existingRefresh, 0)) {
      this.cachedUser = extractUser(existingRefresh);
    }
  }

  /** Read-only access to current access token (for database-live re-auth) */
  get currentAccessToken(): string | null {
    return this.accessToken;
  }

  /** Whether this document already holds a non-expired in-memory access token. */
  get hasValidAccessToken(): boolean {
    return Boolean(this.accessToken && !isTokenExpired(this.accessToken));
  }

  get refreshTokenTransport(): RefreshTokenTransport {
    return this.transport;
  }

  get usesHttpOnlyCookie(): boolean {
    return this.transport === 'httpOnlyCookie';
  }

  /** Set up cross-tab listener for token changes */
  private setupCrossTabListeners(): void {
    if (typeof window === 'undefined') return;

    // Prefer BroadcastChannel
    if (typeof BroadcastChannel !== 'undefined') {
      this.broadcastChannel = new BroadcastChannel(this.keys.broadcastChannelName);
      this.broadcastChannel.onmessage = (event: MessageEvent) => {
        const { type, accessToken, refreshToken } = event.data;
        if (type === 'session-refreshed' && this.usesHttpOnlyCookie) {
          if (this.hasPendingSignOut()) return;
          // A peer rotated the shared HttpOnly cookie. Never receive its access
          // token; invalidate ours so the next authenticated operation obtains
          // a fresh token through the normal leader-elected path.
          this.handleCookieSessionMarkerChange(
            this.storage.getItem(this.keys.cookieSessionKey),
          );
        } else if (type === 'token-refreshed' && accessToken && refreshToken && !this.usesHttpOnlyCookie) {
          this.accessToken = accessToken;
          this.storage.setItem(this.keys.refreshTokenKey, refreshToken);
          this.updateUser(accessToken);
        } else if (type === 'signed-out') {
          this.authEpoch = Math.max(this.authEpoch, this.readPersistedAuthEpoch());
          const preserveRefreshLock = this.usesHttpOnlyCookie && this.hasPendingSignOut();
          this.clearTokensInternal(
            false,
            preserveRefreshLock,
          );
        }
      };
    }

    // Also listen to storage events (fallback + additional tab sync for signout)
    if (typeof window !== 'undefined') {
      this.storageListener = (e: StorageEvent) => {
        if (e.key === this.keys.authEpochKey) {
          this.authEpoch = Math.max(this.authEpoch, this.readPersistedAuthEpoch());
        }
        if (this.usesHttpOnlyCookie && e.key === this.keys.cookieSessionKey) {
          this.handleCookieSessionMarkerChange(e.newValue);
        }
        if (e.key === this.keys.refreshTokenKey) {
          if (e.newValue === null && !this.usesHttpOnlyCookie) {
            // Signed out in another tab
            this.accessToken = null;
            this.cachedUser = null;
            this.emitAuthStateChange(null);
          } else {
            // Token updated in another tab via fallback
            // Access token will be refreshed on next request
          }
        }
        // BroadcastChannel fallback: result delivered via storage event.
        if (e.key === this.keys.refreshResultKey && e.newValue && !this.usesHttpOnlyCookie) {
          this.consumeFallbackRefreshResult(e.newValue);
        }
      };
      window.addEventListener('storage', this.storageListener);
    }
  }

  private handleCookieSessionMarkerChange(rawMarker: string | null): void {
    if (!this.usesHttpOnlyCookie) return;
    if (this.hasPendingSignOut()) {
      this.accessToken = null;
      this.cachedUser = null;
      this.emitAuthStateChange(null);
      return;
    }

    const marker = parseCookieSessionMarker(rawMarker);
    if (!marker) {
      this.expectedCookieUserId = null;
      this.accessToken = null;
      this.cachedUser = null;
      this.emitAuthStateChange(null);
      return;
    }

    if (this.cachedUser && marker.userId === this.cachedUser.id) {
      // A peer refreshing the same principal only rotates the shared HttpOnly
      // cookie. This tab's access token remains valid, and re-emitting the same
      // positive auth state can make application-level session validation ping
      // pong refreshes between tabs indefinitely.
      return;
    }

    if (this.cachedUser && marker.userId !== this.cachedUser.id) {
      // A shared refresh cookie can change principals when another tab signs in
      // as a different account. Never keep emitting the old verified identity:
      // invalidate its epoch and close every realtime consumer immediately.
      this.expectedCookieUserId = marker.userId;
      this.advanceAuthEpoch();
      this.accessToken = null;
      this.cachedUser = null;
      this.emitAuthStateChange(null);
      this.scheduleCookiePrincipalRevalidation();
      return;
    }

    this.accessToken = null;
    const offlineUser = userFromCookieSessionMarker(marker);
    if (!this.cachedUser && !offlineUser) {
      // A signed-out online tab must not trust the marker as identity, but it
      // should follow an explicit peer login by validating the shared cookie.
      this.expectedCookieUserId = marker.userId;
      this.emitAuthStateChange(null);
      this.scheduleCookiePrincipalRevalidation();
      return;
    }
    // Online marker data is not an identity source. Keep an already verified
    // same-principal user until this tab performs its own cookie refresh; only
    // an explicitly offline tab may hydrate the id-only hint.
    if (offlineUser) this.cachedUser = offlineUser;
    this.emitAuthStateChange(this.cachedUser);
  }

  /** Register the public refresh operation used after a cross-tab account switch. */
  setCookieRevalidationHandler(handler: (() => Promise<TokenPair>) | null): void {
    this.cookieRevalidationHandler = handler;
  }

  private scheduleCookiePrincipalRevalidation(): void {
    if (
      !this.usesHttpOnlyCookie
      || !this.cookieRevalidationHandler
      || this.cookiePrincipalRevalidation
      || this.hasPendingSignOut()
    ) {
      return;
    }
    this.cookiePrincipalRevalidation = Promise.resolve()
      .then(() => this.forceRefresh(this.cookieRevalidationHandler!))
      .then(() => undefined)
      .catch(() => {
        // Definitive failures clear auth state in the normal refresh path.
        // Transient failures retain only the non-secret marker for a later
        // explicit refresh; never restore the old principal here.
      })
      .finally(() => {
        this.cookiePrincipalRevalidation = null;
      });
  }

  /** Get valid access token, refreshing if needed */
  async getAccessToken(
    doRefresh: (refreshToken: string) => Promise<TokenPair>,
  ): Promise<string | null> {
    if (this.pendingSignOutRetry) {
      await this.waitForPendingSignOutRetry();
    }
    if (this.hasPendingSignOut()) return null;

    // If we have a valid access token, return it
    if (this.accessToken && !isTokenExpired(this.accessToken)) {
      return this.accessToken;
    }

    // Try to refresh
    const refreshToken = this.storage.getItem(this.keys.refreshTokenKey);
    if (!refreshToken && !this.hasRefreshSession()) return null;

    return this.refreshWithLeaderElection(
      refreshToken ?? '',
      doRefresh,
      this.currentAuthEpoch(),
    );
  }

  /**
   * Force a refresh right now, routed through the SAME leader-elected/deduped
   * path as {@link getAccessToken}. Used by explicit `refreshSession()` calls so
   * they cannot double-spend the rotating refresh token concurrently with a
   * background refresh (they join the in-flight refresh instead). Returns the
   * resulting token pair.
   */
  async forceRefresh(doRefresh: (refreshToken: string) => Promise<TokenPair>): Promise<TokenPair> {
    if (this.pendingSignOutRetry) {
      await this.waitForPendingSignOutRetry();
    }
    if (this.hasPendingSignOut()) {
      throw new EdgeBaseError(401, 'Sign-out is pending; session refresh is blocked.');
    }
    const refreshToken = this.storage.getItem(this.keys.refreshTokenKey);
    if (!refreshToken && !this.usesHttpOnlyCookie) {
      throw new EdgeBaseError(401, 'No refresh token available.');
    }
    const expectedEpoch = this.currentAuthEpoch();
    const accessToken = await this.refreshWithLeaderElection(
      refreshToken ?? '',
      doRefresh,
      expectedEpoch,
    );
    this.assertAuthEpoch(expectedEpoch);
    const currentRefreshToken = this.usesHttpOnlyCookie
      ? ''
      : this.storage.getItem(this.keys.refreshTokenKey) ?? refreshToken ?? '';
    return { accessToken, refreshToken: currentRefreshToken };
  }

  /**
   * Leader election for tab-safe refresh
   * Only one tab should refresh at a time; others wait for the result.
   */
  private async refreshWithLeaderElection(
    refreshToken: string,
    doRefresh: (refreshToken: string) => Promise<TokenPair>,
    expectedEpoch: number = this.currentAuthEpoch(),
    bypassSameTabCoordination = false,
  ): Promise<string> {
    this.assertAuthEpoch(expectedEpoch);
    if (this.hasPendingSignOut()) {
      throw new EdgeBaseError(401, 'Sign-out superseded this session refresh.', undefined, 'auth-state-changed');
    }
    // Reserve the whole election before its first async lock-verification
    // yield. `refreshPromise` below covers only the elected leader's network
    // operation; without this outer fence, simultaneous cold-start callers can
    // all pass its null check, acquire the same instance-owned lock, and queue
    // duplicate refreshes behind the auth mutation lock.
    if (!bypassSameTabCoordination) {
      if (this.refreshCoordinationPromise) {
        const accessToken = await this.refreshCoordinationPromise;
        this.assertAuthEpoch(expectedEpoch);
        return accessToken;
      }
      const coordinationPromise = this.refreshWithLeaderElection(
        refreshToken,
        doRefresh,
        expectedEpoch,
        true,
      );
      this.refreshCoordinationPromise = coordinationPromise;
      try {
        const accessToken = await coordinationPromise;
        this.assertAuthEpoch(expectedEpoch);
        return accessToken;
      } finally {
        if (this.refreshCoordinationPromise === coordinationPromise) {
          this.refreshCoordinationPromise = null;
        }
      }
    }
    // Deduplicate within same tab
    if (this.refreshPromise) {
      const result = await this.refreshPromise;
      this.assertAuthEpoch(expectedEpoch);
      return result.accessToken;
    }

    // Check if another tab is refreshing (localStorage mutex)
    const activeLock = parseRefreshLock(this.storage.getItem(this.keys.refreshLockKey));
    if (activeLock && isFreshRefreshLock(activeLock) && activeLock.ownerId !== this.refreshOwnerId) {
      if (this.usesHttpOnlyCookie) {
        await this.waitForCookieRefreshSignal(activeLock.timestamp);
        this.assertAuthEpoch(expectedEpoch);
        return this.refreshAfterCookieSignal(doRefresh, expectedEpoch);
      }
      return this.waitForRefreshResult();
    }

    // Acquire lock and verify ownership. Two tabs can otherwise both read an
    // empty lock and refresh with the same rotating refresh token.
    this.storage.setItem(this.keys.refreshLockKey, serializeRefreshLock(this.refreshOwnerId));
    await delay(LOCK_VERIFY_DELAY_MS);
    const acquiredLock = parseRefreshLock(this.storage.getItem(this.keys.refreshLockKey));
    if (!acquiredLock || acquiredLock.ownerId !== this.refreshOwnerId) {
      if (this.usesHttpOnlyCookie) {
        const winningLock = parseRefreshLock(this.storage.getItem(this.keys.refreshLockKey));
        // The winner may have already signalled and released its lock between
        // our verification read and this read. In that case proceed directly
        // to the follower's own refresh; waiting for a second signal would
        // deadlock until the timeout.
        if (winningLock && isFreshRefreshLock(winningLock)) {
          await this.waitForCookieRefreshSignal(winningLock.timestamp);
        }
        this.assertAuthEpoch(expectedEpoch);
        return this.refreshAfterCookieSignal(doRefresh, expectedEpoch);
      }
      return this.waitForRefreshResult();
    }

    const storedRefreshToken = this.storage.getItem(this.keys.refreshTokenKey);
    const tokenForRefresh = storedRefreshToken && storedRefreshToken !== refreshToken
      ? storedRefreshToken
      : refreshToken;

    this.startRefreshLockHeartbeat();

    // Invoke doRefresh inside a promise chain so that even a MISSING doRefresh
    // or a SYNCHRONOUS throw surfaces as a rejection routed through .catch and
    // .finally — otherwise the lock acquired above would leak until its TTL and
    // the failure would look like a raw TypeError rather than an auth error.
    this.refreshPromise = Promise.resolve()
      .then(() => {
        this.assertAuthEpoch(expectedEpoch);
        if (this.hasPendingSignOut()) {
          throw new EdgeBaseError(401, 'Sign-out superseded this session refresh.', undefined, 'auth-state-changed');
        }
        if (typeof doRefresh !== 'function') {
          throw new EdgeBaseError(0, 'No token refresh function was provided.');
        }
        return this.withAuthMutationLock(
          () => {
            // The refresh may have queued behind a newer explicit sign-in.
            // Re-check *inside* the mutation lock before reading or rotating
            // that new session's refresh token on the server.
            this.assertAuthEpoch(expectedEpoch);
            if (this.hasPendingSignOut()) {
              throw new EdgeBaseError(
                401,
                'Sign-out superseded this session refresh.',
                undefined,
                'auth-state-changed',
              );
            }
            const latestRefreshToken = this.storage.getItem(this.keys.refreshTokenKey);
            return doRefresh(latestRefreshToken ?? tokenForRefresh);
          },
          false,
        );
      })
      .then((tokens) => {
        this.assertAuthEpoch(expectedEpoch);
        if (this.hasPendingSignOut()) {
          throw new EdgeBaseError(401, 'Sign-out superseded this session refresh.', undefined, 'auth-state-changed');
        }
        if (this.usesHttpOnlyCookie && this.expectedCookieUserId) {
          const refreshedUser = extractUser(tokens.accessToken);
          if (!refreshedUser || refreshedUser.id !== this.expectedCookieUserId) {
            throw new EdgeBaseError(401, 'Cookie session principal changed in another tab.', undefined, 'auth-state-changed');
          }
        }
        this.setTokens(tokens);
        this.broadcastTokenRefreshed(tokens);
        return tokens;
      })
      .catch((err) => {
        if (
          this.usesHttpOnlyCookie
          && err instanceof EdgeBaseError
          && (err.code === 0 || (err.code >= 500 && err.code < 600))
        ) {
          this.promoteCookieSessionMarkerUser();
        }
        // If refresh fails with 401, clear everything (token revoked/expired)
        if (
          err instanceof EdgeBaseError
          && err.slug !== 'auth-state-changed'
          && (err.code === 401 || (this.usesHttpOnlyCookie && err.code === 403))
        ) {
          if (this.usesHttpOnlyCookie) {
            // A definitive rejection means the legacy migration credential is
            // unusable. Network and 5xx failures intentionally keep it so a
            // later online retry can still exchange it for the HttpOnly cookie.
            this.clearTokens();
          } else {
            const currentRefreshToken = this.storage.getItem(this.keys.refreshTokenKey);
            if (currentRefreshToken && currentRefreshToken !== tokenForRefresh) {
              this.accessToken = null;
            } else {
              this.clearTokens();
            }
          }
        }
        throw err;
      })
      .finally(() => {
        this.stopRefreshLockHeartbeat();
        this.releaseRefreshLock();
        this.refreshPromise = null;
      });

    const result = await this.refreshPromise;
    return result.accessToken;
  }

  private releaseRefreshLock(): void {
    const activeLock = parseRefreshLock(this.storage.getItem(this.keys.refreshLockKey));
    if (!activeLock || activeLock.ownerId === this.refreshOwnerId || !isFreshRefreshLock(activeLock)) {
      this.storage.removeItem(this.keys.refreshLockKey);
    }
  }

  private startRefreshLockHeartbeat(): void {
    this.stopRefreshLockHeartbeat();
    this.refreshLockHeartbeat = setInterval(() => {
      const activeLock = parseRefreshLock(this.storage.getItem(this.keys.refreshLockKey));
      if (!activeLock || activeLock.ownerId !== this.refreshOwnerId) {
        this.stopRefreshLockHeartbeat();
        return;
      }
      this.storage.setItem(
        this.keys.refreshLockKey,
        serializeRefreshLock(this.refreshOwnerId),
      );
    }, Math.floor(LOCK_TIMEOUT_MS / 3));
  }

  private stopRefreshLockHeartbeat(): void {
    if (this.refreshLockHeartbeat) {
      clearInterval(this.refreshLockHeartbeat);
      this.refreshLockHeartbeat = null;
    }
  }

  /**
   * Wait for the winning tab to finish rotating the shared cookie. The signal
   * contains only a nonce and timestamp. Once observed, this tab performs its
   * own cookie refresh to obtain an access token rather than accepting a bearer
   * token over BroadcastChannel or localStorage.
   */
  private waitForCookieRefreshSignal(leaderStartedAt: number): Promise<void> {
    if (!this.hasRefreshSession()) {
      return Promise.reject(new EdgeBaseError(401, 'Not authenticated'));
    }

    const initialSignal = parseCookieRefreshSignal(
      this.storage.getItem(this.keys.refreshResultKey),
    );
    if (initialSignal && initialSignal.timestamp >= leaderStartedAt) {
      return Promise.resolve();
    }
    const initialNonce = initialSignal?.nonce;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let cleanup = () => {};
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        resolve();
      };
      const rejectSignedOut = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        reject(new EdgeBaseError(401, 'Not authenticated'));
      };
      const timeout = setTimeout(() => {
        if (settled) return;
        const activeLock = parseRefreshLock(this.storage.getItem(this.keys.refreshLockKey));
        if (!activeLock || !isFreshRefreshLock(activeLock)) {
          this.storage.removeItem(this.keys.refreshLockKey);
          // The cookie and non-secret session marker are still authoritative
          // enough to attempt server revalidation. If the leader tab died,
          // continue into refreshAfterCookieSignal so this same request can
          // take over the stale lock instead of surfacing a signed-out UI
          // until the user reloads again.
          finish();
          return;
        }
        settled = true;
        cleanup();
        reject(new EdgeBaseError(0, 'Token refresh timeout'));
      }, LOCK_TIMEOUT_MS);

      if (this.broadcastChannel) {
        const handler = (event: MessageEvent) => {
          if (event.data?.type === 'session-refreshed') {
            finish();
          } else if (event.data?.type === 'signed-out') {
            rejectSignedOut();
          }
        };
        this.broadcastChannel.addEventListener('message', handler);
        cleanup = () => this.broadcastChannel?.removeEventListener('message', handler);
        return;
      }

      const interval = setInterval(() => {
        if (!this.hasRefreshSession()) {
          rejectSignedOut();
          return;
        }
        const signal = parseCookieRefreshSignal(
          this.storage.getItem(this.keys.refreshResultKey),
        );
        if (signal && signal.nonce !== initialNonce) {
          finish();
        }
      }, 50);
      cleanup = () => clearInterval(interval);
    });
  }

  private async refreshAfterCookieSignal(
    doRefresh: (refreshToken: string) => Promise<TokenPair>,
    expectedEpoch: number,
  ): Promise<string> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < LOCK_TIMEOUT_MS) {
      const activeLock = parseRefreshLock(this.storage.getItem(this.keys.refreshLockKey));
      if (!activeLock || !isFreshRefreshLock(activeLock)) break;
      await delay(LOCK_VERIFY_DELAY_MS);
    }
    this.assertAuthEpoch(expectedEpoch);
    const migrationToken = this.storage.getItem(this.keys.refreshTokenKey) ?? '';
    // This continuation belongs to the already-reserved same-tab coordination
    // promise. Re-enter only the election worker or it would await itself.
    return this.refreshWithLeaderElection(migrationToken, doRefresh, expectedEpoch, true);
  }

  /**
   * Wait (up to {@link LOCK_TIMEOUT_MS}) for another tab to publish a refresh
   * result. On timeout this does NOT refresh here — it clears the (presumed
   * stale) leader lock and rejects so the CALLER can retry and become leader.
   */
  private waitForRefreshResult(): Promise<string> {
    if (!this.storage.getItem(this.keys.refreshTokenKey)) {
      return Promise.reject(new EdgeBaseError(401, 'Not authenticated'));
    }

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        // The leader never published a result (likely died). Clear the stale
        // lock so a follow-up attempt can acquire it and refresh; reject here.
        this.storage.removeItem(this.keys.refreshLockKey);
        const rt = this.storage.getItem(this.keys.refreshTokenKey);
        if (rt) {
          reject(new EdgeBaseError(0, 'Token refresh timeout'));
        } else {
          reject(new EdgeBaseError(401, 'Not authenticated'));
        }
      }, LOCK_TIMEOUT_MS);

      let cleanup: () => void;
      const rejectSignedOut = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        reject(new EdgeBaseError(401, 'Not authenticated'));
      };

      if (this.broadcastChannel) {
        const handler = (event: MessageEvent) => {
          if (event.data?.type === 'token-refreshed') {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            cleanup();
            this.accessToken = event.data.accessToken;
            this.storage.setItem(this.keys.refreshTokenKey, event.data.refreshToken);
            this.updateUser(event.data.accessToken);
            resolve(event.data.accessToken);
            return;
          }
          if (event.data?.type === 'signed-out') {
            rejectSignedOut();
          }
        };
        this.broadcastChannel.addEventListener('message', handler);
        cleanup = () => this.broadcastChannel?.removeEventListener('message', handler);
      } else {
        // Fallback: poll storage for a fresh, valid result.
        const interval = setInterval(() => {
          if (!this.storage.getItem(this.keys.refreshTokenKey)) {
            rejectSignedOut();
            return;
          }
          const accessToken = this.consumeFallbackRefreshResult(
            this.storage.getItem(this.keys.refreshResultKey),
          );
          if (accessToken) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            clearInterval(interval);
            resolve(accessToken);
          }
        }, 100);
        cleanup = () => clearInterval(interval);
      }
    });
  }

  /** Broadcast refresh result to other tabs */
  private broadcastTokenRefreshed(tokens: TokenPair): void {
    if (this.usesHttpOnlyCookie) {
      const signal: CookieRefreshSignal = {
        nonce: createRefreshOwnerId(),
        timestamp: Date.now(),
      };
      // Persist only the nonce briefly so a follower cannot miss a
      // BroadcastChannel message in the small window between lock inspection
      // and listener registration.
      this.storage.setItem(this.keys.refreshResultKey, JSON.stringify(signal));
      if (this.broadcastChannel) {
        this.broadcastChannel.postMessage({
          type: 'session-refreshed',
          ...signal,
        });
      }
      if (typeof window !== 'undefined') {
        // No bearer token is parked in localStorage. Followers observe only the
        // nonce and then perform their own cookie-authenticated refresh.
        setTimeout(() => {
          const current = parseCookieRefreshSignal(
            this.storage.getItem(this.keys.refreshResultKey),
          );
          if (current?.nonce === signal.nonce) {
            this.storage.removeItem(this.keys.refreshResultKey);
          }
        }, REFRESH_RESULT_TTL_MS);
      }
      return;
    }

    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({
        type: 'token-refreshed',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
    } else if (typeof window !== 'undefined') {
      // Fallback: signal via a storage event. Park ONLY the short-lived access
      // token plus a timestamp — the refresh token is already in the canonical
      // store, so waiters re-read it there rather than us duplicating it. The
      // timer is a backstop; waiters clear the entry the moment they consume it.
      const result: StoredRefreshResult = { accessToken: tokens.accessToken, timestamp: Date.now() };
      this.storage.setItem(this.keys.refreshResultKey, JSON.stringify(result));
      setTimeout(() => this.storage.removeItem(this.keys.refreshResultKey), REFRESH_RESULT_TTL_MS);
    }
  }

  /**
   * Consume a fallback (no-BroadcastChannel) refresh-result. Rejects stale or
   * malformed entries, re-reads the rotating refresh token from the canonical
   * store, applies the access token, and CLEARS the entry immediately to
   * minimise token-at-rest. Returns the applied access token, or null.
   */
  private consumeFallbackRefreshResult(raw: string | null): string | null {
    const parsed = parseRefreshResult(raw);
    if (!parsed) return null;
    // The refresh token lives in the canonical store (the leader wrote it via
    // setTokens before signalling). A signed-out tab has none — treat as miss.
    if (!this.storage.getItem(this.keys.refreshTokenKey)) return null;
    // Clear ASAP so the bearer token does not linger in localStorage.
    this.storage.removeItem(this.keys.refreshResultKey);
    this.accessToken = parsed.accessToken;
    this.updateUser(parsed.accessToken);
    return parsed.accessToken;
  }

  /** Set tokens after successful auth */
  setTokens(tokens: TokenPair, userOverride?: TokenUser | null): void {
    const tokenUser = extractUser(tokens.accessToken);
    const nextUser = userOverride
      ? { ...(tokenUser ?? {}), ...userOverride }
      : tokenUser;
    // A server-validated cookie refresh completes post-callback recovery. Do
    // not clear a still-pending flow nonce here: an unrelated background token
    // refresh may occur while a popup or account-link redirect is in flight.
    this.clearCookieOAuthRecovery();
    if (this.usesHttpOnlyCookie) {
      // Successful cookie exchange completes legacy migration. Never persist
      // the empty compatibility sentinel or any server-returned credential.
      this.storage.removeItem(this.keys.refreshTokenKey);
      if (this.hasPendingSignOut()) {
        // This can only be an in-flight refresh that started before sign-out.
        // Let the caller release/signal its lock, but never resurrect local UI
        // state while the tombstone is authoritative.
        this.accessToken = null;
        this.cachedUser = null;
        this.storage.removeItem(this.keys.cookieSessionKey);
        return;
      }
      this.persistCookieSessionMarkerFor(nextUser);
      this.expectedCookieUserId = null;
    } else {
      // Persist the rotating credential before exposing its access token in
      // memory. A quota/security failure therefore leaves no partial session.
      try {
        this.storage.setItem(this.keys.refreshTokenKey, tokens.refreshToken);
      } catch {
        throw new EdgeBaseError(
          0,
          'The authenticated session could not be persisted in browser storage.',
          undefined,
          'auth-session-persist-failed',
        );
      }
    }
    this.accessToken = tokens.accessToken;
    this.cachedUser = nextUser;
    this.emitAuthStateChange(nextUser);
  }

  /** Replace only the access token while keeping the current refresh token. */
  setAccessToken(accessToken: string, userOverride?: TokenUser | null): void {
    const tokenUser = extractUser(accessToken);
    const nextUser = userOverride
      ? { ...(tokenUser ?? {}), ...userOverride }
      : tokenUser;
    this.persistCookieSessionMarkerFor(nextUser);
    this.accessToken = accessToken;
    this.cachedUser = nextUser;
    this.emitAuthStateChange(nextUser);
  }

  /** Get the stored refresh token (for signout) */
  getRefreshToken(): string | null {
    return this.storage.getItem(this.keys.refreshTokenKey);
  }

  /** Whether this manager can recover an access token without user input. */
  hasRefreshSession(): boolean {
    if (!this.usesHttpOnlyCookie) {
      return Boolean(this.storage.getItem(this.keys.refreshTokenKey));
    }
    return Boolean(
      this.storage.getItem(this.keys.cookieSessionKey)
      || this.storage.getItem(this.keys.refreshTokenKey)
      || this.hasCookieOAuthRecovery(),
    );
  }

  /** Capture the persisted auth epoch before an async operation begins. */
  captureAuthEpoch(): number {
    return this.currentAuthEpoch();
  }

  /** Whether an async auth operation still belongs to the current local session. */
  isAuthEpochCurrent(epoch: number): boolean {
    return !this.hasPendingSignOut() && this.currentAuthEpoch() === epoch;
  }

  /** Invalidate older refresh/OAuth work after a new identity is committed. */
  commitAuthoritativeAuthTransition(preserveOAuthCompletionTicket?: string): number {
    const preserved = preserveOAuthCompletionTicket
      ? this.getPendingOAuthCompletions()
      : [];
    const preservedRecoveries = preserveOAuthCompletionTicket
      ? this.readPendingOAuthRecoveries()
      : [];
    const nextEpoch = this.advanceAuthEpoch();
    if (preserveOAuthCompletionTicket) {
      // A completion request has started but has not won yet. Keep sibling
      // provider callbacks viable and move them to the new epoch so a later
      // callback can explicitly supersede this one. The eventual successful
      // winner clears all remaining flow authority.
      for (const recovery of preservedRecoveries) {
        this.storage.setItem(this.pendingOAuthRecoveryKey(recovery.nonce), JSON.stringify({
          version: recovery.version,
          createdAt: recovery.createdAt,
          authEpoch: nextEpoch,
        }));
      }
      this.clearPendingOAuthCompletions();
    } else {
      this.clearPendingOAuthRecovery();
    }
    for (const completion of preserved) {
      this.storePendingOAuthCompletion({ ...completion, authEpoch: nextEpoch });
    }
    return nextEpoch;
  }

  /** Get the current refresh-token session id when the token carries a jti claim. */
  getCurrentSessionId(): string | null {
    if (this.usesHttpOnlyCookie) {
      return this.accessToken ? extractSessionId(this.accessToken) : null;
    }
    const refreshToken = this.storage.getItem(this.keys.refreshTokenKey);
    return refreshToken ? extractSessionId(refreshToken) : null;
  }

  /** Drop the current access token so the next request must re-authenticate or refresh. */
  invalidateAccessToken(): void {
    this.accessToken = null;
    if (!this.hasRefreshSession()) {
      this.cachedUser = null;
      this.emitAuthStateChange(null);
    }
  }

  /** Replace cached user state without mutating stored tokens. */
  setCurrentUser(user: TokenUser | null): void {
    this.persistCookieSessionMarkerFor(user);
    this.cachedUser = user;
    this.emitAuthStateChange(user);
  }

  markPendingSignOut(pushDeviceId?: string): void {
    if (!this.usesHttpOnlyCookie) return;
    if (
      pushDeviceId !== undefined
      && (pushDeviceId.length < 1
        || pushDeviceId.length > 128
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(pushDeviceId))
    ) {
      throw new EdgeBaseError(400, 'Invalid push device ID for sign-out cleanup.');
    }
    if (!this.hasPendingSignOut()) {
      this.advanceAuthEpoch();
    }
    this.clearPendingOAuthRecovery();
    this.storage.setItem(this.keys.pendingSignOutKey, JSON.stringify({
      timestamp: Date.now(),
      nonce: createRefreshOwnerId(),
      epoch: this.currentAuthEpoch(),
      ...(pushDeviceId ? { pushDeviceId } : {}),
    }));
  }

  getPendingSignOutPushDeviceId(): string | null {
    if (!this.usesHttpOnlyCookie) return null;
    try {
      const parsed = JSON.parse(this.storage.getItem(this.keys.pendingSignOutKey) ?? '{}') as {
        pushDeviceId?: unknown;
      };
      return typeof parsed.pushDeviceId === 'string'
        && parsed.pushDeviceId.length <= 128
        && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(parsed.pushDeviceId)
        ? parsed.pushDeviceId
        : null;
    } catch {
      return null;
    }
  }

  hasPendingSignOut(): boolean {
    return this.usesHttpOnlyCookie
      && Boolean(this.storage.getItem(this.keys.pendingSignOutKey));
  }

  clearPendingSignOut(): void {
    this.storage.removeItem(this.keys.pendingSignOutKey);
  }

  /** Clear every local credential while retaining an in-flight refresh lock. */
  clearSessionForPendingSignOut(shouldBroadcast = true): void {
    this.clearTokensInternal(shouldBroadcast, true);
  }

  /**
   * Wait for a refresh that began before the sign-out tombstone to settle.
   * Returns false at an absolute deadline so sign-out can still revoke the
   * cookie; the caller must retain the tombstone and revoke again if that late
   * refresh ever settles.
   */
  async waitForRefreshIdle(): Promise<boolean> {
    const deadline = Date.now() + REFRESH_IDLE_DEADLINE_MS;
    if (this.refreshPromise) {
      const remaining = Math.max(0, deadline - Date.now());
      const settled = await Promise.race([
        this.refreshPromise.then(() => true, () => true),
        delay(remaining).then(() => false),
      ]);
      if (!settled) return false;
    }
    // A live peer refresh renews its lock. Keep the private UI signed out while
    // waiting, but do not revoke/clear the cookie until that response has been
    // applied by the browser; otherwise a late Set-Cookie can resurrect the
    // session after sign-out. A crashed peer stops heartbeating and its lock is
    // discarded after LOCK_TIMEOUT_MS.
    while (true) {
      const lock = parseRefreshLock(this.storage.getItem(this.keys.refreshLockKey));
      if (!lock) return true;
      if (!isFreshRefreshLock(lock)) {
        this.storage.removeItem(this.keys.refreshLockKey);
        return true;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await delay(Math.min(50, remaining));
    }
  }

  /** Finish a definitive sign-out. */
  completePendingSignOut(): void {
    this.storage.removeItem(this.keys.refreshTokenKey);
    this.clearPendingSignOut();
  }

  private pendingOAuthRecoveryKey(nonce: string): string {
    return `${this.keys.oauthPendingRecoveryPrefix}${nonce}`;
  }

  private oauthConsumeLockKey(nonce: string): string {
    return `${this.keys.oauthConsumeLockPrefix}${nonce}`;
  }

  /**
   * Enumerate/prune independent per-flow records. Each write and removal
   * touches one nonce key, so interleaved tabs can never resurrect or overwrite
   * a sibling flow through shared JSON read/modify/write.
   */
  private readPendingOAuthRecoveries(): PendingOAuthRecoveryEntry[] {
    const entries: PendingOAuthRecoveryEntry[] = [];
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.keys.oauthConsumeLockPrefix)) {
        const claim = parseRefreshLock(this.storage.getItem(key));
        if (
          !claim
          || (claim.ownerId === 'consumed'
            ? !isFreshOAuthRecoveryTimestamp(claim.timestamp)
            : !isFreshRefreshLock(claim))
        ) this.storage.removeItem(key);
        continue;
      }
      if (!key.startsWith(this.keys.oauthPendingRecoveryPrefix)) continue;
      const nonce = key.slice(this.keys.oauthPendingRecoveryPrefix.length);
      const entry = parsePendingOAuthRecoveryEntry(nonce, this.storage.getItem(key));
      if (!entry) {
        this.storage.removeItem(key);
        continue;
      }
      entries.push(entry);
    }
    entries.sort((left, right) =>
      left.createdAt - right.createdAt || left.nonce.localeCompare(right.nonce));
    const excess = Math.max(0, entries.length - OAUTH_PENDING_RECOVERY_LIMIT);
    for (let index = 0; index < excess; index += 1) {
      this.storage.removeItem(this.pendingOAuthRecoveryKey(entries[index].nonce));
    }
    return entries.slice(excess);
  }

  /** Bind an OAuth callback to a flow initiated by this browser. */
  markPendingOAuthRecovery(): string {
    if (!this.storage.isPersistent) {
      throw new EdgeBaseError(
        0,
        'Persistent browser storage is required to start OAuth safely.',
      );
    }
    const nonce = createOAuthRecoveryNonce();
    const key = this.pendingOAuthRecoveryKey(nonce);
    const createdAt = Math.max(Date.now(), this.lastOAuthRecoveryCreatedAt + 1);
    this.lastOAuthRecoveryCreatedAt = createdAt;
    const entry: PendingOAuthRecoveryEntry = {
      version: 1,
      createdAt,
      nonce,
      authEpoch: this.currentAuthEpoch(),
    };
    try {
      // Publish this flow before discovery/pruning. A peer doing the same only
      // creates another independent key; neither can lose the other's write.
      this.storage.setItem(key, JSON.stringify({
        version: entry.version,
        createdAt: entry.createdAt,
        authEpoch: entry.authEpoch,
      }));
      this.readPendingOAuthRecoveries();
      return nonce;
    } catch (error) {
      try {
        this.storage.removeItem(key);
      } catch {
        // The original persistence failure is the actionable error.
      }
      throw error;
    }
  }

  /** Retain only a verified cookie callback across a transient refresh/reload. */
  markCookieOAuthRecovery(): void {
    if (!this.usesHttpOnlyCookie) return;
    // Keep the released v1 shape and key so a page rollback can complete a
    // callback that the new bundle already verified.
    this.storage.setItem(this.keys.cookieOAuthRecoveryKey, JSON.stringify({
      version: 1,
      createdAt: Date.now(),
    } satisfies LegacyCookieOAuthRecoveryMarker));
  }

  hasPendingOAuthRecovery(): boolean {
    return this.readPendingOAuthRecoveries().length > 0;
  }

  /** Whether a verified cookie callback may retry a tokenless refresh. */
  hasCookieOAuthRecovery(): boolean {
    const marker = parseCookieOAuthRecoveryMarker(
      this.storage.getItem(this.keys.cookieOAuthRecoveryKey),
    );
    if (!marker) {
      this.storage.removeItem(this.keys.cookieOAuthRecoveryKey);
      return false;
    }
    return true;
  }

  private clearCookieOAuthRecovery(): void {
    const marker = parseCookieOAuthRecoveryMarker(
      this.storage.getItem(this.keys.cookieOAuthRecoveryKey),
    );
    if (marker) this.storage.removeItem(this.keys.cookieOAuthRecoveryKey);
  }

  /**
   * Consume only the OAuth flow whose callback carries the matching nonce.
   * Mismatched/malformed callbacks cannot cancel other concurrent flows.
   */
  async consumePendingOAuthRecovery(
    recoveryNonce: string | null,
    callbackEpoch: number,
  ): Promise<boolean> {
    if (!recoveryNonce || !OAUTH_RECOVERY_NONCE_PATTERN.test(recoveryNonce)) return false;
    const now = Date.now();
    for (const [nonce, consumedAt] of this.consumedOAuthRecoveryNonces) {
      if (!isFreshOAuthRecoveryTimestamp(consumedAt)) {
        this.consumedOAuthRecoveryNonces.delete(nonce);
      }
    }
    if (this.consumedOAuthRecoveryNonces.has(recoveryNonce)) return false;
    const claimKey = this.oauthConsumeLockKey(recoveryNonce);
    const existingClaim = parseRefreshLock(this.storage.getItem(claimKey));
    if (isTerminalOAuthConsumeClaim(existingClaim)) return false;
    if (existingClaim?.ownerId === 'consumed') this.storage.removeItem(claimKey);

    const consume = (): boolean => {
      const key = this.pendingOAuthRecoveryKey(recoveryNonce);
      const entry = parsePendingOAuthRecoveryEntry(
        recoveryNonce,
        this.storage.getItem(key),
      );
      if (entry && oauthRecoveryNoncesMatch(entry.nonce, recoveryNonce)) {
        this.consumedOAuthRecoveryNonces.set(recoveryNonce, now);
        // Persist terminal authority before removing the flow. If removal
        // fails, replay remains rejected for the full original flow TTL.
        let terminalPersisted = false;
        let pendingRemoved = false;
        try {
          this.storage.setItem(claimKey, JSON.stringify({
            ownerId: 'consumed',
            timestamp: now,
          }));
          terminalPersisted = true;
        } catch {
          // Exact-key deletion below can still make the consume durable.
        }
        try {
          this.storage.removeItem(key);
          pendingRemoved = true;
        } catch {
          // A terminal marker (or the in-memory fence) remains authoritative.
        }
        if (pendingRemoved) {
          try {
            // No replay material remains. Avoid retaining a lock-shaped marker
            // for the full OAuth TTL after a clean exact-key deletion.
            this.storage.removeItem(claimKey);
          } catch {
            // A leftover terminal marker is conservative and self-prunes.
          }
        }
        // Do not adopt callback credentials unless the one-time pending record
        // itself was deleted. A durable terminal marker safely blocks replay,
        // but the first attempt still fails closed when exact-key deletion did
        // not complete.
        if (!pendingRemoved) return false;
      } else {
        // Exact-key removal is deliberately unconditional for a recognized
        // nonce. Stale/malformed/old-epoch callbacks cannot linger for replay.
        this.storage.removeItem(key);
      }
      if (!entry || !oauthRecoveryNoncesMatch(entry.nonce, recoveryNonce)) return false;
      const currentEpoch = this.currentAuthEpoch();
      return entry.authEpoch === callbackEpoch && callbackEpoch === currentEpoch;
    };

    const locks = typeof navigator !== 'undefined'
      ? (navigator as Navigator & {
        locks?: {
          request<T>(
            name: string,
            options: { mode: 'exclusive' },
            callback: () => T | Promise<T>,
          ): Promise<T>;
        };
      }).locks
      : undefined;
    if (locks && typeof locks.request === 'function') {
      return locks.request(
        `${this.keys.oauthPendingRecoveryPrefix}consume:${recoveryNonce}`,
        { mode: 'exclusive' },
        consume,
      );
    }
    // localStorage has no compare-and-swap primitive, so use the same
    // write-delay-verify lease used by refresh leader election. Concurrent
    // contenders may both observe an empty key, but only the last verified
    // owner is allowed to remove and accept the pending flow.
    const ownerId = createRefreshOwnerId();
    const activeClaim = parseRefreshLock(this.storage.getItem(claimKey));
    if (activeClaim && isFreshRefreshLock(activeClaim)) return false;
    if (activeClaim) this.storage.removeItem(claimKey);

    this.storage.setItem(claimKey, serializeRefreshLock(ownerId));
    await delay(LOCK_VERIFY_DELAY_MS);
    const acquiredClaim = parseRefreshLock(this.storage.getItem(claimKey));
    if (!acquiredClaim || acquiredClaim.ownerId !== ownerId) return false;

    try {
      return consume();
    } finally {
      const currentClaim = parseRefreshLock(this.storage.getItem(claimKey));
      if (currentClaim?.ownerId === ownerId) {
        this.storage.removeItem(claimKey);
      }
    }
  }

  /** Persist a verified callback ticket before any fallible exchange request. */
  storePendingOAuthCompletion(input: Omit<PendingOAuthCompletion, 'createdAt'> & { createdAt?: number }): boolean {
    if (
      !OAUTH_RECOVERY_NONCE_PATTERN.test(input.ticket)
      || (input.recoveryNonce !== null
        && !OAUTH_RECOVERY_NONCE_PATTERN.test(input.recoveryNonce))
    ) {
      throw new EdgeBaseError(400, 'Invalid OAuth completion record.');
    }
    const record: PendingOAuthCompletion & { version: 1 } = {
      version: 1,
      ...input,
      createdAt: input.createdAt ?? Date.now(),
    };
    this.pendingOAuthCompletionMemory.set(input.ticket, record);
    try {
      this.storage.setItem(
        `${this.keys.oauthPendingCompletionPrefix}${input.ticket}`,
        JSON.stringify(record),
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Recover every unexpired ticket for this exact API namespace/epoch. */
  getPendingOAuthCompletions(): PendingOAuthCompletion[] {
    const currentEpoch = this.currentAuthEpoch();
    const candidates = new Map<string, PendingOAuthCompletion>();
    for (const [ticket, record] of this.pendingOAuthCompletionMemory) {
      const parsed = parsePendingOAuthCompletion(ticket, JSON.stringify({ version: 1, ...record }));
      if (!parsed || parsed.authEpoch !== currentEpoch || this.hasPendingSignOut()) {
        this.pendingOAuthCompletionMemory.delete(ticket);
        continue;
      }
      candidates.set(ticket, parsed);
    }
    for (const key of this.storage.keys()) {
      if (!key.startsWith(this.keys.oauthPendingCompletionPrefix)) continue;
      const ticket = key.slice(this.keys.oauthPendingCompletionPrefix.length);
      const record = parsePendingOAuthCompletion(ticket, this.storage.getItem(key));
      if (!record || record.authEpoch !== currentEpoch || this.hasPendingSignOut()) {
        this.storage.removeItem(key);
        this.pendingOAuthCompletionMemory.delete(ticket);
        continue;
      }
      candidates.set(ticket, record);
      this.pendingOAuthCompletionMemory.set(ticket, record);
    }
    return [...candidates.values()].sort((left, right) => right.createdAt - left.createdAt);
  }

  /** Recover the newest unexpired ticket for compatibility with single-flow callers. */
  getPendingOAuthCompletion(): PendingOAuthCompletion | null {
    return this.getPendingOAuthCompletions()[0] ?? null;
  }

  clearPendingOAuthCompletion(ticket: string): void {
    if (!OAUTH_RECOVERY_NONCE_PATTERN.test(ticket)) return;
    this.pendingOAuthCompletionMemory.delete(ticket);
    this.storage.removeItem(`${this.keys.oauthPendingCompletionPrefix}${ticket}`);
  }

  clearPendingOAuthCompletions(): void {
    this.pendingOAuthCompletionMemory.clear();
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.keys.oauthPendingCompletionPrefix)) this.storage.removeItem(key);
    }
  }

  clearPendingOAuthRecovery(recoveryNonce?: string): void {
    if (recoveryNonce) {
      if (OAUTH_RECOVERY_NONCE_PATTERN.test(recoveryNonce)) {
        this.storage.removeItem(this.pendingOAuthRecoveryKey(recoveryNonce));
        this.storage.removeItem(this.oauthConsumeLockKey(recoveryNonce));
      }
      return;
    }
    this.pendingOAuthCompletionMemory.clear();
    for (const key of this.storage.keys()) {
      if (key.startsWith(this.keys.oauthPendingRecoveryPrefix)) {
        this.storage.removeItem(key);
      }
      if (key.startsWith(this.keys.oauthConsumeLockPrefix)) {
        this.storage.removeItem(key);
      }
      if (key.startsWith(this.keys.oauthPendingCompletionPrefix)) {
        this.storage.removeItem(key);
      }
    }
    // Remove the old shared registry during rolling upgrades without ever
    // reading or rewriting it.
    this.storage.removeItem(this.keys.oauthPendingRecoveriesKey);
  }

  setPendingSignOutRetry(retry: Promise<void>): void {
    this.pendingSignOutRetry = retry;
    const cleanup = () => {
      if (this.pendingSignOutRetry === retry) {
        this.pendingSignOutRetry = null;
      }
    };
    void retry.then(cleanup, cleanup);
  }

  private async waitForPendingSignOutRetry(): Promise<void> {
    if (this.pendingSignOutRetry) {
      await this.pendingSignOutRetry;
    }
  }

  /** Clear all tokens (signout) */
  clearTokens(): void {
    this.advanceAuthEpoch();
    this.clearTokensInternal(true);
  }

  private clearTokensInternal(
    shouldBroadcast: boolean,
    preserveRefreshLock = false,
  ): void {
    this.accessToken = null;
    this.expectedCookieUserId = null;
    this.cachedUser = null;
    this.emitAuthStateChange(null);
    this.storage.removeItem(this.keys.refreshTokenKey);
    if (!preserveRefreshLock) {
      this.storage.removeItem(this.keys.refreshLockKey);
    }
    this.storage.removeItem(this.keys.refreshResultKey);
    this.storage.removeItem(this.keys.cookieSessionKey);
    this.storage.removeItem(this.keys.cookieOAuthRecoveryKey);
    this.clearPendingOAuthRecovery();

    // Notify other tabs
    if (shouldBroadcast && this.broadcastChannel) {
      this.broadcastChannel.postMessage({ type: 'signed-out' });
    }
  }

  /** Get current user (from cached JWT payload) */
  getCurrentUser(): TokenUser | null {
    return this.cachedUser;
  }

  /**
   * Return the non-secret local principal hint used to scope offline caches.
   *
   * This is deliberately separate from `getCurrentUser()`: an online cookie
   * marker has not been authenticated yet and must never grant access or be
   * treated as verified claims. A pending local sign-out is authoritative and
   * suppresses the hint immediately.
   */
  getSessionUserIdHint(): string | null {
    if (!this.usesHttpOnlyCookie) return this.cachedUser?.id ?? null;
    if (this.hasPendingSignOut()) return null;
    const marker = parseCookieSessionMarker(
      this.storage.getItem(this.keys.cookieSessionKey),
    );
    return marker?.userId ?? this.cachedUser?.id ?? null;
  }

  /** Subscribe to auth state changes */
  onAuthStateChange(handler: AuthStateChangeHandler): () => void {
    this.authStateListeners.push(handler);
    // Immediately fire with current state
    handler(this.cachedUser);
    return () => {
      this.authStateListeners = this.authStateListeners.filter((h) => h !== handler);
    };
  }

  /** Update cached user and emit auth state change */
  private updateUser(accessToken: string): void {
    const user = extractUser(accessToken);
    this.cachedUser = user;
    this.persistCookieSessionMarker();
    this.emitAuthStateChange(user);
  }

  private setUserFromAccessToken(accessToken: string, userOverride?: TokenUser | null): void {
    const tokenUser = extractUser(accessToken);
    const user = userOverride
      ? { ...(tokenUser ?? {}), ...userOverride }
      : tokenUser;
    this.cachedUser = user;
    this.persistCookieSessionMarker();
    this.emitAuthStateChange(user);
  }

  private persistCookieSessionMarker(): void {
    this.persistCookieSessionMarkerFor(this.cachedUser);
  }

  private persistCookieSessionMarkerFor(user: TokenUser | null): void {
    if (!this.usesHttpOnlyCookie) return;
    if (!user?.id) {
      this.storage.removeItem(this.keys.cookieSessionKey);
      return;
    }
    const marker: CookieSessionMarker = {
      version: 1,
      userId: user.id,
    };
    this.storage.setItem(this.keys.cookieSessionKey, JSON.stringify(marker));
  }

  private promoteCookieSessionMarkerUser(): void {
    if (!this.usesHttpOnlyCookie) return;
    const marker = parseCookieSessionMarker(
      this.storage.getItem(this.keys.cookieSessionKey),
    );
    if (!marker) return;
    // A transient failure cannot validate richer claims, but the id-only hint
    // is sufficient for local-first/offline cache selection. Never downgrade a
    // fully verified user that is already present in this tab's memory.
    if (!this.cachedUser) {
      this.cachedUser = { id: marker.userId };
    }
    this.emitAuthStateChange(this.cachedUser);
  }

  private readPersistedAuthEpoch(): number {
    const parsed = Number.parseInt(this.storage.getItem(this.keys.authEpochKey) ?? '0', 10);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  }

  private currentAuthEpoch(): number {
    this.authEpoch = Math.max(this.authEpoch, this.readPersistedAuthEpoch());
    return this.authEpoch;
  }

  private advanceAuthEpoch(): number {
    const next = this.currentAuthEpoch() + 1;
    this.storage.setItem(this.keys.authEpochKey, String(next));
    this.authEpoch = next;
    return next;
  }

  private assertAuthEpoch(expectedEpoch: number): void {
    if (this.currentAuthEpoch() !== expectedEpoch) {
      throw new EdgeBaseError(
        401,
        'Auth state changed while the session refresh was in flight.',
        undefined,
        'auth-state-changed',
      );
    }
  }

  private emitAuthStateChange(user: TokenUser | null): void {
    for (const listener of this.authStateListeners) {
      listener(user);
    }
  }

  /** Clean up listeners */
  destroy(): void {
    this.stopRefreshLockHeartbeat();
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    if (this.storageListener && typeof window !== 'undefined') {
      window.removeEventListener('storage', this.storageListener);
      this.storageListener = null;
    }
    this.authStateListeners = [];
  }
}
