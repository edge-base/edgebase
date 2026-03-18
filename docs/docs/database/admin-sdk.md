---
sidebar_position: 2
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Admin SDK

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Database operations from the server using a Service Key. All operations **bypass** [Access Rules](/docs/server/access-rules).

:::info Language Coverage
The server-side database API is available in all Admin SDKs.
:::

## Setup

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
import { createAdminClient } from '@edge-base/admin';

const admin = createAdminClient('https://my-app.edgebase.fun', {
  serviceKey: process.env.EDGEBASE_SERVICE_KEY,
});
```

Inside [App Functions](/docs/functions), the URL and Service Key are detected from environment variables automatically:

```typescript
const admin = createAdminClient();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
import 'package:edgebase_admin/edgebase_admin.dart';

final admin = AdminEdgeBase(
  'https://my-app.edgebase.fun',
  serviceKey: Platform.environment['EDGEBASE_SERVICE_KEY']!,
);
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
import dev.edgebase.sdk.admin.AdminEdgeBase

val admin = AdminEdgeBase(
    "https://my-app.edgebase.fun",
    System.getenv("EDGEBASE_SERVICE_KEY")
)
```

</TabItem>
<TabItem value="java" label="Java">

```java
import dev.edgebase.sdk.admin.*;

AdminEdgeBase admin = EdgeBase.admin(
    "https://my-app.edgebase.fun",
    System.getenv("EDGEBASE_SERVICE_KEY")
);
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
import dev.edgebase.sdk.scala.admin.AdminEdgeBase

val admin = AdminEdgeBase(
  "https://my-app.edgebase.fun",
  sys.env("EDGEBASE_SERVICE_KEY")
)
```

</TabItem>
<TabItem value="python" label="Python">

```python
import os
from edgebase_admin import AdminClient

admin = AdminClient(
    'https://my-app.edgebase.fun',
    service_key=os.environ['EDGEBASE_SERVICE_KEY'],
)
```

</TabItem>
<TabItem value="go" label="Go">

```go
import edgebase "github.com/edge-base/sdk-go"

admin := edgebase.NewAdminClient("https://my-app.edgebase.fun", os.Getenv("EDGEBASE_SERVICE_KEY"))
```

</TabItem>
<TabItem value="php" label="PHP">

```php
use EdgeBase\Admin\AdminClient;

$admin = new AdminClient('https://my-app.edgebase.fun', getenv('EDGEBASE_SERVICE_KEY'));
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
use edgebase_admin::EdgeBase;

let admin = EdgeBase::server(
    "https://my-app.edgebase.fun",
    &std::env::var("EDGEBASE_SERVICE_KEY").unwrap(),
)?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
using EdgeBase.Admin;

var admin = new AdminClient("https://my-app.edgebase.fun", Environment.GetEnvironmentVariable("EDGEBASE_SERVICE_KEY"));
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
require "edgebase_admin"

admin = EdgebaseAdmin::AdminClient.new(
  "https://my-app.edgebase.fun",
  service_key: ENV.fetch("EDGEBASE_SERVICE_KEY")
)
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseAdmin

admin =
  EdgeBaseAdmin.new("https://my-app.edgebase.fun",
    service_key: System.fetch_env!("EDGEBASE_SERVICE_KEY")
  )
```

</TabItem>
</Tabs>

:::info No Per-Category Rate Limits
Admin SDK requests authenticated with a Service Key bypass EdgeBase's app-level rate limits entirely, including `global`. This makes Admin SDK suitable for high-throughput server-to-server operations.
:::

Use `admin.db(namespace, id?)` to select a DB block, then `.table(name)` to access a table:

```typescript
admin.db('app')                    // single-instance DB block
admin.db('workspace', 'ws-456')       // workspace-isolated DB block
admin.db('user', userId)              // per-user DB block
```

Single-instance block names are just config keys. Older docs may show `shared`, but `app`, `catalog`, or any other descriptive name works the same way.

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

const posts = admin.db('app').table<Post>('posts');

// All return types are now typed as Post
const post = await posts.getOne('post-id');         // Post
const result = await posts.getList();               // ListResult<Post>
const first = await posts.getFirst();               // Post | null

// Insert/update data is typed as Partial<Post>
await posts.insert({ title: 'Hello', content: '...', status: 'draft' });
await posts.update('post-id', { status: 'published' });
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
| 401 | Unauthorized | Invalid Service Key |
| 403 | Forbidden | Operation not permitted |
| 404 | Not Found | Record or table doesn't exist |

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
import { EdgeBaseError } from '@edge-base/core';

try {
  await admin.db('app').table('posts').getOne('nonexistent');
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
  await admin.db('app').table('posts').getOne('nonexistent');
} on EdgeBaseError catch (e) {
  print(e.status);    // 404
  print(e.message);   // "Not found."
}
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
try {
    val post = admin.db("app").table("posts").getOne("nonexistent")
} catch (e: EdgeBaseError) {
    println(e.status)    // 404
    println(e.message)   // "Not found."
}
```

</TabItem>
<TabItem value="java" label="Java">

```java
try {
    var post = admin.db("app").table("posts").getOne("nonexistent");
} catch (EdgeBaseError e) {
    System.out.println(e.getStatus());   // 404
    System.out.println(e.getMessage());  // "Not found."
}
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
import dev.edgebase.sdk.scala.core.EdgeBaseError

try {
  admin.db("app").table("posts").getOne("nonexistent")
} catch {
  case e: EdgeBaseError =>
    println(e.statusCode) // 404
    println(e.reason)     // "Not found."
}
```

</TabItem>
<TabItem value="python" label="Python">

```python
from edgebase_core.errors import EdgeBaseError

try:
    admin.db('app').table('posts').get_one('nonexistent')
except EdgeBaseError as e:
    print(e.status_code)  # 404
    print(e.message)      # "Not found."
```

</TabItem>
<TabItem value="go" label="Go">

```go
post, err := client.DB("app", "").Table("posts").GetOne(ctx, "nonexistent")
if err != nil {
    fmt.Println(err) // "HTTP 404: Not found."
}
```

</TabItem>
<TabItem value="php" label="PHP">

```php
use EdgeBase\EdgeBaseException;

try {
    $admin->db('app')->table('posts')->getOne('nonexistent');
} catch (EdgeBaseException $e) {
    echo $e->getStatusCode(); // 404
    echo $e->getMessage();    // "Not found."
}
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
match admin.db("app").table("posts").get_one("nonexistent").await {
    Ok(post) => println!("{:?}", post),
    Err(e) => eprintln!("{}", e), // "HTTP 404: Not found."
}
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
try {
    var post = await admin.Db("app").Table("posts").GetOneAsync("nonexistent");
} catch (EdgeBaseException e) {
    Console.WriteLine(e.StatusCode); // 404
    Console.WriteLine(e.Message);    // "Not found."
}
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
begin
  admin.db("app").table("posts").get_one("nonexistent")
rescue EdgebaseCore::EdgeBaseError => e
  puts e.status_code
  puts e.message
end
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseCore.{DbRef, Error, TableRef}

try do
  admin
  |> EdgeBaseAdmin.db("app")
  |> DbRef.table("posts")
  |> TableRef.get_one!("nonexistent")
rescue
  e in Error ->
    IO.inspect(e.status_code) # 404
    IO.puts(e.message)        # "Not found."
end
```

</TabItem>
</Tabs>

---

## Insert

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const post = await admin.db('app').table('posts').insert({
  title: 'Hello World',
  content: 'My first post.',
  status: 'published',
});
// post.id → "0192d3a4-..."  (UUID v7, auto-generated)
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final post = await admin.db('app').table('posts').insert({
  'title': 'Hello World',
  'content': 'My first post.',
  'status': 'published',
});
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val post = admin.db("app").table("posts").insert(mapOf(
    "title" to "Hello World",
    "content" to "My first post.",
    "status" to "published"
))
```

</TabItem>
<TabItem value="java" label="Java">

```java
Map<String, Object> post = admin.db("app").table("posts").insert(Map.of(
    "title", "Hello World",
    "content", "My first post.",
    "status", "published"
));
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val post = admin.db("app").table("posts").insert(Map(
  "title" -> "Hello World",
  "content" -> "My first post.",
  "status" -> "published",
))
```

</TabItem>
<TabItem value="python" label="Python">

```python
post = admin.db('app').table('posts').insert({
    'title': 'Hello World',
    'content': 'My first post.',
    'status': 'published',
})
```

</TabItem>
<TabItem value="go" label="Go">

```go
post, err := client.DB("app", "").Table("posts").Insert(ctx, map[string]any{
    "title":   "Hello World",
    "content": "My first post.",
    "status":  "published",
})
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$post = $admin->db('app')->table('posts')->insert([
    'title' => 'Hello World',
    'content' => 'My first post.',
    'status' => 'published',
]);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let post = admin.db("app").table("posts").insert(&json!({
    "title": "Hello World",
    "content": "My first post.",
    "status": "published",
})).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var post = await admin.Db("app").Table("posts").InsertAsync(new() {
    ["title"] = "Hello World",
    ["content"] = "My first post.",
    ["status"] = "published",
});
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
post = admin.db("app").table("posts").insert({
  "title" => "Hello World",
  "content" => "My first post.",
  "status" => "published",
})
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseCore.{DbRef, TableRef}

post =
  admin
  |> EdgeBaseAdmin.db("app")
  |> DbRef.table("posts")
  |> TableRef.insert!(%{
    "title" => "Hello World",
    "content" => "My first post.",
    "status" => "published"
  })
```

</TabItem>
</Tabs>

## Read

### Get a single record

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const post = await admin.db('app').table('posts').getOne('record-id');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final post = await admin.db('app').table('posts').getOne('record-id');
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val post = admin.db("app").table("posts").getOne("record-id")
```

</TabItem>
<TabItem value="java" label="Java">

```java
Map<String, Object> post = admin.db("app").table("posts").getOne("record-id");
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val post = admin.db("app").table("posts").getOne("record-id")
```

</TabItem>
<TabItem value="python" label="Python">

```python
post = admin.db('app').table('posts').get_one('record-id')
```

</TabItem>
<TabItem value="go" label="Go">

```go
post, err := client.DB("app", "").Table("posts").GetOne(ctx, "record-id")
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$post = $admin->db('app')->table('posts')->getOne('record-id');
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let post = admin.db("app").table("posts").get_one("record-id").await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var post = await admin.Db("app").Table("posts").GetOneAsync("record-id");
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
post = admin.db("app").table("posts").get_one("record-id")
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseCore.{DbRef, TableRef}

post =
  admin
  |> EdgeBaseAdmin.db("app")
  |> DbRef.table("posts")
  |> TableRef.get_one!("record-id")
```

</TabItem>
</Tabs>

:::tip doc() Pattern
JS, Python, Dart, Kotlin, Java, Scala, Ruby, and Elixir SDKs also support the `doc()` pattern for single-record operations:

```js
const ref = admin.db('app').table('posts').doc('record-id');
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
const user = await admin.db('app').table('users')
  .where('email', '==', 'june@example.com')
  .getFirst();
// user → T | null
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final user = await admin.db('app').table('users')
    .where('email', '==', 'june@example.com')
    .getFirst();
// user → Map<String, dynamic>?
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val user = admin.db("app").table("users")
    .where("email", "==", "june@example.com")
    .getFirst()
// user → Map<String, Any>?
```

</TabItem>
<TabItem value="java" label="Java">

```java
Map<String, Object> user = admin.db("app").table("users")
    .where("email", "==", "june@example.com")
    .getFirst();
// user → null if not found
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val user = admin.db("app").table("users")
  .where("email", "==", "june@example.com")
  .getFirst()
// user → Option[Map[String, Any]]
```

</TabItem>
<TabItem value="python" label="Python">

```python
user = admin.db('app').table('users') \
    .where('email', '==', 'june@example.com') \
    .get_first()
# user → dict | None
```

</TabItem>
<TabItem value="go" label="Go">

```go
user, err := client.DB("app", "").Table("users").
    Where("email", "==", "june@example.com").
    GetFirst(ctx)
// user → map[string]any (nil if not found)
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$user = $admin->db('app')->table('users')
    ->where('email', '==', 'june@example.com')
    ->getFirst();
// $user → ?array
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let user = admin.db("app").table("users")
    .where_("email", "==", "june@example.com")
    .get_first()
    .await?;
// user → Option<T>
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var user = await admin.Db("app").Table("users")
    .Where("email", "==", "june@example.com")
    .GetFirstAsync();
// user → T?
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
user = admin.db("app").table("users")
  .where("email", "==", "june@example.com")
  .get_first
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseCore.{DbRef, TableRef}

user =
  admin
  |> EdgeBaseAdmin.db("app")
  |> DbRef.table("users")
  |> TableRef.where("email", "==", "june@example.com")
  |> TableRef.get_first!()
# user → map() | nil
```

</TabItem>
</Tabs>

> Internally calls `.limit(1).getList()` and returns the first item. No special server endpoint needed.

### List records

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const result = await admin.db('app').table('posts')
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
final result = await admin.db('app').table('posts')
    .orderBy('createdAt', direction: 'desc')
    .limit(20)
    .getList();
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = admin.db("app").table("posts")
    .orderBy("createdAt", "desc")
    .limit(20)
    .getList()
```

</TabItem>
<TabItem value="java" label="Java">

```java
ListResult result = admin.db("app").table("posts")
    .orderBy("createdAt", "desc")
    .limit(20)
    .getList();
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val result = admin.db("app").table("posts")
  .orderBy("createdAt", "desc")
  .limit(20)
  .getList()
```

</TabItem>
<TabItem value="python" label="Python">

```python
result = admin.db('app').table('posts') \
    .order_by('createdAt', 'desc') \
    .limit(20) \
    .get_list()
```

</TabItem>
<TabItem value="go" label="Go">

```go
result, err := client.DB("app", "").Table("posts").
    OrderBy("createdAt", "desc").
    Limit(20).
    GetList(ctx)
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$result = $admin->db('app')->table('posts')
    ->orderBy('createdAt', 'desc')
    ->limit(20)
    ->getList();
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let result = admin.db("app").table("posts")
    .order_by("createdAt", "desc")
    .limit(20)
    .get_list()
    .await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await admin.Db("app").Table("posts")
    .OrderBy("createdAt", "desc")
    .Limit(20)
    .GetListAsync();
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
result = admin.db("app").table("posts")
  .order_by("createdAt", "desc")
  .limit(20)
  .get_list
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseCore.{DbRef, TableRef}

result =
  admin
  |> EdgeBaseAdmin.db("app")
  |> DbRef.table("posts")
  |> TableRef.order_by("createdAt", "desc")
  |> TableRef.limit(20)
  |> TableRef.get_list!()
```

</TabItem>
</Tabs>

## Update

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await admin.db('app').table('posts').update('record-id', {
  title: 'Updated Title',
  status: 'published',
});
```

### Field Operators

```typescript
import { increment, deleteField } from '@edge-base/core';

await admin.db('app').table('posts').update('record-id', {
  views: increment(1),           // Atomic increment
  tempField: deleteField(),       // Set to NULL
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await admin.db('app').table('posts').update('record-id', {
  'title': 'Updated Title',
  'views': EdgeBase.increment(1),
  'tempField': EdgeBase.deleteField(),
});
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
admin.db("app").table("posts").update("record-id", mapOf(
    "title" to "Updated Title",
    "views" to EdgeBase.increment(1),
    "tempField" to EdgeBase.deleteField()
))
```

</TabItem>
<TabItem value="java" label="Java">

```java
admin.db("app").table("posts").update("record-id", Map.of(
    "title", "Updated Title",
    "views", EdgeBaseFieldOps.increment(1),
    "tempField", EdgeBaseFieldOps.deleteField()
));
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
import dev.edgebase.sdk.core.FieldOps

admin.db("app").table("posts").update("record-id", Map(
  "title" -> "Updated Title",
  "views" -> FieldOps.increment(1),
  "tempField" -> FieldOps.deleteField(),
))
```

</TabItem>
<TabItem value="python" label="Python">

```python
admin.db('app').table('posts').update('record-id', {
    'title': 'Updated Title',
    'views': eb.increment(1),
    'temp_field': eb.delete_field(),
})
```

</TabItem>
<TabItem value="go" label="Go">

```go
updated, err := client.DB("app", "").Table("posts").Update(ctx, "record-id", map[string]any{
    "title":     "Updated Title",
    "views":     edgebase.Increment(1),
    "tempField": edgebase.DeleteField(),
})
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$updated = $admin->db('app')->table('posts')->update('record-id', [
    'title' => 'Updated Title',
    'views' => FieldOps::increment(1),
    'tempField' => FieldOps::deleteField(),
]);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let updated = admin.db("app").table("posts").update("record-id", &json!({
    "title": "Updated Title",
    "views": field_ops::increment(1),
    "tempField": field_ops::delete_field(),
})).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var updated = await admin.Db("app").Table("posts").UpdateAsync("record-id", new() {
    ["title"] = "Updated Title",
    ["views"] = FieldOps.Increment(1),
    ["tempField"] = FieldOps.DeleteField(),
});
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
updated = admin.db("app").table("posts").update("record-id", {
  "title" => "Updated Title",
  "views" => EdgebaseCore::FieldOps.increment(1),
  "tempField" => EdgebaseCore::FieldOps.delete_field,
})
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseCore.{DbRef, FieldOps, TableRef}

admin
|> EdgeBaseAdmin.db("app")
|> DbRef.table("posts")
|> TableRef.update!("record-id", %{
  "title" => "Updated Title",
  "views" => FieldOps.increment(1),
  "tempField" => FieldOps.delete_field()
})
```

</TabItem>
</Tabs>

## Delete

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await admin.db('app').table('posts').delete('record-id');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await admin.db('app').table('posts').delete('record-id');
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
admin.db("app").table("posts").delete("record-id")
```

</TabItem>
<TabItem value="java" label="Java">

```java
admin.db("app").table("posts").delete("record-id");
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
admin.db("app").table("posts").delete("record-id")
```

</TabItem>
<TabItem value="python" label="Python">

```python
admin.db('app').table('posts').delete('record-id')
```

</TabItem>
<TabItem value="go" label="Go">

```go
err := client.DB("app", "").Table("posts").Delete(ctx, "record-id")
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$admin->db('app')->table('posts')->delete('record-id');
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
admin.db("app").table("posts").delete("record-id").await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await admin.Db("app").Table("posts").DeleteAsync("record-id");
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
admin.db("app").table("posts").delete("record-id")
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseCore.{DbRef, TableRef}

admin
|> EdgeBaseAdmin.db("app")
|> DbRef.table("posts")
|> TableRef.delete!("record-id")
```

</TabItem>
</Tabs>

---

## Queries

### Filtering

Use `where()` to filter records. Multiple `where()` calls are combined with **AND**. Available operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `in`, `not in`.

:::tip OR Conditions
Use `.or()` to combine conditions with OR logic. Conditions inside `.or()` are joined with **OR**, while multiple `.where()` calls remain **AND**. A maximum of 5 conditions are allowed inside a single `.or()` group.

```typescript
// OR across different fields
const results = await admin.db('app').table('posts')
  .or(q => q.where('status', '==', 'draft').where('authorId', '==', userId))
  .getList();

// AND + OR combined
const results = await admin.db('app').table('posts')
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
const published = await admin.db('app').table('posts')
  .where('status', '==', 'published')
  .getList();

// Multiple filters (AND)
const myPosts = await admin.db('app').table('posts')
  .where('authorId', '==', currentUser.id)
  .where('status', '==', 'published')
  .getList();

// Contains (partial text match)
const results = await admin.db('app').table('posts')
  .where('title', 'contains', 'tutorial')
  .getList();

// In (match any of the values)
const featured = await admin.db('app').table('posts')
  .where('status', 'in', ['published', 'featured'])
  .getList();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final published = await admin.db('app').table('posts')
    .where('status', '==', 'published')
    .getList();

final myPosts = await admin.db('app').table('posts')
    .where('authorId', '==', currentUser.id)
    .where('status', '==', 'published')
    .getList();
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val published = admin.db("app").table("posts")
    .where("status", "==", "published")
    .getList()
```

</TabItem>
<TabItem value="java" label="Java">

```java
ListResult published = admin.db("app").table("posts")
    .where("status", "==", "published")
    .getList();
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val published = admin.db("app").table("posts")
  .where("status", "==", "published")
  .getList()
```

</TabItem>
<TabItem value="python" label="Python">

```python
published = admin.db('app').table('posts') \
    .where('status', '==', 'published') \
    .get_list()
```

</TabItem>
<TabItem value="go" label="Go">

```go
published, err := client.DB("app", "").Table("posts").
    Where("status", "==", "published").
    GetList(ctx)
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$published = $admin->db('app')->table('posts')
    ->where('status', '==', 'published')
    ->getList();
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let published = admin.db("app").table("posts")
    .where_("status", "==", "published")
    .get_list()
    .await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var published = await admin.Db("app").Table("posts")
    .Where("status", "==", "published")
    .GetListAsync();
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
published = admin.db("app").table("posts")
  .where("status", "==", "published")
  .get_list
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseCore.{DbRef, TableRef}

published =
  admin
  |> EdgeBaseAdmin.db("app")
  |> DbRef.table("posts")
  |> TableRef.where("status", "==", "published")
  |> TableRef.get_list!()
```

</TabItem>
</Tabs>

### Sorting

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// Single sort
const latest = await admin.db('app').table('posts')
  .orderBy('createdAt', 'desc')
  .getList();

// Multi-sort
const sorted = await admin.db('app').table('posts')
  .orderBy('status', 'asc')
  .orderBy('createdAt', 'desc')
  .getList();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final latest = await admin.db('app').table('posts')
    .orderBy('createdAt', direction: 'desc')
    .getList();
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val latest = admin.db("app").table("posts")
    .orderBy("createdAt", "desc")
    .getList()
```

</TabItem>
<TabItem value="java" label="Java">

```java
ListResult latest = admin.db("app").table("posts")
    .orderBy("createdAt", "desc")
    .getList();
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val latest = admin.db("app").table("posts")
  .orderBy("createdAt", "desc")
  .getList()
```

</TabItem>
<TabItem value="python" label="Python">

```python
latest = admin.db('app').table('posts') \
    .order_by('createdAt', 'desc') \
    .get_list()
```

</TabItem>
<TabItem value="go" label="Go">

```go
latest, err := client.DB("app", "").Table("posts").
    OrderBy("createdAt", "desc").
    GetList(ctx)
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$latest = $admin->db('app')->table('posts')
    ->orderBy('createdAt', 'desc')
    ->getList();
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let latest = admin.db("app").table("posts")
    .order_by("createdAt", "desc")
    .get_list()
    .await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var latest = await admin.Db("app").Table("posts")
    .OrderBy("createdAt", "desc")
    .GetListAsync();
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
latest = admin.db("app").table("posts")
  .order_by("createdAt", "desc")
  .get_list
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseCore.{DbRef, TableRef}

latest =
  admin
  |> EdgeBaseAdmin.db("app")
  |> DbRef.table("posts")
  |> TableRef.order_by("createdAt", "desc")
  |> TableRef.get_list!()
```

</TabItem>
</Tabs>

### Pagination

#### Offset Pagination

```typescript
// Using offset
const page2 = await admin.db('app').table('posts')
  .limit(20)
  .offset(20)
  .getList();

// Using page (alias for offset-based pagination)
const page3 = await admin.db('app').table('posts')
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
const firstPage = await admin.db('app').table('posts')
  .limit(20)
  .getList();

// Next page using cursor (forward)
const nextPage = await admin.db('app').table('posts')
  .limit(20)
  .after(firstPage.items[firstPage.items.length - 1].id)
  .getList();

// Previous page using cursor (backward)
const prevPage = await admin.db('app').table('posts')
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
const total = await admin.db('app').table('posts').count();
// total → 150

// With filter
const published = await admin.db('app').table('posts')
  .where('status', '==', 'published')
  .count();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final total = await admin.db('app').table('posts').count();
final published = await admin.db('app').table('posts')
    .where('status', '==', 'published')
    .count();
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val total = admin.db("app").table("posts").count()
```

</TabItem>
<TabItem value="java" label="Java">

```java
int total = admin.db("app").table("posts").count();
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val total = admin.db("app").table("posts").count()
val published = admin.db("app").table("posts")
  .where("status", "==", "published")
  .count()
```

</TabItem>
<TabItem value="python" label="Python">

```python
total = admin.db('app').table('posts').count()
```

</TabItem>
<TabItem value="go" label="Go">

```go
total, err := client.DB("app", "").Table("posts").Count(ctx)
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$total = $admin->db('app')->table('posts')->count();
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let total = admin.db("app").table("posts").count().await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
int total = await admin.Db("app").Table("posts").CountAsync();
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
total = admin.db("app").table("posts").count
published = admin.db("app").table("posts")
  .where("status", "==", "published")
  .count
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseCore.{DbRef, TableRef}

posts =
  admin
  |> EdgeBaseAdmin.db("app")
  |> DbRef.table("posts")

total = TableRef.count!(posts)
published = posts |> TableRef.where("status", "==", "published") |> TableRef.count!()
```

</TabItem>
</Tabs>

---

## Batch Operations

### insertMany

Create multiple records in a single atomic transaction (all-or-nothing):

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const posts = await admin.db('app').table('posts').insertMany([
  { title: 'Post 1', status: 'published' },
  { title: 'Post 2', status: 'draft' },
  { title: 'Post 3', status: 'published' },
]);
// All succeed or all fail (single transaction)
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final posts = await admin.db('app').table('posts').insertMany([
  {'title': 'Post 1', 'status': 'published'},
  {'title': 'Post 2', 'status': 'draft'},
  {'title': 'Post 3', 'status': 'published'},
]);
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val posts = admin.db("app").table("posts").insertMany(listOf(
    mapOf("title" to "Post 1", "status" to "published"),
    mapOf("title" to "Post 2", "status" to "draft"),
))
```

</TabItem>
<TabItem value="java" label="Java">

```java
BatchResult posts = admin.db("app").table("posts").insertMany(List.of(
    Map.of("title", "Post 1", "status", "published"),
    Map.of("title", "Post 2", "status", "draft")
));
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val posts = admin.db("app").table("posts").insertMany(Seq(
  Map("title" -> "Post 1", "status" -> "published"),
  Map("title" -> "Post 2", "status" -> "draft"),
))
```

</TabItem>
<TabItem value="python" label="Python">

```python
posts = admin.db('app').table('posts').insert_many([
    {'title': 'Post 1', 'status': 'published'},
    {'title': 'Post 2', 'status': 'draft'},
])
```

</TabItem>
<TabItem value="go" label="Go">

```go
posts, err := client.DB("app", "").Table("posts").InsertMany(ctx, []map[string]any{
    {"title": "Post 1", "status": "published"},
    {"title": "Post 2", "status": "draft"},
})
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$posts = $admin->db('app')->table('posts')->insertMany([
    ['title' => 'Post 1', 'status' => 'published'],
    ['title' => 'Post 2', 'status' => 'draft'],
]);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let posts = admin.db("app").table("posts").insert_many(vec![
    json!({"title": "Post 1", "status": "published"}),
    json!({"title": "Post 2", "status": "draft"}),
]).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var posts = await admin.Db("app").Table("posts").InsertManyAsync(new[] {
    new Dictionary<string, object> { ["title"] = "Post 1", ["status"] = "published" },
    new Dictionary<string, object> { ["title"] = "Post 2", ["status"] = "draft" },
});
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
posts = admin.db("app").table("posts").insert_many([
  { "title" => "Post 1", "status" => "published" },
  { "title" => "Post 2", "status" => "draft" },
])
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseCore.{DbRef, TableRef}

posts =
  admin
  |> EdgeBaseAdmin.db("app")
  |> DbRef.table("posts")
  |> TableRef.insert_many!([
    %{"title" => "Post 1", "status" => "published"},
    %{"title" => "Post 2", "status" => "draft"}
  ])
```

</TabItem>
</Tabs>

### updateMany

Update all records matching a filter condition:

:::note Go Coverage
:::


<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const result = await admin.db('app').table('posts')
  .where('status', '==', 'draft')
  .updateMany({ status: 'archived' });
// result.totalProcessed → 42, result.totalSucceeded → 42
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await admin.db('app').table('posts')
    .where('status', '==', 'draft')
    .updateMany({'status': 'archived'});
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = admin.db("app").table("posts")
    .where("status", "==", "draft")
    .updateMany(mapOf("status" to "archived"))
```

</TabItem>
<TabItem value="java" label="Java">

```java
BatchResult result = admin.db("app").table("posts")
    .where("status", "==", "draft")
    .updateMany(Map.of("status", "archived"));
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val result = admin.db("app").table("posts")
  .where("status", "==", "draft")
  .updateMany(Map("status" -> "archived"))
```

</TabItem>
<TabItem value="python" label="Python">

```python
result = admin.db('app').table('posts') \
    .where('status', '==', 'draft') \
    .update_many({'status': 'archived'})
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$result = $admin->db('app')->table('posts')
    ->where('status', '==', 'draft')
    ->updateMany(['status' => 'archived']);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let result = admin.db("app").table("posts")
    .where_("status", "==", "draft")
    .update_many(&json!({"status": "archived"}))
    .await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await admin.Db("app").Table("posts")
    .Where("status", "==", "draft")
    .UpdateManyAsync(new() { ["status"] = "archived" });
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
result = admin.db("app").table("posts")
  .where("status", "==", "draft")
  .update_many({ "status" => "archived" })
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseCore.{DbRef, TableRef}

result =
  admin
  |> EdgeBaseAdmin.db("app")
  |> DbRef.table("posts")
  |> TableRef.where("status", "==", "draft")
  |> TableRef.update_many!(%{"status" => "archived"})
```

</TabItem>
</Tabs>

### deleteMany

Delete all records matching a filter condition:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const result = await admin.db('app').table('posts')
  .where('status', '==', 'archived')
  .deleteMany();
// result.totalProcessed → 15, result.totalSucceeded → 15
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await admin.db('app').table('posts')
    .where('status', '==', 'archived')
    .deleteMany();
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = admin.db("app").table("posts")
    .where("status", "==", "archived")
    .deleteMany()
```

</TabItem>
<TabItem value="java" label="Java">

```java
BatchResult result = admin.db("app").table("posts")
    .where("status", "==", "archived")
    .deleteMany();
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val result = admin.db("app").table("posts")
  .where("status", "==", "archived")
  .deleteMany()
```

</TabItem>
<TabItem value="python" label="Python">

```python
result = admin.db('app').table('posts') \
    .where('status', '==', 'archived') \
    .delete_many()
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$result = $admin->db('app')->table('posts')
    ->where('status', '==', 'archived')
    ->deleteMany();
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let result = admin.db("app").table("posts")
    .where_("status", "==", "archived")
    .delete_many()
    .await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await admin.Db("app").Table("posts")
    .Where("status", "==", "archived")
    .DeleteManyAsync();
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
result = admin.db("app").table("posts")
  .where("status", "==", "archived")
  .delete_many
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseCore.{DbRef, TableRef}

result =
  admin
  |> EdgeBaseAdmin.db("app")
  |> DbRef.table("posts")
  |> TableRef.where("status", "==", "archived")
  |> TableRef.delete_many!()
```

</TabItem>
</Tabs>

### upsertMany

Batch upsert — insert or update multiple records atomically:

```typescript
await admin.db('app').table('settings').upsertMany([
  { id: 'theme', value: 'dark' },
  { id: 'lang', value: 'ko' },
]);
```

You can also upsert by a unique field using `conflictTarget`:

```typescript
await admin.db('app').table('categories').upsertMany(
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

:::note Go SDK
:::

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
const results = await admin.db('app').table('posts')
  .search('typescript tutorial')
  .limit(20)
  .getList();

// results.items → ranked by relevance
// results.items[0].highlight → { title: "...<mark>TypeScript</mark> <mark>Tutorial</mark>..." }
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final results = await admin.db('app').table('posts')
    .search('typescript tutorial')
    .limit(20)
    .getList();
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val results = admin.db("app").table("posts")
    .search("typescript tutorial")
    .limit(20)
    .getList()
```

</TabItem>
<TabItem value="java" label="Java">

```java
ListResult results = admin.db("app").table("posts")
    .search("typescript tutorial")
    .limit(20)
    .getList();
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val results = admin.db("app").table("posts")
  .search("typescript tutorial")
  .limit(20)
  .getList()
```

</TabItem>
<TabItem value="python" label="Python">

```python
results = admin.db('app').table('posts') \
    .search('typescript tutorial') \
    .limit(20) \
    .get_list()
```

</TabItem>
<TabItem value="go" label="Go">

```go
results, err := client.DB("app", "").Table("posts").
    Search("typescript tutorial").
    Limit(20).
    GetList(ctx)
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$results = $admin->db('app')->table('posts')
    ->search('typescript tutorial')
    ->limit(20)
    ->getList();
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let results = admin.db("app").table("posts")
    .search("typescript tutorial")
    .limit(20)
    .get_list()
    .await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var results = await admin.Db("app").Table("posts")
    .Search("typescript tutorial")
    .Limit(20)
    .GetListAsync();
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
results = admin.db("app").table("posts")
  .search("typescript tutorial")
  .limit(20)
  .get_list
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseCore.{DbRef, TableRef}

results =
  admin
  |> EdgeBaseAdmin.db("app")
  |> DbRef.table("posts")
  |> TableRef.search("typescript tutorial")
  |> TableRef.limit(20)
  |> TableRef.get_list!()
```

</TabItem>
</Tabs>

`.search()` can be combined with `.where()`, `.orderBy()`, and `.limit()` like any other query. Uses trigram tokenizer for CJK language support.

For more details, see [Advanced — Full-Text Search](advanced#full-text-search).

---

## Raw SQL (App Functions Only)

Inside [App Functions](/docs/functions), you can execute raw SQL using `admin.sql()`:

```typescript
// functions/analytics.ts
import { defineFunction } from '@edge-base/shared';

export default defineFunction({
  trigger: { type: 'http', path: '/api/functions/analytics-top-authors', method: 'GET' },
  handler: async (context) => {
    const topAuthors = await context.admin.sql(
      'posts',
      'SELECT authorId, COUNT(*) as postCount FROM posts WHERE status = ? GROUP BY authorId ORDER BY postCount DESC LIMIT ?',
      ['published', 10]
    );
    return Response.json(topAuthors);
  },
});
```

:::tip Alternative API
The `db.sql` tagged template is also available as an alternative syntax. Both forms are fully supported:

```typescript
// Tagged template
const rows = await context.admin.db('app').sql`SELECT * FROM posts WHERE status = ${'published'}`;

// Parameterized (recommended for dynamic queries)
const rows = await context.admin.sql('posts', 'SELECT * FROM posts WHERE status = ?', ['published']);
```
:::
