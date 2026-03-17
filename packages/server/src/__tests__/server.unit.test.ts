/**
 * 서버 단위 테스트 — lib/op-parser.ts + lib/errors.ts + lib/validation.ts
 *
 * 실행:
 *   cd packages/server && npx vitest run src/__tests__/server.unit.test.ts
 *
 * 원칙: 서버 로직 순수 단위 테스트 — 네트워크 불필요
 */

import { describe, it, expect } from 'vitest';
import { parseUpdateBody } from '../lib/op-parser.js';
import {
  validationError,
  unauthorizedError,
  forbiddenError,
  notFoundError,
  methodNotAllowedError,
  rateLimitError,
} from '../lib/errors.js';
import {
  validateInsert,
  validateUpdate,
  isFieldOperator,
} from '../lib/validation.js';
import { EdgeBaseError } from '@edgebase/shared';

// ─── A. op-parser.ts ──────────────────────────────────────────────────────────

describe('parseUpdateBody', () => {
  it('plain field → SET clause with ?', () => {
    const { setClauses, params } = parseUpdateBody({ title: 'Hello' });
    expect(setClauses).toContain('"title" = ?');
    expect(params).toContain('Hello');
  });

  it('increment op → COALESCE SQL', () => {
    const { setClauses, params } = parseUpdateBody({
      viewCount: { $op: 'increment', value: 5 },
    });
    expect(setClauses[0]).toContain('COALESCE');
    expect(setClauses[0]).toContain('+ ?');
    expect(params).toContain(5);
  });

  it('deleteField op → NULL SQL', () => {
    const { setClauses, params } = parseUpdateBody({
      extra: { $op: 'deleteField' },
    });
    expect(setClauses[0]).toContain('= NULL');
    expect(params).toHaveLength(0);
  });

  it('excludes id field by default', () => {
    const { setClauses } = parseUpdateBody({ id: 'should-exclude', title: 'OK' });
    const hasId = setClauses.some((c) => c.includes('"id"'));
    expect(hasId).toBe(false);
    expect(setClauses.some((c) => c.includes('"title"'))).toBe(true);
  });

  it('custom excludeFields', () => {
    const { setClauses } = parseUpdateBody(
      { title: 'OK', skipMe: 'X' },
      ['skipMe'],
    );
    expect(setClauses.some((c) => c.includes('"skipMe"'))).toBe(false);
    expect(setClauses.some((c) => c.includes('"title"'))).toBe(true);
  });

  it('multiple fields returns N clauses', () => {
    const { setClauses, params } = parseUpdateBody({ a: 1, b: 2, c: 3 });
    expect(setClauses).toHaveLength(3);
    expect(params).toHaveLength(3);
  });

  it('empty body → empty clauses and params', () => {
    const { setClauses, params } = parseUpdateBody({});
    expect(setClauses).toHaveLength(0);
    expect(params).toHaveLength(0);
  });

  it('increment value=0 → param 0', () => {
    const { params } = parseUpdateBody({ val: { $op: 'increment', value: 0 } });
    expect(params).toContain(0);
  });

  it('unknown op → throws', () => {
    expect(() =>
      parseUpdateBody({ x: { $op: 'unknownOp' as any } }),
    ).toThrow(/Unknown field operator/);
  });

  it('mixed fields: increment + plain + deleteField', () => {
    const { setClauses, params } = parseUpdateBody({
      views: { $op: 'increment', value: 1 },
      title: 'Updated',
      legacy: { $op: 'deleteField' },
    });
    expect(setClauses).toHaveLength(3);
    // increment creates 1 param, plain creates 1, deleteField creates 0
    expect(params).toHaveLength(2);
  });
});

// ─── B. errors.ts ─────────────────────────────────────────────────────────────

describe('errors helpers', () => {
  it('validationError returns EdgeBaseError(400)', () => {
    const err = validationError('Bad input');
    expect(err).toBeInstanceOf(EdgeBaseError);
    expect(err.code).toBe(400);
    expect(err.message).toBe('Bad input');
  });

  it('unauthorizedError returns 401', () => {
    const err = unauthorizedError();
    expect(err.code).toBe(401);
  });

  it('unauthorizedError with custom message', () => {
    const err = unauthorizedError('Token expired');
    expect(err.message).toBe('Token expired');
  });

  it('forbiddenError returns 403', () => {
    const err = forbiddenError();
    expect(err.code).toBe(403);
  });

  it('notFoundError returns 404', () => {
    const err = notFoundError();
    expect(err.code).toBe(404);
  });

  it('methodNotAllowedError returns 405', () => {
    const err = methodNotAllowedError();
    expect(err.code).toBe(405);
  });

  it('rateLimitError returns 429 with retryAfter', () => {
    const err = rateLimitError(30);
    expect(err.code).toBe(429);
    expect(err.message).toContain('30');
  });

  it('forbiddenError custom message', () => {
    const err = forbiddenError('Service Key required');
    expect(err.message).toBe('Service Key required');
  });

  it('notFoundError custom message', () => {
    const err = notFoundError('Record not found');
    expect(err.message).toBe('Record not found');
  });
});

// ─── C. validation.ts ─────────────────────────────────────────────────────────

describe('isFieldOperator', () => {
  it('increment → true', () => {
    expect(isFieldOperator({ $op: 'increment', value: 5 })).toBe(true);
  });

  it('deleteField → true', () => {
    expect(isFieldOperator({ $op: 'deleteField' })).toBe(true);
  });

  it('plain string → false', () => {
    expect(isFieldOperator('hello')).toBe(false);
  });

  it('null → false', () => {
    expect(isFieldOperator(null)).toBe(false);
  });

  it('number → false', () => {
    expect(isFieldOperator(42)).toBe(false);
  });

  it('plain object without $op → false', () => {
    expect(isFieldOperator({ op: 'increment' })).toBe(false);
  });
});

describe('validateInsert (schemaless)', () => {
  it('no schema → valid = true', () => {
    const result = validateInsert({ title: 'any', unknownField: 123 });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });
});

describe('validateInsert (with schema)', () => {
  const schema = {
    title: { type: 'string' as const, required: true },
    views: { type: 'number' as const },
    isActive: { type: 'boolean' as const },
  };

  it('valid data → valid=true', () => {
    const result = validateInsert({ title: 'Hello' }, schema);
    expect(result.valid).toBe(true);
  });

  it('missing required field → invalid', () => {
    const result = validateInsert({}, schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveProperty('title');
  });

  it('wrong type string → invalid', () => {
    const result = validateInsert({ title: 123 as any }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.title).toContain('string');
  });

  it('wrong type number → invalid', () => {
    const result = validateInsert({ title: 'OK', views: 'not-a-num' as any }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.views).toContain('number');
  });

  it('unknown field → silently ignored (valid)', () => {
    const result = validateInsert({ title: 'OK', unknownXYZ: 'val' }, schema);
    expect(result.valid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });

  it('auto-managed fields skip validation — id, createdAt, updatedAt', () => {
    const result = validateInsert({ title: 'OK', id: 'any', createdAt: 'any', updatedAt: 'any' }, schema);
    expect(result.valid).toBe(true);
  });

  it('boolean type validation', () => {
    const result = validateInsert({ title: 'OK', isActive: 'true' as any }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.isActive).toContain('boolean');
  });
});

describe('validateInsert — string constraints', () => {
  const schema = {
    title: {
      type: 'string' as const,
      required: true,
      min: 3,
      max: 10,
    },
  };

  it('value below min → invalid', () => {
    const result = validateInsert({ title: 'ab' }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.title).toContain('3');
  });

  it('value above max → invalid', () => {
    const result = validateInsert({ title: 'a'.repeat(11) }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.title).toContain('10');
  });

  it('valid length → valid', () => {
    const result = validateInsert({ title: 'Hello' }, schema);
    expect(result.valid).toBe(true);
  });
});

describe('validateInsert — enum constraint', () => {
  const schema = {
    status: {
      type: 'string' as const,
      enum: ['draft', 'published', 'archived'],
    },
  };

  it('valid enum value → valid', () => {
    const result = validateInsert({ status: 'draft' }, schema);
    expect(result.valid).toBe(true);
  });

  it('invalid enum value → invalid', () => {
    const result = validateInsert({ status: 'invalid' }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.status).toContain('draft');
  });
});

describe('validateUpdate (schemaless)', () => {
  it('no schema → valid = true', () => {
    const result = validateUpdate({ title: 'any', extra: 123 });
    expect(result.valid).toBe(true);
  });
});

describe('validateUpdate (with schema)', () => {
  const schema = {
    title: { type: 'string' as const, required: true },
    views: { type: 'number' as const },
  };

  it('valid partial update → valid', () => {
    const result = validateUpdate({ views: 5 }, schema);
    expect(result.valid).toBe(true);
  });

  it('$op field operator passes through', () => {
    const result = validateUpdate({ views: { $op: 'increment', value: 1 } }, schema);
    expect(result.valid).toBe(true);
  });

  it('required field deleteField → invalid', () => {
    const result = validateUpdate({ title: { $op: 'deleteField' } }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.title).toContain('required');
  });

  it('unknown field in update → silently ignored (valid)', () => {
    const result = validateUpdate({ unknownXYZ: 'bad' }, schema);
    expect(result.valid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });

  it('wrong type in update → invalid', () => {
    const result = validateUpdate({ views: 'not-num' as any }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.views).toContain('number');
  });

  it('auto-managed fields skipped in update', () => {
    const result = validateUpdate({ id: 'any', title: 'Valid' }, schema);
    expect(result.valid).toBe(true);
  });
});
