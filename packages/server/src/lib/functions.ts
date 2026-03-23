/**
 * App Functions runtime — context builder, function registry, and Cross-DO proxy.
 *
 * Functions execute with injected context:
 *   - `admin`     — AdminEdgeBase-compatible SDK instance
 *   - `auth`     — current user info (from request JWT)
 *   - `storage`  — optional R2 storage client
 *   - `analytics`— optional analytics adapter
 *   - `data`     — trigger event data (DB triggers: before/after)
 *   - `request`  — raw HTTP request (HTTP triggers)
 */
// DurableObjectNamespace & D1Database come from the global
// @cloudflare/workers-types registered in tsconfig.json "types".
// Importing them from the module directly causes type incompatibility
// because TypeScript treats the global ambient type and the module
// export as distinct types (Request.headers missing getSetCookie, etc.).
import * as authService from './auth-d1-service.js';
import type { EdgeBaseConfig } from '@edge-base/shared';
import type {
  FunctionDefinition,
  FunctionTrigger,
  DbTrigger,
  AuthTrigger,
  StorageTrigger,
  ScheduleTrigger,
  HttpTrigger,
} from '@edge-base/shared';
import { getD1BindingName, shouldRouteToD1 } from './do-router.js';
import { executeDoSql } from './do-sql.js';
import { D1AuthDb, type AuthDb } from './auth-db-adapter.js';
import { ensureAuthSchema } from './auth-d1.js';
import type { Env } from '../types.js';
import { createSignedToken } from '../routes/storage.js';
import {
  createManagedAdminUser,
  deleteManagedAdminUser,
  normalizeAdminUserUpdates,
  updateManagedAdminUser,
} from './admin-user-management.js';
import { hashPassword } from './password.js';
import { generateId } from './uuid.js';
import { DbRef, TableRef, DefaultDbApi, HttpClient, ContextManager } from '@edge-base/core';
import { InternalHttpTransport } from './internal-transport.js';

// ─── Function Context Types ───

export interface AuthContext {
  id: string;
  email?: string;
  isAnonymous?: boolean;
  custom?: Record<string, unknown>;
}

export interface AdminAuthContext {
  getUser(userId: string): Promise<Record<string, unknown>>;
  listUsers(options?: {
    limit?: number;
    cursor?: string;
  }): Promise<{ users: Record<string, unknown>[]; cursor?: string }>;
  createUser(data: {
    email: string;
    password: string;
    displayName?: string;
    role?: string;
  }): Promise<Record<string, unknown>>;
  updateUser(userId: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteUser(userId: string): Promise<void>;
  setCustomClaims(userId: string, claims: Record<string, unknown>): Promise<void>;
  revokeAllSessions(userId: string): Promise<void>;
}

/**
 * AdminEdgeBase-shaped context object injected as context.admin.
 *
 * Matches the external AdminEdgeBase API surface — table, storage, auth, sql, broadcast.
 * Built internally via HTTP fetch to the current Worker URL (no @edge-base/sdk import needed).
 */
export interface FunctionAdminContext {
  /** Cross-DO table access — rules bypassed, Service Key authenticated. */
  table(name: string): TableRef;
  /**
   * Access a specific DB namespace instance (§5).
   * Uses the same TableRef from @edge-base/core as the client SDK,
   * ensuring API parity (getList, getOne, where, orderBy, limit, etc.).
   *
   * @example
   * // Static DB
   * context.admin.db('shared').table('posts').getList()
   * // Dynamic DB (tenant/user)
   * context.admin.db('workspace', 'ws-456').table('documents').getList()
   * // With query builder
   * context.admin.db('shared').table('posts').where('status', '==', 'published').limit(10).getList()
   */
  db(namespace: string, id?: string): DbRef;
  /** Admin user management. */
  auth: AdminAuthContext;
  /**
   * Execute raw SQL with direct D1/DO binding access — no HTTP round-trip.
   * Routes directly to D1 binding or Durable Object without network overhead.
   *
   * @example
   * const rows = await ctx.admin.sqlWithDirectD1Access('shared', undefined, 'SELECT * FROM posts WHERE status = ?', ['published']);
   */
  sqlWithDirectD1Access(
    namespace: string,
    id: string | undefined,
    query: string,
    params?: unknown[],
  ): Promise<unknown[]>;
  /** Server-side broadcast to a database-live channel. */
  broadcast(channel: string, event: string, payload?: Record<string, unknown>): Promise<void>;
  /** Inter-function calls. Calls another registered function by name. */
  functions: {
    call(name: string, data?: unknown): Promise<unknown>;
  };
  /** Access a user-defined KV namespace. */
  kv(namespace: string): FunctionKvProxy;
  /** Access a user-defined D1 database. */
  d1(database: string): FunctionD1Proxy;
  /** Access a user-defined Vectorize index. */
  vector(index: string): FunctionVectorizeProxy;
  /** Push notification management. */
  push: FunctionPushProxy;
}

/** Push notification proxy — routes through Worker HTTP. */
export interface FunctionPushProxy {
  /** Send a push notification to a single user's devices. */
  send(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<{ sent: number; failed: number; removed: number }>;
  /** Send push notifications to multiple users (no limit — server chunks internally at 500). */
  sendMany(
    userIds: string[],
    payload: Record<string, unknown>,
  ): Promise<{ sent: number; failed: number; removed: number }>;
  /** Get registered device tokens for a user — token values NOT exposed. */
  getTokens(
    userId: string,
  ): Promise<
    Array<{
      deviceId: string;
      platform: string;
      updatedAt: string;
      deviceInfo?: Record<string, string>;
      metadata?: Record<string, unknown>;
    }>
  >;
  /** Get push send logs for a user (last 24h,). */
  getLogs(
    userId: string,
    limit?: number,
  ): Promise<
    Array<{
      sentAt: string;
      userId: string;
      platform: string;
      status: string;
      collapseId?: string;
      error?: string;
    }>
  >;
  /** Send push directly using an FCM token (bypasses KV storage). Service Key only. */
  sendToToken(
    token: string,
    payload: Record<string, unknown>,
    platform?: string,
  ): Promise<{ sent: number; failed: number; error?: string }>;
  /** Send to an FCM topic. Service Key only. */
  sendToTopic(
    topic: string,
    payload: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }>;
  /** Broadcast to all devices via /topics/all. Service Key only. */
  broadcast(payload: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
}

/** Storage proxy for App Functions — wraps R2Bucket with convenience methods. */
export interface FunctionStorageProxy {
  put(key: string, value: ReadableStream | ArrayBuffer | string, options?: { contentType?: string; customMetadata?: Record<string, string> }): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream; contentType: string; size: number; customMetadata: Record<string, string> } | null>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, options?: { expiresIn?: number }): Promise<string>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: Array<{ key: string; size: number; contentType: string }>; cursor?: string; truncated: boolean }>;
  head(key: string): Promise<{ key: string; size: number; contentType: string; customMetadata: Record<string, string> } | null>;
}

/** KV proxy for App Functions — routes through Worker HTTP. */
export interface FunctionKvProxy {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ttl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ keys: string[]; cursor?: string }>;
}

/** D1 proxy for App Functions — routes through Worker HTTP. */
export interface FunctionD1Proxy {
  exec<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>;
}

/** Vectorize proxy for App Functions — routes through Worker HTTP. */
export interface FunctionVectorizeProxy {
  upsert(
    vectors: Array<{
      id: string;
      values: number[];
      metadata?: Record<string, unknown>;
      namespace?: string;
    }>,
  ): Promise<{ ok: true; count?: number; mutationId?: string }>;
  insert(
    vectors: Array<{
      id: string;
      values: number[];
      metadata?: Record<string, unknown>;
      namespace?: string;
    }>,
  ): Promise<{ ok: true; count?: number; mutationId?: string }>;
  search(
    vector: number[],
    options?: {
      topK?: number;
      filter?: Record<string, unknown>;
      namespace?: string;
      returnValues?: boolean;
      returnMetadata?: boolean | 'all' | 'indexed' | 'none';
    },
  ): Promise<
    Array<{
      id: string;
      score: number;
      values?: number[];
      metadata?: Record<string, unknown>;
      namespace?: string;
    }>
  >;
  queryById(
    vectorId: string,
    options?: {
      topK?: number;
      filter?: Record<string, unknown>;
      namespace?: string;
      returnValues?: boolean;
      returnMetadata?: boolean | 'all' | 'indexed' | 'none';
    },
  ): Promise<
    Array<{
      id: string;
      score: number;
      values?: number[];
      metadata?: Record<string, unknown>;
      namespace?: string;
    }>
  >;
  getByIds(
    ids: string[],
  ): Promise<
    Array<{ id: string; values?: number[]; metadata?: Record<string, unknown>; namespace?: string }>
  >;
  delete(ids: string[]): Promise<{ ok: true; count?: number; mutationId?: string }>;
  describe(): Promise<{
    vectorCount: number;
    dimensions: number;
    metric: string;
    id?: string;
    name?: string;
    processedUpToDatetime?: string;
    processedUpToMutation?: string;
  }>;
}

/**
 * App Function execution context.
 * §5: legacy top-level auth helpers removed. Use `context.admin.db(namespace, id?)`
 * and `context.admin.auth` exclusively.
 */
export interface FunctionContext {
  request: Request;
  auth: AuthContext | null;
  /**
   * Convenience shortcut to `admin.db()`.
   * Access database tables directly without going through `admin`.
   *
   * @example
   * // Static DB
   * await context.db('shared').table('posts').getList()
   * // Dynamic DB
   * await context.db('workspace', 'ws-456').table('documents').getList()
   * // With query builder
   * await context.db('shared').table('posts').where('status', '==', 'published').limit(10).getList()
   */
  db: FunctionAdminContext['db'];
  /**
   * Server-side EdgeBase admin client (§5).
   * Use context.admin.db(namespace, id?).table(name) for all DB access.
   * Uses the same TableRef from @edge-base/core as the client SDK.
   *
   * @example
   * await context.admin.db('shared').table('posts').getList()
   * await context.admin.db('shared').table('posts').where('userId', '==', uid).getList()
   */
  admin: FunctionAdminContext;
  /**
   * URL path parameters extracted from file-system routing.
   * For dynamic routes like `functions/users/[userId]/posts/[postId].ts`,
   * params will contain `{ userId: '...', postId: '...' }`.
   *
   * @example
   * // functions/users/[userId].ts → GET /api/functions/users/abc123
   * context.params.userId // 'abc123'
   */
  params: Record<string, string>;
  /**
   * Trigger metadata (§5).
   * For DB triggers: namespace + id of the DO that fired the trigger.
   * For schedule/http/auth triggers: namespace and id are undefined.
   */
  trigger?: {
    namespace: string;
    id?: string;
    /** DB trigger: table name. */
    table?: string;
    /** DB trigger: event type. */
    event?: 'insert' | 'update' | 'delete';
  };
  data?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  storage?: FunctionStorageProxy; // Available when R2 binding present
  analytics?: unknown; // AnalyticsAdapter when ANALYTICS_APP binding present
  /** Plugin-specific config from edgebase.config.ts plugins section. */
  pluginConfig?: Record<string, unknown>;
}

// ─── Function Registry ───

/**
 * In-memory function registry.
 * Populated at Worker startup from bundled config.
 * Key: function name or function name + HTTP method, Value: FunctionDefinition.
 */
const functionRegistry = new Map<string, FunctionDefinition>();

const HTTP_REGISTRY_SEPARATOR = '::';

function buildRegistryKey(name: string, def: FunctionDefinition): string {
  if (def.trigger.type !== 'http') return name;
  const trigger = def.trigger as unknown as { method?: string };
  const method = (trigger.method || '*').toUpperCase();
  return `${name}${HTTP_REGISTRY_SEPARATOR}${method}`;
}

function getRegistryName(key: string, def: FunctionDefinition): string {
  if (def.trigger.type !== 'http') return key;
  const separatorIndex = key.lastIndexOf(HTTP_REGISTRY_SEPARATOR);
  return separatorIndex === -1 ? key : key.slice(0, separatorIndex);
}

export function registerFunction(name: string, def: FunctionDefinition): void {
  if (!def || typeof def !== 'object' || !def.trigger) {
    const received = typeof def === 'function'
      ? 'a plain function'
      : `${typeof def} (${JSON.stringify(def)?.slice(0, 100)})`;
    throw new Error(
      `registerFunction('${name}'): expected a FunctionDefinition with a 'trigger' property, but received ${received}. ` +
      `Functions must use defineFunction() from '@edge-base/shared' and be exported as named HTTP method exports ` +
      `(e.g. export const GET = defineFunction(...)). See https://docs.edgebase.dev/functions for details.`,
    );
  }
  functionRegistry.set(buildRegistryKey(name, def), def);
}

export function getRegisteredFunctions(): Map<string, FunctionDefinition> {
  return functionRegistry;
}

/** Clear all registered functions — used for test isolation. */
export function clearFunctionRegistry(): void {
  functionRegistry.clear();
}

export function getFunctionsByTrigger(
  type: FunctionTrigger['type'],
  match?: Partial<DbTrigger | AuthTrigger | StorageTrigger | ScheduleTrigger | HttpTrigger>,
): Array<{ name: string; definition: FunctionDefinition }> {
  const results: Array<{ name: string; definition: FunctionDefinition }> = [];
  for (const [key, def] of functionRegistry) {
    if (def.trigger.type !== type) continue;
    const name = getRegistryName(key, def);
    if (match) {
      let matched = true;
      for (const [key, value] of Object.entries(match)) {
        if (key === 'type') continue;
        if ((def.trigger as unknown as Record<string, unknown>)[key] !== value) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
    }
    results.push({ name, definition: def });
  }
  return results;
}

// ─── Route Pattern Matching (File-System Routing) ───

interface CompiledRoute {
  name: string;
  /** Matched HTTP path relative to /api/functions (trigger.path or route name). */
  path: string;
  definition: FunctionDefinition;
  /** HTTP method constraint — null means any method */
  method: string | null;
  /** Regex pattern for matching URL paths */
  pattern: RegExp;
  /** Ordered param names extracted from pattern */
  paramNames: string[];
  /** Whether this route has dynamic segments */
  isDynamic: boolean;
  /** Specificity score for ordering (higher = more specific) */
  specificity: number;
}

const compiledRoutes: CompiledRoute[] = [];

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeHttpRoutePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '';
  return trimmed.replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * Compile a route name (e.g., 'users/[userId]/posts/[postId]') into a regex pattern.
 */
function compileRoutePattern(name: string): {
  pattern: RegExp;
  paramNames: string[];
  isDynamic: boolean;
} {
  const paramNames: string[] = [];
  let isDynamic = false;

  if (name === '' || name === '/') {
    return { pattern: /^$/, paramNames: [], isDynamic: false };
  }

  const segments = name.split('/');
  const regexParts: string[] = [];

  for (const segment of segments) {
    // Catch-all: [...slug]
    const catchAllMatch = segment.match(/^\[\.\.\.([^\]]+)\]$/);
    if (catchAllMatch) {
      paramNames.push(catchAllMatch[1]);
      regexParts.push('(.+)');
      isDynamic = true;
      continue;
    }

    // Dynamic param: [userId]
    const paramMatch = segment.match(/^\[([^\]]+)\]$/);
    if (paramMatch) {
      paramNames.push(paramMatch[1]);
      regexParts.push('([^/]+)');
      isDynamic = true;
      continue;
    }

    // Express-style dynamic param in custom trigger.path: :userId
    const colonParamMatch = segment.match(/^:([^/]+)$/);
    if (colonParamMatch) {
      paramNames.push(colonParamMatch[1]);
      regexParts.push('([^/]+)');
      isDynamic = true;
      continue;
    }

    // Static segment
    regexParts.push(escapeRegex(segment));
  }

  const pattern = new RegExp(`^${regexParts.join('/')}$`);
  return { pattern, paramNames, isDynamic };
}

/**
 * Calculate route specificity for ordering.
 * Static segments score higher than dynamic ones. More segments = higher score.
 */
function calculateSpecificity(name: string): number {
  if (name === '' || name === '/') return 0;
  const segments = name.split('/');
  let score = segments.length * 100;
  for (const seg of segments) {
    if (seg.match(/^\[\.\.\.([^\]]+)\]$/)) {
      score -= 50; // Catch-all is least specific
    } else if (seg.match(/^\[([^\]]+)\]$/)) {
      score -= 10; // Dynamic param
    } else {
      score += 10; // Static segment bonus
    }
  }
  return score;
}

/**
 * Rebuild compiled routes from the function registry.
 * Must be called after all functions are registered (after initFunctionRegistry()).
 */
export function rebuildCompiledRoutes(): void {
  compiledRoutes.length = 0;
  const seenRoutes = new Map<string, string>();

  for (const [key, def] of functionRegistry) {
    if (def.trigger.type !== 'http') continue;
    const name = getRegistryName(key, def);

    const trigger = def.trigger as unknown as { type: string; method?: string; path?: string };
    const routePath = normalizeHttpRoutePath(trigger.path ?? name);
    const { pattern, paramNames, isDynamic } = compileRoutePattern(routePath);
    const routeKey = `${(trigger.method || '*').toUpperCase()}:${pattern.source}`;
    const previous = seenRoutes.get(routeKey);
    if (previous) {
      throw new Error(
        `HTTP route collision: '${name}' and '${previous}' both resolve to ` +
          `'/${routePath || ''}' for method ${(trigger.method || '*').toUpperCase()}.`,
      );
    }
    seenRoutes.set(routeKey, name);

    compiledRoutes.push({
      name,
      path: routePath,
      definition: def,
      method: trigger.method || null,
      pattern,
      paramNames,
      isDynamic,
      specificity: calculateSpecificity(routePath),
    });
  }

  // Sort by specificity (most specific first)
  compiledRoutes.sort((a, b) => b.specificity - a.specificity);
}

/**
 * Match a request path against compiled routes.
 * Returns the matched route and extracted params, or null if no match.
 */
export function matchRoute(
  path: string,
  method: string,
): { route: CompiledRoute; params: Record<string, string> } | null {
  for (const route of compiledRoutes) {
    // Method check (skip if method doesn't match)
    if (route.method && route.method.toUpperCase() !== method.toUpperCase()) continue;

    const match = route.pattern.exec(path);
    if (!match) continue;

    // Extract params
    const params: Record<string, string> = {};
    for (let i = 0; i < route.paramNames.length; i++) {
      params[route.paramNames[i]] = decodeURIComponent(match[i + 1]);
    }

    return { route, params };
  }

  return null;
}

/**
 * Check if a route exists for a given path (any method).
 * Used for 405 detection.
 */
export function routeExistsForPath(path: string): boolean {
  for (const route of compiledRoutes) {
    if (route.pattern.test(path)) return true;
  }
  return false;
}

// ─── Middleware Registry ───

const middlewareRegistry = new Map<string, (context: unknown) => Promise<unknown>>();

/**
 * Register a directory middleware handler.
 * @param dirPath Directory path relative to functions/ (empty string = root)
 * @param handler Middleware handler (default export)
 */
export function registerMiddleware(
  dirPath: string,
  handler: { default?: (ctx: unknown) => Promise<unknown> } | ((ctx: unknown) => Promise<unknown>),
): void {
  const fn =
    typeof handler === 'function'
      ? handler
      : ((handler.default ?? handler) as (ctx: unknown) => Promise<unknown>);
  middlewareRegistry.set(dirPath, fn);
}

/** Clear middleware registry — used for test isolation. */
export function clearMiddlewareRegistry(): void {
  middlewareRegistry.clear();
}

/**
 * Get middleware chain for a given function path.
 * Returns middlewares ordered from root to most specific directory.
 *
 * Example: for function 'admin/users/[userId]':
 *   1. middleware at '' (root)
 *   2. middleware at 'admin'
 *   3. middleware at 'admin/users'
 */
export function getMiddlewareChain(
  functionName: string,
): Array<(context: unknown) => Promise<unknown>> {
  const chain: Array<(context: unknown) => Promise<unknown>> = [];

  // Check root middleware
  const rootMw = middlewareRegistry.get('');
  if (rootMw) chain.push(rootMw);

  // Check each directory level
  if (functionName) {
    const parts = functionName.split('/');
    let dirPath = '';
    // Iterate directory parts (all segments except the last, which is the file)
    for (let i = 0; i < parts.length - 1; i++) {
      dirPath = dirPath ? `${dirPath}/${parts[i]}` : parts[i];
      const mw = middlewareRegistry.get(dirPath);
      if (mw) chain.push(mw);
    }
  }

  return chain;
}

/**
 * Wrap a method-export handler (from named export like GET, POST) into a FunctionDefinition.
 * Called by generated registry code.
 */
export function wrapMethodExport(
  handler:
    | FunctionDefinition
    | {
        handler?: (ctx: unknown) => Promise<unknown>;
        captcha?: boolean;
        trigger?: { path?: string };
      }
    | ((ctx: unknown) => Promise<unknown>),
  method: string,
  runtimeTrigger?: { path?: string },
): FunctionDefinition {
  // handler can be: raw function, or { handler, captcha? } from defineFunction()
  let fn: (ctx: unknown) => Promise<unknown>;
  let captcha: boolean | undefined;
  let path: string | undefined;

  if (typeof handler === 'function') {
    fn = handler;
  } else if (handler && typeof handler === 'object') {
    fn = (handler.handler ?? handler) as unknown as (ctx: unknown) => Promise<unknown>;
    captcha = handler.captcha;
    if ('trigger' in handler && handler.trigger && typeof handler.trigger === 'object' && 'path' in handler.trigger) {
      const triggerPath = handler.trigger.path;
      path = typeof triggerPath === 'string' ? triggerPath : undefined;
    }
  } else {
    fn = handler as (ctx: unknown) => Promise<unknown>;
  }

  return {
    trigger: {
      type: 'http',
      method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      ...(runtimeTrigger?.path ? { path: runtimeTrigger.path } : path ? { path } : {}),
    },
    captcha,
    handler: fn,
  };
}

// ─── Admin DB Proxy (uses @edge-base/core TableRef via InternalHttpTransport) ───

interface BuildAdminDbProxyOptions {
  databaseNamespace: DurableObjectNamespace;
  config: EdgeBaseConfig;
  workerUrl?: string;
  serviceKey?: string;
  env?: Env;
  executionCtx?: ExecutionContext;
  preferDirectDo?: boolean;
}

// ─── Shared SQL executor — D1 direct → DO direct → HTTP fallback ───

export interface SqlWithDirectD1AccessOptions {
  env?: unknown;
  config: EdgeBaseConfig;
  databaseNamespace?: DurableObjectNamespace;
  workerUrl?: string;
  serviceKey?: string;
}

/**
 * Execute raw SQL with the fastest available path:
 * 1. D1 direct binding (no network hop)
 * 2. Durable Object direct call
 * 3. HTTP fallback via workerUrl
 *
 * Shared by buildFunctionContext, auth hooks, and storage hooks.
 */
export async function executeSqlWithDirectD1Access(
  opts: SqlWithDirectD1AccessOptions,
  namespace: string,
  id: string | undefined,
  query: string,
  params?: unknown[],
): Promise<unknown[]> {
  if (opts.env) {
    const dbBlock = opts.config.databases?.[namespace];
    const isDynamicNamespace = !!(dbBlock?.instance || dbBlock?.access?.canCreate || dbBlock?.access?.access);
    if (isDynamicNamespace && !id) {
      throw new Error(`admin.sqlWithDirectD1Access() requires an id for dynamic namespace '${namespace}'.`);
    }

    if (!id && shouldRouteToD1(namespace, opts.config)) {
      const bindingName = getD1BindingName(namespace);
      const d1 = (opts.env as Record<string, unknown>)[bindingName] as D1Database | undefined;
      if (!d1) {
        throw new Error(`D1 binding '${bindingName}' not found.`);
      }
      try {
        const stmt = d1.prepare(query);
        const bound = params && params.length > 0 ? stmt.bind(...params) : stmt;
        const result = await bound.all();
        return (result.results ?? []) as unknown[];
      } catch (error) {
        const message = error instanceof Error ? error.message : 'SQL execution failed';
        throw new Error(message);
      }
    }

    if (opts.databaseNamespace) {
      return executeDoSql({
        databaseNamespace: opts.databaseNamespace,
        namespace,
        id,
        query,
        params: params ?? [],
        internal: true,
      });
    }
  }

  if (opts.workerUrl && opts.serviceKey) {
    const res = await fetch(`${opts.workerUrl}/api/sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': opts.serviceKey,
      },
      body: JSON.stringify({ namespace, id, sql: query, params: params ?? [] }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: 'SQL execution failed' }))) as { message: string };
      throw new Error(err.message);
    }
    const data = (await res.json()) as { rows?: unknown[]; items?: unknown[]; results?: unknown[] };
    if (Array.isArray(data.rows)) return data.rows;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.results)) return data.results;
    return [];
  }

  throw new Error(
    'admin.sqlWithDirectD1Access() requires env or workerUrl.',
  );
}

/**
 * Build the admin DB proxy that returns real DbRef/TableRef instances
 * from @edge-base/core, routed through InternalHttpTransport for
 * direct D1/PG/DO access (no HTTP round-trip).
 */
export function buildAdminDbProxy(options: BuildAdminDbProxyOptions): FunctionAdminContext['db'] {
  // Create HttpClient for sql() tagged template support on TableRef.
  // Only available when workerUrl is set (routes through /api/sql endpoint).
  let httpClient: HttpClient | undefined;
  if (options.workerUrl) {
    httpClient = new HttpClient({
      baseUrl: options.workerUrl,
      serviceKey: options.serviceKey,
      contextManager: new ContextManager(),
    });
  }

  return (namespace: string, id?: string): DbRef => {
    // Create a per-DbRef transport with explicit dbContext so that
    // path parsing is unambiguous even when instanceId === 'tables'.
    const transport = new InternalHttpTransport({
      databaseNamespace: options.databaseNamespace,
      config: options.config,
      workerUrl: options.workerUrl,
      serviceKey: options.serviceKey,
      env: options.env,
      executionCtx: options.executionCtx,
      preferDirectDo: options.preferDirectDo,
      dbContext: { namespace, instanceId: id },
    });
    const dbApi = new DefaultDbApi(transport);
    return new DbRef(
      dbApi,
      namespace,
      id,
      undefined,   // databaseLiveClient — not available server-side
      undefined,   // filterMatchFn
      httpClient,  // enables table().sql`...` tagged template
    );
  };
}

// ─── AdminAuth Context Builder ───

interface AdminAuthOptions {
  authNamespace?: DurableObjectNamespace; // kept for interface compatibility, no longer used
  databaseNamespace?: DurableObjectNamespace;
  d1Database?: D1Database;
  serviceKey?: string;
  /** Worker origin URL — enables createUser via HTTP relay. */
  workerUrl?: string;
  /** KV namespace — used to clean up push tokens on user deletion. */
  kvNamespace?: KVNamespace;
}

/**
 * Build admin auth context for App Functions.
 * Uses AUTH_DB D1 directly for all operations (D1-first architecture).
 * Cross-shard operations (listUsers) also available via Worker HTTP relay
 * when workerUrl is provided.
 */
export function buildAdminAuthContext(options: AdminAuthOptions): AdminAuthContext {
  const { d1Database, serviceKey, workerUrl, kvNamespace } = options;

  /** Ensure AUTH_DB is available, or throw a clear error. */
  const requireAuthDb = (op: string): AuthDb => {
    if (!d1Database) {
      throw new Error(
        `admin.auth.${op}() requires AUTH_DB D1. ` +
          'Not available in this context — use the Admin API or SDK.',
      );
    }
    return new D1AuthDb(d1Database);
  };

  return {
    async getUser(userId: string): Promise<Record<string, unknown>> {
      const db = requireAuthDb('getUser');
      const user = await authService.getUserById(db, userId);
      if (!user) throw new Error(`User not found: ${userId}`);
      return authService.sanitizeUser(user, { includeAppMetadata: true });
    },

    async listUsers(opts?: {
      limit?: number;
      cursor?: string;
    }): Promise<{ users: Record<string, unknown>[]; cursor?: string }> {
      if (d1Database) {
        const authDb = new D1AuthDb(d1Database);
        const limit = opts?.limit ?? 100;
        const offset = opts?.cursor ? parseInt(opts.cursor, 10) : 0;
        const result = await authService.listUsers(authDb, limit, offset);
        const nextOffset = offset + limit;
        return {
          users: result.users.map((u) => authService.sanitizeUser(u, { includeAppMetadata: true })),
          cursor: nextOffset < result.total ? String(nextOffset) : undefined,
        };
      }
      if (workerUrl && serviceKey) {
        // HTTP relay fallback: GET /api/auth/admin/users → Worker → D1
        const params = new URLSearchParams();
        if (opts?.limit) params.set('limit', String(opts.limit));
        if (opts?.cursor) params.set('cursor', opts.cursor);
        const qs = params.toString();
        const res = await fetch(`${workerUrl}/api/auth/admin/users${qs ? `?${qs}` : ''}`, {
          method: 'GET',
          headers: { 'X-EdgeBase-Service-Key': serviceKey },
        });
        if (!res.ok) throw new Error(`admin.auth.listUsers() relay failed: ${res.status}`);
        return res.json() as Promise<{ users: Record<string, unknown>[]; cursor?: string }>;
      }
      throw new Error(
        'admin.auth.listUsers() is not available in this context (requires D1 or workerUrl). ' +
          'Pass workerUrl to buildFunctionContext(), or use the external SDK.',
      );
    },

    async createUser(data: {
      email: string;
      password: string;
      displayName?: string;
      role?: string;
    }): Promise<Record<string, unknown>> {
      // Direct D1 path — works without service key (same as updateUser/deleteUser)
      if (d1Database) {
        // Input validation (mirrors routes/admin-auth.ts guards)
        if (!data.email || typeof data.email !== 'string') throw new Error('Email and password are required.');
        if (!data.password || typeof data.password !== 'string') throw new Error('Email and password are required.');
        const email = data.email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new Error('Invalid email format.');
        }
        if (data.password.length < 8) throw new Error('Password must be at least 8 characters.');
        if (data.password.length > 256) throw new Error('Password must not exceed 256 characters.');
        if (data.displayName && data.displayName.length > 200) {
          throw new Error('Display name must not exceed 200 characters.');
        }
        // Role validation (mirrors normalizeOptionalRole in routes/admin-auth.ts)
        let role = 'user';
        if (data.role !== undefined) {
          if (typeof data.role !== 'string') throw new Error('Role must be a non-empty string.');
          const trimmed = data.role.trim();
          if (!trimmed) throw new Error('Role must be a non-empty string.');
          if (trimmed.length > 100) throw new Error('Role must not exceed 100 characters.');
          role = trimmed;
        }

        const db = new D1AuthDb(d1Database);
        // Ensure auth tables exist (critical for fresh databases)
        await ensureAuthSchema(db);
        const user = await createManagedAdminUser(
          db,
          {
            userId: generateId(),
            email,
            passwordHash: await hashPassword(data.password),
            displayName: data.displayName,
            role,
            verified: true,
          },
          { kv: kvNamespace },
        );
        return authService.sanitizeUser(user, { includeAppMetadata: true });
      }
      if (workerUrl && serviceKey) {
        // HTTP relay fallback: POST /api/auth/admin/users → Worker → D1
        const res = await fetch(`${workerUrl}/api/auth/admin/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-EdgeBase-Service-Key': serviceKey,
          },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({ message: 'createUser failed' }))) as {
            message: string;
          };
          throw new Error(err.message);
        }
        const result = (await res.json()) as { user: Record<string, unknown> };
        return result.user;
      }
      throw new Error(
        'admin.auth.createUser() is not available in this context (requires D1 or workerUrl). ' +
          'Pass workerUrl to buildFunctionContext(), or use the external SDK.',
      );
    },

    async updateUser(
      userId: string,
      data: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const db = requireAuthDb('updateUser');
      const updates = await normalizeAdminUserUpdates(data);
      const user = await updateManagedAdminUser(db, userId, updates as Record<string, unknown>, {
        kv: kvNamespace,
      });
      if (!user) throw new Error(`admin.auth.updateUser failed: user not found`);
      return authService.sanitizeUser(user, { includeAppMetadata: true });
    },

    async deleteUser(userId: string): Promise<void> {
      const db = requireAuthDb('deleteUser');
      const deleted = await deleteManagedAdminUser(db, userId, {
        kv: kvNamespace,
      });
      if (!deleted) {
        throw new Error(`admin.auth.deleteUser failed: user not found`);
      }
    },

    async setCustomClaims(userId: string, claims: Record<string, unknown>): Promise<void> {
      const db = requireAuthDb('setCustomClaims');
      await authService.updateUser(db, userId, {
        customClaims: JSON.stringify(claims),
      });
    },

    async revokeAllSessions(userId: string): Promise<void> {
      const db = requireAuthDb('revokeAllSessions');
      await authService.deleteAllUserSessions(db, userId);
    },
  };
}

// ─── Full Function Context Builder ───

export interface BuildFunctionContextOptions {
  request: Request;
  auth: AuthContext | null;
  databaseNamespace: DurableObjectNamespace;
  authNamespace: DurableObjectNamespace;
  d1Database?: D1Database;
  config: EdgeBaseConfig;
  serviceKey?: string;
  storage?: unknown;
  analytics?: unknown;
  data?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
  /** KV namespace — used to clean up push tokens on user deletion. */
  kvNamespace?: KVNamespace;
  env?: Env;
  executionCtx?: ExecutionContext;
  /**
   * Worker origin URL for context.admin internal HTTP transport.
   */
  workerUrl?: string;
  /** Current call depth for inter-function calls. */
  callDepth?: number;
  /** Plugin name — when set, injects pluginConfig from config.plugins[pluginName]. */
  pluginName?: string;
  /**
   * Trigger origin (§5).
   * For DB triggers: the DO's namespace and id that fired the trigger.
   */
  triggerInfo?: {
    namespace: string;
    id?: string;
    table?: string;
    event?: 'insert' | 'update' | 'delete';
  };
  /** URL path parameters extracted from file-system routing (e.g., { userId: '...' }). */
  params?: Record<string, string>;
  /**
   * Force admin.db() to stay on direct Durable Object transport.
   * Used by RoomsDO handlers that already execute inside a DO.
   */
  preferDirectDoDb?: boolean;
}

export function buildFunctionContext(options: BuildFunctionContextOptions): FunctionContext {
  const adminAuthContext = buildAdminAuthContext({
    authNamespace: options.authNamespace,
    databaseNamespace: options.databaseNamespace,
    d1Database: options.d1Database,
    serviceKey: options.serviceKey,
    workerUrl: options.workerUrl, // enables listUsers/createUser HTTP relay
    kvNamespace: options.kvNamespace,
  });
  const adminDb = buildAdminDbProxy({
    databaseNamespace: options.databaseNamespace,
    config: options.config,
    workerUrl: options.workerUrl,
    serviceKey: options.serviceKey,
    env: options.env,
    executionCtx: options.executionCtx,
    preferDirectDo: options.preferDirectDoDb,
  });

  // ─── context.admin — AdminEdgeBase-shaped internal proxy ───
  const admin: FunctionAdminContext = {
    table: (name: string) => adminDb('shared').table(name),

    // ─── context.admin.db(namespace, id) — DB-first tenant access (§5) ───
    db: adminDb,
    auth: adminAuthContext,
    // ─── Direct D1/DO SQL — delegates to shared executor ───
    sqlWithDirectD1Access: (namespace: string, id: string | undefined, query: string, params?: unknown[]) =>
      executeSqlWithDirectD1Access(
        {
          env: options.env,
          config: options.config,
          databaseNamespace: options.databaseNamespace,
          workerUrl: options.workerUrl,
          serviceKey: options.serviceKey,
        },
        namespace, id, query, params,
      ),
    async broadcast(
      channel: string,
      event: string,
      payload?: Record<string, unknown>,
    ): Promise<void> {
      if (options.env?.DATABASE_LIVE) {
        const hubId = options.env.DATABASE_LIVE.idFromName('database-live:hub');
        const stub = options.env.DATABASE_LIVE.get(hubId);
        const response = await stub.fetch(new Request('http://do/internal/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel, event, payload: payload ?? {} }),
        }));
        if (!response.ok) {
          throw new Error(`client.broadcast() failed: ${response.status}`);
        }
        return;
      }
      if (options.workerUrl && options.serviceKey) {
        // HTTP route: POST /api/db/broadcast → Worker → DatabaseLiveDO
        const res = await fetch(`${options.workerUrl}/api/db/broadcast`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-EdgeBase-Service-Key': options.serviceKey,
          },
          body: JSON.stringify({ channel, event, payload: payload ?? {} }),
        });
        if (!res.ok) throw new Error(`client.broadcast() failed: ${res.status}`);
        return;
      }
      throw new Error(
        'admin.broadcast() requires workerUrl. Pass workerUrl to buildFunctionContext().',
      );
    },

    // Inter-function calls
    functions: {
      async call(name: string, data?: unknown): Promise<unknown> {
        const MAX_CALL_DEPTH = 5;
        const currentDepth = options.callDepth ?? 0;
        if (currentDepth >= MAX_CALL_DEPTH) {
          throw new Error(
            `Function call depth exceeded (max ${MAX_CALL_DEPTH}). Possible circular call: ${name}`,
          );
        }

        if (options.env) {
          const matched = matchRoute(name, 'POST');
          if (!matched) {
            throw new Error(`Function call '${name}' failed`);
          }

          const safeName = name.split('/').map(encodeURIComponent).join('/');
          const nestedRequest = new Request(
            `${options.workerUrl ?? 'http://internal'}/api/functions/${safeName}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(options.serviceKey
                  ? { 'X-EdgeBase-Service-Key': options.serviceKey }
                  : {}),
                'X-EdgeBase-Call-Depth': String(currentDepth + 1),
              },
              body: JSON.stringify(data ?? {}),
            },
          );
          const nestedCtx = buildFunctionContext({
            ...options,
            request: nestedRequest,
            params: matched.params,
            callDepth: currentDepth + 1,
          });

          const middlewares = getMiddlewareChain(matched.route.name);
          for (const middleware of middlewares) {
            await middleware(nestedCtx);
          }

          const result = await matched.route.definition.handler(nestedCtx);
          if (result instanceof Response) {
            if (result.status === 204) return null;
            const contentType = result.headers.get('content-type') ?? '';
            if (contentType.includes('application/json')) {
              return result.json();
            }
            return result.text();
          }
          return result ?? null;
        }

        if (options.workerUrl && options.serviceKey) {
          // HTTP route: POST /api/functions/{name} → Worker → function handler
          const safeName = name.split('/').map(encodeURIComponent).join('/');
          const res = await fetch(`${options.workerUrl}/api/functions/${safeName}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-EdgeBase-Service-Key': options.serviceKey,
              'X-EdgeBase-Call-Depth': String(currentDepth + 1),
            },
            body: JSON.stringify(data ?? {}),
          });
          if (!res.ok) {
            const err = (await res
              .json()
              .catch(() => ({ message: `Function call '${name}' failed` }))) as { message: string };
            throw new Error(err.message);
          }
          return res.json();
        }
        throw new Error(
          'admin.functions.call() requires workerUrl. Pass workerUrl to buildFunctionContext().',
        );
      },
    },

    // KV / D1 / Vectorize proxies
    kv(namespace: string): FunctionKvProxy {
      return buildFunctionKvProxy(namespace, options.config, options.env, options.workerUrl, options.serviceKey);
    },
    d1(database: string): FunctionD1Proxy {
      return buildFunctionD1Proxy(database, options.config, options.env, options.workerUrl, options.serviceKey);
    },
    vector(index: string): FunctionVectorizeProxy {
      return buildFunctionVectorizeProxy(index, options.config, options.env, options.workerUrl, options.serviceKey);
    },

    // Push notification management
    push: buildFunctionPushProxy(options.workerUrl, options.serviceKey),
  };

  const ctx: FunctionContext = {
    request: options.request,
    auth: options.auth,
    db: admin.db,
    admin,
    params: options.params ?? {},
  };

  if (options.data) ctx.data = options.data;

  // Storage injection — use provided proxy or auto-build from R2 binding
  if (options.storage !== undefined && options.storage !== null) {
    ctx.storage = options.storage as FunctionStorageProxy;
  } else if (options.env && (options.env as unknown as Record<string, unknown>).STORAGE) {
    ctx.storage = buildFunctionStorageProxy(
      (options.env as unknown as Record<string, unknown>).STORAGE as R2Bucket,
      'default',
      options.env,
      options.workerUrl,
    );
  }

  // Analytics injection — optional
  if (options.analytics !== undefined) {
    ctx.analytics = options.analytics;
  }

  // Plugin config injection
  if (options.pluginName && options.config.plugins) {
    const matchedPlugin = options.config.plugins.find((p) => p.name === options.pluginName);
    if (matchedPlugin) {
      ctx.pluginConfig = matchedPlugin.config;
    }
  }

  if (options.triggerInfo) ctx.trigger = options.triggerInfo;

  return ctx;
}

/**
 * Execute registered DB trigger functions for a given event.
 * Called from DatabaseDO CUD handlers via ctx.waitUntil().
 * Best-effort: errors are logged, never thrown.
 * §5: namespace/id injected as context.trigger for explicit DO access.
 */
export async function executeDbTriggers(
  tableName2: string,
  event: 'insert' | 'update' | 'delete',
  data: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  contextOptions: Omit<BuildFunctionContextOptions, 'data' | 'request' | 'auth'>,
  /** Namespace/id of the DO that fired the trigger (§5). */
  triggerOrigin: { namespace: string; id?: string },
): Promise<void> {
  const functions = getFunctionsByTrigger('db', {
    type: 'db',
    table: tableName2,
    event,
  } as DbTrigger);
  if (functions.length === 0) return;

  const dummyRequest = new Request('http://internal/trigger', { method: 'POST' });

  for (const { name, definition } of functions) {
    try {
      const ctx = buildFunctionContext({
        ...contextOptions,
        request: dummyRequest,
        auth: null,
        data,
        triggerInfo: {
          namespace: triggerOrigin.namespace,
          id: triggerOrigin.id,
          table: tableName2,
          event,
        },
      });
      await definition.handler(ctx);
    } catch (err) {
      // Best-effort — log and continue
      console.error(`[EdgeBase] DB trigger '${name}' (${tableName2}:${event}) failed:`, err);
    }
  }
}

// ─── KV / D1 / Vectorize Proxy Builders ───

function normalizeWorkerUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function readInternalWorkerUrl(
  env?: Pick<Env, 'EDGEBASE_INTERNAL_WORKER_URL'> | Record<string, unknown> | null,
): string | undefined {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return undefined;
  }

  const candidate = (env as Record<string, unknown>).EDGEBASE_INTERNAL_WORKER_URL;
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    return undefined;
  }

  return normalizeWorkerUrl(candidate);
}

/** Extract base URL (protocol + host) from a request URL. Used for self-fetch in hook/migration contexts. */
export function getWorkerUrl(
  requestUrl: string,
  env?: Pick<Env, 'EDGEBASE_INTERNAL_WORKER_URL'> | Record<string, unknown> | null,
): string | undefined {
  const internalWorkerUrl = readInternalWorkerUrl(env);
  if (internalWorkerUrl) {
    return internalWorkerUrl;
  }

  try {
    const u = new URL(requestUrl);
    return normalizeWorkerUrl(`${u.protocol}//${u.host}`);
  } catch {
    return undefined;
  }
}

export function requireWorkerUrl(
  method: string,
  workerUrl?: string,
  serviceKey?: string,
): { url: string; key: string } {
  if (!workerUrl || !serviceKey) {
    throw new Error(
      `admin.${method}() requires workerUrl and serviceKey. Pass them to buildFunctionContext().`,
    );
  }
  return { url: workerUrl, key: serviceKey };
}

export function buildFunctionKvProxy(
  namespace: string,
  config?: EdgeBaseConfig,
  env?: Env,
  workerUrl?: string,
  serviceKey?: string,
): FunctionKvProxy {
  const directBinding = (() => {
    if (!config || !env) return undefined;
    const kvConfig = config.kv?.[namespace];
    if (!kvConfig) return undefined;
    return (env as unknown as Record<string, unknown>)[kvConfig.binding] as KVNamespace | undefined;
  })();

  return {
    async get(key: string): Promise<string | null> {
      if (directBinding) {
        return directBinding.get(key);
      }
      const { url, key: sk } = requireWorkerUrl('kv().get', workerUrl, serviceKey);
      const res = await fetch(`${url}/api/kv/${namespace}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': sk },
        body: JSON.stringify({ action: 'get', key }),
      });
      if (!res.ok) throw new Error(`kv().get() failed: ${res.status}`);
      const data = (await res.json()) as { value: string | null };
      return data.value;
    },
    async set(key: string, value: string, options?: { ttl?: number }): Promise<void> {
      if (directBinding) {
        const putOptions: KVNamespacePutOptions = {};
        if (options?.ttl) putOptions.expirationTtl = options.ttl;
        await directBinding.put(key, value, putOptions);
        return;
      }
      const { url, key: sk } = requireWorkerUrl('kv().set', workerUrl, serviceKey);
      const res = await fetch(`${url}/api/kv/${namespace}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': sk },
        body: JSON.stringify({ action: 'set', key, value, ttl: options?.ttl }),
      });
      if (!res.ok) throw new Error(`kv().set() failed: ${res.status}`);
    },
    async delete(key: string): Promise<void> {
      if (directBinding) {
        await directBinding.delete(key);
        return;
      }
      const { url, key: sk } = requireWorkerUrl('kv().delete', workerUrl, serviceKey);
      const res = await fetch(`${url}/api/kv/${namespace}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': sk },
        body: JSON.stringify({ action: 'delete', key }),
      });
      if (!res.ok) throw new Error(`kv().delete() failed: ${res.status}`);
    },
    async list(options?: {
      prefix?: string;
      limit?: number;
      cursor?: string;
    }): Promise<{ keys: string[]; cursor?: string }> {
      if (directBinding) {
        const result = await directBinding.list({
          prefix: options?.prefix,
          limit: options?.limit,
          cursor: options?.cursor,
        });
        return {
          keys: result.keys.map((entry) => entry.name),
          cursor: result.list_complete ? undefined : result.cursor,
        };
      }
      const { url, key: sk } = requireWorkerUrl('kv().list', workerUrl, serviceKey);
      const res = await fetch(`${url}/api/kv/${namespace}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': sk },
        body: JSON.stringify({ action: 'list', ...options }),
      });
      if (!res.ok) throw new Error(`kv().list() failed: ${res.status}`);
      return res.json() as Promise<{ keys: string[]; cursor?: string }>;
    },
  };
}

export function buildFunctionD1Proxy(
  database: string,
  config?: EdgeBaseConfig,
  env?: Env,
  workerUrl?: string,
  serviceKey?: string,
): FunctionD1Proxy {
  return {
    async exec<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> {
      if (config && env) {
        const bindingName = config.d1?.[database]?.binding
          ?? (database === 'auth' ? 'AUTH_DB' : undefined)
          ?? (database === 'control' ? 'CONTROL_DB' : undefined)
          ?? getD1BindingName(database);
        const binding = (env as unknown as Record<string, unknown>)[bindingName] as D1Database | undefined;
        if (!binding) {
          throw new Error(`D1 binding '${bindingName}' not found.`);
        }
        try {
          const stmt = binding.prepare(query);
          const bound = params && params.length > 0 ? stmt.bind(...params) : stmt;
          const result = await bound.all();
          return (result.results ?? []) as T[];
        } catch (error) {
          const message = error instanceof Error ? error.message : 'D1 query failed';
          throw new Error(message);
        }
      }
      const { url, key: sk } = requireWorkerUrl('d1().exec', workerUrl, serviceKey);
      const res = await fetch(`${url}/api/d1/${database}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': sk },
        body: JSON.stringify({ query, params }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ message: 'D1 query failed' }))) as {
          message: string;
        };
        throw new Error(err.message);
      }
      const data = (await res.json()) as { results: T[] };
      return data.results;
    },
  };
}

export function buildFunctionVectorizeProxy(
  index: string,
  config?: EdgeBaseConfig,
  env?: Env,
  workerUrl?: string,
  serviceKey?: string,
): FunctionVectorizeProxy {
  const VECTOR_BATCH_LIMIT = 20;
  const directBinding = (() => {
    if (!config || !env) return undefined;
    const vectorConfig = config.vectorize?.[index];
    if (!vectorConfig) return undefined;
    const bindingName = vectorConfig.binding ?? `VECTORIZE_${index.toUpperCase()}`;
    return (env as unknown as Record<string, unknown>)[bindingName] as VectorizeIndex | undefined;
  })();

  const normalizeValues = (values: unknown): number[] | undefined => {
    if (values instanceof Float32Array || values instanceof Float64Array) {
      return Array.from(values);
    }
    return Array.isArray(values) ? values as number[] : undefined;
  };

  const mapMatches = (
    matches: Array<{
      id: string;
      score: number;
      values?: unknown;
      metadata?: Record<string, unknown>;
      namespace?: string;
    }>,
  ) => matches.map((match) => ({
    id: match.id,
    score: match.score,
    ...(match.values !== undefined ? { values: normalizeValues(match.values) } : {}),
    ...(match.metadata !== undefined ? { metadata: match.metadata } : {}),
    ...(match.namespace ? { namespace: match.namespace } : {}),
  }));

  const withNamespace = <T extends { namespace?: string }>(vectors: T[], namespace?: string): T[] => {
    if (!namespace) return vectors;
    return vectors.map((vector) => (vector.namespace ? vector : { ...vector, namespace }));
  };

  const chunkArray = <T>(items: T[], size: number): T[][] => {
    if (items.length === 0) return [];
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  };

  const post = async (body: Record<string, unknown>, label: string) => {
    if (directBinding) {
      switch (body.action) {
        case 'upsert': {
          const vectors = withNamespace(body.vectors as VectorizeVector[], body.namespace as string | undefined);
          let count = 0;
          let mutationId: string | undefined;
          for (const chunk of chunkArray(vectors, VECTOR_BATCH_LIMIT)) {
            const result = await directBinding.upsert(chunk);
            count += 'count' in result ? result.count : chunk.length;
            if ('mutationId' in result) {
              mutationId = (result as { mutationId: string }).mutationId;
            }
          }
          return { count, ...(mutationId ? { mutationId } : {}) };
        }
        case 'insert': {
          const vectors = withNamespace(body.vectors as VectorizeVector[], body.namespace as string | undefined);
          let count = 0;
          let mutationId: string | undefined;
          for (const chunk of chunkArray(vectors, VECTOR_BATCH_LIMIT)) {
            const result = await directBinding.insert(chunk);
            count += 'count' in result ? result.count : chunk.length;
            if ('mutationId' in result) {
              mutationId = (result as { mutationId: string }).mutationId;
            }
          }
          return { count, ...(mutationId ? { mutationId } : {}) };
        }
        case 'search': {
          const result = await directBinding.query(body.vector as number[], {
            topK: body.topK as number | undefined,
            filter: body.filter as VectorizeVectorMetadataFilter | undefined,
            namespace: body.namespace as string | undefined,
            returnValues: body.returnValues as boolean | undefined,
            returnMetadata: body.returnMetadata as boolean | 'all' | 'indexed' | 'none' | undefined,
          });
          return { matches: mapMatches(result.matches), count: result.count };
        }
        case 'queryById': {
          const queryById = (directBinding as unknown as {
            queryById?: (id: string, opts?: VectorizeQueryOptions) => Promise<VectorizeMatches>;
          }).queryById;
          if (typeof queryById !== 'function') {
            throw new Error('queryById is not available on this Vectorize binding');
          }
          const result = await queryById(body.vectorId as string, {
            topK: body.topK as number | undefined,
            filter: body.filter as VectorizeVectorMetadataFilter | undefined,
            namespace: body.namespace as string | undefined,
            returnValues: body.returnValues as boolean | undefined,
            returnMetadata: body.returnMetadata as boolean | 'all' | 'indexed' | 'none' | undefined,
          });
          return { matches: mapMatches(result.matches), count: result.count };
        }
        case 'getByIds': {
          const vectors = (
            await Promise.all(chunkArray(body.ids as string[], VECTOR_BATCH_LIMIT).map((chunk) => directBinding.getByIds(chunk)))
          ).flat();
          return {
            vectors: vectors.map((vector) => ({
              id: vector.id,
              ...(vector.values !== undefined ? { values: normalizeValues(vector.values) } : {}),
              ...(vector.metadata !== undefined ? { metadata: vector.metadata } : {}),
              ...(vector.namespace ? { namespace: vector.namespace } : {}),
            })),
          };
        }
        case 'delete': {
          let count = 0;
          let mutationId: string | undefined;
          for (const chunk of chunkArray(body.ids as string[], VECTOR_BATCH_LIMIT)) {
            const result = await directBinding.deleteByIds(chunk);
            count += 'count' in result ? result.count : chunk.length;
            if ('mutationId' in result) {
              mutationId = (result as { mutationId: string }).mutationId;
            }
          }
          return { count, ...(mutationId ? { mutationId } : {}) };
        }
        case 'describe': {
          const info = await directBinding.describe();
          const details = info as unknown as Record<string, unknown>;
          return {
            vectorCount: details.vectorCount ?? details.vectorsCount ?? 0,
            dimensions: details.dimensions ?? (details.config as Record<string, unknown> | undefined)?.dimensions ?? 0,
            metric: details.metric ?? (details.config as Record<string, unknown> | undefined)?.metric ?? 'cosine',
            ...('id' in details ? { id: details.id } : {}),
            ...('name' in details ? { name: details.name } : {}),
            ...('processedUpToDatetime' in details ? { processedUpToDatetime: details.processedUpToDatetime } : {}),
            ...('processedUpToMutation' in details ? { processedUpToMutation: details.processedUpToMutation } : {}),
          };
        }
      }
    }
    const { url, key: sk } = requireWorkerUrl(label, workerUrl, serviceKey);
    const res = await fetch(`${url}/api/vectorize/${index}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': sk },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${label} failed: ${res.status}`);
    return res.json() as Promise<Record<string, unknown>>;
  };

  return {
    async upsert(vectors) {
      const data = await post({ action: 'upsert', vectors }, 'vector().upsert');
      return data as unknown as { ok: true; count?: number; mutationId?: string };
    },
    async insert(vectors) {
      const data = await post({ action: 'insert', vectors }, 'vector().insert');
      return data as unknown as { ok: true; count?: number; mutationId?: string };
    },
    async search(vector, options) {
      const data = await post(
        {
          action: 'search',
          vector,
          topK: options?.topK,
          filter: options?.filter,
          namespace: options?.namespace,
          returnValues: options?.returnValues,
          returnMetadata: options?.returnMetadata,
        },
        'vector().search',
      );
      return (
        data as {
          matches: Array<{
            id: string;
            score: number;
            values?: number[];
            metadata?: Record<string, unknown>;
            namespace?: string;
          }>;
        }
      ).matches;
    },
    async queryById(vectorId, options) {
      const data = await post(
        {
          action: 'queryById',
          vectorId,
          topK: options?.topK,
          filter: options?.filter,
          namespace: options?.namespace,
          returnValues: options?.returnValues,
          returnMetadata: options?.returnMetadata,
        },
        'vector().queryById',
      );
      return (
        data as {
          matches: Array<{
            id: string;
            score: number;
            values?: number[];
            metadata?: Record<string, unknown>;
            namespace?: string;
          }>;
        }
      ).matches;
    },
    async getByIds(ids) {
      const data = await post({ action: 'getByIds', ids }, 'vector().getByIds');
      return (
        data as {
          vectors: Array<{
            id: string;
            values?: number[];
            metadata?: Record<string, unknown>;
            namespace?: string;
          }>;
        }
      ).vectors;
    },
    async delete(ids) {
      const data = await post({ action: 'delete', ids }, 'vector().delete');
      return data as unknown as { ok: true; count?: number; mutationId?: string };
    },
    async describe() {
      const data = await post({ action: 'describe' }, 'vector().describe');
      return data as unknown as { vectorCount: number; dimensions: number; metric: string };
    },
  };
}

// ─── Storage Proxy Builder ───

export function buildFunctionStorageProxy(
  r2: R2Bucket,
  bucket: string,
  env: Env,
  workerUrl?: string,
): FunctionStorageProxy {
  const prefix = (key: string) => `${bucket}/${key}`;

  return {
    async put(key, value, options) {
      const httpMeta: R2PutOptions = {};
      if (options?.contentType) httpMeta.httpMetadata = { contentType: options.contentType };
      if (options?.customMetadata) httpMeta.customMetadata = options.customMetadata;
      await r2.put(prefix(key), value, httpMeta);
    },

    async get(key) {
      const obj = await r2.get(prefix(key));
      if (!obj) return null;
      return {
        body: obj.body,
        contentType: (obj.httpMetadata?.contentType as string) ?? 'application/octet-stream',
        size: obj.size,
        customMetadata: (obj.customMetadata as Record<string, string>) ?? {},
      };
    },

    async delete(key) {
      await r2.delete(prefix(key));
    },

    async getSignedUrl(key, options) {
      const secret = (env as unknown as Record<string, string>).JWT_USER_SECRET;
      if (!secret) throw new Error('Signed URLs require JWT_USER_SECRET to be configured.');
      const expiresIn = options?.expiresIn ?? 3600;
      const expiresAt = Date.now() + expiresIn * 1000;
      const token = await createSignedToken(key, bucket, expiresAt, secret);
      const base = workerUrl ?? 'http://localhost:8787';
      return `${base}/api/storage/${encodeURIComponent(bucket)}/${key}?token=${token}`;
    },

    async list(options) {
      const r2Options: R2ListOptions = {};
      if (options?.prefix) r2Options.prefix = prefix(options.prefix);
      else r2Options.prefix = `${bucket}/`;
      if (options?.limit) r2Options.limit = options.limit;
      if (options?.cursor) r2Options.cursor = options.cursor;
      const result = await r2.list(r2Options);
      const prefixLen = `${bucket}/`.length;
      return {
        keys: result.objects.map((obj) => ({
          key: obj.key.slice(prefixLen),
          size: obj.size,
          contentType: (obj.httpMetadata?.contentType as string) ?? 'application/octet-stream',
        })),
        cursor: result.truncated ? result.cursor : undefined,
        truncated: result.truncated,
      };
    },

    async head(key) {
      const obj = await r2.head(prefix(key));
      if (!obj) return null;
      return {
        key,
        size: obj.size,
        contentType: (obj.httpMetadata?.contentType as string) ?? 'application/octet-stream',
        customMetadata: (obj.customMetadata as Record<string, string>) ?? {},
      };
    },
  };
}

// ─── Push Proxy Builder ───

export function buildFunctionPushProxy(workerUrl?: string, serviceKey?: string): FunctionPushProxy {
  const postPush = async (path: string, body: Record<string, unknown>, label: string) => {
    const { url, key: sk } = requireWorkerUrl(label, workerUrl, serviceKey);
    const res = await fetch(`${url}/api/push/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': sk },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: `${label} failed` }))) as {
        message: string;
      };
      throw new Error(err.message);
    }
    return res.json();
  };

  const getPush = async (path: string, label: string) => {
    const { url, key: sk } = requireWorkerUrl(label, workerUrl, serviceKey);
    const res = await fetch(`${url}/api/push/${path}`, {
      method: 'GET',
      headers: { 'X-EdgeBase-Service-Key': sk },
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: `${label} failed` }))) as {
        message: string;
      };
      throw new Error(err.message);
    }
    return res.json();
  };

  return {
    async send(userId, payload) {
      return postPush('send', { userId, payload }, 'push.send') as Promise<{
        sent: number;
        failed: number;
        removed: number;
      }>;
    },
    async sendMany(userIds, payload) {
      return postPush('send-many', { userIds, payload }, 'push.sendMany') as Promise<{
        sent: number;
        failed: number;
        removed: number;
      }>;
    },
    async sendToToken(token, payload, platform?) {
      return postPush(
        'send-to-token',
        { token, payload, platform },
        'push.sendToToken',
      ) as Promise<{ sent: number; failed: number; error?: string }>;
    },
    async sendToTopic(topic, payload) {
      return postPush('send-to-topic', { topic, payload }, 'push.sendToTopic') as Promise<{
        success: boolean;
        error?: string;
      }>;
    },
    async broadcast(payload) {
      return postPush('broadcast', { payload }, 'push.broadcast') as Promise<{
        success: boolean;
        error?: string;
      }>;
    },
    async getTokens(userId) {
      const data = (await getPush(
        `tokens?userId=${encodeURIComponent(userId)}`,
        'push.getTokens',
      )) as {
        items: Array<{
          deviceId: string;
          platform: string;
          updatedAt: string;
          deviceInfo?: Record<string, string>;
          metadata?: Record<string, unknown>;
        }>;
      };
      return data.items;
    },
    async getLogs(userId, limit?) {
      const params = new URLSearchParams({ userId });
      if (limit !== undefined) params.set('limit', String(limit));
      const data = (await getPush(`logs?${params}`, 'push.getLogs')) as {
        items: Array<{
          sentAt: string;
          userId: string;
          platform: string;
          status: string;
          collapseId?: string;
          error?: string;
        }>;
      };
      return data.items;
    },
  };
}
