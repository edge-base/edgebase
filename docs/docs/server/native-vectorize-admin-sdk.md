---
slug: /server/native-resources/vectorize/admin-sdk
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Vectorize Admin SDK

Use the Admin SDK when your backend needs to insert, update, search, or delete vectors in a declared Vectorize index.

Vectorize mutations are asynchronous. After `insert`, `upsert`, or `delete`, allow a few seconds before expecting queries to reflect the change. Metadata filtering beyond `namespace` also requires metadata indexes on the Cloudflare side.

## Available Methods

| Method | Purpose |
|---|---|
| `upsert(vectors)` | Insert new vectors or replace existing IDs |
| `insert(vectors)` | Insert only new vector IDs |
| `search(vector, options?)` | Search by raw vector values |
| `queryById(vectorId, options?)` | Search using an existing vector ID |
| `getByIds(ids)` | Fetch vectors by ID |
| `delete(ids)` | Remove vectors by ID |
| `describe()` | Read index metadata such as dimensions and metric |

## Language Method Matrix

The underlying operations are the same across SDKs. The main difference is naming style: camelCase, snake_case, `Async`, or Go-style capitalization.

| Language | Methods | Notes |
|---|---|---|
| TypeScript / JavaScript | `upsert`, `insert`, `search`, `queryById`, `getByIds`, `delete`, `describe` | Same names in the JS admin SDK |
| Dart | `upsert`, `insert`, `search`, `queryById`, `getByIds`, `delete`, `describe` | Optional search params are named args |
| Kotlin | `upsert`, `insert`, `search`, `queryById`, `getByIds`, `delete`, `describe` | `suspend` methods |
| Java | `upsert`, `insert`, `search`, `queryById`, `getByIds`, `delete`, `describe` | Overloads for simple/full search options |
| Scala | `upsert`, `insert`, `search`, `queryById`, `getByIds`, `delete`, `describe` | Scala wrapper around Java admin SDK |
| Python | `upsert`, `insert`, `search`, `query_by_id`, `get_by_ids`, `delete`, `describe` | Snake_case for multi-word names |
| Go | `Upsert`, `Insert`, `Search`, `QueryByID`, `GetByIDs`, `Delete`, `Describe` | Context-first method signatures |
| PHP | `upsert`, `insert`, `search`, `queryById`, `getByIds`, `delete`, `describe` | PHP-style nullable optional args |
| Rust | `upsert`, `insert`, `search`, `query_by_id`, `get_by_ids`, `delete`, `describe` | Snake_case async methods |
| C# | `UpsertAsync`, `InsertAsync`, `SearchAsync`, `QueryByIdAsync`, `GetByIdsAsync`, `DeleteAsync`, `DescribeAsync` | `CancellationToken` optional |
| Ruby | `upsert`, `insert`, `search`, `query_by_id`, `get_by_ids`, `delete`, `describe` | Snake_case for multi-word names |
| Elixir | `upsert`, `upsert!`, `insert`, `insert!`, `search`, `search!`, `query_by_id`, `query_by_id!`, `get_by_ids`, `get_by_ids!`, `delete`, `delete!`, `describe`, `describe!` | `!` variants unwrap `{:ok, ...}` |

<Tabs groupId="native-vector-sdk">
<TabItem value="ts" label="TypeScript" default>

```typescript
import { createAdminClient } from '@edge-base/admin';

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
from edgebase_admin import create_admin_client

admin = create_admin_client(
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

## Delete Vectors

Delete support is available through the Admin SDK and removes vectors by ID.

```typescript
await admin.vector('embeddings').delete(['doc-1', 'doc-2']);
```

Like other Vectorize mutations, deletion is asynchronous and may take a few seconds to disappear from subsequent queries.
