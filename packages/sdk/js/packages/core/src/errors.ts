/**
 * SDK Error classes
 * Extends @edge-base/shared EdgeBaseError with SDK-specific error types
 */

import { EdgeBaseError } from '@edge-base/shared';

export { EdgeBaseError };
export type { ErrorResponse, FieldError } from '@edge-base/shared';

/**
 * Parse a server error response into a EdgeBaseError
 */
export function parseErrorResponse(status: number, body: unknown): EdgeBaseError {
  if (
    body &&
    typeof body === 'object' &&
    'message' in body &&
    typeof (body as Record<string, unknown>).message === 'string'
  ) {
    const err = body as Record<string, unknown>;
    return new EdgeBaseError(
      status,
      err.message as string,
      err.data as Record<string, { code: string; message: string }> | undefined,
      typeof err.slug === 'string' ? err.slug : undefined,
    );
  }
  return new EdgeBaseError(status, `Request failed with status ${status}`);
}

/**
 * Create a network-level error (fetch failures, timeouts, etc.)
 * Uses slug 'network-error' so callers can distinguish from server errors.
 */
export function networkError(message: string): EdgeBaseError {
  return new EdgeBaseError(0, message, undefined, 'network-error');
}
