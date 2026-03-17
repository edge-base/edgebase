---
sidebar_position: 7
---

# Middleware

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Directory-level middleware for App Functions.

:::info Advanced Feature
For most authentication and authorization needs, use [Access Rules](/docs/database/access-rules) instead. Middleware is useful for HTTP-level concerns like webhook verification or request logging.
:::

## Overview

Place a `_middleware.ts` file in any directory under `functions/` to run code before all functions in that directory and its subdirectories.

## Creating Middleware

```typescript
// functions/_middleware.ts (applies to ALL functions)
import { defineFunction, FunctionError } from '@edgebase/shared';

export default defineFunction(async ({ auth }) => {
  if (!auth) {
    throw new FunctionError('unauthenticated', 'Login required');
  }
  // Return nothing to continue to the next middleware / handler
});
```

## Directory Scoping

Middleware only applies to functions in its directory and subdirectories:

```
functions/
  _middleware.ts              <- applies to everything
  public/
    health.ts                  <- only root middleware
  admin/
    _middleware.ts             <- applies to admin/* functions
    dashboard.ts               <- root + admin middleware
    users/
      [userId].ts              <- root + admin middleware
```

## Execution Order

Middlewares execute from root to most specific directory:

```
Request to /api/functions/admin/users/abc123
  1. functions/_middleware.ts           (root)
  2. functions/admin/_middleware.ts     (admin/)
  3. functions/admin/users/[userId].ts  (handler)
```

## Use Cases

### Webhook Secret Verification

```typescript
// functions/(webhooks)/_middleware.ts
export default defineFunction(async ({ request }) => {
  const secret = request.headers.get('x-webhook-secret');
  if (secret !== process.env.WEBHOOK_SECRET) {
    throw new FunctionError('unauthenticated', 'Invalid webhook secret');
  }
});
```

### Request Logging

```typescript
// functions/_middleware.ts
export default defineFunction(async ({ request, auth }) => {
  console.log(`[${new Date().toISOString()}] ${request.method} ${request.url} user=${auth?.id ?? 'anonymous'}`);
});
```
