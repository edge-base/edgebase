/**
 * field-ops.test.ts — 40개
 *
 * 테스트 대상: src/lib/op-parser.ts (parseUpdateBody)
 *              HTTP 통합: PATCH /api/db/shared/tables/posts/:id
 *
 * 격리 원칙: 각 테스트는 고유 prefix로 임시 레코드 생성 후 afterAll에서 삭제.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseUpdateBody } from '../../src/lib/op-parser.js';

// ─── 1. parseUpdateBody — 순수 유닛 ──────────────────────────────────────────

describe('1-07 field-ops — parseUpdateBody 순수', () => {
  it('일반 값 → SET col = ?', () => {
    const { setClauses, params } = parseUpdateBody({ title: 'hello' });
    expect(setClauses).toEqual(['"title" = ?']);
    expect(params).toEqual(['hello']);
  });

  it('increment → COALESCE(col, 0) + ?', () => {
    const { setClauses, params } = parseUpdateBody({ views: { $op: 'increment', value: 1 } });
    expect(setClauses[0]).toContain('COALESCE("views", 0) + ?');
    expect(params).toContain(1);
  });

  it('increment 음수 값', () => {
    const { setClauses, params } = parseUpdateBody({ score: { $op: 'increment', value: -5 } });
    expect(setClauses[0]).toContain('COALESCE("score", 0) + ?');
    expect(params).toContain(-5);
  });

  it('increment 소수 값', () => {
    const { setClauses, params } = parseUpdateBody({ rating: { $op: 'increment', value: 0.5 } });
    expect(params).toContain(0.5);
  });

  it('increment 0 → value fallback to 0', () => {
    const { params } = parseUpdateBody({ count: { $op: 'increment' } });
    expect(params).toContain(0);
  });

  it('deleteField → col = NULL (params 없음)', () => {
    const { setClauses, params } = parseUpdateBody({ avatar: { $op: 'deleteField' } });
    expect(setClauses[0]).toContain('"avatar" = NULL');
    expect(params).toHaveLength(0);
  });

  it('id 필드 → 기본 excludeFields에 포함 → 무시', () => {
    const { setClauses } = parseUpdateBody({ id: 'new-id', title: 'hello' });
    expect(setClauses).toHaveLength(1);
    expect(setClauses[0]).not.toContain('"id"');
  });

  it('커스텀 excludeFields', () => {
    const { setClauses } = parseUpdateBody({ id: '1', createdAt: 'old', title: 'test' }, ['id', 'createdAt']);
    expect(setClauses).toHaveLength(1);
    expect(setClauses[0]).toContain('"title"');
  });

  it('알 수 없는 $op → throws', () => {
    expect(() => parseUpdateBody({ x: { $op: 'unknown' } })).toThrow('Unknown field operator');
  });

  it('복합 — 일반 값 + increment + deleteField', () => {
    const { setClauses, params } = parseUpdateBody({
      title: 'new title',
      views: { $op: 'increment', value: 1 },
      avatar: { $op: 'deleteField' },
    });
    expect(setClauses).toHaveLength(3);
    expect(setClauses[0]).toContain('"title" = ?');
    expect(setClauses[1]).toContain('COALESCE');
    expect(setClauses[2]).toContain('NULL');
  });

  it('빈 객체 → setClauses []', () => {
    const { setClauses, params } = parseUpdateBody({});
    expect(setClauses).toHaveLength(0);
    expect(params).toHaveLength(0);
  });
});

// ─── 2. HTTP 통합 — PATCH field ops via API ───────────────────────────────────

const BASE = 'http://localhost';
const SERVICE_KEY = 'test-service-key-for-admin';
const COL_PREFIX = 'test-fops-' + crypto.randomUUID().slice(0, 8);

async function api(method: string, path: string, body?: unknown) {
  const url = `${BASE}${path}`;
  const res = await (globalThis as any).SELF.fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-EdgeBase-Service-Key': SERVICE_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json() as any;
  return { status: res.status, data };
}

let postId: string;

beforeAll(async () => {
  const { data } = await api('POST', '/api/db/shared/tables/posts', {
    title: 'Field Ops Test Post',
    views: 0,
    content: 'initial content',
  });
  postId = data.id;
});

afterAll(async () => {
  if (postId) await api('DELETE', `/api/db/shared/tables/posts/${postId}`);
});

describe('1-07 field-ops — HTTP increment', () => {
  it('increment views +1', async () => {
    const { status, data } = await api('PATCH', `/api/db/shared/tables/posts/${postId}`, {
      views: { $op: 'increment', value: 1 },
    });
    expect(status).toBe(200);
    expect(data.views).toBe(1);
  });

  it('increment views +5 → cumulative', async () => {
    const { data } = await api('PATCH', `/api/db/shared/tables/posts/${postId}`, {
      views: { $op: 'increment', value: 5 },
    });
    expect(data.views).toBe(6);
  });

  it('increment views -2 → 4', async () => {
    const { data } = await api('PATCH', `/api/db/shared/tables/posts/${postId}`, {
      views: { $op: 'increment', value: -2 },
    });
    expect(data.views).toBe(4);
  });
});

describe('1-07 field-ops — HTTP deleteField', () => {
  it('deleteField content → null', async () => {
    const { status, data } = await api('PATCH', `/api/db/shared/tables/posts/${postId}`, {
      content: { $op: 'deleteField' },
    });
    expect(status).toBe(200);
    expect(data.content === null || data.content === undefined).toBe(true);
  });
});

describe('1-07 field-ops — HTTP 오류 케이스', () => {
  it('잘못된 $op 값 → 400', async () => {
    const { status } = await api('PATCH', `/api/db/shared/tables/posts/${postId}`, {
      views: { $op: 'unknown-op', value: 1 },
    });
    expect(status).toBe(400);
  });

  it('value 없는 increment → value=0 처리 (서버가 허용)', async () => {
    const { status } = await api('PATCH', `/api/db/shared/tables/posts/${postId}`, {
      views: { $op: 'increment' },
    });
    // op-parser defaults value to 0, so this is valid
    expect(status).toBe(200);
  });
});

// ─── 3. parseUpdateBody 확장 — 순수 유닛 ────────────────────────────────────

describe('1-07 field-ops — parseUpdateBody 확장', () => {
  it('increment +100 큰 값', () => {
    const { setClauses, params } = parseUpdateBody({ score: { $op: 'increment', value: 100 } });
    expect(setClauses[0]).toContain('COALESCE("score", 0) + ?');
    expect(params).toContain(100);
  });

  it('increment +0.001 매우 작은 소수', () => {
    const { params } = parseUpdateBody({ precision: { $op: 'increment', value: 0.001 } });
    expect(params).toContain(0.001);
  });

  it('increment -1000 큰 음수', () => {
    const { params } = parseUpdateBody({ balance: { $op: 'increment', value: -1000 } });
    expect(params).toContain(-1000);
  });

  it('increment 0 → params에 0 포함', () => {
    const { params } = parseUpdateBody({ count: { $op: 'increment', value: 0 } });
    expect(params).toContain(0);
  });

  it('deleteField 여러 필드 동시', () => {
    const { setClauses, params } = parseUpdateBody({
      avatar: { $op: 'deleteField' },
      bio: { $op: 'deleteField' },
      website: { $op: 'deleteField' },
    });
    expect(setClauses).toHaveLength(3);
    expect(params).toHaveLength(0);
    for (const clause of setClauses) {
      expect(clause).toContain('NULL');
    }
  });

  it('$op marker 구조 — $op 키가 있으면 operator로 인식', () => {
    const { setClauses } = parseUpdateBody({ field: { $op: 'increment', value: 1 } });
    expect(setClauses[0]).toContain('COALESCE');
  });

  it('$op 없는 객체 → 일반 SET (JSON 문자열화 가능)', () => {
    const val = { nested: 'value' };
    const { setClauses, params } = parseUpdateBody({ metadata: val });
    expect(setClauses[0]).toContain('"metadata" = ?');
    expect(params[0]).toEqual(val);
  });

  it('null 값 → SET col = ? with null param', () => {
    const { setClauses, params } = parseUpdateBody({ content: null });
    expect(setClauses[0]).toBe('"content" = ?');
    expect(params[0]).toBeNull();
  });

  it('숫자 0 값 → SET col = ? with 0', () => {
    const { params } = parseUpdateBody({ views: 0 });
    expect(params[0]).toBe(0);
  });

  it('빈 문자열 값 → SET col = ? with ""', () => {
    const { params } = parseUpdateBody({ title: '' });
    expect(params[0]).toBe('');
  });

  it('boolean 값 → SET col = ? with boolean', () => {
    const { params } = parseUpdateBody({ isPublished: true });
    expect(params[0]).toBe(true);
  });

  it('createdAt excludeFields → 무시', () => {
    const { setClauses } = parseUpdateBody(
      { id: 'x', createdAt: 'y', updatedAt: 'z', title: 'ok' },
      ['id', 'createdAt', 'updatedAt'],
    );
    expect(setClauses).toHaveLength(1);
    expect(setClauses[0]).toContain('"title"');
  });

  it('알 수 없는 $op "append" → throws', () => {
    expect(() => parseUpdateBody({ tags: { $op: 'append', value: 'tag' } })).toThrow('Unknown field operator');
  });

  it('알 수 없는 $op "multiply" → throws', () => {
    expect(() => parseUpdateBody({ price: { $op: 'multiply', value: 2 } })).toThrow('Unknown field operator');
  });

  it('큰 복합 업데이트 (5개 필드)', () => {
    const { setClauses, params } = parseUpdateBody({
      title: 'updated',
      views: { $op: 'increment', value: 10 },
      content: 'new content',
      avatar: { $op: 'deleteField' },
      isPublished: true,
    });
    expect(setClauses).toHaveLength(5);
    // title=?, views=COALESCE, content=?, avatar=NULL, isPublished=?
    expect(params.length).toBe(4); // title, 10, content, isPublished (avatar is NULL — no param)
  });
});

// ─── 4. HTTP 통합 확장 — increment 누적, 경계 케이스 ─────────────────────────

describe('1-07 field-ops — HTTP increment 확장', () => {
  let fopsPostId: string;

  beforeAll(async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Field Ops Extended Test',
      views: 10,
      content: 'ext test content',
    });
    fopsPostId = data.id;
  });

  afterAll(async () => {
    if (fopsPostId) await api('DELETE', `/api/db/shared/tables/posts/${fopsPostId}`);
  });

  it('increment +0 → 값 유지', async () => {
    const { data } = await api('PATCH', `/api/db/shared/tables/posts/${fopsPostId}`, {
      views: { $op: 'increment', value: 0 },
    });
    expect(data.views).toBe(10);
  });

  it('increment +0.5 → 소수 누적', async () => {
    const { data } = await api('PATCH', `/api/db/shared/tables/posts/${fopsPostId}`, {
      views: { $op: 'increment', value: 0.5 },
    });
    expect(data.views).toBe(10.5);
  });

  it('increment -10.5 → 0', async () => {
    const { data } = await api('PATCH', `/api/db/shared/tables/posts/${fopsPostId}`, {
      views: { $op: 'increment', value: -10.5 },
    });
    expect(data.views).toBe(0);
  });

  it('increment 누적 후 일반 SET과 혼합', async () => {
    const { status, data } = await api('PATCH', `/api/db/shared/tables/posts/${fopsPostId}`, {
      title: 'Mixed Update',
      views: { $op: 'increment', value: 5 },
    });
    expect(status).toBe(200);
    expect(data.title).toBe('Mixed Update');
    expect(data.views).toBe(5);
  });
});

// ─── 5. HTTP deleteField 확장 ─────────────────────────────────────────────

describe('1-07 field-ops — HTTP deleteField 확장', () => {
  let delPostId: string;

  beforeAll(async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'DeleteField Extended',
      content: 'will be deleted',
      extra: 'will also be deleted',
    });
    delPostId = data.id;
  });

  afterAll(async () => {
    if (delPostId) await api('DELETE', `/api/db/shared/tables/posts/${delPostId}`);
  });

  it('deleteField extra → null', async () => {
    const { status, data } = await api('PATCH', `/api/db/shared/tables/posts/${delPostId}`, {
      extra: { $op: 'deleteField' },
    });
    expect(status).toBe(200);
    expect(data.extra === null || data.extra === undefined).toBe(true);
  });

  it('deleteField 후 GET으로 null 확인', async () => {
    const { data } = await api('GET', `/api/db/shared/tables/posts/${delPostId}`);
    expect(data.extra === null || data.extra === undefined).toBe(true);
  });

  it('deleteField + increment 동시 → 200', async () => {
    const { status } = await api('PATCH', `/api/db/shared/tables/posts/${delPostId}`, {
      content: { $op: 'deleteField' },
      views: { $op: 'increment', value: 1 },
    });
    expect(status).toBe(200);
  });
});
