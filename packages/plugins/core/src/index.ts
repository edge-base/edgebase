/**
 * @edgebase-fun/plugin-core — Plugin definition API for EdgeBase.
 *
 * Explicit import pattern — plugins are factory functions that return PluginInstance.
 *
 * @example
 * ```typescript
 * // Plugin author (e.g. @edgebase-fun/plugin-stripe/server/src/index.ts)
 * import { definePlugin } from '@edgebase-fun/plugin-core';
 *
 * interface StripeConfig { secretKey: string; webhookSecret: string; currency?: string }
 *
 * export const stripePlugin = definePlugin<StripeConfig>({
 *   name: '@edgebase-fun/plugin-stripe',
 *   tables: { customers: { schema: { ... } } },
 *   functions: {
 *     'create-checkout': {
 *       trigger: { type: 'http', method: 'POST' },
 *       handler: async (ctx) => {
 *         const key = ctx.pluginConfig.secretKey;  // ← typed
 *         return Response.json({ ok: true });
 *       },
 *     },
 *   },
 *   hooks: {
 *     afterSignUp: async (ctx) => { /* ... *​/ },
 *   },
 * });
 *
 * // App developer (edgebase.config.ts)
 * import { stripePlugin } from '@edgebase-fun/plugin-stripe';
 * export default defineConfig({
 *   plugins: [ stripePlugin({ secretKey: process.env.STRIPE_SECRET_KEY! }) ],
 * });
 * ```
 */

import { CURRENT_PLUGIN_API_VERSION } from '@edgebase-fun/shared';
import type {
  PluginInstance,
  PluginManifest,
  TableConfig,
  FunctionDefinition,
  FunctionTrigger,
  AuthTrigger,
  StorageTrigger,
  DbProvider,
} from '@edgebase-fun/shared';

export { CURRENT_PLUGIN_API_VERSION as EDGEBASE_PLUGIN_API_VERSION } from '@edgebase-fun/shared';

// ─── Plugin Table Proxy (matches server TableProxy 1:1) ───

export interface PluginTableProxy {
  insert(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  upsert(
    data: Record<string, unknown>,
    options?: { conflictTarget?: string },
  ): Promise<Record<string, unknown>>;
  update(id: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  delete(id: string): Promise<{ deleted: boolean }>;
  get(id: string): Promise<Record<string, unknown>>;
  list(options?: {
    limit?: number;
    filter?: unknown;
  }): Promise<{ items: Record<string, unknown>[] }>;
}

// ─── Admin Auth Context (matches server AdminAuthContext 1:1) ───

export interface PluginAdminAuthContext {
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

// ─── Full Plugin Admin Context (shared across function, hook, storage, migration contexts) ───

/**
 * Full admin surface available in plugin contexts.
 * Matches server FunctionAdminContext — all operations bypass access rules.
 */
export interface PluginAdminContext {
  /** Table access on default namespace (shortcut for `db('shared').table(name)`). */
  table(name: string): PluginTableProxy;
  /** Access a specific DB namespace instance. */
  db(namespace: string, id?: string): { table(name: string): PluginTableProxy };
  /** Admin user management. */
  auth: PluginAdminAuthContext;
  /** Raw SQL on a DB namespace DO. */
  sql(
    namespace: string,
    id: string | undefined,
    query: string,
    params?: unknown[],
  ): Promise<unknown[]>;
  /** Server-side broadcast to a realtime channel. */
  broadcast(channel: string, event: string, payload?: Record<string, unknown>): Promise<void>;
  /** Inter-function calls. */
  functions: { call(name: string, data?: unknown): Promise<unknown> };
  /** KV namespace access. */
  kv(namespace: string): PluginKvProxy;
  /** D1 database access. */
  d1(database: string): PluginD1Proxy;
  /** Vectorize index access. */
  vector(index: string): PluginVectorProxy;
  /** Push notification management. */
  push: PluginPushProxy;
}

// ─── KV / D1 / Vectorize Proxies (matches server 1:1) ───

export interface PluginKvProxy {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ttl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ keys: string[]; cursor?: string }>;
}

export interface PluginD1Proxy {
  exec<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>;
}

export interface PluginVectorProxy {
  /** Insert or update vectors. */
  upsert(
    vectors: Array<{
      id: string;
      values: number[];
      metadata?: Record<string, unknown>;
      namespace?: string;
    }>,
  ): Promise<{ ok: true; count?: number; mutationId?: string }>;
  /** Insert new vectors (fails if ID exists). */
  insert(
    vectors: Array<{
      id: string;
      values: number[];
      metadata?: Record<string, unknown>;
      namespace?: string;
    }>,
  ): Promise<{ ok: true; count?: number; mutationId?: string }>;
  /** Semantic search by vector. */
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
  /** Find similar vectors by an existing vector ID. */
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
  /** Retrieve vectors by IDs. */
  getByIds(ids: string[]): Promise<
    Array<{
      id: string;
      values?: number[];
      metadata?: Record<string, unknown>;
      namespace?: string;
    }>
  >;
  /** Delete vectors by IDs. */
  delete(ids: string[]): Promise<{ ok: true; count?: number; mutationId?: string }>;
  /** Get index metadata (dimensions, vector count, metric). */
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

// ─── Push Proxy (matches server 1:1) ───

export interface PluginPushProxy {
  send(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<{ sent: number; failed: number; removed: number }>;
  sendMany(
    userIds: string[],
    payload: Record<string, unknown>,
  ): Promise<{ sent: number; failed: number; removed: number }>;
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
  sendToToken(
    token: string,
    payload: Record<string, unknown>,
    platform?: string,
  ): Promise<{ sent: number; failed: number; error?: string }>;
  sendToTopic(
    topic: string,
    payload: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }>;
  broadcast(payload: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
}

// ─── Plugin Function Context (matches server FunctionContext + FunctionAdminContext) ───

/**
 * Context passed to plugin function handlers.
 * Mirrors the server FunctionContext — admin surface matches FunctionAdminContext exactly.
 *
 * @typeParam TConfig - Plugin config shape from definePlugin<TConfig>()
 */
export interface PluginFunctionContext<TConfig = Record<string, unknown>> {
  /** The incoming HTTP request. */
  request: Request;
  /** Authenticated user (null if unauthenticated). */
  auth: {
    id: string;
    email?: string;
    isAnonymous?: boolean;
    custom?: Record<string, unknown>;
  } | null;
  /** Plugin-specific config — typed via definePlugin<TConfig>(). Injected by factory closure. */
  pluginConfig: TConfig;
  /** Route parameters extracted from trigger path (e.g. `/stripe/[id]` → `{ id: '...' }`). */
  params: Record<string, string>;
  /** Server-side EdgeBase admin client (admin-level access — bypasses access rules). */
  admin: PluginAdminContext;
  /** Trigger data (before/after for DB triggers). */
  data?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
}

// ─── Plugin Storage Hook Context ───

/**
 * Context passed to plugin storage hook handlers.
 * Storage hooks receive file metadata only — NO file content (Worker 128MB memory limit).
 * Blocking hooks (`before*`) can throw to reject. Non-blocking hooks (`after*`) run via waitUntil.
 */
export interface PluginStorageHookContext<TConfig = Record<string, unknown>> {
  file: {
    key: string;
    bucket: string;
    size: number;
    contentType: string;
    etag?: string;
    uploadedAt?: string;
    uploadedBy?: string | null;
    customMetadata?: Record<string, string>;
  };
  /** Authenticated user who performed the action (null for service key or unauthenticated). */
  auth: { id: string; email?: string } | null;
  /** Plugin-specific config injected by factory closure. */
  pluginConfig: TConfig;
  /** Server-side admin client — access to DB, KV, D1, Vectorize, push, etc. */
  admin: PluginAdminContext;
}

// ─── Plugin Migration Context ───

/**
 * Context passed to plugin onInstall and migration handlers.
 * Provides admin-level access for schema alterations, data migrations, and service setup.
 *
 * NOTE: Some admin methods (kv, d1, vector, broadcast, functions, push) require workerUrl
 * which is derived from the first incoming request. These will throw if workerUrl is unavailable.
 */
export interface PluginMigrationContext<TConfig = Record<string, unknown>> {
  /** Plugin-specific config injected by factory closure. */
  pluginConfig: TConfig;
  /** Admin context for DB operations and service access. */
  admin: PluginAdminContext;
  /** Previous plugin version (null for onInstall / first deploy). */
  previousVersion: string | null;
}

// ─── Plugin Hook Context (matches server auth hook context) ───

/**
 * Context passed to plugin auth hook handlers.
 * Mirrors the server's executeAuthHook context with full admin access.
 */
export interface PluginHookContext<TConfig = Record<string, unknown>> {
  request: Request;
  auth: null;
  /** Server-side admin client with full resource access. */
  admin: PluginAdminContext;
  data: { after: Record<string, unknown> };
  pluginConfig: TConfig;
}

// ─── Plugin Hooks (auth + storage lifecycle events) ───

export interface PluginHooks<TConfig = Record<string, unknown>> {
  // Auth hooks — sign up / sign in
  /** Before user creation. Throw to reject signup. 5s timeout. */
  beforeSignUp?: (ctx: PluginHookContext<TConfig>) => Promise<Record<string, unknown> | void>;
  /** After user creation. Non-blocking (waitUntil). */
  afterSignUp?: (ctx: PluginHookContext<TConfig>) => Promise<void>;
  /** Before session creation. Throw to reject signin. 5s timeout. */
  beforeSignIn?: (ctx: PluginHookContext<TConfig>) => Promise<Record<string, unknown> | void>;
  /** After session creation. Non-blocking (waitUntil). */
  afterSignIn?: (ctx: PluginHookContext<TConfig>) => Promise<void>;
  /** On JWT refresh. Return a plain object of claim overrides. 5s timeout. */
  onTokenRefresh?: (ctx: PluginHookContext<TConfig>) => Promise<Record<string, unknown> | void>;
  // Auth hooks — password reset
  /** Before password reset. Throw to reject. 5s timeout. */
  beforePasswordReset?: (ctx: PluginHookContext<TConfig>) => Promise<void>;
  /** After password reset. Non-blocking (waitUntil). */
  afterPasswordReset?: (ctx: PluginHookContext<TConfig>) => Promise<void>;
  // Auth hooks — sign out
  /** Before sign out. Throw to reject. 5s timeout. */
  beforeSignOut?: (ctx: PluginHookContext<TConfig>) => Promise<void>;
  /** After sign out. Non-blocking (waitUntil). */
  afterSignOut?: (ctx: PluginHookContext<TConfig>) => Promise<void>;
  // Auth hooks — account lifecycle
  /** On account deletion. Non-blocking (waitUntil). */
  onDeleteAccount?: (ctx: PluginHookContext<TConfig>) => Promise<void>;
  /** On email verification. Non-blocking (waitUntil). */
  onEmailVerified?: (ctx: PluginHookContext<TConfig>) => Promise<void>;
  // Storage hooks — blocking (before*: throw to reject, 5s timeout)
  /** Before upload. Return Record<string,string> to merge custom metadata. Throw to reject. 5s timeout. */
  beforeUpload?: (ctx: PluginStorageHookContext<TConfig>) => Promise<Record<string, string> | void>;
  /** Before file deletion. Throw to reject. 5s timeout. */
  beforeDelete?: (ctx: PluginStorageHookContext<TConfig>) => Promise<void>;
  /** Before file download. Throw to reject. 5s timeout. */
  beforeDownload?: (ctx: PluginStorageHookContext<TConfig>) => Promise<void>;
  // Storage hooks — non-blocking (fire-and-forget via waitUntil)
  // NOTE: presigned URL direct uploads bypass the server and do NOT trigger afterUpload.
  /** After upload. Non-blocking (waitUntil). Receives final R2 metadata. */
  afterUpload?: (ctx: PluginStorageHookContext<TConfig>) => Promise<void>;
  /** After deletion. Non-blocking (waitUntil). */
  afterDelete?: (ctx: PluginStorageHookContext<TConfig>) => Promise<void>;
  /** On metadata update. Non-blocking (waitUntil). */
  onMetadataUpdate?: (ctx: PluginStorageHookContext<TConfig>) => Promise<void>;
}

// ─── Plugin Definition ───

export interface PluginDefinition<TConfig = Record<string, unknown>> {
  /** Plugin unique name (e.g. '@edgebase-fun/plugin-stripe'). */
  name: string;
  /**
   * Public plugin contract version.
   * Defaults to the current runtime contract when omitted.
   */
  pluginApiVersion?: number;
  /** Semantic version string (e.g. '1.0.0'). Required for migration support. */
  version?: string;
  /** Serializable metadata used by CLI/docs tooling. */
  manifest?: PluginManifest;
  /** Plugin tables. Keys = table names (plugin.name/ prefix added automatically). */
  tables?: Record<string, TableConfig>;
  /** DB block for plugin tables. Default: 'shared'. */
  dbBlock?: string;
  /**
   * Database provider required by this plugin.
   * - `'do'` (default): Durable Object + SQLite
   * - `'neon'`: Requires Neon PostgreSQL and a configured connection string
   * - `'postgres'`: Requires custom PostgreSQL
   */
  provider?: DbProvider;
  /** Plugin functions. Keys = function names (plugin.name/ prefix added automatically). */
  functions?: Record<
    string,
    {
      trigger: FunctionTrigger;
      handler: (ctx: PluginFunctionContext<TConfig>) => Promise<Response | unknown>;
    }
  >;
  /** Auth + storage hooks. */
  hooks?: PluginHooks<TConfig>;
  /** Runs once on first deploy with this plugin. Use for initial seed data, external webhook registration, etc. */
  onInstall?: (ctx: PluginMigrationContext<TConfig>) => Promise<void>;
  /**
   * Version-keyed migration functions. Run in semver order on deploy when plugin version changes.
   * Migrations MUST be idempotent — concurrent Worker instances may execute the same migration.
   * Use either onInstall OR migrations['1.0.0'], not both (onInstall runs first, then migrations).
   */
  migrations?: Record<string, (ctx: PluginMigrationContext<TConfig>) => Promise<void>>;
}

// ─── definePlugin() — Factory Pattern ───

/**
 * Define an EdgeBase plugin. Returns a factory function that takes user config
 * and returns a PluginInstance for use in edgebase.config.ts.
 *
 * The factory closure captures userConfig so every handler receives pluginConfig
 * without the server needing to know about plugins.
 *
 * @typeParam TConfig - Shape of the plugin config
 *
 * @example
 * ```typescript
 * export const stripePlugin = definePlugin<{ secretKey: string }>({
 *   name: '@edgebase-fun/plugin-stripe',
 *   tables: { customers: { schema: { ... } } },
 *   functions: {
 *     'create-checkout': {
 *       trigger: { type: 'http', method: 'POST' },
 *       handler: async (ctx) => {
 *         const key = ctx.pluginConfig.secretKey;  // typed, injected by closure
 *         return Response.json({ ok: true });
 *       },
 *     },
 *   },
 * });
 * ```
 */
export function definePlugin<TConfig>(
  definition: PluginDefinition<TConfig>,
): (userConfig: TConfig) => PluginInstance {
  return (userConfig: TConfig): PluginInstance => {
    // Wrap function handlers with pluginConfig closure
    const functions: Record<string, FunctionDefinition> = {};
    if (definition.functions) {
      for (const [name, def] of Object.entries(definition.functions)) {
        functions[name] = {
          trigger: def.trigger,
          handler: async (ctx: unknown) => {
            (ctx as Record<string, unknown>).pluginConfig = userConfig;
            return def.handler(ctx as PluginFunctionContext<TConfig>);
          },
        };
      }
    }

    // Wrap auth + storage hooks with pluginConfig closure
    const hooks: PluginInstance['hooks'] = {};
    if (definition.hooks) {
      for (const [event, hookFn] of Object.entries(definition.hooks)) {
        if (hookFn) {
          hooks[event as AuthTrigger['event'] | StorageTrigger['event']] = async (ctx: unknown) => {
            (ctx as Record<string, unknown>).pluginConfig = userConfig;
            return (hookFn as (ctx: unknown) => Promise<unknown>)(ctx);
          };
        }
      }
    }

    // Wrap onInstall with pluginConfig closure
    let onInstall: PluginInstance['onInstall'];
    if (definition.onInstall) {
      const installFn = definition.onInstall;
      onInstall = async (ctx: unknown) => {
        (ctx as Record<string, unknown>).pluginConfig = userConfig;
        return installFn(ctx as PluginMigrationContext<TConfig>);
      };
    }

    // Wrap migrations with pluginConfig closure
    let migrations: PluginInstance['migrations'];
    if (definition.migrations) {
      migrations = {};
      for (const [version, migrateFn] of Object.entries(definition.migrations)) {
        migrations[version] = async (ctx: unknown) => {
          (ctx as Record<string, unknown>).pluginConfig = userConfig;
          return migrateFn(ctx as PluginMigrationContext<TConfig>);
        };
      }
    }

    return {
      name: definition.name,
      pluginApiVersion: definition.pluginApiVersion ?? CURRENT_PLUGIN_API_VERSION,
      version: definition.version,
      manifest: definition.manifest,
      config: userConfig as Record<string, unknown>,
      tables: definition.tables,
      dbBlock: definition.dbBlock,
      provider: definition.provider,
      functions: Object.keys(functions).length > 0 ? functions : undefined,
      hooks: Object.keys(hooks).length > 0 ? hooks : undefined,
      onInstall,
      migrations,
    };
  };
}

// ─── Testing Utilities ───

/**
 * Create a mock PluginFunctionContext for unit testing plugin handlers.
 *
 * @example
 * ```typescript
 * import { createMockContext } from '@edgebase-fun/plugin-core';
 *
 * const ctx = createMockContext({
 *   auth: { id: 'user-1' },
 *   pluginConfig: { secretKey: 'sk_test_xxx' },
 *   body: { priceId: 'price_xxx' },
 * });
 * const response = await myHandler(ctx);
 * expect(response.status).toBe(200);
 * ```
 */
export function createMockContext<TConfig = Record<string, unknown>>(options?: {
  auth?: PluginFunctionContext['auth'];
  pluginConfig?: TConfig;
  params?: Record<string, string>;
  body?: unknown;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
}): PluginFunctionContext<TConfig> {
  const method = options?.method ?? 'POST';
  const url = options?.url ?? 'http://localhost:8787/api/functions/test';
  const headers = new Headers(options?.headers);
  if (options?.body) headers.set('Content-Type', 'application/json');

  const request = new Request(url, {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  // In-memory table store for testing
  const stores: Record<string, Map<string, Record<string, unknown>>> = {};

  function getStore(name: string): Map<string, Record<string, unknown>> {
    if (!stores[name]) stores[name] = new Map();
    return stores[name];
  }

  function createTableProxy(name: string): PluginTableProxy {
    const store = getStore(name);
    return {
      async insert(data: Record<string, unknown>) {
        const id = (data.id as string) ?? crypto.randomUUID();
        const doc = { id, ...data, createdAt: new Date().toISOString() };
        store.set(id, doc);
        return doc;
      },
      async upsert(
        data: Record<string, unknown>,
        options?: { conflictTarget?: string },
      ) {
        const conflictTarget = options?.conflictTarget ?? 'id';
        const existing = Array.from(store.values()).find(
          (doc) => doc[conflictTarget] !== undefined && doc[conflictTarget] === data[conflictTarget],
        );

        if (existing) {
          const id = String(existing.id ?? data.id ?? crypto.randomUUID());
          const updated = {
            ...existing,
            ...data,
            id,
            updatedAt: new Date().toISOString(),
          };
          store.set(id, updated);
          return updated;
        }

        const id = (data.id as string) ?? crypto.randomUUID();
        const doc = { id, ...data, createdAt: new Date().toISOString() };
        store.set(id, doc);
        return doc;
      },
      async update(id: string, data: Record<string, unknown>) {
        const existing = store.get(id) ?? {};
        const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
        store.set(id, updated);
        return updated;
      },
      async delete(id: string) {
        const existed = store.has(id);
        store.delete(id);
        return { deleted: existed };
      },
      async get(id: string) {
        return store.get(id) ?? (null as unknown as Record<string, unknown>);
      },
      async list() {
        return { items: Array.from(store.values()) };
      },
    };
  }

  const mockAuth: PluginAdminAuthContext = {
    async getUser() {
      return {};
    },
    async listUsers() {
      return { users: [] };
    },
    async createUser() {
      return {};
    },
    async updateUser() {
      return {};
    },
    async deleteUser() {},
    async setCustomClaims() {},
    async revokeAllSessions() {},
  };

  const mockPush: PluginPushProxy = {
    async send() {
      return { sent: 0, failed: 0, removed: 0 };
    },
    async sendMany() {
      return { sent: 0, failed: 0, removed: 0 };
    },
    async getTokens() {
      return [];
    },
    async getLogs() {
      return [];
    },
    async sendToToken() {
      return { sent: 0, failed: 0 };
    },
    async sendToTopic() {
      return { success: true };
    },
    async broadcast() {
      return { success: true };
    },
  };

  const mockAdmin: PluginAdminContext = {
    table: createTableProxy,
    db(_namespace: string, _id?: string) {
      return { table: createTableProxy };
    },
    auth: mockAuth,
    async sql() {
      return [];
    },
    async broadcast() {},
    functions: {
      async call() {
        return {};
      },
    },
    kv() {
      return {
        async get() {
          return null;
        },
        async set() {},
        async delete() {},
        async list() {
          return { keys: [] };
        },
      };
    },
    d1() {
      return {
        async exec() {
          return [];
        },
      };
    },
    vector() {
      return {
        async upsert() {
          return { ok: true as const, count: 0 };
        },
        async insert() {
          return { ok: true as const, count: 0 };
        },
        async search() {
          return [];
        },
        async queryById() {
          return [];
        },
        async getByIds() {
          return [];
        },
        async delete() {
          return { ok: true as const, count: 0 };
        },
        async describe() {
          return { vectorCount: 0, dimensions: 0, metric: 'cosine' };
        },
      };
    },
    push: mockPush,
  };

  return {
    request,
    auth: options?.auth ?? null,
    pluginConfig: (options?.pluginConfig ?? {}) as TConfig,
    params: options?.params ?? {},
    admin: mockAdmin,
  };
}

// ─── Client SDK Base ───

/**
 * Base interface for plugin client SDKs.
 * Use this as a guide when creating typed client wrappers.
 *
 * @example
 * ```typescript
 * import type { PluginClientFactory } from '@edgebase-fun/plugin-core';
 *
 * interface StripeClient { createCheckout(params: CheckoutParams): Promise<CheckoutResult>; }
 *
 * export const createStripePlugin: PluginClientFactory<StripeClient> = (client) => ({
 *   async createCheckout(params) {
 *     return client.functions.call('@edgebase-fun/plugin-stripe/create-checkout', params) as Promise<CheckoutResult>;
 *   },
 * });
 * ```
 */
export interface PluginClientHost {
  table(name: string): unknown;
  functions: { call(name: string, data?: unknown): Promise<unknown> };
}

export type PluginClientFactory<T> = (client: PluginClientHost) => T;
