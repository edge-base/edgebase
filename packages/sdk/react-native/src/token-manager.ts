/**
 * Token management for React Native — asynchronous secure-storage based.
 *: Access Token in memory, Refresh Token in persistent storage
 *: onAuthStateChange
 *
 * Key differences from @edge-base/web TokenManager:
 * - Uses an async Keychain/Keystore-compatible adapter instead of localStorage
 * - No BroadcastChannel (no multi-tab in RN)
 * - No storage event listener (RN has no cross-tab concept)
 * - Simpler: single-tab, single-process model
 */

import { EdgeBaseError } from '@edge-base/core';

// ─── AsyncStorage adapter interface ───

/** Minimal interface compatible with @react-native-async-storage/async-storage */
export interface AsyncStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** App-provided CSPRNG. Return exactly `length` cryptographically random bytes. */
export type SecureRandomProvider = (
  length: number,
) => Uint8Array | Promise<Uint8Array>;

export interface TokenManagerOptions {
  /** Separates credentials when one app talks to more than one EdgeBase project. */
  authNamespace?: string;
  /** Required on runtimes without global crypto.getRandomValues (for example unpolyfilled Hermes). */
  secureRandom?: SecureRandomProvider;
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
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    return {
      id: payload.sub,
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

const OAUTH_RECOVERY_TTL_MS = 10 * 60_000;
const OAUTH_COMPLETION_TTL_MS = 5 * 60_000;
const OAUTH_RECOVERY_LIMIT = 8;
const OAUTH_RECOVERY_NONCE_BYTES = 32;
const OAUTH_RECOVERY_NONCE_PATTERN = /^[0-9a-f]{64}$/;
interface PendingOAuthRecoveryEntry {
  nonce: string;
  createdAt: number;
  authEpoch: number;
  expectedRedirectUrl?: string;
  consumedAt?: number;
}

interface TokenManagerKeys {
  refreshToken: string;
  authEpoch: string;
  pendingOAuthRecoveries: string;
  pendingSignOut: string;
  pendingSessionRevocations: string;
  pendingOAuthCompletions: string;
}

function buildTokenManagerKeys(baseUrl: string, authNamespace?: string): TokenManagerKeys {
  const namespace = authNamespace?.trim() || baseUrl.replace(/\/$/, '');
  const prefix = `edgebase:${encodeURIComponent(namespace)}`;
  return {
    refreshToken: `${prefix}:refresh-token`,
    authEpoch: `${prefix}:auth-epoch`,
    pendingOAuthRecoveries: `${prefix}:oauth-pending-recoveries`,
    pendingSignOut: `${prefix}:pending-signout`,
    pendingSessionRevocations: `${prefix}:pending-session-revocations`,
    pendingOAuthCompletions: `${prefix}:oauth-pending-completions`,
  };
}

export interface PendingOAuthCompletion {
  ticket: string;
  recoveryNonce: string | null;
  kind: 'signin' | 'link';
  authTransport: 'body' | 'cookie';
  createdAt: number;
  authEpoch: number;
}

function parsePendingOAuthCompletions(raw: string | null): PendingOAuthCompletion[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; entries?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return [];
    const now = Date.now();
    const seen = new Set<string>();
    const entries: PendingOAuthCompletion[] = [];
    for (const candidate of parsed.entries) {
      if (!candidate || typeof candidate !== 'object') continue;
      const value = candidate as Partial<PendingOAuthCompletion>;
      if (
        typeof value.ticket !== 'string'
        || !OAUTH_RECOVERY_NONCE_PATTERN.test(value.ticket)
        || seen.has(value.ticket)
        || (value.recoveryNonce !== null
          && (typeof value.recoveryNonce !== 'string'
            || !OAUTH_RECOVERY_NONCE_PATTERN.test(value.recoveryNonce)))
        || (value.kind !== 'signin' && value.kind !== 'link')
        || (value.authTransport !== 'body' && value.authTransport !== 'cookie')
        || typeof value.createdAt !== 'number'
        || !Number.isFinite(value.createdAt)
        || now - value.createdAt < -60_000
        || now - value.createdAt > OAUTH_COMPLETION_TTL_MS
        || typeof value.authEpoch !== 'number'
        || !Number.isSafeInteger(value.authEpoch)
        || value.authEpoch < 0
      ) continue;
      seen.add(value.ticket);
      entries.push(value as PendingOAuthCompletion);
    }
    return entries.sort((left, right) => left.createdAt - right.createdAt).slice(-8);
  } catch {
    return [];
  }
}

export interface PendingSessionRevocation {
  refreshToken: string;
  createdAt: number;
  pushDeviceId?: string;
  /** A sign-out revocation that still needs its project-scoped push binding resolved. */
  pushCleanupPending?: boolean;
}

function parsePendingSessionRevocations(raw: string | null): PendingSessionRevocation[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; entries?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return [];
    const seen = new Set<string>();
    const entries: PendingSessionRevocation[] = [];
    for (const candidate of parsed.entries) {
      if (!candidate || typeof candidate !== 'object') continue;
      const value = candidate as Partial<PendingSessionRevocation>;
      if (
        typeof value.refreshToken !== 'string'
        || value.refreshToken.length === 0
        || value.refreshToken.length > 16_384
        || typeof value.createdAt !== 'number'
        || !Number.isFinite(value.createdAt)
        || seen.has(value.refreshToken)
      ) continue;
      if (
        value.pushDeviceId !== undefined
        && (typeof value.pushDeviceId !== 'string'
          || value.pushDeviceId.length < 1
          || value.pushDeviceId.length > 128
          || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.pushDeviceId))
      ) continue;
      if (value.pushCleanupPending !== undefined && typeof value.pushCleanupPending !== 'boolean') {
        continue;
      }
      seen.add(value.refreshToken);
      entries.push({
        refreshToken: value.refreshToken,
        createdAt: value.createdAt,
        pushDeviceId: value.pushDeviceId,
        pushCleanupPending: value.pushCleanupPending,
      });
    }
    return entries.sort((left, right) => left.createdAt - right.createdAt).slice(-16);
  } catch {
    return [];
  }
}

function assertOptionalPushDeviceId(value: string | undefined): void {
  if (
    value !== undefined
    && (value.length < 1
      || value.length > 128
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))
  ) {
    throw new EdgeBaseError(400, 'Invalid push device ID for session cleanup.');
  }
}

const storageQueues = new WeakMap<AsyncStorageAdapter, Map<string, Promise<void>>>();
const authMutationQueues = new WeakMap<AsyncStorageAdapter, Map<string, Promise<void>>>();

function enqueueSharedStorageMutation(
  storage: AsyncStorageAdapter,
  scope: string,
  operation: () => Promise<void>,
): Promise<void> {
  let queues = storageQueues.get(storage);
  if (!queues) {
    queues = new Map();
    storageQueues.set(storage, queues);
  }
  const previous = queues.get(scope) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  queues.set(scope, result.catch(() => undefined));
  return result;
}

function enqueueSharedAuthMutation<T>(
  storage: AsyncStorageAdapter,
  scope: string,
  operation: () => Promise<T>,
): Promise<T> {
  let queues = authMutationQueues.get(storage);
  if (!queues) {
    queues = new Map();
    authMutationQueues.set(storage, queues);
  }
  const previous = queues.get(scope) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  queues.set(scope, result.then(() => undefined, () => undefined));
  return result;
}

function isFreshOAuthRecoveryEntry(entry: PendingOAuthRecoveryEntry): boolean {
  const age = Date.now() - entry.createdAt;
  return OAUTH_RECOVERY_NONCE_PATTERN.test(entry.nonce)
    && Number.isSafeInteger(entry.authEpoch)
    && entry.authEpoch >= 0
    && Number.isFinite(entry.createdAt)
    && age >= -60_000
    && age <= OAUTH_RECOVERY_TTL_MS;
}

function parsePendingOAuthRecoveries(raw: string | null): PendingOAuthRecoveryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; entries?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return [];
    const seen = new Set<string>();
    const result: PendingOAuthRecoveryEntry[] = [];
    for (const candidate of parsed.entries) {
      if (!candidate || typeof candidate !== 'object') continue;
      const value = candidate as Partial<PendingOAuthRecoveryEntry>;
      const entry: PendingOAuthRecoveryEntry = {
        nonce: typeof value.nonce === 'string' ? value.nonce : '',
        createdAt: typeof value.createdAt === 'number' ? value.createdAt : NaN,
        authEpoch: typeof value.authEpoch === 'number' ? value.authEpoch : -1,
        expectedRedirectUrl: typeof value.expectedRedirectUrl === 'string'
          ? value.expectedRedirectUrl
          : undefined,
        consumedAt: typeof value.consumedAt === 'number' ? value.consumedAt : undefined,
      };
      if (!isFreshOAuthRecoveryEntry(entry) || seen.has(entry.nonce)) continue;
      seen.add(entry.nonce);
      result.push(entry);
    }
    return result
      .sort((left, right) => left.createdAt - right.createdAt || left.nonce.localeCompare(right.nonce))
      .slice(-OAUTH_RECOVERY_LIMIT);
  } catch {
    return [];
  }
}

async function createOAuthRecoveryNonce(provider?: SecureRandomProvider): Promise<string> {
  let bytes: Uint8Array;
  if (provider) {
    bytes = await provider(OAUTH_RECOVERY_NONCE_BYTES);
  } else {
    const secureCrypto = globalThis.crypto;
    if (!secureCrypto || typeof secureCrypto.getRandomValues !== 'function') {
      throw new EdgeBaseError(
        0,
        'Secure random generation is required to start OAuth. Import react-native-get-random-values before EdgeBase or provide secureRandom.',
        undefined,
        'secure-random-unavailable',
      );
    }
    bytes = new Uint8Array(OAUTH_RECOVERY_NONCE_BYTES);
    secureCrypto.getRandomValues(bytes);
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== OAUTH_RECOVERY_NONCE_BYTES) {
    throw new EdgeBaseError(
      0,
      `secureRandom must return exactly ${OAUTH_RECOVERY_NONCE_BYTES} bytes.`,
      undefined,
      'secure-random-invalid',
    );
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

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
  private authEpoch = 0;
  private lastOAuthRecoveryCreatedAt = 0;
  private readonly keys: TokenManagerKeys;
  private readonly storageScope: string;
  private readonly secureRandom?: SecureRandomProvider;
  private readonly consumedOAuthRecoveryNonces = new Map<string, number>();
  private readonly pendingOAuthCompletionMemory = new Map<string, PendingOAuthCompletion>();

  constructor(
    private baseUrl: string,
    storage: AsyncStorageAdapter,
    options: TokenManagerOptions = {},
  ) {
    this.storage = storage;
    this.keys = buildTokenManagerKeys(baseUrl, options.authNamespace);
    this.storageScope = this.keys.refreshToken;
    this.secureRandom = options.secureRandom;
    // Async init: restore user from persisted refresh token
    this.initPromise = this.restore();
  }

  /** Wait for storage restore to complete */
  async ready(): Promise<void> {
    return this.initPromise;
  }

  private async restore(): Promise<void> {
    try {
      const [stored, storedEpoch] = await Promise.all([
        this.storage.getItem(this.keys.refreshToken),
        this.storage.getItem(this.keys.authEpoch),
      ]);
      const epoch = Number.parseInt(storedEpoch ?? '0', 10);
      this.authEpoch = Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : 0;
      const pendingSignOut = await this.storage.getItem(this.keys.pendingSignOut);
      // Pre-namespace refresh tokens are deliberately not auto-migrated: they
      // contain no project binding, so the first of multiple clients could
      // otherwise disclose a credential to the wrong origin.
      if (!pendingSignOut && stored && !isTokenExpired(stored, 0)) {
        this.refreshToken = stored;
        this.cachedUser = extractUser(stored);
      }
    } catch {
      // ignore storage errors on init
    }
    this.initialized = true;
  }

  private enqueueStorageMutation(operation: () => Promise<void>): Promise<void> {
    return enqueueSharedStorageMutation(this.storage, this.storageScope, operation);
  }

  /** Serialize all token-producing network operations for this project. */
  runAuthMutation<T>(operation: () => Promise<T>): Promise<T> {
    return enqueueSharedAuthMutation(this.storage, this.storageScope, operation);
  }

  /**
   * Begin an explicit identity transition under the shared mutation lock.
   * Advancing the durable epoch before network invalidates queued old-session
   * refreshes and pending OAuth callbacks across TokenManager instances.
   */
  async beginAuthoritativeAuthTransition(
    preserveOAuthCompletionTicket?: string,
  ): Promise<number> {
    await this.initPromise;
    let nextEpoch = 0;
    await this.enqueueStorageMutation(async () => {
      const preservedRecoveries = preserveOAuthCompletionTicket
        ? parsePendingOAuthRecoveries(await this.storage.getItem(this.keys.pendingOAuthRecoveries))
        : [];
      nextEpoch = Math.max(this.authEpoch, await this.readPersistedAuthEpoch()) + 1;
      await this.storage.setItem(this.keys.authEpoch, String(nextEpoch));
      this.authEpoch = nextEpoch;
      if (preserveOAuthCompletionTicket) {
        if (preservedRecoveries.length > 0) {
          await this.storage.setItem(this.keys.pendingOAuthRecoveries, JSON.stringify({
            version: 1,
            entries: preservedRecoveries.map((entry) => ({ ...entry, authEpoch: nextEpoch })),
          }));
        } else {
          await this.storage.removeItem(this.keys.pendingOAuthRecoveries);
        }
        const stored = parsePendingOAuthCompletions(
          await this.storage.getItem(this.keys.pendingOAuthCompletions),
        );
        const preservedByTicket = new Map<string, PendingOAuthCompletion>();
        for (const entry of [...this.pendingOAuthCompletionMemory.values(), ...stored]) {
          preservedByTicket.set(entry.ticket, { ...entry, authEpoch: nextEpoch });
        }
        const preserved = [...preservedByTicket.values()].slice(-8);
        this.pendingOAuthCompletionMemory.clear();
        for (const entry of preserved) this.pendingOAuthCompletionMemory.set(entry.ticket, entry);
        if (preserved.length > 0) {
          await this.storage.setItem(this.keys.pendingOAuthCompletions, JSON.stringify({
            version: 1,
            entries: preserved,
          }));
        } else {
          await this.storage.removeItem(this.keys.pendingOAuthCompletions);
        }
      } else {
        await this.storage.removeItem(this.keys.pendingOAuthRecoveries);
        this.pendingOAuthCompletionMemory.clear();
        await this.storage.removeItem(this.keys.pendingOAuthCompletions);
      }
    });
    return nextEpoch;
  }

  /** Reject a queued refresh before it can rotate a newer session server-side. */
  async assertRefreshSource(refreshToken: string, expectedEpoch: number): Promise<void> {
    await this.initPromise;
    await this.enqueueStorageMutation(async () => {
      const persistedEpoch = await this.readPersistedAuthEpoch();
      const persistedToken = await this.storage.getItem(this.keys.refreshToken);
      this.authEpoch = Math.max(this.authEpoch, persistedEpoch);
      if (
        this.authEpoch !== expectedEpoch
        || this.refreshToken !== refreshToken
        || persistedToken !== refreshToken
      ) {
        throw new EdgeBaseError(
          401,
          'A newer authentication transition superseded this refresh.',
          undefined,
          'auth-state-changed',
        );
      }
    });
  }

  private async readPersistedAuthEpoch(): Promise<number> {
    const raw = await this.storage.getItem(this.keys.authEpoch);
    const parsed = Number.parseInt(raw ?? '0', 10);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
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

    const refreshEpoch = await this.captureAuthEpoch();
    this.refreshPromise = this.runAuthMutation(async () => {
      await this.assertRefreshSource(refreshToken, refreshEpoch);
      const tokens = await doRefresh(refreshToken);
      // Rotation and durable adoption are one auth mutation. Releasing the
      // queue between them would let a newer sign-in begin after the old
      // session was rotated but before its response was persisted.
      await this.setTokensPersisted(tokens, refreshEpoch);
      return tokens;
    })
      .catch((err) => {
        if (err instanceof EdgeBaseError && err.code === 401 && err.slug !== 'auth-state-changed') {
          void this.clearTokens();
        }
        throw err;
      })
      .finally(() => {
        this.refreshPromise = null;
      });

    const result = await this.refreshPromise;
    return result.accessToken;
  }

  /** Persist credentials before making a public session observable. */
  async setTokens(tokens: TokenPair): Promise<void> {
    if (!extractUser(tokens.accessToken)) {
      throw new EdgeBaseError(401, 'Auth response returned an invalid access token.');
    }
    await this.runAuthMutation(async () => {
      const authEpoch = await this.beginAuthoritativeAuthTransition();
      await this.setTokensPersisted(tokens, authEpoch);
    });
  }

  /** Persist a rotated credential before making the new session observable. */
  async setTokensPersisted(tokens: TokenPair, expectedEpoch?: number): Promise<void> {
    const user = extractUser(tokens.accessToken);
    if (!user) {
      throw new EdgeBaseError(401, 'Auth response returned an invalid access token.');
    }
    await this.initPromise;
    let credentialWriteAttempted = false;
    try {
      await this.enqueueStorageMutation(async () => {
        const persistedEpoch = await this.readPersistedAuthEpoch();
        this.authEpoch = Math.max(this.authEpoch, persistedEpoch);
        if (expectedEpoch !== undefined && this.authEpoch !== expectedEpoch) {
          throw new EdgeBaseError(
            401,
            'Auth state changed while credentials were being persisted.',
            undefined,
            'auth-state-changed',
          );
        }
        // Treat pendingSignOut as a local commit marker. A crash or uncertain
        // storage failure after the refresh-token write must never let a cold
        // start adopt a session that this process did not expose successfully.
        await this.storage.setItem(this.keys.pendingSignOut, JSON.stringify({
          version: 1,
          createdAt: Date.now(),
        }));
        credentialWriteAttempted = true;
        await this.storage.setItem(this.keys.refreshToken, tokens.refreshToken);
        // A successful explicit session adoption supersedes a retry tombstone,
        // but only after the new credential is durable.
        await this.storage.removeItem(this.keys.pendingSignOut);
      });
    } catch (error) {
      if (credentialWriteAttempted) {
        await this.enqueueStorageMutation(async () => {
          await this.storage.setItem(this.keys.pendingSignOut, JSON.stringify({
            version: 1,
            createdAt: Date.now(),
          }));
          if (await this.storage.getItem(this.keys.refreshToken) === tokens.refreshToken) {
            await this.storage.removeItem(this.keys.refreshToken);
          }
        }).catch(() => undefined);
      }
      this.accessToken = null;
      this.refreshToken = null;
      this.cachedUser = null;
      this.emitAuthStateChange(null);
      if (error instanceof EdgeBaseError && error.slug === 'auth-state-changed') throw error;
      throw new EdgeBaseError(
        0,
        'Failed to persist the rotated refresh token; the session was not adopted.',
        undefined,
        'auth-token-persistence-failed',
      );
    }

    // clearTokens advances the in-memory epoch before waiting for storage, so
    // this synchronous check closes the gap between durable write and expose.
    if (expectedEpoch !== undefined && this.authEpoch !== expectedEpoch) {
      await this.enqueueStorageMutation(async () => {
        if (await this.storage.getItem(this.keys.refreshToken) === tokens.refreshToken) {
          await this.storage.removeItem(this.keys.refreshToken);
        }
      }).catch(() => undefined);
      throw new EdgeBaseError(
        401,
        'Auth state changed while credentials were being persisted.',
        undefined,
        'auth-state-changed',
      );
    }
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    this.cachedUser = user;
    this.emitAuthStateChange(user);
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

  private clearTokensInMemory(): void {
    const minimumNextEpoch = this.authEpoch + 1;
    this.authEpoch = minimumNextEpoch;
    this.accessToken = null;
    this.refreshToken = null;
    this.cachedUser = null;
    this.emitAuthStateChange(null);
  }

  /**
   * Begin a crash-safe sign-out before any network wait. The non-secret
   * tombstone prevents cold-start restoration while the old refresh token is
   * retained only in secure storage for retryable server revocation.
   */
  beginPendingSignOut(
    refreshToken: string | null,
    pushDeviceId?: string,
    resolvePushDeviceId = false,
  ): Promise<void> {
    assertOptionalPushDeviceId(pushDeviceId);
    if (!this.initialized) {
      return this.initPromise.then(() => this.beginPendingSignOut(
        refreshToken,
        pushDeviceId,
        resolvePushDeviceId,
      ));
    }
    const minimumNextEpoch = this.authEpoch + 1;
    this.clearTokensInMemory();
    return this.enqueueStorageMutation(async () => {
      const nextEpoch = Math.max(
        minimumNextEpoch,
        (await this.readPersistedAuthEpoch()) + 1,
      );
      this.authEpoch = nextEpoch;
      // The tombstone is written first and removed only after every queued
      // server revocation succeeds.
      let persistenceError: unknown;
      const attempt = async (operation: () => Promise<void>) => {
        try {
          await operation();
        } catch (error) {
          persistenceError ??= error;
        }
      };
      await attempt(() => this.storage.setItem(this.keys.pendingSignOut, JSON.stringify({
        version: 1,
        createdAt: Date.now(),
      })));
      if (refreshToken) {
        await attempt(async () => {
          const entries = parsePendingSessionRevocations(
            await this.storage.getItem(this.keys.pendingSessionRevocations),
          ).filter((entry) => entry.refreshToken !== refreshToken);
          entries.push({
            refreshToken,
            createdAt: Date.now(),
            pushDeviceId,
            pushCleanupPending: resolvePushDeviceId && !pushDeviceId,
          });
          await this.storage.setItem(this.keys.pendingSessionRevocations, JSON.stringify({
            version: 1,
            entries: entries.slice(-16),
          }));
        });
      }
      await attempt(() => this.storage.setItem(this.keys.authEpoch, String(nextEpoch)));
      await attempt(() => this.storage.removeItem(this.keys.refreshToken));
      await attempt(() => this.storage.removeItem(this.keys.pendingOAuthRecoveries));
      await attempt(() => this.storage.removeItem(this.keys.pendingOAuthCompletions));
      if (persistenceError) throw persistenceError;
    });
  }

  /** Clear credentials for invalid/expired auth without scheduling revocation. */
  clearTokens(): Promise<void> {
    if (!this.initialized) {
      return this.initPromise.then(() => this.clearTokens());
    }
    const minimumNextEpoch = this.authEpoch + 1;
    this.clearTokensInMemory();
    return this.enqueueStorageMutation(async () => {
      const nextEpoch = Math.max(
        minimumNextEpoch,
        (await this.readPersistedAuthEpoch()) + 1,
      );
      this.authEpoch = nextEpoch;
      let persistenceError: unknown;
      const attempt = async (operation: () => Promise<void>) => {
        try {
          await operation();
        } catch (error) {
          persistenceError ??= error;
        }
      };
      await attempt(() => this.storage.setItem(this.keys.pendingSignOut, JSON.stringify({
        version: 1,
        createdAt: Date.now(),
      })));
      await attempt(() => this.storage.setItem(this.keys.authEpoch, String(nextEpoch)));
      await attempt(() => this.storage.removeItem(this.keys.refreshToken));
      await attempt(() => this.storage.removeItem(this.keys.pendingOAuthRecoveries));
      await attempt(() => this.storage.removeItem(this.keys.pendingOAuthCompletions));
      if (!persistenceError) await attempt(() => this.storage.removeItem(this.keys.pendingSignOut));
      if (persistenceError) throw persistenceError;
    });
  }

  /** Durably queue a server-created session that must never be adopted. */
  async addPendingSessionRevocation(refreshToken: string, pushDeviceId?: string): Promise<void> {
    if (!refreshToken || refreshToken.length > 16_384) {
      throw new EdgeBaseError(500, 'Invalid refresh token returned for session cleanup.');
    }
    assertOptionalPushDeviceId(pushDeviceId);
    await this.initPromise;
    await this.enqueueStorageMutation(async () => {
      const entries = parsePendingSessionRevocations(
        await this.storage.getItem(this.keys.pendingSessionRevocations),
      ).filter((entry) => entry.refreshToken !== refreshToken);
      entries.push({ refreshToken, createdAt: Date.now(), pushDeviceId });
      await this.storage.setItem(this.keys.pendingSessionRevocations, JSON.stringify({
        version: 1,
        entries: entries.slice(-16),
      }));
    });
  }

  async getPendingSessionRevocations(): Promise<PendingSessionRevocation[]> {
    await this.initPromise;
    let result: PendingSessionRevocation[] = [];
    await this.enqueueStorageMutation(async () => {
      result = parsePendingSessionRevocations(
        await this.storage.getItem(this.keys.pendingSessionRevocations),
      );
    });
    return result;
  }

  /** Bind (or explicitly dismiss) deferred push cleanup before server revocation. */
  async resolvePendingPushCleanup(
    refreshToken: string,
    pushDeviceId: string | null,
  ): Promise<void> {
    assertOptionalPushDeviceId(pushDeviceId ?? undefined);
    await this.initPromise;
    await this.enqueueStorageMutation(async () => {
      const entries = parsePendingSessionRevocations(
        await this.storage.getItem(this.keys.pendingSessionRevocations),
      );
      const entry = entries.find((candidate) => candidate.refreshToken === refreshToken);
      if (!entry) return;
      entry.pushCleanupPending = false;
      if (pushDeviceId) entry.pushDeviceId = pushDeviceId;
      else delete entry.pushDeviceId;
      await this.storage.setItem(this.keys.pendingSessionRevocations, JSON.stringify({
        version: 1,
        entries,
      }));
    });
  }

  async completePendingSessionRevocation(refreshToken: string): Promise<void> {
    await this.initPromise;
    await this.enqueueStorageMutation(async () => {
      const remaining = parsePendingSessionRevocations(
        await this.storage.getItem(this.keys.pendingSessionRevocations),
      ).filter((entry) => entry.refreshToken !== refreshToken);
      if (remaining.length === 0) {
        await this.storage.removeItem(this.keys.pendingSessionRevocations);
      } else {
        await this.storage.setItem(this.keys.pendingSessionRevocations, JSON.stringify({
          version: 1,
          entries: remaining,
        }));
      }
    });
  }

  async completePendingSignOutIfRevoked(): Promise<void> {
    await this.initPromise;
    await this.enqueueStorageMutation(async () => {
      const pending = parsePendingSessionRevocations(
        await this.storage.getItem(this.keys.pendingSessionRevocations),
      );
      if (pending.length === 0) await this.storage.removeItem(this.keys.pendingSignOut);
    });
  }

  /** Persist a one-shot CSPRNG OAuth flow binding before opening the browser. */
  async markPendingOAuthRecovery(expectedRedirectUrl?: string): Promise<string> {
    await this.initPromise;
    const nonce = await createOAuthRecoveryNonce(this.secureRandom);
    const createdAt = Math.max(Date.now(), this.lastOAuthRecoveryCreatedAt + 1);
    this.lastOAuthRecoveryCreatedAt = createdAt;
    const entry: PendingOAuthRecoveryEntry = {
      nonce,
      createdAt,
      authEpoch: 0,
      expectedRedirectUrl,
    };
    await this.enqueueStorageMutation(async () => {
      this.authEpoch = Math.max(this.authEpoch, await this.readPersistedAuthEpoch());
      entry.authEpoch = this.authEpoch;
      const entries = parsePendingOAuthRecoveries(
        await this.storage.getItem(this.keys.pendingOAuthRecoveries),
      ).filter((candidate) => candidate.nonce !== nonce);
      entries.push(entry);
      await this.storage.setItem(this.keys.pendingOAuthRecoveries, JSON.stringify({
        version: 1,
        entries: entries.slice(-OAUTH_RECOVERY_LIMIT),
      }));
    });
    return nonce;
  }

  /** Capture the current persisted-session generation for an OAuth callback. */
  async captureAuthEpoch(): Promise<number> {
    await this.initPromise;
    await this.enqueueStorageMutation(async () => {
      this.authEpoch = Math.max(this.authEpoch, await this.readPersistedAuthEpoch());
    });
    return this.authEpoch;
  }

  async isAuthEpochCurrent(epoch: number): Promise<boolean> {
    await this.initPromise;
    await this.enqueueStorageMutation(async () => {
      this.authEpoch = Math.max(this.authEpoch, await this.readPersistedAuthEpoch());
    });
    return this.authEpoch === epoch;
  }

  /** Consume exactly one callback authority and require start/callback/current epoch equality. */
  async consumePendingOAuthRecovery(
    nonce: string | null,
    callbackEpoch: number,
    callbackUrl?: string,
  ): Promise<boolean> {
    await this.initPromise;
    if (!nonce || !OAUTH_RECOVERY_NONCE_PATTERN.test(nonce)) return false;
    for (const [consumedNonce, consumedAt] of this.consumedOAuthRecoveryNonces) {
      if (Date.now() - consumedAt > OAUTH_RECOVERY_TTL_MS) {
        this.consumedOAuthRecoveryNonces.delete(consumedNonce);
      }
    }
    if (this.consumedOAuthRecoveryNonces.has(nonce)) return false;
    let accepted = false;
    await this.enqueueStorageMutation(async () => {
      this.authEpoch = Math.max(this.authEpoch, await this.readPersistedAuthEpoch());
      const entries = parsePendingOAuthRecoveries(
        await this.storage.getItem(this.keys.pendingOAuthRecoveries),
      );
      const matched = entries.find((entry) => entry.nonce === nonce);
      if (matched && matched.consumedAt === undefined) {
        const consumedAt = Date.now();
        this.consumedOAuthRecoveryNonces.set(nonce, consumedAt);
        const terminalEntries = entries.map((entry) => entry.nonce === nonce
          ? { ...entry, consumedAt }
          : entry);
        // Keep a terminal record for the original flow TTL. This makes replay
        // fail closed even when a storage adapter cannot remove keys.
        let terminalPersisted = false;
        let removalPersisted = false;
        try {
          await this.storage.setItem(this.keys.pendingOAuthRecoveries, JSON.stringify({
            version: 1,
            entries: terminalEntries,
          }));
          terminalPersisted = true;
        } catch {
          // Exact removal below can still establish durable one-shot state.
        }
        const remaining = entries.filter((entry) => entry.nonce !== nonce);
        try {
          if (remaining.length === 0) {
            await this.storage.removeItem(this.keys.pendingOAuthRecoveries);
          } else {
            await this.storage.setItem(this.keys.pendingOAuthRecoveries, JSON.stringify({
              version: 1,
              entries: remaining,
            }));
          }
          removalPersisted = true;
        } catch {
          // The terminal record and in-memory fence remain conservative.
        }
        accepted = Boolean(
          removalPersisted
          && matched.authEpoch === callbackEpoch
          && callbackEpoch === this.authEpoch
          && (!matched.expectedRedirectUrl || this.oauthCallbackMatches(
            matched.expectedRedirectUrl,
            callbackUrl,
          ))
        );
        if (!terminalPersisted && !removalPersisted) accepted = false;
      }
    });
    return accepted;
  }

  private oauthCallbackMatches(expected: string, callback: string | undefined): boolean {
    if (!callback) return false;
    try {
      const expectedUrl = new URL(expected);
      const callbackUrl = new URL(callback);
      callbackUrl.hash = '';
      for (const key of [
        'access_token', 'refresh_token', 'oauth_exchange_ticket', 'oauth_link_ticket', 'oauth_recovery_nonce',
        'error', 'error_description', 'state', 'auth_transport',
      ]) callbackUrl.searchParams.delete(key);
      expectedUrl.hash = '';
      return expectedUrl.toString() === callbackUrl.toString();
    } catch {
      return false;
    }
  }

  async clearPendingOAuthRecovery(nonce?: string): Promise<void> {
    await this.initPromise;
    await this.enqueueStorageMutation(async () => {
      if (!nonce) {
        await this.storage.removeItem(this.keys.pendingOAuthRecoveries);
        return;
      }
      if (!OAUTH_RECOVERY_NONCE_PATTERN.test(nonce)) return;
      const remaining = parsePendingOAuthRecoveries(
        await this.storage.getItem(this.keys.pendingOAuthRecoveries),
      ).filter((entry) => entry.nonce !== nonce);
      if (remaining.length === 0) {
        await this.storage.removeItem(this.keys.pendingOAuthRecoveries);
      } else {
        await this.storage.setItem(this.keys.pendingOAuthRecoveries, JSON.stringify({
          version: 1,
          entries: remaining,
        }));
      }
    });
  }

  async storePendingOAuthCompletion(
    input: Omit<PendingOAuthCompletion, 'createdAt'> & { createdAt?: number },
  ): Promise<void> {
    if (
      !OAUTH_RECOVERY_NONCE_PATTERN.test(input.ticket)
      || (input.recoveryNonce !== null
        && !OAUTH_RECOVERY_NONCE_PATTERN.test(input.recoveryNonce))
    ) {
      throw new EdgeBaseError(400, 'Invalid OAuth completion record.');
    }
    await this.initPromise;
    const record: PendingOAuthCompletion = {
      ...input,
      createdAt: input.createdAt ?? Date.now(),
    };
    this.pendingOAuthCompletionMemory.set(input.ticket, record);
    await this.enqueueStorageMutation(async () => {
      const entries = parsePendingOAuthCompletions(
        await this.storage.getItem(this.keys.pendingOAuthCompletions),
      ).filter((entry) => entry.ticket !== input.ticket);
      entries.push(record);
      await this.storage.setItem(this.keys.pendingOAuthCompletions, JSON.stringify({
        version: 1,
        entries: entries.slice(-8),
      }));
    });
  }

  async getPendingOAuthCompletions(): Promise<PendingOAuthCompletion[]> {
    await this.initPromise;
    let result = [...this.pendingOAuthCompletionMemory.values()]
      .filter((entry) => entry.authEpoch === this.authEpoch);
    try {
      await this.enqueueStorageMutation(async () => {
        this.authEpoch = Math.max(this.authEpoch, await this.readPersistedAuthEpoch());
        const merged = new Map<string, PendingOAuthCompletion>();
        for (const entry of this.pendingOAuthCompletionMemory.values()) merged.set(entry.ticket, entry);
        for (const entry of parsePendingOAuthCompletions(
          await this.storage.getItem(this.keys.pendingOAuthCompletions),
        )) merged.set(entry.ticket, entry);
        const entries = [...merged.values()]
          .filter((entry) => entry.authEpoch === this.authEpoch)
          .sort((left, right) => left.createdAt - right.createdAt)
          .slice(-8);
        this.pendingOAuthCompletionMemory.clear();
        for (const entry of entries) this.pendingOAuthCompletionMemory.set(entry.ticket, entry);
        if (entries.length === 0) {
          await this.storage.removeItem(this.keys.pendingOAuthCompletions);
        } else {
          await this.storage.setItem(this.keys.pendingOAuthCompletions, JSON.stringify({
            version: 1,
            entries,
          }));
        }
        result = entries;
      });
    } catch {
      result = [...this.pendingOAuthCompletionMemory.values()]
        .filter((entry) => entry.authEpoch === this.authEpoch);
    }
    return result.sort((left, right) => right.createdAt - left.createdAt);
  }

  async getPendingOAuthCompletion(): Promise<PendingOAuthCompletion | null> {
    return (await this.getPendingOAuthCompletions())[0] ?? null;
  }

  async clearPendingOAuthCompletion(ticket: string): Promise<void> {
    if (!OAUTH_RECOVERY_NONCE_PATTERN.test(ticket)) return;
    await this.initPromise;
    this.pendingOAuthCompletionMemory.delete(ticket);
    await this.enqueueStorageMutation(async () => {
      const remaining = parsePendingOAuthCompletions(
        await this.storage.getItem(this.keys.pendingOAuthCompletions),
      ).filter((entry) => entry.ticket !== ticket);
      if (remaining.length === 0) {
        await this.storage.removeItem(this.keys.pendingOAuthCompletions);
      } else {
        await this.storage.setItem(this.keys.pendingOAuthCompletions, JSON.stringify({
          version: 1,
          entries: remaining,
        }));
      }
    });
  }

  async clearPendingOAuthCompletions(): Promise<void> {
    await this.initPromise;
    this.pendingOAuthCompletionMemory.clear();
    await this.enqueueStorageMutation(async () => {
      await this.storage.removeItem(this.keys.pendingOAuthCompletions);
    });
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
