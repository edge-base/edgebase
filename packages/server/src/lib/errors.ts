import { EdgeBaseError } from '@edge-base/shared';
import type { ErrorResponse, FieldError } from '@edge-base/shared';

/**
 * Create a validation error (400).
 */
export function validationError(
  message: string,
  fields?: Record<string, FieldError>,
  slug?: string,
): EdgeBaseError {
  return new EdgeBaseError(400, message, fields, slug || 'validation-failed');
}

/**
 * Create an unauthorized error (401).
 */
export function unauthorizedError(message = 'Unauthorized.', slug?: string): EdgeBaseError {
  return new EdgeBaseError(401, message, undefined, slug || 'unauthenticated');
}

/**
 * Create a forbidden error (403).
 */
export function forbiddenError(message = 'Access denied.', slug?: string): EdgeBaseError {
  return new EdgeBaseError(403, message, undefined, slug || 'forbidden');
}

/**
 * Create a not found error (404).
 */
export function notFoundError(message = 'Not found.', slug?: string): EdgeBaseError {
  return new EdgeBaseError(404, message, undefined, slug || 'not-found');
}

/**
 * Create a method not allowed error (405).
 */
export function methodNotAllowedError(message = 'Method not allowed.'): EdgeBaseError {
  return new EdgeBaseError(405, message, undefined, 'method-not-allowed');
}

/**
 * Create a rate limit error (429).
 */
export function rateLimitError(retryAfter: number): EdgeBaseError {
  return new EdgeBaseError(429, `Too many requests. Retry after ${retryAfter} seconds.`, undefined, 'rate-limited');
}

/**
 * Normalize user-defined hook errors into client-facing EdgeBase errors.
 * Hooks often throw plain `Error` instances; those should reject the request
 * with a 4xx instead of surfacing as a 500.
 *
 * Prefixes the error message with the hook source so developers know
 * where to look when debugging.
 */
export function hookRejectedError(
  error: unknown,
  fallbackMessage = 'Hook rejected the request.',
  hookName?: string,
): EdgeBaseError {
  if (error instanceof EdgeBaseError) return error;

  const message = error instanceof Error ? error.message.trim() : '';
  const rawMessage = message || fallbackMessage;
  // Prefix with hook source so developers know where to look
  const safeMessage = hookName
    ? `Hook '${hookName}' rejected: ${rawMessage}`
    : rawMessage;

  if (/auth(entication)? required|unauthorized/i.test(rawMessage)) {
    return unauthorizedError(safeMessage, 'hook-rejected');
  }
  if (/forbidden|denied|blocked|not allowed|only .* can|owner/i.test(rawMessage)) {
    return forbiddenError(safeMessage, 'hook-rejected');
  }
  if (/not found|unknown/i.test(rawMessage)) {
    return notFoundError(safeMessage, 'hook-rejected');
  }
  if (/already exists|already registered|duplicate|conflict/i.test(rawMessage)) {
    return new EdgeBaseError(409, safeMessage, undefined, 'hook-rejected');
  }
  if (/too many|rate limit|thrott/i.test(rawMessage)) {
    return new EdgeBaseError(429, safeMessage, undefined, 'hook-rejected');
  }

  return new EdgeBaseError(400, safeMessage, undefined, 'hook-rejected');
}

/**
 * Normalize low-level database constraint failures into client-facing 4xx errors.
 * Extracts column/table info from the error message when available.
 */
export function normalizeDatabaseError(error: unknown): EdgeBaseError | null {
  if (error instanceof EdgeBaseError) return error;

  const objectMessage = (
    error
    && typeof error === 'object'
    && typeof (error as { message?: unknown }).message === 'string'
  )
    ? (error as { message: string }).message.trim()
    : '';
  const causeMessage = (
    error
    && typeof error === 'object'
    && typeof (error as { cause?: { message?: unknown } }).cause?.message === 'string'
  )
    ? (error as { cause: { message: string } }).cause.message.trim()
    : '';
  const message = error instanceof Error
    ? error.message.trim()
    : typeof error === 'string'
      ? error.trim()
      : objectMessage || causeMessage;

  if (!message) return null;

  const haystack = `${message}\n${causeMessage}`.trim();

  if (/foreign key constraint failed/i.test(haystack)) {
    // Try to extract column name from D1/SQLite error: "FOREIGN KEY constraint failed: tableName.columnName"
    const colMatch = haystack.match(/foreign key constraint failed[:\s]*(?:\w+\.)?(\w+)/i);
    const detail = colMatch?.[1]
      ? `Referenced record does not exist (column: '${colMatch[1]}').`
      : 'Referenced record does not exist. Check that all foreign key references point to existing records.';
    return new EdgeBaseError(400, detail, undefined, 'foreign-key-failed');
  }

  if (/unique constraint failed|duplicate key value violates unique constraint/i.test(haystack)) {
    // Try to extract column name: "UNIQUE constraint failed: tableName.columnName"
    const colMatch = haystack.match(/(?:unique constraint failed|duplicate key)[:\s]*(?:\w+\.)?(\w+)/i);
    const detail = colMatch?.[1]
      ? `Record already exists (duplicate value in column: '${colMatch[1]}').`
      : 'Record already exists. A unique constraint was violated.';
    return new EdgeBaseError(409, detail, undefined, 'record-already-exists');
  }

  if (/not null constraint failed|check constraint failed/i.test(haystack)) {
    const colMatch = haystack.match(/(?:not null|check) constraint failed[:\s]*(?:\w+\.)?(\w+)/i);
    const detail = colMatch?.[1]
      ? `Database constraint violated (column: '${colMatch[1]}'). Ensure all required fields are provided.`
      : 'Request violates a database constraint. Ensure all required fields are provided.';
    return new EdgeBaseError(400, detail, undefined, 'constraint-failed');
  }

  return null;
}

export type { ErrorResponse, FieldError };
