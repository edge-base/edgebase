/**
 * KvClient — SDK client for user-defined KV namespaces
 *
 * Usage:
 *   const admin = createAdminClient(url, { serviceKey });
 *   await admin.kv('cache').set('key', 'value', { ttl: 300 });
 *   const val = await admin.kv('cache').get('key');
 */
import type { HttpClient } from '@edgebase/core';
import { HttpClientAdapter } from '@edgebase/core';
import { DefaultAdminApi } from './generated/admin-api-core.js';

export class KvClient {
  private adminCore: DefaultAdminApi;
  private namespace: string;

  constructor(httpClient: HttpClient, namespace: string) {
    this.adminCore = new DefaultAdminApi(new HttpClientAdapter(httpClient));
    this.namespace = namespace;
  }

  /** Get a value by key. Returns null if key doesn't exist. */
  async get(key: string): Promise<string | null> {
    const res = await this.adminCore.kvOperation(this.namespace, {
      action: 'get',
      key,
    }) as { value: string | null };
    return res.value;
  }

  /** Set a key-value pair with optional TTL in seconds. */
  async set(key: string, value: string, options?: { ttl?: number }): Promise<void> {
    await this.adminCore.kvOperation(this.namespace, {
      action: 'set',
      key,
      value,
      ttl: options?.ttl,
    });
  }

  /** Delete a key. */
  async delete(key: string): Promise<void> {
    await this.adminCore.kvOperation(this.namespace, {
      action: 'delete',
      key,
    });
  }

  /** List keys with optional prefix, limit, and cursor for pagination. */
  async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: string[]; cursor?: string }> {
    return this.adminCore.kvOperation(this.namespace, {
      action: 'list',
      ...options,
    }) as Promise<{ keys: string[]; cursor?: string }>;
  }
}
