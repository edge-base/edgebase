/**
 * VectorizeClient — SDK client for user-defined Vectorize indexes
 *
 * Usage:
 *   const admin = createAdminClient(url, { serviceKey });
 *   await admin.vector('embeddings').upsert([{ id: 'doc-1', values: [...], metadata: { title: 'Hello' } }]);
 *   const results = await admin.vector('embeddings').search([0.1, 0.2, ...], { topK: 10 });
 *
 * Note: Vectorize is Cloudflare Edge-only. In local/Docker, the server returns stub responses.
 */
import type { HttpClient } from '@edge-base/core';
import { HttpClientAdapter } from '@edge-base/core';
import { DefaultAdminApi } from './generated/admin-api-core.js';

export interface VectorSearchOptions {
  topK?: number;
  filter?: Record<string, unknown>;
  namespace?: string;
  returnValues?: boolean;
  returnMetadata?: boolean | 'all' | 'indexed' | 'none';
}

export interface VectorSearchResult {
  id: string;
  score: number;
  values?: number[];
  metadata?: Record<string, unknown>;
  namespace?: string;
}

export interface VectorResult {
  id: string;
  values?: number[];
  metadata?: Record<string, unknown>;
  namespace?: string;
}

export interface VectorMutationResult {
  ok: true;
  count?: number;
  mutationId?: string;
}

export interface VectorIndexInfo {
  vectorCount: number;
  dimensions: number;
  metric: string;
  id?: string;
  name?: string;
  processedUpToDatetime?: string;
  processedUpToMutation?: string;
}

export class VectorizeClient {
  private adminCore: DefaultAdminApi;
  private index: string;

  constructor(httpClient: HttpClient, index: string) {
    this.adminCore = new DefaultAdminApi(new HttpClientAdapter(httpClient));
    this.index = index;
  }

  /** Insert or update vectors. */
  async upsert(vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown>; namespace?: string }>): Promise<VectorMutationResult> {
    const res = await this.adminCore.vectorizeOperation(this.index, { action: 'upsert', vectors });
    return res as VectorMutationResult;
  }

  /** Insert vectors (errors on duplicate ID). */
  async insert(vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown>; namespace?: string }>): Promise<VectorMutationResult> {
    const res = await this.adminCore.vectorizeOperation(this.index, { action: 'insert', vectors });
    return res as VectorMutationResult;
  }

  /** Search for similar vectors. */
  async search(
    vector: number[],
    options?: VectorSearchOptions,
  ): Promise<VectorSearchResult[]> {
    const body: Record<string, unknown> = {
      action: 'search',
      vector,
      topK: options?.topK,
      filter: options?.filter,
    };
    if (options?.namespace !== undefined) body.namespace = options.namespace;
    if (options?.returnValues !== undefined) body.returnValues = options.returnValues;
    if (options?.returnMetadata !== undefined) body.returnMetadata = options.returnMetadata;

    const res = await this.adminCore.vectorizeOperation(this.index, body) as { matches: VectorSearchResult[] };
    return res.matches;
  }

  /** Search by an existing vector's ID (Vectorize v2 only). */
  async queryById(
    vectorId: string,
    options?: VectorSearchOptions,
  ): Promise<VectorSearchResult[]> {
    const body: Record<string, unknown> = {
      action: 'queryById',
      vectorId,
      topK: options?.topK,
      filter: options?.filter,
    };
    if (options?.namespace !== undefined) body.namespace = options.namespace;
    if (options?.returnValues !== undefined) body.returnValues = options.returnValues;
    if (options?.returnMetadata !== undefined) body.returnMetadata = options.returnMetadata;

    const res = await this.adminCore.vectorizeOperation(this.index, body) as { matches: VectorSearchResult[] };
    return res.matches;
  }

  /** Retrieve vectors by their IDs. */
  async getByIds(ids: string[]): Promise<VectorResult[]> {
    const res = await this.adminCore.vectorizeOperation(this.index, { action: 'getByIds', ids }) as { vectors: VectorResult[] };
    return res.vectors;
  }

  /** Delete vectors by IDs. */
  async delete(ids: string[]): Promise<VectorMutationResult> {
    const res = await this.adminCore.vectorizeOperation(this.index, { action: 'delete', ids });
    return res as VectorMutationResult;
  }

  /** Get index info (vector count, dimensions, metric). */
  async describe(): Promise<VectorIndexInfo> {
    const res = await this.adminCore.vectorizeOperation(this.index, { action: 'describe' });
    return res as VectorIndexInfo;
  }
}
