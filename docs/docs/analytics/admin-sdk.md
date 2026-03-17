---
sidebar_position: 2
title: Admin SDK
sidebar_label: Admin SDK
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Admin SDK — Querying Analytics

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

The Admin SDK provides two analytics capabilities: querying **request log metrics** (automatic API usage data) and managing **custom events** (track + query). All endpoints require a **Service Key**.

:::info Language Coverage
Analytics querying and event tracking are available in all Admin SDKs.
:::

## Setup

<Tabs groupId="lang">
<TabItem value="ts" label="TypeScript" default>

```typescript
import { createAdminClient } from '@edgebase/admin';

const admin = createAdminClient('https://my-edgebase-server.com', {
  serviceKey: process.env.EDGEBASE_SERVICE_KEY,
});
```

</TabItem>
<TabItem value="dart" label="Dart">

```dart
import 'dart:io';
import 'package:edgebase_admin/edgebase_admin.dart';

final admin = AdminEdgeBase(
  'https://my-edgebase-server.com',
  serviceKey: Platform.environment['EDGEBASE_SERVICE_KEY']!,
);
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
import dev.edgebase.sdk.admin.AdminEdgeBase

val admin = AdminEdgeBase(
    "https://my-edgebase-server.com",
    serviceKey = System.getenv("EDGEBASE_SERVICE_KEY") ?: ""
)
```

</TabItem>
<TabItem value="java" label="Java">

```java
import dev.edgebase.sdk.admin.*;

AdminEdgeBase admin = EdgeBase.admin(
    "https://my-edgebase-server.com",
    System.getenv("EDGEBASE_SERVICE_KEY")
);
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
import dev.edgebase.sdk.scala.admin.AdminEdgeBase

val admin = AdminEdgeBase(
  "https://my-edgebase-server.com",
  sys.env("EDGEBASE_SERVICE_KEY")
)
```

</TabItem>
<TabItem value="python" label="Python">

```python
import os
from edgebase_admin import AdminClient

admin = AdminClient(
    "https://my-edgebase-server.com",
    service_key=os.environ["EDGEBASE_SERVICE_KEY"],
)
```

</TabItem>
<TabItem value="go" label="Go">

```go
import (
    "os"
    edgebase "github.com/edgebase/sdk-go"
)

admin := edgebase.NewAdminClient("https://my-edgebase-server.com", os.Getenv("EDGEBASE_SERVICE_KEY"))
```

</TabItem>
<TabItem value="php" label="PHP">

```php
use EdgeBase\Admin\AdminClient;

$admin = new AdminClient('https://my-edgebase-server.com', getenv('EDGEBASE_SERVICE_KEY'));
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
use edgebase_admin::EdgeBase;

let admin = EdgeBase::server(
    "https://my-edgebase-server.com",
    &std::env::var("EDGEBASE_SERVICE_KEY").unwrap(),
)?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
using System;
using EdgeBase.Admin;

var admin = new AdminClient(
    "https://my-edgebase-server.com",
    Environment.GetEnvironmentVariable("EDGEBASE_SERVICE_KEY")!
);
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
require "edgebase_admin"

admin = EdgebaseAdmin::AdminClient.new(
  "https://my-edgebase-server.com",
  service_key: ENV.fetch("EDGEBASE_SERVICE_KEY")
)
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseAdmin

admin =
  EdgeBaseAdmin.new("https://my-edgebase-server.com",
    service_key: System.fetch_env!("EDGEBASE_SERVICE_KEY")
  )
```

</TabItem>
</Tabs>

The same analytics surface is exposed across all Admin SDKs for `overview`, `timeSeries`, `breakdown`, `topEndpoints`, `track`, `trackBatch`, and `queryEvents`.

---

## Part 1: Request Log Metrics

These methods query **automatic API usage data** — the same metrics shown in the Admin Dashboard.

### Overview

Get a complete snapshot: time series, summary, breakdown by category, and top endpoints.

<Tabs groupId="lang">
<TabItem value="ts" label="TypeScript" default>

```typescript
const data = await admin.analytics.overview({ range: '7d' });
console.log(data.summary.totalRequests);
console.log(data.breakdown[0]);
```

</TabItem>
<TabItem value="dart" label="Dart">

```dart
final data = await admin.analytics.overview({'range': '7d'});
print(data['summary']);
print(data['breakdown']);
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val data = admin.analytics.overview(mapOf("range" to "7d"))
println(data["summary"])
println(data["breakdown"])
```

</TabItem>
<TabItem value="java" label="Java">

```java
var data = admin.analytics().overview(Map.of("range", "7d"));
System.out.println(data.get("summary"));
System.out.println(data.get("breakdown"));
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val data = admin.analytics.overview(Map("range" -> "7d"))
println(data("summary"))
println(data("breakdown"))
```

</TabItem>
<TabItem value="python" label="Python">

```python
data = admin.analytics.overview(range="7d")
print(data["summary"])
print(data["breakdown"])
```

</TabItem>
<TabItem value="go" label="Go">

```go
import "context"

ctx := context.Background()
data, _ := admin.Analytics.Overview(ctx, map[string]string{"range": "7d"})
fmt.Println(data["summary"])
fmt.Println(data["breakdown"])
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$data = $admin->analytics()->overview(['range' => '7d']);
var_dump($data['summary']);
var_dump($data['breakdown']);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
use std::collections::HashMap;

let data = admin.analytics().overview(Some(HashMap::from([
    ("range".to_string(), "7d".to_string())
]))).await?;
println!("{:?}", data.get("summary"));
println!("{:?}", data.get("breakdown"));
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var data = await admin.Analytics.OverviewAsync(new Dictionary<string, string> {
    ["range"] = "7d",
});
Console.WriteLine(data["summary"]);
Console.WriteLine(data["breakdown"]);
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
data = admin.analytics.overview("range" => "7d")
pp data["summary"]
pp data["breakdown"]
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
data =
  admin
  |> EdgeBaseAdmin.analytics()
  |> EdgeBaseAdmin.Analytics.overview!(range: "7d")

IO.inspect(data["summary"])
IO.inspect(data["breakdown"])
```

</TabItem>
</Tabs>

### Time Series, Breakdown, and Top Endpoints

All request-log helpers accept the same option shape:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `range` | `string` | `'24h'` | Time range: `'1h'`, `'6h'`, `'24h'`, `'7d'`, `'30d'`, `'90d'` |
| `category` | `string` | — | Filter by route category. Common values include `'auth'`, `'db'`, `'storage'`, `'databaseLive'`, `'room'`, `'push'`, `'function'`, `'kv'`, `'sql'`, `'d1'`, `'vectorize'`, `'admin'`, `'config'`, and `'health'` |
| `groupBy` | `string` | `'hour'` | Time grouping: `'minute'`, `'hour'`, `'day'` |

```typescript
const points = await admin.analytics.timeSeries({ range: '24h', groupBy: 'hour' });
const items = await admin.analytics.breakdown({ range: '30d' });
const top = await admin.analytics.topEndpoints({ range: '7d' });
```

---

## Part 2: Custom Events

Track and query custom events from your server-side code. Events are stored in LogsDO with 90-day retention (daily rollups for older data).

### Tracking Events

<Tabs groupId="lang">
<TabItem value="ts" label="TypeScript" default>

```typescript
await admin.analytics.track('user_upgraded', { plan: 'pro', amount: 29.99 }, 'user_123');

await admin.analytics.trackBatch([
  { name: 'email_sent', properties: { template: 'welcome' }, userId: 'user_123' },
  { name: 'cron_completed', properties: { job: 'cleanup', duration: 1200 } },
]);
```

</TabItem>
<TabItem value="dart" label="Dart">

```dart
await admin.analytics.track('user_upgraded', {'plan': 'pro', 'amount': 29.99}, 'user_123');

await admin.analytics.trackBatch([
  AnalyticsEvent(name: 'email_sent', properties: {'template': 'welcome'}, userId: 'user_123'),
  AnalyticsEvent(name: 'cron_completed', properties: {'job': 'cleanup', 'duration': 1200}),
]);
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
admin.analytics.track("user_upgraded", mapOf("plan" to "pro", "amount" to 29.99), "user_123")

admin.analytics.trackBatch(listOf(
    AnalyticsEvent(name = "email_sent", properties = mapOf("template" to "welcome"), userId = "user_123"),
    AnalyticsEvent(name = "cron_completed", properties = mapOf("job" to "cleanup", "duration" to 1200)),
))
```

</TabItem>
<TabItem value="java" label="Java">

```java
admin.analytics().track("user_upgraded", Map.of("plan", "pro", "amount", 29.99), "user_123");

admin.analytics().trackBatch(List.of(
    new AnalyticsClient.AnalyticsEvent("email_sent", Map.of("template", "welcome"), null, "user_123"),
    new AnalyticsClient.AnalyticsEvent("cron_completed", Map.of("job", "cleanup", "duration", 1200), null, null)
));
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
import dev.edgebase.sdk.scala.admin.AnalyticsEvent

admin.analytics.track(
  "user_upgraded",
  Map("plan" -> "pro", "amount" -> 29.99),
  userId = Some("user_123")
)

admin.analytics.trackBatch(Seq(
  AnalyticsEvent("email_sent", Map("template" -> "welcome"), userId = Some("user_123")),
  AnalyticsEvent("cron_completed", Map("job" -> "cleanup", "duration" -> 1200))
))
```

</TabItem>
<TabItem value="python" label="Python">

```python
admin.analytics.track("user_upgraded", {"plan": "pro", "amount": 29.99}, user_id="user_123")

admin.analytics.track_batch([
    {"name": "email_sent", "properties": {"template": "welcome"}, "userId": "user_123"},
    {"name": "cron_completed", "properties": {"job": "cleanup", "duration": 1200}},
])
```

</TabItem>
<TabItem value="go" label="Go">

```go
import "context"

ctx := context.Background()
_ = admin.Analytics.Track(ctx, "user_upgraded", map[string]interface{}{
    "plan": "pro",
    "amount": 29.99,
}, "user_123")

_ = admin.Analytics.TrackBatch(ctx, []edgebase.AnalyticsEvent{
    {Name: "email_sent", Properties: map[string]interface{}{"template": "welcome"}, UserID: "user_123"},
    {Name: "cron_completed", Properties: map[string]interface{}{"job": "cleanup", "duration": 1200}},
})
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$admin->analytics()->track('user_upgraded', ['plan' => 'pro', 'amount' => 29.99], 'user_123');

$admin->analytics()->trackBatch([
    ['name' => 'email_sent', 'properties' => ['template' => 'welcome'], 'userId' => 'user_123'],
    ['name' => 'cron_completed', 'properties' => ['job' => 'cleanup', 'duration' => 1200]],
]);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
use serde_json::json;

admin.analytics().track(
    "user_upgraded",
    Some(json!({"plan": "pro", "amount": 29.99})),
    Some("user_123"),
).await?;

admin.analytics().track_batch(vec![
    json!({"name": "email_sent", "properties": {"template": "welcome"}, "userId": "user_123"}),
    json!({"name": "cron_completed", "properties": {"job": "cleanup", "duration": 1200}}),
]).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await admin.Analytics.TrackAsync(
    "user_upgraded",
    new Dictionary<string, object?> { ["plan"] = "pro", ["amount"] = 29.99 },
    "user_123"
);

await admin.Analytics.TrackBatchAsync(new[] {
    new AnalyticsEvent { Name = "email_sent", Properties = new() { ["template"] = "welcome" }, UserId = "user_123" },
    new AnalyticsEvent { Name = "cron_completed", Properties = new() { ["job"] = "cleanup", ["duration"] = 1200 } },
});
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
admin.analytics.track("user_upgraded", { "plan" => "pro", "amount" => 29.99 }, user_id: "user_123")

admin.analytics.track_batch([
  { "name" => "email_sent", "properties" => { "template" => "welcome" }, "userId" => "user_123" },
  { "name" => "cron_completed", "properties" => { "job" => "cleanup", "duration" => 1200 } }
])
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
analytics = EdgeBaseAdmin.analytics(admin)

EdgeBaseAdmin.Analytics.track!(analytics, "user_upgraded", %{"plan" => "pro", "amount" => 29.99}, "user_123")

EdgeBaseAdmin.Analytics.track_batch!(analytics, [
  %{"name" => "email_sent", "properties" => %{"template" => "welcome"}, "userId" => "user_123"},
  %{"name" => "cron_completed", "properties" => %{"job" => "cleanup", "duration" => 1200}}
])
```

</TabItem>
</Tabs>

#### Track Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Event name (e.g., `'purchase'`, `'signup'`) |
| `properties` | `object` | No | Key-value data (max 50 keys, 4 KB) |
| `userId` | `string` | No | Associate with a specific user |

### Querying Events

#### List Events

<Tabs groupId="lang">
<TabItem value="ts" label="TypeScript" default>

```typescript
const result = await admin.analytics.queryEvents({
  metric: 'list',
  event: 'purchase',
  range: '7d',
  limit: 20,
});

console.log(result.events);
```

</TabItem>
<TabItem value="dart" label="Dart">

```dart
final result = await admin.analytics.queryEvents({
  'metric': 'list',
  'event': 'purchase',
  'range': '7d',
  'limit': '20',
});

print(result['events']);
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = admin.analytics.queryEvents(
    mapOf("metric" to "list", "event" to "purchase", "range" to "7d", "limit" to "20")
)
println(result)
```

</TabItem>
<TabItem value="java" label="Java">

```java
Object result = admin.analytics().queryEvents(Map.of(
    "metric", "list",
    "event", "purchase",
    "range", "7d",
    "limit", "20"
));
System.out.println(result);
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val result = admin.analytics.queryEvents(
  Map("metric" -> "list", "event" -> "purchase", "range" -> "7d", "limit" -> "20")
)
println(result)
```

</TabItem>
<TabItem value="python" label="Python">

```python
result = admin.analytics.query_events(metric="list", event="purchase", range="7d", limit="20")
print(result["events"])
```

</TabItem>
<TabItem value="go" label="Go">

```go
import "context"

ctx := context.Background()
result, _ := admin.Analytics.QueryEvents(ctx, map[string]string{
    "metric": "list",
    "event": "purchase",
    "range": "7d",
    "limit": "20",
})
fmt.Println(result["events"])
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$result = $admin->analytics()->queryEvents([
    'metric' => 'list',
    'event' => 'purchase',
    'range' => '7d',
    'limit' => '20',
]);

var_dump($result['events']);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
use std::collections::HashMap;

let result = admin.analytics().query_events(Some(HashMap::from([
    ("metric".to_string(), "list".to_string()),
    ("event".to_string(), "purchase".to_string()),
    ("range".to_string(), "7d".to_string()),
    ("limit".to_string(), "20".to_string()),
]))).await?;

println!("{:?}", result.get("events"));
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await admin.Analytics.QueryEventsAsync(new Dictionary<string, string> {
    ["metric"] = "list",
    ["event"] = "purchase",
    ["range"] = "7d",
    ["limit"] = "20",
});

Console.WriteLine(result["events"]);
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
result = admin.analytics.query_events(
  "metric" => "list",
  "event" => "purchase",
  "range" => "7d",
  "limit" => "20"
)

pp result["events"]
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
result =
  admin
  |> EdgeBaseAdmin.analytics()
  |> EdgeBaseAdmin.Analytics.query_events!(
    metric: "list",
    event: "purchase",
    range: "7d",
    limit: "20"
  )

IO.inspect(result["events"])
```

</TabItem>
</Tabs>

### Query Options

| Parameter | Type | Default | Description |
|---|---|---|---|
| `metric` | `string` | `'list'` | `'list'`, `'count'`, `'timeSeries'`, `'topEvents'` |
| `range` | `string` | `'24h'` | Time range: `'1h'`, `'6h'`, `'24h'`, `'7d'`, `'30d'`, `'90d'` |
| `event` | `string` | — | Filter by event name |
| `userId` | `string` | — | Filter by user ID |
| `groupBy` | `string` | `'hour'` | For timeSeries: `'minute'`, `'hour'`, `'day'` |
| `limit` | `number` | `50` | Max events per page (for list) |
| `cursor` | `string` | — | Pagination cursor (from previous response) |
