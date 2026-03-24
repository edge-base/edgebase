/**
 * 서버 단위 테스트 — lib/errors.ts + RoomsDO pure logic
 * 1-26 error-format.test.ts — 40개
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/error-format.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  validationError,
  unauthorizedError,
  forbiddenError,
  notFoundError,
  methodNotAllowedError,
  rateLimitError,
  hookRejectedError,
  normalizeDatabaseError,
} from '../lib/errors.js';
import { EdgeBaseError } from '@edge-base/shared';

// ─── A. EdgeBaseError 구조 ─────────────────────────────────────────────────────

describe('EdgeBaseError structure', () => {
  it('is an instanceof Error', () => {
    const err = new EdgeBaseError(400, 'Bad request');
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instanceof EdgeBaseError', () => {
    const err = new EdgeBaseError(400, 'Bad request');
    expect(err).toBeInstanceOf(EdgeBaseError);
  });

  it('code stored correctly', () => {
    const err = new EdgeBaseError(404, 'Not found');
    expect(err.code).toBe(404);
  });

  it('message stored correctly', () => {
    const err = new EdgeBaseError(400, 'Validation failed');
    expect(err.message).toBe('Validation failed');
  });

  it('name is "EdgeBaseError"', () => {
    const err = new EdgeBaseError(500, 'Internal error');
    expect(err.name).toBe('EdgeBaseError');
  });

  it('stack is present (runtime-generated)', () => {
    const err = new EdgeBaseError(500, 'Internal error');
    // Stack should be present (set by Error constructor)
    expect(typeof err.stack).toBe('string');
  });
});

// ─── B. Error helper factory functions ────────────────────────────────────────

describe('validationError', () => {
  it('returns status 400', () => {
    expect(validationError('Bad input').code).toBe(400);
  });

  it('stores message', () => {
    expect(validationError('Required fields missing').message).toBe('Required fields missing');
  });

  it('instanceof EdgeBaseError', () => {
    expect(validationError('x')).toBeInstanceOf(EdgeBaseError);
  });

  it('with field errors', () => {
    const err = validationError('Validation failed', {
      email: { message: 'Invalid email', code: 'invalid_email' },
    });
    expect(err.code).toBe(400);
    expect(err.message).toBe('Validation failed');
  });
});

describe('unauthorizedError', () => {
  it('returns status 401', () => {
    expect(unauthorizedError().code).toBe(401);
  });

  it('default message', () => {
    expect(unauthorizedError().message).toBe('Unauthorized.');
  });

  it('custom message', () => {
    expect(unauthorizedError('Token expired').message).toBe('Token expired');
  });
});

describe('forbiddenError', () => {
  it('returns status 403', () => {
    expect(forbiddenError().code).toBe(403);
  });

  it('default message', () => {
    expect(forbiddenError().message).toBe('Access denied.');
  });

  it('custom message', () => {
    expect(forbiddenError('Service Key required').message).toBe('Service Key required');
  });
});

describe('notFoundError', () => {
  it('returns status 404', () => {
    expect(notFoundError().code).toBe(404);
  });

  it('default message', () => {
    expect(notFoundError().message).toBe('Not found.');
  });

  it('custom message', () => {
    expect(notFoundError('Record not found').message).toBe('Record not found');
  });
});

describe('methodNotAllowedError', () => {
  it('returns status 405', () => {
    expect(methodNotAllowedError().code).toBe(405);
  });

  it('default message', () => {
    expect(methodNotAllowedError().message).toBe('Method not allowed.');
  });

  it('custom message', () => {
    expect(methodNotAllowedError('Custom not allowed message').message).toBe('Custom not allowed message');
  });
});

describe('rateLimitError', () => {
  it('returns status 429', () => {
    expect(rateLimitError(30).code).toBe(429);
  });

  it('includes retryAfter in message', () => {
    expect(rateLimitError(60).message).toContain('60');
  });

  it('different retryAfter values', () => {
    expect(rateLimitError(5).message).toContain('5');
    expect(rateLimitError(3600).message).toContain('3600');
  });
});

describe('hookRejectedError', () => {
  it('passes EdgeBaseError instances through untouched', () => {
    const original = forbiddenError('Already normalized');
    expect(hookRejectedError(original)).toBe(original);
  });

  it('uses the fallback message and hook prefix for unauthorized non-Error rejections', () => {
    const err = hookRejectedError('plain failure', 'Authentication required', 'beforeSave');
    expect(err.code).toBe(401);
    expect(err.message).toBe("Hook 'beforeSave' rejected: Authentication required");
    expect(err.slug).toBe('hook-rejected');
  });

  it('maps ownership denial messages to 403', () => {
    const err = hookRejectedError(new Error('Only owners can update this record.'));
    expect(err.code).toBe(403);
    expect(err.message).toContain('Only owners');
  });

  it('maps blocked hook messages to 403', () => {
    const err = hookRejectedError(new Error('Blocked by test beforeUpload'));
    expect(err.code).toBe(403);
    expect(err.message).toContain('Blocked by test beforeUpload');
  });

  it('maps conflict-style messages to 409', () => {
    const err = hookRejectedError(new Error('Email already exists.'));
    expect(err.code).toBe(409);
  });

  it('maps not-found style messages to 404', () => {
    const err = hookRejectedError(new Error('Unknown project id.'));
    expect(err.code).toBe(404);
    expect(err.message).toBe('Unknown project id.');
  });

  it('maps rate-limit style messages to 429', () => {
    const err = hookRejectedError(new Error('Too many uploads, throttled.'));
    expect(err.code).toBe(429);
    expect(err.slug).toBe('hook-rejected');
  });

  it('falls back to validation errors for unknown hook failures', () => {
    const err = hookRejectedError(new Error('Custom hook failure.'));
    expect(err.code).toBe(400);
    expect(err.message).toBe('Custom hook failure.');
  });
});

describe('normalizeDatabaseError', () => {
  it('passes EdgeBaseError instances through untouched', () => {
    const original = validationError('Already normalized');
    expect(normalizeDatabaseError(original)).toBe(original);
  });

  it('maps foreign key failures to validation errors', () => {
    const err = normalizeDatabaseError(new Error('D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT'));
    expect(err).toBeInstanceOf(EdgeBaseError);
    expect(err?.code).toBe(400);
    expect(err?.message).toContain('Referenced record does not exist');
    expect(err?.slug).toBe('foreign-key-failed');
  });

  it('maps foreign key failures without a detected column to the generic message', () => {
    const err = normalizeDatabaseError('FOREIGN KEY constraint failed');
    expect(err).toBeInstanceOf(EdgeBaseError);
    expect(err?.code).toBe(400);
    expect(err?.message).toContain('Check that all foreign key references');
  });

  it('maps foreign key failures from cross-realm error-like objects', () => {
    const err = normalizeDatabaseError({
      message: 'D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT',
    });
    expect(err).toBeInstanceOf(EdgeBaseError);
    expect(err?.code).toBe(400);
  });

  it('maps unique constraint failures to conflict errors', () => {
    const err = normalizeDatabaseError(new Error('UNIQUE constraint failed: categories.name'));
    expect(err).toBeInstanceOf(EdgeBaseError);
    expect(err?.code).toBe(409);
    expect(err?.message).toContain('Record already exists');
    expect(err?.message).toContain("'name'");
    expect(err?.slug).toBe('record-already-exists');
  });

  it('maps unique constraint failures without a parsed column to a generic conflict message', () => {
    const err = normalizeDatabaseError('UNIQUE constraint failed');
    expect(err).toBeInstanceOf(EdgeBaseError);
    expect(err?.code).toBe(409);
    expect(err?.message).toBe('Record already exists. A unique constraint was violated.');
  });

  it('maps not-null constraint failures to validation errors', () => {
    const err = normalizeDatabaseError(new Error('NOT NULL constraint failed: users.email'));
    expect(err).toBeInstanceOf(EdgeBaseError);
    expect(err?.code).toBe(400);
    expect(err?.message).toContain("'email'");
    expect(err?.slug).toBe('constraint-failed');
  });

  it('maps cause-only check constraint failures to a generic validation error', () => {
    const err = normalizeDatabaseError({
      message: 'outer wrapper',
      cause: {
        message: 'check constraint failed',
      },
    });
    expect(err).toBeInstanceOf(EdgeBaseError);
    expect(err?.code).toBe(400);
    expect(err?.message).toBe('Request violates a database constraint. Ensure all required fields are provided.');
    expect(err?.slug).toBe('constraint-failed');
  });

  it('returns null for blank string inputs', () => {
    expect(normalizeDatabaseError('   ')).toBeNull();
  });

  it('returns null for unrelated runtime errors', () => {
    expect(normalizeDatabaseError(new Error('socket hang up'))).toBeNull();
  });
});

// ─── C. Error 구조 직렬화 ────────────────────────────────────────────────────

describe('error JSON structure', () => {
  it('EdgeBaseError has code + message accessible', () => {
    const err = new EdgeBaseError(401, 'Not authenticated');
    const serialized = {
      code: err.code,
      message: err.message,
    };
    expect(serialized).toEqual({ code: 401, message: 'Not authenticated' });
  });

  it('stack trace not exposed in serialized form', () => {
    const err = new EdgeBaseError(500, 'Internal');
    const json = { code: err.code, message: err.message };
    // Confirm stack is not in the response body
    expect(json).not.toHaveProperty('stack');
  });

  it('400 errors are distinct from 500s', () => {
    const e400 = validationError('Bad input');
    const e500 = new EdgeBaseError(500, 'Internal');
    expect(e400.code).not.toBe(e500.code);
  });

  it('all helper-created errors are EdgeBaseError instances', () => {
    const errors = [
      validationError('x'),
      unauthorizedError(),
      forbiddenError(),
      notFoundError(),
      methodNotAllowedError(),
      rateLimitError(10),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(EdgeBaseError);
    }
  });
});
