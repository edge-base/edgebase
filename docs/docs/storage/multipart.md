---
sidebar_position: 3
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Multipart Upload

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Upload large files in chunks with progress tracking.

## Usage

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const bucket = client.storage.bucket('videos');

await bucket.upload('presentation.mp4', largeFile, {
  contentType: 'video/mp4',
  onProgress: (progress) => {
    console.log(`Upload: ${progress.percent}%`);
  },
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final bucket = client.storage.bucket('videos');

await bucket.upload(
  'presentation.mp4',
  largeFileBytes,
  contentType: 'video/mp4',
  onProgress: (sent, total) => print('$sent / $total'),
);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let bucket = client.storage.bucket("videos")

try await bucket.upload(
  "presentation.mp4",
  data: largeFileData,
  contentType: "video/mp4"
)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val bucket = client.storage.bucket("videos")

bucket.upload(
    "presentation.mp4",
    largeFileBytes,
    contentType = "video/mp4"
)
```

</TabItem>
<TabItem value="java" label="Java">

```java
StorageBucket bucket = client.storage().bucket("videos");

bucket.upload("presentation.mp4", largeFileBytes, "video/mp4");
```

</TabItem>
<TabItem value="python" label="Python">

```python
bucket = client.storage.bucket('videos')

bucket.upload('presentation.mp4', large_file_bytes, content_type='video/mp4')
```

</TabItem>
<TabItem value="go" label="Go">

```go
bucket := admin.Storage.Bucket("videos")

result, err := bucket.Upload("presentation.mp4", largeFileData, "video/mp4")
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$bucket = $client->storage->bucket('videos');

$result = $bucket->upload('presentation.mp4', $largeFileData, 'video/mp4');
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let bucket = client.storage().bucket("videos");

let result = bucket.upload("presentation.mp4", &large_file_data, "video/mp4").await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var bucket = admin.Storage.Bucket("videos");

var result = await bucket.UploadAsync("presentation.mp4", largeFileBytes, "video/mp4");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto bucket = client.storage().bucket("videos");

auto result = bucket.upload("presentation.mp4", data, "video/mp4");
```

</TabItem>
</Tabs>

The SDK automatically:

1. Splits files larger than 5MB into parts
2. Uploads parts in parallel
3. Reports combined progress
4. Completes the multipart upload on the server

## Resume Support

If a multipart upload fails mid-way, the SDK throws a `ResumableUploadError` containing the `uploadId` and `key` needed to resume:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
import { ResumableUploadError } from '@edge-base/web';

try {
  await bucket.upload('large-video.mp4', file, {
    onProgress: (p) => console.log(`${p.percent}%`),
  });
} catch (error) {
  if (error instanceof ResumableUploadError) {
    console.log(`Failed at part ${error.failedPartNumber}, resuming...`);

    // Resume — only uploads the remaining parts
    const result = await bucket.resumeUpload(
      error.key,
      error.uploadId,
      file, // same file reference
    );
    console.log('Upload completed:', result.key);
  }
}
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
try {
  await bucket.upload('large-video.mp4', file);
} on ResumableUploadError catch (error) {
  print('Failed at part ${error.failedPartNumber}, resuming...');

  final result = await bucket.resumeUpload(
    error.key,
    error.uploadId,
    file,
  );
  print('Upload completed: ${result.key}');
}
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
do {
    try await bucket.upload("large-video.mp4", data: fileData)
} catch let error as ResumableUploadError {
    print("Failed at part \(error.failedPartNumber), resuming...")

    let result = try await bucket.resumeUpload(
        key: error.key,
        uploadId: error.uploadId,
        data: fileData
    )
    print("Upload completed: \(result.key)")
}
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
try {
    bucket.upload("large-video.mp4", fileBytes)
} catch (error: ResumableUploadError) {
    println("Failed at part ${error.failedPartNumber}, resuming...")

    val result = bucket.resumeUpload(
        error.key,
        error.uploadId,
        fileBytes
    )
    println("Upload completed: ${result.key}")
}
```

</TabItem>
<TabItem value="java" label="Java">

```java
try {
    bucket.upload("large-video.mp4", fileBytes, "video/mp4");
} catch (ResumableUploadError error) {
    System.out.println("Failed at part " + error.getFailedPartNumber() + ", resuming...");

    FileInfo result = bucket.resumeUpload(
        error.getKey(), error.getUploadId(), fileBytes
    );
    System.out.println("Upload completed: " + result.getKey());
}
```

</TabItem>
<TabItem value="python" label="Python">

```python
from edgebase import ResumableUploadError

try:
    bucket.upload('large-video.mp4', file_bytes)
except ResumableUploadError as error:
    print(f'Failed at part {error.failed_part_number}, resuming...')

    result = bucket.resume_upload(error.key, error.upload_id, file_bytes)
    print(f'Upload completed: {result.key}')
```

</TabItem>
<TabItem value="go" label="Go">

```go
result, err := bucket.Upload("large-video.mp4", fileData, "video/mp4")
if resumeErr, ok := err.(*edgebase.ResumableUploadError); ok {
    fmt.Printf("Failed at part %d, resuming...\n", resumeErr.FailedPartNumber)

    result, err = bucket.ResumeUpload(resumeErr.Key, resumeErr.UploadID, fileData)
}
```

</TabItem>
<TabItem value="php" label="PHP">

```php
try {
    $bucket->upload('large-video.mp4', $fileData, 'video/mp4');
} catch (ResumableUploadError $error) {
    echo "Failed at part {$error->failedPartNumber}, resuming...\n";

    $result = $bucket->resumeUpload($error->key, $error->uploadId, $fileData);
}
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
match bucket.upload("large-video.mp4", &file_data, "video/mp4").await {
    Err(Error::ResumableUpload(error)) => {
        println!("Failed at part {}, resuming...", error.failed_part_number);

        let result = bucket.resume_upload(&error.key, &error.upload_id, &file_data).await?;
        println!("Upload completed: {}", result.key);
    }
    other => other?,
}
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
try
{
    await bucket.UploadAsync("large-video.mp4", fileBytes, "video/mp4");
}
catch (ResumableUploadException error)
{
    Console.WriteLine($"Failed at part {error.FailedPartNumber}, resuming...");

    var result = await bucket.ResumeUploadAsync(error.Key, error.UploadId, fileBytes);
    Console.WriteLine($"Upload completed: {result.Key}");
}
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
try {
    auto result = bucket.upload("large-video.mp4", data, "video/mp4");
} catch (const ResumableUploadError& error) {
    std::cout << "Failed at part " << error.failedPartNumber << ", resuming..." << std::endl;

    auto result = bucket.resumeUpload(error.key, error.uploadId, data);
}
```

</TabItem>
</Tabs>

### Query Uploaded Parts

You can check which parts have been uploaded for an in-progress multipart upload:

```typescript
const { parts } = await bucket.getUploadParts('large-video.mp4', uploadId);
// parts: [{ partNumber: 1, etag: '...' }, { partNumber: 2, etag: '...' }, ...]
```

Part tracking data is stored in KV with a 7-day TTL (synced with R2's auto-abort window).

## Cancel Upload

Multipart uploads can be cancelled mid-flight using `.cancel()`:

```typescript
const task = bucket.upload('large-video.mp4', file, {
  onProgress: (p) => console.log(`${p.percent}%`),
});

// Cancel after 10 seconds
setTimeout(() => task.cancel(), 10_000);

try {
  await task;
} catch (err) {
  if (err.name === 'AbortError') {
    console.log('Upload cancelled');
  }
}
```

Cancelled multipart uploads are automatically cleaned up by R2 after 7 days. `resumeUpload()` also returns a cancellable `UploadTask`.

## R2 Multipart API

Under the hood, EdgeBase uses R2's Multipart Upload API:

| Endpoint | Description |
|----------|-------------|
| `POST /api/storage/:bucket/multipart/create` | Initiate upload |
| `POST /api/storage/:bucket/multipart/upload-part?uploadId=...&partNumber=...&key=...` | Upload a part |
| `POST /api/storage/:bucket/multipart/complete` | Complete upload |
| `POST /api/storage/:bucket/multipart/abort` | Abort upload |
| `GET /api/storage/:bucket/uploads/:uploadId/parts?key=...` | Fetch uploaded parts for resume |

## Limits

- Minimum part size: 5MB (except the last part)
- Maximum parts: 10,000
