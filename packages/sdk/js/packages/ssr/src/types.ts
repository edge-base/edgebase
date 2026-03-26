/**
 * @edge-base/ssr — Type definitions for cookie-based SSR authentication.
 */

import type { EdgeBaseTableMap } from '@edge-base/core';

/** Options for cookie serialization. */
export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  maxAge?: number;
  path?: string;
  domain?: string;
}

/**
 * Abstract cookie store interface.
 *
 * Implementations:
 * - Next.js App Router: `cookies()` from `next/headers`
 * - Next.js Pages Router: wrapper around `nookies` or `req.cookies` + `res.setHeader`
 * - Nuxt 3: wrapper around `useCookie` or `getCookie`/`setCookie` from `h3`
 * - SvelteKit: wrapper around `cookies` from `event`
 */
export interface CookieStore {
  /** Get a cookie value by name. Returns null/undefined if not set. */
  get(name: string): string | null | undefined;
  /** Set a cookie with the given name, value, and options. */
  set(name: string, value: string, options?: CookieOptions): void;
  /** Delete a cookie by name. */
  delete(name: string): void;
}

export interface ServerAuthCookieNames {
  accessToken: string;
  refreshToken: string;
}

/** Options for creating a server-side EdgeBase client. */
export interface ServerClientOptions<Schema extends EdgeBaseTableMap = EdgeBaseTableMap> {
  /** Cookie store for token persistence across requests. */
  cookies: CookieStore;
  /** Override default cookie options (httpOnly, secure, sameSite, path). */
  cookieOptions?: Partial<CookieOptions>;
  /** Schema map from typegen (for example `EdgeBaseTables`) used for table inference. */
  schema?: Schema;
  /** Prefix auth cookie names to avoid same-origin collisions across apps. */
  authNamespace?: string;
  /**
   * Service key for admin-level access.
   * When provided, requests use the service key instead of user tokens.
   */
  serviceKey?: string;
}
