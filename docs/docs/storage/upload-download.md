---
sidebar_position: 1
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Upload & Download

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

R2-based file storage with $0 egress cost.

## How Storage Works

EdgeBase storage is built on Cloudflare R2. Files are organized into **buckets** — each bucket has its own access rules for read, write, and delete.

```
storage/
├── avatars/              ← bucket (public read, auth write)
│   ├── user-1.jpg
│   └── user-2.jpg
├── documents/            ← bucket (auth read/write, admin delete)
│   ├── report-q1.pdf
│   └── invoice-2024.pdf
└── uploads/              ← bucket (auth write, signed URL download)
    └── large-file.zip
```

Buckets are declared in `edgebase.config.ts`:

```typescript
storage: {
  buckets: {
    avatars: {
      access: {
        read: () => true,                             // Anyone can view
        write: (auth) => auth !== null,               // Must be logged in to upload
        delete: (auth, file) => auth?.id === file.uploadedBy,  // Only uploader can delete
      },
    },
  },
}
```

Each file has a **key** (its path within the bucket, e.g. `user-1.jpg`) and auto-tracked metadata including size, content type, upload timestamp, and who uploaded it.

---

## Upload

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const bucket = client.storage.bucket('avatars');

await bucket.upload('user-1.jpg', file, {
  contentType: 'image/jpeg',
  customMetadata: { userId: 'user-1' },
  onProgress: (progress) => console.log(`${progress.percent}%`),
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final bucket = client.storage.bucket('avatars');

await bucket.upload(
  'user-1.jpg',
  fileBytes,
  contentType: 'image/jpeg',
  onProgress: (sent, total) => print('$sent / $total'),
);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let bucket = client.storage.bucket("avatars")

try await bucket.upload(
  "user-1.jpg",
  data: imageData,
  contentType: "image/jpeg"
)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val bucket = client.storage.bucket("avatars")

bucket.upload(
    "user-1.jpg",
    fileBytes,
    contentType = "image/jpeg"
)
```

</TabItem>

<TabItem value="java" label="Java">

```java
StorageBucket bucket = client.storage().bucket("avatars");

bucket.upload("user-1.jpg", fileBytes, "image/jpeg");
```

</TabItem>
<TabItem value="python" label="Python">

```python
bucket = client.storage.bucket('avatars')

bucket.upload(
    'user-1.jpg',
    file_bytes,
    content_type='image/jpeg',
)
```

</TabItem>
<TabItem value="go" label="Go">

```go
import "context"

ctx := context.Background()
bucket := admin.Storage().Bucket("avatars")

result, err := bucket.Upload(ctx, "user-1.jpg", fileData, "image/jpeg")
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$bucket = $client->storage->bucket('avatars');

$result = $bucket->upload('user-1.jpg', $fileData, 'image/jpeg');
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let bucket = client.storage().bucket("avatars");

let result = bucket.upload("user-1.jpg", &file_data, "image/jpeg").await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var bucket = admin.Storage.Bucket("avatars");

var result = await bucket.UploadAsync("user-1.jpg", fileBytes, "image/jpeg");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto bucket = client.storage().bucket("avatars");

auto result = bucket.upload("user-1.jpg", data, "image/jpeg");
```

</TabItem>
</Tabs>

:::tip Auto-detected Content Type
When `contentType` is omitted, the SDK auto-detects it from the file extension (e.g. `.jpg` → `image/jpeg`, `.pdf` → `application/pdf`). For `File` objects, the browser-provided MIME type is used first. You only need to specify `contentType` explicitly when using an uncommon extension or when the auto-detected type is wrong.
:::

### Cancel Upload

All upload methods (including `uploadString`) return an `UploadTask` — a `Promise<FileInfo>` with a `.cancel()` method. Calling `.cancel()` immediately aborts the underlying HTTP request, and the promise rejects with an `AbortError`:

```typescript
const task = bucket.upload('video.mp4', largeFile, {
  onProgress: (p) => progressBar.style.width = `${p.percent}%`,
});

// Cancel from a button click
cancelButton.onclick = () => task.cancel();

try {
  const result = await task;
} catch (err) {
  if (err.name === 'AbortError') {
    console.log('Upload cancelled');
  }
}
```

### Upload from String

Upload string data with format conversion:

```typescript
// Raw text
await bucket.uploadString('readme.txt', 'Hello, world!', 'raw', {
  contentType: 'text/plain',
});

// Base64
await bucket.uploadString('image.png', base64Data, 'base64', {
  contentType: 'image/png',
});

// Base64 URL-safe
await bucket.uploadString('file.bin', urlSafeBase64, 'base64url');

// Data URL (content type auto-detected from header)
await bucket.uploadString('photo.jpg', 'data:image/jpeg;base64,/9j/4AAQ...', 'data_url');
```

| Format | Description |
|--------|-------------|
| `'raw'` | Plain text (default content type: `text/plain`) |
| `'base64'` | Standard Base64 encoded binary |
| `'base64url'` | URL-safe Base64 (`-` and `_` instead of `+` and `/`) |
| `'data_url'` | Data URL with MIME header (e.g. `data:image/png;base64,...`) |

`uploadString` returns an `UploadTask` (same as `upload()`), so you can use `.cancel()` and `onProgress` with string uploads as well.

### Upload Response

All upload methods return a `FileInfo` object:

```typescript
interface FileInfo {
  key: string;              // e.g. 'user-1.jpg'
  size: number;             // File size in bytes
  contentType: string;      // MIME type
  etag: string;             // R2 ETag
  uploadedAt: string;       // ISO 8601 timestamp
  uploadedBy: string | null; // Auth user ID (auto-set)
  customMetadata: Record<string, string>;
}
```

## Download

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const bucket = client.storage.bucket('avatars');

// Get public URL (synchronous — no network call)
const url = bucket.getUrl('user-1.jpg');

// Download as Blob (default)
const blob = await bucket.download('user-1.jpg');

// Download as text
const text = await bucket.download('readme.txt', { as: 'text' });

// Download as ArrayBuffer
const buffer = await bucket.download('data.bin', { as: 'arraybuffer' });

// Download as ReadableStream
const stream = await bucket.download('large.zip', { as: 'stream' });
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final bucket = client.storage.bucket('avatars');

final url = bucket.getUrl('user-1.jpg');
final bytes = await bucket.download('user-1.jpg');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let bucket = client.storage.bucket("avatars")

let url = bucket.getUrl("user-1.jpg")
let data = try await bucket.download("user-1.jpg")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val bucket = client.storage.bucket("avatars")

val url = bucket.getUrl("user-1.jpg")
val bytes = bucket.download("user-1.jpg")
```

</TabItem>

<TabItem value="java" label="Java">

```java
StorageBucket bucket = client.storage().bucket("avatars");

String url = bucket.getUrl("user-1.jpg");
byte[] bytes = bucket.download("user-1.jpg");
```

</TabItem>
<TabItem value="python" label="Python">

```python
bucket = client.storage.bucket('avatars')

url = bucket.get_url('user-1.jpg')
data = bucket.download('user-1.jpg')
```

</TabItem>
<TabItem value="go" label="Go">

```go
import "context"

ctx := context.Background()
bucket := admin.Storage().Bucket("avatars")

url := bucket.GetURL("user-1.jpg")
data, err := bucket.Download(ctx, "user-1.jpg")
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$bucket = $client->storage->bucket('avatars');

$url = $bucket->getUrl('user-1.jpg');
$data = $bucket->download('user-1.jpg');
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let bucket = client.storage().bucket("avatars");

let url = bucket.get_url("user-1.jpg");
let data = bucket.download("user-1.jpg").await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var bucket = admin.Storage.Bucket("avatars");

string url = bucket.GetUrl("user-1.jpg");
byte[] data = await bucket.DownloadAsync("user-1.jpg");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto bucket = client.storage().bucket("avatars");

std::string url = bucket.getUrl("user-1.jpg");
auto result = bucket.download("user-1.jpg");
```

</TabItem>
</Tabs>

### Download Formats (JavaScript)

| Format | Return Type | Use Case |
|--------|------------|----------|
| `'blob'` (default) | `Blob` | Images, files for `<img>` or `URL.createObjectURL()` |
| `'text'` | `string` | Text files, JSON, config files |
| `'arraybuffer'` | `ArrayBuffer` | Binary processing, crypto operations |
| `'stream'` | `ReadableStream` | Large files, progressive processing |

:::info
`getUrl()` is **synchronous** — it builds the URL locally without a network call. Use `createSignedUrl()` if the bucket requires authentication for reads.
:::

## Check File Exists

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const bucket = client.storage.bucket('avatars');

const exists = await bucket.exists('user-1.jpg');
if (!exists) {
  // Upload default avatar
}
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final bucket = client.storage.bucket('avatars');

final exists = await bucket.exists('user-1.jpg');
if (!exists) {
  // Upload default avatar
}
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let bucket = client.storage.bucket("avatars")

let exists = try await bucket.exists("user-1.jpg")
if !exists {
    // Upload default avatar
}
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val bucket = client.storage.bucket("avatars")

val exists = bucket.exists("user-1.jpg")
if (!exists) {
    // Upload default avatar
}
```

</TabItem>
<TabItem value="java" label="Java">

```java
StorageBucket bucket = client.storage().bucket("avatars");

boolean exists = bucket.exists("user-1.jpg");
if (!exists) {
    // Upload default avatar
}
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var bucket = client.Storage.Bucket("avatars");

var exists = await bucket.ExistsAsync("user-1.jpg");
if (!exists) {
    // Upload default avatar
}
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto bucket = client.storage().bucket("avatars");

auto exists = bucket.exists("user-1.jpg");
if (!exists) {
  // Upload default avatar
}
```

</TabItem>
</Tabs>

## Delete

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const bucket = client.storage.bucket('avatars');

// Single file
await bucket.delete('old-avatar.jpg');

// Multiple files
const result = await bucket.deleteMany([
  'old-avatar-1.jpg',
  'old-avatar-2.jpg',
  'old-avatar-3.jpg',
]);
// result.deleted: ['old-avatar-1.jpg', 'old-avatar-3.jpg']
// result.failed: [{ key: 'old-avatar-2.jpg', error: 'File not found.' }]
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final bucket = client.storage.bucket('avatars');

await bucket.delete('old-avatar.jpg');

final result = await bucket.deleteMany([
  'old-avatar-1.jpg',
  'old-avatar-2.jpg',
  'old-avatar-3.jpg',
]);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let bucket = client.storage.bucket("avatars")

try await bucket.delete("old-avatar.jpg")

let result = try await bucket.deleteMany([
  "old-avatar-1.jpg",
  "old-avatar-2.jpg",
  "old-avatar-3.jpg",
])
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val bucket = client.storage.bucket("avatars")

bucket.delete("old-avatar.jpg")

val result = bucket.deleteMany(listOf(
    "old-avatar-1.jpg",
    "old-avatar-2.jpg",
    "old-avatar-3.jpg"
))
```

</TabItem>
<TabItem value="java" label="Java">

```java
StorageBucket bucket = client.storage().bucket("avatars");

bucket.delete("old-avatar.jpg");

DeleteManyResult result = bucket.deleteMany(List.of(
    "old-avatar-1.jpg",
    "old-avatar-2.jpg",
    "old-avatar-3.jpg"
));
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var bucket = client.Storage.Bucket("avatars");

await bucket.DeleteAsync("old-avatar.jpg");

var result = await bucket.DeleteManyAsync(new[] {
    "old-avatar-1.jpg",
    "old-avatar-2.jpg",
    "old-avatar-3.jpg",
});
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto bucket = client.storage().bucket("avatars");

bucket.delete_file("old-avatar.jpg");

auto result = bucket.delete_many({
    "old-avatar-1.jpg",
    "old-avatar-2.jpg",
    "old-avatar-3.jpg"
});
```

</TabItem>
</Tabs>

## List Files

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const bucket = client.storage.bucket('avatars');

const result = await bucket.list({
  prefix: 'users/',
  limit: 50,
});
// result.files: FileInfo[]
// result.cursor: string | null
// result.truncated: boolean
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final bucket = client.storage.bucket('avatars');

final result = await bucket.list(
  prefix: 'users/',
  limit: 50,
);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let bucket = client.storage.bucket("avatars")

let result = try await bucket.list(
  prefix: "users/",
  limit: 50
)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val bucket = client.storage.bucket("avatars")

val result = bucket.list(
    prefix = "users/",
    limit = 50
)
```

</TabItem>
<TabItem value="java" label="Java">

```java
StorageBucket bucket = client.storage().bucket("avatars");

ListResult result = bucket.list("users/", 50, null);
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var bucket = client.Storage.Bucket("avatars");

var result = await bucket.ListAsync(prefix: "users/", limit: 50);
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto bucket = client.storage().bucket("avatars");

auto result = bucket.list("users/", 50);
```

</TabItem>
</Tabs>

### Pagination

Use `cursor` to load the next page:

```typescript
let cursor: string | null = null;
const allFiles: FileInfo[] = [];

do {
  const result = await bucket.list({
    prefix: 'photos/',
    limit: 100,
    cursor: cursor ?? undefined,
  });
  allFiles.push(...result.files);
  cursor = result.cursor;
} while (cursor);
```

:::info
Maximum `limit` is 1000 per request. Default is 100.
:::

## Bucket Access Rules

```typescript
// edgebase.config.ts
storage: {
  buckets: {
    avatars: {
      access: {
        read() { return true },
        write(auth, file) {
          return auth !== null &&
            file.size <= 5 * 1024 * 1024 &&
            ['image/jpeg', 'image/png', 'image/webp'].includes(file.contentType);
        },
        delete(auth, file) { return auth !== null && auth.id === file.uploadedBy },
      },
    },
  },
}
```

### `file` Object Properties

The `file` parameter in access rules has different properties depending on the action:

**`write` rule** — receives `WriteFileMeta` (from form data, before upload):

| Property | Type | Description |
|----------|------|-------------|
| `size` | `number` | File size in bytes |
| `contentType` | `string` | MIME type |
| `key` | `string` | Requested file path |

**`read` / `delete` rules** — receive `R2FileMeta` (from stored file):

| Property | Type | Description |
|----------|------|-------------|
| `size` | `number` | File size in bytes |
| `contentType` | `string` | MIME type |
| `key` | `string` | File path |
| `uploadedBy` | `string?` | ID of the user who uploaded the file |
| `customMetadata` | `Record<string, string>?` | Custom key-value metadata |
| `etag` | `string?` | R2 ETag |
| `uploadedAt` | `string?` | ISO 8601 upload timestamp |
