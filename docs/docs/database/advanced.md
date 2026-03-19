---
sidebar_position: 10
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Advanced

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Upsert, Full-Text Search, Aggregation, and Indexes.

## Upsert

Insert a new record or update an existing one (by `id`):

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const result = await admin.db('app').table('settings').upsert({
  id: 'user-preferences',
  theme: 'dark',
  language: 'ko',
});
// result.action → "inserted" or "updated"
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await admin.db('app').table('settings').upsert({
  'id': 'user-preferences',
  'theme': 'dark',
  'language': 'ko',
});
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let result = try await admin.db("app").table("settings").upsert([
    "id": "user-preferences",
    "theme": "dark",
    "language": "ko"
])
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = admin.db("app").table("settings").upsert(mapOf(
    "id" to "user-preferences",
    "theme" to "dark",
    "language" to "ko"
))
```

</TabItem>

<TabItem value="java" label="Java">

```java
Map<String, Object> result = admin.db("app").table("settings").upsert(Map.of(
    "id", "user-preferences",
    "theme", "dark",
    "language", "ko"
));
```

</TabItem>
<TabItem value="python" label="Python">

```python
result = admin.db('app').table('settings').upsert({
    'id': 'user-preferences',
    'theme': 'dark',
    'language': 'ko',
})
```

</TabItem>
<TabItem value="go" label="Go">

```go
result, err := client.DB("app", "").Table("settings").Upsert(ctx, map[string]any{
    "id":       "user-preferences",
    "theme":    "dark",
    "language": "ko",
}, "")
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$result = $client->db('app')->table('settings')->upsert([
    'id' => 'user-preferences',
    'theme' => 'dark',
    'language' => 'ko',
]);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let result = admin.db("app").table("settings").upsert(&json!({
    "id": "user-preferences",
    "theme": "dark",
    "language": "ko",
}), None).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Db("app").Table("settings").UpsertAsync(new() {
    ["id"] = "user-preferences",
    ["theme"] = "dark",
    ["language"] = "ko",
});
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = admin.db("app").table("settings").upsert(R"({
    "id": "user-preferences",
    "theme": "dark",
    "language": "ko"
})");
```

</TabItem>
</Tabs>

### Upsert by Unique Field

By default, upsert matches by `id`. Use `conflictTarget` to match by any unique field instead:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const result = await admin.db('app').table('categories').upsert(
  { name: 'Tech', slug: 'tech', description: 'Technology posts' },
  { conflictTarget: 'slug' }
);
// If slug='tech' exists → update, otherwise → insert
// result.action → "inserted" or "updated"
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await admin.db('app').table('categories').upsert(
  {'name': 'Tech', 'slug': 'tech', 'description': 'Technology posts'},
  conflictTarget: 'slug',
);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let result = try await admin.db("app").table("categories").upsert([
    "name": "Tech",
    "slug": "tech",
    "description": "Technology posts"
], conflictTarget: "slug")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = admin.db("app").table("categories").upsert(
    mapOf("name" to "Tech", "slug" to "tech", "description" to "Technology posts"),
    conflictTarget = "slug"
)
```

</TabItem>

<TabItem value="java" label="Java">

```java
Map<String, Object> result = admin.db("app").table("categories").upsert(
    Map.of("name", "Tech", "slug", "tech", "description", "Technology posts"),
    "slug"
);
```

</TabItem>
<TabItem value="python" label="Python">

```python
result = admin.db('app').table('categories').upsert(
    {'name': 'Tech', 'slug': 'tech', 'description': 'Technology posts'},
    conflict_target='slug'
)
```

</TabItem>
<TabItem value="go" label="Go">

```go
result, err := client.DB("app", "").Table("categories").Upsert(ctx, map[string]any{
    "name": "Tech", "slug": "tech", "description": "Technology posts",
}, "slug")
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$result = $client->db('app')->table('categories')->upsert(
    ['name' => 'Tech', 'slug' => 'tech', 'description' => 'Technology posts'],
    'slug',
);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let result = admin.db("app").table("categories").upsert(&json!({
    "name": "Tech", "slug": "tech", "description": "Technology posts"
}), Some("slug")).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Db("app").Table("categories").UpsertAsync(
    new() { ["name"] = "Tech", ["slug"] = "tech", ["description"] = "Technology posts" },
    "slug"
);
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = admin.db("app").table("categories").upsert(
    R"({"name": "Tech", "slug": "tech", "description": "Technology posts"})",
    "slug"
);
```

</TabItem>
</Tabs>

:::note
The `conflictTarget` field must have a `unique: true` constraint in your schema. Non-unique fields will return a `400 Bad Request` error. Composite unique indexes are not supported in v1.
:::

## Full-Text Search

Search across text fields using SQLite FTS5. Enable FTS in your config:

```typescript
// edgebase.config.ts
databases: {
  app: {
    tables: {
      posts: {
        schema: { /* ... */ },
        fts: ['title', 'content'],  // Enable FTS on these fields
      },
    },
  },
}
```

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const results = await admin.db('app').table('posts').search('typescript tutorial').getList();
// results.items → ranked by relevance
// results.items[0].highlight → { title: "...<mark>TypeScript</mark> <mark>Tutorial</mark>..." }
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final results = await admin.db('app').table('posts').search('typescript tutorial').getList();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let results = try await admin.db("app").table("posts").search("typescript tutorial").getList()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val results = admin.db("app").table("posts").search("typescript tutorial").getList()
```

</TabItem>

<TabItem value="java" label="Java">

```java
ListResult results = admin.db("app").table("posts").search("typescript tutorial").getList();
```

</TabItem>
<TabItem value="python" label="Python">

```python
results = admin.db('app').table('posts').search('typescript tutorial').get_list()
```

</TabItem>
<TabItem value="go" label="Go">

```go
results, err := client.DB("app", "").Table("posts").Search("typescript tutorial").GetList(ctx)
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$results = $client->db('app')->table('posts')->search('typescript tutorial')->getList();
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let results = admin.db("app").table("posts").search("typescript tutorial").getList().await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var results = await client.Db("app").Table("posts").Search("typescript tutorial").GetListAsync();
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto results = admin.db("app").table("posts").search("typescript tutorial").getList();
```

</TabItem>
</Tabs>

## Field Selection (Projection)

You can limit which fields are returned in query results using the `fields` query parameter in the REST API. This reduces payload size when you only need specific columns:

```
GET /api/db/app/tables/posts?fields=id,title,status
```

This returns only `id`, `title`, and `status` for each record instead of all fields.

You can combine `fields` with all other query parameters:

```
GET /api/db/app/tables/posts?fields=id,title&filter=[["status","==","published"]]&sort=createdAt:desc&limit=10
```

:::note
Field selection is a REST API feature. SDK methods currently return all fields. If you need projected queries from an SDK, use raw SQL in [App Functions](/docs/functions).
:::

## Aggregation

EdgeBase supports `count()` for record counting. For advanced aggregations (SUM, AVG, GROUP BY), use raw SQL in [App Functions](/docs/functions):

```typescript
// functions/analytics.ts
export default defineFunction({
  trigger: { type: 'http', path: '/api/functions/stats', method: 'GET' },
  handler: async (context) => {
    const stats = await context.admin.sql(
      'posts',
      'SELECT status, COUNT(*) as count FROM posts GROUP BY status',
      []
    );
    return Response.json(stats);
  },
});
```

## Indexes

### Defining Indexes

```typescript
posts: {
  schema: { /* ... */ },
  indexes: [
    { fields: ['status'] },                    // Single field
    { fields: ['authorId', 'createdAt'] },     // Composite
    { fields: ['slug'], unique: true },        // Unique index
  ],
}
```

### When to Add Indexes

- Fields frequently used in `where()` filters
- Fields used in `orderBy()` sorting
- Fields used as `conflictTarget` in upsert (must be `unique`)
