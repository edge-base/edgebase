---
sidebar_position: 14
title: Signals (Broadcast)
description: Fire-and-forget room events for chat, cursors, notifications, and WebRTC signaling.
sidebar_label: Signals (Broadcast)
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Signals (Broadcast)

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

`room.signals` is the ephemeral event rail of Room.

Signals are not authoritative state. They are for events you want to deliver now without storing them as the room's source of truth.

## Good Fits for Signals

- chat events
- typing bursts
- cursor movement
- read receipts
- transient notifications
- WebRTC offer/answer/ICE signaling

## Client Surface

Assume `room` is an authenticated room client created with `client.room(...)`.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```ts
room.signals.on('chat.message', (payload, meta) => {
  appendMessage(payload, meta);
});

room.signals.onAny((event, payload) => {
  console.log('signal', event, payload);
});

await room.signals.send('chat.message', { text: 'hello' });
await room.signals.sendTo('member-2', 'private_hint', { text: 'look left' });
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
room.signals.on('chat.message', (payload, meta) => appendMessage(payload, meta));
room.signals.onAny((event, payload, meta) => print('$event $payload'));

await room.signals.send('chat.message', {'text': 'hello'});
await room.signals.sendTo('member-2', 'private_hint', {'text': 'look left'});
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
room.signals.on("chat.message") { payload, meta in
    appendMessage(payload, meta)
}
room.signals.onAny { event, payload, _ in print(event, payload as Any) }

try await room.signals.send("chat.message", payload: ["text": "hello"])
try await room.signals.sendTo(memberId: "member-2", event: "private_hint", payload: ["text": "look left"])
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
room.signals.on("chat.message") { payload, meta -> appendMessage(payload, meta) }
room.signals.onAny { event, payload, _ -> println("$event $payload") }

room.signals.send("chat.message", mapOf("text" to "hello"))
room.signals.sendTo("member-2", "private_hint", mapOf("text" to "look left"))
```

</TabItem>
<TabItem value="java" label="Java">

```java
room.signals.on("chat.message", (payload, meta) -> appendMessage(payload, meta));
room.signals.onAny((event, payload, meta) -> System.out.println(event + " " + payload));

room.signals.send("chat.message", Map.of("text", "hello")).join();
room.signals.sendTo("member-2", "private_hint", Map.of("text", "look left")).join();
```

</TabItem>
<TabItem value="csharp" label="C#/Unity">

```csharp
room.Signals.On("chat.message", (payload, meta) => AppendMessage(payload, meta));
room.Signals.OnAny((eventName, payload, meta) => Debug.Log($"{eventName} {payload}"));

await room.Signals.Send("chat.message", new Dictionary<string, object?> { ["text"] = "hello" });
await room.Signals.SendTo("member-2", "private_hint", new Dictionary<string, object?> { ["text"] = "look left" });
```

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

```cpp
room->signals.on("chat.message", [](const json& payload, const json& meta) {
    append_message(payload, meta);
});
room->signals.on_any([](const std::string& event, const json& payload, const json&) {
    std::cout << event << " " << payload.dump() << std::endl;
});

room->signals.send("chat.message", {{"text", "hello"}}, []() {}, [](const std::string&) {});
room->signals.send_to("member-2", "private_hint", {{"text", "look left"}}, []() {}, [](const std::string&) {});
```

</TabItem>
</Tabs>

The main client APIs are:

- `room.signals.send(event, payload, options?)`
- `room.signals.sendTo(memberId, event, payload?)`
- `room.signals.on(event, handler)`
- `room.signals.onAny(handler)`

## Server Surface

Server-side code uses the existing Room message helpers:

- `room.sendMessage(type, data?, options?)`
- `room.sendMessageTo(userId, type, data?)`

```ts
handlers: {
  actions: {
    CHAT: (payload, room, sender) => {
      room.sendMessage('chat.message', {
        from: sender.userId,
        text: payload.text,
      });
    },
  },
},
```

## Access and Hooks

Signals have their own control points:

- `access.signal(auth, roomId, event, payload)` — allow/deny the signal
- `hooks.signals.beforeSend(event, payload, sender, room, ctx)` — transform or reject before delivery
- `hooks.signals.onSend(event, payload, sender, room, ctx)` — side effects after delivery

```typescript
rooms: {
  game: {
    access: {
      signal: (auth, roomId, event) => auth !== null,
    },
    hooks: {
      signals: {
        beforeSend: async (event, payload, sender, room, ctx) => {
          // Return false to reject
          if (event === 'spam') return false;
          // Return transformed payload
          return { ...payload, timestamp: Date.now() };
          // Return undefined to pass through unchanged
        },
        onSend: async (event, payload, sender, room, ctx) => {
          console.log(`Signal ${event} from ${sender.userId}`);
        },
      },
    },
  },
},
```

| Hook | Return | Behavior |
|------|--------|----------|
| `beforeSend` | `false` | Reject signal — client receives `signal_error` |
| `beforeSend` | transformed payload | Deliver modified payload to recipients |
| `beforeSend` | `undefined` / `void` | Deliver original payload unchanged |
| `onSend` | — | Non-blocking side effects only |

Use them to reject, transform, audit, or mirror transient event traffic.

## Signals vs State

- Use [State](/docs/room/state) when the server must own the durable truth.
- Use `signals` when the event is transient and should not become part of shared or private state.

## Legacy Compatibility

Older or compatibility-oriented SDK examples may still refer to:

- `room.onMessage(...)`
- `room.onAnyMessage(...)`

On unified clients, `room.signals.*` is the preferred model.

## Related Docs

- [Client SDK](/docs/room/client-sdk#signals-and-legacy-messages)
- [Server Hooks and Actions](/docs/room/server)
- [Access Rules](/docs/room/access-rules)
