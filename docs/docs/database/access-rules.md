---
sidebar_position: 7
---

# Access Rules

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Define who can read, create, update, and delete your data. Rules are TypeScript functions that return `true` (allow) or `false` (deny).

Rules are evaluated on every Client SDK request — Admin SDK and App Functions bypass rules entirely.

Admin rule bypass applies to all Admin SDKs.

## Quick Start

```typescript
// edgebase.config.ts
export default defineConfig({
  databases: {
    app: {
      tables: {
        posts: {
          schema: {
            title: { type: 'text' },
            body: { type: 'text' },
            authorId: { type: 'text' },
          },
          access: {
            read(auth, row) {
              return true
            },
            insert(auth) {
              return auth !== null
            },
            update(auth, row) {
              return auth !== null && auth.id === row.authorId
            },
            delete(auth, row) {
              return auth !== null && auth.id === row.authorId
            },
          },
        },
      },
    },
  },
});
```

Each rule function receives `auth` (the current user) and optionally `row` (the target record), and returns a boolean. Rule functions can also be `async` and return `Promise<boolean>` for cases that require asynchronous checks.

### Default Policy

| Rule | Result |
|------|--------|
| No access rules defined | All operations **denied** (403) |
| Returns `true` | Allow |
| Returns `false` | Deny |

:::tip Development Mode
When `release: false` (the default), operations on **configured** tables are allowed even without rules — so you can start building immediately. Set `release: true` before production deployment to enforce deny-by-default.

```typescript
export default defineConfig({
  release: true,   // Enforce deny-by-default
  databases: { app: { tables: { /* ... */ } } },
});
```
:::

---

## Examples

### Blog — public read, only the author can edit/delete

```typescript
// Anyone can read posts, only logged-in users can create,
// and only the original author can update or delete their own posts.
posts: {
  schema: {
    title: { type: 'text' },
    body: { type: 'text' },
    authorId: { type: 'text' },
  },
  access: {
    read(auth, row) {
      return true
    },
    insert(auth) {
      return auth !== null
    },
    update(auth, row) {
      return auth !== null && auth.id === row.authorId
    },
    delete(auth, row) {
      return auth !== null && auth.id === row.authorId
    },
  },
},
```

### Comments — author or admin can delete

```typescript
// Anyone can read comments, logged-in users can post,
// but only the comment author or an admin can delete.
comments: {
  schema: {
    text: { type: 'text' },
    authorId: { type: 'text' },
    postId: { type: 'text' },
  },
  access: {
    read(auth, row) {
      return true
    },
    insert(auth) {
      return auth !== null
    },
    update(auth, row) {
      return auth !== null && auth.id === row.authorId
    },
    delete(auth, row) {
      return auth !== null && (auth.id === row.authorId || auth.role === 'admin')
    },
  },
},
```

### Private notes — owner only

```typescript
// Only the owner can see, create, edit, and delete their own notes.
notes: {
  schema: {
    content: { type: 'text' },
    ownerId: { type: 'text' },
  },
  access: {
    read(auth, row) {
      return auth !== null && auth.id === row.ownerId
    },
    insert(auth) {
      return auth !== null
    },
    update(auth, row) {
      return auth !== null && auth.id === row.ownerId
    },
    delete(auth, row) {
      return auth !== null && auth.id === row.ownerId
    },
  },
},
```

### Role-based — admin and editor

```typescript
// Anyone can read. Only admins and editors can create/update.
// Only admins can delete.
articles: {
  schema: {
    title: { type: 'text' },
    content: { type: 'text' },
    category: { type: 'text' },
  },
  access: {
    read(auth, row) {
      return true
    },
    insert(auth) {
      return auth !== null && ['admin', 'editor'].includes(auth.role)
    },
    update(auth, row) {
      return auth !== null && ['admin', 'editor'].includes(auth.role)
    },
    delete(auth, row) {
      return auth !== null && auth.role === 'admin'
    },
  },
},
```

### Subscription-based — using custom claims

```typescript
// Only pro and enterprise users can read premium content.
// Only paid users can create. Author can edit/delete their own.
premium_content: {
  schema: {
    title: { type: 'text' },
    body: { type: 'text' },
    authorId: { type: 'text' },
  },
  access: {
    read(auth, row) {
      return auth !== null && ['pro', 'enterprise'].includes(auth.custom.plan)
    },
    insert(auth) {
      return auth !== null && auth.custom.plan !== 'free'
    },
    update(auth, row) {
      return auth !== null && auth.id === row.authorId
    },
    delete(auth, row) {
      return auth !== null && auth.id === row.authorId
    },
  },
},
```

---

## Reference

### Operations

| Operation | When | `row` argument? |
|-----------|------|-----------------|
| `read` | Query or get records | Yes (per-row validation) |
| `insert` | Insert a new record | No |
| `update` | Update an existing record | Yes (current record) |
| `delete` | Delete a record | Yes (current record) |

**Write operations** (`insert`, `update`, `delete`) are evaluated **before** the operation. If the rule returns `false`, the request is rejected with 403.

**Read operations** (`read`) with `row`-based rules are evaluated **after** retrieval — every returned row is checked. If **any** row fails the rule, the entire request is rejected with 403 Forbidden.

### Function Arguments

| Argument | Type | Description | Available in |
|----------|------|-------------|--------------|
| `auth` | `AuthContext \| null` | Current user (`null` if unauthenticated). Properties: `id`, `email`, `role`, `isAnonymous`, `custom`, `memberships`, `meta` | All operations |
| `row` | `Record<string, unknown>` | The target record being accessed | `read`, `update`, `delete` |

:::tip Native TypeScript
Since rules are plain TypeScript functions, all JavaScript operators (`===`, `!==`, `&&`, `||`, `!`, ternary, `includes()`, etc.) are available — no custom DSL needed.
:::

### Null Safety

Since `auth` can be `null` (unauthenticated request), always check before accessing properties:

```typescript
// Good: null check before property access
read(auth, row) {
  return auth !== null && auth.id === row.authorId
},

// Bad: will throw if auth is null
read(auth, row) {
  return auth.id === row.authorId
},
```

### DB Block Access Rules

Beyond per-table rules, you can control access at the **DB block level** — who can create or access a Durable Object instance:

- **Single-instance blocks** such as `app`, `catalog`, or `public` — the block name is arbitrary; use table rules to control access
- **`user:{id}`** block — `id` is extracted from the JWT `sub` claim only (cannot be injected by the client)
- **`workspace:{id}`** / `tenant:{id}` — the client specifies the ID explicitly via `client.db('workspace', 'ws-456')`

Use `canCreate` and `access` rules in the DB block config to control who can create new DO instances and who can access existing ones.

### Read Rule Enforcement (All-or-Nothing)

For `read` operations with `row`-based rules, the server evaluates the rule against **every** returned row. If **any** row fails the rule, the entire request is rejected with **403 Forbidden** — the response includes the ID of the first failing row.

This is an all-or-nothing approach, not a filtering approach:

- The server does **not** silently filter out unauthorized rows
- Either all rows pass the read rule and are returned, or the request fails entirely
- Design your queries so that the requesting user has access to all matching rows

:::tip
If you need to scope queries to only accessible rows, add explicit filters in the client query (e.g., `.where('ownerId', '==', userId)`) rather than relying on the read rule to filter results.
:::

### Service Key Bypass

Requests authenticated with a Service Key bypass all access rules. This is designed for server-to-server communication:

```typescript
import { createAdminClient } from '@edge-base/admin';

const admin = createAdminClient('https://api.example.com', {
  serviceKey: process.env.EDGEBASE_SERVICE_KEY,  // Server-side only!
});
// All operations bypass rules
```

See [Service Keys](/docs/server/service-keys) for configuration and scoped keys.

---

:::info See Also
- [Access Rules Reference](/docs/server/access-rules) — Full reference including Storage Rules
- [Security Model](/docs/architecture/security-model) — Architecture-level security overview
- [Service Keys](/docs/server/service-keys) — Server-side rule bypass
:::
