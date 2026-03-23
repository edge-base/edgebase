/**
 * Internal HttpTransport implementation for server-side function context.
 *
 * Replaces the old TableProxy by implementing the same HttpTransport interface
 * that @edge-base/core's DefaultDbApi expects. This lets us use the real
 * TableRef/DbRef classes from the core SDK while routing requests directly
 * to D1, PostgreSQL, or DurableObject handlers — no HTTP round-trip.
 */
import type { HttpTransport } from '@edge-base/core';
import type { EdgeBaseConfig } from '@edge-base/shared';
import { getDbDoName, callDO, shouldRouteToD1 } from './do-router.js';
import { handleD1Request } from './d1-handler.js';
import { handlePgRequest } from './postgres-handler.js';
import { buildInternalHandlerContext } from './internal-request.js';
import type { Env } from '../types.js';

export interface InternalTransportOptions {
  databaseNamespace: DurableObjectNamespace;
  config: EdgeBaseConfig;
  workerUrl?: string;
  serviceKey?: string;
  env?: Env;
  executionCtx?: ExecutionContext;
  preferDirectDo?: boolean;
  /**
   * When set, the transport knows this DbRef targets a specific
   * namespace + optional instanceId. This avoids ambiguous path parsing
   * when instanceId happens to be "tables".
   */
  dbContext?: { namespace: string; instanceId?: string };
}

/**
 * Parse a DefaultDbApi path into routing components.
 *
 * Paths follow two patterns:
 *   /api/db/{namespace}/tables/{table}[/rest]                → static DB
 *   /api/db/{namespace}/{instanceId}/tables/{table}[/rest]   → dynamic DB
 *
 * Returns namespace, optional instanceId, tableName, and directPath
 * (everything from /tables/... onward, which D1/PG handlers expect).
 */
/**
 * Parse a DefaultDbApi path, optionally guided by known dbContext.
 *
 * When dbContext is provided (recommended), we know whether this is a
 * static or dynamic DB, so we can unambiguously find the 'tables' keyword
 * even when instanceId === 'tables'.
 *
 * Without dbContext, falls back to heuristic: first 'tables' at index 1
 * means static, at index 2 means dynamic.
 */
function parsePath(
  path: string,
  dbContext?: { namespace: string; instanceId?: string },
): {
  namespace: string;
  instanceId?: string;
  tableName: string;
  directPath: string;
} {
  // Strip leading /api/db/
  const stripped = path.replace(/^\/api\/db\//, '');
  const segments = stripped.split('/');

  let tablesIdx: number;
  if (dbContext) {
    // We know the shape: static has 'tables' at index 1, dynamic at index 2
    tablesIdx = dbContext.instanceId ? 2 : 1;
  } else {
    // Heuristic fallback: find first 'tables' keyword
    tablesIdx = segments.indexOf('tables', 1);
  }
  if (tablesIdx < 0 || segments[tablesIdx] !== 'tables') {
    throw new Error(`Invalid DB path: missing 'tables' segment in ${path}`);
  }

  const namespace = segments[0];
  const instanceId = tablesIdx === 2 ? segments[1] : undefined;
  const rawTableName = segments[tablesIdx + 1];
  // Decode URL-encoded table names (e.g. 'plugin-a%2Fevents' → 'plugin-a/events')
  const tableName = decodeURIComponent(rawTableName);
  const rest = segments.slice(tablesIdx + 2);
  const directPath = `/tables/${rawTableName}${rest.length ? '/' + rest.join('/') : ''}`;

  return { namespace, instanceId, tableName, directPath };
}

export class InternalHttpTransport implements HttpTransport {
  private readonly databaseNamespace: DurableObjectNamespace;
  private readonly config: EdgeBaseConfig;
  private readonly workerUrl?: string;
  private readonly serviceKey?: string;
  private readonly env?: Env;
  private readonly executionCtx?: ExecutionContext;
  private readonly preferDirectDo: boolean;
  private readonly dbContext?: { namespace: string; instanceId?: string };

  constructor(options: InternalTransportOptions) {
    this.databaseNamespace = options.databaseNamespace;
    this.config = options.config;
    this.workerUrl = options.workerUrl;
    this.serviceKey = options.serviceKey;
    this.env = options.env;
    this.executionCtx = options.executionCtx;
    this.preferDirectDo = options.preferDirectDo ?? false;
    this.dbContext = options.dbContext;
  }

  async request<T>(
    method: string,
    path: string,
    options?: { query?: Record<string, string>; body?: unknown },
  ): Promise<T> {
    const { namespace, instanceId, tableName, directPath } = parsePath(path, this.dbContext);
    const doName = getDbDoName(namespace, instanceId);

    // Build internal headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-DO-Name': doName,
      'X-EdgeBase-Internal': 'true',
    };
    if (this.serviceKey) {
      headers['X-EdgeBase-Service-Key'] = this.serviceKey;
    }

    // Convert query Record to URLSearchParams
    const query = new URLSearchParams();
    if (options?.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined && v !== '') query.set(k, v);
      }
    }

    const body = options?.body as Record<string, unknown> | undefined;

    // Route to the appropriate handler
    const res = await this.routeRequest(
      method as 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
      namespace,
      instanceId,
      tableName,
      directPath,
      doName,
      headers,
      query,
      body,
    );

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(String(err.message || `Internal request failed: ${res.status}`));
    }

    return (await res.json()) as T;
  }

  async head(_path: string): Promise<boolean> {
    // HEAD is only used by StorageClient.checkFileExists — not relevant for DB ops
    return false;
  }

  private async routeRequest(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    namespace: string,
    instanceId: string | undefined,
    tableName: string,
    directPath: string,
    doName: string,
    headers: Record<string, string>,
    query: URLSearchParams,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    const queryString = Array.from(query.keys()).length > 0 ? `?${query.toString()}` : '';
    const directPathWithQuery = `${directPath}${queryString}`;
    const provider = this.config.databases?.[namespace]?.provider;
    const httpMethod = method === 'PUT' ? 'PATCH' : method; // normalize PUT → PATCH

    // 1. D1 route
    if (!this.preferDirectDo && shouldRouteToD1(namespace, this.config) && this.env) {
      return this.requestViaD1Handler(httpMethod, namespace, instanceId, tableName, directPath, headers, query, body);
    }

    // 2. PostgreSQL route
    if ((provider === 'neon' || provider === 'postgres') && this.env) {
      return this.requestViaPgHandler(httpMethod, namespace, instanceId, tableName, directPath, headers, query, body);
    }

    // 3. Direct DO route
    if (this.env) {
      return this.requestViaDirectDo(httpMethod, doName, directPathWithQuery, headers, body, !!instanceId);
    }

    // 4. Worker HTTP fallback
    if (this.workerUrl) {
      const apiPath = instanceId
        ? `/api/db/${namespace}/${instanceId}${directPathWithQuery}`
        : `/api/db/${namespace}${directPathWithQuery}`;
      return this.requestViaWorker(httpMethod, apiPath, headers, body);
    }

    // 5. Fallback: direct DO
    return this.requestViaDirectDo(httpMethod, doName, directPathWithQuery, headers, body, !!instanceId);
  }

  private async requestViaWorker(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(`${this.workerUrl}${path}`, {
      method,
      headers,
      body: body === undefined || method === 'GET' || method === 'DELETE'
        ? undefined
        : JSON.stringify(body),
    });
  }

  private async requestViaD1Handler(
    method: string,
    namespace: string,
    instanceId: string | undefined,
    tableName: string,
    directPath: string,
    headers: Record<string, string>,
    query: URLSearchParams,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    if (!this.env) throw new Error('D1 table proxy requires env.');

    const queryString = Array.from(query.keys()).length > 0 ? `?${query.toString()}` : '';
    const url = `http://internal/api/db/${namespace}${instanceId ? `/${instanceId}` : ''}${directPath}${queryString}`;

    const request = new Request(url, {
      method,
      headers,
      body: body === undefined || method === 'GET' || method === 'DELETE'
        ? undefined
        : JSON.stringify(body),
    });

    return handleD1Request(
      buildInternalHandlerContext({ env: this.env, request, body, executionCtx: this.executionCtx }),
      namespace,
      tableName,
      directPath,
    );
  }

  private async requestViaPgHandler(
    method: string,
    namespace: string,
    instanceId: string | undefined,
    tableName: string,
    directPath: string,
    headers: Record<string, string>,
    query: URLSearchParams,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    if (!this.env) throw new Error('PostgreSQL table proxy requires env.');

    const queryString = Array.from(query.keys()).length > 0 ? `?${query.toString()}` : '';
    const url = `http://internal/api/db/${namespace}${instanceId ? `/${instanceId}` : ''}${directPath}${queryString}`;

    const request = new Request(url, {
      method,
      headers,
      body: body === undefined || method === 'GET' || method === 'DELETE'
        ? undefined
        : JSON.stringify(body),
    });

    return handlePgRequest(
      buildInternalHandlerContext({ env: this.env, request, body, executionCtx: this.executionCtx }),
      namespace,
      tableName,
      directPath,
    );
  }

  private async requestViaDirectDo(
    method: string,
    doName: string,
    directPathWithQuery: string,
    headers: Record<string, string>,
    body?: Record<string, unknown>,
    isDynamic?: boolean,
  ): Promise<Response> {
    const res = await callDO(this.databaseNamespace, doName, directPathWithQuery, {
      method,
      body,
      headers,
    });

    // Handle dynamic DO creation
    if (isDynamic && res.status === 201) {
      const createPayload = await res.clone().json().catch(() => null) as
        | { needsCreate?: boolean }
        | null;
      if (createPayload?.needsCreate) {
        return callDO(this.databaseNamespace, doName, directPathWithQuery, {
          method,
          body,
          headers: { ...headers, 'X-DO-Create-Authorized': '1' },
        });
      }
    }

    return res;
  }
}
