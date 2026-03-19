---
sidebar_position: 1
sidebar_label: Function Trigger Types
---

# Function Trigger Types

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

EdgeBase functions can be triggered in five ways — each suited to different use cases:

| Trigger      | When it fires                                    | Example                          |
| ------------ | ------------------------------------------------ | -------------------------------- |
| **HTTP**     | Client calls a URL                               | `GET /api/functions/orders/:id`  |
| **DB**       | A table record is inserted, updated, or deleted  | Log analytics on new order       |
| **Auth**     | A user signs up, signs in, resets password, etc. | Create a profile on signup       |
| **Schedule** | Cron schedule fires                              | Clean up expired sessions hourly |
| **Storage**  | File is uploaded, downloaded, deleted, or updated | Resize image after upload        |

This page shows practical patterns for each trigger type. For the full context API (`admin.db()`, `admin.auth`, etc.), see [Context API](/docs/functions/context-api).

:::tip Storage Triggers
Storage triggers let you run logic before or after file operations. See the [Storage Trigger](#storage-trigger) section below.
:::

:::tip Getting Started with Database Triggers
For an introduction to database triggers with practical examples, see [Database Triggers](/docs/database/triggers).
:::

## Database Trigger — Cross-Table Access

A database trigger's handler receives the triggering record via `data`. To write to a different table, use `admin.db().table()`:

```typescript
export default defineFunction({
  trigger: { type: 'db', table: 'orders', event: 'insert' },
  handler: async ({ data, admin }) => {
    await admin.db('app').table('analytics').insert({
      type: 'new_order',
      orderId: data.after.id,
    });
  },
});
```

## Cross-DO Access

Access any table from any function; EdgeBase handles Cross-DO routing automatically:

```typescript
handler: async ({ admin }) => {
  // Same-group = local JOIN (fast)
  const users = await admin.db('app').table('users').list();

  // Different DO = Cross-DO fetch (automatic, transparent)
  const posts = await admin.db('app').table('posts').list();
};
```

## Authentication Trigger Context

Authentication triggers run in the auth handler context. Use `context.admin.db().table()` for database access:

```typescript
export default defineFunction({
  trigger: { type: 'auth', event: 'afterSignUp' },
  handler: async ({ data, admin }) => {
    await admin
      .db('app')
      .table('profiles')
      .insert({
        userId: data?.after?.id,
        displayName: data?.after?.displayName || 'New User',
      });

    await admin.auth.setCustomClaims(data?.after?.id, { plan: 'free' });
  },
});
```

## Schedule — Without DB Scope

Scheduled functions can access any DB block via `context.admin.db(namespace).table()`:

```typescript
export default defineFunction({
  trigger: { type: 'schedule', cron: '0 * * * *' },
  handler: async ({ admin }) => {
    const deleted = await admin.sql(
      'app',
      undefined,
      'DELETE FROM sessions WHERE expiresAt < ? RETURNING id',
      [new Date().toISOString()],
    );

    console.log('Deleted stale sessions:', deleted.length);
  },
});
```

Schedule trigger ownership is config-driven at deploy time:

- App Function schedule triggers contribute their cron expressions to the managed deploy cron set.
- `cloudflare.extraCrons` can add additional `scheduled()` wake-ups, but those cron entries are not attached to a specific schedule function.
- If you add `cloudflare.extraCrons`, your Worker runtime must decide what to do when `scheduled()` fires at those times.

## HTTP Trigger — File-System Routing

HTTP functions use file-system routing by default. The file path determines the URL, and named exports (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) determine the HTTP method:

```typescript
// functions/orders/[orderId].ts -> /api/functions/orders/:orderId
import { defineFunction, FunctionError } from '@edge-base/shared';

export const GET = defineFunction(async ({ params, admin, auth }) => {
  if (!auth) throw new FunctionError('unauthenticated', 'Login required');
  const order = await admin.db('app').table('orders').getOne(params.orderId);
  if (!order) throw new FunctionError('not-found', 'Order not found');
  return Response.json(order);
});

export const DELETE = defineFunction(async ({ params, admin, auth }) => {
  if (!auth) throw new FunctionError('unauthenticated', 'Login required');
  await admin.db('app').table('orders').delete(params.orderId);
  return Response.json({ deleted: true });
});
```

Dynamic route parameters (`[param]` segments) are available via `context.params`. See [Context API](/docs/functions/context-api#contextparams) for details.

:::tip
You can define multiple HTTP methods in the same file. Each named export becomes a separate handler. Use `index.ts` for collection endpoints (e.g., `functions/orders/index.ts` for `/api/functions/orders`).
:::

If you need a cleaner public route, use `trigger.path` on a default export:

```typescript
export default defineFunction({
  trigger: { type: 'http', method: 'GET', path: '/analytics/orders' },
  handler: async ({ admin }) => {
    const { items } = await admin.db('app').table('orders').list();
    return { items };
  },
});
```

That function is served at `GET /api/functions/analytics/orders`.

## Storage Trigger

Storage triggers run server-side logic before or after file operations (upload, download, delete, metadata update). Blocking events (`beforeUpload`, `beforeDownload`, `beforeDelete`) can reject the operation by throwing.

| Event              | Blocking | Description                                  |
| ------------------ | -------- | -------------------------------------------- |
| `beforeUpload`     | Yes      | Runs before a file is uploaded. Throw to reject. |
| `afterUpload`      | No       | Runs after a file is uploaded.               |
| `beforeDownload`   | Yes      | Runs before a file is downloaded. Throw to reject. |
| `beforeDelete`     | Yes      | Runs before a file is deleted. Throw to reject. |
| `afterDelete`      | No       | Runs after a file is deleted.                |
| `onMetadataUpdate` | No       | Runs when file metadata is updated.          |

```typescript
export default defineFunction({
  trigger: { type: 'storage', event: 'afterUpload' },
  handler: async ({ data, admin }) => {
    // data.after contains uploaded file metadata
    await admin.db('app').table('activity').insert({
      type: 'file_uploaded',
      fileKey: data.after?.key,
    });
  },
});
```

```typescript
import { defineFunction, FunctionError } from '@edge-base/shared';

export default defineFunction({
  trigger: { type: 'storage', event: 'beforeUpload' },
  handler: async ({ data }) => {
    const contentType = String(data?.after?.contentType ?? '');
    if (!contentType.startsWith('image/')) {
      throw new FunctionError('permission-denied', 'Only image uploads are allowed.');
    }
  },
});
```

## Function Bundling

Functions in `functions/` are automatically discovered and bundled during `npx edgebase deploy`. The CLI generates a lazy-import registry that loads each function on demand.
