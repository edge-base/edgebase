---
sidebar_position: 11
title: State (Room State)
description: Server-authoritative room state with shared, private, and server-only areas.
sidebar_label: State (Room State)
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# State (Room State)

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

`room.state` is the authoritative core of Room.

Clients do not mutate room state directly. They send actions, the server validates them in `handlers.actions`, and the runtime syncs only the changed fields back to clients.

## Three State Areas

| Area | Who can read it | Who can write it | Good for |
| --- | --- | --- | --- |
| `sharedState` | Everyone in the room | Server only | Board state, score, phase, shared counters |
| `playerState` | The owning player only | Server only | HP, private hand, inventory, personal cooldowns |
| `serverState` | Server only | Server only | RNG seeds, anti-cheat data, internal caches |

## Client Surface

Assume `room` is an authenticated room client created with `client.room(...)`.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```ts
const shared = room.state.getShared();
const mine = room.state.getMine();

room.state.onSharedChange((state) => renderBoard(state));
await room.state.send('MOVE', { x: 5, y: 3 });
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final shared = room.state.getShared();
final mine = room.state.getMine();

room.state.onSharedChange((state, delta) => renderBoard(state));
await room.state.send('MOVE', {'x': 5, 'y': 3});
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let shared = room.state.getShared()
let mine = room.state.getMine()

room.state.onSharedChange { state, _ in
    renderBoard(state)
}
try await room.state.send("MOVE", payload: ["x": 5, "y": 3])
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val shared = room.state.getShared()
val mine = room.state.getMine()

room.state.onSharedChange { state, _ -> renderBoard(state) }
room.state.send("MOVE", mapOf("x" to 5, "y" to 3))
```

</TabItem>
<TabItem value="java" label="Java">

```java
Map<String, Object> shared = room.state.getShared();
Map<String, Object> mine = room.state.getMine();

room.state.onSharedChange((state, delta) -> renderBoard(state));
room.state.send("MOVE", Map.of("x", 5, "y", 3)).join();
```

</TabItem>
<TabItem value="csharp" label="C#/Unity">

```csharp
var shared = room.State.GetShared();
var mine = room.State.GetMine();

room.State.OnSharedChange((state, delta) => RenderBoard(state));
await room.State.Send("MOVE", new Dictionary<string, object?> { ["x"] = 5, ["y"] = 3 });
```

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

```cpp
json shared = room->state.get_shared();
json mine = room->state.get_mine();

room->state.on_shared_change([](const json& state, const json&) {
    render_board(state);
});
room->state.send("MOVE", {{"x", 5}, {"y", 3}}, [](const json&) {}, [](const std::string&) {});
```

</TabItem>
</Tabs>

## Server Surface

`room.state.send(...)` maps to `handlers.actions` on the server.

```ts
rooms: {
  game: {
    state: {
      actions: {
        MOVE: (payload, room, sender) => {
          room.setPlayerState(sender.userId, (state) => ({
            ...state,
            position: { x: payload.x, y: payload.y },
          }));
          return { ok: true };
        },
      },
    },
  },
}
```

The main server APIs are:

- `room.getSharedState()` / `room.setSharedState(...)`
- `room.player(userId)` / `room.players()`
- `room.setPlayerState(userId, ...)`
- `room.getServerState()` / `room.setServerState(...)`
- `room.saveState()`

## State vs Other Room Capabilities

- Use [Members](/docs/room/members) for presence and lightweight ephemeral member state.
- Use [Signals](/docs/room/signals) for fire-and-forget events that should not become source of truth.
- Use [Meta](/docs/room/meta) for lobby-safe information that can be fetched before join.

## Hooks and Persistence

- `hooks.state.onStateChange(delta, room, ctx)` lets you mirror or observe authoritative changes.
- `room.saveState()` forces immediate persistence for critical updates.
- State survives hibernation according to `stateSaveInterval` and `stateTTL`. See [Advanced](/docs/room/advanced).

## Related Docs

- [Client SDK](/docs/room/client-sdk)
- [Server Hooks and Actions](/docs/room/server)
- [Advanced](/docs/room/advanced)
