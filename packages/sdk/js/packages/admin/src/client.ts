/**
 * @edge-base/admin — Admin/Server-side EdgeBase SDK (Node.js / Edge Functions / Dart Frog)
 *
 * @example External server (url + serviceKey required):
 * import { createAdminClient } from '@edge-base/admin';
 * const admin = createAdminClient('https://my-app.edgebase.fun', {
 *   serviceKey: process.env.EDGEBASE_SERVICE_KEY,
 * });
 * const post = await admin.db('shared').table('posts').insert({ title: 'Hello' });
 *
 * @example App Functions (auto-detects url + serviceKey from env):
 * import { createAdminClient } from '@edge-base/admin';
 * const admin = createAdminClient();
 */

import { HttpClient } from '@edge-base/core';
import { ContextManager } from '@edge-base/core';
import { DbRef } from '@edge-base/core';
import { StorageClient } from '@edge-base/core';
import { FunctionsClient } from '@edge-base/core';
import { DefaultDbApi, HttpClientAdapter } from '@edge-base/core';
import { DefaultAdminApi } from './generated/admin-api-core.js';
import { AdminAuthClient } from './admin-auth.js';
import { KvClient } from './kv.js';
import { D1Client } from './d1.js';
import { VectorizeClient } from './vectorize.js';
import { PushClient } from './push.js';
import { AnalyticsClient } from './analytics.js';

// ─── Option types ───

/** Options for createAdminClient() */
export interface JuneAdminClientOptions {
  /**
   * Service Key for admin operations.
   * Optional when called with no args from App Functions — falls back to EDGEBASE_SERVICE_KEY env var.
   */
  serviceKey?: string;
  /** Schema from typegen (build-time metadata) */
  schema?: Record<string, unknown>;
}

// ─── Admin SDK ───

/**
 * Admin-side EdgeBase SDK.
 * Exposes: auth, db, storage, sql, kv, d1, vector, broadcast, destroy.
 * Does NOT expose: auth, database-live, presence, channel (client-only).
 *
 * @example
 * const posts = await admin.db('shared').table('posts').get();
 * const docs = await admin.db('workspace', 'ws-456').table('documents').get();
 */
export class AdminEdgeBase {
  /** Admin user management. */
  readonly auth: AdminAuthClient;
  readonly storage: StorageClient;
  readonly push: PushClient;
  readonly analytics: AnalyticsClient;
  readonly functions: FunctionsClient;

  private httpClient: HttpClient;
  private contextManager: ContextManager;
  private baseUrl: string;
  private core: DefaultDbApi;
  private adminCore: DefaultAdminApi;

  constructor(url: string, options: JuneAdminClientOptions) {
    this.baseUrl = url.replace(/\/$/, '');
    this.contextManager = new ContextManager();
    this.httpClient = new HttpClient({
      baseUrl: this.baseUrl,
      serviceKey: options.serviceKey,
      contextManager: this.contextManager,
    });
    const adapter = new HttpClientAdapter(this.httpClient);
    this.core = new DefaultDbApi(adapter);
    this.adminCore = new DefaultAdminApi(adapter);
    const authClient = new AdminAuthClient(this.httpClient, true);
    this.auth = authClient;
    this.storage = new StorageClient(this.httpClient, this.core);
    this.push = new PushClient(this.httpClient);
    this.analytics = new AnalyticsClient(this.httpClient);
    this.functions = new FunctionsClient(this.httpClient);
  }

  /**
   * Access a DB block by namespace + optional instance ID. (§2)
   *
   * @example
   * // Static shared DB (id omitted)
   * const posts = await admin.db('shared').table('posts').get();
   *
   * // Dynamic workspace DB
   * const docs = await admin.db('workspace', 'ws-456').table('documents').get();
   *
   * // Per-user DB
   * const notes = await admin.db('user', 'user-123').table('notes').get();
   */
  db(namespace: string, id?: string): DbRef {
    return new DbRef(this.core, namespace, id, undefined, undefined, this.httpClient);
  }

  /**
   * Execute raw SQL on a DB table's DO.
   *
   * @param namespace DB namespace ('shared' | 'workspace' | ...)
   * @param id        DB instance ID for dynamic DOs. Omit for static DBs.
   * @param query     SQL query string (use '?' for bind params)
   * @param params    Bind parameters matching '?' placeholders
   */
  async sql(namespace: string, id: string | undefined, query: string, params?: unknown[]): Promise<unknown[]>;
  /**
   * Simple form: sql(query) — executes against default 'shared' namespace.
   */
  async sql(query: string): Promise<unknown[]>;
  async sql(
    namespaceOrTable: string,
    idOrQuery?: string | undefined,
    queryOrParams?: string | unknown[],
    params?: unknown[],
  ): Promise<unknown[]> {
    // Detect overload: if 3rd arg is string it's the new (namespace, id, query, params) form
    if (typeof queryOrParams === 'string') {
      // New form: sql(namespace, id, sql, params)
      const res = await this.adminCore.executeSql({
        namespace: namespaceOrTable,
        id: idOrQuery,
        sql: queryOrParams,
        params: params ?? [],
      }) as { items?: unknown[] };
      return res.items ?? [];
    }
    if (idOrQuery === undefined) {
      // Simple form: sql(query)
      const res = await this.adminCore.executeSql({
        namespace: 'shared',
        id: undefined,
        sql: namespaceOrTable,
        params: [],
      }) as { items?: unknown[] };
      return res.items ?? [];
    }
    throw new Error('Invalid sql() signature. Use sql(namespace, id, query, params) or sql(query).');
  }

  /**
   * Broadcast a message to a database-live channel from the server.
   */
  async broadcast(channel: string, event: string, payload?: Record<string, unknown>): Promise<void> {
    await this.adminCore.databaseLiveBroadcast({ channel, event, payload });
  }

  kv(namespace: string): KvClient {
    return new KvClient(this.httpClient, namespace);
  }

  d1(database: string): D1Client {
    return new D1Client(this.httpClient, database);
  }

  vector(index: string): VectorizeClient {
    return new VectorizeClient(this.httpClient, index);
  }

  destroy(): void {}
}

// ─── Factory ───

/**
 * Create an admin-side EdgeBase SDK instance.
 */
export function createAdminClient(
  url?: string,
  options?: JuneAdminClientOptions,
): AdminEdgeBase {
  const getEnv = (key: string): string | undefined => {
    const processValue =
      typeof process !== 'undefined' && process.env
        ? process.env[key]
        : undefined;
    if (typeof processValue === 'string' && processValue.length > 0) {
      return processValue;
    }
    if (typeof globalThis === 'undefined') return undefined;
    const globalValue = (globalThis as Record<string, unknown>)[key];
    return typeof globalValue === 'string' ? globalValue : undefined;
  };

  const resolvedUrl = url ?? getEnv('EDGEBASE_URL') ?? 'http://localhost';
  const resolvedServiceKey = options?.serviceKey ?? getEnv('EDGEBASE_SERVICE_KEY');

  if (!resolvedServiceKey) {
    console.warn(
      '[EdgeBase] createAdminClient(): no serviceKey provided and EDGEBASE_SERVICE_KEY env var not set. ' +
      'Admin operations (auth, sql, broadcast) will fail.',
    );
  }

  return new AdminEdgeBase(resolvedUrl, {
    ...options,
    serviceKey: resolvedServiceKey ?? '',
  });
}
