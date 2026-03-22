/**
 * Regression tests for pagination parameter validation.
 *
 * Key regression: unvalidated parseInt() allowed NaN, negative,
 * and absurdly large values to reach SQL queries.
 */
import { describe, it, expect } from 'vitest';
import { parsePagination } from '../lib/pagination.js';

describe('parsePagination', () => {
  // ── Defaults ──
  it('returns defaults when no params provided', () => {
    expect(parsePagination(undefined, undefined)).toEqual({ limit: 100, offset: 0 });
  });

  // ── Valid values ──
  it('accepts valid limit and offset', () => {
    expect(parsePagination('50', '10')).toEqual({ limit: 50, offset: 10 });
  });

  it('accepts limit=1 (minimum)', () => {
    expect(parsePagination('1', '0')).toEqual({ limit: 1, offset: 0 });
  });

  // ── Limit clamping ──
  it('clamps limit to 1000', () => {
    expect(parsePagination('9999', '0')).toEqual({ limit: 1000, offset: 0 });
  });

  it('accepts limit within range (500)', () => {
    expect(parsePagination('500', '0')).toEqual({ limit: 500, offset: 0 });
  });

  it('rejects limit=0 (falls back to default)', () => {
    expect(parsePagination('0', '0')).toEqual({ limit: 100, offset: 0 });
  });

  // ── REGRESSION: negative and NaN values ──
  it('rejects negative limit', () => {
    expect(parsePagination('-5', '0')).toEqual({ limit: 100, offset: 0 });
  });

  it('rejects NaN limit', () => {
    expect(parsePagination('abc', '0')).toEqual({ limit: 100, offset: 0 });
  });

  it('rejects negative offset', () => {
    expect(parsePagination('20', '-10')).toEqual({ limit: 100, offset: 0 });
  });

  it('rejects NaN offset', () => {
    expect(parsePagination('20', 'xyz')).toEqual({ limit: 100, offset: 0 });
  });

  it('rejects Infinity limit', () => {
    expect(parsePagination('Infinity', '0')).toEqual({ limit: 100, offset: 0 });
  });

  // ── Empty string (same as undefined) ──
  it('treats empty strings as defaults', () => {
    expect(parsePagination('', '')).toEqual({ limit: 100, offset: 0 });
  });
});
