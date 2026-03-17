/**
 * Token management for React Native — AsyncStorage based.
 *: Access Token in memory, Refresh Token in persistent storage
 *: onAuthStateChange
 *
 * Key differences from @edgebase/web TokenManager:
 * - Uses AsyncStorage instead of localStorage (async reads/writes)
 * - No BroadcastChannel (no multi-tab in RN)
 * - No storage event listener (RN has no cross-tab concept)
 * - Simpler: single-tab, single-process model
 */

import { EdgeBaseError } from '@edgebase/core';

// ─── AsyncStorage adapter interface ───

/** Minimal interface compatible with @react-native-async-storage/async-storage */
export interface AsyncStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// ─── Token types ───

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface TokenUser {
  id: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  role?: string;
  isAnonymous?: boolean;
  emailVisibility?: string;
  custom?: Record<string, unknown>;
}

export type AuthStateChangeHandler = (user: TokenUser | null) => void;

// ─── JWT helpers ───

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new EdgeBaseError(0, 'Invalid JWT format');
  const payload = parts[1];
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '=='.slice(0, (4 - (base64.length % 4)) % 4);
  // Decode via UTF-8 so non-ASCII claims survive round-trips.
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

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

function extractUser(token: string): TokenUser | null {
  try {
    const payload = decodeJwtPayload(token);
    return {
      id: payload.sub as string,
      email: payload.email as string | undefined,
      displayName: payload.displayName as string | undefined,
      avatarUrl: payload.avatarUrl as string | undefined,
      role: payload.role as string | undefined,
      isAnonymous: payload.isAnonymous as boolean | undefined,
      emailVisibility: payload.emailVisibility as string | undefined,
      custom: payload.custom as Record<string, unknown> | undefined,
    };
  } catch {
    return null;
  }
}

// ─── Storage keys ───

const REFRESH_TOKEN_KEY = 'edgebase:refresh-token';
const PUSH_TOKEN_CACHE_KEY = 'edgebase:push-token-cache';
const PUSH_DEVICE_ID_KEY = 'edgebase:push-device-id';

export { PUSH_TOKEN_CACHE_KEY, PUSH_DEVICE_ID_KEY };

// ─── TokenManager ───

export class TokenManager {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshPromise: Promise<TokenPair> | null = null;
  private authStateListeners: AuthStateChangeHandler[] = [];
  private cachedUser: TokenUser | null = null;
  private storage: AsyncStorageAdapter;
  private initialized = false;
  private initPromise: Promise<void>;

  constructor(
    private baseUrl: string,
    storage: AsyncStorageAdapter,
  ) {
    this.storage = storage;
    // Async init: restore user from persisted refresh token
    this.initPromise = this.restore();
  }

  /** Wait for storage restore to complete */
  async ready(): Promise<void> {
    return this.initPromise;
  }

  private async restore(): Promise<void> {
    try {
      const stored = await this.storage.getItem(REFRESH_TOKEN_KEY);
      if (stored && !isTokenExpired(stored, 0)) {
        this.refreshToken = stored;
        this.cachedUser = extractUser(stored);
      }
    } catch {
      // ignore storage errors on init
    }
    this.initialized = true;
  }

  /** Get valid access token, refreshing if needed */
  async getAccessToken(
    doRefresh: (refreshToken: string) => Promise<TokenPair>,
  ): Promise<string | null> {
    await this.initPromise;

    if (this.accessToken && !isTokenExpired(this.accessToken)) {
      return this.accessToken;
    }

    const refreshToken = this.refreshToken;
    if (!refreshToken) return null;

    // Deduplicate concurrent calls
    if (this.refreshPromise) {
      const result = await this.refreshPromise;
      return result.accessToken;
    }

    this.refreshPromise = doRefresh(refreshToken)
      .then((tokens) => {
        this.setTokens(tokens);
        return tokens;
      })
      .catch((err) => {
        if (err instanceof EdgeBaseError && err.code === 401) {
          this.clearTokens();
        }
        throw err;
      })
      .finally(() => {
        this.refreshPromise = null;
      });

    const result = await this.refreshPromise;
    return result.accessToken;
  }

  /** Set tokens after successful auth (sync in-memory + async persist) */
  setTokens(tokens: TokenPair): void {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    void this.storage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    this.updateUser(tokens.accessToken);
  }

  /** Get stored refresh token (sync from memory cache) */
  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  /** Drop the current access token so the next request must refresh or fail fast. */
  invalidateAccessToken(): void {
    this.accessToken = null;
    if (!this.refreshToken) {
      this.cachedUser = null;
      this.emitAuthStateChange(null);
    }
  }

  /** Read-only access to current access token (for websocket re-auth). */
  get currentAccessToken(): string | null {
    return this.accessToken;
  }

  /** Clear all tokens on sign-out */
  clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    void this.storage.removeItem(REFRESH_TOKEN_KEY);
    this.cachedUser = null;
    this.emitAuthStateChange(null);
  }

  /** Get current user (from cached JWT payload) */
  getCurrentUser(): TokenUser | null {
    return this.cachedUser;
  }

  /** Subscribe to auth state changes. Fires immediately with current state. */
  onAuthStateChange(handler: AuthStateChangeHandler): () => void {
    this.authStateListeners.push(handler);
    handler(this.cachedUser);
    return () => {
      this.authStateListeners = this.authStateListeners.filter((h) => h !== handler);
    };
  }

  private updateUser(accessToken: string): void {
    const user = extractUser(accessToken);
    this.cachedUser = user;
    this.emitAuthStateChange(user);
  }

  private emitAuthStateChange(user: TokenUser | null): void {
    for (const listener of this.authStateListeners) {
      listener(user);
    }
  }

  /** Clean up (no-op in RN, kept for API parity with web SDK) */
  destroy(): void {
    this.authStateListeners = [];
  }
}
