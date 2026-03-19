---
slug: /server/native-resources/d1/admin-sdk
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# D1 Admin SDK

Use the Admin SDK when your backend needs to run SQL against a declared D1 database.

This wrapper exposes plain SQL execution. If you enable D1 read replication and need explicit Sessions API behavior, drop down to lower-level Workers D1 bindings in custom Worker code today.

## Available Methods

| Method | Purpose |
|---|---|
| `exec(sql, params?)` | Run a SQL statement and return result rows |

Some SDKs also expose `query(...)` as a convenience alias for `exec(...)`, but `exec(...)` is the cross-SDK baseline shown in this guide.

## Language Method Matrix

Use `exec(...)` as the safe cross-SDK mental model. Where `query(...)` exists, it is just an alias with the same behavior.

| Language | Methods | Notes |
|---|---|---|
| TypeScript / JavaScript | `exec`, `query` | `query(...)` is an alias |
| Dart | `exec`, `query` | `query(...)` is an alias |
| Kotlin | `exec` | `suspend` method |
| Java | `exec` | Overloads for with/without params |
| Scala | `exec` | Scala wrapper around Java admin SDK |
| Python | `exec`, `query` | `query(...)` is an alias |
| Go | `Exec`, `Query` | `Query(...)` is an alias |
| PHP | `exec`, `query` | `query(...)` is an alias |
| Rust | `exec`, `query` | `query(...)` is an alias |
| C# | `ExecAsync` | No separate alias today |
| Ruby | `exec`, `query` | `query` is an alias of `exec` |
| Elixir | `exec`, `exec!` | `exec!` unwraps `{:ok, ...}` |

<Tabs groupId="native-d1-sdk">
<TabItem value="ts" label="TypeScript" default>

```typescript
import { createAdminClient } from '@edge-base/admin';

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
from edgebase_admin import create_admin_client

admin = create_admin_client(
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

## Delete Rows

D1 does not have a separate delete helper because this wrapper exposes plain SQL. Use `exec(...)` with standard `DELETE` statements when you need cleanup or retention jobs.

```typescript
await admin.d1('analytics').exec(
  'DELETE FROM events WHERE created_at < ?',
  ['2025-01-01']
);
```

The same `exec(...)` entrypoint also covers `INSERT`, `UPDATE`, and schema-management queries.
