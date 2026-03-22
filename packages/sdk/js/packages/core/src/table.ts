/**
 * Collection client with query builder and CRUD operations
 *: filter tuple format
 *: OR filter (.or() chaining)
 *: increment, deleteField
 *: upsert
 *: count
 *: batch-by-filter
 *: batch operations
 * #136: /api/db/{namespace}/tables/{name} URL scheme
 *
 * All HTTP calls delegate to Generated Core (api-core.ts).
 * No hardcoded API paths — the core is the single source of truth.
 */

import type { HttpClient } from './http.js';
import { ApiPaths, type GeneratedDbApi } from './generated/api-core.js';
import { serializeFieldOps } from './field-ops.js';
import { EdgeBaseError } from './errors.js';
import type { IDatabaseLiveSubscriber, IDbChange, FilterMatchFn, Subscription } from './types.js';

/** Filter tuple: [field, operator, value] */
export type FilterTuple = [string, string, unknown];

/**
 * Query result — unified type for both offset and cursor pagination.
 *: SDK ListResult unification + cursor pagination support.
 *
 * Offset mode (default):  total/page/perPage are populated, hasMore/cursor are null.
 * Cursor mode (.after/.before): hasMore/cursor are populated, total/page/perPage are null.
 * Rules-filtered mode:    total is null, hasMore/cursor are populated.
 */
export interface ListResult<T> {
  items: T[];
  total: number | null;
  page: number | null;
  perPage: number | null;
  hasMore: boolean | null;
  cursor: string | null;
}

/** Snapshot delivered by TableRef.onSnapshot() */
export interface TableSnapshot<T> {
  items: T[];
  changes: {
    added: T[];
    modified: T[];
    removed: T[];
  };
}

/** Upsert result */
export interface UpsertResult<T> {
  item: T;
  action: 'inserted' | 'updated';
}

/** Batch-by-filter result */
export interface BatchByFilterResult {
  totalProcessed: number;
  totalSucceeded: number;
  errors: Array<{ chunkIndex: number; chunkSize: number; error: EdgeBaseError }>;
}

// ─── Database Live Channel Builder ───

/**
 * Build the database-live channel for a DB table. (§10)
 *   Static DB:  dblive:shared:posts
 *   Dynamic DB: dblive:workspace:ws-456:documents
 *   Single doc: dblive:shared:posts:{docId}
 */
function buildDatabaseLiveChannel(namespace: string, instanceId: string | undefined, tableName: string, docId?: string): string {
  const base = instanceId
    ? `dblive:${namespace}:${instanceId}:${tableName}`
    : `dblive:${namespace}:${tableName}`;
  return docId ? `${base}:${docId}` : base;
}

function evaluateFilterCondition(
  fieldValue: unknown,
  operator: string,
  expected: unknown,
): boolean {
  switch (operator) {
    case '==':
      return fieldValue === expected;
    case '!=':
      return fieldValue !== expected;
    case '<':
      return (fieldValue as number) < (expected as number);
    case '>':
      return (fieldValue as number) > (expected as number);
    case '<=':
      return (fieldValue as number) <= (expected as number);
    case '>=':
      return (fieldValue as number) >= (expected as number);
    case 'contains':
      if (typeof fieldValue === 'string') return fieldValue.includes(expected as string);
      if (Array.isArray(fieldValue)) return fieldValue.includes(expected);
      return false;
    case 'contains-any':
      if (!Array.isArray(fieldValue) || !Array.isArray(expected)) return false;
      return expected.some((value) => fieldValue.includes(value));
    case 'in':
      return Array.isArray(expected) ? expected.includes(fieldValue) : false;
    case 'not in':
      return Array.isArray(expected) ? !expected.includes(fieldValue) : true;
    default:
      return false;
  }
}

function matchesAllFilters(
  data: Record<string, unknown>,
  filters: FilterTuple[],
  filterMatchFn?: FilterMatchFn,
): boolean {
  if (filters.length === 0) return true;
  if (filterMatchFn) {
    return filterMatchFn(data, filters);
  }
  return filters.every(([field, operator, value]) =>
    evaluateFilterCondition(data[field], operator, value),
  );
}

function matchesAnyFilter(
  data: Record<string, unknown>,
  filters: FilterTuple[],
  filterMatchFn?: FilterMatchFn,
): boolean {
  if (filters.length === 0) return true;
  if (filterMatchFn) {
    return filters.some((filter) => filterMatchFn(data, [filter]));
  }
  return filters.some(([field, operator, value]) =>
    evaluateFilterCondition(data[field], operator, value),
  );
}

function matchesSnapshotFilters(
  data: Record<string, unknown>,
  filters: FilterTuple[],
  orFilters: FilterTuple[],
  filterMatchFn?: FilterMatchFn,
): boolean {
  if (!matchesAllFilters(data, filters, filterMatchFn)) {
    return false;
  }
  if (orFilters.length === 0) {
    return true;
  }
  return matchesAnyFilter(data, orFilters, filterMatchFn);
}

// ─── Core dispatch helpers ───

/** Call the correct generated core method based on static vs dynamic DB. */
function coreGet<T>(
  core: GeneratedDbApi,
  method: 'list' | 'get' | 'count' | 'search',
  namespace: string,
  instanceId: string | undefined,
  table: string,
  args: { id?: string; query?: Record<string, string> },
): Promise<T> {
  const tablePath = encodeURIComponent(table);
  const q = args.query ?? {};
  if (instanceId) {
    // Dynamic DB
    switch (method) {
      case 'list': return core.dbListRecords(namespace, instanceId, tablePath, q) as Promise<T>;
      case 'get': return core.dbGetRecord(namespace, instanceId, tablePath, args.id!, q) as Promise<T>;
      case 'count': return core.dbCountRecords(namespace, instanceId, tablePath, q) as Promise<T>;
      case 'search': return core.dbSearchRecords(namespace, instanceId, tablePath, q) as Promise<T>;
    }
  }
  // Single-instance DB
  switch (method) {
    case 'list': return core.dbSingleListRecords(namespace, tablePath, q) as Promise<T>;
    case 'get': return core.dbSingleGetRecord(namespace, tablePath, args.id!, q) as Promise<T>;
    case 'count': return core.dbSingleCountRecords(namespace, tablePath, q) as Promise<T>;
    case 'search': return core.dbSingleSearchRecords(namespace, tablePath, q) as Promise<T>;
  }
}

function coreInsert<T>(
  core: GeneratedDbApi,
  namespace: string,
  instanceId: string | undefined,
  table: string,
  body: unknown,
  query: Record<string, string> = {},
): Promise<T> {
  const tablePath = encodeURIComponent(table);
  if (instanceId) {
    return core.dbInsertRecord(namespace, instanceId, tablePath, body, query) as Promise<T>;
  }
  return core.dbSingleInsertRecord(namespace, tablePath, body, query) as Promise<T>;
}

function coreUpdate<T>(
  core: GeneratedDbApi,
  namespace: string,
  instanceId: string | undefined,
  table: string,
  id: string,
  body: unknown,
): Promise<T> {
  const tablePath = encodeURIComponent(table);
  if (instanceId) {
    return core.dbUpdateRecord(namespace, instanceId, tablePath, id, body) as Promise<T>;
  }
  return core.dbSingleUpdateRecord(namespace, tablePath, id, body) as Promise<T>;
}

function coreDelete<T>(
  core: GeneratedDbApi,
  namespace: string,
  instanceId: string | undefined,
  table: string,
  id: string,
): Promise<T> {
  const tablePath = encodeURIComponent(table);
  if (instanceId) {
    return core.dbDeleteRecord(namespace, instanceId, tablePath, id) as Promise<T>;
  }
  return core.dbSingleDeleteRecord(namespace, tablePath, id) as Promise<T>;
}

function coreBatch<T>(
  core: GeneratedDbApi,
  namespace: string,
  instanceId: string | undefined,
  table: string,
  body: unknown,
  query: Record<string, string> = {},
): Promise<T> {
  const tablePath = encodeURIComponent(table);
  if (instanceId) {
    return core.dbBatchRecords(namespace, instanceId, tablePath, body, query) as Promise<T>;
  }
  return core.dbSingleBatchRecords(namespace, tablePath, body, query) as Promise<T>;
}

function coreBatchByFilter<T>(
  core: GeneratedDbApi,
  namespace: string,
  instanceId: string | undefined,
  table: string,
  body: unknown,
  query: Record<string, string> = {},
): Promise<T> {
  const tablePath = encodeURIComponent(table);
  if (instanceId) {
    return core.dbBatchByFilter(namespace, instanceId, tablePath, body, query) as Promise<T>;
  }
  return core.dbSingleBatchByFilter(namespace, tablePath, body, query) as Promise<T>;
}

// ─── DocRef ───

/**
 * Document reference for single-record operations.
 * Created via `client.db('shared').table('posts').doc('post-1')`
 */
export class DocRef<T = Record<string, unknown>> {
  constructor(
    private core: GeneratedDbApi,
    private namespace: string,
    private instanceId: string | undefined,
    private tableName: string,
    private id: string,
    private databaseLiveClient?: IDatabaseLiveSubscriber,
    private filterMatchFn?: FilterMatchFn,
  ) {}

  /** Get a single record */
  async get(): Promise<T> {
    return coreGet<T>(this.core, 'get', this.namespace, this.instanceId, this.tableName, { id: this.id, query: {} });
  }

  /** Update a record (supports increment, deleteField) */
  async update(data: Partial<T>): Promise<T> {
    const serialized = serializeFieldOps(data as Record<string, unknown>);
    return coreUpdate<T>(this.core, this.namespace, this.instanceId, this.tableName, this.id, serialized);
  }

  /** Delete a record */
  async delete(): Promise<void> {
    await coreDelete(this.core, this.namespace, this.instanceId, this.tableName, this.id);
  }

  /**
   * Subscribe to database-live changes for this document.
   * Returns an unsubscribe function.
   *
   * @example
   * const unsub = client.db('shared').table('posts').doc('post-1').onSnapshot((post) => {
   *   console.log('Post updated:', post);
   * });
   */
  onSnapshot(callback: (data: T | null, change: IDbChange<T>) => void): Subscription {
    if (!this.databaseLiveClient) {
      throw new EdgeBaseError(500, 'IDatabaseLiveSubscriber not available');
    }

    const channel = buildDatabaseLiveChannel(this.namespace, this.instanceId, this.tableName, this.id);
    return this.databaseLiveClient.onSnapshot<T>(channel, (change) => {
      callback(change.data as T | null, change);
    });
  }
}

// ─── TableRef ───

/**
 * Collection reference with query builder (immutable chaining).
 * Created via `client.db('shared').table('posts')`
 *
 * @example
 * const result = await client.db('shared').table('posts')
 *   .where('status', '==', 'published')
 *   .orderBy('createdAt', 'desc')
 *   .limit(20)
 *   .getList();
 */
export class TableRef<T = Record<string, unknown>> {
  private filters: FilterTuple[] = [];
  private orFilters: FilterTuple[] = []; //: OR conditions
  private sorts: [string, 'asc' | 'desc'][] = [];
  private limitValue?: number;
  private offsetValue?: number;
  private pageValue?: number;
  private searchQuery?: string;
  private afterCursor?: string;
  private beforeCursor?: string;

  constructor(
    private core: GeneratedDbApi,
    /** Table name within the DB block */
    private name: string,
    private databaseLiveClient?: IDatabaseLiveSubscriber,
    private filterMatchFn?: FilterMatchFn,
    /** DB namespace: 'shared' | 'workspace' | 'user' | ... (§2) */
    private namespace: string = 'shared',
    /** DB instance ID for dynamic DOs (e.g. 'ws-456'). Omit for static DBs. */
    private instanceId?: string,
    /**
     * Raw HttpClient — only used for sql() which is admin-only and not in client core.
     * TODO: remove once admin core is wired.
     */
    private _httpClient?: HttpClient,
  ) {}

  /** Create a clone with current state (for immutable chaining) */
  private clone(): TableRef<T> {
    const ref = new TableRef<T>(this.core, this.name, this.databaseLiveClient, this.filterMatchFn, this.namespace, this.instanceId, this._httpClient);
    ref.filters = [...this.filters];
    ref.orFilters = [...this.orFilters];
    ref.sorts = [...this.sorts];
    ref.limitValue = this.limitValue;
    ref.offsetValue = this.offsetValue;
    ref.pageValue = this.pageValue;
    ref.searchQuery = this.searchQuery;
    ref.afterCursor = this.afterCursor;
    ref.beforeCursor = this.beforeCursor;
    return ref;
  }

  /** Add a filter condition */
  where(field: string, operator: string, value: unknown): TableRef<T> {
    const ref = this.clone();
    ref.filters.push([field, operator, value]);
    return ref;
  }

  /**
   * Add OR conditions.
   * Conditions inside the builder are joined with OR.
   *
   * @example
   * client.db('shared').table('posts')
   *   .where('createdAt', '>', '2025-01-01') // AND
   *   .or(q => q.where('status', '==', 'draft').where('status', '==', 'archived')) // OR
   *   .getList()
   */
  or(builder: (q: OrBuilder) => OrBuilder): TableRef<T> {
    const ref = this.clone();
    const orBuilder = new OrBuilder();
    builder(orBuilder);
    ref.orFilters = [...ref.orFilters, ...orBuilder.getFilters()];
    return ref;
  }

  /** Add sort order (supports multiple — chained calls accumulate) */
  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): TableRef<T> {
    const ref = this.clone();
    ref.sorts.push([field, direction]);
    return ref;
  }

  /** Set result limit */
  limit(n: number): TableRef<T> {
    const ref = this.clone();
    ref.limitValue = n;
    return ref;
  }

  /** Set result offset */
  offset(n: number): TableRef<T> {
    const ref = this.clone();
    ref.offsetValue = n;
    return ref;
  }

  /** Set page number for offset pagination (1-based) */
  page(n: number): TableRef<T> {
    const ref = this.clone();
    ref.pageValue = n;
    return ref;
  }


  /** Set full-text search query */
  search(query: string): TableRef<T> {
    const ref = this.clone();
    ref.searchQuery = query;
    return ref;
  }

  /**
   * Set cursor for forward pagination.
   * Fetches records with id > cursor. Mutually exclusive with page()/offset().
   */
  after(cursor: string): TableRef<T> {
    const ref = this.clone();
    ref.afterCursor = cursor;
    ref.beforeCursor = undefined;
    return ref;
  }

  /**
   * Set cursor for backward pagination.
   * Fetches records with id < cursor. Mutually exclusive with page()/offset().
   */
  before(cursor: string): TableRef<T> {
    const ref = this.clone();
    ref.beforeCursor = cursor;
    ref.afterCursor = undefined;
    return ref;
  }

  /** Build query parameters from current state */
  private buildQueryParams(): Record<string, string> {
    //: offset/cursor mutual exclusion
    const hasCursor = this.afterCursor !== undefined || this.beforeCursor !== undefined;
    const hasOffset = this.offsetValue !== undefined || this.pageValue !== undefined;
    if (hasCursor && hasOffset) {
      throw new EdgeBaseError(400, 'Cannot use page()/offset() with after()/before() — choose offset or cursor pagination');
    }

    const query: Record<string, string> = {};
    if (this.filters.length > 0) {
      query.filter = JSON.stringify(this.filters);
    }
    if (this.orFilters.length > 0) {
      query.orFilter = JSON.stringify(this.orFilters);
    }
    if (this.sorts.length > 0) {
      query.sort = this.sorts.map(([f, d]) => `${f}:${d}`).join(',');
    }
    if (this.limitValue !== undefined) {
      query.limit = String(this.limitValue);
    }
    if (this.pageValue !== undefined) {
      query.page = String(this.pageValue);
    }
    if (this.offsetValue !== undefined) {
      query.offset = String(this.offsetValue);
    }
    if (this.afterCursor !== undefined) {
      query.after = this.afterCursor;
    }
    if (this.beforeCursor !== undefined) {
      query.before = this.beforeCursor;
    }
    return query;
  }

  /** Get a document reference for single-record operations */
  doc(id: string): DocRef<T> {
    return new DocRef<T>(this.core, this.namespace, this.instanceId, this.name, id, this.databaseLiveClient, this.filterMatchFn);
  }

  // ─── CRUD Methods ───

  /**
   * List records with filters, sorting, and pagination.
   * Parses server response into unified ListResult with both offset and cursor fields.
   */
  async getList(): Promise<ListResult<T>> {
    const query = this.buildQueryParams();
    let data: Record<string, unknown>;
    if (this.searchQuery) {
      query.search = this.searchQuery;
      data = await coreGet<Record<string, unknown>>(this.core, 'search', this.namespace, this.instanceId, this.name, { query });
    } else {
      data = await coreGet<Record<string, unknown>>(this.core, 'list', this.namespace, this.instanceId, this.name, { query });
    }
    return {
      items: (data.items ?? []) as T[],
      total: data.total !== undefined ? data.total as number | null : null,
      page: data.page !== undefined ? data.page as number : null,
      perPage: data.perPage !== undefined ? data.perPage as number : null,
      hasMore: data.hasMore !== undefined ? data.hasMore as boolean : null,
      cursor: data.cursor !== undefined ? data.cursor as string : null,
    };
  }

  /** Get a single record by ID. Use getList() for listing records. */
  async getOne(id: string): Promise<T> {
    return coreGet<T>(this.core, 'get', this.namespace, this.instanceId, this.name, { id, query: {} });
  }

  /**
   * Get the first record matching the current query conditions.
   * Returns null if no records match.
   *
   * @example
   * const user = await client.db('shared').table('users')
   *   .where('email', '==', 'june@example.com')
   *   .getFirst();
   */
  async getFirst(): Promise<T | null> {
    const result = await this.limit(1).getList();
    return result.items[0] ?? null;
  }

  /** Insert a new record */
  async insert(data: Partial<T>): Promise<T> {
    return coreInsert<T>(this.core, this.namespace, this.instanceId, this.name, data);
  }

  /** Update a record by ID (supports increment, deleteField) */
  async update(id: string, data: Partial<T>): Promise<T> {
    const serialized = serializeFieldOps(data as Record<string, unknown>);
    return coreUpdate<T>(this.core, this.namespace, this.instanceId, this.name, id, serialized);
  }

  /** Delete a record by ID */
  async delete(id: string): Promise<void> {
    await coreDelete(this.core, this.namespace, this.instanceId, this.name, id);
  }

  // ─── Special Methods ───

  /** Upsert: insert or update */
  async upsert(data: Partial<T>, options?: { conflictTarget?: string }): Promise<T & { action: 'inserted' | 'updated' }> {
    const query: Record<string, string> = { upsert: 'true' };
    if (options?.conflictTarget) query.conflictTarget = options.conflictTarget;
    return coreInsert<T & { action: 'inserted' | 'updated' }>(this.core, this.namespace, this.instanceId, this.name, data, query);
  }

  /** Batch upsert */
  async upsertMany(items: Array<Partial<T>>, options?: { conflictTarget?: string }): Promise<T[]> {
    const CHUNK_SIZE = 500;
    const query: Record<string, string> = { upsert: 'true' };
    if (options?.conflictTarget) query.conflictTarget = options.conflictTarget;

    // Fast path: no chunking needed
    if (items.length <= CHUNK_SIZE) {
      const result = await coreBatch<{ inserted: T[] }>(this.core, this.namespace, this.instanceId, this.name, { inserts: items }, query);
      return result.inserted;
    }

    // Chunk into 500-item batches
    const allInserted: T[] = [];
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      const result = await coreBatch<{ inserted: T[] }>(this.core, this.namespace, this.instanceId, this.name, { inserts: chunk }, query);
      allInserted.push(...result.inserted);
    }
    return allInserted;
  }

  /** Count records matching filters */
  async count(): Promise<number> {
    const query = this.buildQueryParams();
    const result = await coreGet<{ total: number }>(this.core, 'count', this.namespace, this.instanceId, this.name, { query });
    return result.total;
  }

  /**
   * Batch insert.
   * Auto-chunks into 500-item batches.
   * Each chunk is an independent transaction — partial failure possible across chunks.
   */
  async insertMany(items: Array<Partial<T>>): Promise<T[]> {
    const CHUNK_SIZE = 500;

    // Fast path: no chunking needed
    if (items.length <= CHUNK_SIZE) {
      const result = await coreBatch<{ inserted: T[] }>(this.core, this.namespace, this.instanceId, this.name, { inserts: items });
      return result.inserted;
    }

    // Chunk into 500-item batches
    const allInserted: T[] = [];
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      const result = await coreBatch<{ inserted: T[] }>(this.core, this.namespace, this.instanceId, this.name, { inserts: chunk });
      allInserted.push(...result.inserted);
    }
    return allInserted;
  }

  /**
   * Batch update matching records.
   * Processes 500 records per call, max 100 iterations.
   */
  async updateMany(data: Partial<T>): Promise<BatchByFilterResult> {
    const filter = this.filters;
    if (filter.length === 0) {
      throw new EdgeBaseError(400, 'updateMany requires at least one where() filter');
    }

    const serialized = serializeFieldOps(data as Record<string, unknown>);
    return this.batchByFilter('update', filter, serialized);
  }

  /**
   * Batch delete matching records.
   * Processes 500 records per call, max 100 iterations.
   */
  async deleteMany(): Promise<BatchByFilterResult> {
    const filter = this.filters;
    if (filter.length === 0) {
      throw new EdgeBaseError(400, 'deleteMany requires at least one where() filter');
    }

    return this.batchByFilter('delete', filter);
  }

  /** Internal: batch-by-filter calls */
  private async batchByFilter(
    action: 'update' | 'delete',
    filter: FilterTuple[],
    update?: Record<string, unknown>,
  ): Promise<BatchByFilterResult> {
    const MAX_ITERATIONS = 100;
    let totalProcessed = 0;
    let totalSucceeded = 0;
    const errors: Array<{ chunkIndex: number; chunkSize: number; error: EdgeBaseError }> = [];

    for (let chunkIndex = 0; chunkIndex < MAX_ITERATIONS; chunkIndex++) {
      try {
        const body: Record<string, unknown> = { action, filter, limit: 500 };
        if (this.orFilters.length > 0) body.orFilter = this.orFilters;
        if (action === 'update' && update) {
          body.update = update;
        }
        const result = await coreBatchByFilter<{ processed: number; succeeded: number }>(
          this.core, this.namespace, this.instanceId, this.name, body,
        );
        totalProcessed += result.processed;
        totalSucceeded += result.succeeded;

        if (result.processed === 0) break; // No more matching records

        // For 'update', don't loop — updated records still match the filter,
        // so re-querying would process the same rows again (infinite loop).
        // Only 'delete' benefits from looping since deleted rows disappear.
        if (action === 'update') break;
      } catch (error) {
        errors.push({ chunkIndex, chunkSize: 500, error: error as EdgeBaseError });
        break; // Stop on error (partial failure)
      }
    }

    return { totalProcessed, totalSucceeded, errors };
  }

  // ─── Database Live ───

  /**
   * Subscribe to table changes via database-live.
   * By default, client-side filtering is applied for where() conditions.
   * With `{ serverFilter: true }`, filters are evaluated server-side for bandwidth savings.
   * Returns an unsubscribe function.
   *
   * @example
   * // Client-side filtering (default)
   * const unsub = client.db('shared').table('posts')
   *   .where('status', '==', 'published')
   *   .onSnapshot((snapshot) => {
   *     console.log('Updated posts:', snapshot.items);
   *   });
   */
  onSnapshot(
    callback: (snapshot: TableSnapshot<T>) => void,
    options?: { serverFilter?: boolean },
  ): Subscription {
    if (!this.databaseLiveClient) {
      throw new EdgeBaseError(500, 'IDatabaseLiveSubscriber not available');
    }

    const channel = buildDatabaseLiveChannel(this.namespace, this.instanceId, this.name);
    const currentFilters = [...this.filters];
    const currentOrFilters = [...this.orFilters];
    const useServerFilter = options?.serverFilter === true && (currentFilters.length > 0 || currentOrFilters.length > 0);

    // Accumulate state locally
    const items = new Map<string, T>();
    const pendingChanges: { added: T[]; modified: T[]; removed: T[] } = { added: [], modified: [], removed: [] };
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (pendingChanges.added.length || pendingChanges.modified.length || pendingChanges.removed.length) {
        callback({
          items: Array.from(items.values()),
          changes: { ...pendingChanges },
        });
        pendingChanges.added = [];
        pendingChanges.modified = [];
        pendingChanges.removed = [];
      }
      flushTimer = null;
    };

    const scheduleFlush = () => {
      if (!flushTimer) {
        flushTimer = setTimeout(flush, 0);
      }
    };

    return this.databaseLiveClient.onSnapshot<T>(
      channel,
      (change) => {
        const data = change.data as Record<string, unknown> | null;
        const docId = change.docId;
        const hasFilterConstraints = currentFilters.length > 0 || currentOrFilters.length > 0;
        const hadItem = items.has(docId);

        // Client-side filtering — always applied as safety net, even when server filter is active
        if (hasFilterConstraints) {
          if (change.changeType === 'removed') {
            if (!hadItem) return;
          } else if (!data || !matchesSnapshotFilters(data, currentFilters, currentOrFilters, this.filterMatchFn)) {
            if (hadItem) {
              const lastKnown = items.get(docId);
              items.delete(docId);
              pendingChanges.removed.push((data ?? lastKnown ?? { id: docId }) as T);
              scheduleFlush();
            }
            return;
          }
        }

        switch (change.changeType) {
          case 'added':
            if (data) items.set(docId, data as T);
            pendingChanges[hadItem ? 'modified' : 'added'].push(data as T);
            break;
          case 'modified':
            if (data) items.set(docId, data as T);
            pendingChanges[hadItem ? 'modified' : 'added'].push(data as T);
            break;
          case 'removed': {
            const lastKnown = items.get(docId);
            items.delete(docId);
            pendingChanges.removed.push((data ?? lastKnown ?? { id: docId }) as T);
            break;
          }
        }

        scheduleFlush();
      },
      undefined, // client-side filters (not used for server-side)
      useServerFilter ? currentFilters : undefined, // server-side filters
      useServerFilter ? currentOrFilters : undefined, // server-side OR filters
    );
  }

  /**
   * Execute raw SQL on this table's DO.
   * Tagged template — interpolated values are automatically extracted as bind params,
   * preventing SQL injection.
   *
   * NOTE: Admin-only (/api/sql). Uses raw HttpClient since this endpoint is
   * in the admin core, not the client core. Requires Service Key auth.
   *
   * @example
   * // In App Functions or server-side code
   * const results = await context.admin.db('shared').table('posts').sql`
   *   SELECT p.*, COUNT(c.id) as commentCount
   *   FROM posts p LEFT JOIN comments c ON c.postId = p.id
   *   WHERE p.status = ${'published'}
   *   GROUP BY p.id
   * `;
   */
  async sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
    if (!this._httpClient) {
      throw new EdgeBaseError(500, 'sql() requires HttpClient (admin-only method). Use context.admin.db(...).table(...).sql`...`');
    }
    // Build parameterized query from tagged template — each ${} becomes ?
    let query = '';
    const params: unknown[] = [];
    for (let i = 0; i < strings.length; i++) {
      query += strings[i];
      if (i < values.length) {
        query += '?';
        params.push(values[i]);
      }
    }
    // §11: body uses { namespace, id, sql, params }
    // /api/sql is admin-only, tagged 'admin', lives in admin core — not client core.
    return this._httpClient.post<unknown[]>(ApiPaths.EXECUTE_SQL, {
      namespace: this.namespace,
      id: this.instanceId,
      sql: query.trim(),
      params,
    });
  }
}

// ─── DbRef ───

/**
 * DB block reference. Returned by `client.db(namespace, id?)`.
 * Provides `.table(name)` to get a TableRef for a specific table.
 *
 * @example
 * // Static shared DB
 * const postsRef = client.db('shared').table('posts');
 *
 * // Dynamic workspace DB
 * const docsRef = client.db('workspace', 'ws-456').table('documents');
 */
export class DbRef {
  constructor(
    private core: GeneratedDbApi,
    /** DB namespace: 'shared' | 'workspace' | 'user' | ... */
    private namespace: string,
    /** DB instance ID for dynamic DOs (e.g. 'ws-456'). Omit for static DBs. */
    private instanceId?: string,
    private databaseLiveClient?: IDatabaseLiveSubscriber,
    private filterMatchFn?: FilterMatchFn,
    /**
     * Raw HttpClient — only passed through to TableRef for sql().
     * TODO: remove once admin core is wired.
     */
    private _httpClient?: HttpClient,
  ) {}

  /**
   * Select a table within this DB block.
   * Returns a TableRef configured with the correct namespace/instanceId.
   *
   * @param name — Table name (as defined in config.databases[namespace].tables)
   */
  table<T = Record<string, unknown>>(name: string): TableRef<T> {
    return new TableRef<T>(
      this.core,
      name,
      this.databaseLiveClient,
      this.filterMatchFn,
      this.namespace,
      this.instanceId,
      this._httpClient,
    );
  }
}

// ─── OrBuilder ───

/**
 * Builder for OR conditions.
 * Used with .or() method on TableRef.
 *
 * @example
 * client.db('shared').table('posts')
 *   .or(q => q.where('status', '==', 'draft').where('authorId', '==', 'user-123'))
 *   .getList()
 */
export class OrBuilder {
  private filters: FilterTuple[] = [];

  where(field: string, operator: string, value: unknown): OrBuilder {
    this.filters.push([field, operator, value]);
    return this;
  }

  getFilters(): FilterTuple[] {
    return [...this.filters];
  }
}
