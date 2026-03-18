---
sidebar_position: 7
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Raw SQL

Execute raw SQL queries directly against a configured EdgeBase database namespace. Depending on the namespace provider, the same `/api/sql` endpoint routes to Durable Object SQLite, Cloudflare D1, or PostgreSQL/Neon.

## Endpoint

```
POST /api/sql
Headers: X-EdgeBase-Service-Key: <key>
```

Raw SQL requires [Service Key](/docs/server/service-keys) authentication. It bypasses [access rules](/docs/server/access-rules) entirely, so it is intended for server-side use only.

:::info Language Coverage
Raw SQL is available in all Admin SDKs.
:::

## Request

```json
{
  "namespace": "shared",
  "id": "optional-instance-id",
  "sql": "SELECT * FROM posts WHERE status = ? ORDER BY createdAt DESC LIMIT 10",
  "params": ["published"]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `namespace` | Yes | The database namespace (e.g., `shared`, `workspace`) |
| `id` | No | Dynamic database instance ID. Omit for single-instance namespaces and non-DO providers |
| `sql` | Yes | The SQL statement to execute |
| `params` | No | Array of bind parameters for `?` placeholders |

`namespace` must match a database block declared in `edgebase.config.ts`. For dynamic Durable Object namespaces, pass the instance `id` you want to target.

## Response

```json
{
  "rows": [
    { "id": "01abc...", "title": "Hello World", "status": "published", "createdAt": "2026-01-15T10:00:00Z" }
  ],
  "items": [
    { "id": "01abc...", "title": "Hello World", "status": "published", "createdAt": "2026-01-15T10:00:00Z" }
  ],
  "results": [
    { "id": "01abc...", "title": "Hello World", "status": "published", "createdAt": "2026-01-15T10:00:00Z" }
  ]
}
```

| Field | Description |
|-------|-------------|
| `rows` | Canonical array of row objects |
| `items` | Alias of `rows` for SDK compatibility |
| `results` | Alias of `rows` for SDK compatibility |
| `columns` | Optional PostgreSQL column metadata |
| `rowCount` | Optional PostgreSQL affected-row count |

## Execution Targets

EdgeBase selects the backing engine from your database namespace configuration:

- Durable Object SQLite: default for managed EdgeBase database namespaces
- D1: namespaces configured to route through Cloudflare D1
- PostgreSQL: namespaces configured with `provider: 'postgres'` (legacy `provider: 'neon'` configs still work)

## Parameterized Queries

Always use `?` bind parameters to prevent SQL injection:

```json
{
  "namespace": "shared",
  "sql": "SELECT * FROM posts WHERE authorId = ? AND status = ?",
  "params": ["user-123", "published"]
}
```

:::danger
Never interpolate user input directly into SQL strings. Always use the `params` array.
:::

## Admin SDK Usage

The Admin SDK exposes a top-level `sql(...)` helper across every Admin SDK.

<Tabs groupId="raw-sql-admin">
<TabItem value="ts" label="TypeScript" default>

```typescript
import { createAdminClient } from '@edgebase/admin';

const admin = createAdminClient('https://your-app.example.com', {
  serviceKey: process.env.EDGEBASE_SERVICE_KEY!,
});

const rows = await admin.sql(
  'shared',
  undefined,
  'SELECT * FROM posts WHERE status = ? ORDER BY createdAt DESC LIMIT 10',
  ['published']
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

final rows = await admin.sql(
  'shared',
  null,
  'SELECT * FROM posts WHERE status = ? ORDER BY createdAt DESC LIMIT 10',
  ['published'],
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

val rows = admin.sql(
    namespace = "shared",
    query = "SELECT * FROM posts WHERE status = ? ORDER BY createdAt DESC LIMIT 10",
    params = listOf("published")
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

List<Object> rows = admin.sql(
    "shared",
    "SELECT * FROM posts WHERE status = ? ORDER BY createdAt DESC LIMIT 10",
    List.of("published")
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

val rows = admin.sql(
  "shared",
  "SELECT * FROM posts WHERE status = ? ORDER BY createdAt DESC LIMIT 10",
  Seq("published")
)
```

</TabItem>
<TabItem value="python" label="Python">

```python
import os
from edgebase_admin import AdminClient

admin = AdminClient(
    'https://your-app.example.com',
    service_key=os.environ['EDGEBASE_SERVICE_KEY'],
)

rows = admin.sql(
    'shared',
    'SELECT * FROM posts WHERE status = ? ORDER BY createdAt DESC LIMIT 10',
    ['published'],
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

rows, _ := admin.SQL(
    ctx,
    "shared",
    "",
    "SELECT * FROM posts WHERE status = ? ORDER BY createdAt DESC LIMIT 10",
    []interface{}{"published"},
)
```

</TabItem>
<TabItem value="php" label="PHP">

```php
use EdgeBase\Admin\AdminClient;

$admin = new AdminClient('https://your-app.example.com', getenv('EDGEBASE_SERVICE_KEY'));

$rows = $admin->sql(
    'shared',
    null,
    'SELECT * FROM posts WHERE status = ? ORDER BY createdAt DESC LIMIT 10',
    ['published'],
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

let rows = admin.sql(
    "shared",
    None,
    "SELECT * FROM posts WHERE status = ? ORDER BY createdAt DESC LIMIT 10",
    &["published"],
).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
using System;
using EdgeBase.Admin;

var admin = new AdminClient(
    "https://your-app.example.com",
    Environment.GetEnvironmentVariable("EDGEBASE_SERVICE_KEY")!
);

var rows = await admin.SqlAsync(
    "shared",
    "SELECT * FROM posts WHERE status = ? ORDER BY createdAt DESC LIMIT 10",
    new object[] { "published" }
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

rows = admin.sql(
  "shared",
  "SELECT * FROM posts WHERE status = ? ORDER BY createdAt DESC LIMIT 10",
  ["published"]
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
  EdgeBaseAdmin.sql!(admin,
    "SELECT * FROM posts WHERE status = ? ORDER BY createdAt DESC LIMIT 10",
    namespace: "shared",
    params: ["published"]
  )
```

</TabItem>
</Tabs>

### Inside App Functions

```typescript
// functions/generateReport.ts
import { defineFunction } from '@edgebase/shared';

export default defineFunction({
  trigger: { type: 'http', method: 'GET', path: '/report/top-authors' },
  handler: async ({ admin }) => {
    const result = await admin.sql(
      'shared',
      undefined,
      `SELECT authorId, COUNT(*) as postCount, SUM(views) as totalViews
       FROM posts
       WHERE status = 'published'
       GROUP BY authorId
       ORDER BY totalViews DESC
       LIMIT 20`
    );
    return result.rows;
  },
});
```

## Use Cases

### Complex Aggregations

```sql
SELECT
  strftime('%Y-%m', createdAt) AS month,
  COUNT(*) AS count,
  AVG(views) AS avgViews
FROM posts
WHERE status = 'published'
GROUP BY month
ORDER BY month DESC
```

### Multi-Table Joins

```sql
SELECT p.title, p.views, u.displayName AS author
FROM posts p
JOIN users u ON p.authorId = u.id
WHERE p.status = 'published'
ORDER BY p.views DESC
LIMIT 10
```

### Full-Text Search with Ranking

```sql
SELECT p.*, rank
FROM posts_fts
JOIN posts p ON posts_fts.rowid = p.rowid
WHERE posts_fts MATCH ?
ORDER BY rank
LIMIT 20
```

### Data Migration

```sql
UPDATE posts SET category = 'general' WHERE category IS NULL
```

## Limitations

### No Cross-DO Queries

Each Durable Object has its own independent SQLite database. A single SQL query runs against one DO instance only. You cannot join data across different namespaces or instance IDs in a single query.

```typescript
// Each call targets a single DO
const sharedPosts = await admin.sql('shared', undefined, 'SELECT * FROM posts');
const workspaceDocs = await admin.sql('workspace', 'ws-1', 'SELECT * FROM documents');
// These are two separate databases — no cross-join is possible
```

### Security

Raw SQL bypasses all [access rules](/docs/server/access-rules). Access is controlled entirely by the Service Key:

- A **root-tier** key can execute any SQL on any table
- A **scoped** key requires the `sql:table:{table}:exec` scope to match the `table` field in the request

The `table` field in the request body is used for scope checking only. The SQL statement itself is not parsed or restricted, so a query referencing multiple tables will still execute as long as the scope matches the declared `table`.

:::caution
Because raw SQL runs with full database privileges, treat it with the same care as direct database access. Validate inputs, use parameterized queries, and restrict Service Key distribution.
:::
