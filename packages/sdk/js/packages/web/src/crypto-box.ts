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
  /**
   * Unseal a stored value. Plain (pre-encryption) values pass through unless
   * the box is in strict `rejectUnsealed` mode.
   *
   * `context` binds the ciphertext to its storage location (table, record id,
   * meta key, entry key). It MUST match the `context` passed to `seal()` or the
   * authenticated decrypt fails and the value reads as missing — this is what
   * stops a sealed value from being cut-and-pasted between records/slots.
   */
  open<V = unknown>(stored: unknown, context?: string): Promise<V | undefined>;
  /**
   * Seal a JSON-serializable value into an envelope (or pass through).
   * `context` is bound into the AES-GCM additional-authenticated-data so the
   * envelope only decrypts back in its original slot.
   */
  seal(value: unknown, context?: string): Promise<unknown>;
}

/**
 * Sealed-envelope format versions.
 * - v1 (or a missing `v` field): legacy AES-GCM with NO location binding.
 * - v2: AES-GCM with `context` bound as additional-authenticated-data (AAD).
 * New writes always use v2; v1 envelopes stay readable for backward-compat.
 */
const SEALED_VERSION_AAD = 2;
const SEALED_ALG = 'AES-GCM';

interface SealedEnvelope {
  __sealed: 1;
  /** Format version. Absent means legacy v1 (no AAD binding). */
  v?: number;
  /** Algorithm identifier, checked on open for forward-compat branching. */
  alg?: string;
  data: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
}

/** Options shared by the box factories. */
export interface SecretBoxOptions {
  /**
   * When true, once the box is operating in sealed (aes-gcm) mode a non-sealed
   * (plaintext) stored value is treated as a MISS instead of being trusted and
   * returned. Recommended after a store has been fully migrated to sealed
   * values — it removes the "attacker-injected plaintext is indistinguishable
   * from legacy plaintext" trust gap. Defaults to `false` to preserve the
   * documented legacy-plaintext read behaviour for stores still migrating.
   */
  rejectUnsealed?: boolean;
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

/**
 * Atomically insert `value` at `key` using IndexedDB `add()`, which fails with
 * a ConstraintError if the key already exists. Resolves `true` when THIS caller
 * wrote the value and `false` when another writer got there first. This is the
 * race-free primitive for "first tab to run wins the key" — a read-then-put
 * would let two concurrent first-runs generate and persist different keys
 * (last-write-wins), silently losing data sealed under the losing key.
 */
function addIfAbsent(db: IDBDatabase, storeName: string, key: string, value: unknown): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readwrite');
    let lostRace = false;
    const request = tx.objectStore(storeName).add(value as never, key);
    request.onerror = (event) => {
      if (request.error?.name === 'ConstraintError') {
        // Another writer won; swallow so the transaction can commit cleanly.
        lostRace = true;
        event.preventDefault();
      }
    };
    tx.oncomplete = () => resolve(!lostRace);
    tx.onabort = () => (lostRace ? resolve(false) : reject(tx.error ?? new Error('key store aborted')));
    tx.onerror = () => (lostRace ? resolve(false) : reject(tx.error ?? new Error('key store failed')));
  });
}

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
      // Atomic create: if a concurrent first-run already wrote the key, re-read
      // and return the winner so every tab converges on ONE key.
      const won = await addIfAbsent(db, KEY_STORE, PRIMARY_KEY, key);
      if (won) return key;
      const winner = (await requestToPromise(
        db.transaction([KEY_STORE], 'readonly').objectStore(KEY_STORE).get(PRIMARY_KEY),
      )) as CryptoKey | undefined;
      return winner ?? key;
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

// Location-derived AAD contexts. Binding a sealed value to `record:<table>:<id>`
// / `meta:<key>` means a ciphertext lifted out of one slot cannot be pasted
// into another — the authenticated decrypt in the new slot fails.
const recordContext = (table: string, id: string) => `record:${table}:${id}`;
const metaContext = (key: string) => `meta:${key}`;

export function encryptRecordCacheAdapter(
  inner: RecordCacheAdapter,
  box: SecretBox,
): RecordCacheAdapter {
  const sealAll = async (table: string, records: RecordCacheRecord[]) => {
    const sealed: RecordCacheRecord[] = [];
    for (const record of records) {
      sealed.push({ id: record.id, value: await box.seal(record.value, recordContext(table, record.id)) });
    }
    return sealed;
  };
  return {
    clear: () => inner.clear(),
    async getMeta(key) {
      return box.open(await inner.getMeta(key), metaContext(key));
    },
    async listTable(table) {
      const records = await inner.listTable(table);
      const opened: RecordCacheRecord[] = [];
      for (const record of records) {
        const value = await box.open(record.value, recordContext(table, record.id));
        if (value !== undefined) opened.push({ id: record.id, value });
      }
      return opened;
    },
    async putRecords(table, records) {
      await inner.putRecords(table, await sealAll(table, records));
    },
    removeMeta: (key) => inner.removeMeta(key),
    removeRecords: (table, ids) => inner.removeRecords(table, ids),
    async replaceTable(table, records) {
      await inner.replaceTable(table, await sealAll(table, records));
    },
    async setMeta(key, value) {
      await inner.setMeta(key, await box.seal(value, metaContext(key)));
    },
  };
}

// Outbox entries are bound to their deterministic `entryKey`, NOT their tabId:
// claimAbandoned() legitimately re-homes an entry under a new tabId without
// re-sealing, so binding tabId would make claimed entries undecryptable. The
// entryKey is the entry's logical slot; binding it still blocks cut-and-paste
// between distinct mutation slots.
const entryContext = (entryKey: string) => `entry:${entryKey}`;

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
      const value = await box.open<V>(entry.value, entryContext(entry.entryKey));
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
      await inner.put({ ...entry, value: await box.seal(entry.value, entryContext(entry.entryKey)) });
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
/** Default PBKDF2 iterations — at/above the OWASP 2023 floor for PBKDF2-SHA256. */
const PASSPHRASE_ITERATIONS = 600_000;
/** Hard minimum; below this we refuse to derive a KEK unless explicitly overridden. */
const MIN_PASSPHRASE_ITERATIONS = 100_000;

interface PassphraseIterationOptions {
  iterations?: number;
  /**
   * TEST-ONLY escape hatch to permit iteration counts below
   * {@link MIN_PASSPHRASE_ITERATIONS}. Keeps PBKDF2 cheap in unit tests without
   * weakening the production floor. Never set this in application code.
   */
  __unsafeAllowLowIterations?: boolean;
}

/**
 * Resolve the PBKDF2 iteration count to use when DERIVING A NEW KEK (create /
 * change passphrase). Rejects absurdly low values so a caller cannot silently
 * weaken key wrapping. Reads of existing data always use the stored count
 * (which is authenticated: a tampered count derives the wrong KEK and the
 * AES-GCM unwrap fails, so it can only cause a decrypt miss, never a forgery).
 */
function resolveNewIterations(options?: PassphraseIterationOptions): number {
  const requested = options?.iterations ?? PASSPHRASE_ITERATIONS;
  if (requested < MIN_PASSPHRASE_ITERATIONS && !options?.__unsafeAllowLowIterations) {
    throw new Error(
      `[EdgeBase] PBKDF2 iterations ${requested} is below the minimum ${MIN_PASSPHRASE_ITERATIONS}. ` +
        'Use at least the default (600,000).',
    );
  }
  return requested;
}

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

function boxFromKey(subtle: SubtleCrypto, key: CryptoKey, options?: SecretBoxOptions): SecretBox {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const rejectUnsealed = options?.rejectUnsealed ?? false;
  return {
    mode: 'aes-gcm',
    async open<V>(stored: unknown, context?: string) {
      if (!isSealed(stored)) {
        // Strict mode: never trust a non-sealed value once sealing is on — an
        // attacker-injected plaintext would otherwise be indistinguishable from
        // a legacy plaintext and silently returned (and replayed).
        return rejectUnsealed ? undefined : (stored as V);
      }
      const version = typeof stored.v === 'number' ? stored.v : 1;
      // Reject unknown future formats rather than mis-decoding them.
      if (version !== 1 && version !== SEALED_VERSION_AAD) return undefined;
      const params: AesGcmParams = { iv: stored.iv, name: 'AES-GCM' };
      // v2 binds the storage location as AAD; v1 (legacy) had none.
      if (version === SEALED_VERSION_AAD) {
        params.additionalData = encoder.encode(context ?? '') as Uint8Array<ArrayBuffer>;
      }
      try {
        const plain = await subtle.decrypt(params, key, stored.data);
        return JSON.parse(decoder.decode(plain)) as V;
      } catch {
        return undefined;
      }
    },
    async seal(value: unknown, context?: string) {
      const iv = randomBytes(12);
      const data = await subtle.encrypt(
        {
          iv,
          name: 'AES-GCM',
          additionalData: encoder.encode(context ?? '') as Uint8Array<ArrayBuffer>,
        },
        key,
        encoder.encode(JSON.stringify(value ?? null)) as Uint8Array<ArrayBuffer>,
      );
      const envelope: SealedEnvelope = {
        __sealed: 1,
        v: SEALED_VERSION_AAD,
        alg: SEALED_ALG,
        data: new Uint8Array(data),
        iv,
      };
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
  options?: { factory?: IDBFactory } & SecretBoxOptions & PassphraseIterationOptions,
): Promise<PassphraseBoxResult> {
  const subtle = resolveSubtle();
  const idb = resolveIndexedDb(options?.factory);
  if (!subtle || !idb || !passphrase) return { error: 'unavailable' };
  // Validate iteration count up front so a weak value fails loudly (throws)
  // rather than being swallowed into an 'unavailable' result.
  const newIterations = resolveNewIterations(options);
  const boxOptions: SecretBoxOptions = { rejectUnsealed: options?.rejectUnsealed };
  const dbName = `${name}::keys`;
  const unwrapExisting = async (record: WrappedKeyRecord): Promise<PassphraseBoxResult> => {
    const kek = await deriveKek(subtle, passphrase, record.salt, record.iterations);
    try {
      const dek = await subtle.unwrapKey(
        'raw',
        record.wrappedKey,
        kek,
        { iv: record.iv, name: 'AES-GCM' },
        { length: 256, name: 'AES-GCM' },
        false,
        ['decrypt', 'encrypt'],
      );
      return { box: boxFromKey(subtle, dek, boxOptions), created: false };
    } catch {
      return { error: 'wrong-passphrase' };
    }
  };
  try {
    const existing = await keysGet<WrappedKeyRecord>(dbName, idb, WRAPPED_KEY);
    if (existing) return unwrapExisting(existing);

    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const kek = await deriveKek(subtle, passphrase, salt, newIterations);
    const dek = await subtle.generateKey({ length: 256, name: 'AES-GCM' }, true, [
      'decrypt',
      'encrypt',
    ]);
    const wrappedKey = new Uint8Array(
      await subtle.wrapKey('raw', dek, kek, { iv, name: 'AES-GCM' }),
    );
    const record: WrappedKeyRecord = {
      algorithm: 'PBKDF2-SHA256+AES-GCM',
      iterations: newIterations,
      iv,
      salt,
      wrappedKey,
    };
    // Atomic create: if a concurrent first-run wrapped a DEK first, adopt THAT
    // record instead of overwriting it (last-write-wins would strand data
    // sealed under the loser's key). Requires an open DB handle for add().
    const db = await openKeysDb(dbName, idb);
    let won: boolean;
    try {
      won = await addIfAbsent(db, KEY_STORE, WRAPPED_KEY, record);
    } finally {
      db.close();
    }
    if (!won) {
      const winner = await keysGet<WrappedKeyRecord>(dbName, idb, WRAPPED_KEY);
      if (winner) return unwrapExisting(winner);
    }
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
    return { box: boxFromKey(subtle, sessionDek, boxOptions), created: true };
  } catch {
    return { error: 'unavailable' };
  }
}

/** Re-wrap the DEK under a new passphrase; sealed data stays readable. */
export async function changePassphraseSecretBox(
  name: string,
  currentPassphrase: string,
  nextPassphrase: string,
  options?: { factory?: IDBFactory } & SecretBoxOptions & PassphraseIterationOptions,
): Promise<PassphraseBoxResult> {
  const subtle = resolveSubtle();
  const idb = resolveIndexedDb(options?.factory);
  if (!subtle || !idb || !currentPassphrase || !nextPassphrase) return { error: 'unavailable' };
  // Re-wrapping is a good moment to upgrade to the current iteration default.
  const iterations = resolveNewIterations(options);
  const boxOptions: SecretBoxOptions = { rejectUnsealed: options?.rejectUnsealed };
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
    return { box: boxFromKey(subtle, sessionDek, boxOptions), created: false };
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

export interface CreateSecretBoxOptions extends SecretBoxOptions {
  factory?: IDBFactory;
  /**
   * Permit the insecure plaintext-passthrough fallback when WebCrypto or
   * IndexedDB is unavailable (or key setup fails). WITHOUT this opt-in
   * createSecretBox THROWS rather than silently writing "sealed" data as
   * plaintext — a consumer that asked for sealing should never get plaintext by
   * accident. SSR / no-crypto environments that genuinely want passthrough must
   * set this explicitly.
   */
  allowInsecureFallback?: boolean;
}

/**
 * Create a secret box named after the store it protects.
 *
 * By default requires WebCrypto + IndexedDB and throws if they are missing (so
 * you cannot accidentally persist plaintext under the belief it is sealed). Pass
 * `{ allowInsecureFallback: true }` to opt into a plaintext passthrough box in
 * environments without crypto/storage.
 *
 * The second argument accepts either a bare `IDBFactory` (legacy signature) or
 * a {@link CreateSecretBoxOptions} object.
 */
export async function createSecretBox(
  name: string,
  factoryOrOptions?: IDBFactory | CreateSecretBoxOptions,
): Promise<SecretBox> {
  const options: CreateSecretBoxOptions =
    factoryOrOptions && typeof (factoryOrOptions as IDBFactory).open === 'function'
      ? { factory: factoryOrOptions as IDBFactory }
      : ((factoryOrOptions as CreateSecretBoxOptions | undefined) ?? {});
  const subtle = resolveSubtle();
  const idb = resolveIndexedDb(options.factory);
  const fallback = (): SecretBox => {
    if (!options.allowInsecureFallback) {
      throw new Error(
        `[EdgeBase] createSecretBox('${name}') cannot seal values: WebCrypto/IndexedDB is ` +
          'unavailable or key setup failed. Pass { allowInsecureFallback: true } to accept an ' +
          'insecure plaintext passthrough, or run where WebCrypto + IndexedDB exist.',
      );
    }
    return plaintextBox();
  };
  if (!subtle || !idb) return fallback();
  const key = await loadOrCreateKey(`${name}::keys`, subtle, idb);
  if (!key) return fallback();
  return boxFromKey(subtle, key, options);
}
