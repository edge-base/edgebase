---
sidebar_position: 12
title: Meta (Room Info)
description: Public-safe room metadata for lobby cards, matchmaking, and pre-join fetches.
sidebar_label: Meta (Room Info)
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Meta (Room Info)

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

`room.meta` is the public-safe description of a room.

It is separate from authoritative room state so you can show room cards, matchmaking previews, or pre-join summaries without exposing internal game state.

## What Belongs in Meta

- mode or ruleset
- player count
- public title or label
- whether a match is open, full, or in progress

Do not put secrets, tokens, email addresses, or private user data in metadata.

## Client Surface

`room.meta.get()` can be used before or after join.

On the JavaScript/TypeScript web SDK, `room.meta.summary()` adds live occupancy counts on top of the metadata payload, `client.getRoomSummary(namespace, roomId)` provides the same HTTP helper without creating a room instance first, and `client.getRoomSummaries(namespace, roomIds)` batches multiple room cards into one request.

Assume `room` is an authenticated room client created with `client.room(...)`.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```ts
const meta = await room.meta.get();
console.log(meta.mode, meta.playerCount);

const summary = await room.meta.summary();
console.log(summary.occupancy.activeMembers);
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final meta = await room.meta.get();
print('${meta['mode']} ${meta['playerCount']}');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let meta = try await room.meta.get()
print(meta["mode"], meta["playerCount"])
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val meta = room.meta.get()
println("${meta["mode"]} ${meta["playerCount"]}")
```

</TabItem>
<TabItem value="java" label="Java">

```java
Map<String, Object> meta = room.meta.get();
System.out.println(meta.get("mode") + " " + meta.get("playerCount"));
```

</TabItem>
<TabItem value="csharp" label="C#/Unity">

```csharp
var meta = await room.Meta.Get();
Debug.Log($"{meta["mode"]} {meta["playerCount"]}");
```

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

```cpp
json meta = room->meta.get();
std::cout << meta["mode"] << " " << meta["playerCount"] << std::endl;
```

</TabItem>
</Tabs>

The underlying HTTP API is:

```text
GET /api/room/metadata?namespace={ns}&id={roomId}
```

For lobby cards and room lists, the occupancy-aware companion endpoint is:

```text
GET /api/room/summary?namespace={ns}&id={roomId}
```

For list UIs that need multiple room cards at once, use:

```text
POST /api/room/summaries
```

## Server Surface

```ts
rooms: {
  game: {
    handlers: {
      lifecycle: {
        onCreate(room) {
          room.setMetadata({ mode: 'classic', playerCount: 0 });
        },
        onJoin(_sender, room) {
          const meta = room.getMetadata();
          room.setMetadata({ ...meta, playerCount: (meta.playerCount as number) + 1 });
        },
        onLeave(_sender, room) {
          const meta = room.getMetadata();
          room.setMetadata({ ...meta, playerCount: Math.max(0, (meta.playerCount as number) - 1) });
        },
      },
    },
  },
}
```

The server APIs are:

- `room.setMetadata(data)`
- `room.getMetadata()`

## Access Control

Metadata fetches are controlled separately from join:

- `access.metadata(auth, roomId)`

That means a room can expose a public lobby card while still requiring auth or custom checks for the actual join.

See [Access Rules](/docs/room/access-rules).

## Meta vs State

- Use [State](/docs/room/state) for authoritative gameplay or collaborative state.
- Use `meta` for pre-join or publicly readable room summary data.
- Use `summary` when you also need a live count of active members or connections without joining.

## Related Docs

- [Server Hooks and Actions](/docs/room/server#room-metadata)
- [Access Rules](/docs/room/access-rules)
- [Overview](/docs/room)
