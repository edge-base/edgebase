---
sidebar_position: 5
sidebar_label: Subscriptions
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Database Subscriptions

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Listen to real-time database changes with `onSnapshot`. Use `client.db(namespace).table(name)` to access the correct DB block.

## Table Subscription

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const unsubscribe = client.db('app').table('posts').onSnapshot((snapshot) => {
  console.log('Current posts:', snapshot.items);
  console.log('Added:', snapshot.changes.added);
  console.log('Modified:', snapshot.changes.modified);
  console.log('Removed:', snapshot.changes.removed);
});

// Stop listening
unsubscribe();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final subscription = client.db('app').table('posts').onSnapshot((event) {
  if (event.type == ChangeType.added) {
    print('New post: ${event.data}');
  }
});

// Stop listening
subscription.cancel();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let subscription = client.db("app").table("posts").onSnapshot { event in
    switch event.type {
    case .added: print("New post: \(event.data)")
    case .modified: print("Updated: \(event.data)")
    case .removed: print("Deleted: \(event.docId)")
    }
}

subscription.cancel()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val subscription = client.db("app").table("posts").onSnapshot { event ->
    when (event.type) {
        "added" -> println("New: ${event.data}")
        "modified" -> println("Updated: ${event.data}")
        "removed" -> println("Deleted: ${event.docId}")
    }
}

subscription.cancel()
```

</TabItem>

<TabItem value="java" label="Java">

```java
Subscription sub = client.db("app").table("posts").onSnapshot(event -> {
    System.out.println(event.getType() + ": " + event.getData());
});

// Later: sub.cancel();
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var sub = client.Db("app").Table("posts").OnSnapshot(change => {
    if (change.Type == "added")
        Console.WriteLine($"New post: {change.Data}");
});

// Stop listening
sub.Cancel();
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
int subId = client.db().onSnapshot("posts", [](const eb::DbChange& change) {
    if (change.changeType == "added")
        std::cout << "New post: " << change.dataJson << std::endl;
});

// Stop listening
client.db().unsubscribe(subId);
```

</TabItem>
</Tabs>

## Document Subscription

Subscribe to changes on a single document:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const unsubscribe = client.db('app').table('posts').doc('post-id').onSnapshot((post, change) => {
  console.log(change.changeType, post);
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final subscription = client.db('app').table('posts').doc('post-id').onSnapshot((event) {
  print('Document changed: ${event.data}');
});
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let subscription = client.db("app").table("posts").doc("post-id").onSnapshot { event in
    print("Document changed: \(event.data)")
}
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val subscription = client.db("app").table("posts").doc("post-id").onSnapshot { event ->
    println("Document changed: ${event.data}")
}
```

</TabItem>
<TabItem value="java" label="Java">

```java
Subscription sub = client.db("app").table("posts").doc("post-id").onSnapshot(event -> {
    System.out.println("Document changed: " + event.getData());
});
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var sub = client.Db("app").Table("posts").Doc("post-id").OnSnapshot(change => {
    Console.WriteLine($"Document changed: {change.Data}");
});
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
int subId = client.db().onDocSnapshot("posts", "post-id", [](const eb::DbChange& change) {
    std::cout << "Document changed: " << change.dataJson << std::endl;
});
```

</TabItem>
</Tabs>

When a change occurs, both the table-level subscription and the document-level subscription receive the event simultaneously (dual propagation).

## Filtered Subscriptions

Filter events using `where()`.

### JavaScript / TypeScript Default

On the JavaScript/TypeScript SDK, filtered table subscriptions now use server-side filtering by default, so the server only sends matching events:

```typescript
const unsubscribe = client.db('app').table('posts')
  .where('status', '==', 'published')
  .onSnapshot((snapshot) => {
    console.log(snapshot.items);
  });
```

This reduces bandwidth and client-side processing without any extra option.

If you intentionally want the old client-side behavior in JavaScript, opt out explicitly:

```typescript
const unsubscribe = client.db('app').table('posts')
  .where('status', '==', 'published')
  .onSnapshot((snapshot) => {
    console.log(snapshot.items);
  }, { serverFilter: false });
```

### Other Client SDKs

Other client SDKs still opt in with their language-specific `serverFilter` option when you want server-side filtering.

Server-side filters support AND conditions, OR conditions, 8 comparison operators, and runtime updates. See [Server-Side Filters](./server-side-filters) for the full guide.

:::note Admin SDKs
Database subscriptions are only available in **client SDKs** (JavaScript, Dart, Swift, Kotlin, C#, C++). Server-only Admin SDKs do not support `onSnapshot`. Use [server-side broadcast](#server-side-broadcast) instead.
:::

## JavaScript Callback Shapes

JavaScript table subscriptions receive a `TableSnapshot<T>` object:

| Property | Type | Description |
|----------|------|-------------|
| `items` | `T[]` | Current rows visible to the subscription |
| `changes.added` | `T[]` | Rows newly added to the current result |
| `changes.modified` | `T[]` | Rows updated but still visible |
| `changes.removed` | `T[]` | Rows removed or no longer matching |

JavaScript document subscriptions receive `(data, change)`, where `change.changeType` is one of `added`, `modified`, or `removed`.

## Authentication

WebSocket connections require JWT authentication. The SDK handles this automatically — after connecting, it sends an auth message before any subscriptions. See [Architecture](/docs/architecture/database-live-internals#authentication-handshake) for protocol details.

Key behaviors:
- **Timeout**: 5000ms default
- **Token refresh**: The SDK automatically sends refreshed tokens. The server re-evaluates all subscriptions and revokes any that are no longer authorized.
- **`subscription_revoked` event**: Listen globally to handle permission changes:

```typescript
client.databaseLive.onError((error) => {
  if (error.code === 'SUBSCRIPTION_REVOKED') {
    console.warn('Subscription revoked:', error.message);
  }
});
```

### Token Refresh and Revoked Channels

When a client's auth token is refreshed on a long-lived WebSocket connection, the server re-evaluates channel access. The response includes any channels the client lost access to:

```json
{
  "type": "auth_refreshed",
  "userId": "user-123",
  "revokedChannels": ["db:private-table"]
}
```

| Field | Description |
|-------|-------------|
| `revokedChannels` | List of channels the client lost access to after token refresh |

- The client should handle this by removing subscriptions for revoked channels
- This occurs when user roles or permissions change while the client is connected
- If no channels are revoked, `revokedChannels` is an empty array
- If the refresh fails, existing auth is preserved and a non-fatal error is returned

## Batch Changes

When many changes occur simultaneously (e.g., bulk operations), the server batches them into a single `batch_changes` message instead of individual events. The batch threshold is **10 changes** by default.

JavaScript table subscriptions coalesce live changes into a single snapshot callback, so high-frequency UIs should batch their renders too.

### High-Frequency Update Pattern

For scenarios with very frequent updates (e.g., real-time analytics), consider debouncing your UI updates:

```typescript
let pending: Array<Record<string, unknown>> = [];

client.db('app').table('metrics').onSnapshot((snapshot) => {
  pending.push(
    ...snapshot.changes.added,
    ...snapshot.changes.modified,
    ...snapshot.changes.removed,
  );
  requestAnimationFrame(() => {
    if (pending.length > 0) {
      renderUpdates(pending);
      pending = [];
    }
  });
});
```

## Type-Safe Subscriptions

Use your generated types when you create the table ref:

```typescript
import type { Post } from './edgebase.d.ts';

// Typed subscription — snapshot.items is Post[]
const unsub = client.db('app').table<Post>('posts').onSnapshot((snapshot) => {
  console.log(snapshot.items[0]?.title); // TypeScript autocomplete
});
```

## Access Rules

Database subscriptions reuse the table's existing `read` access rule. No additional configuration is needed.

```typescript
export default defineConfig({
  databases: {
    app: {
      tables: {
        posts: {
          access: {
            read(auth, doc) { return auth !== null },  // also used for onSnapshot
          },
        },
      },
    },
  },
});
```

When a client calls `.onSnapshot()`, the server evaluates the `read` rule once at subscribe time. After subscription, every database change event is delivered to the subscriber. Use [server-side filters](./server-side-filters) for per-event filtering.

## Connection Management

- **Auto-reconnect** — Reconnects automatically on disconnection with exponential backoff
- **Namespace-aware** — Use `client.db(namespace, id?)` to route subscriptions to the correct DB block
- **Tab token sync** — Auth/token state is synchronized across browser tabs
- **Hibernation recovery** — Idle WebSocket connections cost $0 via Cloudflare's Hibernation API. On wake-up, the SDK automatically re-registers filters and resumes subscriptions.

## Server-Side Broadcast

Admin SDKs can broadcast messages to database subscription channels via the REST API. This uses Service Key authentication and is useful for server-originated notifications.

```
POST /api/db/broadcast
```

**Headers:**
- `X-EdgeBase-Service-Key: <your-service-key>` (required)
- `Content-Type: application/json`

**Body:**
```json
{
  "channel": "chat-room",
  "event": "message",
  "payload": { "text": "System announcement" }
}
```

Inside App Functions, use `context.admin.broadcast()`:

```typescript
export default async function onPostCreate(doc, context) {
  await context.admin.broadcast('updates', 'new-post', {
    id: doc.id,
    title: doc.data.title,
  });
}
```

:::tip Subscriptions vs Room
Database subscriptions deliver **database change events** — there's no server-side state management. If you need server-authoritative state (game logic, collaborative editing, etc.), use [Room](/docs/room) instead. For presence tracking and client-to-client messaging, use [Room Members](/docs/room/members) and [Room Signals](/docs/room/signals).
:::
