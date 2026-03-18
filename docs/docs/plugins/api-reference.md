---
sidebar_position: 3
---

# Plugin API Reference

All types are exported from `@edgebase-fun/plugin-core`.

## definePlugin\<TConfig\>()

Creates a plugin factory function. The factory captures user-provided config via closure and injects it into all handlers as `ctx.pluginConfig`.

```typescript
import { definePlugin, EDGEBASE_PLUGIN_API_VERSION } from '@edgebase-fun/plugin-core';

const myPlugin = definePlugin<MyConfig>(definition);
// Returns: (userConfig: MyConfig) => PluginInstance
```

### PluginDefinition\<TConfig\>

```typescript
interface PluginDefinition<TConfig> {
  /** Unique plugin name (e.g. '@edgebase-fun/plugin-stripe'). Used for namespacing. */
  name: string;

  /** Public plugin contract version. Defaults to the current runtime contract when omitted. */
  pluginApiVersion?: number;

  /** Semantic version string (e.g. '1.0.0'). Required for migration support. */
  version?: string;

  /** Serializable metadata used by CLI/docs tooling. */
  manifest?: PluginManifest;

  /** Tables injected into the host project. Keys = table names (auto-prefixed). */
  tables?: Record<string, TableConfig>;

  /** DB block for plugin tables. Default: 'shared'. */
  dbBlock?: string;

  /**
   * Database provider required by this plugin.
   * - 'do' (default): Durable Object + SQLite
   * - 'neon': Requires Neon PostgreSQL and a configured connection string
   * - 'postgres': Requires custom PostgreSQL
   */
  provider?: DbProvider;

  /** Functions registered in the function system. Keys = function names (auto-prefixed). */
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
```

### PluginInstance

The resolved object returned by the factory. This is what goes into `config.plugins[]`.

```typescript
interface PluginInstance {
  /** Plugin unique name (e.g. '@edgebase-fun/plugin-stripe'). Used for namespacing. */
  name: string;
  /** Public plugin contract version used for compatibility checks. */
  pluginApiVersion: number;
  /** Semantic version string (e.g. '1.0.0'). Required for migration support. */
  version?: string;
  /** Manifest metadata surfaced by CLI/docs tooling. */
  manifest?: PluginManifest;
  /** Developer-supplied plugin config (captured by factory closure). */
  config: Record<string, unknown>;
  /** Plugin tables. Keys = table names (plugin.name/ prefix added automatically by CLI). */
  tables?: Record<string, TableConfig>;
  /** DB block for plugin tables. Default: 'shared'. */
  dbBlock?: string;
  /**
   * Database provider required by this plugin.
   * - 'do' (default): Durable Object + SQLite
   * - 'neon': Requires Neon PostgreSQL and a configured connection string
   * - 'postgres': Requires custom PostgreSQL
   */
  provider?: DbProvider;
  /** Plugin functions. Keys = function names (plugin.name/ prefix added automatically by CLI). */
  functions?: Record<string, FunctionDefinition>;
  /** Auth + storage hooks. Event name -> handler. */
  hooks?: Partial<
    Record<AuthTrigger['event'] | StorageTrigger['event'], (ctx: unknown) => Promise<unknown>>
  >;
  /** Runs once on first deploy with this plugin (version null -> version). */
  onInstall?: (context: unknown) => Promise<void>;
  /** Version-keyed migration functions. Run in semver order on deploy when version changes. */
  migrations?: Record<string, (context: unknown) => Promise<void>>;
}
```

`definePlugin()` automatically injects the current `pluginApiVersion`, so normal plugin authors rarely set it manually. The runtime rejects plugins built against a different public contract. If you ever construct a `PluginInstance` by hand, import `EDGEBASE_PLUGIN_API_VERSION` from `@edgebase-fun/plugin-core`.

### PluginManifest

```typescript
interface PluginManifest {
  description?: string;
  docsUrl?: string;
  configTemplate?: Record<string, unknown>;
}
```

---

## PluginFunctionContext\<TConfig\>

The context passed to all plugin function handlers. Mirrors the server's `FunctionContext` with an additional `pluginConfig` field.

```typescript
interface PluginFunctionContext<TConfig> {
  /** The incoming HTTP request. */
  request: Request;

  /** Authenticated user (null if unauthenticated). */
  auth: {
    id: string;
    email?: string;
    isAnonymous?: boolean;
    custom?: Record<string, unknown>;
  } | null;

  /** Plugin-specific config — typed via definePlugin<TConfig>(). */
  pluginConfig: TConfig;

  /** Route parameters from dynamic paths in the registry name or trigger.path. */
  params: Record<string, string>;

  /** Server-side admin client (bypasses access rules). */
  admin: PluginAdminContext;

  /** Trigger data (DB triggers: before/after snapshots). */
  data?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
}
```

### PluginAdminContext

The `ctx.admin` object provides full server-side access:

```typescript
admin: {
  /** Table access on default namespace. */
  table(name: string): PluginTableProxy;

  /** Access a specific DB namespace instance. */
  db(namespace: string, id?: string): { table(name: string): PluginTableProxy };

  /** Admin user management. */
  auth: PluginAdminAuthContext;

  /** Raw SQL on a DB namespace DO. */
  sql(namespace: string, id: string | undefined, query: string, params?: unknown[]): Promise<unknown[]>;

  /** Server-side broadcast to a database subscription channel. */
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
```

---

## PluginTableProxy

CRUD operations on a database table:

```typescript
interface PluginTableProxy {
  insert(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(id: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  delete(id: string): Promise<{ deleted: boolean }>;
  get(id: string): Promise<Record<string, unknown>>;
  list(options?: {
    limit?: number;
    filter?: unknown;
  }): Promise<{ items: Record<string, unknown>[] }>;
}
```

---

## PluginAdminAuthContext

User management operations:

```typescript
interface PluginAdminAuthContext {
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
```

---

## PluginKvProxy

KV namespace operations:

```typescript
interface PluginKvProxy {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ttl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ keys: string[]; cursor?: string }>;
}
```

---

## PluginD1Proxy

D1 database operations:

```typescript
interface PluginD1Proxy {
  exec<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>;
}
```

---

## PluginVectorProxy

Vectorize index operations:

```typescript
interface PluginVectorProxy {
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
```

---

## PluginPushProxy

Push notification operations:

```typescript
interface PluginPushProxy {
  send(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<{ sent: number; failed: number; removed: number }>;
  sendMany(
    userIds: string[],
    payload: Record<string, unknown>,
  ): Promise<{ sent: number; failed: number; removed: number }>;
  getTokens(userId: string): Promise<
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
```

---

## PluginHookContext\<TConfig\>

Context passed to plugin authentication hook handlers. Mirrors the server's `executeAuthHook` context with full admin access.

```typescript
interface PluginHookContext<TConfig> {
  request: Request;
  auth: null;
  /** Server-side admin client with full resource access. */
  admin: PluginAdminContext;
  data: { after: Record<string, unknown> };
  pluginConfig: TConfig;
}
```

---

## PluginStorageHookContext\<TConfig\>

Context passed to plugin storage hook handlers. Storage hooks receive file metadata only -- NO file content (Worker 128 MB memory limit). Blocking hooks (`before*`) can throw to reject. Non-blocking hooks (`after*`) run via `waitUntil`.

```typescript
interface PluginStorageHookContext<TConfig> {
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
```

---

## PluginMigrationContext\<TConfig\>

Context passed to plugin `onInstall` and `migrations` handlers. Provides admin-level access for schema alterations, data migrations, and service setup.

:::note
Some admin methods (`kv`, `d1`, `vector`, `broadcast`, `functions`, `push`) require `workerUrl` which is derived from the first incoming request. These will throw if `workerUrl` is unavailable.
:::

```typescript
interface PluginMigrationContext<TConfig> {
  /** Plugin-specific config injected by factory closure. */
  pluginConfig: TConfig;
  /** Admin context for DB operations and service access. */
  admin: PluginAdminContext;
  /** Previous plugin version (null for onInstall / first deploy). */
  previousVersion: string | null;
}
```

---

## PluginHooks\<TConfig\>

Available auth and storage lifecycle hooks:

```typescript
interface PluginHooks<TConfig> {
  // ── Auth hooks — sign up / sign in ──

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

  // ── Auth hooks — password reset ──

  /** Before password reset. Throw to reject. 5s timeout. */
  beforePasswordReset?: (ctx: PluginHookContext<TConfig>) => Promise<void>;

  /** After password reset. Non-blocking (waitUntil). */
  afterPasswordReset?: (ctx: PluginHookContext<TConfig>) => Promise<void>;

  // ── Auth hooks — sign out ──

  /** Before sign out. Throw to reject. 5s timeout. */
  beforeSignOut?: (ctx: PluginHookContext<TConfig>) => Promise<void>;

  /** After sign out. Non-blocking (waitUntil). */
  afterSignOut?: (ctx: PluginHookContext<TConfig>) => Promise<void>;

  // ── Auth hooks — account lifecycle ──

  /** On account deletion. Non-blocking (waitUntil). */
  onDeleteAccount?: (ctx: PluginHookContext<TConfig>) => Promise<void>;

  /** On email verification. Non-blocking (waitUntil). */
  onEmailVerified?: (ctx: PluginHookContext<TConfig>) => Promise<void>;

  // ── Storage hooks — blocking (before*: throw to reject, 5s timeout) ──

  /** Before upload. Return Record<string,string> to merge custom metadata. Throw to reject. 5s timeout. */
  beforeUpload?: (ctx: PluginStorageHookContext<TConfig>) => Promise<Record<string, string> | void>;

  /** Before file deletion. Throw to reject. 5s timeout. */
  beforeDelete?: (ctx: PluginStorageHookContext<TConfig>) => Promise<void>;

  /** Before file download. Throw to reject. 5s timeout. */
  beforeDownload?: (ctx: PluginStorageHookContext<TConfig>) => Promise<void>;

  // ── Storage hooks — non-blocking (fire-and-forget via waitUntil) ──
  // NOTE: presigned URL direct uploads bypass the server and do NOT trigger afterUpload.

  /** After upload. Non-blocking (waitUntil). Receives final R2 metadata. */
  afterUpload?: (ctx: PluginStorageHookContext<TConfig>) => Promise<void>;

  /** After deletion. Non-blocking (waitUntil). */
  afterDelete?: (ctx: PluginStorageHookContext<TConfig>) => Promise<void>;

  /** On metadata update. Non-blocking (waitUntil). */
  onMetadataUpdate?: (ctx: PluginStorageHookContext<TConfig>) => Promise<void>;
}
```

---

## PluginClientFactory\<T\>

For creating typed client SDK wrappers:

```typescript
interface PluginClientHost {
  table(name: string): unknown;
  functions: { call(name: string, data?: unknown): Promise<unknown> };
}

type PluginClientFactory<T> = (client: PluginClientHost) => T;
```

---

## createMockContext()

Testing utility — creates an in-memory mock of `PluginFunctionContext`:

```typescript
function createMockContext<TConfig>(options?: {
  auth?: {
    id: string;
    email?: string;
    isAnonymous?: boolean;
    custom?: Record<string, unknown>;
  } | null;
  pluginConfig?: TConfig;
  params?: Record<string, string>;
  body?: unknown;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
}): PluginFunctionContext<TConfig>;
```

The mock context provides in-memory implementations for all admin APIs:

- **Tables**: In-memory `Map` per table name (supports insert/update/delete/get/list)
- **Auth**: No-op stubs
- **KV/D1/Vectorize**: No-op stubs
- **Push**: No-op stubs returning zero counts
- **Functions**: No-op stubs
- **Broadcast/SQL**: No-op stubs
