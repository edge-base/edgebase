export interface TransactRevisionFence {
  table: string;
  id: string;
  field: string;
}

export interface RawTransactOperation {
  table?: unknown;
  op?: unknown;
  id?: unknown;
  data?: unknown;
  where?: unknown;
  exists?: unknown;
  fencedBy?: unknown;
}

export const UNSAFE_NEGATIVE_EXPECTATION_MESSAGE =
  'Unsafe transaction shape: expect exists:false in a write transaction requires an exact-ID self-sealing insert or an explicit actual-changing revision fence.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRevisionScalar(value: unknown): value is string | number | boolean | null {
  return value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

function exactIdSelfSealingInsert(
  operations: RawTransactOperation[],
  negative: RawTransactOperation,
): boolean {
  if (typeof negative.table !== 'string' || typeof negative.id !== 'string' || !negative.id) {
    return false;
  }
  return operations.some((operation) => {
    if (operation.op !== 'insert' || operation.table !== negative.table || !isRecord(operation.data)) {
      return false;
    }
    return operation.data.id === negative.id;
  });
}

function parsedFence(value: unknown): TransactRevisionFence | null {
  if (!isRecord(value)) return null;
  const { table, id, field } = value;
  if (
    typeof table !== 'string' || !table
    || typeof id !== 'string' || !id
    || typeof field !== 'string' || !field || field === 'id'
  ) {
    return null;
  }
  return { table, id, field };
}

function equalityValue(operation: RawTransactOperation, field: string): unknown {
  if (!Array.isArray(operation.where)) return undefined;
  for (const condition of operation.where) {
    if (
      Array.isArray(condition)
      && condition.length === 3
      && condition[0] === field
      && condition[1] === '=='
    ) {
      return condition[2];
    }
  }
  return undefined;
}

function actualChangingRevisionFence(
  operations: RawTransactOperation[],
  negativeIndex: number,
  value: unknown,
): boolean {
  const fence = parsedFence(value);
  if (!fence) return false;
  const preceding = operations.slice(0, negativeIndex);
  const guard = preceding.find((operation) => (
    operation.op === 'expect'
    && operation.exists === true
    && operation.table === fence.table
    && operation.id === fence.id
    && isRevisionScalar(equalityValue(operation, fence.field))
  ));
  if (!guard) return false;
  const expected = equalityValue(guard, fence.field);
  return preceding.some((operation) => {
    if (
      operation.op !== 'update'
      || operation.table !== fence.table
      || operation.id !== fence.id
      || !isRecord(operation.data)
      || !Object.prototype.hasOwnProperty.call(operation.data, fence.field)
    ) {
      return false;
    }
    const next = operation.data[fence.field];
    return isRevisionScalar(next) && !Object.is(next, expected);
  });
}

/**
 * Negative predicates cannot lock a missing row. Keep the portable transact
 * contract honest by accepting them in a write transaction only when a
 * primary-key insert seals the same missing id, or when the caller names a
 * preceding exact row revision guard plus an actual revision change.
 */
export function validateNegativeTransactExpectations(
  operations: RawTransactOperation[],
): string | null {
  const hasWrite = operations.some((operation) => (
    operation.op === 'insert' || operation.op === 'update' || operation.op === 'delete'
  ));
  if (!hasWrite) return null;

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (operation.op !== 'expect' || operation.exists !== false) continue;
    if (exactIdSelfSealingInsert(operations, operation)) continue;
    if (actualChangingRevisionFence(operations, index, operation.fencedBy)) continue;
    return UNSAFE_NEGATIVE_EXPECTATION_MESSAGE;
  }
  return null;
}
