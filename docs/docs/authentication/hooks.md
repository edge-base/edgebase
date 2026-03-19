---
sidebar_position: 19
sidebar_label: Authentication Triggers
---

# Authentication Triggers

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Run backend logic during sign-up, sign-in, token refresh, password reset, sign-out, account deletion, and email verification.

Authentication triggers are App Functions with `trigger.type = 'auth'`. This page keeps the auth-specific view inside the Authentication section. For the full App Functions model, see [Function Trigger Types](/docs/functions/triggers).

:::note Terminology
- **Access Rules** decide whether a client operation is allowed.
- **Authentication Triggers** run backend logic on auth lifecycle events.
- **Authentication Delivery Hooks** customize outbound email and SMS delivery under `auth.handlers.email.onSend` and `auth.handlers.sms.onSend`.
:::

## Quick Example

Place authentication trigger files in the `functions/` directory:

```typescript
// functions/restrict-company-domain.ts
import { defineFunction, FunctionError } from '@edge-base/shared';

export default defineFunction({
  trigger: { type: 'auth', event: 'beforeSignUp' },
  handler: async ({ data }) => {
    const email = String(data?.after?.email ?? '');
    if (!email.endsWith('@company.com')) {
      throw new FunctionError('forbidden', 'Only company emails are allowed.');
    }
  },
});
```

## Supported Events

| Trigger Event | Blocking | `ctx.data?.after` payload |
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
| `onDeleteAccount` | No | Sanitized user snapshot before deletion |
| `onEmailVerified` | No | Sanitized verified user |

## Common Uses

- Reject signups from blocked email domains
- Create profile rows or tenant membership after signup
- Revoke sessions or audit password resets
- Inject dynamic claims during token refresh
- Clean up external systems when an account is deleted

## Create a Profile After Signup

```typescript
import { defineFunction } from '@edge-base/shared';

export default defineFunction({
  trigger: { type: 'auth', event: 'afterSignUp' },
  handler: async ({ data, admin }) => {
    const user = data?.after;
    if (!user?.id) return;

    await admin.db('app').table('profiles').insert({
      userId: String(user.id),
      displayName: String(user.displayName ?? 'New User'),
    });
  },
});
```

## Add Claims on Token Refresh

`onTokenRefresh` is the only authentication trigger whose return value is fed back into token generation.

```typescript
import { defineFunction } from '@edge-base/shared';

export default defineFunction({
  trigger: { type: 'auth', event: 'onTokenRefresh' },
  handler: async ({ data, admin }) => {
    const userId = String(data?.after?.id ?? '');
    if (!userId) return;

    const { items } = await admin.db('app').table('subscriptions').list({
      limit: 1,
      filter: [['userId', '==', userId]],
    });

    return {
      plan: items[0]?.plan ?? 'free',
      subscriptionStatus: items[0]?.status ?? 'inactive',
    };
  },
});
```

## Behavior

- Blocking trigger events can reject the auth operation by throwing.
- Non-blocking trigger events run via `ctx.waitUntil()` and do not affect the client response once the main auth action succeeds.
- The timeout for blocking authentication triggers is fixed at `5s`.
- `ctx.auth` is always `null`; use `ctx.data?.after` for user information.
- `ctx.admin.auth.createUser()` and `ctx.admin.auth.deleteUser()` are intentionally unavailable inside authentication triggers.

## Next Steps

- [Function Trigger Types](/docs/functions/triggers) — How App Function triggers fit together
- [Authentication Delivery Hooks](/docs/functions/mail-hooks) — Rewrite or block outbound email and SMS messages
- [Admin Users](/docs/authentication/admin-users) — Server-side user management
- [Password Policy](/docs/authentication/password-policy) — Built-in policy checks that complement `beforePasswordReset`
