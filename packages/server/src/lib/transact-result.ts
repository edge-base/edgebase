export const MAX_TRANSACT_OPERATIONS = 500;
export const MAX_COMPACT_TRANSACT_RESPONSE_BYTES = 39;

export type TransactResultMode = 'full' | 'compact';

export interface CompactTransactResult {
  committed: true;
  operationCount: number;
}

export function parseTransactResultMode(value: unknown): TransactResultMode | null {
  if (value === undefined || value === 'full') return 'full';
  if (value === 'compact') return 'compact';
  return null;
}

/**
 * This builder is intentionally total: providers call it only after the
 * transaction commits, so it must not introduce a new post-commit failure.
 * The pre-write operation-count guard guarantees 1..500 and therefore a
 * maximum serialized body of 39 UTF-8 bytes.
 */
export function compactTransactResult(operationCount: number): CompactTransactResult {
  return { committed: true, operationCount };
}
