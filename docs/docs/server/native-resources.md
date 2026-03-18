---
sidebar_position: 8
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Native Resources

Declare and use Cloudflare-native storage resources (KV, D1, Vectorize) directly from your EdgeBase project. These are user-defined resources, completely isolated from EdgeBase's internal bindings.

> For detailed API usage, see the [Native Resources API Reference](/docs/api/native-resources).

## Overview

Native resources are declared in `edgebase.config.ts` and automatically provisioned when you deploy. They provide direct access to Cloudflare's storage primitives for use cases that go beyond EdgeBase's built-in Durable Object collections.

| Resource | What It Is | Best For |
|----------|-----------|----------|
| **KV** | Global key-value store | Caching, sessions, feature flags |
| **D1** | SQLite database | Analytics, logs, relational queries |
| **Vectorize** | Vector search index | Semantic search, RAG, recommendations |

All native resource APIs require a [Service Key](/docs/server/service-keys) (`X-EdgeBase-Service-Key` header). They are not accessible from client SDKs.

:::info Language Coverage
KV, D1, and Vectorize are available from all Admin SDKs.
:::

## Auto-Provisioning

When you run `npx edgebase deploy`, EdgeBase automatically creates any declared resources that do not already exist:

- **KV**: `wrangler kv namespace create`
- **D1**: `wrangler d1 create`
- **Vectorize**: Creates an index with the specified dimensions and metric

Re-deploys are safe. Existing resources are reused without modification.

A temporary `wrangler.toml` is generated with the required bindings during deployment. Your source `wrangler.toml` is never modified.

## Internal vs. User Resources

EdgeBase uses its own internal KV and D1 bindings for system purposes. Today that includes OAuth state in KV plus two internal D1 databases: `AUTH_DB` for auth state and `CONTROL_DB` for plugin/control-plane metadata. User-defined native resources are completely separate Wrangler bindings. There is no way to access internal resources through the native resource APIs, and no risk of collision.

---

## KV Storage

A globally distributed key-value store for caching, session data, and configuration.

### Config

```typescript title="edgebase.config.ts"
import { defineConfig } from '@edgebase-fun/shared';

export default defineConfig({
  kv: {
    cache: { binding: 'CACHE_KV' },
    sessions: { binding: 'SESSIONS_KV' },
  },
});
```

This declares two KV namespaces: `cache` and `sessions`, each with an explicit Wrangler binding name.

### Access Rules

KV namespaces support optional `read` and `write` rules for access control:

```typescript title="edgebase.config.ts"
export default defineConfig({
  kv: {
    cache: {
      binding: 'CACHE_KV',
      rules: {
        read(auth) {
          return auth !== null
        },
        write(auth) {
          return auth !== null && auth.role === 'admin'
        },
      },
    },
  },
});
```

| Rule | Operations | Signature |
|------|-----------|-----------|
| `read` | `get`, `list` | `(auth: AuthContext \| null) => boolean` |
| `write` | `set`, `delete` | `(auth: AuthContext \| null) => boolean` |

Without rules defined, KV access falls back to Service Key validation only. See [Service Keys](/docs/server/service-keys) for scoped access (`kv:namespace:cache:read`, `kv:namespace:cache:write`).

### REST API

```
POST /api/kv/:namespace
Headers: X-EdgeBase-Service-Key: <key>
```

**Get a value:**

```json
{ "action": "get", "key": "user:123" }
```

**Set a value (with optional TTL in seconds):**

```json
{ "action": "set", "key": "user:123", "value": "cached-data", "ttl": 300 }
```

**Delete a key:**

```json
{ "action": "delete", "key": "user:123" }
```

**List keys:**

```json
{ "action": "list", "prefix": "user:", "limit": 100 }
```

### SDK

<Tabs groupId="native-kv-sdk">
<TabItem value="ts" label="TypeScript" default>

```typescript
import { createAdminClient } from '@edgebase-fun/admin';

const admin = createAdminClient('https://your-app.example.com', {
  serviceKey: process.env.EDGEBASE_SERVICE_KEY!,
});

await admin.kv('cache').set('user:123', 'cached-data', { ttl: 300 });
const value = await admin.kv('cache').get('user:123');
const keys = await admin.kv('cache').list({ prefix: 'user:' });
```

</TabItem>
<TabItem value="dart" label="Dart">

```dart
import 'dart:io';
import 'package:edgebase_admin/edgebase_admin.dart';

final admin = AdminEdgeBase(
  'https://your-app.example.com',
  serviceKey: Platform.environment['EDGEBASE_SERVICE_KEY']!,
);

await admin.kv('cache').set('user:123', 'cached-data', ttl: 300);
final value = await admin.kv('cache').get('user:123');
final keys = await admin.kv('cache').list(prefix: 'user:');
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
import dev.edgebase.sdk.admin.AdminEdgeBase

val admin = AdminEdgeBase(
    "https://your-app.example.com",
    serviceKey = System.getenv("EDGEBASE_SERVICE_KEY") ?: ""
)

admin.kv("cache").set("user:123", "cached-data", ttl = 300)
val value = admin.kv("cache").get("user:123")
val keys = admin.kv("cache").list(prefix = "user:")
```

</TabItem>
<TabItem value="java" label="Java">

```java
import dev.edgebase.sdk.admin.*;

AdminEdgeBase admin = EdgeBase.admin(
    "https://your-app.example.com",
    System.getenv("EDGEBASE_SERVICE_KEY")
);

admin.kv("cache").set("user:123", "cached-data", 300);
String value = admin.kv("cache").get("user:123");
Map<String, Object> keys = admin.kv("cache").list("user:", 100, null);
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
import dev.edgebase.sdk.scala.admin.AdminEdgeBase

val admin = AdminEdgeBase(
  "https://your-app.example.com",
  sys.env("EDGEBASE_SERVICE_KEY")
)

admin.kv("cache").set("user:123", "cached-data", Some(300))
val value = admin.kv("cache").get("user:123")
val keys = admin.kv("cache").list(prefix = "user:")
```

</TabItem>
<TabItem value="python" label="Python">

```python
import os
from edgebase_admin import AdminClient

admin = AdminClient(
    "https://your-app.example.com",
    service_key=os.environ["EDGEBASE_SERVICE_KEY"],
)

admin.kv("cache").set("user:123", "cached-data", ttl=300)
value = admin.kv("cache").get("user:123")
keys = admin.kv("cache").list(prefix="user:")
```

</TabItem>
<TabItem value="go" label="Go">

```go
import (
    "context"
    "os"

    edgebase "github.com/edge-base/sdk-go"
)

ctx := context.Background()
admin := edgebase.NewAdminClient("https://your-app.example.com", os.Getenv("EDGEBASE_SERVICE_KEY"))

_ = admin.KV("cache").Set(ctx, "user:123", "cached-data", 300)
value, _ := admin.KV("cache").Get(ctx, "user:123")
keys, _ := admin.KV("cache").List(ctx, "user:", 100, "")
```

</TabItem>
<TabItem value="php" label="PHP">

```php
use EdgeBase\Admin\AdminClient;

$admin = new AdminClient('https://your-app.example.com', getenv('EDGEBASE_SERVICE_KEY'));

$admin->kv('cache')->set('user:123', 'cached-data', 300);
$value = $admin->kv('cache')->get('user:123');
$keys = $admin->kv('cache')->list('user:', 100);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
use edgebase_admin::EdgeBase;

let admin = EdgeBase::server(
    "https://your-app.example.com",
    &std::env::var("EDGEBASE_SERVICE_KEY").unwrap(),
)?;

let kv = admin.kv("cache");
kv.set("user:123", "cached-data", Some(300)).await?;
let value = kv.get("user:123").await?;
let keys = kv.list(Some("user:"), Some(100), None).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
using EdgeBase.Admin;

var admin = new AdminClient(
    "https://your-app.example.com",
    Environment.GetEnvironmentVariable("EDGEBASE_SERVICE_KEY")!
);

await admin.Kv("cache").SetAsync("user:123", "cached-data", ttl: 300);
var value = await admin.Kv("cache").GetAsync("user:123");
var keys = await admin.Kv("cache").ListAsync(prefix: "user:");
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
require "edgebase_admin"

admin = EdgebaseAdmin::AdminClient.new(
  "https://your-app.example.com",
  service_key: ENV.fetch("EDGEBASE_SERVICE_KEY")
)

kv = admin.kv("cache")
kv.set("user:123", "cached-data", ttl: 300)
value = kv.get("user:123")
keys = kv.list(prefix: "user:")
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseAdmin

admin =
  EdgeBaseAdmin.new("https://your-app.example.com",
    service_key: System.fetch_env!("EDGEBASE_SERVICE_KEY")
  )

kv = EdgeBaseAdmin.kv(admin, "cache")
EdgeBaseAdmin.KV.set!(kv, "user:123", "cached-data", ttl: 300)
value = EdgeBaseAdmin.KV.get!(kv, "user:123")
keys = EdgeBaseAdmin.KV.list!(kv, prefix: "user:")
```

</TabItem>
</Tabs>

---

## D1 Database

A full SQL database built on SQLite. Unlike the built-in Durable Object collections, D1 is a standalone database with no per-instance isolation, making it suitable for cross-cutting data like analytics and logs.

### Config

```typescript title="edgebase.config.ts"
import { defineConfig } from '@edgebase-fun/shared';

export default defineConfig({
  d1: {
    analytics: { binding: 'ANALYTICS_DB' },
  },
});
```

Each D1 database is declared by name and mapped to a Wrangler binding.

### REST API

```
POST /api/d1/:database
Headers: X-EdgeBase-Service-Key: <key>
```

```json
{
  "query": "SELECT event, COUNT(*) as cnt FROM events WHERE ts > ? GROUP BY event",
  "params": ["2026-01-01"]
}
```

### SDK

<Tabs groupId="native-d1-sdk">
<TabItem value="ts" label="TypeScript" default>

```typescript
import { createAdminClient } from '@edgebase-fun/admin';

const admin = createAdminClient('https://your-app.example.com', {
  serviceKey: process.env.EDGEBASE_SERVICE_KEY!,
});

const rows = await admin.d1('analytics').exec(
  'SELECT event, COUNT(*) as cnt FROM events WHERE ts > ? GROUP BY event',
  ['2026-01-01']
);
```

</TabItem>
<TabItem value="dart" label="Dart">

```dart
import 'dart:io';
import 'package:edgebase_admin/edgebase_admin.dart';

final admin = AdminEdgeBase(
  'https://your-app.example.com',
  serviceKey: Platform.environment['EDGEBASE_SERVICE_KEY']!,
);

final rows = await admin.d1('analytics').exec(
  'SELECT event, COUNT(*) as cnt FROM events WHERE ts > ? GROUP BY event',
  ['2026-01-01'],
);
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
import dev.edgebase.sdk.admin.AdminEdgeBase

val admin = AdminEdgeBase(
    "https://your-app.example.com",
    serviceKey = System.getenv("EDGEBASE_SERVICE_KEY") ?: ""
)

val rows = admin.d1("analytics").exec(
    "SELECT event, COUNT(*) as cnt FROM events WHERE ts > ? GROUP BY event",
    listOf("2026-01-01")
)
```

</TabItem>
<TabItem value="java" label="Java">

```java
import dev.edgebase.sdk.admin.*;
import java.util.List;

AdminEdgeBase admin = EdgeBase.admin(
    "https://your-app.example.com",
    System.getenv("EDGEBASE_SERVICE_KEY")
);

var rows = admin.d1("analytics").exec(
    "SELECT event, COUNT(*) as cnt FROM events WHERE ts > ? GROUP BY event",
    List.of("2026-01-01")
);
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
import dev.edgebase.sdk.scala.admin.AdminEdgeBase

val admin = AdminEdgeBase(
  "https://your-app.example.com",
  sys.env("EDGEBASE_SERVICE_KEY")
)

val rows = admin.d1("analytics").exec(
  "SELECT event, COUNT(*) as cnt FROM events WHERE ts > ? GROUP BY event",
  Seq("2026-01-01")
)
```

</TabItem>
<TabItem value="python" label="Python">

```python
import os
from edgebase_admin import AdminClient

admin = AdminClient(
    "https://your-app.example.com",
    service_key=os.environ["EDGEBASE_SERVICE_KEY"],
)

rows = admin.d1("analytics").exec(
    "SELECT event, COUNT(*) as cnt FROM events WHERE ts > ? GROUP BY event",
    ["2026-01-01"],
)
```

</TabItem>
<TabItem value="go" label="Go">

```go
import (
    "context"
    "os"

    edgebase "github.com/edge-base/sdk-go"
)

ctx := context.Background()
admin := edgebase.NewAdminClient("https://your-app.example.com", os.Getenv("EDGEBASE_SERVICE_KEY"))

rows, _ := admin.D1("analytics").Exec(
    ctx,
    "SELECT event, COUNT(*) as cnt FROM events WHERE ts > ? GROUP BY event",
    []interface{}{"2026-01-01"},
)
```

</TabItem>
<TabItem value="php" label="PHP">

```php
use EdgeBase\Admin\AdminClient;

$admin = new AdminClient('https://your-app.example.com', getenv('EDGEBASE_SERVICE_KEY'));

$rows = $admin->d1('analytics')->exec(
    'SELECT event, COUNT(*) as cnt FROM events WHERE ts > ? GROUP BY event',
    ['2026-01-01'],
);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
use edgebase_admin::EdgeBase;
use serde_json::json;

let admin = EdgeBase::server(
    "https://your-app.example.com",
    &std::env::var("EDGEBASE_SERVICE_KEY").unwrap(),
)?;

let rows = admin.d1("analytics").exec(
    "SELECT event, COUNT(*) as cnt FROM events WHERE ts > ? GROUP BY event",
    &[json!("2026-01-01")],
).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
using EdgeBase.Admin;

var admin = new AdminClient(
    "https://your-app.example.com",
    Environment.GetEnvironmentVariable("EDGEBASE_SERVICE_KEY")!
);

var rows = await admin.D1("analytics").ExecAsync(
    "SELECT event, COUNT(*) as cnt FROM events WHERE ts > ? GROUP BY event",
    new object[] { "2026-01-01" }
);
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
require "edgebase_admin"

admin = EdgebaseAdmin::AdminClient.new(
  "https://your-app.example.com",
  service_key: ENV.fetch("EDGEBASE_SERVICE_KEY")
)

rows = admin.d1("analytics").exec(
  "SELECT event, COUNT(*) as cnt FROM events WHERE ts > ? GROUP BY event",
  ["2026-01-01"]
)
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseAdmin

admin =
  EdgeBaseAdmin.new("https://your-app.example.com",
    service_key: System.fetch_env!("EDGEBASE_SERVICE_KEY")
  )

rows =
  admin
  |> EdgeBaseAdmin.d1("analytics")
  |> EdgeBaseAdmin.D1.exec!(
    "SELECT event, COUNT(*) as cnt FROM events WHERE ts > ? GROUP BY event",
    ["2026-01-01"]
  )
```

</TabItem>
</Tabs>

D1 supports all standard SQL operations including DDL (`CREATE TABLE`, `ALTER TABLE`), DML, and aggregations.

:::caution D1 Consistency
D1 uses **eventual consistency** by default. Read-your-own-writes is not guaranteed without the Sessions API. Design your application accordingly.
:::

---

## Vectorize

A vector search index for building semantic search, retrieval-augmented generation (RAG), and recommendation features.

### Config

```typescript title="edgebase.config.ts"
import { defineConfig } from '@edgebase-fun/shared';

export default defineConfig({
  vectorize: {
    embeddings: {
      binding: 'EMBEDDINGS_INDEX',
      dimensions: 1536,
      metric: 'cosine',
    },
  },
});
```

| Field | Required | Description |
|-------|----------|-------------|
| `binding` | No | Optional Wrangler binding override. Defaults to an EdgeBase-managed binding name |
| `dimensions` | Yes | Vector dimensionality (must match your embedding model output) |
| `metric` | Yes | Distance metric: `cosine`, `euclidean`, or `dot-product` |

### REST API

```
POST /api/vectorize/:index
Headers: X-EdgeBase-Service-Key: <key>
```

**Search:**

```json
{
  "action": "search",
  "vector": [0.1, 0.2, 0.3],
  "topK": 10,
  "filter": { "category": "docs" }
}
```

**Upsert vectors:**

```json
{
  "action": "upsert",
  "vectors": [
    { "id": "doc-1", "values": [0.1, 0.2, 0.3], "metadata": { "title": "Hello" } }
  ]
}
```

**Insert vectors (error if ID exists):**

```json
{
  "action": "insert",
  "vectors": [
    { "id": "doc-3", "values": [0.4, 0.5, 0.6], "metadata": { "title": "New" } }
  ]
}
```

**Query by vector ID:**

```json
{ "action": "queryById", "vectorId": "doc-1", "topK": 5 }
```

**Get vectors by IDs:**

```json
{ "action": "getByIds", "ids": ["doc-1", "doc-2"] }
```

**Delete vectors:**

```json
{ "action": "delete", "ids": ["doc-1", "doc-2"] }
```

**Describe index:**

```json
{ "action": "describe" }
```

### SDK

<Tabs groupId="native-vector-sdk">
<TabItem value="ts" label="TypeScript" default>

```typescript
import { createAdminClient } from '@edgebase-fun/admin';

const admin = createAdminClient('https://your-app.example.com', {
  serviceKey: process.env.EDGEBASE_SERVICE_KEY!,
});

await admin.vector('embeddings').upsert([
  { id: 'doc-1', values: [0.1, 0.2], metadata: { title: 'Hello' } },
]);
const matches = await admin.vector('embeddings').search([0.1, 0.2], { topK: 10 });
```

</TabItem>
<TabItem value="dart" label="Dart">

```dart
import 'dart:io';
import 'package:edgebase_admin/edgebase_admin.dart';

final admin = AdminEdgeBase(
  'https://your-app.example.com',
  serviceKey: Platform.environment['EDGEBASE_SERVICE_KEY']!,
);

await admin.vector('embeddings').upsert([
  {'id': 'doc-1', 'values': [0.1, 0.2], 'metadata': {'title': 'Hello'}},
]);
final matches = await admin.vector('embeddings').search([0.1, 0.2], topK: 10);
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
import dev.edgebase.sdk.admin.AdminEdgeBase

val admin = AdminEdgeBase(
    "https://your-app.example.com",
    serviceKey = System.getenv("EDGEBASE_SERVICE_KEY") ?: ""
)

admin.vector("embeddings").upsert(listOf(
    mapOf("id" to "doc-1", "values" to listOf(0.1, 0.2), "metadata" to mapOf("title" to "Hello"))
))
val matches = admin.vector("embeddings").search(listOf(0.1, 0.2), topK = 10)
```

</TabItem>
<TabItem value="java" label="Java">

```java
import dev.edgebase.sdk.admin.*;
import java.util.List;
import java.util.Map;

AdminEdgeBase admin = EdgeBase.admin(
    "https://your-app.example.com",
    System.getenv("EDGEBASE_SERVICE_KEY")
);

admin.vector("embeddings").upsert(List.of(
    Map.of("id", "doc-1", "values", List.of(0.1, 0.2), "metadata", Map.of("title", "Hello"))
));
var matches = admin.vector("embeddings").search(List.of(0.1, 0.2), 10, null);
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
import dev.edgebase.sdk.scala.admin.AdminEdgeBase

val admin = AdminEdgeBase(
  "https://your-app.example.com",
  sys.env("EDGEBASE_SERVICE_KEY")
)

admin.vector("embeddings").upsert(Seq(
  Map("id" -> "doc-1", "values" -> Seq(0.1, 0.2), "metadata" -> Map("title" -> "Hello"))
))
val matches = admin.vector("embeddings").search(Seq(0.1, 0.2), topK = 10)
```

</TabItem>
<TabItem value="python" label="Python">

```python
import os
from edgebase_admin import AdminClient

admin = AdminClient(
    "https://your-app.example.com",
    service_key=os.environ["EDGEBASE_SERVICE_KEY"],
)

admin.vector("embeddings").upsert([
    {"id": "doc-1", "values": [0.1, 0.2], "metadata": {"title": "Hello"}},
])
matches = admin.vector("embeddings").search([0.1, 0.2], top_k=10)
```

</TabItem>
<TabItem value="go" label="Go">

```go
import (
    "context"
    "os"

    edgebase "github.com/edge-base/sdk-go"
)

ctx := context.Background()
admin := edgebase.NewAdminClient("https://your-app.example.com", os.Getenv("EDGEBASE_SERVICE_KEY"))

_, _ = admin.Vector("embeddings").Upsert(ctx, []map[string]interface{}{
    {"id": "doc-1", "values": []float64{0.1, 0.2}, "metadata": map[string]interface{}{"title": "Hello"}},
})
matches, _ := admin.Vector("embeddings").Search(ctx, []float64{0.1, 0.2}, &edgebase.VectorSearchOptions{TopK: 10})
```

</TabItem>
<TabItem value="php" label="PHP">

```php
use EdgeBase\Admin\AdminClient;

$admin = new AdminClient('https://your-app.example.com', getenv('EDGEBASE_SERVICE_KEY'));

$admin->vector('embeddings')->upsert([
    ['id' => 'doc-1', 'values' => [0.1, 0.2], 'metadata' => ['title' => 'Hello']],
]);
$matches = $admin->vector('embeddings')->search([0.1, 0.2], 10);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
use edgebase_admin::EdgeBase;
use serde_json::json;

let admin = EdgeBase::server(
    "https://your-app.example.com",
    &std::env::var("EDGEBASE_SERVICE_KEY").unwrap(),
)?;

admin.vector("embeddings").upsert(&[json!({
    "id": "doc-1", "values": [0.1, 0.2], "metadata": {"title": "Hello"}
})]).await?;
let matches = admin.vector("embeddings").search(&[0.1, 0.2], 10, None, None, None, None).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
using EdgeBase.Admin;

var admin = new AdminClient(
    "https://your-app.example.com",
    Environment.GetEnvironmentVariable("EDGEBASE_SERVICE_KEY")!
);

await admin.Vector("embeddings").UpsertAsync(new[] {
    new Dictionary<string, object?> { ["id"] = "doc-1", ["values"] = new[] { 0.1, 0.2 }, ["metadata"] = new Dictionary<string, object?> { ["title"] = "Hello" } },
});
var matches = await admin.Vector("embeddings").SearchAsync(new[] { 0.1, 0.2 }, topK: 10);
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
require "edgebase_admin"

admin = EdgebaseAdmin::AdminClient.new(
  "https://your-app.example.com",
  service_key: ENV.fetch("EDGEBASE_SERVICE_KEY")
)

admin.vector("embeddings").upsert([
  { "id" => "doc-1", "values" => [0.1, 0.2], "metadata" => { "title" => "Hello" } }
])
matches = admin.vector("embeddings").search([0.1, 0.2], top_k: 10)
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseAdmin

admin =
  EdgeBaseAdmin.new("https://your-app.example.com",
    service_key: System.fetch_env!("EDGEBASE_SERVICE_KEY")
  )

vector = EdgeBaseAdmin.vector(admin, "embeddings")

EdgeBaseAdmin.Vector.upsert!(vector, [
  %{"id" => "doc-1", "values" => [0.1, 0.2], "metadata" => %{"title" => "Hello"}}
])
matches = EdgeBaseAdmin.Vector.search!(vector, [0.1, 0.2], top_k: 10)
```

</TabItem>
</Tabs>

### Use Cases

- **Semantic search**: Embed documents and search by meaning instead of keywords
- **Retrieval workflows**: Retrieve relevant context for semantic search and ranked lookup flows
- **Recommendations**: Find similar items based on user behavior or item attributes

:::warning Edge Only
Vectorize is **only available on Cloudflare Edge**. In local and Docker environments, all Vectorize calls return stub responses with `_stub: true` and a console warning. This allows development to proceed without errors.
:::

---

## Access from App Functions

Inside [App Functions](/docs/functions), native resources are available through `context.admin`:

```typescript
// functions/recommend.ts
import { defineFunction } from '@edgebase-fun/shared';

export default defineFunction({
  trigger: { type: 'http', method: 'GET', path: '/recommendations' },
  handler: async ({ admin, auth }) => {
    // Check cache first
    const cacheKey = `recs:${auth.id}`;
    const cached = await admin.kv('cache').get(cacheKey);
    if (cached) return JSON.parse(cached);

    // Query analytics for user behavior
    const events = await admin.d1('analytics').exec(
      'SELECT item_id, COUNT(*) as views FROM events WHERE user_id = ? GROUP BY item_id ORDER BY views DESC LIMIT 5',
      [auth.id]
    );

    // Find similar items via vector search
    const embedding = await generateEmbedding(events.rows);
    const similar = await admin.vector('embeddings').search(embedding, { topK: 10 });

    // Cache the result
    const result = similar.matches;
    await admin.kv('cache').set(cacheKey, JSON.stringify(result), { ttl: 600 });

    return result;
  },
});
```

## Security

- **Allowlist**: Only resources declared in `edgebase.config.ts` are accessible. Requests to undeclared names return **404**.
- **Service Key required**: All native resource routes require a valid Service Key. Missing key returns **403**, invalid key returns **401**.
- **Scoped keys**: Use [scoped Service Keys](/docs/server/service-keys#scoped-key-example) for fine-grained access control (e.g., `kv:namespace:cache:read`, `d1:database:analytics:exec`, `vectorize:index:embeddings:query`).
- **Isolation**: User-defined resources are completely separate from EdgeBase's internal KV and D1 bindings.

## Environment Compatibility

| Resource | Edge | Docker | Node.js (`edgebase dev`) |
|----------|------|--------|--------------------------|
| **KV** | Native | Miniflare emulation | Miniflare emulation |
| **D1** | Native | Miniflare emulation | Miniflare emulation |
| **Vectorize** | Native | Stub responses | Stub responses |
