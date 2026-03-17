/**
 * Field operation helpers for atomic update operations
 *: increment, deleteField
 */

/** Internal sentinel symbol for field operations */
const FIELD_OP_SYMBOL = Symbol.for('edgebase:field-op');

export interface FieldOp {
  readonly [FIELD_OP_SYMBOL]: true;
  readonly $op: string;
  readonly value?: number;
}

/**
 * Atomic increment/decrement a numeric field.
 * Server converts to: `field = field + n`
 *
 * @example
 * await client.db('shared').table('posts').doc('post-1').update({
 *   viewCount: increment(1),   // viewCount = viewCount + 1
 *   likes: increment(-1),      // likes = likes - 1
 * });
 */
export function increment(n: number): FieldOp {
  return { [FIELD_OP_SYMBOL]: true, $op: 'increment', value: n };
}

/**
 * Set a field to NULL (semantic deletion).
 * Server converts to: `field = NULL`
 *
 * @example
 * await client.db('shared').table('posts').doc('post-1').update({
 *   temporaryFlag: deleteField(),
 * });
 */
export function deleteField(): FieldOp {
  return { [FIELD_OP_SYMBOL]: true, $op: 'deleteField' };
}

/**
 * Check if a value is a field operation object
 */
export function isFieldOp(value: unknown): value is FieldOp {
  return (
    value !== null &&
    typeof value === 'object' &&
    FIELD_OP_SYMBOL in (value as Record<symbol, unknown>)
  );
}

/**
 * Serialize data containing field operations for transmission to server.
 * Strips internal symbol, keeps $op format for server parsing.
 */
export function serializeFieldOps(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (isFieldOp(value)) {
      if (value.$op === 'increment') {
        result[key] = { $op: 'increment', value: value.value };
      } else if (value.$op === 'deleteField') {
        result[key] = { $op: 'deleteField' };
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}
