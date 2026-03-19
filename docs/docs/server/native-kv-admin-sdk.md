---
slug: /server/native-resources/kv/admin-sdk
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# KV Admin SDK

Use the Admin SDK when your backend or worker needs programmatic access to a declared KV namespace.

KV still keeps Cloudflare's eventual-consistency model and 1 write-per-second limit on the same key, so avoid using it for hot counters or transactional state.

## Available Methods

| Method | Purpose |
|---|---|
| `get(key)` | Read a value by key |
| `set(key, value, { ttl? })` | Write a value with optional TTL |
| `list({ prefix?, limit?, cursor? })` | List keys with pagination |
| `delete(key)` | Remove a key |

## Language Method Matrix

The operation set is the same across SDKs. The main differences are naming conventions such as `Async`, capitalization, or Elixir bang variants.

| Language | Methods | Notes |
|---|---|---|
| TypeScript / JavaScript | `get`, `set`, `list`, `delete` | Same names in the JS admin SDK |
| Dart | `get`, `set`, `list`, `delete` | Uses named `ttl:` on `set(...)` |
| Kotlin | `get`, `set`, `list`, `delete` | `suspend` methods |
| Java | `get`, `set`, `list`, `delete` | Overloads for `set(...)` and `list()` |
| Scala | `get`, `set`, `list`, `delete` | Scala wrapper around Java admin SDK |
| Python | `get`, `set`, `list`, `delete` | `ttl=` keyword on `set(...)` |
| Go | `Get`, `Set`, `List`, `Delete` | Context-first method signatures |
| PHP | `get`, `set`, `list`, `delete` | Optional nullable params |
| Rust | `get`, `set`, `list`, `delete` | Async methods on the client |
| C# | `GetAsync`, `SetAsync`, `ListAsync`, `DeleteAsync` | `CancellationToken` optional |
| Ruby | `get`, `set`, `list`, `delete` | Ruby keyword args for optional params |
| Elixir | `get`, `get!`, `set`, `set!`, `list`, `list!`, `delete`, `delete!` | `!` variants unwrap `{:ok, ...}` |

<Tabs groupId="native-kv-sdk">
<TabItem value="ts" label="TypeScript" default>

```typescript
import { createAdminClient } from '@edge-base/admin';

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
from edgebase_admin import create_admin_client

admin = create_admin_client(
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

## Delete a Key

KV delete support is available in the Admin SDK. The method name is `delete` across SDKs.

```typescript
await admin.kv('cache').delete('user:123');
```

Use this for cache invalidation, one-time tokens, or cleanup jobs. Keep in mind that KV is eventually consistent, so other regions may briefly observe stale reads right after deletion.
