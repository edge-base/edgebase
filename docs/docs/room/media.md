---
sidebar_position: 15
title: Media (Voice/Video)
description: Room-scoped audio, video, and screen-share state with publish, mute, and device controls.
sidebar_label: Media (Voice/Video)
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Media (Voice/Video)

:::caution Alpha
This feature is in **alpha**. APIs and behavior may change without notice. Not recommended for production use.
:::

`room.media` is the media-state layer of Room.

It tracks who is publishing audio, video, or screen share, which tracks are present, and how mute or device state changes over time.

## Client Surface

Assume `room` is an authenticated room client created with `client.room(...)`.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```ts
await room.media.audio.enable({ deviceId: 'mic-1' });
await room.media.video.enable({ deviceId: 'cam-2' });
await room.media.screen.start();

room.media.onTrack((track, member) => attachTrack(track, member));
room.media.onTrackRemoved((track, member) => detachTrack(track, member));
room.media.onStateChange((member, state) => renderMediaState(member, state));

await room.media.devices.switch({ audioInputId: 'mic-2' });
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await room.media.audio.enable({'deviceId': 'mic-1'});
await room.media.video.enable({'deviceId': 'cam-2'});
await room.media.screen.start();

room.media.onTrack((track, member) => attachTrack(track, member));
await room.media.devices.switchInputs({'audioInputId': 'mic-2'});
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
try await room.media.audio.enable(["deviceId": "mic-1"])
try await room.media.video.enable(["deviceId": "cam-2"])
try await room.media.screen.start()

room.media.onTrack { track, member in attachTrack(track, member) }
try await room.media.devices.switch(["audioInputId": "mic-2"])
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
room.media.audio.enable(mapOf("deviceId" to "mic-1"))
room.media.video.enable(mapOf("deviceId" to "cam-2"))
room.media.screen.start()

room.media.onTrack { track, member -> attachTrack(track, member) }
room.media.devices.switch(mapOf("audioInputId" to "mic-2"))
```

</TabItem>
<TabItem value="java" label="Java">

```java
room.media.audio.enable(Map.of("deviceId", "mic-1")).join();
room.media.video.enable(Map.of("deviceId", "cam-2")).join();
room.media.screen.start(Map.of()).join();

room.media.onTrack((track, member) -> attachTrack(track, member));
room.media.devices.switchInputs(Map.of("audioInputId", "mic-2")).join();
```

</TabItem>
<TabItem value="csharp" label="C#/Unity">

```csharp
await room.Media.Audio.Enable(new Dictionary<string, object?> { ["deviceId"] = "mic-1" });
await room.Media.Video.Enable(new Dictionary<string, object?> { ["deviceId"] = "cam-2" });
await room.Media.Screen.Start();

room.Media.OnTrack((track, member) => AttachTrack(track, member));
await room.Media.Devices.Switch(new Dictionary<string, object?> { ["audioInputId"] = "mic-2" });
```

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

```cpp
room->media.audio.enable({{"deviceId", "mic-1"}}, []() {}, [](const std::string&) {});
room->media.video.enable({{"deviceId", "cam-2"}}, []() {}, [](const std::string&) {});
room->media.screen.start(json::object(), []() {}, [](const std::string&) {});

room->media.on_track([](const json& track, const json& member) { attach_track(track, member); });
room->media.devices.set({{"audioInputId", "mic-2"}}, []() {}, [](const std::string&) {});
```

</TabItem>
</Tabs>

The main client APIs are:

- `room.media.list()`
- `room.media.audio.enable()` / `disable()` / `setMuted()`
- `room.media.video.enable()` / `disable()` / `setMuted()`
- `room.media.screen.start()` / `stop()`
- `room.media.devices.switch(...)`
- `room.media.onTrack(...)`
- `room.media.onTrackRemoved(...)`
- `room.media.onStateChange(...)`
- `room.media.onDeviceChange(...)`

:::note Transport provider availability
`room.media.transport(...)` is currently available across multiple client SDKs, but the provider mix is not identical everywhere yet.

- Web, React Native, and Flutter support `cloudflare_realtimekit` and `p2p`
- Swift iOS currently supports `cloudflare_realtimekit`
- Kotlin currently exposes the same transport API everywhere, with `cloudflare_realtimekit` wired on Android first
- Java currently exposes the same transport API, with `cloudflare_realtimekit` wired through the Android runtime package
- C#/Unity and C++/Unreal expose aligned placeholder entry points that currently return a "not available yet" error and point back to this guide

If you need the broadest cross-SDK parity today, use `cloudflare_realtimekit`.
:::

## Access Control

Media has split access gates because subscribe, publish, and control are different concerns:

- `access.media.subscribe(auth, roomId, payload)`
- `access.media.publish(auth, roomId, kind, payload)`
- `access.media.control(auth, roomId, operation, payload)`

This lets you support patterns like:

- everyone can subscribe
- only hosts can publish screen share
- moderators can control mute or unpublish operations

## Server Hooks

Media-specific hooks let you observe or transform the media control plane:

```typescript
rooms: {
  meeting: {
    hooks: {
      media: {
        beforePublish: async (kind, sender, room, ctx) => {
          // Return false to reject the publish attempt
          if (kind === 'screen' && sender.role !== 'host') return false;
          // Return undefined to allow
        },
        onPublished: async (kind, sender, room, ctx) => {
          console.log(`${sender.userId} published ${kind}`);
        },
        onUnpublished: async (kind, sender, room, ctx) => {
          console.log(`${sender.userId} stopped ${kind}`);
        },
        onMuteChange: async (kind, sender, muted, room, ctx) => {
          console.log(`${sender.userId} ${muted ? 'muted' : 'unmuted'} ${kind}`);
        },
      },
    },
  },
},
```

| Hook | Parameters | Can Reject |
|------|-----------|------------|
| `beforePublish` | `(kind, sender, room, ctx)` | Yes — return `false` |
| `onPublished` | `(kind, sender, room, ctx)` | No |
| `onUnpublished` | `(kind, sender, room, ctx)` | No |
| `onMuteChange` | `(kind, sender, muted, room, ctx)` | No |

`kind`: `'audio'` \| `'video'` \| `'screen'`. `muted`: `boolean`.

These are useful for analytics, moderation mirrors, or injecting track metadata.

## Media and Admin

`room.media` describes media state.

`room.admin` is the moderation layer that acts on people in the room, including media-related controls such as:

- `room.admin.mute(memberId)`
- `room.admin.disableVideo(memberId)`
- `room.admin.stopScreenShare(memberId)`

## Media vs Signals

- Use `media` for room-scoped A/V publishing and mute state.
- Use [Signals](/docs/room/signals) for WebRTC negotiation payloads and other transient control messages.

## Related Docs

- [Client SDK](/docs/room/client-sdk)
- [Server Hooks and Actions](/docs/room/server)
- [Access Rules](/docs/room/access-rules)
