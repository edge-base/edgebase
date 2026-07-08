/**
 * Secret box — optional value-at-rest sealing for local caches (outbox /
 * record cache values).
 *
 * Threat model (be honest with consumers): AES-GCM-256 with a NON-EXTRACTABLE
 * CryptoKey persisted in its own IndexedDB. This protects cached content from
 * casual disk inspection and prevents injected script from EXFILTRATING the
 * key material (it can still decrypt in-page while the origin is compromised).
 * It does NOT protect against an attacker with full browser-profile disk
 * access — the browser necessarily stores the key material on disk. For that
 * threat, clear-on-logout (which consumers already do) is the control.
 *
 * Environments without WebCrypto (older engines, jsdom) get a plaintext
 * passthrough box; sealed values written elsewhere then read as missing.
 */

export interface SecretBox {
  readonly mode: 'aes-gcm' | 'plaintext';
  /** Unseal a stored value. Plain (pre-encryption) values pass through. */
  open<V = unknown>(stored: unknown): Promise<V | undefined>;
  /** Seal a JSON-serializable value into an envelope (or pass through). */
  seal(value: unknown): Promise<unknown>;
}

interface SealedEnvelope {
  __sealed: 1;
  data: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
}

// Realm-safe byte check: values roundtripped through IndexedDB (or its test
// fakes) can carry typed arrays from another realm, where `instanceof
// Uint8Array` is false. ArrayBuffer.isView + constructor name are stable
// across realms.
function isBytes(value: unknown): value is Uint8Array<ArrayBuffer> {
  return (
    ArrayBuffer.isView(value) &&
    (value as Uint8Array).BYTES_PER_ELEMENT === 1 &&
    value.constructor.name === 'Uint8Array'
  );
}

function isSealed(value: unknown): value is SealedEnvelope {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { __sealed?: unknown }).__sealed === 1 &&
    isBytes((value as { iv?: unknown }).iv) &&
    isBytes((value as { data?: unknown }).data)
  );
}

function resolveSubtle(): SubtleCrypto | null {
  try {
    const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
    return cryptoApi?.subtle ?? null;
  } catch {
    return null;
  }
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

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

const KEY_STORE = 'keys';
const PRIMARY_KEY = 'primary';

async function loadOrCreateKey(
  dbName: string,
  subtle: SubtleCrypto,
  idb: IDBFactory,
): Promise<CryptoKey | null> {
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = idb.open(dbName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(KEY_STORE)) {
          request.result.createObjectStore(KEY_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error(`Failed to open '${dbName}'.`));
      request.onblocked = () => reject(new Error(`IndexedDB '${dbName}' open was blocked.`));
    });
    try {
      const existing = (await requestToPromise(
        db.transaction([KEY_STORE], 'readonly').objectStore(KEY_STORE).get(PRIMARY_KEY),
      )) as CryptoKey | undefined;
      if (existing) return existing;
      const key = await subtle.generateKey({ length: 256, name: 'AES-GCM' }, false, [
        'decrypt',
        'encrypt',
      ]);
      const tx = db.transaction([KEY_STORE], 'readwrite');
      tx.objectStore(KEY_STORE).put(key, PRIMARY_KEY);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('key store aborted'));
        tx.onerror = () => reject(tx.error ?? new Error('key store failed'));
      });
      return key;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function plaintextBox(): SecretBox {
  return {
    mode: 'plaintext',
    async open<V>(stored: unknown) {
      // Sealed values are unreadable without the key/subtle — report missing.
      if (isSealed(stored)) return undefined;
      return stored as V;
    },
    async seal(value: unknown) {
      return value;
    },
  };
}

// ── adapter decorators ──────────────────────────────────────────────────────
// Wrap a storage adapter so every VALUE passes through the box while keys,
// table names, entry keys, and tab ids stay plaintext (they are needed for
// indexing and carry only opaque ids). Pre-encryption plaintext values keep
// reading through `open()`'s passthrough, so enabling encryption is a
// gradual, non-destructive transition.

import type { DurableOutboxAdapter, DurableOutboxEntry } from './durable-outbox.js';
import type { RecordCacheAdapter, RecordCacheRecord } from './record-cache.js';

export function encryptRecordCacheAdapter(
  inner: RecordCacheAdapter,
  box: SecretBox,
): RecordCacheAdapter {
  const sealAll = async (records: RecordCacheRecord[]) => {
    const sealed: RecordCacheRecord[] = [];
    for (const record of records) {
      sealed.push({ id: record.id, value: await box.seal(record.value) });
    }
    return sealed;
  };
  return {
    clear: () => inner.clear(),
    async getMeta(key) {
      return box.open(await inner.getMeta(key));
    },
    async listTable(table) {
      const records = await inner.listTable(table);
      const opened: RecordCacheRecord[] = [];
      for (const record of records) {
        const value = await box.open(record.value);
        if (value !== undefined) opened.push({ id: record.id, value });
      }
      return opened;
    },
    async putRecords(table, records) {
      await inner.putRecords(table, await sealAll(records));
    },
    removeMeta: (key) => inner.removeMeta(key),
    removeRecords: (table, ids) => inner.removeRecords(table, ids),
    async replaceTable(table, records) {
      await inner.replaceTable(table, await sealAll(records));
    },
    async setMeta(key, value) {
      await inner.setMeta(key, await box.seal(value));
    },
  };
}

export function encryptOutboxAdapter<V>(
  inner: DurableOutboxAdapter<unknown>,
  box: SecretBox,
): DurableOutboxAdapter<V> {
  const openEntries = async (
    entries: DurableOutboxEntry<unknown>[],
    onUnreadable?: (entry: DurableOutboxEntry<unknown>) => Promise<void>,
  ) => {
    const opened: DurableOutboxEntry<V>[] = [];
    for (const entry of entries) {
      const value = await box.open<V>(entry.value);
      if (value !== undefined) opened.push({ ...entry, value });
      else if (onUnreadable) await onUnreadable(entry);
    }
    return opened;
  };
  return {
    async claimTab(fromTabId, toTabId) {
      // Unreadable claimed entries can never replay — drop them from storage
      // so the replay loop cannot wedge on them.
      return openEntries(await inner.claimTab(fromTabId, toTabId), (entry) =>
        inner.remove(toTabId, entry.entryKey),
      );
    },
    clear: () => inner.clear(),
    async listEntries(tabId) {
      return openEntries(await inner.listEntries(tabId));
    },
    listTabIds: () => inner.listTabIds(),
    async put(entry) {
      await inner.put({ ...entry, value: await box.seal(entry.value) });
    },
    remove: (tabId, entryKey) => inner.remove(tabId, entryKey),
  };
}

/**
 * Create a secret box named after the store it protects. Falls back to a
 * plaintext passthrough when WebCrypto or IndexedDB is unavailable.
 */
export async function createSecretBox(name: string, factory?: IDBFactory): Promise<SecretBox> {
  const subtle = resolveSubtle();
  const idb = resolveIndexedDb(factory);
  if (!subtle || !idb) return plaintextBox();
  const key = await loadOrCreateKey(`${name}::keys`, subtle, idb);
  if (!key) return plaintextBox();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return {
    mode: 'aes-gcm',
    async open<V>(stored: unknown) {
      if (!isSealed(stored)) return stored as V;
      try {
        const plain = await subtle.decrypt(
          { iv: stored.iv, name: 'AES-GCM' },
          key,
          stored.data,
        );
        return JSON.parse(decoder.decode(plain)) as V;
      } catch {
        // Tampered / foreign-key ciphertext reads as missing (fail-open).
        return undefined;
      }
    },
    async seal(value: unknown) {
      const iv = new Uint8Array(12);
      (globalThis as { crypto: Crypto }).crypto.getRandomValues(iv);
      const data = await subtle.encrypt(
        { iv, name: 'AES-GCM' },
        key,
        encoder.encode(JSON.stringify(value ?? null)) as Uint8Array<ArrayBuffer>,
      );
      const envelope: SealedEnvelope = { __sealed: 1, data: new Uint8Array(data), iv };
      return envelope;
    },
  };
}
