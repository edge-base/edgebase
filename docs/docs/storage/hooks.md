---
sidebar_position: 6
---

# Storage Hooks

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Hook into file lifecycle events to validate uploads, log activity, restrict downloads, or run post-processing workflows.

## Overview

Storage hooks are defined per-bucket in `edgebase.config.ts`. They receive **file metadata only** — file binary data is never passed to hooks due to the 128 MB Worker memory limit.

| Hook | Timing | Behavior | Can Modify | Can Reject |
|------|--------|----------|------------|------------|
| `beforeUpload` | Before R2 put | Blocking | Yes (return metadata) | Yes (throw) |
| `afterUpload` | After R2 put | Non-blocking (`waitUntil`) | No | No |
| `beforeDownload` | Before streaming response | Blocking | No | Yes (throw) |
| `beforeDelete` | Before R2 delete | Blocking | No | Yes (throw) |
| `afterDelete` | After R2 delete | Non-blocking (`waitUntil`) | No | No |
| `onMetadataUpdate` | After metadata PATCH | Non-blocking (`waitUntil`) | No | No |

Access rules always run **before** hooks. If a rule rejects the operation, hooks do not execute.

## Configuration

```typescript
// edgebase.config.ts
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  storage: {
    buckets: {
      avatars: {
        access: {
          read: () => true,
          write: (auth) => auth !== null,
          delete: (auth, file) => auth?.id === file.uploadedBy,
        },
        handlers: {
          hooks: {
            beforeUpload: async (auth, file, ctx) => { /* ... */ },
            afterUpload: async (auth, file, ctx) => { /* ... */ },
            beforeDownload: async (auth, file, ctx) => { /* ... */ },
            beforeDelete: async (auth, file, ctx) => { /* ... */ },
            afterDelete: async (auth, file, ctx) => { /* ... */ },
            onMetadataUpdate: async (auth, file, ctx) => { /* ... */ },
          },
        },
      },
    },
  },
});
```

## beforeUpload

Runs **before** a file is written to R2. Can validate file metadata, reject the upload, or return custom metadata to merge into the file's `customMetadata`.

```typescript
beforeUpload: async (auth, file, ctx) => {
  // Validate file type
  if (!file.contentType.startsWith('image/')) {
    throw new Error('Only images allowed in avatars bucket');
  }
  // Validate file size (max 5MB)
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('File too large (max 5MB)');
  }
  // Return custom metadata to merge into R2 customMetadata
  return { processedAt: new Date().toISOString(), uploadedByRole: auth?.role || 'anonymous' };
},
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `auth` | `AuthContext \| null` | Authenticated user, or `null` for unauthenticated |
| `file` | `WriteFileMeta` | Upload metadata: `key`, `size`, `contentType` |
| `ctx` | `StorageHookCtx` | Hook context |

**Return value:**
- Return `Record<string, string>` — merged into the file's `customMetadata`
- Return `void` — upload proceeds without extra metadata
- **Throw** — upload is rejected

## afterUpload

Runs **after** a file has been successfully written to R2. Non-blocking via `ctx.waitUntil()`.

```typescript
afterUpload: async (auth, file, ctx) => {
  // Notify user via push notification
  if (auth?.id) {
    ctx.waitUntil(
      ctx.push.send(auth.id, { title: 'Upload complete', body: `${file.key} uploaded` }),
    );
  }
},
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `auth` | `AuthContext \| null` | Authenticated user |
| `file` | `R2FileMeta` | Final R2 metadata including `etag`, `uploadedAt`, `customMetadata` |
| `ctx` | `StorageHookCtx` | Hook context |

## beforeDownload

Runs **before** the file is streamed to the client. Throw to reject the download.

```typescript
beforeDownload: async (auth, file, ctx) => {
  // Only allow file owner to download
  if (auth?.id !== file.uploadedBy) {
    throw new Error('You can only download your own files');
  }
},
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `auth` | `AuthContext \| null` | Authenticated user |
| `file` | `R2FileMeta` | File metadata from R2 |
| `ctx` | `StorageHookCtx` | Hook context |

**Return value:**
- **Throw** — download is rejected
- Return `void` — download proceeds

## beforeDelete

Runs **before** a file is deleted from R2. Throw to reject the deletion.

```typescript
beforeDelete: async (auth, file, ctx) => {
  // Prevent deletion of files with "protected" metadata
  if (file.customMetadata?.protected === 'true') {
    throw new Error('This file is protected and cannot be deleted');
  }
},
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `auth` | `AuthContext \| null` | Authenticated user |
| `file` | `R2FileMeta` | File metadata from R2 |
| `ctx` | `StorageHookCtx` | Hook context |

**Return value:**
- **Throw** — deletion is rejected
- Return `void` — deletion proceeds

## afterDelete

Runs **after** a file has been deleted from R2. Non-blocking via `ctx.waitUntil()`.

```typescript
afterDelete: async (auth, file, ctx) => {
  // Log deletion to external audit service
  ctx.waitUntil(
    fetch('https://audit.example.com/log', {
      method: 'POST',
      body: JSON.stringify({
        action: 'file_deleted',
        key: file.key,
        deletedBy: auth?.id,
        timestamp: new Date().toISOString(),
      }),
    }).catch(() => {}),
  );
},
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `auth` | `AuthContext \| null` | Authenticated user |
| `file` | `R2FileMeta` | Metadata of the deleted file |
| `ctx` | `StorageHookCtx` | Hook context |

## Hook Context

`StorageHookCtx` provides:

| Property | Type | Description |
|----------|------|-------------|
| `waitUntil(promise)` | `(p: Promise<unknown>) => void` | Keep the Worker alive for background work |
| `push.send(userId, payload)` | `(userId: string, payload: { title?: string; body: string }) => Promise<void>` | Send a push notification (best-effort) |

:::info No DB Access
Storage hooks run in the **Worker context** (not a Durable Object), so they don't have access to the database. Use `push.send()` for notifications or `waitUntil()` for external API calls.
:::

## onMetadataUpdate

Runs **after** file metadata has been updated via `PATCH /:bucket/:key/metadata`. Non-blocking via `ctx.waitUntil()`.

```typescript
onMetadataUpdate: async (auth, file, ctx) => {
  console.log(`Metadata updated for ${file.key} by ${auth?.id}`);
},
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `auth` | `AuthContext \| null` | Authenticated user |
| `file` | `R2FileMeta` | Updated file metadata |
| `ctx` | `StorageHookCtx` | Hook context |

## Batch Delete

When using batch delete (`POST /:bucket/delete-batch`), `beforeDelete` and `afterDelete` hooks are executed **per file** sequentially. If `beforeDelete` throws for a specific file, that file is skipped and reported in the `failed` array.

:::caution Presigned URL Uploads
Files uploaded via presigned URLs bypass the server entirely and do **not** trigger storage hooks. Only uploads through the standard upload endpoint trigger hooks.
:::

## Plugin Hooks vs Config Hooks

Storage supports two hook systems:

| System | Defined In | Context | DB Access |
|--------|-----------|---------|-----------|
| **Config-level hooks** | `edgebase.config.ts` under `storage.buckets[name].handlers.hooks` | `StorageHookCtx` (limited) | No |
| **Plugin-registered hooks** | App Functions with `trigger: { type: 'storage', event }` | `PluginStorageHookContext` (full) | Yes, via `admin` |

**Execution order:** Plugin blocking hooks execute **first**, then config-level hooks execute. If a plugin hook rejects the operation (throws), the config-level hook does not run.

Plugin hooks receive a richer context that includes `admin` (full database access), `pluginConfig`, `auth`, and `file` — making them suitable for cross-cutting concerns like audit logging or virus scanning that need to read/write data.

---

## TypeScript Types

Full type definitions for reference:

```typescript
interface WriteFileMeta {
  key: string;
  size: number;
  contentType: string;
}

interface R2FileMeta {
  key: string;
  size: number;
  contentType: string;
  etag: string;
  uploadedAt: string;       // ISO timestamp
  uploadedBy?: string;      // User ID (if authenticated)
  customMetadata?: Record<string, string>;
}

interface StorageHookCtx {
  waitUntil(promise: Promise<unknown>): void;
  push: {
    send(userId: string, payload: { title?: string; body: string }): Promise<void>;
  };
}

interface StorageHooks {
  beforeUpload?: (auth: AuthContext | null, file: WriteFileMeta, ctx: StorageHookCtx) =>
    Promise<Record<string, string> | void> | Record<string, string> | void;
  afterUpload?: (auth: AuthContext | null, file: R2FileMeta, ctx: StorageHookCtx) =>
    Promise<void> | void;
  beforeDownload?: (auth: AuthContext | null, file: R2FileMeta, ctx: StorageHookCtx) =>
    Promise<void> | void;
  beforeDelete?: (auth: AuthContext | null, file: R2FileMeta, ctx: StorageHookCtx) =>
    Promise<void> | void;
  afterDelete?: (auth: AuthContext | null, file: R2FileMeta, ctx: StorageHookCtx) =>
    Promise<void> | void;
  onMetadataUpdate?: (auth: AuthContext | null, file: R2FileMeta, ctx: StorageHookCtx) =>
    Promise<void> | void;
}
