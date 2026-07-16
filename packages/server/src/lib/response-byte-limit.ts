import { EdgeBaseError } from '@edge-base/shared';

export const MIN_MAX_RESPONSE_BYTES = 512;
export const RESPONSE_CURSOR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESPONSE_CURSOR_GC_LIMIT = 16;
export const RESPONSE_CURSOR_PREFIX = '~edgebase-response-cursor-v1.';
const RESPONSE_CURSOR_RANDOM_BYTES = 24;
export const RESPONSE_CURSOR_LENGTH = RESPONSE_CURSOR_PREFIX.length + 32;

const textEncoder = new TextEncoder();
const responseCursorPattern = new RegExp(
  `^${RESPONSE_CURSOR_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[A-Za-z0-9_-]{32}$`,
);

export interface ResponseCursorRecord {
  token: string;
  tableName: string;
  recordId: string;
  expiresAt: number;
}

export interface ResponseCursorStore {
  ensureReady(): Promise<void>;
  findByToken(token: string): Promise<ResponseCursorRecord | null>;
  findByRecord(tableName: string, recordId: string): Promise<ResponseCursorRecord | null>;
  create(record: ResponseCursorRecord): Promise<'inserted' | 'token-conflict' | 'record-conflict'>;
  touch(token: string, expiresAt: number): Promise<void>;
  deleteByToken(token: string): Promise<void>;
  deleteExpired(now: number, limit: number): Promise<number>;
}

export interface BoundedPageResponseOptions<T extends Record<string, unknown>> {
  maxResponseBytes: number;
  tableName: string;
  items: T[];
  cursorRecordIds: string[];
  total: number | null;
  perPage: number;
  sourceHasMore: boolean;
  /** Last provider row fetched before rule filtering; used only when all visible items fit. */
  sourceCursorRecordId?: string;
  cursorStore: ResponseCursorStore;
  now?: number;
  randomBytes?: (length: number) => Uint8Array;
}

export interface PreparedBoundedQuery {
  maxResponseBytes: number | undefined;
  params: Record<string, string>;
}

export interface SerializedJsonResponse {
  body: string;
  returnedBytes: number;
}

export interface IssuedResponseCursor {
  token: string;
  expiresAt: number;
}

const cursorIssuanceFlights = new WeakMap<
  ResponseCursorStore,
  Map<string, Promise<IssuedResponseCursor>>
>();

function invalidMaxResponseBytes(message: string): EdgeBaseError {
  return new EdgeBaseError(400, message, undefined, 'invalid-max-response-bytes');
}

export function parseMaxResponseBytes(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw invalidMaxResponseBytes('maxResponseBytes must be a positive safe integer.');
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw invalidMaxResponseBytes('maxResponseBytes must be a positive safe integer.');
  }
  if (parsed < MIN_MAX_RESPONSE_BYTES) {
    throw invalidMaxResponseBytes(
      `maxResponseBytes must be at least ${MIN_MAX_RESPONSE_BYTES} bytes so bounded continuation metadata always fits.`,
    );
  }
  return parsed;
}

export function isResponseCursor(value: string): boolean {
  return responseCursorPattern.test(value);
}

export async function prepareBoundedQuery(
  params: Record<string, string>,
  tableName: string,
  cursorStore: ResponseCursorStore,
  options: { search?: boolean } = {},
): Promise<PreparedBoundedQuery> {
  const prepared = { ...params };
  const maxResponseBytes = parseMaxResponseBytes(prepared.maxResponseBytes);
  const responseAfter = prepared.responseAfter;
  const responseBefore = prepared.responseBefore;

  if (maxResponseBytes === undefined) {
    if (responseAfter !== undefined || responseBefore !== undefined) {
      throw invalidMaxResponseBytes(
        'responseAfter/responseBefore require maxResponseBytes on every bounded page request.',
      );
    }
    return { maxResponseBytes, params: prepared };
  }
  if (prepared.offset !== undefined || prepared.page !== undefined) {
    throw invalidMaxResponseBytes(
      'maxResponseBytes requires keyset pagination; offset and page are not supported.',
    );
  }
  if (prepared.fields) {
    const fields = prepared.fields.split(',').map((field) => field.trim());
    if (!fields.includes('id')) {
      throw invalidMaxResponseBytes(
        'maxResponseBytes projections must include id so the provider can resume by keyset.',
      );
    }
  }
  if (
    (responseAfter !== undefined && responseBefore !== undefined)
    || (responseAfter !== undefined && prepared.after !== undefined)
    || (responseBefore !== undefined && prepared.before !== undefined)
  ) {
    throw invalidMaxResponseBytes('Bounded requests must provide exactly one forward or backward cursor.');
  }

  if (responseAfter !== undefined) {
    prepared.after = await resolveResponseCursor(cursorStore, tableName, responseAfter);
    delete prepared.responseAfter;
  }
  if (responseBefore !== undefined) {
    prepared.before = await resolveResponseCursor(cursorStore, tableName, responseBefore);
    delete prepared.responseBefore;
  }

  const expectedSort = prepared.before !== undefined ? 'id:desc' : 'id:asc';
  if (prepared.sort !== undefined && prepared.sort !== expectedSort) {
    throw invalidMaxResponseBytes(
      `maxResponseBytes requires sort=${expectedSort} for stable keyset continuation.`,
    );
  }
  if (options.search && prepared.sort === undefined) prepared.sort = expectedSort;

  return { maxResponseBytes, params: prepared };
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function defaultRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function createResponseCursorToken(randomBytes: (length: number) => Uint8Array): string {
  const bytes = randomBytes(RESPONSE_CURSOR_RANDOM_BYTES);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== RESPONSE_CURSOR_RANDOM_BYTES) {
    throw new EdgeBaseError(
      500,
      'The response cursor random source returned an invalid byte sequence.',
      undefined,
      'response-cursor-random-source-invalid',
    );
  }
  return `${RESPONSE_CURSOR_PREFIX}${encodeBase64Url(bytes)}`;
}

async function collectExpiredResponseCursors(
  store: ResponseCursorStore,
  now: number,
): Promise<void> {
  await store.ensureReady();
  await store.deleteExpired(now, RESPONSE_CURSOR_GC_LIMIT);
}

export async function issueResponseCursorWithExpiry(
  store: ResponseCursorStore,
  tableName: string,
  recordId: string,
  options: { now?: number; randomBytes?: (length: number) => Uint8Array } = {},
): Promise<IssuedResponseCursor> {
  const flightKey = `${tableName}\0${recordId}`;
  let storeFlights = cursorIssuanceFlights.get(store);
  if (!storeFlights) {
    storeFlights = new Map();
    cursorIssuanceFlights.set(store, storeFlights);
  }
  const inFlight = storeFlights.get(flightKey);
  if (inFlight) return inFlight;

  const flight = (async () => {
    const now = options.now ?? Date.now();
    const expiresAt = now + RESPONSE_CURSOR_TTL_MS;
    await collectExpiredResponseCursors(store, now);

    const existing = await store.findByRecord(tableName, recordId);
    if (existing) {
      if (!isResponseCursor(existing.token)) {
        throw new EdgeBaseError(
          500,
          'Stored response cursor has an invalid token.',
          undefined,
          'response-cursor-store-corrupt',
        );
      }
      await store.touch(existing.token, expiresAt);
      return { token: existing.token, expiresAt };
    }

    const randomBytes = options.randomBytes ?? defaultRandomBytes;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = createResponseCursorToken(randomBytes);
      const outcome = await store.create({ token, tableName, recordId, expiresAt });
      if (outcome === 'inserted') return { token, expiresAt };
      if (outcome === 'record-conflict') {
        const raced = await store.findByRecord(tableName, recordId);
        if (raced && isResponseCursor(raced.token)) {
          await store.touch(raced.token, expiresAt);
          return { token: raced.token, expiresAt };
        }
      }
    }

    throw new EdgeBaseError(
      503,
      'Could not allocate a unique bounded response cursor after 3 attempts.',
      undefined,
      'response-cursor-collision',
    );
  })();
  storeFlights.set(flightKey, flight);
  try {
    return await flight;
  } finally {
    if (storeFlights.get(flightKey) === flight) {
      storeFlights.delete(flightKey);
    }
  }
}

export async function issueResponseCursor(
  store: ResponseCursorStore,
  tableName: string,
  recordId: string,
  options: { now?: number; randomBytes?: (length: number) => Uint8Array } = {},
): Promise<string> {
  return (await issueResponseCursorWithExpiry(store, tableName, recordId, options)).token;
}

export async function resolveResponseCursor(
  store: ResponseCursorStore,
  tableName: string,
  token: string,
  now = Date.now(),
): Promise<string> {
  if (!isResponseCursor(token)) {
    throw new EdgeBaseError(400, 'Invalid bounded response cursor.', undefined, 'invalid-response-cursor');
  }
  await store.ensureReady();
  const record = await store.findByToken(token);
  if (!record || record.tableName !== tableName) {
    throw new EdgeBaseError(400, 'Bounded response cursor is unknown for this table.', undefined, 'invalid-response-cursor');
  }
  if (record.expiresAt <= now) {
    await store.deleteByToken(token);
    throw new EdgeBaseError(400, 'Bounded response cursor has expired.', undefined, 'response-cursor-expired');
  }
  await store.touch(token, now + RESPONSE_CURSOR_TTL_MS);
  return record.recordId;
}

export function serializeJsonWithReturnedBytes(
  payload: Record<string, unknown>,
): SerializedJsonResponse {
  const withoutReturnedBytes = { ...payload };
  delete withoutReturnedBytes.returnedBytes;

  let returnedBytes = 0;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const body = JSON.stringify({ ...withoutReturnedBytes, returnedBytes });
    const measured = textEncoder.encode(body).byteLength;
    if (measured === returnedBytes) return { body, returnedBytes };
    returnedBytes = measured;
  }

  throw new EdgeBaseError(
    500,
    'Could not stabilize the exact bounded JSON response length.',
    undefined,
    'response-byte-measurement-failed',
  );
}

function jsonResponse(serialized: SerializedJsonResponse, status = 200): Response {
  return new Response(serialized.body, {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  });
}

function responseTooSmall(maxResponseBytes: number, minimumBytes: number): Response {
  const body = JSON.stringify({
    code: 413,
    slug: 'max-response-bytes-too-small',
    message: 'The requested maxResponseBytes cannot fit bounded response metadata.',
    details: { maxResponseBytes, minimumBytes },
  });
  return new Response(body, {
    status: 413,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  });
}

function pagePayload<T extends Record<string, unknown>>(
  items: T[],
  total: number | null,
  perPage: number,
  hasMore: boolean,
  cursor: string | null,
  cursorExpiresAt: string | null,
  oversizedItem = false,
): Record<string, unknown> {
  return {
    items,
    total,
    hasMore,
    cursor,
    ...(cursorExpiresAt ? { cursorExpiresAt } : {}),
    page: null,
    perPage,
    ...(oversizedItem ? { oversizedItem: true } : {}),
  };
}

export async function buildBoundedPageResponse<T extends Record<string, unknown>>(
  options: BoundedPageResponseOptions<T>,
): Promise<Response> {
  const {
    maxResponseBytes,
    items,
    cursorRecordIds,
    total,
    perPage,
    sourceHasMore,
    cursorStore,
  } = options;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < MIN_MAX_RESPONSE_BYTES) {
    throw invalidMaxResponseBytes(
      `maxResponseBytes must be a safe integer of at least ${MIN_MAX_RESPONSE_BYTES}.`,
    );
  }
  if (cursorRecordIds.length !== items.length || cursorRecordIds.some((id) => typeof id !== 'string' || !id)) {
    throw new EdgeBaseError(
      500,
      'Bounded list/search responses require one stable record id per returned item.',
      undefined,
      'bounded-response-cursor-id-missing',
    );
  }

  if (items.length === 0) {
    if (options.sourceCursorRecordId) {
      const issuedCursor = await issueResponseCursorWithExpiry(
        cursorStore,
        options.tableName,
        options.sourceCursorRecordId,
        { now: options.now, randomBytes: options.randomBytes },
      );
      const serialized = serializeJsonWithReturnedBytes(pagePayload(
        [],
        total,
        perPage,
        sourceHasMore,
        issuedCursor.token,
        new Date(issuedCursor.expiresAt).toISOString(),
      ));
      return serialized.returnedBytes <= maxResponseBytes
        ? jsonResponse(serialized)
        : responseTooSmall(maxResponseBytes, serialized.returnedBytes);
    }
    const serialized = serializeJsonWithReturnedBytes(
      pagePayload([], total, perPage, sourceHasMore, null, null),
    );
    return serialized.returnedBytes <= maxResponseBytes
      ? jsonResponse(serialized)
      : responseTooSmall(maxResponseBytes, serialized.returnedBytes);
  }

  const placeholderCursor = `${RESPONSE_CURSOR_PREFIX}${'A'.repeat(32)}`;
  const placeholderExpiry = new Date(
    (options.now ?? Date.now()) + RESPONSE_CURSOR_TTL_MS,
  ).toISOString();
  let selectedCount = 0;
  let selectedSerialized: SerializedJsonResponse | null = null;
  for (let count = 1; count <= items.length; count += 1) {
    const serialized = serializeJsonWithReturnedBytes(pagePayload(
      items.slice(0, count),
      total,
      perPage,
      count < items.length || sourceHasMore,
      placeholderCursor,
      placeholderExpiry,
    ));
    if (serialized.returnedBytes > maxResponseBytes) break;
    selectedCount = count;
    selectedSerialized = serialized;
  }

  const cursorIndex = selectedCount > 0 ? selectedCount - 1 : 0;
  const cursorRecordId = selectedCount === items.length && options.sourceCursorRecordId
    ? options.sourceCursorRecordId
    : cursorRecordIds[cursorIndex]!;
  const issuedCursor = await issueResponseCursorWithExpiry(
    cursorStore,
    options.tableName,
    cursorRecordId,
    { now: options.now, randomBytes: options.randomBytes },
  );
  const oversizedItem = selectedCount === 0;
  const finalSerialized = serializeJsonWithReturnedBytes(pagePayload(
    items.slice(0, selectedCount),
    total,
    perPage,
    oversizedItem
      ? items.length > 1 || sourceHasMore
      : selectedCount < items.length || sourceHasMore,
    issuedCursor.token,
    new Date(issuedCursor.expiresAt).toISOString(),
    oversizedItem,
  ));

  if (finalSerialized.returnedBytes > maxResponseBytes) {
    return responseTooSmall(maxResponseBytes, finalSerialized.returnedBytes);
  }
  if (selectedSerialized && finalSerialized.returnedBytes !== selectedSerialized.returnedBytes) {
    throw new EdgeBaseError(
      500,
      'Persisted response cursor changed the bounded response length.',
      undefined,
      'response-cursor-length-mismatch',
    );
  }
  return jsonResponse(finalSerialized);
}
