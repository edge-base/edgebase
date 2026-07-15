---
sidebar_position: 6
sidebar_label: Server-Side Filters
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Server-Side Filters

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Reduce bandwidth and client-side processing by letting the server evaluate filter conditions before sending subscription events.

## Overview

EdgeBase supports two filtering modes for database subscriptions. JavaScript,
Dart/Flutter, C#/Unity, and C++/Unreal forward chained table filters to the
server by default. Swift, Kotlin, and Java currently apply chained subscription
filters on the client after receiving events.

| | Client-Side | Server-Side |
|---|---|---|
| **How** | Server sends all events; SDK filters locally | Server evaluates filters; only matching events sent |
| **Bandwidth** | Higher — all events transmitted | Lower — only matching events |
| **CPU** | Client evaluates | Server evaluates |
| **Flexibility** | Any filter logic | 8 operators, max 5 conditions per type |
| **Best for** | Opt-out compatibility or local debugging | Production, high-traffic tables |

## Quick Start

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const unsubscribe = client.db('app').table('posts')
  .where('status', '==', 'published')
  .onSnapshot((snapshot) => {
    console.log('Published posts:', snapshot.items);
  });
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final subscription = client.db('app').table('posts')
  .where('status', '==', 'published')
  .onSnapshot()
  .listen((event) {
    print('Published post changed: ${event.record}');
  });

await subscription.cancel();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
// Swift currently evaluates this chained filter on the client.
let subscription = Task {
    let stream = client.db("app").table("posts")
        .where("status", "==", "published")
        .onSnapshot()
    for await event in stream {
        print("Published post changed: \(event.record ?? [:])")
    }
}

subscription.cancel()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

// Kotlin currently evaluates this chained filter on the client.
val subscription = CoroutineScope(Dispatchers.Default).launch {
    client.db("app").table("posts")
        .where("status", "==", "published")
        .onSnapshot()
        .collect { event ->
            println("Published post changed: ${event.record}")
        }
}

subscription.cancel()
```

</TabItem>
<TabItem value="java" label="Java">

```java
// Java currently evaluates this chained filter on the client.
var sub = client.db("app").table("posts")
    .where("status", "==", "published")
    .onSnapshot(event -> {
        System.out.println("Published post changed: " + event.getRecord());
    });

sub.cancel();
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var sub = await client.Db("app").Table("posts")
    .Where("status", "==", "published")
    .OnSnapshot(change => {
        Console.WriteLine($"Published post changed: {change.Data}");
    });

sub.Dispose();
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto posts = client.db("app").table("posts")
    .where("status", "==", "published");
int subId = posts.onSnapshot([](const eb::DbChange& change) {
    std::cout << "Published post changed" << std::endl;
});

posts.unsubscribe(subId);
```

</TabItem>
</Tabs>

## JavaScript Default

On JavaScript/TypeScript, any filtered table subscription created with `.where()` or `.whereOr()` now uses server-side filtering automatically.

If you intentionally want the old client-side behavior, opt out explicitly:

```typescript
const unsubscribe = client.db('app').table('posts')
  .where('status', '==', 'published')
  .onSnapshot(handler, { serverFilter: false });
```

## AND Filters

AND filters require **all** conditions to match. Chain multiple `.where()` calls:

```typescript
// Both conditions must be true
const unsubscribe = client.db('app').table('posts')
  .where('status', '==', 'published')
  .where('authorId', '==', 'user-123')
  .onSnapshot(handler);
```

## OR Filters

OR filters require **at least one** condition to match. Use `.whereOr()`:

```typescript
// status is 'published' OR 'featured'
const unsubscribe = client.db('app').table('posts')
  .where('authorId', '==', 'user-123')
  .whereOr('status', '==', 'published')
  .whereOr('status', '==', 'featured')
  .onSnapshot(handler);
```

This is equivalent to: `WHERE authorId = 'user-123' AND (status = 'published' OR status = 'featured')`

## Supported Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `==` | Equal to | `['status', '==', 'published']` |
| `!=` | Not equal to | `['status', '!=', 'draft']` |
| `<` | Less than | `['price', '<', 100]` |
| `<=` | Less than or equal | `['price', '<=', 100]` |
| `>` | Greater than | `['score', '>', 90]` |
| `>=` | Greater than or equal | `['score', '>=', 90]` |
| `in` | Contained in array | `['category', 'in', ['tech', 'science']]` |
| `contains` | Array field contains value | `['tags', 'contains', 'featured']` |

## Changing Filters

The high-level query API does not expose an in-place `updateFilters` handle.
Unsubscribe and create a new filtered subscription:

```typescript
// Initially subscribe to published posts
let unsubscribe = client.db('app').table('posts')
  .where('status', '==', 'published')
  .onSnapshot(handler);

// Later, switch to draft posts.
unsubscribe();
unsubscribe = client.db('app').table('posts')
  .where('status', '==', 'draft')
  .onSnapshot(handler);
```

## Limits

| Limit | Value |
|-------|-------|
| AND filter conditions | **5 max** per subscription |
| OR filter conditions | **5 max** per subscription |

Exceeding these limits returns an `INVALID_FILTERS` error and the subscription is rejected.

## Filter Evaluation Order

When the server processes a database change event, it evaluates in this order:

1. **Access rule check** — The table's `read` rule was evaluated at subscribe time.
2. **AND filter evaluation** — Every AND condition must match the event data.
3. **OR filter evaluation** — At least one OR condition must match (if OR filters exist).
4. **Delivery** — Only if both AND and OR filters pass, the event is sent to the subscriber.

:::info
Filters can only **restrict** which events you receive — they cannot bypass access rules. If your `read` rule denies access, no filter combination will override it.
:::

## Hibernation Recovery

When a Durable Object hibernates (idle WebSocket) and wakes up, all in-memory filter state is lost. The server sends a `FILTER_RESYNC` message to all authenticated sockets, and the SDK automatically re-registers all filter conditions.

SDK transports that registered server-side filters retain those conditions and
re-send them automatically. This happens transparently to the active
`onSnapshot` subscription.
