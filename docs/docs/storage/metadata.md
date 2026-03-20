---
sidebar_position: 4
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Metadata

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Manage file metadata: content type, size, uploader info, and custom properties.

## Get Metadata

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const bucket = client.storage.bucket('avatars');

const meta = await bucket.getMetadata('user-1.jpg');
// {
//   key: 'user-1.jpg',
//   size: 245789,
//   contentType: 'image/jpeg',
//   etag: '"a1b2c3..."',
//   uploadedAt: '2026-03-01T12:00:00.000Z',
//   uploadedBy: 'user-id',
//   customMetadata: { alt: 'Profile photo' }
// }
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final bucket = client.storage.bucket('avatars');

final meta = await bucket.getMetadata('user-1.jpg');
// meta.key, meta.size, meta.contentType, meta.customMetadata
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let bucket = client.storage.bucket("avatars")

let meta = try await bucket.getMetadata("user-1.jpg")
// meta.key, meta.size, meta.contentType, meta.customMetadata
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val bucket = client.storage.bucket("avatars")

val meta = bucket.getMetadata("user-1.jpg")
// meta.key, meta.size, meta.contentType, meta.customMetadata
```

</TabItem>
<TabItem value="java" label="Java">

```java
StorageBucket bucket = client.storage().bucket("avatars");

FileInfo meta = bucket.getMetadata("user-1.jpg");
// meta.getKey(), meta.getSize(), meta.getContentType()
```

</TabItem>
<TabItem value="python" label="Python">

```python
bucket = client.storage.bucket('avatars')

meta = bucket.get_metadata('user-1.jpg')
# meta.key, meta.size, meta.content_type, meta.custom_metadata
```

</TabItem>
<TabItem value="go" label="Go">

```go
import "context"

ctx := context.Background()
bucket := admin.Storage().Bucket("avatars")

meta, err := bucket.GetMetadata(ctx, "user-1.jpg")
// meta["key"], meta["size"], meta["contentType"], meta["customMetadata"]
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$bucket = $client->storage->bucket('avatars');

$meta = $bucket->getMetadata('user-1.jpg');
// $meta->key, $meta->size, $meta->contentType, $meta->customMetadata
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let bucket = client.storage().bucket("avatars");

let meta = bucket.get_metadata("user-1.jpg").await?;
// meta.key, meta.size, meta.content_type, meta.custom_metadata
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var bucket = admin.Storage.Bucket("avatars");

var meta = await bucket.GetMetadataAsync("user-1.jpg");
// meta["key"], meta["size"], meta["contentType"], meta["customMetadata"]
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto bucket = client.storage().bucket("avatars");

auto meta = bucket.getMetadata("user-1.jpg");
// meta.key, meta.size, meta.contentType, meta.customMetadata
```

</TabItem>
</Tabs>

### FileInfo Type

| Property | Type | Description |
|----------|------|-------------|
| `key` | `string` | File path within the bucket |
| `size` | `number` | File size in bytes |
| `contentType` | `string` | MIME type |
| `etag` | `string` | R2 entity tag (changes on update) |
| `uploadedAt` | `string` | ISO 8601 upload timestamp |
| `uploadedBy` | `string \| null` | Auth user ID (auto-set on upload) |
| `customMetadata` | `Record<string, string>` | Custom key-value pairs |

## Update Metadata

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const bucket = client.storage.bucket('avatars');

await bucket.updateMetadata('user-1.jpg', {
  customMetadata: { alt: 'Updated profile photo', category: 'avatars' },
  contentType: 'image/webp', // optional: change content type
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final bucket = client.storage.bucket('avatars');

await bucket.updateMetadata('user-1.jpg',
  customMetadata: {'alt': 'Updated profile photo', 'category': 'avatars'},
  contentType: 'image/webp',
);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let bucket = client.storage.bucket("avatars")

try await bucket.updateMetadata("user-1.jpg",
  customMetadata: ["alt": "Updated profile photo", "category": "avatars"],
  contentType: "image/webp"
)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val bucket = client.storage.bucket("avatars")

bucket.updateMetadata("user-1.jpg",
    customMetadata = mapOf("alt" to "Updated profile photo", "category" to "avatars"),
    contentType = "image/webp"
)
```

</TabItem>
<TabItem value="java" label="Java">

```java
StorageBucket bucket = client.storage().bucket("avatars");

bucket.updateMetadata("user-1.jpg",
    Map.of("alt", "Updated profile photo", "category", "avatars"),
    "image/webp"
);
```

</TabItem>
<TabItem value="python" label="Python">

```python
bucket = client.storage.bucket('avatars')

bucket.update_metadata('user-1.jpg',
    custom_metadata={'alt': 'Updated profile photo', 'category': 'avatars'},
    content_type='image/webp',
)
```

</TabItem>
<TabItem value="go" label="Go">

```go
import "context"

ctx := context.Background()
bucket := admin.Storage().Bucket("avatars")

meta, err := bucket.UpdateMetadata(ctx, "user-1.jpg", map[string]interface{}{
    "customMetadata": map[string]interface{}{
        "alt":      "Updated profile photo",
        "category": "avatars",
    },
    "contentType": "image/webp",
})
// meta["customMetadata"], meta["contentType"]
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$bucket = $client->storage->bucket('avatars');

$bucket->updateMetadata('user-1.jpg', [
    'alt' => 'Updated profile photo',
    'category' => 'avatars',
], 'image/webp');
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let bucket = client.storage().bucket("avatars");

bucket.update_metadata("user-1.jpg", HashMap::from([
    ("alt", "Updated profile photo"),
    ("category", "avatars"),
]), Some("image/webp")).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var bucket = admin.Storage.Bucket("avatars");

await bucket.UpdateMetadataAsync("user-1.jpg",
    new Dictionary<string, string>
    {
        ["alt"] = "Updated profile photo",
        ["category"] = "avatars"
    },
    contentType: "image/webp"
);
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto bucket = client.storage().bucket("avatars");

bucket.updateMetadata("user-1.jpg", {
    {"alt", "Updated profile photo"},
    {"category", "avatars"}
}, "image/webp");
```

</TabItem>
</Tabs>

:::info
Only `customMetadata` and `contentType` can be updated. Other fields (`size`, `etag`, `uploadedAt`, `uploadedBy`) are managed by the system.
:::

## REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/storage/:bucket/:key/metadata` | `GET` | Get file metadata |
| `/api/storage/:bucket/:key/metadata` | `PATCH` | Update file metadata |
