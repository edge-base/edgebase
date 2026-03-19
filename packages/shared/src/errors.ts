// ─── Error Response Format ───

export interface FieldError {
  code: string;
  message: string;
}

export interface ErrorResponse {
  code: number;
  message: string;
  /** Semantic error slug for programmatic error handling (e.g. 'token-expired', 'email-already-exists'). */
  slug?: string;
  data?: Record<string, FieldError>;
}

// ─── Well-known Error Slugs ───

/**
 * Well-known semantic error slugs for EdgeBase core errors.
 * SDKs can match on `slug` instead of parsing error messages.
 *
 * @example
 * ```ts
 * try { await client.auth.signIn({ email, password }); }
 * catch (err) {
 *   if (err.slug === 'invalid-credentials') { ... }
 *   if (err.slug === 'account-disabled') { ... }
 *   if (err.slug === 'token-expired') { ... }
 * }
 * ```
 */
export const ErrorSlug = {
  // ── 400 Validation ──
  'validation-failed': 400,
  'invalid-input': 400,
  'invalid-json': 400,
  'invalid-email': 400,
  'password-too-short': 400,
  'password-too-long': 400,
  'password-policy': 400,
  'display-name-too-long': 400,
  'invalid-locale': 400,
  'invalid-token': 400,
  'token-expired': 400,
  'challenge-expired': 400,
  'invalid-otp': 400,
  'no-fields-to-update': 400,
  'mfa-already-enrolled': 400,
  'invalid-phone': 400,
  'foreign-key-failed': 400,
  'constraint-failed': 400,

  // ── 401 Unauthorized ──
  'unauthenticated': 401,
  'invalid-credentials': 401,
  'invalid-refresh-token': 401,
  'refresh-token-expired': 401,
  'refresh-token-reused': 401,
  'invalid-password': 401,
  'invalid-totp': 401,
  'invalid-recovery-code': 401,

  // ── 403 Forbidden ──
  'forbidden': 403,
  'access-denied': 403,
  'account-disabled': 403,
  'action-not-allowed': 403,
  'hook-rejected': 403,
  'oauth-only': 403,
  'anonymous-not-allowed': 403,

  // ── 404 Not Found ──
  'not-found': 404,
  'user-not-found': 404,
  'feature-not-enabled': 404,

  // ── 405 Method Not Allowed ──
  'method-not-allowed': 405,

  // ── 409 Conflict ──
  'already-exists': 409,
  'email-already-exists': 409,
  'phone-already-exists': 409,
  'record-already-exists': 409,

  // ── 429 Rate Limited ──
  'rate-limited': 429,

  // ── 500 Internal ──
  'internal-error': 500,
} as const;

export type ErrorSlugType = keyof typeof ErrorSlug;

/**
 * EdgeBase error class extending standard Error.
 * Used by both server and SDK for consistent error handling.
 *
 * @example
 * ```ts
 * // With slug (preferred — enables programmatic error handling):
 * throw new EdgeBaseError(400, 'Invalid email format.', undefined, 'invalid-email');
 *
 * // Legacy (still supported):
 * throw new EdgeBaseError(400, 'Invalid email format.');
 * ```
 */
export class EdgeBaseError extends Error {
  public readonly code: number;
  public readonly data?: Record<string, FieldError>;
  /** Semantic error slug for programmatic matching. */
  public readonly slug?: string;

  constructor(code: number, message: string, data?: Record<string, FieldError>, slug?: string) {
    super(message);
    this.name = 'EdgeBaseError';
    this.code = code;
    this.data = data;
    this.slug = slug;
  }

  /** Alias for `code` — HTTP status code of the error. */
  get status(): number {
    return this.code;
  }

  /** True when the error is a network/connectivity failure (not a server HTTP error). */
  get isNetworkError(): boolean {
    return this.code === 0 && this.slug === 'network-error';
  }

  /** True when the error is an authentication/authorization failure (401/403). */
  get isAuthError(): boolean {
    return this.code === 401 || this.code === 403;
  }

  toJSON(): ErrorResponse {
    const response: ErrorResponse = {
      code: this.code,
      message: this.message,
    };
    if (this.slug) {
      response.slug = this.slug;
    }
    if (this.data) {
      response.data = this.data;
    }
    return response;
  }
}

/**
 * Create a standard error response object.
 */
export function createErrorResponse(
  code: number,
  message: string,
  data?: Record<string, FieldError>,
  slug?: string,
): ErrorResponse {
  const response: ErrorResponse = { code, message };
  if (slug) {
    response.slug = slug;
  }
  if (data) {
    response.data = data;
  }
  return response;
}

// ─── Function Error ───

/**
 * Well-known error codes for App Functions.
 * Maps semantic codes to default HTTP status codes.
 */
export const FunctionErrorCode = {
  'not-found': 404,
  'permission-denied': 403,
  'unauthenticated': 401,
  'invalid-argument': 400,
  'already-exists': 409,
  'resource-exhausted': 429,
  'failed-precondition': 412,
  'internal': 500,
  'unavailable': 503,
} as const;

export type FunctionErrorCodeType = keyof typeof FunctionErrorCode;

/**
 * Structured error thrown from App Functions.
 * Caught by the functions route handler and returned as a JSON response
 * with the appropriate HTTP status code.
 *
 * @example
 * throw new FunctionError('not-found', 'User not found');
 * throw new FunctionError('permission-denied', 'Admin only');
 * throw new FunctionError('invalid-argument', 'Email is required', { field: 'email' });
 */
export class FunctionError extends Error {
  public readonly code: FunctionErrorCodeType | string;
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: FunctionErrorCodeType | string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'FunctionError';
    this.code = code;
    this.httpStatus =
      (FunctionErrorCode as Record<string, number>)[code] ?? 400;
    this.details = details;
  }

  toJSON(): {
    code: string;
    message: string;
    status: number;
    details?: Record<string, unknown>;
  } {
    const result: {
      code: string;
      message: string;
      status: number;
      details?: Record<string, unknown>;
    } = {
      code: this.code,
      message: this.message,
      status: this.httpStatus,
    };
    if (this.details) result.details = this.details;
    return result;
  }
}
