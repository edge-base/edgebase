/**
 * SDK Error classes
 * Extends @edge-base/shared EdgeBaseError with SDK-specific error types
 */

import { EdgeBaseError } from '@edge-base/shared';

export { EdgeBaseError };
export type { ErrorResponse, FieldError } from '@edge-base/shared';

function fallbackErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Bad request. Check the request body and query parameters.';
    case 401:
      return 'Unauthorized. Sign in again and retry.';
    case 403:
      return 'Forbidden. The request was blocked by access rules or missing permissions.';
    case 404:
      return 'Not found. The resource or endpoint does not exist.';
    case 409:
      return 'Conflict. The requested change could not be applied because the resource already exists or changed.';
    case 422:
      return 'Validation failed. Check the submitted values and retry.';
    case 429:
      return 'Rate limited. Slow down and retry in a moment.';
    default:
      if (status >= 500) {
        return 'Server error. Check the EdgeBase server logs and retry.';
      }
      return `Request failed with status ${status}.`;
  }
}

function extractMessage(body: unknown): string | null {
  if (typeof body === 'string' && body.trim().length > 0) {
    return body.trim();
  }
  if (!body || typeof body !== 'object') {
    return null;
  }

  const record = body as Record<string, unknown>;
  for (const key of ['message', 'error', 'detail']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function extractCauseMessage(cause: unknown): string | null {
  if (cause instanceof Error && typeof cause.message === 'string' && cause.message.trim().length > 0) {
    return cause.message.trim();
  }
  if (typeof cause === 'string' && cause.trim().length > 0) {
    return cause.trim();
  }
  return null;
}

/**
 * Parse a server error response into a EdgeBaseError
 */
export function parseErrorResponse(status: number, body: unknown): EdgeBaseError {
  const err = body && typeof body === 'object'
    ? body as Record<string, unknown>
    : null;

  return new EdgeBaseError(
    status,
    extractMessage(body) ?? fallbackErrorMessage(status),
    err?.data as Record<string, { code: string; message: string }> | undefined,
    typeof err?.slug === 'string' ? err.slug : undefined,
  );
}

/**
 * Create a network-level error (fetch failures, timeouts, etc.)
 * Uses slug 'network-error' so callers can distinguish from server errors.
 */
export function networkError(
  message: string,
  options?: { cause?: unknown },
): EdgeBaseError {
  const causeMessage = extractCauseMessage(options?.cause);
  return new EdgeBaseError(
    0,
    causeMessage && !message.includes(causeMessage)
      ? `${message} Cause: ${causeMessage}`
      : message,
    undefined,
    'network-error',
  );
}
