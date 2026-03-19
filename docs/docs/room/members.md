---
sidebar_position: 13
title: Members (Presence)
description: Presence, room roster sync, and ephemeral per-member state.
sidebar_label: Members (Presence)
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Members (Presence)

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

`room.members` is the presence layer of Room.

It tells you who is currently in the room and lets each member publish lightweight ephemeral state such as typing, cursor position, or hand raise status.

## Client Surface

Assume `room` is an authenticated room client created with `client.room(...)`.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```ts
room.members.onSync((members) => renderRoster(members));
room.members.onJoin((member) => notifyJoin(member));
room.members.onLeave((member, reason) => notifyLeave(member, reason));

await room.members.setState({ typing: true, cursor: { x: 10, y: 20 } });
await room.members.clearState();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
room.members.onSync((members) => renderRoster(members));
room.members.onJoin((member) => notifyJoin(member));
room.members.onLeave((member, reason) => notifyLeave(member, reason));

await room.members.setState({'typing': true, 'cursor': {'x': 10, 'y': 20}});
await room.members.clearState();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
room.members.onSync { members in renderRoster(members) }
room.members.onJoin { member in notifyJoin(member) }
room.members.onLeave { member, reason in notifyLeave(member, reason) }

try await room.members.setState(["typing": true, "cursor": ["x": 10, "y": 20]])
try await room.members.clearState()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
room.members.onSync { members -> renderRoster(members) }
room.members.onJoin { member -> notifyJoin(member) }
room.members.onLeave { member, reason -> notifyLeave(member, reason) }

room.members.setState(mapOf("typing" to true, "cursor" to mapOf("x" to 10, "y" to 20)))
room.members.clearState()
```

</TabItem>
<TabItem value="java" label="Java">

```java
room.members.onSync(members -> renderRoster(members));
room.members.onJoin(member -> notifyJoin(member));
room.members.onLeave((member, reason) -> notifyLeave(member, reason));

room.members.setState(Map.of("typing", true, "cursor", Map.of("x", 10, "y", 20))).join();
room.members.clearState().join();
```

</TabItem>
<TabItem value="csharp" label="C#/Unity">

```csharp
room.Members.OnSync(members => RenderRoster(members));
room.Members.OnJoin(member => NotifyJoin(member));
room.Members.OnLeave((member, reason) => NotifyLeave(member, reason));

await room.Members.SetState(new Dictionary<string, object?> { ["typing"] = true });
await room.Members.ClearState();
```

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

```cpp
room->members.on_sync([](const json& members) { render_roster(members); });
room->members.on_join([](const json& member) { notify_join(member); });
room->members.on_leave([](const json& member, const std::string& reason) { notify_leave(member, reason); });

room->members.set_state({{"typing", true}}, []() {}, [](const std::string&) {});
room->members.clear_state([]() {}, [](const std::string&) {});
```

</TabItem>
</Tabs>

The main client APIs are:

- `room.members.list()`
- `room.members.onSync(...)`
- `room.members.onJoin(...)`
- `room.members.onLeave(...)`
- `room.members.setState(...)`
- `room.members.clearState()`
- `room.members.onStateChange(...)`

## Member Semantics

- A public member is user-oriented, not raw-connection-oriented.
- `connectionId` still exists when needed for diagnostics or metadata.
- `connectionCount` lets you distinguish one user on multiple tabs or devices.

Typical leave reasons are:

- `leave`
- `disconnect`
- `kicked`

## Server Hooks

Room exposes member-specific hooks so you can mirror presence into metadata or analytics without mixing it into authoritative state.

```ts
rooms: {
  collab: {
    hooks: {
      members: {
        onJoin: (member, room) => {
          room.setMetadata({ ...room.getMetadata(), lastMemberJoin: member.memberId });
        },
        onStateChange: (member, state, room) => {
          room.setMetadata({
            ...room.getMetadata(),
            lastPresenceUpdate: { memberId: member.memberId, state },
          });
        },
      },
    },
  },
}
```

## Members vs State

- Use [State](/docs/room/state) for source-of-truth gameplay or collaborative data.
- Use `members` for ephemeral presence information that should disappear when users leave.

## Session Interaction

Reconnect behavior affects membership:

- a disconnect can temporarily keep a member in the room during the reconnect grace period
- `hooks.session.onReconnect(...)` and `hooks.session.onDisconnectTimeout(...)` let you observe that lifecycle

See [Advanced](/docs/room/advanced) for reconnect timing details.

## Related Docs

- [Client SDK](/docs/room/client-sdk)
- [Advanced](/docs/room/advanced)
- [Overview](/docs/room)
