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

interface CookieOAuthRecoveryMarker {
  version: 1;
  createdAt: number;
}

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

function parseCookieOAuthRecoveryMarker(value: string | null): CookieOAuthRecoveryMarker | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { version?: unknown; createdAt?: unknown };
    if (parsed.version !== 1 || typeof parsed.createdAt !== 'number') return null;
    if (Date.now() - parsed.createdAt > OAUTH_RECOVERY_TTL_MS) return null;
    return { version: 1, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
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
  cookieSessionKey: string;
  cookieOAuthRecoveryKey: string;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTokenManagerKeys(authNamespace?: string): TokenManagerKeySet {
  const trimmedNamespace = authNamespace?.trim();
  const prefix = trimmedNamespace ? `edgebase:${trimmedNamespace}` : 'edgebase';
  return {
    refreshTokenKey: `${prefix}:refresh-token`,
    refreshLockKey: `${prefix}:refresh-lock`,
    refreshResultKey: `${prefix}:refresh-result`,
    cookieSessionKey: `${prefix}:cookie-session`,
    cookieOAuthRecoveryKey: `${prefix}:cookie-oauth-recovery`,
    pendingSignOutKey: `${prefix}:pending-signout`,
    authEpochKey: `${prefix}:auth-epoch`,
    broadcastChannelName: `${prefix}:auth`,
  };
}

export type AuthStateChangeHandler = (user: TokenUser | null) => void;

export class TokenManager {
  private accessToken: string | null = null;
  private storage: StorageAdapter;
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

  constructor(private baseUrl: string, options: TokenManagerOptions = {}) {
    this.storage = createBrowserStorage();
    this.keys = buildTokenManagerKeys(options.authNamespace);
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
        if (this.usesHttpOnlyCookie && e.key === this.keys.authEpochKey) {
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
  ): Promise<string> {
    this.assertAuthEpoch(expectedEpoch);
    if (this.hasPendingSignOut()) {
      throw new EdgeBaseError(401, 'Sign-out superseded this session refresh.', undefined, 'auth-state-changed');
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
        return doRefresh(tokenForRefresh);
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
            this.advanceAuthEpoch();
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
        settled = true;
        cleanup();
        const activeLock = parseRefreshLock(this.storage.getItem(this.keys.refreshLockKey));
        if (!activeLock || !isFreshRefreshLock(activeLock)) {
          this.storage.removeItem(this.keys.refreshLockKey);
        }
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
    return this.refreshWithLeaderElection(migrationToken, doRefresh, expectedEpoch);
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
    this.accessToken = tokens.accessToken;
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
      this.expectedCookieUserId = null;
      this.clearPendingOAuthRecovery();
    } else {
      this.storage.setItem(this.keys.refreshTokenKey, tokens.refreshToken);
    }
    this.setUserFromAccessToken(tokens.accessToken, userOverride);
  }

  /** Replace only the access token while keeping the current refresh token. */
  setAccessToken(accessToken: string, userOverride?: TokenUser | null): void {
    this.accessToken = accessToken;
    this.setUserFromAccessToken(accessToken, userOverride);
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
      || this.hasPendingOAuthRecovery(),
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
    this.cachedUser = user;
    this.persistCookieSessionMarker();
    this.emitAuthStateChange(user);
  }

  markPendingSignOut(): void {
    if (!this.usesHttpOnlyCookie) return;
    if (!this.hasPendingSignOut()) {
      this.advanceAuthEpoch();
    }
    this.clearPendingOAuthRecovery();
    this.storage.setItem(this.keys.pendingSignOutKey, JSON.stringify({
      timestamp: Date.now(),
      nonce: createRefreshOwnerId(),
      epoch: this.currentAuthEpoch(),
    }));
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

  /** Remember a successful cookie OAuth redirect until its first refresh settles. */
  markPendingOAuthRecovery(): void {
    if (!this.usesHttpOnlyCookie) return;
    this.storage.setItem(this.keys.cookieOAuthRecoveryKey, JSON.stringify({
      version: 1,
      createdAt: Date.now(),
    } satisfies CookieOAuthRecoveryMarker));
  }

  hasPendingOAuthRecovery(): boolean {
    if (!this.usesHttpOnlyCookie) return false;
    const marker = parseCookieOAuthRecoveryMarker(
      this.storage.getItem(this.keys.cookieOAuthRecoveryKey),
    );
    if (marker) return true;
    this.storage.removeItem(this.keys.cookieOAuthRecoveryKey);
    return false;
  }

  clearPendingOAuthRecovery(): void {
    this.storage.removeItem(this.keys.cookieOAuthRecoveryKey);
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
    this.clearTokensInternal(true);
  }

  private clearTokensInternal(
    shouldBroadcast: boolean,
    preserveRefreshLock = false,
  ): void {
    this.accessToken = null;
    this.storage.removeItem(this.keys.refreshTokenKey);
    if (!preserveRefreshLock) {
      this.storage.removeItem(this.keys.refreshLockKey);
    }
    this.storage.removeItem(this.keys.refreshResultKey);
    this.storage.removeItem(this.keys.cookieSessionKey);
    this.storage.removeItem(this.keys.cookieOAuthRecoveryKey);
    this.expectedCookieUserId = null;
    this.cachedUser = null;
    this.emitAuthStateChange(null);

    // Notify other tabs
    if (shouldBroadcast && this.broadcastChannel) {
      this.broadcastChannel.postMessage({ type: 'signed-out' });
    }
  }

  /** Get current user (from cached JWT payload) */
  getCurrentUser(): TokenUser | null {
    return this.cachedUser;
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
    if (!this.usesHttpOnlyCookie) return;
    if (!this.cachedUser?.id) {
      this.storage.removeItem(this.keys.cookieSessionKey);
      return;
    }
    const marker: CookieSessionMarker = {
      version: 1,
      userId: this.cachedUser.id,
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
    this.authEpoch = next;
    this.storage.setItem(this.keys.authEpochKey, String(next));
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
