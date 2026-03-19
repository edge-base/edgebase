---
sidebar_position: 1
title: Client SDK
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Client SDK — Event Tracking

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Track custom events from client SDKs with `client.analytics.track(...)`.

The common cross-SDK contract is intentionally small:

- `track(name, properties?)`
- `flush()`

Platform-specific delivery behavior differs by SDK.

## Supported Client SDKs

- JavaScript (`@edge-base/web`)
- React Native (`@edge-base/react-native`)
- Dart / Flutter
- Swift
- Kotlin
- Java
- C#
- C++

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
import dev.edgebase.sdk.client.ClientEdgeBase;
import dev.edgebase.sdk.client.EdgeBase;

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

client::EdgeBase client("https://my-app.edgebase.fun");
```

</TabItem>
</Tabs>

## Track Events

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await client.analytics.track('page_view');

await client.analytics.track('button_click', {
  id: 'signup-cta',
  variant: 'A',
  annual: true,
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.analytics.track('page_view');

await client.analytics.track('button_click', {
  'id': 'signup-cta',
  'variant': 'A',
  'annual': true,
});
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
try await client.analytics.track("page_view")
try await client.analytics.track("button_click", properties: [
    "id": "signup-cta",
    "variant": "A",
])
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.analytics.track("page_view")
client.analytics.track("button_click", mapOf(
    "id" to "signup-cta",
    "variant" to "A"
))
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.analytics().track("page_view");
client.analytics().track("button_click", Map.of(
    "id", "signup-cta",
    "variant", "A"
));
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await client.Analytics.TrackAsync("page_view");
await client.Analytics.TrackAsync("button_click", new Dictionary<string, object?> {
    ["id"] = "signup-cta",
    ["variant"] = "A",
});
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
client.analytics().track("page_view");
client.analytics().track("button_click", R"({"id":"signup-cta","variant":"A"})");
```

</TabItem>
</Tabs>

## Delivery Model

| SDK family | Delivery behavior |
|---|---|
| Web | Batched in memory, flushes on timer/batch size, uses `sendBeacon` on unload |
| React Native / mobile / desktop SDKs | Sends immediately, `flush()` is a compatibility no-op |

So `analytics.flush()` is meaningful on the web SDK, but safe to call everywhere.

## Authentication

If the client is signed in, analytics requests include the current auth token automatically. Anonymous tracking is also allowed.

## Cleanup

- `client.destroy()` remains the main SDK cleanup entrypoint.
- `analytics.destroy()` exists for compatibility, but outside the web SDK it is currently a no-op.
