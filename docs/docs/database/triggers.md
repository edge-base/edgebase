---
sidebar_position: 8
---

# Database Triggers

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Run server-side code automatically when database records are created, updated, or deleted. Database triggers are [App Functions](/docs/functions) with a `db` trigger type.

## Overview

A DB trigger fires **after** a CUD (Create/Update/Delete) operation completes. Triggers execute asynchronously via `ctx.waitUntil()` — they never block or delay the API response to the client. The triggering DB block can be D1-backed or Durable-Object-backed; the trigger API is the same either way.

```typescript
// functions/onPostCreated.ts
import { defineFunction } from '@edge-base/shared';

export default defineFunction({
  trigger: { type: 'db', table: 'posts', event: 'insert' },
  handler: async ({ data, auth, admin }) => {
    await admin.db('app').table('activity').insert({
      type: 'new_post',
      postId: data.after.id,
      userId: auth?.id,
    });
  },
});
```

Place trigger files in the `functions/` directory. They are automatically discovered and bundled during `npx edgebase deploy`.

## Events

| Event | Fires when | `data.before` | `data.after` |
|-------|-----------|---------------|--------------|
| `insert` | A new record is inserted | — | New record |
| `update` | An existing record is updated | Previous record | Updated record |
| `delete` | A record is deleted | Deleted record | — |

## Handler Context

Every DB trigger handler receives these context objects:

| Context | Description |
|---------|-------------|
| `data.before` | The record **before** the operation (`update`, `delete`) |
| `data.after` | The record **after** the operation (`insert`, `update`) |
| `auth` | The user who performed the operation (`null` if unauthenticated or Service Key without JWT) |
| `admin` | Admin SDK instance — full access to all DB blocks, auth, storage, etc. |

The `admin` context mirrors the same server-side capabilities exposed by all Admin SDKs.

### Trigger Source Info

Access information about the DB block instance that fired the trigger:

| Context | Description |
|---------|-------------|
| `context.trigger.namespace` | The DB block namespace (e.g., `'app'`, `'user'`) |
| `context.trigger.id` | The DB block instance ID (e.g., `undefined` for single-instance blocks, `'user-123'` for user blocks) |

## Examples

### Activity log

```typescript
export default defineFunction({
  trigger: { type: 'db', table: 'posts', event: 'insert' },
  handler: async ({ data, auth, admin }) => {
    await admin.db('app').table('activity_log').insert({
      action: 'post_created',
      targetId: data.after.id,
      userId: auth?.id,
      metadata: JSON.stringify({ title: data.after.title }),
    });
  },
});
```

### Counter update

```typescript
export default defineFunction({
  trigger: { type: 'db', table: 'comments', event: 'insert' },
  handler: async ({ data, admin }) => {
    await admin.db('app').table('posts').update(data.after.postId, {
      commentCount: increment(1),
    });
  },
});
```

### Change detection

```typescript
export default defineFunction({
  trigger: { type: 'db', table: 'orders', event: 'update' },
  handler: async ({ data, admin }) => {
    // Only act when status changes to 'shipped'
    if (data.before.status !== 'shipped' && data.after.status === 'shipped') {
      await admin.db('app').table('notifications').insert({
        userId: data.after.userId,
        type: 'order_shipped',
        orderId: data.after.id,
      });
    }
  },
});
```

### Cascade delete

```typescript
export default defineFunction({
  trigger: { type: 'db', table: 'posts', event: 'delete' },
  handler: async ({ data, admin }) => {
    // Delete all comments for the deleted post
    await admin.db('app').table('comments')
      .where('postId', '==', data.before.id)
      .deleteMany();
  },
});
```

### External webhook

```typescript
export default defineFunction({
  trigger: { type: 'db', table: 'orders', event: 'insert' },
  handler: async ({ data }) => {
    await fetch('https://hooks.slack.com/services/T.../B.../xxx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `New order #${data.after.id} — $${data.after.total}`,
      }),
    });
  },
});
```

## Cross-DO Access

Triggers can access any DB block, not just the one that fired the trigger. EdgeBase handles Cross-DO routing automatically:

```typescript
export default defineFunction({
  trigger: { type: 'db', table: 'orders', event: 'insert' },
  handler: async ({ data, admin }) => {
    // Access a single-instance app DB block
    await admin.db('app').table('analytics').insert({
      event: 'order_placed',
      amount: data.after.total,
    });

    // Access a different user's DB
    await admin.db('user', data.after.sellerId).table('inbox').insert({
      type: 'new_order',
      orderId: data.after.id,
    });
  },
});
```

## Execution Model

- **Async**: Triggers run via `ctx.waitUntil()` after the API response is sent. The client gets their CUD response immediately.
- **Best-effort**: If a trigger fails, the error is logged but the original operation is **not** rolled back. Triggers are independent of the source transaction.
- **No retry**: Failed triggers are not automatically retried. Design triggers to be idempotent where possible.

:::info See Also
- [App Functions Overview](/docs/functions) — Full function system (HTTP, schedule, authentication triggers)
- [Function Trigger Types](/docs/functions/triggers) — Advanced trigger configuration and Cross-DO patterns
- [Authentication Triggers](/docs/authentication/hooks) — Run backend logic during authentication events
:::
