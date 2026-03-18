---
id: admin-sdk
title: Sending Push Notifications
sidebar_label: Sending via Admin SDK
sidebar_position: 4
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Sending Push Notifications

:::caution Alpha
This feature is in **alpha**. APIs and behavior may change without notice. Not recommended for production use.
:::

Push notifications are always triggered from a secure server environment using the Admin SDK. EdgeBase routes all payloads through FCM HTTP v1 API to reach devices across all platforms.

:::info Language Coverage
Push sending is available in all Admin SDKs.
:::

## Setup

Initialize the Admin SDK with your **Service Key**.

<Tabs groupId="lang">
<TabItem value="ts" label="TypeScript" default>

```typescript
import { createAdminClient } from '@edge-base/admin';

const admin = createAdminClient('https://my-edgebase-server.com', {
    serviceKey: process.env.EDGEBASE_SERVICE_KEY
});
```

</TabItem>
<TabItem value="python" label="Python">

```python
import os
from edgebase_admin import AdminClient

admin = AdminClient("https://my-edgebase-server.com", service_key=os.environ["EDGEBASE_SERVICE_KEY"])
```

</TabItem>
<TabItem value="go" label="Go">

```go
import (
    "os"
    edgebase "github.com/edge-base/sdk-go"
)

admin := edgebase.NewAdminClient("https://my-edgebase-server.com", os.Getenv("EDGEBASE_SERVICE_KEY"))
```

</TabItem>
<TabItem value="php" label="PHP">

```php
use EdgeBase\Admin\AdminClient;

$admin = new AdminClient("https://my-edgebase-server.com", getenv('EDGEBASE_SERVICE_KEY'));
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
<TabItem value="java" label="Java">

```java
import dev.edgebase.sdk.admin.AdminEdgeBase;

AdminEdgeBase admin = new AdminEdgeBase(
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
<TabItem value="kotlin" label="Kotlin">

```kotlin
import dev.edgebase.sdk.admin.AdminEdgeBase

val admin = AdminEdgeBase(
    "https://my-edgebase-server.com",
    serviceKey = System.getenv("EDGEBASE_SERVICE_KEY") ?: ""
)
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

## Sending to a User

Send a push notification to all devices registered to a specific user.

<Tabs groupId="lang">
<TabItem value="ts" label="TypeScript" default>

```typescript
const result = await admin.push.send("user_123", {
    title: "New Message",
    body: "Alice sent you a photo!",
    badge: 1
});
console.log(result); // { sent: 2, failed: 0, removed: 0 }
```

</TabItem>
<TabItem value="python" label="Python">

```python
result = admin.push.send("user_123", {
    "title": "New Message",
    "body": "Alice sent you a photo!",
    "badge": 1
})
```

</TabItem>
<TabItem value="go" label="Go">

```go
result, _ := admin.Push.Send(ctx, "user_123", map[string]interface{}{
    "title": "New Message",
    "body":  "Alice sent you a photo!",
    "badge": 1,
})
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$result = $admin->push()->send("user_123", [
    "title" => "New Message",
    "body" => "Alice sent you a photo!",
    "badge" => 1
]);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
use serde_json::json;

let result = admin.push().send("user_123", &json!({
    "title": "New Message",
    "body": "Alice sent you a photo!",
    "badge": 1
})).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var payload = new Dictionary<string, object> {
    { "title", "New Message" },
    { "body", "Alice sent you a photo!" },
    { "badge", 1 }
};
var result = await admin.Push.SendAsync("user_123", payload);
```

</TabItem>
<TabItem value="java" label="Java">

```java
Map<String, Object> payload = Map.of(
    "title", "New Message",
    "body", "Alice sent you a photo!",
    "badge", 1
);
PushResult result = admin.push().send("user_123", payload);
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val result = admin.push().send("user_123", Map(
  "title" -> "New Message",
  "body" -> "Alice sent you a photo!",
  "badge" -> 1
))
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = admin.push.send("user_123", mapOf(
    "title" to "New Message",
    "body" to "Alice sent you a photo!",
    "badge" to 1
))
```

</TabItem>
<TabItem value="dart" label="Dart">

```dart
final result = await admin.push.send('user_123', {
    'title': 'New Message',
    'body': 'Alice sent you a photo!',
    'badge': 1,
});
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
result = admin.push.send("user_123", {
  "title" => "New Message",
  "body" => "Alice sent you a photo!",
  "badge" => 1,
})
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
result =
  admin
  |> EdgeBaseAdmin.push()
  |> EdgeBaseAdmin.Push.send!("user_123", %{
    "title" => "New Message",
    "body" => "Alice sent you a photo!",
    "badge" => 1
  })
```

</TabItem>
</Tabs>

### Response Object

All send methods return a summary:
- `sent` — Devices that successfully received the notification.
- `failed` — Devices that failed (network errors, bad config).
- `removed` — Devices whose tokens were automatically cleaned up (e.g., app uninstalled).

## Sending to Multiple Users (Bulk)

Send to multiple users in one call. The server automatically chunks requests into parallel batches.

<Tabs groupId="lang">
<TabItem value="ts" label="TypeScript" default>

```typescript
const result = await admin.push.sendMany(["user_1", "user_2", "user_3"], {
    title: "Server Maintenance",
    body: "We will be down for 5 minutes."
});
```

</TabItem>
<TabItem value="python" label="Python">

```python
result = admin.push.send_many(["user_1", "user_2", "user_3"], {
    "title": "Server Maintenance",
    "body": "We will be down for 5 minutes."
})
```

</TabItem>
<TabItem value="go" label="Go">

```go
result, _ := admin.Push.SendMany(ctx, []string{"user_1", "user_2"}, map[string]interface{}{
    "title": "Server Maintenance",
    "body":  "We will be down for 5 minutes.",
})
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$result = $admin->push()->sendMany(["user_1", "user_2"], [
    "title" => "Server Maintenance",
    "body" => "We will be down for 5 minutes."
]);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let result = admin.push().send_many(&["user_1", "user_2"], &json!({
    "title": "Server Maintenance",
    "body": "We will be down for 5 minutes."
})).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await admin.Push.SendManyAsync(
    new[] { "user_1", "user_2" },
    new Dictionary<string, object> { { "title", "Maintenance" }, { "body", "Down for 5 min." } }
);
```

</TabItem>
<TabItem value="java" label="Java">

```java
PushResult result = admin.push().sendMany(
    List.of("user_1", "user_2"),
    Map.of("title", "Server Maintenance")
);
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val result = admin.push().sendMany(
  Seq("user_1", "user_2"),
  Map("title" -> "Server Maintenance", "body" -> "We will be down for 5 minutes.")
)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = admin.push.sendMany(
    listOf("user_1", "user_2"),
    mapOf("title" to "Server Maintenance")
)
```

</TabItem>
<TabItem value="dart" label="Dart">

```dart
final result = await admin.push.sendMany(
    ['user_1', 'user_2'],
    {'title': 'Server Maintenance'},
);
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
result = admin.push.send_many(["user_1", "user_2"], {
  "title" => "Server Maintenance",
  "body" => "We will be down for 5 minutes.",
})
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
result =
  admin
  |> EdgeBaseAdmin.push()
  |> EdgeBaseAdmin.Push.send_many!(
    ["user_1", "user_2"],
    %{"title" => "Server Maintenance", "body" => "We will be down for 5 minutes."}
  )
```

</TabItem>
</Tabs>

## Sending to a Raw FCM Token

Send directly to any FCM token without looking up registered users. Useful for testing, external integrations, or when you manage tokens outside EdgeBase.

<Tabs groupId="lang">
<TabItem value="ts" label="TypeScript" default>

```typescript
const result = await admin.push.sendToToken("fcm-token-abc123...", {
    title: "Silent Sync",
    silent: true
});
```

</TabItem>
<TabItem value="python" label="Python">

```python
result = admin.push.send_to_token("fcm-token-abc123...", {
    "title": "Silent Sync",
    "silent": True
})
```

</TabItem>
<TabItem value="go" label="Go">

```go
result, _ := admin.Push.SendToToken(ctx, "fcm-token-abc123...", map[string]interface{}{
    "title": "Silent Sync",
    "silent": true,
})
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$result = $admin->push()->sendToToken("fcm-token-abc123...", [
    "title" => "Silent Sync",
    "silent" => true
]);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let result = admin.push().send_to_token("fcm-token-abc123...", &json!({
    "title": "Silent Sync",
    "silent": true
}), None).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await admin.Push.SendToTokenAsync("fcm-token-abc123...",
    new Dictionary<string, object> { { "title", "Silent Sync" }, { "silent", true } }
);
```

</TabItem>
<TabItem value="java" label="Java">

```java
PushResult result = admin.push().sendToToken("fcm-token-abc123...",
    Map.of("title", "Silent Sync", "silent", true));
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val result = admin.push().sendToToken(
  "fcm-token-abc123...",
  Map("title" -> "Silent Sync", "silent" -> true),
  "android"
)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = admin.push.sendToToken("fcm-token-abc123...",
    mapOf("title" to "Silent Sync", "silent" to true))
```

</TabItem>
<TabItem value="dart" label="Dart">

```dart
final result = await admin.push.sendToToken('fcm-token-abc123...', {
    'title': 'Silent Sync',
    'silent': true,
});
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
result = admin.push.send_to_token(
  "fcm-token-abc123...",
  { "title" => "Silent Sync", "silent" => true },
  platform: "android"
)
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
result =
  admin
  |> EdgeBaseAdmin.push()
  |> EdgeBaseAdmin.Push.send_to_token!(
    "fcm-token-abc123...",
    %{"title" => "Silent Sync", "silent" => true},
    "android"
  )
```

</TabItem>
</Tabs>

## Sending to a Topic

Send a push notification to all devices subscribed to a specific topic. Devices subscribe to topics via the client SDK (`client.push.subscribeTopic('news')`).

<Tabs groupId="lang">
<TabItem value="ts" label="TypeScript" default>

```typescript
const result = await admin.push.sendToTopic("news", {
    title: "Breaking News",
    body: "Something important happened!"
});
```

</TabItem>
<TabItem value="python" label="Python">

```python
result = admin.push.send_to_topic("news", {
    "title": "Breaking News",
    "body": "Something important happened!"
})
```

</TabItem>
<TabItem value="go" label="Go">

```go
result, _ := admin.Push.SendToTopic(ctx, "news", map[string]interface{}{
    "title": "Breaking News",
    "body":  "Something important happened!",
})
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$result = $admin->push()->sendToTopic("news", [
    "title" => "Breaking News",
    "body" => "Something important happened!"
]);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let result = admin.push().send_to_topic("news", &json!({
    "title": "Breaking News",
    "body": "Something important happened!"
})).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await admin.Push.SendToTopicAsync("news",
    new Dictionary<string, object> { { "title", "Breaking News" }, { "body", "Something happened!" } }
);
```

</TabItem>
<TabItem value="java" label="Java">

```java
admin.push().sendToTopic("news",
    Map.of("title", "Breaking News", "body", "Something important happened!"));
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val result = admin.push().sendToTopic("news", Map(
  "title" -> "Breaking News",
  "body" -> "Something important happened!"
))
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = admin.push.sendToTopic("news",
    mapOf("title" to "Breaking News", "body" to "Something important happened!"))
```

</TabItem>
<TabItem value="dart" label="Dart">

```dart
final result = await admin.push.sendToTopic('news', {
    'title': 'Breaking News',
    'body': 'Something important happened!',
});
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
result = admin.push.send_to_topic("news", {
  "title" => "Breaking News",
  "body" => "Something important happened!",
})
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
result =
  admin
  |> EdgeBaseAdmin.push()
  |> EdgeBaseAdmin.Push.send_to_topic!("news", %{
    "title" => "Breaking News",
    "body" => "Something important happened!"
  })
```

</TabItem>
</Tabs>

## Broadcasting to All Devices

Send a push notification to every registered device. This uses the special `all` topic that all devices are automatically subscribed to on registration.

<Tabs groupId="lang">
<TabItem value="ts" label="TypeScript" default>

```typescript
const result = await admin.push.broadcast({
    title: "App Update",
    body: "Version 2.0 is now available!"
});
```

</TabItem>
<TabItem value="python" label="Python">

```python
result = admin.push.broadcast({
    "title": "App Update",
    "body": "Version 2.0 is now available!"
})
```

</TabItem>
<TabItem value="go" label="Go">

```go
result, _ := admin.Push.BroadcastPush(ctx, map[string]interface{}{
    "title": "App Update",
    "body":  "Version 2.0 is now available!",
})
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$result = $admin->push()->broadcast([
    "title" => "App Update",
    "body" => "Version 2.0 is now available!"
]);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let result = admin.push().broadcast(&json!({
    "title": "App Update",
    "body": "Version 2.0 is now available!"
})).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await admin.Push.BroadcastAsync(
    new Dictionary<string, object> { { "title", "App Update" }, { "body", "Version 2.0 is available!" } }
);
```

</TabItem>
<TabItem value="java" label="Java">

```java
admin.push().broadcast(Map.of("title", "App Update", "body", "Version 2.0 is available!"));
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val result = admin.push().broadcast(Map(
  "title" -> "App Update",
  "body" -> "Version 2.0 is now available!"
))
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = admin.push.broadcast(mapOf(
    "title" to "App Update",
    "body" to "Version 2.0 is now available!"
))
```

</TabItem>
<TabItem value="dart" label="Dart">

```dart
final result = await admin.push.broadcast({
    'title': 'App Update',
    'body': 'Version 2.0 is now available!',
});
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
result = admin.push.broadcast({
  "title" => "App Update",
  "body" => "Version 2.0 is now available!",
})
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
result =
  admin
  |> EdgeBaseAdmin.push()
  |> EdgeBaseAdmin.Push.broadcast!(%{
    "title" => "App Update",
    "body" => "Version 2.0 is now available!"
  })
```

</TabItem>
</Tabs>

## Push Payload

```typescript
interface PushPayload {
  title?: string;                   // Notification title
  body?: string;                    // Notification body text
  image?: string;                   // Image URL (Android/Web)
  sound?: string;                   // Sound file name
  badge?: number;                   // Badge count (iOS)
  data?: Record<string, unknown>;   // Custom key-value pairs
  silent?: boolean;                 // true = background data push (no alert)
  collapseId?: string;              // Overwrite previous unread notifications
  ttl?: number;                     // Seconds before expiring (0 = deliver now or drop)
  fcm?: Record<string, unknown>;    // FCM-specific raw overrides
}
```

> [!TIP]
> **Silent Pushes**: Set `silent: true` to deliver a background data-only notification. The device won't show an alert, play a sound, or update the badge. Use this for background data sync.

## Reading Push Logs

Query push send logs for debugging. Logs are retained for **24 hours**.

<Tabs groupId="lang">
<TabItem value="ts" label="TypeScript" default>

```typescript
const logs = await admin.push.getLogs("user_123", 10);
console.log(logs);
```

</TabItem>
<TabItem value="python" label="Python">

```python
logs = admin.push.get_logs("user_123", limit=10)
```

</TabItem>
<TabItem value="go" label="Go">

```go
logs, _ := admin.Push.GetLogs(ctx, "user_123", 10)
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$logs = $admin->push()->getLogs("user_123", 10);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let logs = admin.push().get_logs("user_123", Some(10)).await?;
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var logs = await admin.Push.GetLogsAsync("user_123", limit: 10);
```

</TabItem>
<TabItem value="java" label="Java">

```java
List<PushLogEntry> logs = admin.push().getLogs("user_123", 10);
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val logs = admin.push().getLogs("user_123", limit = Some(10))
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val logs = admin.push.getLogs("user_123", limit = 10)
```

</TabItem>
<TabItem value="dart" label="Dart">

```dart
final logs = await admin.push.getLogs('user_123', limit: 10);
```

</TabItem>

<TabItem value="ruby" label="Ruby">

```ruby
logs = admin.push.get_logs("user_123", limit: 10)
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
logs =
  admin
  |> EdgeBaseAdmin.push()
  |> EdgeBaseAdmin.Push.get_logs!("user_123", limit: 10)
```

</TabItem>
</Tabs>

Each log entry contains:
- `sentAt` — Timestamp
- `userId` — Target user
- `platform` — Device platform
- `status` — `'sent'`, `'failed'`, or `'removed'`
- `error` — Error message (if failed)
- `collapseId` — Collapse key (if set)
