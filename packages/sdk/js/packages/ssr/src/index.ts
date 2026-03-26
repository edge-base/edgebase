/**
 * @edge-base/ssr — Server-side rendering helpers for EdgeBase.
 *
 * Provides cookie-based token management for SSR frameworks
 * (Next.js, Nuxt, SvelteKit, Remix, etc.).
 *
 * Usage:
 * ```ts
 * import { createServerClient } from '@edge-base/ssr';
 *
 * const client = createServerClient('https://my-app.edgebase.fun', {
 *   cookies: {
 *     get: (name) => cookieStore.get(name)?.value,
 *     set: (name, value, options) => cookieStore.set(name, value, options),
 *     delete: (name) => cookieStore.delete(name),
 *   },
 * });
 *
 * const user = client.getUser();
 * const posts = await client.db('shared').table('posts').getList();
 * ```
 */

// Server client
export { ServerEdgeBase, type ServerUser } from './server-client.js';

// Cookie token manager (for advanced usage)
export { CookieTokenManager, type CookieTokenManagerOptions } from './cookie-token-manager.js';

// Types
export type { CookieStore, CookieOptions, ServerClientOptions, ServerAuthCookieNames } from './types.js';

// Re-export core types for convenience
export type { ITokenPair } from '@edge-base/core';
export { EdgeBaseError } from '@edge-base/core';
export type { EdgeBaseTableMap, EdgeBaseTableRecord } from '@edge-base/core';

// ─── Factory ───

import { ServerEdgeBase } from './server-client.js';
import type { ServerClientOptions } from './types.js';
import type { EdgeBaseTableMap } from '@edge-base/core';

/**
 * Create a server-side EdgeBase client with cookie-based token management.
 *
 * @param url - EdgeBase project URL
 * @param options - Cookie store and optional settings
 *
 * @example
 * // Next.js App Router (Server Component)
 * import { cookies } from 'next/headers';
 * const cookieStore = await cookies();
 * const client = createServerClient(process.env.EDGEBASE_URL!, {
 *   cookies: {
 *     get: (name) => cookieStore.get(name)?.value,
 *     set: (name, value, options) => cookieStore.set(name, value, options),
 *     delete: (name) => cookieStore.delete(name),
 *   },
 * });
 */
export function createServerClient<Schema extends EdgeBaseTableMap = EdgeBaseTableMap>(
  url: string,
  options: ServerClientOptions<Schema>,
): ServerEdgeBase<Schema> {
  return new ServerEdgeBase(url, options);
}
