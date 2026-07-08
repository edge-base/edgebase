/**
 * Record cache — a small, generic browser-side store for stale-while-revalidate
 * record hydration (the local-first "record cache" layer).
 *
 * Apps mirror server-fetched record sets into named tables (wholesale replace
 * per table keeps reconcile semantics trivial: the server response is the
 * truth for that table) plus arbitrary meta blobs (bootstrap payloads, per-table
 * sync stamps). On startup the app renders from the cache instantly, refetches
 * in the background, and re-persists the fresh result.
 *
 * Safety: the cache is versioned — constructing a `RecordCache` whose
 * `schemaVersion` differs from what is on disk wipes the store before first
 * use (nuke-and-refetch beats reading records with a stale shape). Adapters
 * follow the same pattern as `durable-outbox.ts`: IndexedDB in production,
 * memory for SSR/tests/storage-denied browsers.
 */

export interface RecordCacheRecord<V = unknown> {
  id: string;
  value: V;
}

export interface RecordCacheAdapter {
  clear(): Promise<void>;
  getMeta(key: string): Promise<unknown>;
  listTable(table: string): Promise<RecordCacheRecord[]>;
  putRecords(table: string, records: RecordCacheRecord[]): Promise<void>;
  removeMeta(key: string): Promise<void>;
  removeRecords(table: string, ids: string[]): Promise<void>;
  /** Atomically drop every record in `table` and write `records` instead. */
  replaceTable(table: string, records: RecordCacheRecord[]): Promise<void>;
  setMeta(key: string, value: unknown): Promise<void>;
}

// ── memory adapter ──────────────────────────────────────────────────────────

export function createMemoryRecordCacheAdapter(): RecordCacheAdapter {
  const tables = new Map<string, Map<string, unknown>>();
  const meta = new Map<string, unknown>();
  const tableOf = (name: string) => {
    let table = tables.get(name);
    if (!table) {
      table = new Map();
      tables.set(name, table);
    }
    return table;
  };
  return {
    async clear() {
      tables.clear();
      meta.clear();
    },
    async getMeta(key) {
      return meta.get(key);
    },
    async listTable(table) {
      return [...tableOf(table).entries()].map(([id, value]) => ({ id, value }));
    },
    async putRecords(table, records) {
      const target = tableOf(table);
      for (const record of records) target.set(record.id, record.value);
    },
    async removeMeta(key) {
      meta.delete(key);
    },
    async removeRecords(table, ids) {
      const target = tableOf(table);
      for (const id of ids) target.delete(id);
    },
    async replaceTable(table, records) {
      const next = new Map<string, unknown>();
      for (const record of records) next.set(record.id, record.value);
      tables.set(table, next);
    },
    async setMeta(key, value) {
      meta.set(key, value);
    },
  };
}

// ── IndexedDB adapter ───────────────────────────────────────────────────────

const RECORD_STORE = 'records';
const META_STORE = 'meta';
const TABLE_INDEX = 'byTable';

interface StoredRecord {
  id: string;
  key: string;
  table: string;
  value: unknown;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted.'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
  });
}

function resolveIndexedDb(factory?: IDBFactory): IDBFactory | null {
  if (factory) return factory;
  try {
    const candidate = (globalThis as { indexedDB?: unknown }).indexedDB;
    return candidate && typeof (candidate as IDBFactory).open === 'function'
      ? (candidate as IDBFactory)
      : null;
  } catch {
    return null;
  }
}

/** Returns `null` when no IndexedDB is available so callers can fall back. */
export function createIndexedDbRecordCacheAdapter(
  dbName: string,
  factory?: IDBFactory,
): RecordCacheAdapter | null {
  const idb = resolveIndexedDb(factory);
  if (!idb) return null;

  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = () => {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = idb.open(dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(RECORD_STORE)) {
          const store = db.createObjectStore(RECORD_STORE, { keyPath: 'key' });
          store.createIndex(TABLE_INDEX, 'table', { unique: false });
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error(`Failed to open IndexedDB '${dbName}'.`));
      request.onblocked = () => reject(new Error(`IndexedDB '${dbName}' open was blocked.`));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
    return dbPromise;
  };

  const keyOf = (table: string, id: string) => `${table} ${id}`;

  return {
    async clear() {
      const db = await open();
      const tx = db.transaction([RECORD_STORE, META_STORE], 'readwrite');
      tx.objectStore(RECORD_STORE).clear();
      tx.objectStore(META_STORE).clear();
      await transactionDone(tx);
    },
    async getMeta(key) {
      const db = await open();
      const tx = db.transaction([META_STORE], 'readonly');
      return requestToPromise(tx.objectStore(META_STORE).get(key));
    },
    async listTable(table) {
      const db = await open();
      const tx = db.transaction([RECORD_STORE], 'readonly');
      const stored = (await requestToPromise(
        tx.objectStore(RECORD_STORE).index(TABLE_INDEX).getAll(table),
      )) as StoredRecord[];
      return stored.map((record) => ({ id: record.id, value: record.value }));
    },
    async putRecords(table, records) {
      if (!records.length) return;
      const db = await open();
      const tx = db.transaction([RECORD_STORE], 'readwrite');
      const store = tx.objectStore(RECORD_STORE);
      for (const record of records) {
        const stored: StoredRecord = {
          id: record.id,
          key: keyOf(table, record.id),
          table,
          value: record.value,
        };
        store.put(stored);
      }
      await transactionDone(tx);
    },
    async removeMeta(key) {
      const db = await open();
      const tx = db.transaction([META_STORE], 'readwrite');
      tx.objectStore(META_STORE).delete(key);
      await transactionDone(tx);
    },
    async removeRecords(table, ids) {
      if (!ids.length) return;
      const db = await open();
      const tx = db.transaction([RECORD_STORE], 'readwrite');
      const store = tx.objectStore(RECORD_STORE);
      for (const id of ids) store.delete(keyOf(table, id));
      await transactionDone(tx);
    },
    async replaceTable(table, records) {
      const db = await open();
      const tx = db.transaction([RECORD_STORE], 'readwrite');
      const store = tx.objectStore(RECORD_STORE);
      const existing = (await requestToPromise(
        store.index(TABLE_INDEX).getAll(table),
      )) as StoredRecord[];
      for (const record of existing) store.delete(record.key);
      for (const record of records) {
        const stored: StoredRecord = {
          id: record.id,
          key: keyOf(table, record.id),
          table,
          value: record.value,
        };
        store.put(stored);
      }
      await transactionDone(tx);
    },
    async setMeta(key, value) {
      const db = await open();
      const tx = db.transaction([META_STORE], 'readwrite');
      tx.objectStore(META_STORE).put(value, key);
      await transactionDone(tx);
    },
  };
}

// ── record cache ────────────────────────────────────────────────────────────

const SCHEMA_META_KEY = '__recordCacheSchemaVersion';

export interface RecordCacheOptions {
  adapter?: RecordCacheAdapter;
  /** Namespace for the backing store, e.g. `myapp-records:{userId}`. */
  name: string;
  /** Bump to invalidate every cached record (nuke-and-refetch on mismatch). */
  schemaVersion: number;
}

export class RecordCache {
  private readonly adapter: RecordCacheAdapter;
  private readonly schemaVersion: number;
  private ready: Promise<void> | null = null;

  constructor(options: RecordCacheOptions) {
    this.adapter = options.adapter ?? createMemoryRecordCacheAdapter();
    this.schemaVersion = options.schemaVersion;
  }

  private ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      const stored = await this.adapter.getMeta(SCHEMA_META_KEY);
      if (stored !== this.schemaVersion) {
        await this.adapter.clear();
        await this.adapter.setMeta(SCHEMA_META_KEY, this.schemaVersion);
      }
    })();
    return this.ready;
  }

  async getMeta<V = unknown>(key: string): Promise<V | undefined> {
    await this.ensureSchema();
    return (await this.adapter.getMeta(key)) as V | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.ensureSchema();
    await this.adapter.setMeta(key, value);
  }

  async removeMeta(key: string): Promise<void> {
    await this.ensureSchema();
    await this.adapter.removeMeta(key);
  }

  async listTable<V = unknown>(table: string): Promise<RecordCacheRecord<V>[]> {
    await this.ensureSchema();
    return (await this.adapter.listTable(table)) as RecordCacheRecord<V>[];
  }

  async putRecords(table: string, records: RecordCacheRecord[]): Promise<void> {
    await this.ensureSchema();
    await this.adapter.putRecords(table, records);
  }

  async removeRecords(table: string, ids: string[]): Promise<void> {
    await this.ensureSchema();
    await this.adapter.removeRecords(table, ids);
  }

  async replaceTable(table: string, records: RecordCacheRecord[]): Promise<void> {
    await this.ensureSchema();
    await this.adapter.replaceTable(table, records);
  }

  /** Remove everything — the "reset local data" / logout escape hatch. */
  async clear(): Promise<void> {
    await this.ensureSchema();
    await this.adapter.clear();
    await this.adapter.setMeta(SCHEMA_META_KEY, this.schemaVersion);
  }
}
