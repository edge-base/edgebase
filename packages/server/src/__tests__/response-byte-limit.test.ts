import { describe, expect, it } from 'vitest';
import {
  MIN_MAX_RESPONSE_BYTES,
  RESPONSE_CURSOR_GC_LIMIT,
  RESPONSE_CURSOR_LENGTH,
  RESPONSE_CURSOR_PREFIX,
  RESPONSE_CURSOR_TTL_MS,
  buildBoundedPageResponse,
  issueResponseCursor,
  issueResponseCursorWithExpiry,
  isResponseCursor,
  parseMaxResponseBytes,
  prepareBoundedQuery,
  resolveResponseCursor,
  serializeJsonWithReturnedBytes,
  type ResponseCursorRecord,
  type ResponseCursorStore,
} from '../lib/response-byte-limit.js';

class MemoryCursorStore implements ResponseCursorStore {
  readonly records = new Map<string, ResponseCursorRecord>();
  readonly gcLimits: number[] = [];
  ensureCalls = 0;
  createCalls = 0;

  async ensureReady(): Promise<void> {
    this.ensureCalls += 1;
  }

  async findByToken(token: string): Promise<ResponseCursorRecord | null> {
    return this.records.get(token) ?? null;
  }

  async findByRecord(tableName: string, recordId: string): Promise<ResponseCursorRecord | null> {
    return [...this.records.values()].find((record) =>
      record.tableName === tableName && record.recordId === recordId) ?? null;
  }

  async create(record: ResponseCursorRecord): Promise<'inserted' | 'token-conflict' | 'record-conflict'> {
    this.createCalls += 1;
    if (this.records.has(record.token)) return 'token-conflict';
    if (await this.findByRecord(record.tableName, record.recordId)) return 'record-conflict';
    this.records.set(record.token, record);
    return 'inserted';
  }

  async touch(token: string, expiresAt: number): Promise<void> {
    const record = this.records.get(token);
    if (record) this.records.set(token, { ...record, expiresAt });
  }

  async deleteByToken(token: string): Promise<void> {
    this.records.delete(token);
  }

  async deleteExpired(now: number, limit: number): Promise<number> {
    this.gcLimits.push(limit);
    const expired = [...this.records.values()]
      .filter((record) => record.expiresAt <= now)
      .slice(0, limit);
    for (const record of expired) this.records.delete(record.token);
    return expired.length;
  }
}

function deterministicRandom(fill: number) {
  return (length: number) => new Uint8Array(length).fill(fill);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function bodyOf(response: Response) {
  const body = await response.text();
    const json = JSON.parse(body) as Record<string, unknown>;
  return { body, json };
}

describe('bounded JSON response serialization', () => {
  it.each([
    undefined,
    String(MIN_MAX_RESPONSE_BYTES),
    String(Number.MAX_SAFE_INTEGER),
  ])('accepts an omitted or safe integer maxResponseBytes value (%s)', (raw) => {
    expect(parseMaxResponseBytes(raw)).toBe(raw === undefined ? undefined : Number(raw));
  });

  it.each(['', '0', '-1', '1.5', 'Infinity', String(MIN_MAX_RESPONSE_BYTES - 1), '9007199254740992'])(
    'rejects invalid maxResponseBytes value %s', (raw) => {
      expect(() => parseMaxResponseBytes(raw)).toThrow(/maxResponseBytes/);
    });

  it('counts the exact UTF-8 body including Unicode and the returnedBytes field itself', () => {
    const serialized = serializeJsonWithReturnedBytes({ items: [{ id: '한글', emoji: '🙂' }] });
    expect(new TextEncoder().encode(serialized.body).byteLength).toBe(serialized.returnedBytes);
    expect(JSON.parse(serialized.body)).toEqual({
      items: [{ id: '한글', emoji: '🙂' }],
      returnedBytes: serialized.returnedBytes,
    });
  });

  it('honors exact at/one-byte-under boundaries and reports an oversized first item', async () => {
    const store = new MemoryCursorStore();
    const items = [{ id: 'r1', title: '🙂'.repeat(100) }];
    const probe = await buildBoundedPageResponse({
      maxResponseBytes: 10_000,
      tableName: 'docs',
      items,
      cursorRecordIds: ['r1'],
      total: 1,
      perPage: 10,
      sourceHasMore: false,
      cursorStore: store,
      now: 1,
      randomBytes: deterministicRandom(1),
    });
    const exact = new TextEncoder().encode(await probe.clone().text()).byteLength;

    const at = await buildBoundedPageResponse({
      maxResponseBytes: exact,
      tableName: 'docs',
      items,
      cursorRecordIds: ['r1'],
      total: 1,
      perPage: 10,
      sourceHasMore: false,
      cursorStore: store,
      now: 2,
    });
    const under = await buildBoundedPageResponse({
      maxResponseBytes: exact - 1,
      tableName: 'docs',
      items,
      cursorRecordIds: ['r1'],
      total: 1,
      perPage: 10,
      sourceHasMore: false,
      cursorStore: store,
      now: 3,
    });

    expect((await at.json() as { items: unknown[] }).items).toHaveLength(1);
    await expect(under.json()).resolves.toMatchObject({ items: [], oversizedItem: true });
  });

  it('returns an exact bounded empty page', async () => {
    const response = await buildBoundedPageResponse({
      maxResponseBytes: MIN_MAX_RESPONSE_BYTES,
      tableName: 'docs',
      items: [],
      cursorRecordIds: [],
      total: 0,
      perPage: 20,
      sourceHasMore: false,
      cursorStore: new MemoryCursorStore(),
    });
    const { body, json } = await bodyOf(response);
    expect(json).toMatchObject({ items: [], total: 0, hasMore: false, cursor: null });
    expect(json.returnedBytes).toBe(new TextEncoder().encode(body).byteLength);
  });
});

describe('provider-owned bounded response cursors', () => {
  it('recognizes opaque cursors and prepares their keyset continuation', async () => {
    const store = new MemoryCursorStore();
    const now = Date.now();
    const issued = await issueResponseCursorWithExpiry(store, 'docs', 'row-1', {
      now,
      randomBytes: deterministicRandom(6),
    });
    expect(isResponseCursor(issued.token)).toBe(true);
    expect(issued.expiresAt).toBe(now + RESPONSE_CURSOR_TTL_MS);

    await expect(prepareBoundedQuery({
      maxResponseBytes: String(MIN_MAX_RESPONSE_BYTES),
      responseAfter: issued.token,
    }, 'docs', store)).resolves.toEqual({
      maxResponseBytes: MIN_MAX_RESPONSE_BYTES,
      params: {
        maxResponseBytes: String(MIN_MAX_RESPONSE_BYTES),
        after: 'row-1',
      },
    });
  });

  it('uses fixed-size opaque tokens, reuses row ownership, and resolves only within the table', async () => {
    const store = new MemoryCursorStore();
    const token = await issueResponseCursor(store, 'docs', 'x'.repeat(20_000), {
      now: 100,
      randomBytes: deterministicRandom(7),
    });
    const reused = await issueResponseCursor(store, 'docs', 'x'.repeat(20_000), { now: 200 });
    expect(token).toHaveLength(RESPONSE_CURSOR_LENGTH);
    expect(token.startsWith(RESPONSE_CURSOR_PREFIX)).toBe(true);
    expect(reused).toBe(token);
    expect(store.createCalls).toBe(1);
    await expect(resolveResponseCursor(store, 'docs', token, 300)).resolves.toBe('x'.repeat(20_000));
    await expect(resolveResponseCursor(store, 'other', token, 300)).rejects.toThrow(/unknown/);
    expect(store.records).toHaveLength(1);
    expect(store.gcLimits.every((limit) => limit === RESPONSE_CURSOR_GC_LIMIT)).toBe(true);
  });

  it('retries token collisions without overwriting another row', async () => {
    const store = new MemoryCursorStore();
    const occupied = await issueResponseCursor(store, 'docs', 'first', {
      now: 1,
      randomBytes: deterministicRandom(1),
    });
    const fills = [1, 2];
    const token = await issueResponseCursor(store, 'docs', 'second', {
      now: 2,
      randomBytes: (length) => new Uint8Array(length).fill(fills.shift() ?? 2),
    });
    expect(token).not.toBe(occupied);
    expect(store.records.get(occupied)?.recordId).toBe('first');
    expect(store.records.get(token)?.recordId).toBe('second');
  });

  it('single-flights a held identical cursor issuance and clears the flight after failure', async () => {
    const store = new MemoryCursorStore();
    const entered = deferred();
    const release = deferred();
    const originalCreate = store.create.bind(store);
    let failFirst = true;
    store.create = async (record) => {
      entered.resolve();
      await release.promise;
      if (failFirst) {
        failFirst = false;
        throw new Error('held cursor write failed');
      }
      return originalCreate(record);
    };

    const first = issueResponseCursor(store, 'docs', 'held', {
      now: 1,
      randomBytes: deterministicRandom(3),
    });
    await entered.promise;
    const second = issueResponseCursor(store, 'docs', 'held', {
      now: 1,
      randomBytes: deterministicRandom(4),
    });
    release.resolve();
    await expect(first).rejects.toThrow('held cursor write failed');
    await expect(second).rejects.toThrow('held cursor write failed');

    await expect(issueResponseCursor(store, 'docs', 'held', {
      now: 2,
      randomBytes: deterministicRandom(5),
    })).resolves.toMatch(new RegExp(`^${RESPONSE_CURSOR_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    expect(store.records).toHaveLength(1);
  });

  it('returns a typed expired outcome while preserving the raw keyset boundary until expiry', async () => {
    const store = new MemoryCursorStore();
    const token = await issueResponseCursor(store, 'docs', 'deleted-row-boundary', {
      now: 10,
      randomBytes: deterministicRandom(8),
    });
    await expect(resolveResponseCursor(store, 'docs', token, 10 + RESPONSE_CURSOR_TTL_MS - 1))
      .resolves.toBe('deleted-row-boundary');
    await expect(resolveResponseCursor(store, 'docs', token, 10 + (2 * RESPONSE_CURSOR_TTL_MS) + 1))
      .rejects.toMatchObject({ slug: 'response-cursor-expired' });
    expect(store.records.has(token)).toBe(false);
  });

  it('runs bounded cursor GC only once when a continuation resolves then issues its next cursor', async () => {
    const store = new MemoryCursorStore();
    const first = await issueResponseCursor(store, 'docs', 'first', {
      now: 1,
      randomBytes: deterministicRandom(1),
    });
    const gcCallsBeforeContinuation = store.gcLimits.length;

    await expect(resolveResponseCursor(store, 'docs', first, 2)).resolves.toBe('first');
    await issueResponseCursor(store, 'docs', 'second', {
      now: 2,
      randomBytes: deterministicRandom(2),
    });

    expect(store.gcLimits.slice(gcCallsBeforeContinuation)).toEqual([RESPONSE_CURSOR_GC_LIMIT]);
  });

  it('full-drains around one oversized row without replaying it or offset drift', async () => {
    const store = new MemoryCursorStore();
    const rows = [
      { id: 'a', value: 'small' },
      { id: 'b', value: '🙂'.repeat(1_000) },
      { id: 'c', value: 'small' },
    ];
    let afterId: string | null = null;
    const delivered: string[] = [];
    const oversized: string[] = [];

    for (let pass = 0; pass < 5; pass += 1) {
      const start = afterId === null ? 0 : rows.findIndex((row) => row.id === afterId) + 1;
      const page = rows.slice(start);
      if (page.length === 0) break;
      const response = await buildBoundedPageResponse({
        maxResponseBytes: MIN_MAX_RESPONSE_BYTES,
        tableName: 'docs',
        items: page,
        cursorRecordIds: page.map(({ id }) => id),
        total: rows.length,
        perPage: rows.length,
        sourceHasMore: false,
        cursorStore: store,
        now: pass + 1,
        randomBytes: deterministicRandom(pass + 1),
      });
      const json = await response.json() as {
        items: Array<{ id: string }>;
        cursor: string;
        oversizedItem?: boolean;
        returnedBytes: number;
      };
      expect(json.returnedBytes).toBeLessThanOrEqual(MIN_MAX_RESPONSE_BYTES);
      delivered.push(...json.items.map(({ id }) => id));
      afterId = await resolveResponseCursor(store, 'docs', json.cursor, pass + 1);
      if (json.oversizedItem) oversized.push(afterId);
    }

    expect(delivered).toEqual(['a', 'c']);
    expect(oversized).toEqual(['b']);
    expect(new Set([...delivered, ...oversized])).toEqual(new Set(['a', 'b', 'c']));
  });
});
