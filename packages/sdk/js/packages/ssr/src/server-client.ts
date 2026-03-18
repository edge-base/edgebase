/**
 * ServerEdgeBase — SSR-optimized EdgeBase client.
 *
 * Uses cookie-based token management instead of localStorage.
 * Provides db(), storage, and functions access on behalf of the authenticated user.
 *
 * Usage:
 * ```ts
 * import { createServerClient } from '@edge-base/ssr';
 * const client = createServerClient('https://my-app.edgebase.fun', {
 *   cookies: cookieStore,
 * });
 * const posts = await client.db('shared').table('posts').get();
 * const health = await client.functions.get('public/health');
 * ```
 */

import {
  HttpClient,
  DbRef,
  StorageClient,
  FunctionsClient,
  ContextManager,
  DefaultDbApi,
  HttpClientAdapter,
} from '@edge-base/core';
import type { ITokenPair } from '@edge-base/core';
import { CookieTokenManager } from './cookie-token-manager.js';
import type { ServerClientOptions } from './types.js';

/** Decoded user from JWT access token (payload only, no verification). */
export interface ServerUser {
  id: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  role?: string;
  isAnonymous?: boolean;
  emailVisibility?: string;
  custom?: Record<string, unknown>;
}

/**
 * Server-side EdgeBase client for SSR environments.
 *
 * Exposes: db(), storage, functions, getUser(), getSession().
 * Does NOT expose: auth signIn/signUp (client-side only), database-live, room, push.
 */
export class ServerEdgeBase {
  readonly storage: StorageClient;
  readonly functions: FunctionsClient;
  private httpClient: HttpClient;
  private tokenManager: CookieTokenManager;
  private baseUrl: string;
  private core: DefaultDbApi;
  constructor(url: string, options: ServerClientOptions) {
    this.baseUrl = url.replace(/\/$/, '');
    this.tokenManager = new CookieTokenManager(options.cookies, options.cookieOptions);

    this.httpClient = new HttpClient({
      baseUrl: this.baseUrl,
      tokenManager: options.serviceKey ? undefined : this.tokenManager,
      serviceKey: options.serviceKey,
      contextManager: new ContextManager(),
    });

    this.core = new DefaultDbApi(new HttpClientAdapter(this.httpClient));
    this.storage = new StorageClient(this.httpClient, this.core);
    this.functions = new FunctionsClient(this.httpClient);
  }

  /**
   * Access a database by namespace + optional instance ID.
   *
   * @example
   * const posts = await client.db('shared').table('posts').get();
   * const docs = await client.db('workspace', 'ws-456').table('documents').get();
   */
  db(namespace: string, id?: string): DbRef {
    return new DbRef(this.core, namespace, id, undefined, undefined);
  }

  /**
   * Get the current authenticated user from the cookie token.
   * Decodes the JWT payload without server verification.
   * Returns null if no valid access token is present.
   */
  getUser(): ServerUser | null {
    const token = this.tokenManager.getAccessToken() as string | null;
    if (!token) return null;
    return decodeJwtPayload(token);
  }

  /**
   * Get the current session tokens.
   * Useful for passing tokens to client-side hydration.
   */
  getSession(): { accessToken: string | null; refreshToken: string | null } {
    return {
      accessToken: this.tokenManager.getAccessToken() as string | null,
      refreshToken: this.tokenManager.getRefreshToken(),
    };
  }

  /**
   * Set session tokens (e.g., after OAuth callback on the server).
   * Writes tokens to cookies for subsequent requests.
   */
  setSession(tokens: ITokenPair): void {
    this.tokenManager.setTokens(tokens);
  }

  /**
   * Clear session tokens (server-side sign out).
   * Removes token cookies.
   */
  clearSession(): void {
    this.tokenManager.clearTokens();
  }

}

// ─── JWT Decode (payload only, no verification) ───

function decodeJwtPayload(token: string): ServerUser | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Base64url decode the payload
    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    // Use TextDecoder for portable base64 decoding (Node 16+, Deno, Bun, Edge)
    const bytes = Uint8Array.from(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).atob(padded) as string,
      (c: string) => c.charCodeAt(0),
    );
    const json = new TextDecoder().decode(bytes);
    const data = JSON.parse(json);

    return {
      id: data.sub ?? data.id,
      email: data.email,
      displayName: data.displayName,
      avatarUrl: data.avatarUrl,
      role: data.role,
      isAnonymous: data.isAnonymous,
      emailVisibility: data.emailVisibility,
      custom: data.custom,
    };
  } catch {
    return null;
  }
}
