---
sidebar_position: 6
---

# Error Handling

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Structured error handling for App Functions with semantic error codes.

Use `FunctionError` for application-level failures that should become an HTTP response. Treat transport failures such as connection resets, DNS errors, or timeouts as a separate class of failure.

## FunctionError

Throw `FunctionError` in your function handlers to return structured error responses:

```typescript
import { FunctionError } from '@edge-base/shared';

export const POST = defineFunction(async ({ auth, admin }) => {
  if (!auth) {
    throw new FunctionError('unauthenticated', 'Login required');
  }

  if (auth.custom?.role !== 'admin') {
    throw new FunctionError('permission-denied', 'Admin access required');
  }

  const user = await admin.db('app').table('users').get(auth.id);
  if (!user) {
    throw new FunctionError('not-found', 'User not found');
  }

  // Check preconditions before proceeding
  if (user.status !== 'active') {
    throw new FunctionError('failed-precondition', 'Account must be active to perform this action');
    // Returns HTTP 412 Precondition Failed
  }

  return user;
});
```

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `unauthenticated` | 401 | No auth token or invalid token |
| `permission-denied` | 403 | Authenticated but not authorized |
| `not-found` | 404 | Resource not found |
| `invalid-argument` | 400 | Bad request parameters |
| `already-exists` | 409 | Resource already exists |
| `resource-exhausted` | 429 | Rate limit exceeded |
| `failed-precondition` | 412 | Operation prerequisites not met |
| `internal` | 500 | Internal server error |
| `unavailable` | 503 | Service temporarily unavailable |

Custom string codes are allowed, but unknown codes default to HTTP `400`.

## Error Response Format

When a `FunctionError` is thrown, the client receives:

```json
{
  "code": "permission-denied",
  "message": "Admin access required",
  "status": 403
}
```

## FunctionError vs Transport Failures

These failures look similar from the caller's perspective, but they should be handled differently:

- `FunctionError`: Your handler ran and intentionally returned a semantic HTTP error such as `401`, `403`, `404`, or `412`.
- Transport failure: The caller never got a usable application response because the request failed before a valid function response could be processed.

For App Functions, this usually means:

- Use `FunctionError` for business rules, auth checks, validation, and resource state checks.
- Retry only transient transport failures and server-side availability errors such as `503`.
- Do not blindly retry `400`, `401`, `403`, `404`, `409`, or `412` without changing auth state or input.

## Error Details

Pass additional context with the `details` parameter:

```typescript
throw new FunctionError('invalid-argument', 'Validation failed', {
  field: 'email',
  reason: 'Invalid email format',
});
```

Response:
```json
{
  "code": "invalid-argument",
  "message": "Validation failed",
  "status": 400,
  "details": { "field": "email", "reason": "Invalid email format" }
}
```

## Client-Side Handling

Errors thrown by functions are caught as `EdgeBaseError` in the client SDK:

```typescript
import { EdgeBaseError } from '@edge-base/web';

try {
  await client.functions.post('create-order', { items: [] });
} catch (err) {
  if (err instanceof EdgeBaseError) {
    if (err.status === 0) {
      retryLater();
      return;
    }

    switch (err.status) {
      case 401:
        redirectToLogin();
        break;
      case 403:
        showAccessDenied();
        break;
      case 412:
        showError('Your account must be active before creating an order.');
        break;
      default:
        showError(err.message);
    }
  }
}
```

`EdgeBaseError.code` and `EdgeBaseError.status` are aliases for the HTTP status code. A status of `0` means the SDK did not reach a usable HTTP error response and the failure should be treated as transport-level.

If you need the raw semantic function payload, the HTTP response body for `FunctionError` still includes the semantic `code`, `message`, `status`, and optional `details`.

## Unhandled Errors

If a function throws a non-`FunctionError` error (e.g., `throw new Error(...)`), the server returns a generic 500 response. The actual error message is logged server-side but not exposed to the client for security.
