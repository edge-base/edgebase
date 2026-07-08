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

// ── passphrase custody ──────────────────────────────────────────────────────
// True key custody: the data key (DEK) exists at rest ONLY wrapped by a
// PBKDF2-derived KEK. Without the passphrase the profile's disk contents are
// ciphertext + a wrapped key — the control the device-mode box cannot give.
// The AES-GCM unwrap is authenticated, so a wrong passphrase is detected
// reliably (OperationError) without any sentinel value.

const WRAPPED_KEY = 'wrapped';
const PASSPHRASE_ITERATIONS = 310_000;

interface WrappedKeyRecord {
  algorithm: 'PBKDF2-SHA256+AES-GCM';
  iterations: number;
  iv: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
  wrappedKey: Uint8Array<ArrayBuffer>;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  (globalThis as { crypto: Crypto }).crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveKek(
  subtle: SubtleCrypto,
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase) as Uint8Array<ArrayBuffer>,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { hash: 'SHA-256', iterations, name: 'PBKDF2', salt },
    material,
    { length: 256, name: 'AES-GCM' },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function openKeysDb(dbName: string, idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
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
}

async function keysGet<T>(dbName: string, idb: IDBFactory, key: string): Promise<T | undefined> {
  const db = await openKeysDb(dbName, idb);
  try {
    return (await requestToPromise(
      db.transaction([KEY_STORE], 'readonly').objectStore(KEY_STORE).get(key),
    )) as T | undefined;
  } finally {
    db.close();
  }
}

async function keysPut(dbName: string, idb: IDBFactory, key: string, value: unknown): Promise<void> {
  const db = await openKeysDb(dbName, idb);
  try {
    const tx = db.transaction([KEY_STORE], 'readwrite');
    tx.objectStore(KEY_STORE).put(value, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('key store aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('key store failed'));
    });
  } finally {
    db.close();
  }
}

async function keysDelete(dbName: string, idb: IDBFactory, key: string): Promise<void> {
  const db = await openKeysDb(dbName, idb);
  try {
    const tx = db.transaction([KEY_STORE], 'readwrite');
    tx.objectStore(KEY_STORE).delete(key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('key store aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('key store failed'));
    });
  } finally {
    db.close();
  }
}

function boxFromKey(subtle: SubtleCrypto, key: CryptoKey): SecretBox {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return {
    mode: 'aes-gcm',
    async open<V>(stored: unknown) {
      if (!isSealed(stored)) return stored as V;
      try {
        const plain = await subtle.decrypt({ iv: stored.iv, name: 'AES-GCM' }, key, stored.data);
        return JSON.parse(decoder.decode(plain)) as V;
      } catch {
        return undefined;
      }
    },
    async seal(value: unknown) {
      const iv = randomBytes(12);
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

/** True when a passphrase-wrapped key already exists for this name. */
export async function passphraseBoxConfigured(name: string, factory?: IDBFactory): Promise<boolean> {
  const idb = resolveIndexedDb(factory);
  if (!idb) return false;
  try {
    return !!(await keysGet<WrappedKeyRecord>(`${name}::keys`, idb, WRAPPED_KEY));
  } catch {
    return false;
  }
}

export type PassphraseBoxResult =
  | { box: SecretBox; created: boolean }
  | { error: 'unavailable' | 'wrong-passphrase' };

/**
 * Open (or, when absent, create) the passphrase-wrapped box for `name`.
 * The DEK is unwrapped NON-extractable for the session; a wrong passphrase
 * fails the authenticated unwrap and reports 'wrong-passphrase'.
 */
export async function createPassphraseSecretBox(
  name: string,
  passphrase: string,
  options?: { factory?: IDBFactory; iterations?: number },
): Promise<PassphraseBoxResult> {
  const subtle = resolveSubtle();
  const idb = resolveIndexedDb(options?.factory);
  if (!subtle || !idb || !passphrase) return { error: 'unavailable' };
  const dbName = `${name}::keys`;
  try {
    const existing = await keysGet<WrappedKeyRecord>(dbName, idb, WRAPPED_KEY);
    if (existing) {
      const kek = await deriveKek(subtle, passphrase, existing.salt, existing.iterations);
      try {
        const dek = await subtle.unwrapKey(
          'raw',
          existing.wrappedKey,
          kek,
          { iv: existing.iv, name: 'AES-GCM' },
          { length: 256, name: 'AES-GCM' },
          false,
          ['decrypt', 'encrypt'],
        );
        return { box: boxFromKey(subtle, dek), created: false };
      } catch {
        return { error: 'wrong-passphrase' };
      }
    }
    const iterations = options?.iterations ?? PASSPHRASE_ITERATIONS;
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const kek = await deriveKek(subtle, passphrase, salt, iterations);
    const dek = await subtle.generateKey({ length: 256, name: 'AES-GCM' }, true, [
      'decrypt',
      'encrypt',
    ]);
    const wrappedKey = new Uint8Array(
      await subtle.wrapKey('raw', dek, kek, { iv, name: 'AES-GCM' }),
    );
    const record: WrappedKeyRecord = {
      algorithm: 'PBKDF2-SHA256+AES-GCM',
      iterations,
      iv,
      salt,
      wrappedKey,
    };
    await keysPut(dbName, idb, WRAPPED_KEY, record);
    // Session key is non-extractable even though the stored copy is wrapped.
    const sessionDek = await subtle.unwrapKey(
      'raw',
      wrappedKey,
      kek,
      { iv, name: 'AES-GCM' },
      { length: 256, name: 'AES-GCM' },
      false,
      ['decrypt', 'encrypt'],
    );
    return { box: boxFromKey(subtle, sessionDek), created: true };
  } catch {
    return { error: 'unavailable' };
  }
}

/** Re-wrap the DEK under a new passphrase; sealed data stays readable. */
export async function changePassphraseSecretBox(
  name: string,
  currentPassphrase: string,
  nextPassphrase: string,
  options?: { factory?: IDBFactory; iterations?: number },
): Promise<PassphraseBoxResult> {
  const subtle = resolveSubtle();
  const idb = resolveIndexedDb(options?.factory);
  if (!subtle || !idb || !currentPassphrase || !nextPassphrase) return { error: 'unavailable' };
  const dbName = `${name}::keys`;
  try {
    const existing = await keysGet<WrappedKeyRecord>(dbName, idb, WRAPPED_KEY);
    if (!existing) return { error: 'unavailable' };
    const oldKek = await deriveKek(subtle, currentPassphrase, existing.salt, existing.iterations);
    let extractableDek: CryptoKey;
    try {
      // Momentarily extractable for the re-wrap only; never persisted raw.
      extractableDek = await subtle.unwrapKey(
        'raw',
        existing.wrappedKey,
        oldKek,
        { iv: existing.iv, name: 'AES-GCM' },
        { length: 256, name: 'AES-GCM' },
        true,
        ['decrypt', 'encrypt'],
      );
    } catch {
      return { error: 'wrong-passphrase' };
    }
    const iterations = options?.iterations ?? existing.iterations ?? PASSPHRASE_ITERATIONS;
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const newKek = await deriveKek(subtle, nextPassphrase, salt, iterations);
    const wrappedKey = new Uint8Array(
      await subtle.wrapKey('raw', extractableDek, newKek, { iv, name: 'AES-GCM' }),
    );
    await keysPut(dbName, idb, WRAPPED_KEY, {
      algorithm: 'PBKDF2-SHA256+AES-GCM',
      iterations,
      iv,
      salt,
      wrappedKey,
    } satisfies WrappedKeyRecord);
    const sessionDek = await subtle.unwrapKey(
      'raw',
      wrappedKey,
      newKek,
      { iv, name: 'AES-GCM' },
      { length: 256, name: 'AES-GCM' },
      false,
      ['decrypt', 'encrypt'],
    );
    return { box: boxFromKey(subtle, sessionDek), created: false };
  } catch {
    return { error: 'unavailable' };
  }
}

/** Remove the wrapped key (used when the lock is disabled; caches are cleared by the caller). */
export async function removePassphraseKey(name: string, factory?: IDBFactory): Promise<void> {
  const idb = resolveIndexedDb(factory);
  if (!idb) return;
  try {
    await keysDelete(`${name}::keys`, idb, WRAPPED_KEY);
  } catch {
    // Best-effort.
  }
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
