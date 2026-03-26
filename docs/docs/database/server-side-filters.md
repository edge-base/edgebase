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

EdgeBase supports two filtering modes for database subscriptions. On the JavaScript/TypeScript SDK, filtered table subscriptions use server-side filtering by default. Other client SDKs can opt in with `serverFilter: true` or the equivalent language-specific option.

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
  .onSnapshot((event) {
    print('Published post changed: ${event.data}');
  }, serverFilter: true);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let subscription = client.db("app").table("posts")
    .where("status", "==", "published")
    .onSnapshot(serverFilter: true) { event in
        print("Published post changed: \(event.data)")
    }
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val subscription = client.db("app").table("posts")
    .where("status", "==", "published")
    .onSnapshot(serverFilter = true) { event ->
        println("Published post changed: ${event.data}")
    }
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var sub = client.Db("app").Table("posts")
    .Where("status", "==", "published")
    .OnSnapshot(change => {
        Console.WriteLine($"Published post changed: {change.Data}");
    }, serverFilter: true);
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
int subId = client.db().onSnapshot("posts",
    {{"status", "==", "published"}},
    [](const eb::DbChange& change) {
        std::cout << "Published post changed" << std::endl;
    },
    eb::SnapshotOptions{.serverFilter = true});
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

## Updating Filters at Runtime

Change your filter conditions without re-subscribing using `updateFilters`:

```typescript
// Initially subscribe to published posts
const sub = client.db('app').table('posts')
  .where('status', '==', 'published')
  .onSnapshot(handler);

// Later, switch to draft posts without reconnecting
sub.updateFilters([
  { field: 'status', op: '==', value: 'draft' },
]);

// Remove all filters (receive everything)
sub.updateFilters(null);
```

- Set a field to `null` to clear that filter type
- No need to unsubscribe and resubscribe — filters are updated in-place

:::note
You must already be subscribed to the channel before calling `updateFilters`. Attempting to update filters on an unsubscribed channel returns a `NOT_SUBSCRIBED` error.
:::

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

This happens transparently — your `onSnapshot` callbacks continue working without interruption.
