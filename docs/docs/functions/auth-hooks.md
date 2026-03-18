---
sidebar_position: 2
sidebar_label: Authentication Triggers
unlisted: true
---

# Authentication Triggers

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

EdgeBase authentication triggers let you run server-side logic during authentication flows such as sign-up, sign-in, token refresh, password reset, sign-out, account deletion, and email verification.

Authentication triggers are defined as App Functions with `trigger.type = 'auth'`.

:::note Terminology
Use **authentication triggers** for App Functions that run on auth lifecycle events. Use **authentication delivery hooks** for inline email and SMS customization under `auth.handlers.email.onSend` and `auth.handlers.sms.onSend`.
:::

```typescript
import { defineFunction } from '@edgebase-fun/shared';

export default defineFunction({
  trigger: { type: 'auth', event: 'afterSignUp' },
  handler: async (ctx) => {
    await ctx.admin.db('app').table('profiles').insert({
      userId: String(ctx.data?.after?.id),
      displayName: String(ctx.data?.after?.displayName ?? 'New User'),
    });
  },
});
```

## Context Shape

Authentication triggers receive a single context object.

```typescript
interface AuthHookContext {
  request: Request;
  auth: null;
  admin: {
    db(namespace: string, id?: string): { table(name: string): TableProxy };
    table(name: string): TableProxy;
    auth: {
      getUser(userId: string): Promise<Record<string, unknown>>;
      listUsers(options?: { limit?: number; cursor?: string }): Promise<{ users: Record<string, unknown>[]; cursor?: string }>;
      updateUser(userId: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
      setCustomClaims(userId: string, claims: Record<string, unknown>): Promise<void>;
      revokeAllSessions(userId: string): Promise<void>;
    };
    sql(namespace: string, id: string | undefined, query: string, params?: unknown[]): Promise<unknown[]>;
    broadcast(channel: string, event: string, payload?: Record<string, unknown>): Promise<void>;
    functions: { call(name: string, data?: unknown): Promise<unknown> };
    kv(namespace: string): unknown;
    d1(database: string): unknown;
    vector(index: string): unknown;
    push: unknown;
  };
  data?: {
    after?: Record<string, unknown>;
  };
}
```

:::note
Inside authentication triggers, `ctx.admin.auth.createUser()` and `ctx.admin.auth.deleteUser()` are intentionally unavailable. Use the Admin API or an App Function outside the auth trigger pipeline for those operations.
:::

## Supported Events

| Event | Blocking | `ctx.data?.after` payload |
| --- | --- | --- |
| `beforeSignUp` | Yes | Draft signup payload such as `id`, `email`, `displayName`, `avatarUrl` |
| `afterSignUp` | No | Sanitized created user |
| `beforeSignIn` | Yes | Sanitized user about to sign in |
| `afterSignIn` | No | Sanitized signed-in user |
| `onTokenRefresh` | Yes | Sanitized user whose token is being refreshed |
| `beforePasswordReset` | Yes | Usually `{ userId }` |
| `afterPasswordReset` | No | Sanitized user after password change/reset |
| `beforeSignOut` | Yes | `{ userId }` |
| `afterSignOut` | No | `{ userId }` |
| `onDeleteAccount` | No | `{ userId }` |
| `onEmailVerified` | No | Sanitized verified user |

Blocking triggers can reject the operation by throwing. Non-blocking triggers run via `waitUntil()` semantics and do not affect the client response once the main auth action succeeds.

## Common Patterns

### Reject a Signup

```typescript
import { defineFunction, FunctionError } from '@edgebase-fun/shared';

export default defineFunction({
  trigger: { type: 'auth', event: 'beforeSignUp' },
  handler: async (ctx) => {
    const email = String(ctx.data?.after?.email ?? '');
    if (email.endsWith('@blocked.example')) {
      throw new FunctionError('forbidden', 'This domain is not allowed.');
    }
  },
});
```

### Create a Profile After Signup

```typescript
import { defineFunction } from '@edgebase-fun/shared';

export default defineFunction({
  trigger: { type: 'auth', event: 'afterSignUp' },
  handler: async (ctx) => {
    const user = ctx.data?.after;
    if (!user?.id) return;

    await ctx.admin.db('app').table('profiles').insert({
      userId: String(user.id),
      displayName: String(user.displayName ?? 'New User'),
    });
  },
});
```

### Add Claims on Token Refresh

`onTokenRefresh` is the only authentication trigger whose return value is fed back into token generation.

```typescript
import { defineFunction } from '@edgebase-fun/shared';

export default defineFunction({
  trigger: { type: 'auth', event: 'onTokenRefresh' },
  handler: async (ctx) => {
    const userId = String(ctx.data?.after?.id ?? '');
    if (!userId) return;

    const { items } = await ctx.admin.db('app').table('subscriptions').list({
      limit: 1,
      filter: [['userId', '==', userId]],
    });

    const active = items[0];
    return {
      plan: active?.plan ?? 'free',
      subscriptionStatus: active?.status ?? 'inactive',
    };
  },
});
```

The returned object overrides stored `customClaims` keys with the same name for the new access token.

### Revoke Sessions After Password Reset

```typescript
import { defineFunction } from '@edgebase-fun/shared';

export default defineFunction({
  trigger: { type: 'auth', event: 'afterPasswordReset' },
  handler: async (ctx) => {
    const userId = String(ctx.data?.after?.id ?? '');
    if (!userId) return;

    await ctx.admin.auth.revokeAllSessions(userId);
    await ctx.admin.db('app').table('activity_log').insert({
      type: 'password_reset',
      userId,
      timestamp: new Date().toISOString(),
    });
  },
});
```

### Audit Sign-Out

```typescript
import { defineFunction } from '@edgebase-fun/shared';

export default defineFunction({
  trigger: { type: 'auth', event: 'afterSignOut' },
  handler: async (ctx) => {
    const userId = String(ctx.data?.after?.userId ?? '');
    if (!userId) return;

    await ctx.admin.db('app').table('activity_log').insert({
      type: 'sign_out',
      userId,
      timestamp: new Date().toISOString(),
    });
  },
});
```

### Clean Up External Systems on Account Deletion

```typescript
import { defineFunction } from '@edgebase-fun/shared';

export default defineFunction({
  trigger: { type: 'auth', event: 'onDeleteAccount' },
  handler: async (ctx) => {
    const userId = String(ctx.data?.after?.userId ?? '');
    if (!userId) return;

    await fetch('https://analytics.example.com/api/delete-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
  },
});
```

## Notes

- Use `ctx.admin.db(...).table(...).list({ filter, limit })` for table lookups inside authentication triggers. The auth-trigger admin proxy exposes `get`, `list`, `insert`, `update`, and `delete`.
- Use `ctx.admin.sql(...)` when you need joins, aggregation, or bulk cleanup.
- Throwing from a blocking trigger returns a rejection to the caller. Non-blocking triggers only log failures.
- The authentication trigger pipeline always passes data through `ctx.data?.after`; there is no legacy multi-argument handler signature in the current runtime.
