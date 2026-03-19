---
sidebar_position: 2
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Signed URLs

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Generate time-limited URLs for private file access and upload workflows.

## When to Use Signed URLs

By default, files in a bucket with a `read` rule that returns `true` are publicly accessible via `bucket.getUrl()`. But for **private files** — where the bucket's `read` rule requires authentication — clients need a way to access files without sending auth headers (e.g., in `<img src="...">` tags, PDF viewers, or sharing links with external users).

**Signed URLs** solve this by embedding a time-limited token directly in the URL:

```
Regular URL:  https://project.edgebase.fun/api/storage/private/report.pdf      ← 403 Forbidden
Signed URL:   https://project.edgebase.fun/api/storage/private/report.pdf?token={expiresAt}.{hmacHex}  ← ✅ Works for 1 hour
```

| Scenario | Use |
|----------|-----|
| Display a private image in `<img>` | **Signed download URL** |
| Share a temporary download link with someone | **Signed download URL** (set a short expiry) |
| Let the client upload a large file directly to R2 | **Signed upload URL** (bypasses Worker memory limits) |
| Show a public file in `<img>` | `bucket.getUrl()` — no signing needed |

:::info Access Rule Check
Signed download URLs check the `read` rule at **URL creation time**. Signed upload URLs check the `write` rule at **URL creation time**. After that, anyone with the URL can access the file until it expires.
:::

---

## Signed Download URL

Create a temporary URL for downloading a private file (default expiry: **1 hour**):

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const bucket = client.storage.bucket('private');

const url = await bucket.createSignedUrl('report.pdf', {
  expiresIn: '1h',  // default: 1h
});
// url -> "https://your-project.edgebase.fun/api/storage/private/report.pdf?token=..."
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final bucket = client.storage.bucket('private');

final url = await bucket.createSignedUrl('report.pdf', expiresIn: '1h');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let bucket = client.storage.bucket("private")

let url = try await bucket.createSignedUrl("report.pdf", expiresIn: "1h")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val bucket = client.storage.bucket("private")

val url = bucket.createSignedUrl("report.pdf", expiresIn = "1h")
```

</TabItem>
<TabItem value="java" label="Java">

```java
StorageBucket bucket = client.storage().bucket("private");

String url = bucket.createSignedUrl("report.pdf", "1h");
```

</TabItem>
<TabItem value="python" label="Python">

```python
bucket = client.storage.bucket('private')

url = bucket.create_signed_url('report.pdf', expires_in='1h')
```

</TabItem>
<TabItem value="go" label="Go">

```go
import "context"

ctx := context.Background()
bucket := admin.Storage().Bucket("private")

signed, err := bucket.CreateSignedURL(ctx, "report.pdf", "1h")
// signed["url"] -> "https://your-project.edgebase.fun/api/storage/private/report.pdf?token=..."
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$bucket = $client->storage->bucket('private');

$url = $bucket->createSignedUrl('report.pdf', '1h');
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let bucket = client.storage().bucket("private");

let url = bucket.create_signed_url("report.pdf", "1h").await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var bucket = admin.Storage.Bucket("private");

var url = await bucket.CreateSignedUrlAsync("report.pdf", "1h");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto bucket = client.storage().bucket("private");

auto url = bucket.createSignedUrl("report.pdf", "1h");
```

</TabItem>
</Tabs>

### Duration Format

| Value | Duration |
|-------|----------|
| `'30s'` | 30 seconds |
| `'10m'` | 10 minutes |
| `'1h'` | 1 hour (default) |
| `'7d'` | 7 days |

## Batch Signed URLs

Create signed URLs for multiple files in a single request:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const bucket = client.storage.bucket('private');

const results = await bucket.createSignedUrls(
  ['report-1.pdf', 'report-2.pdf', 'report-3.pdf'],
  { expiresIn: '1h' },
);
// [
//   { key: 'report-1.pdf', url: '...?token=...', expiresAt: '2026-03-01T...' },
//   { key: 'report-2.pdf', url: '...?token=...', expiresAt: '2026-03-01T...' },
//   { key: 'report-3.pdf', url: '...?token=...', expiresAt: '2026-03-01T...' },
// ]
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final bucket = client.storage.bucket('private');

final results = await bucket.createSignedUrls(
  ['report-1.pdf', 'report-2.pdf', 'report-3.pdf'],
  expiresIn: '1h',
);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let bucket = client.storage.bucket("private")

let results = try await bucket.createSignedUrls(
  ["report-1.pdf", "report-2.pdf", "report-3.pdf"],
  expiresIn: "1h"
)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val bucket = client.storage.bucket("private")

val results = bucket.createSignedUrls(
    listOf("report-1.pdf", "report-2.pdf", "report-3.pdf"),
    expiresIn = "1h"
)
```

</TabItem>
<TabItem value="java" label="Java">

```java
StorageBucket bucket = client.storage().bucket("private");

List<SignedUrlResult> results = bucket.createSignedUrls(
    List.of("report-1.pdf", "report-2.pdf", "report-3.pdf"), "1h"
);
```

</TabItem>
<TabItem value="python" label="Python">

```python
bucket = client.storage.bucket('private')

results = bucket.create_signed_urls(
    ['report-1.pdf', 'report-2.pdf', 'report-3.pdf'],
    expires_in='1h',
)
```

</TabItem>
<TabItem value="go" label="Go">

```go
import "context"

ctx := context.Background()
bucket := admin.Storage().Bucket("private")

results, err := bucket.CreateSignedURLs(
    ctx,
    []string{"report-1.pdf", "report-2.pdf", "report-3.pdf"},
    "1h",
)
// results["items"] or results["files"] contains the signed URL entries
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$bucket = $client->storage->bucket('private');

$results = $bucket->createSignedUrls(
    ['report-1.pdf', 'report-2.pdf', 'report-3.pdf'], '1h'
);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let bucket = client.storage().bucket("private");

let results = bucket.create_signed_urls(
    &["report-1.pdf", "report-2.pdf", "report-3.pdf"], "1h"
).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var bucket = admin.Storage.Bucket("private");

var results = await bucket.CreateSignedUrlsAsync(
    new[] { "report-1.pdf", "report-2.pdf", "report-3.pdf" }, "1h"
);
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto bucket = client.storage().bucket("private");

auto results = bucket.createSignedUrls(
    {"report-1.pdf", "report-2.pdf", "report-3.pdf"}, "1h"
);
```

</TabItem>
</Tabs>

:::info
Non-existent files are silently skipped in the response. Maximum 100 keys per request.
:::

## Signed Upload URL

Create a temporary upload URL (default expiry: **30 minutes**):

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const bucket = client.storage.bucket('uploads');

const signed = await bucket.createSignedUploadUrl('large-file.zip', {
  expiresIn: '10m',  // default: 30m
});

const formData = new FormData();
formData.append('file', file, 'large-file.zip');
formData.append('key', 'large-file.zip');

await fetch(signed.url, {
  method: 'POST',
  body: formData,
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final bucket = client.storage.bucket('uploads');

final signed = await bucket.createSignedUploadUrl(
  'large-file.zip',
  expiresIn: '10m',
);

// Upload using the signed URL
final response = await http.post(
  Uri.parse(signed.url),
  body: fileBytes,
);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let bucket = client.storage.bucket("uploads")

let signed = try await bucket.createSignedUploadUrl(
  "large-file.zip",
  expiresIn: "10m"
)

// Upload using the signed URL
var request = URLRequest(url: URL(string: signed.url)!)
request.httpMethod = "POST"
request.httpBody = fileData
let (_, response) = try await URLSession.shared.data(for: request)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val bucket = client.storage.bucket("uploads")

val signed = bucket.createSignedUploadUrl("large-file.zip", expiresIn = "10m")

// Upload using the signed URL
val response = httpClient.post(signed.url) {
    setBody(fileBytes)
}
```

</TabItem>
<TabItem value="java" label="Java">

```java
StorageBucket bucket = client.storage().bucket("uploads");

SignedUploadUrl signed = bucket.createSignedUploadUrl("large-file.zip", "10m");

// Upload using the signed URL
```

</TabItem>
<TabItem value="python" label="Python">

```python
bucket = client.storage.bucket('uploads')

signed = bucket.create_signed_upload_url('large-file.zip', expires_in='10m')

# Upload using the signed URL
import requests
requests.post(signed.url, files={'file': file_data})
```

</TabItem>
<TabItem value="go" label="Go">

```go
import "context"

ctx := context.Background()
bucket := admin.Storage().Bucket("uploads")

signed, err := bucket.CreateSignedUploadURL(ctx, "large-file.zip", 600)
// Upload using signed["url"]
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$bucket = $client->storage->bucket('uploads');

$signed = $bucket->createSignedUploadUrl('large-file.zip', '10m');

// Upload using $signed->url
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let bucket = client.storage().bucket("uploads");

let signed = bucket.create_signed_upload_url("large-file.zip", "10m").await?;
// Upload using signed.url
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var bucket = admin.Storage.Bucket("uploads");

var signed = await bucket.CreateSignedUploadUrlAsync("large-file.zip", "10m");
// Upload using signed.Url
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto bucket = client.storage().bucket("uploads");

auto signed = bucket.createSignedUploadUrl("large-file.zip", "10m");
// Upload using signed.url
```

</TabItem>
</Tabs>

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `expiresIn` | `string` | `'30m'` | Duration until the URL expires (e.g., `'10m'`, `'1h'`) |
| `maxFileSize` | `string` | — | Maximum allowed file size as a byte-size string (e.g., `'5MB'`, `'1GB'`, `'128KB'`). The upload is rejected if the file exceeds this limit. |

:::info
Signed upload URLs validate `write` rules when the URL is created.
:::

## REST API

| Endpoint | Description |
|----------|-------------|
| `POST /api/storage/:bucket/signed-url` | Create signed download URL |
| `POST /api/storage/:bucket/signed-urls` | Batch create signed download URLs |
| `POST /api/storage/:bucket/signed-upload-url` | Create signed upload URL |
