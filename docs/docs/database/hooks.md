---
sidebar_position: 9
---

# Table Hooks

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Define inline hooks on tables to intercept CRUD operations and enrich query results.

## Overview

Table hooks are defined directly in your table configuration. They run inside the active database backend for that block with full access to the `HookCtx`.

When `auth` is `null` because the request came from a Service Key, that includes all Admin SDKs.

| Hook | Timing | Behavior | Can Modify | Can Reject |
|------|--------|----------|------------|------------|
| `beforeInsert` | Before record creation | Blocking | Yes (return data) | Yes (throw) |
| `afterInsert` | After record creation | Non-blocking (`waitUntil`) | No | No |
| `beforeUpdate` | Before record update | Blocking | Yes (return data) | Yes (throw) |
| `afterUpdate` | After record update | Non-blocking (`waitUntil`) | No | No |
| `beforeDelete` | Before record deletion | Blocking | No | Yes (throw) |
| `afterDelete` | After record deletion | Non-blocking (`waitUntil`) | No | No |
| `onEnrich` | After GET/LIST/SEARCH, before response | Blocking (per-record) | Yes (return record) | No |

Access rules always run **before** hooks. If a rule rejects the operation, hooks do not execute.

Non-blocking hooks are fire-and-forget — if they throw, the error is logged but the API response is unaffected.

## Configuration

```typescript
// edgebase.config.ts
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  databases: {
    app: {
      tables: {
        posts: {
          schema: {
            title: { type: 'text' },
            body: { type: 'text' },
            authorId: { type: 'text' },
            likesCount: { type: 'number', default: 0 },
          },
          handlers: {
            hooks: {
              beforeInsert: async (auth, data, ctx) => { /* ... */ },
              afterInsert: async (data, ctx) => { /* ... */ },
              beforeUpdate: async (auth, before, data, ctx) => { /* ... */ },
              afterUpdate: async (before, after, ctx) => { /* ... */ },
              beforeDelete: async (auth, data, ctx) => { /* ... */ },
              afterDelete: async (data, ctx) => { /* ... */ },
              onEnrich: async (auth, record, ctx) => { /* ... */ },
            },
          },
        },
      },
    },
  },
});
```

## beforeInsert

Runs **before** a new record is created. Can validate, transform, or reject the insert.

```typescript
beforeInsert: async (auth, data, ctx) => {
  // Auto-set author
  if (auth?.id) {
    data.authorId = auth.id;
  }

  // Validate required fields
  if (!data.title || (data.title as string).length < 3) {
    throw new Error('Title must be at least 3 characters');
  }

  // Return modified data (shallow-merged with original)
  return { ...data, authorId: auth?.id, status: 'draft' };
},
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `auth` | `AuthContext \| null` | Authenticated user, or `null` for unauthenticated / service key |
| `data` | `Record<string, unknown>` | The insert data from the client request body |
| `ctx` | `HookCtx` | Hook context with DB, database subscriptions, push, waitUntil |

**Return value:**
- Return `Record<string, unknown>` — replaces the insert data
- Return `void` — use original data unchanged
- **Throw** — reject the insert (error message returned to client)

## afterInsert

Runs **after** a record has been created. Non-blocking via `ctx.waitUntil()`. Receives the **final saved record** (with generated `id`, timestamps, etc.).

```typescript
afterInsert: async (data, ctx) => {
  // Broadcast new post to database-live subscribers
  await ctx.databaseLive.broadcast('posts', 'new_post', {
    id: data.id,
    title: data.title,
  });

  // Send push notification to followers
  if (data.authorId) {
    ctx.waitUntil(
      ctx.push.send(data.authorId as string, {
        title: 'Post published',
        body: `Your post "${data.title}" is now live`,
      }),
    );
  }
},
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `Record<string, unknown>` | The saved record (with `id`, `createdAt`, `updatedAt`) |
| `ctx` | `HookCtx` | Hook context |

:::info No auth parameter
`afterInsert` does not receive `auth` because it runs as a fire-and-forget side effect. If you need user info, include it in the record data via `beforeInsert`.
:::

## beforeUpdate

Runs **before** a record is updated. Receives both the **existing record** and the **incoming changes** (partial patch). Can validate, transform, or reject the update.

```typescript
beforeUpdate: async (auth, before, data, ctx) => {
  // Prevent changing the author
  if (data.authorId && data.authorId !== before.authorId) {
    throw new Error('Cannot change the author of a post');
  }

  // Auto-set updatedBy
  return { ...data, updatedBy: auth?.id };
},
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `auth` | `AuthContext \| null` | Authenticated user |
| `before` | `Record<string, unknown>` | The **existing record** before the update |
| `data` | `Record<string, unknown>` | The **incoming changes** (partial patch from the request body) |
| `ctx` | `HookCtx` | Hook context |

**Return value:**
- Return `Record<string, unknown>` — replaces the changes (patch)
- Return `void` — use original changes unchanged
- **Throw** — reject the update

:::tip `before` vs `data`
`before` is the full existing record. `data` is only the fields being changed (a partial patch). For example, if a record has `{ title: 'Old', body: 'Hello', authorId: 'u1' }` and the client sends `PATCH { title: 'New' }`, then `before = { title: 'Old', body: 'Hello', authorId: 'u1' }` and `data = { title: 'New' }`.
:::

## afterUpdate

Runs **after** a record has been updated. Non-blocking. Receives both the **before** and **after** snapshots.

```typescript
afterUpdate: async (before, after, ctx) => {
  // Log changes
  const changes = Object.keys(after).filter(k => before[k] !== after[k]);
  console.log(`Record ${after.id} updated fields: ${changes.join(', ')}`);

  // Broadcast update to database-live subscribers
  await ctx.databaseLive.broadcast('posts', 'post_updated', { id: after.id });
},
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `before` | `Record<string, unknown>` | The record **before** the update |
| `after` | `Record<string, unknown>` | The record **after** the update (full record) |
| `ctx` | `HookCtx` | Hook context |

## beforeDelete

Runs **before** a record is deleted. Receives the **existing record**. Throw to reject the deletion.

```typescript
beforeDelete: async (auth, data, ctx) => {
  // Prevent deletion of records with dependencies
  const hasComments = await ctx.db.exists('comments', { postId: data.id as string });
  if (hasComments) {
    throw new Error('Cannot delete a post with comments. Delete comments first.');
  }
},
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `auth` | `AuthContext \| null` | Authenticated user |
| `data` | `Record<string, unknown>` | The **existing record** about to be deleted |
| `ctx` | `HookCtx` | Hook context |

**Return value:**
- **Throw** — reject the deletion
- Return `void` — deletion proceeds

## afterDelete

Runs **after** a record has been deleted. Non-blocking. Receives the deleted record data.

```typescript
afterDelete: async (data, ctx) => {
  // Cascade delete: remove related comments
  const comments = await ctx.db.list('comments', { postId: data.id as string });
  for (const comment of comments) {
    // Use waitUntil for best-effort cleanup
    console.log(`Orphaned comment ${comment.id} — consider cleanup`);
  }

  // Broadcast deletion to database-live subscribers
  await ctx.databaseLive.broadcast('posts', 'post_deleted', { id: data.id });
},
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | `Record<string, unknown>` | The deleted record data |
| `ctx` | `HookCtx` | Hook context |

## onEnrich

The `onEnrich` hook runs on every record returned by **GET**, **LIST**, and **SEARCH** operations. Use it to:

- **Add computed fields** — e.g., `isOwner`, `fullName`, relative timestamps
- **Mask sensitive fields** — e.g., hide `email` from non-admin users
- **Resolve references** — e.g., fetch related data inline

```typescript
hooks: {
  onEnrich: async (auth, record, ctx) => {
    // Add computed ownership field
    const isOwner = auth?.id === record.authorId;
    return { ...record, isOwner, canEdit: isOwner };
  },
},
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `auth` | `AuthContext \| null` | Authenticated user making the request |
| `record` | `Record<string, unknown>` | The record being returned |
| `ctx` | `HookCtx` | Hook context (can query other tables) |

**Return value:**
- Return `Record<string, unknown>` — replaces the record in the response
- Return `void` — use original record unchanged

### More Examples

**Mask sensitive data:**

```typescript
onEnrich: async (auth, record, ctx) => {
  if (auth?.role !== 'admin') {
    const { email, phone, ...rest } = record;
    return { ...rest, email: '***', phone: '***' };
  }
  return record;
},
```

**Resolve references:**

```typescript
onEnrich: async (auth, record, ctx) => {
  if (record.authorId) {
    const author = await ctx.db.get('users', record.authorId as string);
    return { ...record, authorName: author?.displayName || 'Unknown' };
  }
  return record;
},
```

### Performance Notes

- `onEnrich` runs **per record** — for LIST/SEARCH, all records are enriched in parallel via `Promise.all()`
- Keep hook logic fast to avoid slowing down read operations
- If the hook throws, the **original record** is returned unchanged (fail-safe)
- Computed fields added by `onEnrich` are not stored in the database

## Hook Context

`HookCtx` provides full access to the Database DO's capabilities:

| Property | Type | Description |
|----------|------|-------------|
| `db.get(table, id)` | `(table: string, id: string) => Promise<Record \| null>` | Read a record from any table in this DO |
| `db.list(table, filter?)` | `(table: string, filter?: Record) => Promise<Array<Record>>` | List records from any table in this DO |
| `db.exists(table, filter)` | `(table: string, filter: Record) => Promise<boolean>` | Check if a matching record exists |
| `databaseLive.broadcast(channel, event, payload)` | `(...) => Promise<void>` | Send a database subscription event to subscribers |
| `push.send(userId, payload)` | `(userId: string, payload: {...}) => Promise<void>` | Send a push notification (best-effort) |
| `waitUntil(promise)` | `(p: Promise<unknown>) => void` | Keep the DO alive for background work |

---

## TypeScript Types

Full type definitions for reference:

```typescript
interface AuthContext {
  id: string;
  role?: string;
  isAnonymous?: boolean;
  email?: string;
  custom?: Record<string, unknown>;
}

interface HookCtx {
  db: {
    get(table: string, id: string): Promise<Record<string, unknown> | null>;
    list(table: string, filter?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
    exists(table: string, filter: Record<string, unknown>): Promise<boolean>;
  };
  databaseLive: {
    broadcast(channel: string, event: string, data: unknown): Promise<void>;
  };
  push: {
    send(userId: string, payload: { title?: string; body: string }): Promise<void>;
  };
  waitUntil(promise: Promise<unknown>): void;
}

interface TableHooks {
  beforeInsert?: (auth: AuthContext | null, data: Record<string, unknown>, ctx: HookCtx) =>
    Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  afterInsert?: (data: Record<string, unknown>, ctx: HookCtx) =>
    Promise<void> | void;
  beforeUpdate?: (auth: AuthContext | null, before: Record<string, unknown>, data: Record<string, unknown>, ctx: HookCtx) =>
    Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  afterUpdate?: (before: Record<string, unknown>, after: Record<string, unknown>, ctx: HookCtx) =>
    Promise<void> | void;
  beforeDelete?: (auth: AuthContext | null, data: Record<string, unknown>, ctx: HookCtx) =>
    Promise<void> | void;
  afterDelete?: (data: Record<string, unknown>, ctx: HookCtx) =>
    Promise<void> | void;
  onEnrich?: (auth: AuthContext | null, record: Record<string, unknown>, ctx: HookCtx) =>
    Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
}
