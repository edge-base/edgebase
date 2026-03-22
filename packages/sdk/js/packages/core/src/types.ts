/**
 * @edge-base/core — Abstract interfaces for decoupling Core from Client/Admin.
 *: Core must not depend on Client or Admin modules.
 *
 * These interfaces define the contracts that Client-side implementations fulfill.
 * Core modules use these types instead of importing directly from @edge-base/web.
 */

/** Token pair returned from auth refresh. */
export interface ITokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Abstract token manager for HTTP client auth header injection. */
export interface ITokenManager {
  getAccessToken(refreshFn?: (refreshToken: string) => Promise<ITokenPair>): Promise<string | null> | string | null;
  getRefreshToken(): string | null;
  invalidateAccessToken(): void;
  setTokens(tokens: ITokenPair): void;
  clearTokens(): void;
}

/** Unified subscription handle — call unsubscribe() to stop listening. */
export interface Subscription {
  unsubscribe(): void;
}

/** Database-live change event — matches the actual DatabaseLiveClient callback shape. */
export interface IDbChange<T = Record<string, unknown>> {
  changeType: 'added' | 'modified' | 'removed';
  data: T | null;
  docId: string;
}

/**
 * Abstract database-live subscriber for table snapshot.
 * Implemented by @edge-base/web's DatabaseLiveClient.
 */
export interface IDatabaseLiveSubscriber {
  onSnapshot<T>(
    channel: string,
    callback: (change: IDbChange<T>) => void,
    clientFilters?: unknown,
    serverFilters?: unknown,
    serverOrFilters?: unknown,
  ): Subscription;
}

/**
 * Abstract filter matching function.
 * Implemented by @edge-base/web's matchesFilter.
 */
export type FilterMatchFn = (
  doc: Record<string, unknown>,
  filters: Record<string, unknown> | [string, string, unknown][],
) => boolean;
