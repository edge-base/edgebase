/**
 * @edgebase/ssr — Type definitions for cookie-based SSR authentication.
 */

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

/** Options for creating a server-side EdgeBase client. */
export interface ServerClientOptions {
  /** Cookie store for token persistence across requests. */
  cookies: CookieStore;
  /** Override default cookie options (httpOnly, secure, sameSite, path). */
  cookieOptions?: Partial<CookieOptions>;
  /**
   * Service key for admin-level access.
   * When provided, requests use the service key instead of user tokens.
   */
  serviceKey?: string;
}
