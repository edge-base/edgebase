---
sidebar_position: 5
---

# Access Rules

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Define who can upload, download, and delete files in your storage buckets. Rules are TypeScript functions declared in `edgebase.config.ts` that return `true` (allow) or `false` (deny).

Rules are evaluated on every Client SDK request — Admin SDK and App Functions bypass rules entirely.

That storage bypass applies to all Admin SDKs.

## Quick Start

```typescript
// edgebase.config.ts
export default defineConfig({
  storage: {
    buckets: {
      photos: {
        access: {
          read(auth, file) {
            return true
          },
          write(auth, file) {
            return auth !== null
          },
          delete(auth, file) {
            return auth !== null && auth.id === file.uploadedBy
          },
        },
      },
    },
  },
});
```

Each rule function receives `auth` (the current user) and `file` (file metadata), and returns a boolean.

### Default Policy

| Rule | Result |
|------|--------|
| No access rules defined | All operations **denied** (403) |
| Returns `true` | Allow |
| Returns `false` | Deny |

:::tip Development Mode
When `release: false` (the default), operations on **configured** buckets are allowed even without rules — so you can start building immediately. Set `release: true` before production deployment to enforce deny-by-default.
:::

---

## Examples

### Public bucket — anyone can read, authenticated users upload

```typescript
avatars: {
  access: {
    read(auth, file) {
      return true
    },
    write(auth, file) {
      return auth !== null
    },
    delete(auth, file) {
      return auth !== null && auth.id === file.uploadedBy
    },
  },
},
```

### Private bucket — owner only

```typescript
documents: {
  access: {
    read(auth, file) {
      return auth !== null && auth.id === file.uploadedBy
    },
    write(auth, file) {
      return auth !== null
    },
    delete(auth, file) {
      return auth !== null && auth.id === file.uploadedBy
    },
  },
},
```

### Admin-managed bucket — admins can delete, users can upload

```typescript
uploads: {
  access: {
    read(auth, file) {
      return true
    },
    write(auth, file) {
      return auth !== null
    },
    delete(auth, file) {
      return auth !== null && auth.role === 'admin'
    },
  },
},
```

### Size-restricted uploads

```typescript
attachments: {
  access: {
    read(auth, file) {
      return auth !== null
    },
    write(auth, file) {
      return auth !== null && file.size <= 10 * 1024 * 1024  // 10 MB max
    },
    delete(auth, file) {
      return auth !== null && auth.id === file.uploadedBy
    },
  },
},
```

---

## Reference

### Operations

| Operation | When | `file` argument? |
|-----------|------|-----------------|
| `read` | Download, get metadata | Yes |
| `read` | List files | No — `file` is `{}` (empty object) |
| `write` | Upload (single or multipart), update metadata | Yes |
| `delete` | Delete a file | Yes |

:::note `file` argument availability
For **list** and **signed URL generation** operations, the `file` argument will be an empty object `{}` because no specific file is being accessed.

For the **`write`** rule, the `file` argument type depends on context: during an **upload**, it is a `WriteFileMeta` (containing the incoming file's metadata); during a **metadata update**, it is an `R2FileMeta` (containing the existing file's stored metadata).
:::

### Function Arguments

| Argument | Type | Description | Available in |
|----------|------|-------------|--------------|
| `auth` | `AuthContext \| null` | Current user (`null` if unauthenticated). Properties: `id`, `email`, `role`, `isAnonymous`, `custom`, `meta` | All operations |
| `file` | `R2FileMeta` / `WriteFileMeta` | File metadata (e.g., `file.uploadedBy`, `file.size`) | All operations |

### Null Safety

Since `auth` can be `null` (unauthenticated request), always check before accessing properties:

```typescript
// Good: null check before property access
read(auth, file) {
  return auth !== null && auth.id === file.uploadedBy
},

// Bad: will throw if auth is null
read(auth, file) {
  return auth.id === file.uploadedBy
},
```

### Multipart Upload Security

For [multipart uploads](/docs/storage/multipart), the `write` rule is re-evaluated on **every request** — create, upload-part, complete, and abort. The `uploadId` is not treated as a session token. This ensures that a revoked user cannot complete an in-progress upload.

### Service Key Bypass

Requests authenticated with a Service Key bypass all storage access rules:

```typescript
import { createAdminClient } from '@edgebase-fun/admin';

const admin = createAdminClient('https://api.example.com', {
  serviceKey: process.env.EDGEBASE_SERVICE_KEY,
});
// All storage operations bypass rules
```

See [Service Keys](/docs/server/service-keys) for configuration and scoped keys (`storage:bucket:photos:read`, `storage:bucket:*:write`, etc.).

---

:::info See Also
- [Access Rules Reference](/docs/server/access-rules) — Full reference for all access rules
- [Upload & Download](/docs/storage/upload-download) — File upload and download guide
- [Signed URLs](/docs/storage/signed-urls) — Time-limited pre-signed URLs
- [Service Keys](/docs/server/service-keys) — Server-side rule bypass
:::
