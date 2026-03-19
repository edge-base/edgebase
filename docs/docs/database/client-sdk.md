---
sidebar_position: 1
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Client SDK

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Database operations from the client (browser, mobile, game engine). All operations go through [Access Rules](/docs/database/access-rules).

:::info Access Rules and Triggers
- **[Access Rules](/docs/database/access-rules)** — Control who can read, write, and delete your data
- **[Database Triggers](/docs/database/triggers)** — Run server-side code automatically on data changes
:::

## Setup

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
import { createClient } from '@edge-base/web';

const client = createClient('https://my-app.edgebase.fun');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
import 'package:edgebase_flutter/edgebase_flutter.dart';

final client = ClientEdgeBase('https://my-app.edgebase.fun');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
import EdgeBase

let client = EdgeBaseClient("https://my-app.edgebase.fun")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
import dev.edgebase.sdk.client.ClientEdgeBase

val client = ClientEdgeBase("https://my-app.edgebase.fun")
```

</TabItem>
<TabItem value="java" label="Java">

```java
import dev.edgebase.sdk.client.*;

ClientEdgeBase client = EdgeBase.client("https://my-app.edgebase.fun");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
using EdgeBase;

var client = new EdgeBase("https://my-app.edgebase.fun");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
#include <edgebase/edgebase.h>

eb::EdgeBase client("https://my-app.edgebase.fun");
```

</TabItem>
</Tabs>

Use `client.db(namespace, id?)` to select a DB block, then `.table(name)` to access a table:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
client.db('app')                    // single-instance DB block
client.db('workspace', 'ws-456')       // workspace-isolated DB block
client.db('user', userId)              // per-user DB block
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
client.db('app');                       // single-instance DB block
client.db('workspace', 'ws-456');       // workspace-isolated DB block
client.db('user', userId);              // per-user DB block
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
client.db("app")                        // single-instance DB block
client.db("workspace", "ws-456")        // workspace-isolated DB block
client.db("user", userId)               // per-user DB block
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.db("app")                        // single-instance DB block
client.db("workspace", "ws-456")        // workspace-isolated DB block
client.db("user", userId)               // per-user DB block
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.db("app");                       // single-instance DB block
client.db("workspace", "ws-456");       // workspace-isolated DB block
client.db("user", userId);              // per-user DB block
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
client.Db("app");                       // single-instance DB block
client.Db("workspace", "ws-456");       // workspace-isolated DB block
client.Db("user", userId);              // per-user DB block
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
client.db("app");                       // single-instance DB block
client.db("workspace", "ws-456");       // workspace-isolated DB block
client.db("user", userId);              // per-user DB block
```

</TabItem>
</Tabs>

Block names (`app`, `workspace`, `user` above) are just config keys — pick whatever describes your data. A single-argument call like `db('app')` targets a single-instance block; a two-argument call like `db('workspace', id)` targets a dynamic block where each ID gets its own isolated database.

### TypeScript Generics

Define an interface for your table and pass it as a type parameter to `table<T>()`. All operations will be fully typed:

```typescript
interface Post {
  id: string;
  title: string;
  content: string;
  status: 'draft' | 'published' | 'archived';
  views: number;
  createdAt: string;
  updatedAt: string;
}

const posts = client.db('app').table<Post>('posts');

// All return types are now typed as Post
const post = await posts.getOne('post-id');         // Post
const result = await posts.getList();               // ListResult<Post>
const first = await posts.getFirst();               // Post | null

// Insert/update data is typed as Partial<Post>
await posts.insert({ title: 'Hello', content: '...', status: 'draft' });
await posts.update('post-id', { status: 'published' });

// Filters and query builder are also typed
const published = await posts
  .where('status', '==', 'published')
  .orderBy('createdAt', 'desc')
  .limit(10)
  .getList();  // ListResult<Post>
```

---

## Error Handling

All SDK methods **throw on failure** — there is no `{ data, error }` return pattern.

### Error Structure

| Property | Type | Description |
|----------|------|-------------|
| `status` | `number` | HTTP status code |
| `message` | `string` | Human-readable error message |
| `data` | `Record<string, { code, message }>` | Per-field validation errors (optional) |

### Common Error Codes

| Code | Name | When |
|------|------|------|
| 400 | Validation Error | Schema validation failed, batch limit exceeded |
| 401 | Unauthorized | Missing or expired auth token |
| 403 | Forbidden | Access Rules denied the operation |
| 404 | Not Found | Record or table doesn't exist |
| 429 | Rate Limited | Too many requests (see [Quotas](#quotas--limits)) |

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
import { EdgeBaseError } from '@edge-base/core';

try {
  await client.db('app').table('posts').getOne('nonexistent');
} catch (error) {
  if (error instanceof EdgeBaseError) {
    console.error(error.status);   // 404
    console.error(error.message);  // "Not found."
    console.error(error.data);     // undefined (or field errors for 400)
  }
}
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
import 'package:edgebase_core/edgebase_core.dart';

try {
  await client.db('app').table('posts').getOne('nonexistent');
} on EdgeBaseError catch (e) {
  print(e.status);    // 404
  print(e.message);   // "Not found."
}
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
do {
    let post = try await client.db("app").table("posts").getOne("nonexistent")
} catch let error as EdgeBaseError {
    print(error.status)    // 404
    print(error.message)   // "Not found."
}
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
try {
    val post = client.db("app").table("posts").getOne("nonexistent")
} catch (e: EdgeBaseError) {
    println(e.status)    // 404
    println(e.message)   // "Not found."
}
```

</TabItem>
<TabItem value="java" label="Java">

```java
try {
    var post = client.db("app").table("posts").getOne("nonexistent");
} catch (EdgeBaseError e) {
    System.out.println(e.getStatus());   // 404
    System.out.println(e.getMessage());  // "Not found."
}
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
try {
    var post = await client.Db("app").Table("posts").GetOneAsync("nonexistent");
} catch (EdgeBaseException e) {
    Console.WriteLine(e.StatusCode); // 404
    Console.WriteLine(e.Message);    // "Not found."
}
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
try {
    auto post = client.db("app").table("posts").getOne("nonexistent");
} catch (const edgebase::EdgeBaseError& e) {
    std::cerr << e.status() << ": " << e.what() << std::endl;
}
```

</TabItem>
</Tabs>

---

## Insert

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const post = await client.db('app').table('posts').insert({
  title: 'Hello World',
  content: 'My first post.',
  status: 'published',
});
// post.id → "0192d3a4-..."  (UUID v7, auto-generated)
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final post = await client.db('app').table('posts').insert({
  'title': 'Hello World',
  'content': 'My first post.',
  'status': 'published',
});
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let post = try await client.db("app").table("posts").insert([
    "title": "Hello World",
    "content": "My first post.",
    "status": "published"
])
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val post = client.db("app").table("posts").insert(mapOf(
    "title" to "Hello World",
    "content" to "My first post.",
    "status" to "published"
))
```

</TabItem>
<TabItem value="java" label="Java">

```java
Map<String, Object> post = client.db("app").table("posts").insert(Map.of(
    "title", "Hello World",
    "content", "My first post.",
    "status", "published"
));
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var post = await client.Db("app").Table("posts").InsertAsync(new() {
    ["title"] = "Hello World",
    ["content"] = "My first post.",
    ["status"] = "published",
});
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto post = client.db("app").table("posts").insert(R"({
    "title": "Hello World",
    "content": "My first post.",
    "status": "published"
})");
```

</TabItem>
</Tabs>

:::tip insert vs upsert
`insert()` throws an error on duplicate ID (UNIQUE constraint). Use `upsert()` if you want to update the existing record instead of failing.
:::

## Upsert

Insert a new record, or update it if a record with the same ID (or unique field) already exists:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const result = await client.db('app').table('posts').upsert({
  id: 'post-001',
  title: 'Hello World',
  status: 'published',
});
// result.action → "inserted" or "updated"
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await client.db('app').table('posts').upsert({
  'id': 'post-001',
  'title': 'Hello World',
  'status': 'published',
});
// result.action → "inserted" or "updated"
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let result = try await client.db("app").table("posts").upsert([
    "id": "post-001",
    "title": "Hello World",
    "status": "published"
])
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = client.db("app").table("posts").upsert(mapOf(
    "id" to "post-001",
    "title" to "Hello World",
    "status" to "published"
))
```

</TabItem>
<TabItem value="java" label="Java">

```java
UpsertResult result = client.db("app").table("posts").upsert(Map.of(
    "id", "post-001",
    "title", "Hello World",
    "status", "published"
));
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Db("app").Table("posts").UpsertAsync(new() {
    ["id"] = "post-001",
    ["title"] = "Hello World",
    ["status"] = "published",
});
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.db("app").table("posts").upsert(R"({
    "id": "post-001",
    "title": "Hello World",
    "status": "published"
})");
```

</TabItem>
</Tabs>

### conflictTarget

By default, upsert matches on `id`. Use `conflictTarget` to match on a different unique field:

```typescript
const result = await client.db('app').table('categories').upsert(
  { name: 'Tech', slug: 'tech', description: 'Technology articles' },
  { conflictTarget: 'slug' }
);
```

## Read

### Get a single record

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const post = await client.db('app').table('posts').getOne('record-id');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final post = await client.db('app').table('posts').getOne('record-id');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let post = try await client.db("app").table("posts").getOne("record-id")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val post = client.db("app").table("posts").getOne("record-id")
```

</TabItem>
<TabItem value="java" label="Java">

```java
Map<String, Object> post = client.db("app").table("posts").getOne("record-id");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var post = await client.Db("app").Table("posts").GetOneAsync("record-id");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto post = client.db("app").table("posts").getOne("record-id");
```

</TabItem>
</Tabs>

:::tip doc() Pattern
JS, Python, Dart, Swift, Kotlin, Java SDKs also support the `doc()` pattern for single-record operations:

```js
const ref = client.db('app').table('posts').doc('record-id');
await ref.get();           // Same as getOne('record-id')
await ref.update({...});   // Same as update('record-id', {...})
await ref.delete();        // Same as delete('record-id')
ref.onSnapshot(callback);  // Database subscription for this document
```
:::

### Get First Match

Retrieve the first record matching query conditions. Returns `null` if no records match.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const user = await client.db('app').table('users')
  .where('email', '==', 'june@example.com')
  .getFirst();
// user → T | null
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final user = await client.db('app').table('users')
    .where('email', '==', 'june@example.com')
    .getFirst();
// user → Map<String, dynamic>?
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let user = try await client.db("app").table("users")
    .where("email", "==", "june@example.com")
    .getFirst()
// user → [String: Any]?
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val user = client.db("app").table("users")
    .where("email", "==", "june@example.com")
    .getFirst()
// user → Map<String, Any>?
```

</TabItem>
<TabItem value="java" label="Java">

```java
Map<String, Object> user = client.db("app").table("users")
    .where("email", "==", "june@example.com")
    .getFirst();
// user → null if not found
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var user = await client.Db("app").Table("users")
    .Where("email", "==", "june@example.com")
    .GetFirstAsync();
// user → T?
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto user = client.db("app").table("users")
    .where("email", "==", "june@example.com")
    .getFirst();
// user → std::optional<T>
```

</TabItem>
</Tabs>

> Internally calls `.limit(1).getList()` and returns the first item. No special server endpoint needed.

### List records

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const result = await client.db('app').table('posts')
  .orderBy('createdAt', 'desc')
  .limit(20)
  .getList();

// result.items → Post[]
// result.total → 150
// result.page → 1
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await client.db('app').table('posts')
    .orderBy('createdAt', direction: 'desc')
    .limit(20)
    .getList();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let result = try await client.db("app").table("posts")
    .orderBy("createdAt", "desc")
    .limit(20)
    .getList()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = client.db("app").table("posts")
    .orderBy("createdAt", "desc")
    .limit(20)
    .getList()
```

</TabItem>
<TabItem value="java" label="Java">

```java
ListResult result = client.db("app").table("posts")
    .orderBy("createdAt", "desc")
    .limit(20)
    .getList();
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Db("app").Table("posts")
    .OrderBy("createdAt", "desc")
    .Limit(20)
    .GetListAsync();
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.db("app").table("posts")
    .orderBy("createdAt", "desc")
    .limit(20)
    .getList();
```

</TabItem>
</Tabs>

## Update

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await client.db('app').table('posts').update('record-id', {
  title: 'Updated Title',
  status: 'published',
});
```

### Field Operators

```typescript
import { increment, deleteField } from '@edge-base/core';

await client.db('app').table('posts').update('record-id', {
  views: increment(1),           // Atomic increment
  tempField: deleteField(),       // Set to NULL
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.db('app').table('posts').update('record-id', {
  'title': 'Updated Title',
  'views': EdgeBase.increment(1),
  'tempField': EdgeBase.deleteField(),
});
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
try await client.db("app").table("posts").update("record-id", [
    "title": "Updated Title",
    "views": EdgeBase.increment(1),
    "tempField": EdgeBase.deleteField()
])
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.db("app").table("posts").update("record-id", mapOf(
    "title" to "Updated Title",
    "views" to EdgeBase.increment(1),
    "tempField" to EdgeBase.deleteField()
))
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.db("app").table("posts").update("record-id", Map.of(
    "title", "Updated Title",
    "views", EdgeBaseFieldOps.increment(1),
    "tempField", EdgeBaseFieldOps.deleteField()
));
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var updated = await client.Db("app").Table("posts").UpdateAsync("record-id", new() {
    ["title"] = "Updated Title",
    ["views"] = FieldOps.Increment(1),
    ["tempField"] = FieldOps.DeleteField(),
});
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto updated = client.db("app").table("posts").update("record-id", R"({
    "title": "Updated Title",
    "views": {"$op": "increment", "value": 1},
    "tempField": {"$op": "deleteField"}
})");
```

</TabItem>
</Tabs>

## Delete

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await client.db('app').table('posts').delete('record-id');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.db('app').table('posts').delete('record-id');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
try await client.db("app").table("posts").delete("record-id")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.db("app").table("posts").delete("record-id")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.db("app").table("posts").delete("record-id");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await client.Db("app").Table("posts").DeleteAsync("record-id");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.db("app").table("posts").del("record-id");
```

</TabItem>
</Tabs>

---

## Queries

### Filtering

Use `where()` to filter records. Multiple `where()` calls are combined with **AND**. Available operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `contains-any`, `in`, `not in` (or `not-in`).

:::tip OR Conditions
Use `.or()` to combine conditions with OR logic. Conditions inside `.or()` are joined with **OR**, while multiple `.where()` calls remain **AND**. A maximum of 5 conditions are allowed inside a single `.or()` group.

```typescript
// OR across different fields
const results = await client.db('app').table('posts')
  .or(q => q.where('status', '==', 'draft').where('authorId', '==', userId))
  .getList();

// AND + OR combined
const results = await client.db('app').table('posts')
  .where('createdAt', '>', '2025-01-01')
  .or(q => q.where('status', '==', 'draft').where('status', '==', 'archived'))
  .getList();
```

For same-field OR, the `in` operator is more efficient: `where('status', 'in', ['draft', 'review'])`.
:::

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// Simple filter
const published = await client.db('app').table('posts')
  .where('status', '==', 'published')
  .getList();

// Multiple filters (AND)
const myPosts = await client.db('app').table('posts')
  .where('authorId', '==', currentUser.id)
  .where('status', '==', 'published')
  .getList();

// Contains (partial text match)
const results = await client.db('app').table('posts')
  .where('title', 'contains', 'tutorial')
  .getList();

// In (match any of the values)
const featured = await client.db('app').table('posts')
  .where('status', 'in', ['published', 'featured'])
  .getList();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final published = await client.db('app').table('posts')
    .where('status', '==', 'published')
    .getList();

final myPosts = await client.db('app').table('posts')
    .where('authorId', '==', currentUser.id)
    .where('status', '==', 'published')
    .getList();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let published = try await client.db("app").table("posts")
    .where("status", "==", "published")
    .getList()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val published = client.db("app").table("posts")
    .where("status", "==", "published")
    .getList()
```

</TabItem>
<TabItem value="java" label="Java">

```java
ListResult published = client.db("app").table("posts")
    .where("status", "==", "published")
    .getList();
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var published = await client.Db("app").Table("posts")
    .Where("status", "==", "published")
    .GetListAsync();
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto published = client.db("app").table("posts")
    .where("status", "==", "published")
    .getList();
```

</TabItem>
</Tabs>

### Sorting

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// Single sort
const latest = await client.db('app').table('posts')
  .orderBy('createdAt', 'desc')
  .getList();

// Multi-sort
const sorted = await client.db('app').table('posts')
  .orderBy('status', 'asc')
  .orderBy('createdAt', 'desc')
  .getList();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final latest = await client.db('app').table('posts')
    .orderBy('createdAt', direction: 'desc')
    .getList();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let latest = try await client.db("app").table("posts")
    .orderBy("createdAt", "desc")
    .getList()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val latest = client.db("app").table("posts")
    .orderBy("createdAt", "desc")
    .getList()
```

</TabItem>
<TabItem value="java" label="Java">

```java
ListResult latest = client.db("app").table("posts")
    .orderBy("createdAt", "desc")
    .getList();
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var latest = await client.Db("app").Table("posts")
    .OrderBy("createdAt", "desc")
    .GetListAsync();
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto latest = client.db("app").table("posts")
    .orderBy("createdAt", "desc")
    .getList();
```

</TabItem>
</Tabs>

### Pagination

#### Offset Pagination

```typescript
// Using offset
const page2 = await client.db('app').table('posts')
  .limit(20)
  .offset(20)
  .getList();

// Using page (alias for offset-based pagination)
const page3 = await client.db('app').table('posts')
  .page(3)
  .limit(20)
  .getList();

// Response: { items: [...], total: 150, page: 3, perPage: 20 }
```

:::note
`page(n)` and `after(cursor)`/`before(cursor)` are mutually exclusive. You cannot use both in the same query.
:::

#### Cursor Pagination

For better performance with large datasets, use cursor pagination with UUID v7 keys:

```typescript
const firstPage = await client.db('app').table('posts')
  .limit(20)
  .getList();

// Next page using cursor (forward)
const nextPage = await client.db('app').table('posts')
  .limit(20)
  .after(firstPage.items[firstPage.items.length - 1].id)
  .getList();

// Previous page using cursor (backward)
const prevPage = await client.db('app').table('posts')
  .limit(20)
  .before(nextPage.items[0].id)
  .getList();

// Cursor response format:
// { items: [...], cursor: "last-item-id", hasMore: true }
```

### Count

Get the count of records without fetching them:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const total = await client.db('app').table('posts').count();
// total → 150

// With filter
const published = await client.db('app').table('posts')
  .where('status', '==', 'published')
  .count();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final total = await client.db('app').table('posts').count();
final published = await client.db('app').table('posts')
    .where('status', '==', 'published')
    .count();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let total = try await client.db("app").table("posts").count()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val total = client.db("app").table("posts").count()
```

</TabItem>
<TabItem value="java" label="Java">

```java
int total = client.db("app").table("posts").count();
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
int total = await client.Db("app").Table("posts").CountAsync();
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto total = client.db("app").table("posts").count();
```

</TabItem>
</Tabs>

---

## Batch Operations

### insertMany

Insert multiple records in a single atomic transaction (all-or-nothing):

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const posts = await client.db('app').table('posts').insertMany([
  { title: 'Post 1', status: 'published' },
  { title: 'Post 2', status: 'draft' },
  { title: 'Post 3', status: 'published' },
]);
// All succeed or all fail (single transaction)
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final posts = await client.db('app').table('posts').insertMany([
  {'title': 'Post 1', 'status': 'published'},
  {'title': 'Post 2', 'status': 'draft'},
  {'title': 'Post 3', 'status': 'published'},
]);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let posts = try await client.db("app").table("posts").insertMany([
    ["title": "Post 1", "status": "published"],
    ["title": "Post 2", "status": "draft"],
])
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val posts = client.db("app").table("posts").insertMany(listOf(
    mapOf("title" to "Post 1", "status" to "published"),
    mapOf("title" to "Post 2", "status" to "draft"),
))
```

</TabItem>
<TabItem value="java" label="Java">

```java
List<Map> posts = client.db("app").table("posts").insertMany(List.of(
    Map.of("title", "Post 1", "status", "published"),
    Map.of("title", "Post 2", "status", "draft")
));
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var posts = await client.Db("app").Table("posts").InsertManyAsync(new[] {
    new Dictionary<string, object> { ["title"] = "Post 1", ["status"] = "published" },
    new Dictionary<string, object> { ["title"] = "Post 2", ["status"] = "draft" },
});
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto posts = client.db("app").table("posts").insertMany(R"([
    {"title": "Post 1", "status": "published"},
    {"title": "Post 2", "status": "draft"}
])");
```

</TabItem>
</Tabs>

### updateMany

Update all records matching a filter condition:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const result = await client.db('app').table('posts')
  .where('status', '==', 'draft')
  .updateMany({ status: 'archived' });
// result.totalProcessed → 42, result.totalSucceeded → 42
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await client.db('app').table('posts')
    .where('status', '==', 'draft')
    .updateMany({'status': 'archived'});
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let result = try await client.db("app").table("posts")
    .where("status", "==", "draft")
    .updateMany(["status": "archived"])
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = client.db("app").table("posts")
    .where("status", "==", "draft")
    .updateMany(mapOf("status" to "archived"))
```

</TabItem>
<TabItem value="java" label="Java">

```java
BatchResult result = client.db("app").table("posts")
    .where("status", "==", "draft")
    .updateMany(Map.of("status", "archived"));
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Db("app").Table("posts")
    .Where("status", "==", "draft")
    .UpdateManyAsync(new() { ["status"] = "archived" });
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.db("app").table("posts")
    .where("status", "==", "draft")
    .updateMany(R"({"status": "archived"})");
```

</TabItem>
</Tabs>

### deleteMany

Delete all records matching a filter condition:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const result = await client.db('app').table('posts')
  .where('status', '==', 'archived')
  .deleteMany();
// result.totalProcessed → 15, result.totalSucceeded → 15
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await client.db('app').table('posts')
    .where('status', '==', 'archived')
    .deleteMany();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let result = try await client.db("app").table("posts")
    .where("status", "==", "archived")
    .deleteMany()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = client.db("app").table("posts")
    .where("status", "==", "archived")
    .deleteMany()
```

</TabItem>
<TabItem value="java" label="Java">

```java
BatchResult result = client.db("app").table("posts")
    .where("status", "==", "archived")
    .deleteMany();
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Db("app").Table("posts")
    .Where("status", "==", "archived")
    .DeleteManyAsync();
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.db("app").table("posts")
    .where("status", "==", "archived")
    .deleteMany();
```

</TabItem>
</Tabs>

### upsertMany

Batch upsert — insert or update multiple records atomically:

```typescript
await client.db('app').table('settings').upsertMany([
  { id: 'theme', value: 'dark' },
  { id: 'lang', value: 'ko' },
]);
```

You can also upsert by a unique field using `conflictTarget`:

```typescript
await client.db('app').table('categories').upsertMany(
  [
    { name: 'Tech', slug: 'tech' },
    { name: 'Science', slug: 'science' },
  ],
  { conflictTarget: 'slug' }
);
```

:::info Transaction Behavior
- **Maximum 500 items** per server batch call. The REST API returns `400` if a single request exceeds 500 items.
- **SDK auto-chunking**: When `insertMany` receives more than 500 items, the SDK automatically splits them into 500-item chunks and sends them sequentially. Each chunk is an independent transaction, so partial failures are possible.
- **`insertMany` (≤ 500)** — All-or-nothing (single transaction)
- **`updateMany / deleteMany`** — Each batch is an independent transaction
- **`upsertMany` (≤ 500)** — All-or-nothing (single transaction)
:::


---

## Subscriptions

Subscribe to changes in real time using `onSnapshot`:

### Table Subscription

```typescript
const unsubscribe = client.db('app').table('posts')
  .where('status', '==', 'published')
  .orderBy('createdAt', 'desc')
  .limit(20)
  .onSnapshot((event) => {
    if (event.type === 'added') {
      console.log('New:', event.data);
    } else if (event.type === 'modified') {
      console.log('Updated:', event.data);
    } else if (event.type === 'removed') {
      console.log('Deleted:', event.docId);
    }
  });

unsubscribe(); // Stop listening
```

### Event Structure

| Property | Type | Description |
|----------|------|-------------|
| `type` | `'added' \| 'modified' \| 'removed'` | Change type |
| `table` | `string` | Table name |
| `docId` | `string` | Record ID |
| `data` | `T \| null` | Record data (`null` for removed) |
| `timestamp` | `string` | ISO 8601 timestamp |

### Error Handling

```typescript
const removeErrorHandler = client.databaseLive.onError((error) => {
  console.error(error.code, error.message);
  // Possible codes: AUTH_TIMEOUT, AUTH_FAILED, CHANNEL_ACCESS_DENIED, ...
});
```

### Reconnection

Auto-reconnect is enabled by default with exponential backoff (max 30s). After reconnection, all subscriptions are automatically restored.

For more details, see [Database Subscriptions](/docs/database/subscriptions) and [Server-Side Filters](/docs/database/server-side-filters).

---

## Full-Text Search

Search across text fields using FTS5. Requires `fts` to be enabled on the table in your config:

```typescript
// edgebase.config.ts
posts: {
  schema: { /* ... */ },
  fts: ['title', 'content'],  // Enable FTS on these fields
}
```

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const results = await client.db('app').table('posts')
  .search('typescript tutorial')
  .limit(20)
  .getList();

// results.items → ranked by relevance
// results.items[0].highlight → { title: "...<mark>TypeScript</mark> <mark>Tutorial</mark>..." }
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final results = await client.db('app').table('posts')
    .search('typescript tutorial')
    .limit(20)
    .getList();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let results = try await client.db("app").table("posts")
    .search("typescript tutorial")
    .limit(20)
    .getList()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val results = client.db("app").table("posts")
    .search("typescript tutorial")
    .limit(20)
    .getList()
```

</TabItem>
<TabItem value="java" label="Java">

```java
ListResult results = client.db("app").table("posts")
    .search("typescript tutorial")
    .limit(20)
    .getList();
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var results = await client.Db("app").Table("posts")
    .Search("typescript tutorial")
    .Limit(20)
    .GetListAsync();
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto results = client.db("app").table("posts")
    .search("typescript tutorial")
    .limit(20)
    .getList();
```

</TabItem>
</Tabs>

`.search()` can be combined with `.where()`, `.orderBy()`, and `.limit()` like any other query. Uses trigram tokenizer for CJK language support.

For more details, see [Advanced — Full-Text Search](advanced#full-text-search).

---

## Quotas & Limits

### Rate Limits (per IP, 60-second window)

| Category | Limit |
|----------|-------|
| Database (CRUD) | 100 requests/min |
| Storage | 50 requests/min |
| Functions | 50 requests/min |
| Auth | 30 requests/min |
| Sign In | 10 requests/min |
| Sign Up | 10 requests/min |

When exceeded, the server returns `429 Too Many Requests`.

### Operation Limits

| Limit | Value |
|-------|-------|
| Batch size (insertMany, upsertMany) | 500 items per request |
| SDK auto-chunking | Splits >500 items into sequential 500-item chunks |
| OR conditions per query | 5 max |
| Default page size | 20 |
| Storage file list | 1,000 files max per request |
| Database subscription server filters | 5 conditions max |
| Presence state size | 1 KB max |
| WebSocket pending connections | 5 per IP |
