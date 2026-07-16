import { describe, expect, it } from 'vitest';
import {
  MAX_COMPACT_TRANSACT_RESPONSE_BYTES,
  MAX_TRANSACT_OPERATIONS,
  compactTransactResult,
  parseTransactResultMode,
} from '../lib/transact-result.js';

describe('compact transact result', () => {
  it('is a total fixed-shape acknowledgment bounded at the legal 500-op maximum', () => {
    const body = JSON.stringify(compactTransactResult(MAX_TRANSACT_OPERATIONS));

    expect(body).toBe('{"committed":true,"operationCount":500}');
    expect(new TextEncoder().encode(body)).toHaveLength(MAX_COMPACT_TRANSACT_RESPONSE_BYTES);
  });

  it('accepts only the default/full and compact wire modes', () => {
    expect(parseTransactResultMode(undefined)).toBe('full');
    expect(parseTransactResultMode('full')).toBe('full');
    expect(parseTransactResultMode('compact')).toBe('compact');
    expect(parseTransactResultMode('rows')).toBeNull();
    expect(parseTransactResultMode(null)).toBeNull();
  });
});
