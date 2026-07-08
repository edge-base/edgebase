/**
 * Token management with automatic refresh and BroadcastChannel leader election
 *: Access Token in memory, Refresh Token in localStorage
 *: BroadcastChannel leader election for tab-safe refresh
 */

import { EdgeBaseError } from '@edge-base/core';
import { createBrowserStorage } from './browser-storage.js';

/** Token pair returned from auth endpoints */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

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
    return typeof payload.jti === 'string' && payload.jti ? payload.jti : null;
  } catch {
    return null;
  }
}

type StorageAdapter = ReturnType<typeof createBrowserStorage>;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_VERIFY_DELAY_MS = 16;
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
  broadcastChannelName: string;
}

export interface TokenManagerOptions {
  authNamespace?: string;
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
  private readonly refreshOwnerId = createRefreshOwnerId();

  constructor(private baseUrl: string, options: TokenManagerOptions = {}) {
    this.storage = createBrowserStorage();
    this.keys = buildTokenManagerKeys(options.authNamespace);
    this.setupCrossTabListeners();

    // Restore user from existing refresh token on init
    const existingRefresh = this.storage.getItem(this.keys.refreshTokenKey);
    if (existingRefresh && !isTokenExpired(existingRefresh, 0)) {
      this.cachedUser = extractUser(existingRefresh);
    }
  }

  /** Read-only access to current access token (for database-live re-auth) */
  get currentAccessToken(): string | null {
    return this.accessToken;
  }

  /** Set up cross-tab listener for token changes */
  private setupCrossTabListeners(): void {
    if (typeof window === 'undefined') return;

    // Prefer BroadcastChannel
    if (typeof BroadcastChannel !== 'undefined') {
      this.broadcastChannel = new BroadcastChannel(this.keys.broadcastChannelName);
      this.broadcastChannel.onmessage = (event: MessageEvent) => {
        const { type, accessToken, refreshToken } = event.data;
        if (type === 'token-refreshed' && accessToken && refreshToken) {
          this.accessToken = accessToken;
          this.storage.setItem(this.keys.refreshTokenKey, refreshToken);
          this.updateUser(accessToken);
        } else if (type === 'signed-out') {
          this.clearTokensInternal(false);
        }
      };
    }

    // Also listen to storage events (fallback + additional tab sync for signout)
    if (typeof window !== 'undefined') {
      this.storageListener = (e: StorageEvent) => {
        if (e.key === this.keys.refreshTokenKey) {
          if (e.newValue === null) {
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
        if (e.key === this.keys.refreshResultKey && e.newValue) {
          this.consumeFallbackRefreshResult(e.newValue);
        }
      };
      window.addEventListener('storage', this.storageListener);
    }
  }

  /** Get valid access token, refreshing if needed */
  async getAccessToken(
    doRefresh: (refreshToken: string) => Promise<TokenPair>,
  ): Promise<string | null> {
    // If we have a valid access token, return it
    if (this.accessToken && !isTokenExpired(this.accessToken)) {
      return this.accessToken;
    }

    // Try to refresh
    const refreshToken = this.storage.getItem(this.keys.refreshTokenKey);
    if (!refreshToken) return null;

    return this.refreshWithLeaderElection(refreshToken, doRefresh);
  }

  /**
   * Force a refresh right now, routed through the SAME leader-elected/deduped
   * path as {@link getAccessToken}. Used by explicit `refreshSession()` calls so
   * they cannot double-spend the rotating refresh token concurrently with a
   * background refresh (they join the in-flight refresh instead). Returns the
   * resulting token pair.
   */
  async forceRefresh(doRefresh: (refreshToken: string) => Promise<TokenPair>): Promise<TokenPair> {
    const refreshToken = this.storage.getItem(this.keys.refreshTokenKey);
    if (!refreshToken) throw new EdgeBaseError(401, 'No refresh token available.');
    const accessToken = await this.refreshWithLeaderElection(refreshToken, doRefresh);
    const currentRefreshToken = this.storage.getItem(this.keys.refreshTokenKey) ?? refreshToken;
    return { accessToken, refreshToken: currentRefreshToken };
  }

  /**
   * Leader election for tab-safe refresh
   * Only one tab should refresh at a time; others wait for the result.
   */
  private async refreshWithLeaderElection(
    refreshToken: string,
    doRefresh: (refreshToken: string) => Promise<TokenPair>,
  ): Promise<string> {
    // Deduplicate within same tab
    if (this.refreshPromise) {
      const result = await this.refreshPromise;
      return result.accessToken;
    }

    // Check if another tab is refreshing (localStorage mutex)
    const activeLock = parseRefreshLock(this.storage.getItem(this.keys.refreshLockKey));
    if (activeLock && isFreshRefreshLock(activeLock) && activeLock.ownerId !== this.refreshOwnerId) {
      return this.waitForRefreshResult();
    }

    // Acquire lock and verify ownership. Two tabs can otherwise both read an
    // empty lock and refresh with the same rotating refresh token.
    this.storage.setItem(this.keys.refreshLockKey, serializeRefreshLock(this.refreshOwnerId));
    await delay(LOCK_VERIFY_DELAY_MS);
    const acquiredLock = parseRefreshLock(this.storage.getItem(this.keys.refreshLockKey));
    if (!acquiredLock || acquiredLock.ownerId !== this.refreshOwnerId) {
      return this.waitForRefreshResult();
    }

    const storedRefreshToken = this.storage.getItem(this.keys.refreshTokenKey);
    const tokenForRefresh = storedRefreshToken && storedRefreshToken !== refreshToken
      ? storedRefreshToken
      : refreshToken;

    // Invoke doRefresh inside a promise chain so that even a MISSING doRefresh
    // or a SYNCHRONOUS throw surfaces as a rejection routed through .catch and
    // .finally — otherwise the lock acquired above would leak until its TTL and
    // the failure would look like a raw TypeError rather than an auth error.
    this.refreshPromise = Promise.resolve()
      .then(() => {
        if (typeof doRefresh !== 'function') {
          throw new EdgeBaseError(0, 'No token refresh function was provided.');
        }
        return doRefresh(tokenForRefresh);
      })
      .then((tokens) => {
        this.setTokens(tokens);
        this.broadcastTokenRefreshed(tokens);
        return tokens;
      })
      .catch((err) => {
        // If refresh fails with 401, clear everything (token revoked/expired)
        if (err instanceof EdgeBaseError && err.code === 401) {
          const currentRefreshToken = this.storage.getItem(this.keys.refreshTokenKey);
          if (currentRefreshToken && currentRefreshToken !== tokenForRefresh) {
            this.accessToken = null;
          } else {
            this.clearTokens();
          }
        }
        throw err;
      })
      .finally(() => {
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
    this.storage.setItem(this.keys.refreshTokenKey, tokens.refreshToken);
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

  /** Get the current refresh-token session id when the token carries a jti claim. */
  getCurrentSessionId(): string | null {
    const refreshToken = this.storage.getItem(this.keys.refreshTokenKey);
    return refreshToken ? extractSessionId(refreshToken) : null;
  }

  /** Drop the current access token so the next request must re-authenticate or refresh. */
  invalidateAccessToken(): void {
    this.accessToken = null;
    if (!this.storage.getItem(this.keys.refreshTokenKey)) {
      this.cachedUser = null;
      this.emitAuthStateChange(null);
    }
  }

  /** Replace cached user state without mutating stored tokens. */
  setCurrentUser(user: TokenUser | null): void {
    this.cachedUser = user;
    this.emitAuthStateChange(user);
  }

  /** Clear all tokens (signout) */
  clearTokens(): void {
    this.clearTokensInternal(true);
  }

  private clearTokensInternal(shouldBroadcast: boolean): void {
    this.accessToken = null;
    this.storage.removeItem(this.keys.refreshTokenKey);
    this.storage.removeItem(this.keys.refreshLockKey);
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
    this.emitAuthStateChange(user);
  }

  private setUserFromAccessToken(accessToken: string, userOverride?: TokenUser | null): void {
    const tokenUser = extractUser(accessToken);
    const user = userOverride
      ? { ...(tokenUser ?? {}), ...userOverride }
      : tokenUser;
    this.cachedUser = user;
    this.emitAuthStateChange(user);
  }

  private emitAuthStateChange(user: TokenUser | null): void {
    for (const listener of this.authStateListeners) {
      listener(user);
    }
  }

  /** Clean up listeners */
  destroy(): void {
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
