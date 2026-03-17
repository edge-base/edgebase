/**
 * 서버 단위 테스트 — lib/op-parser.ts
 * 1-07 field-ops.test.ts — 40개
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/field-ops.test.ts
 *
 * 테스트 대상 (op-parser.ts):
 *   parseUpdateBody — increment / deleteField / 일반 값 / 혼합 / 에러
 *   buildOpClause (indirect through parseUpdateBody)
 */

import { describe, it, expect } from 'vitest';
import { parseUpdateBody } from '../lib/op-parser.js';

// ─── A. 일반 값 (non-$op) ────────────────────────────────────────────────────

describe('parseUpdateBody — regular values', () => {
  it('single string field', () => {
    const { setClauses, params } = parseUpdateBody({ title: 'Hello' });
    expect(setClauses).toEqual(['"title" = ?']);
    expect(params).toEqual(['Hello']);
  });

  it('single number field', () => {
    const { setClauses, params } = parseUpdateBody({ views: 42 });
    expect(setClauses).toEqual(['"views" = ?']);
    expect(params).toEqual([42]);
  });

  it('null value → field = NULL via regular path', () => {
    const { setClauses, params } = parseUpdateBody({ deletedAt: null });
    expect(setClauses).toContain('"deletedAt" = ?');
    expect(params).toContain(null);
  });

  it('boolean value', () => {
    const { setClauses: _setClauses, params } = parseUpdateBody({ active: true });
    expect(params).toContain(true);
  });

  it('excludes id field by default', () => {
    const { setClauses, params } = parseUpdateBody({ id: 'ignored', title: 'kept' });
    expect(setClauses).toHaveLength(1);
    expect(setClauses[0]).toContain('"title"');
    expect(params).toEqual(['kept']);
  });

  it('excludes custom excludeFields', () => {
    const { setClauses } = parseUpdateBody(
      { createdAt: 'now', title: 'hi' },
      ['id', 'createdAt'],
    );
    expect(setClauses).toHaveLength(1);
    expect(setClauses[0]).toContain('"title"');
  });

  it('multiple fields → multiple setClauses', () => {
    const { setClauses, params } = parseUpdateBody({ a: 1, b: 2 });
    expect(setClauses).toHaveLength(2);
    expect(params).toEqual([1, 2]);
  });

  it('empty object → empty setClauses', () => {
    const { setClauses, params } = parseUpdateBody({});
    expect(setClauses).toEqual([]);
    expect(params).toEqual([]);
  });

  it('field name with special chars is escaped', () => {
    const { setClauses } = parseUpdateBody({ 'my-field': 'value' });
    // Should be double-quoted
    expect(setClauses[0]).toContain('"my-field"');
  });

  it('field name with double quote is escaped', () => {
    const { setClauses } = parseUpdateBody({ 'col"name': 'v' });
    expect(setClauses[0]).toContain('"col""name"');
  });
});

// ─── B. increment $op ──────────────────────────────────────────────────────

describe('parseUpdateBody — increment', () => {
  it('increment generates COALESCE SQL', () => {
    const { setClauses, params } = parseUpdateBody({
      viewCount: { $op: 'increment', value: 5 },
    });
    expect(setClauses[0]).toBe('"viewCount" = COALESCE("viewCount", 0) + ?');
    expect(params[0]).toBe(5);
  });

  it('increment negative value', () => {
    const { setClauses: _setClauses, params } = parseUpdateBody({
      score: { $op: 'increment', value: -10 },
    });
    expect(params[0]).toBe(-10);
  });

  it('increment by 0', () => {
    const { params } = parseUpdateBody({ count: { $op: 'increment', value: 0 } });
    expect(params[0]).toBe(0);
  });

  it('increment decimal value', () => {
    const { params } = parseUpdateBody({ price: { $op: 'increment', value: 3.14 } });
    expect(params[0]).toBe(3.14);
  });

  it('increment with no value → defaults to 0', () => {
    // op-parser: op.value ?? 0
    const { params } = parseUpdateBody({ count: { $op: 'increment' } } as any);
    expect(params[0]).toBe(0);
  });

  it('COALESCE pattern protects against NULL field', () => {
    const { setClauses } = parseUpdateBody({ n: { $op: 'increment', value: 1 } });
    expect(setClauses[0]).toContain('COALESCE');
  });

  it('postgres dialect uses numbered placeholders', () => {
    const { setClauses, params, nextParamIndex } = parseUpdateBody(
      { viewCount: { $op: 'increment', value: 5 } },
      ['id'],
      { dialect: 'postgres', startIndex: 3 },
    );
    expect(setClauses[0]).toBe('"viewCount" = COALESCE("viewCount", 0) + $3');
    expect(params).toEqual([5]);
    expect(nextParamIndex).toBe(4);
  });
});

// ─── C. deleteField $op ────────────────────────────────────────────────────

describe('parseUpdateBody — deleteField', () => {
  it('deleteField generates field = NULL', () => {
    const { setClauses, params } = parseUpdateBody({
      avatar: { $op: 'deleteField' },
    });
    expect(setClauses[0]).toBe('"avatar" = NULL');
    expect(params).toEqual([]);
  });

  it('deleteField has no params', () => {
    const { params } = parseUpdateBody({ x: { $op: 'deleteField' } });
    expect(params).toHaveLength(0);
  });

  it('multiple deleteField ops', () => {
    const { setClauses } = parseUpdateBody({
      a: { $op: 'deleteField' },
      b: { $op: 'deleteField' },
    });
    expect(setClauses).toHaveLength(2);
    expect(setClauses.every((c) => c.endsWith('= NULL'))).toBe(true);
  });
});

// ─── D. unknown $op ──────────────────────────────────────────────────────

describe('parseUpdateBody — unknown $op', () => {
  it('unknown $op → throws', () => {
    expect(() =>
      parseUpdateBody({ x: { $op: 'multiply', value: 3 } } as any),
    ).toThrow("Unknown field operator 'multiply'. Supported operators: increment, deleteField.");
  });

  it('unknown $op error contains op name', () => {
    try {
      parseUpdateBody({ x: { $op: 'badOp' } } as any);
    } catch (err) {
      expect((err as Error).message).toContain('badOp');
    }
  });
});

// ─── E. 혼합 (mix regular + $op) ─────────────────────────────────────────────

describe('parseUpdateBody — mixed', () => {
  it('regular + increment mixed', () => {
    const { setClauses, params: _params } = parseUpdateBody({
      title: 'New Title',
      viewCount: { $op: 'increment', value: 1 },
    });
    expect(setClauses).toHaveLength(2);
    const titleClause = setClauses.find((c) => c.includes('"title"'));
    const viewClause = setClauses.find((c) => c.includes('COALESCE'));
    expect(titleClause).toBeTruthy();
    expect(viewClause).toBeTruthy();
  });

  it('increment + deleteField mixed', () => {
    const { setClauses } = parseUpdateBody({
      count: { $op: 'increment', value: 5 },
      avatar: { $op: 'deleteField' },
    });
    expect(setClauses).toHaveLength(2);
  });

  it('id excluded but $op fields processed', () => {
    const { setClauses } = parseUpdateBody({
      id: 'excluded',
      views: { $op: 'increment', value: 1 },
    });
    expect(setClauses).toHaveLength(1);
    expect(setClauses[0]).toContain('COALESCE');
  });

  it('postgres dialect preserves numbering across regular + deleteField', () => {
    const { setClauses, params, nextParamIndex } = parseUpdateBody(
      {
        title: 'New Title',
        avatar: { $op: 'deleteField' },
      },
      ['id'],
      { dialect: 'postgres', startIndex: 2 },
    );
    expect(setClauses).toEqual(['"title" = $2', '"avatar" = NULL']);
    expect(params).toEqual(['New Title']);
    expect(nextParamIndex).toBe(3);
  });
});

// ─── F. isOpObject detection ─────────────────────────────────────────────────

describe('parseUpdateBody — $op marker detection', () => {
  it('plain object without $op is not treated as op', () => {
    const { setClauses, params } = parseUpdateBody({ meta: { foo: 'bar' } });
    // Without $op, it should be treated as regular JSON value
    expect(setClauses[0]).toBe('"meta" = ?');
    expect(params[0]).toEqual({ foo: 'bar' });
  });

  it('null value is not an op object', () => {
    const { setClauses } = parseUpdateBody({ x: null });
    expect(setClauses[0]).toBe('"x" = ?');
  });

  it('array value is not an op object', () => {
    const { setClauses } = parseUpdateBody({ tags: ['a', 'b'] });
    expect(setClauses[0]).toBe('"tags" = ?');
  });
});
