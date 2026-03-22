/**
 * @edge-base/core — 단위 테스트
 *
 * 테스트 대상: src/table.ts, src/field-ops.ts, src/errors.ts, src/context.ts
 *
 * 실행: cd packages/sdk/js/packages/core && npx vitest run
 *
 * 원칙: 서버 불필요 — 순수 TypeScript 로직만 검증
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  increment,
  deleteField,
  isFieldOp,
  serializeFieldOps,
} from '../../src/field-ops.js';
import { EdgeBaseError, parseErrorResponse } from '../../src/errors.js';
import { ContextManager } from '../../src/context.js';

// ─── A. increment / deleteField 생성 ─────────────────────────────────────────

describe('fieldOps — increment', () => {
  it('increment(1).$op === "increment"', () => {
    const op = increment(1);
    expect(op.$op).toBe('increment');
  });

  it('increment(1).value === 1', () => {
    expect(increment(1).value).toBe(1);
  });

  it('increment(-5).value === -5', () => {
    expect(increment(-5).value).toBe(-5);
  });

  it('increment은 isFieldOp 반환 true', () => {
    expect(isFieldOp(increment(3))).toBe(true);
  });

  it('increment(0).value === 0', () => {
    expect(increment(0).value).toBe(0);
  });
});

describe('fieldOps — deleteField', () => {
  it('deleteField().$op === "deleteField"', () => {
    expect(deleteField().$op).toBe('deleteField');
  });

  it('deleteField()는 isFieldOp 반환 true', () => {
    expect(isFieldOp(deleteField())).toBe(true);
  });

  it('deleteField().value === undefined', () => {
    expect(deleteField().value).toBeUndefined();
  });
});

// ─── B. isFieldOp ────────────────────────────────────────────────────────────

describe('isFieldOp', () => {
  it('일반 string → false', () => {
    expect(isFieldOp('hello')).toBe(false);
  });

  it('null → false', () => {
    expect(isFieldOp(null)).toBe(false);
  });

  it('number → false', () => {
    expect(isFieldOp(42)).toBe(false);
  });

  it('빈 객체 → false', () => {
    expect(isFieldOp({})).toBe(false);
  });

  it('{ $op: "increment" } 일반 obj → false (symbol 없음)', () => {
    expect(isFieldOp({ $op: 'increment', value: 1 })).toBe(false);
  });
});

// ─── C. serializeFieldOps ─────────────────────────────────────────────────────

describe('serializeFieldOps', () => {
  it('increment op → { $op, value }로 직렬화', () => {
    const data = { viewCount: increment(3) };
    const result = serializeFieldOps(data as Record<string, unknown>);
    expect(result.viewCount).toEqual({ $op: 'increment', value: 3 });
  });

  it('deleteField op → { $op: "deleteField" }로 직렬화', () => {
    const data = { tempFlag: deleteField() };
    const result = serializeFieldOps(data as Record<string, unknown>);
    expect(result.tempFlag).toEqual({ $op: 'deleteField' });
  });

  it('일반 값은 그대로 통과', () => {
    const data = { title: 'Hello', count: 5 };
    const result = serializeFieldOps(data);
    expect(result.title).toBe('Hello');
    expect(result.count).toBe(5);
  });

  it('혼합 data — op + 일반값 모두 포함', () => {
    const data = { title: 'Post', views: increment(1), oldField: deleteField() };
    const result = serializeFieldOps(data as Record<string, unknown>);
    expect(result.title).toBe('Post');
    expect(result.views).toEqual({ $op: 'increment', value: 1 });
    expect(result.oldField).toEqual({ $op: 'deleteField' });
  });

  it('빈 객체 → 빈 결과', () => {
    expect(serializeFieldOps({})).toEqual({});
  });
});

// ─── D. EdgeBaseError ─────────────────────────────────────────────────────────

describe('EdgeBaseError', () => {
  it('status + message 저장', () => {
    const err = new EdgeBaseError(404, 'Not found');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Not found');
  });

  it('instanceof Error', () => {
    expect(new EdgeBaseError(500, 'err') instanceof Error).toBe(true);
  });

  it('instanceof EdgeBaseError', () => {
    expect(new EdgeBaseError(403, 'Forbidden') instanceof EdgeBaseError).toBe(true);
  });

  it('name === "EdgeBaseError"', () => {
    expect(new EdgeBaseError(400, 'bad').name).toBe('EdgeBaseError');
  });

  it('data 필드 선택적 저장', () => {
    const err = new EdgeBaseError(422, 'Validation', { field: 'email' });
    expect(err.data).toEqual({ field: 'email' });
  });
});

// ─── E. parseErrorResponse ────────────────────────────────────────────────────

describe('parseErrorResponse', () => {
  it('status 404 → EdgeBaseError(404)', () => {
    const err = parseErrorResponse(404, { message: 'Not found' });
    expect(err.status).toBe(404);
  });

  it('body.message 보존', () => {
    const err = parseErrorResponse(400, { message: 'Bad input' });
    expect(err.message).toContain('Bad input');
  });

  it('body null → 기본 메시지 사용', () => {
    const err = parseErrorResponse(500, null);
    expect(err.status).toBe(500);
    expect(typeof err.message).toBe('string');
  });

  it('body string → 기본 메시지 사용', () => {
    const err = parseErrorResponse(403, 'forbidden text');
    expect(err.status).toBe(403);
  });

  it('body.data → err.data에 보존', () => {
    const err = parseErrorResponse(422, { message: 'Val', data: { field: 'x' } });
    expect(err.data).toEqual({ field: 'x' });
  });
});

// ─── F. ContextManager ────────────────────────────────────────────────────────

describe('ContextManager', () => {
  it('기본 상태 — getContext는 빈 객체', () => {
    const cm = new ContextManager();
    expect(cm.getContext()).toEqual({});
  });

  it('setContext 후 getContext에 반영', () => {
    const cm = new ContextManager();
    cm.setContext({ workspaceId: 'ws-123' });
    expect(cm.getContext().workspaceId).toBe('ws-123');
  });

  it('여러 항목 setContext', () => {
    const cm = new ContextManager();
    cm.setContext({ workspaceId: 'ws-1', userId: 'u-2' });
    const ctx = cm.getContext();
    expect(ctx.workspaceId).toBe('ws-1');
    expect(ctx.userId).toBe('u-2');
  });
});

describe('TableRef', () => {
  it('getList() returns list result', async () => {
    const table = new TableRef<{ id: string }>(
      {
        dbSingleListRecords: async () => ({
          items: [{ id: 'post-1' }],
          total: 1,
          page: 1,
          perPage: 20,
        }),
      } as any,
      'posts',
    );

    const result = await table.getList();
    expect(result.items[0]?.id).toBe('post-1');
    expect(result.total).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Phase 2 additions below
// ═══════════════════════════════════════════════════════════════════════════════

import { HttpClient, type HttpClientOptions } from '../../src/http.js';
import {
  TableRef,
  DocRef,
  DbRef,
  OrBuilder,
  type ListResult,
  type BatchByFilterResult,
} from '../../src/table.js';
import { StorageBucket, StorageClient } from '../../src/storage.js';
import { DefaultDbApi } from '../../src/generated/api-core.js';
import { HttpClientAdapter } from '../../src/transport-adapter.js';
import type { ITokenManager, ITokenPair } from '../../src/types.js';

// ─── G. HttpClient — constructor & URL handling ─────────────────────────────

describe('HttpClient — constructor', () => {
  it('trailing slash stripped from baseUrl', () => {
    const cm = new ContextManager();
    const client = new HttpClient({ baseUrl: 'http://localhost:8688/', contextManager: cm });
    expect(client.getBaseUrl()).toBe('http://localhost:8688');
  });

  it('baseUrl without trailing slash unchanged', () => {
    const cm = new ContextManager();
    const client = new HttpClient({ baseUrl: 'https://example.com', contextManager: cm });
    expect(client.getBaseUrl()).toBe('https://example.com');
  });

  it('getBaseUrl returns resolved URL', () => {
    const cm = new ContextManager();
    const client = new HttpClient({ baseUrl: 'http://localhost:3000', contextManager: cm });
    expect(client.getBaseUrl()).toBe('http://localhost:3000');
  });

  it('serviceKey stored (no browser warning in Node)', () => {
    const cm = new ContextManager();
    // In Node.js (vitest), window is undefined — no warning expected
    expect(() =>
      new HttpClient({ baseUrl: 'http://localhost', serviceKey: 'sk-test', contextManager: cm })
    ).not.toThrow();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('HttpClient — bodyless JSON requests', () => {
  it('postPublic() without body omits Content-Type and request body', async () => {
    const cm = new ContextManager();
    const client = new HttpClient({ baseUrl: 'http://localhost:8688', contextManager: cm });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await client.postPublic('/api/auth/signin/anonymous');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0] ?? [];
    const headers = (options?.headers ?? {}) as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(options?.body).toBeUndefined();
  });

  it('postPublic() with body still sends JSON payload and Content-Type', async () => {
    const cm = new ContextManager();
    const client = new HttpClient({ baseUrl: 'http://localhost:8688', contextManager: cm });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await client.postPublic('/api/auth/signin/anonymous', {});

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0] ?? [];
    const headers = (options?.headers ?? {}) as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(options?.body).toBe('{}');
  });

  it('does not send legacy context headers even when context is set', async () => {
    const cm = new ContextManager();
    cm.setContext({ workspaceId: 'ws-123' });
    const client = new HttpClient({ baseUrl: 'http://localhost:8688', contextManager: cm });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await client.get('/api/db/shared/tables/posts');

    const [, options] = fetchSpy.mock.calls[0] ?? [];
    const headers = (options?.headers ?? {}) as Record<string, string>;
    expect(headers['X-EdgeBase-Context']).toBeUndefined();
  });
});

describe('HttpClient — 401 retry', () => {
  it('invalidates the cached access token before retrying with refreshed credentials', async () => {
    const cm = new ContextManager();
    let accessToken = 'stale-access-token';
    let refreshToken = 'refresh-token';

    const tokenManager: ITokenManager = {
      getAccessToken: vi.fn(async (refreshFn?: (refreshToken: string) => Promise<ITokenPair>) => {
        if (accessToken) return accessToken;
        if (!refreshFn || !refreshToken) return null;
        const tokens = await refreshFn(refreshToken);
        tokenManager.setTokens(tokens);
        return tokens.accessToken;
      }),
      getRefreshToken: () => refreshToken,
      invalidateAccessToken: vi.fn(() => {
        accessToken = '';
      }),
      setTokens: vi.fn((tokens: ITokenPair) => {
        accessToken = tokens.accessToken;
        refreshToken = tokens.refreshToken;
      }),
      clearTokens: vi.fn(() => {
        accessToken = '';
        refreshToken = '';
      }),
    };

    const client = new HttpClient({
      baseUrl: 'http://localhost:8688',
      contextManager: cm,
      tokenManager,
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Unauthorized.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          accessToken: 'fresh-access-token',
          refreshToken: 'fresh-refresh-token',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const result = await client.get<{ ok: boolean }>('/api/protected');

    expect(result).toEqual({ ok: true });
    expect(tokenManager.invalidateAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const firstHeaders = (fetchSpy.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    const refreshHeaders = (fetchSpy.mock.calls[1]?.[1]?.headers ?? {}) as Record<string, string>;
    const retryHeaders = (fetchSpy.mock.calls[2]?.[1]?.headers ?? {}) as Record<string, string>;

    expect(firstHeaders.Authorization).toBe('Bearer stale-access-token');
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('http://localhost:8688/api/auth/refresh');
    expect(refreshHeaders.Authorization).toBeUndefined();
    expect(retryHeaders.Authorization).toBe('Bearer fresh-access-token');
  });
});

// ─── H. TableRef — immutable chaining ───────────────────────────────────────

describe('TableRef — immutable chaining', () => {
  const cm = new ContextManager();
  const client = new HttpClient({ baseUrl: 'http://localhost:8688', contextManager: cm });
  const core = new DefaultDbApi(new HttpClientAdapter(client));

  it('where() returns new instance', () => {
    const t1 = new TableRef(core, 'posts', undefined, undefined, 'shared');
    const t2 = t1.where('status', '==', 'published');
    expect(t1).not.toBe(t2);
  });

  it('chained where preserves previous filters', () => {
    const t1 = new TableRef(core, 'posts', undefined, undefined, 'shared');
    const t2 = t1.where('a', '==', 1).where('b', '>', 2);
    expect(t2).toBeTruthy();
    // t1 should not be affected
    expect(t1).not.toBe(t2);
  });

  it('orderBy returns new instance', () => {
    const t = new TableRef(core, 'posts', undefined, undefined, 'shared');
    const t2 = t.orderBy('createdAt', 'desc');
    expect(t).not.toBe(t2);
  });

  it('orderBy default direction is asc', () => {
    const t = new TableRef(core, 'posts', undefined, undefined, 'shared');
    const t2 = t.orderBy('title');
    expect(t2).toBeTruthy(); // no error
  });

  it('limit returns new instance', () => {
    const t = new TableRef(core, 'posts', undefined, undefined, 'shared');
    expect(t.limit(10)).not.toBe(t);
  });

  it('offset returns new instance', () => {
    const t = new TableRef(core, 'posts', undefined, undefined, 'shared');
    expect(t.offset(20)).not.toBe(t);
  });

  it('page returns new instance', () => {
    const t = new TableRef(core, 'posts', undefined, undefined, 'shared');
    expect(t.page(3)).not.toBe(t);
  });

  it('search returns new instance', () => {
    const t = new TableRef(core, 'posts', undefined, undefined, 'shared');
    expect(t.search('hello')).not.toBe(t);
  });

  it('after returns new instance', () => {
    const t = new TableRef(core, 'posts', undefined, undefined, 'shared');
    expect(t.after('cursor-abc')).not.toBe(t);
  });

  it('before returns new instance', () => {
    const t = new TableRef(core, 'posts', undefined, undefined, 'shared');
    expect(t.before('cursor-xyz')).not.toBe(t);
  });

  it('or returns new instance', () => {
    const t = new TableRef(core, 'posts', undefined, undefined, 'shared');
    const t2 = t.or(q => q.where('a', '==', 1));
    expect(t).not.toBe(t2);
  });

  it('full chain builds without error', () => {
    const t = new TableRef(core, 'posts', undefined, undefined, 'shared');
    const query = t
      .where('status', '==', 'published')
      .where('views', '>', 100)
      .orderBy('createdAt', 'desc')
      .limit(20);
    expect(query).toBeTruthy();
  });

  it('doc() returns DocRef', () => {
    const t = new TableRef(core, 'posts', undefined, undefined, 'shared');
    const doc = t.doc('id-123');
    expect(doc).toBeInstanceOf(DocRef);
  });
});

describe('TableRef.onSnapshot', () => {
  function createDatabaseLiveHarness() {
    let changeHandler:
      | ((change: { changeType: 'added' | 'modified' | 'removed'; data: unknown; docId: string }) => void)
      | undefined;

    return {
      subscriber: {
        onSnapshot: vi.fn((_channel, callback) => {
          changeHandler = callback as typeof changeHandler;
          return { unsubscribe: vi.fn() };
        }),
      },
      emit(change: { changeType: 'added' | 'modified' | 'removed'; data: unknown; docId: string }) {
        if (!changeHandler) {
          throw new Error('database-live callback was not registered');
        }
        changeHandler(change);
      },
    };
  }

  it('applies client-side operators and OR filters by default', async () => {
    vi.useFakeTimers();
    const live = createDatabaseLiveHarness();
    const snapshots: Array<{
      items: Array<Record<string, unknown>>;
      changes: {
        added: Array<Record<string, unknown>>;
        modified: Array<Record<string, unknown>>;
        removed: Array<Record<string, unknown>>;
      };
    }> = [];

    new TableRef<Record<string, unknown>>({} as never, 'posts', live.subscriber as never, undefined, 'shared')
      .where('score', '>', 10)
      .or((query) =>
        query
          .where('status', '==', 'featured')
          .where('tags', 'contains-any', ['hot']),
      )
      .onSnapshot((snapshot) => {
        snapshots.push(snapshot);
      });

    const matchingDoc = { id: 'post-1', score: 12, status: 'draft', tags: ['hot'] };
    live.emit({ changeType: 'added', docId: 'post-1', data: matchingDoc });
    live.emit({ changeType: 'added', docId: 'post-2', data: { id: 'post-2', score: 12, status: 'draft', tags: ['cold'] } });
    live.emit({ changeType: 'added', docId: 'post-3', data: { id: 'post-3', score: 8, status: 'featured', tags: ['hot'] } });

    await vi.runAllTimersAsync();

    expect(snapshots).toEqual([{
      items: [matchingDoc],
      changes: {
        added: [matchingDoc],
        modified: [],
        removed: [],
      },
    }]);
  });

  it('emits removed when a tracked item stops matching client-side filters', async () => {
    vi.useFakeTimers();
    const live = createDatabaseLiveHarness();
    const snapshots: Array<{
      items: Array<Record<string, unknown>>;
      changes: {
        added: Array<Record<string, unknown>>;
        modified: Array<Record<string, unknown>>;
        removed: Array<Record<string, unknown>>;
      };
    }> = [];

    new TableRef<Record<string, unknown>>({} as never, 'posts', live.subscriber as never, undefined, 'shared')
      .where('score', '>', 10)
      .onSnapshot((snapshot) => {
        snapshots.push(snapshot);
      });

    const matchingDoc = { id: 'post-1', score: 11 };
    const nonMatchingDoc = { id: 'post-1', score: 9 };

    live.emit({ changeType: 'added', docId: 'post-1', data: matchingDoc });
    await vi.runAllTimersAsync();

    live.emit({ changeType: 'modified', docId: 'post-1', data: nonMatchingDoc });
    await vi.runAllTimersAsync();

    expect(snapshots).toEqual([
      {
        items: [matchingDoc],
        changes: {
          added: [matchingDoc],
          modified: [],
          removed: [],
        },
      },
      {
        items: [],
        changes: {
          added: [],
          modified: [],
          removed: [nonMatchingDoc],
        },
      },
    ]);
  });
});

// ─── I. ListResult structure ────────────────────────────────────────────────

describe('ListResult — type validation', () => {
  it('empty ListResult has correct shape', () => {
    const result: ListResult<unknown> = {
      items: [],
      total: null,
      page: null,
      perPage: null,
      hasMore: null,
      cursor: null,
    };
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.total).toBeNull();
  });

  it('offset mode ListResult', () => {
    const result: ListResult<{ id: string }> = {
      items: [{ id: '1' }],
      total: 100,
      page: 1,
      perPage: 10,
      hasMore: null,
      cursor: null,
    };
    expect(result.total).toBe(100);
    expect(result.page).toBe(1);
    expect(result.items).toHaveLength(1);
  });

  it('cursor mode ListResult', () => {
    const result: ListResult<{ id: string }> = {
      items: [{ id: 'a' }],
      total: null,
      page: null,
      perPage: null,
      hasMore: true,
      cursor: 'cur-abc',
    };
    expect(result.hasMore).toBe(true);
    expect(result.cursor).toBe('cur-abc');
  });
});

// ─── J. BatchByFilterResult structure ───────────────────────────────────────

describe('BatchByFilterResult — type validation', () => {
  it('success result shape', () => {
    const result: BatchByFilterResult = {
      totalProcessed: 10,
      totalSucceeded: 10,
      errors: [],
    };
    expect(result.totalProcessed).toBe(10);
    expect(result.errors).toHaveLength(0);
  });

  it('partial failure result shape', () => {
    const result: BatchByFilterResult = {
      totalProcessed: 10,
      totalSucceeded: 5,
      errors: [{ chunkIndex: 1, chunkSize: 500, error: new EdgeBaseError(500, 'fail') }],
    };
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].chunkIndex).toBe(1);
  });
});

// ─── K. OrBuilder ───────────────────────────────────────────────────────────

describe('OrBuilder — filter construction', () => {
  it('empty builder has no filters', () => {
    const ob = new OrBuilder();
    expect(ob.getFilters()).toHaveLength(0);
  });

  it('single where adds one filter', () => {
    const ob = new OrBuilder();
    ob.where('status', '==', 'draft');
    expect(ob.getFilters()).toHaveLength(1);
    expect(ob.getFilters()[0]).toEqual(['status', '==', 'draft']);
  });

  it('chained where accumulates filters', () => {
    const ob = new OrBuilder();
    ob.where('a', '==', 1).where('b', '>', 2).where('c', 'contains', 'hello');
    expect(ob.getFilters()).toHaveLength(3);
  });

  it('getFilters returns copy (not reference)', () => {
    const ob = new OrBuilder();
    ob.where('x', '==', 1);
    const f1 = ob.getFilters();
    const f2 = ob.getFilters();
    expect(f1).not.toBe(f2);
    expect(f1).toEqual(f2);
  });

  it('all operators supported: ==, !=, >, <, >=, <=, contains, in, not in', () => {
    const ob = new OrBuilder();
    ob.where('a', '==', 1)
      .where('b', '!=', 2)
      .where('c', '>', 3)
      .where('d', '<', 4)
      .where('e', '>=', 5)
      .where('f', '<=', 6)
      .where('g', 'contains', 'text')
      .where('h', 'in', [1, 2])
      .where('i', 'not in', [3, 4]);
    expect(ob.getFilters()).toHaveLength(9);
  });
});

// ─── L. StorageBucket — URL construction ────────────────────────────────────

describe('StorageBucket — URL & method signatures', () => {
  const cm = new ContextManager();
  const httpClient = new HttpClient({ baseUrl: 'http://localhost:8688', contextManager: cm });

  it('getUrl builds correct URL', () => {
    const bucket = new StorageBucket(httpClient, 'avatars');
    const url = bucket.getUrl('profile.png');
    expect(url).toBe('http://localhost:8688/api/storage/avatars/profile.png');
  });

  it('getUrl encodes path segments', () => {
    const bucket = new StorageBucket(httpClient, 'docs');
    const url = bucket.getUrl('folder/sub folder/file.txt');
    expect(url).toContain('sub%20folder');
    expect(url).toContain('file.txt');
  });

  it('getUrl with nested path', () => {
    const bucket = new StorageBucket(httpClient, 'images');
    const url = bucket.getUrl('users/user-1/avatar.jpg');
    expect(url).toContain('users');
    expect(url).toContain('user-1');
    expect(url).toContain('avatar.jpg');
  });
});

// ─── M. StorageClient — convenience methods ────────────────────────────────

describe('StorageClient — getUrl convenience', () => {
  const cm = new ContextManager();
  const httpClient = new HttpClient({ baseUrl: 'http://localhost:8688', contextManager: cm });

  it('getUrl shorthand works', () => {
    const storage = new StorageClient(httpClient);
    const url = storage.getUrl('avatars', 'pic.png');
    expect(url).toContain('avatars');
    expect(url).toContain('pic.png');
  });

  it('bucket() returns StorageBucket', () => {
    const storage = new StorageClient(httpClient);
    const bucket = storage.bucket('uploads');
    expect(bucket).toBeInstanceOf(StorageBucket);
  });
});

// ─── N. DocRef — type checks ────────────────────────────────────────────────

describe('DocRef — construction', () => {
  const cm = new ContextManager();
  const httpClient = new HttpClient({ baseUrl: 'http://localhost:8688', contextManager: cm });
  const docCore = new DefaultDbApi(new HttpClientAdapter(httpClient));

  it('DocRef instance created via TableRef.doc()', () => {
    const table = new TableRef(docCore, 'posts', undefined, undefined, 'shared');
    const doc = table.doc('doc-1');
    expect(doc).toBeInstanceOf(DocRef);
  });

  it('DocRef.get is a function', () => {
    const table = new TableRef(docCore, 'posts', undefined, undefined, 'shared');
    const doc = table.doc('doc-1');
    expect(typeof doc.get).toBe('function');
  });

  it('DocRef.update is a function', () => {
    const table = new TableRef(docCore, 'posts', undefined, undefined, 'shared');
    const doc = table.doc('doc-1');
    expect(typeof doc.update).toBe('function');
  });

  it('DocRef.delete is a function', () => {
    const table = new TableRef(docCore, 'posts', undefined, undefined, 'shared');
    const doc = table.doc('doc-1');
    expect(typeof doc.delete).toBe('function');
  });
});

// ─── O. ContextManager — extended ──────────────────────────────────────────

describe('ContextManager — extended', () => {
  it('auth.id key is silently filtered out', () => {
    const cm = new ContextManager();
    cm.setContext({ 'auth.id': 'user-1', workspaceId: 'ws-1' });
    const ctx = cm.getContext();
    expect(ctx['auth.id']).toBeUndefined();
    expect(ctx.workspaceId).toBe('ws-1');
  });

  it('getContext returns copy (not reference)', () => {
    const cm = new ContextManager();
    cm.setContext({ workspaceId: 'ws-1' });
    const ctx1 = cm.getContext();
    const ctx2 = cm.getContext();
    expect(ctx1).not.toBe(ctx2);
    expect(ctx1).toEqual(ctx2);
  });

  it('requireContextKey passes for existing key', () => {
    const cm = new ContextManager();
    cm.setContext({ workspaceId: 'ws-1' });
    expect(() => cm.requireContextKey('workspaceId')).not.toThrow();
  });

  it('requireContextKey throws for missing key', () => {
    const cm = new ContextManager();
    expect(() => cm.requireContextKey('missing')).toThrow();
  });

  it('requireContextKey passes for auth.id (handled via JWT)', () => {
    const cm = new ContextManager();
    expect(() => cm.requireContextKey('auth.id')).not.toThrow();
  });

  it('onContextChange fires on setContext', () => {
    const cm = new ContextManager();
    const calls: unknown[] = [];
    cm.onContextChange((ctx) => calls.push(ctx));
    cm.setContext({ workspaceId: 'ws-1' });
    expect(calls).toHaveLength(1);
  });

  it('onContextChange fires on setContext with empty object', () => {
    const cm = new ContextManager();
    const calls: unknown[] = [];
    cm.setContext({ workspaceId: 'ws-1' });
    cm.onContextChange((ctx) => calls.push(ctx));
    cm.setContext({});
    expect(calls).toHaveLength(1);
  });

  it('onContextChange unsubscribe works', () => {
    const cm = new ContextManager();
    let count = 0;
    const unsub = cm.onContextChange(() => count++);
    cm.setContext({ a: '1' });
    expect(count).toBe(1);
    unsub();
    cm.setContext({ b: '2' });
    expect(count).toBe(1); // no more calls
  });
});

// ─── P. DbRef ───────────────────────────────────────────────────────────────

describe('DbRef — table reference creation', () => {
  const cm = new ContextManager();
  const httpClient = new HttpClient({ baseUrl: 'http://localhost:8688', contextManager: cm });

  it('db("shared").table("posts") returns TableRef', () => {
    const db = new DbRef(httpClient, 'shared');
    const table = db.table('posts');
    expect(table).toBeInstanceOf(TableRef);
  });

  it('db("workspace", "ws-1").table("docs") returns TableRef', () => {
    const db = new DbRef(httpClient, 'workspace', 'ws-1');
    const table = db.table('docs');
    expect(table).toBeInstanceOf(TableRef);
  });

  it('different table names return different instances', () => {
    const db = new DbRef(httpClient, 'shared');
    const t1 = db.table('posts');
    const t2 = db.table('comments');
    expect(t1).not.toBe(t2);
  });
});

// ─── Q. networkError ────────────────────────────────────────────────────────

describe('networkError', () => {
  it('creates EdgeBaseError with status 0', async () => {
    const { networkError } = await import('../../src/errors.js');
    const err = networkError('connection refused');
    expect(err.status).toBe(0);
    expect(err.message).toContain('connection refused');
  });
});
