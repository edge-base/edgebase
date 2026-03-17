---
sidebar_position: 2
---

# Access Rules

EdgeBase uses `access` functions to control product surfaces that accept client input.

## Overview

| Feature | Operations | Config Location |
| --- | --- | --- |
| Database table | `read`, `insert`, `update`, `delete` | `databases[ns].tables[name].access` |
| Database block | `canCreate`, `access` | `databases[ns].access` |
| Storage bucket | `read`, `write`, `delete` | `storage.buckets[name].access` |
| Room | `metadata`, `join`, `action` | `rooms[namespace].access` |
| Push | `send` | `push.access` |
| Authentication action | `signUp`, `signIn`, `refresh`, `signOut`, ... | `auth.access` |
| KV | `read`, `write` | `kv[namespace].rules` |

Use [`auth.handlers.hooks.enrich`](/docs/server/enrich-auth) when access checks need request-scoped metadata.

## Table Access

```typescript
export default defineConfig({
  databases: {
    app: {
      tables: {
        posts: {
          access: {
            read: () => true,
            insert: (auth) => auth !== null,
            update: (auth, row) => auth?.id === row.authorId,
            delete: (auth, row) => auth?.role === 'admin',
          },
        },
      },
    },
  },
});
```

## Storage Access

```typescript
export default defineConfig({
  storage: {
    buckets: {
      photos: {
        access: {
          read: () => true,
          write: (auth) => auth !== null,
          delete: (auth, file) => auth?.id === file.uploadedBy,
        },
      },
    },
  },
});
```

## Default Behavior

- `release: false`
  - configured resources are open during development unless the feature overrides this
- `release: true`
  - missing `access` means deny-by-default
- rooms are stricter:
  - in release mode, `metadata`, `join`, and `action` are denied unless you configure `access` or opt into `public.*`

## Service Keys

Server-side service keys bypass access checks for trusted backend operations.

That bypass is exposed across all Admin SDKs.

```typescript
const admin = createAdminClient(process.env.EDGEBASE_URL!, {
  serviceKey: process.env.EDGEBASE_SERVICE_KEY!,
});
```

## Notes

- Access functions receive `auth` as `AuthContext | null`.
- Row/file arguments are only available on operations that target an existing entity.
- Throwing from `access` is treated as rejection.

## See Also

- [Authentication Context Hook](/docs/server/enrich-auth)
- [Database Access Rules](/docs/database/access-rules)
- [Authentication Access Rules](/docs/authentication/access-rules)
- [Storage Access Rules](/docs/storage/access-rules)
- [Room Access Rules](/docs/room/access-rules)
