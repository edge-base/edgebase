---
sidebar_position: 1
title: Client SDK
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Client SDK

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

In v2 all state mutations happen server-side -- clients can only **read state** and **send actions**. The server mutates state in response to actions via `handlers.actions`.

On the newer Room SDKs, the preferred public shape is a unified namespace surface with five core live capabilities:

- `room.state`
- `room.meta`
- `room.members`
- `room.signals`
- `room.media` *(beta)*

Two companion namespaces round out the client runtime:

- `room.admin`
- `room.session`

Legacy flat methods such as `room.send(...)`, `room.getSharedState()`, and `room.onMessage(...)` still exist for compatibility. Prefer the unified namespaces when your SDK supports them. See [SDK Support](/docs/room/sdk-support).

For production-oriented room media today, prefer `room.media.transport()` with
the default `cloudflare_realtimekit` provider. `p2p` is also available on the
supported SDK matrix, but it remains a best-effort path that depends more
heavily on client network conditions.

:::note Unified Namespace Availability
The unified namespace surface is available across the JavaScript/TypeScript, Dart, Swift, Kotlin, and Java Room SDKs. Method names and casing follow each platform's conventions.

Legacy flat methods still exist as compatibility fallbacks, so older examples and the mapping tables below may still show `room.send(...)`, `room.getSharedState()`, and related APIs.
:::

## Installation

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```bash
npm install @edge-base/web
# React Native:
npm install @edge-base/react-native
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```yaml
# pubspec.yaml
dependencies:
  edgebase_flutter: ^0.2.1
```

```bash
flutter pub get
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
// Package.swift
dependencies: [
    .package(url: "https://github.com/edge-base/edgebase-swift", from: "0.1.4")
]
```

Minimum: iOS 15+

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
// build.gradle.kts
repositories {
    maven("https://jitpack.io")
}

dependencies {
    implementation("com.github.edge-base.edgebase:edgebase-client:v0.1.4")
}
```

The shared Room client compiles across Android, JVM, JS, and Apple targets. Built-in Room Media runtime ships on Android, iOS, and JS browser; JVM/macOS use explicit `cloudflareRealtimeKit.clientFactory` and `p2p.transportFactory` injection.

</TabItem>
<TabItem value="java" label="Java">

```groovy
// build.gradle
repositories {
    maven { url 'https://jitpack.io' }
}

dependencies {
    implementation 'com.github.edge-base.edgebase:edgebase-android-java:v0.1.4'
}
```

</TabItem>
<TabItem value="csharp" label="C#/Unity">

**Unity:** Copy `packages/sdk/csharp/src/` into `Assets/Plugins/EdgeBase/`, or build a `.dll` and add it under `Assets/Plugins/`.

**.NET:** NuGet or project reference:

```bash
dotnet add package dev.edgebase.unity
```

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

```cmake
FetchContent_Declare(
  edgebase
  GIT_REPOSITORY https://github.com/edge-base/edgebase-cpp.git
  GIT_TAG v0.1.4
)
FetchContent_MakeAvailable(edgebase)
target_link_libraries(your_target edgebase)
```

Requires: `nlohmann/json` header library.

</TabItem>
</Tabs>

---

## Connect

Rooms are identified by a **namespace** and a **room ID**. Ensure the user is authenticated before connecting.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
import { createClient } from '@edge-base/web';
// React Native: import { createClient } from '@edge-base/react-native';

const client = createClient('https://your-project.edgebase.fun');
// ... authenticate first ...

const room = client.room('game', 'lobby-1');
await room.join();
```

To leave:

```typescript
room.leave();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
import 'package:edgebase_flutter/edgebase_flutter.dart';

final client = ClientEdgeBase('https://your-project.edgebase.fun');
// ... authenticate first ...

final room = client.room('game', 'lobby-1');
await room.join();
```

To leave:

```dart
room.leave();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
import EdgeBase

let client = EdgeBaseClient("https://your-project.edgebase.fun")
// ... authenticate first ...

let room = client.room(namespace: "game", id: "lobby-1")
try await room.join()
```

To leave:

```swift
room.leave()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
import dev.edgebase.sdk.client.ClientEdgeBase

val client = ClientEdgeBase(url = "https://your-project.edgebase.fun")
// ... authenticate first ...

val room = client.room("game", "lobby-1")
room.join() // suspend function
```

To leave:

```kotlin
room.leave()
```

</TabItem>
<TabItem value="java" label="Java">

```java
import dev.edgebase.sdk.client.*;

ClientEdgeBase client = EdgeBase.client("https://your-project.edgebase.fun");
// ... authenticate first ...

RoomClient room = client.room("game", "lobby-1");
room.join().get(); // blocks until joined (or use .thenAccept() for async)
```

To leave:

```java
room.leave();
```

</TabItem>
<TabItem value="csharp" label="C#/Unity">

```csharp
using EdgeBase;

var client = new EdgeBase("https://your-project.edgebase.fun");
// ... authenticate first ...

var room = client.Room("game", "lobby-1");
await room.Join();
```

To leave:

```csharp
room.Leave();
```

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

The C++ client requires injecting your own WebSocket transport before connecting:

```cpp
#include "edgebase/room_client.h"
using json = nlohmann::json;

auto room = client.room("game", "lobby-1");

// Inject WebSocket functions (example with your WS library)
room->set_connect_fn([](const std::string& url,
                        std::function<void(const std::string&)> on_message,
                        std::function<void()> on_close) {
    // Connect to url, call on_message for incoming data, on_close on disconnect
});

room->set_send_fn([](const std::string& message) {
    // Send message over WebSocket
});

room->set_close_fn([]() {
    // Close WebSocket connection
});

room->join();
```

To leave:

```cpp
room->leave();
```

</TabItem>
</Tabs>

---

## Unified Surface

The unified Room surface groups the product around the same live-session model used in the newer SDK implementations.

| Namespace | Purpose |
| --- | --- |
| `room.state` | Authoritative commands plus shared / private state reads and subscriptions |
| `room.meta` | Public-safe metadata before or after joining |
| `room.members` | Presence list, member join/leave events, and ephemeral member state |
| `room.signals` | Fire-and-forget room events and direct member sends |
| `room.media` *(beta)* | Audio/video/screen publish, mute, device, and track state |
| `room.admin` | Moderation controls like kick, mute, disable video, and role changes |
| `room.session` | Errors, reconnects, kicked events, and connection state |

```typescript
const room = client.room('game', 'lobby-1');
await room.join();

const meta = await room.meta.get();

room.state.onSharedChange((state) => renderBoard(state));
room.members.onSync((members) => renderRoster(members));
room.signals.on('chat.message', (payload) => appendChat(payload));
room.media.onTrack((track, member) => attachTrack(track, member));
room.session.onConnectionStateChange((state) => console.log('room state:', state));

await room.state.send('MOVE', { to: { x: 5, y: 3 } });
await room.signals.send('chat.message', { text: 'hello' });
```

The rest of this page keeps the flat compatibility methods documented because they are still useful as cross-SDK fallbacks and map cleanly to the unified namespaces.

:::note Room Media transport status
`room.media.transport(...)` is active on the Web, React Native, Flutter, Swift iOS, Java Android, Kotlin Android, Kotlin iOS, Kotlin JS, Kotlin JVM/macOS, and the Java core artifact.

The provider mix is still rolling out:

- Web, React Native, and Flutter support `cloudflare_realtimekit` and `p2p`
- Swift iOS and Java Android ship built-in `cloudflare_realtimekit` and `p2p`
- Kotlin ships built-in `cloudflare_realtimekit` and `p2p` on Android, iOS, and JS (browser)
- Kotlin JVM/macOS use `cloudflareRealtimeKit.clientFactory` and `p2p.transportFactory`
- Java core uses `cloudflareRealtimeKit.clientFactory` and `p2p.transportFactory`

Verification is still deepest on the web live-media path. Mobile SDKs now have build and transport smoke coverage, but native live media E2E is not yet identical across every platform.
:::

| Preferred namespace API | Compatibility API |
| --- | --- |
| `room.state.getShared()` | `room.getSharedState()` |
| `room.state.getMine()` | `room.getPlayerState()` |
| `room.state.onSharedChange(...)` | `room.onSharedState(...)` |
| `room.state.onMineChange(...)` | `room.onPlayerState(...)` |
| `room.state.send(...)` | `room.send(...)` |
| `room.meta.get()` | `room.getMetadata()` |
| `room.signals.on(...)` / `room.signals.onAny(...)` | `room.onMessage(...)` / `room.onAnyMessage(...)` |
| `room.session.onError(...)` / `room.session.onKicked(...)` | `room.onError(...)` / `room.onKicked(...)` |

---

## Read State

v2 has two separate state areas:

- **Shared state** -- visible to all players in the room.
- **Player state** -- private to each individual player.

Both are read-only on the client.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const shared = room.state.getShared();
const player = room.state.getMine();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final shared = room.getSharedState();
final player = room.getPlayerState();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let shared = room.getSharedState()
let player = room.getPlayerState()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val shared = room.getSharedState()
val player = room.getPlayerState()
```

</TabItem>
<TabItem value="java" label="Java">

```java
Map<String, Object> shared = room.getSharedState();
Map<String, Object> player = room.getPlayerState();
```

</TabItem>
<TabItem value="csharp" label="C#/Unity">

```csharp
var shared = room.GetSharedState();
var player = room.GetPlayerState();
```

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

```cpp
json shared = room->get_shared_state();
json player = room->get_player_state();
```

</TabItem>
</Tabs>

---

## Subscribe to State Changes

### Shared State

Called on initial sync and whenever the shared state changes. The handler receives the full state and only the changed fields (delta).

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const sub = room.state.onSharedChange((state, changes) => {
  console.log('Shared state:', state);
  console.log('Changes:', changes);
  renderGame(state);
});

// Later: stop listening
sub.unsubscribe();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final sub = room.onSharedState.listen((event) {
  final state = event.state;
  final changes = event.changes;
  print('Shared state: $state');
  setState(() => gameState = state);
});

// Later: stop listening
sub.cancel();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let sub = room.onSharedState { state, changes in
    print("Shared state: \(state)")
    print("Changes: \(changes)")
    self.updateUI(state)
}

// Later: stop listening
sub.unsubscribe()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val sub = room.onSharedState { state, changes ->
    println("Shared state: $state")
    println("Changes: $changes")
    updateUI(state)
}

// Later: stop listening
sub.unsubscribe()
```

</TabItem>
<TabItem value="java" label="Java">

```java
Subscription sub = room.onSharedState((state, changes) -> {
    System.out.println("Shared state: " + state);
    System.out.println("Changes: " + changes);
    updateUI(state);
});

// Later: stop listening
sub.unsubscribe();
```

</TabItem>
<TabItem value="csharp" label="C#/Unity">

```csharp
var sub = room.OnSharedState((state, changes) =>
{
    Debug.Log($"Shared state: {state}");
    Debug.Log($"Changes: {changes}");
    UpdateUI(state);
});

// Later: stop listening
sub.Dispose();
```

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

```cpp
auto sub = room->on_shared_state([](const json& state, const json& changes) {
    std::cout << "Shared state: " << state.dump() << std::endl;
    std::cout << "Changes: " << changes.dump() << std::endl;
});

// Later: stop listening
sub.unsubscribe();
```

</TabItem>
</Tabs>

### Player State

Called on initial sync and whenever the player's own state changes.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const sub = room.state.onMineChange((state, changes) => {
  console.log('Player state:', state);
  updateInventory(state);
});

sub.unsubscribe();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final sub = room.onPlayerState.listen((event) {
  final state = event.state;
  final changes = event.changes;
  print('Player state: $state');
  updateInventory(state);
});

sub.cancel();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let sub = room.onPlayerState { state, changes in
    print("Player state: \(state)")
    updateInventory(state)
}

sub.unsubscribe()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val sub = room.onPlayerState { state, changes ->
    println("Player state: $state")
    updateInventory(state)
}

sub.unsubscribe()
```

</TabItem>
<TabItem value="java" label="Java">

```java
Subscription sub = room.onPlayerState((state, changes) -> {
    System.out.println("Player state: " + state);
    updateInventory(state);
});

sub.unsubscribe();
```

</TabItem>
<TabItem value="csharp" label="C#/Unity">

```csharp
var sub = room.OnPlayerState((state, changes) =>
{
    Debug.Log($"Player state: {state}");
    UpdateInventory(state);
});

sub.Dispose();
```

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

```cpp
auto sub = room->on_player_state([](const json& state, const json& changes) {
    std::cout << "Player state: " << state.dump() << std::endl;
});

sub.unsubscribe();
```

</TabItem>
</Tabs>

---

## Send Actions

Actions are sent to the server's `handlers.actions` entries and return the server's result.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const result = await room.state.send('MOVE', { to: { x: 5, y: 3 } });
console.log('Move result:', result);
```

If the action fails server-side, the Promise rejects:

```typescript
try {
  await room.state.send('ATTACK', { target: 'player-2' });
} catch (err) {
  console.error('Action failed:', err.message);
}
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await room.send('MOVE', {'to': {'x': 5, 'y': 3}});
print('Move result: $result');
```

If the action fails server-side, the Future throws:

```dart
try {
  await room.send('ATTACK', {'target': 'player-2'});
} catch (e) {
  print('Action failed: $e');
}
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let result = try await room.send("MOVE", payload: ["to": ["x": 5, "y": 3]])
print("Move result: \(result)")
```

If the action fails server-side, it throws:

```swift
do {
    try await room.send("ATTACK", payload: ["target": "player-2"])
} catch {
    print("Action failed: \(error)")
}
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = room.send("MOVE", mapOf("to" to mapOf("x" to 5, "y" to 3)))
println("Move result: $result")
```

If the action fails server-side, the suspend function throws:

```kotlin
try {
    room.send("ATTACK", mapOf("target" to "player-2"))
} catch (e: EdgeBaseException) {
    println("Action failed: ${e.message}")
}
```

</TabItem>
<TabItem value="java" label="Java">

```java
CompletableFuture<Object> future = room.send("MOVE", Map.of("to", Map.of("x", 5, "y", 3)));
Object result = future.get(); // blocks for result
System.out.println("Move result: " + result);
```

Async style:

```java
room.send("MOVE", Map.of("to", Map.of("x", 5, "y", 3)))
    .thenAccept(result -> System.out.println("Move result: " + result))
    .exceptionally(err -> {
        System.err.println("Action failed: " + err.getMessage());
        return null;
    });
```

</TabItem>
<TabItem value="csharp" label="C#/Unity">

```csharp
var result = await room.Send("MOVE", new { to = new { x = 5, y = 3 } });
Debug.Log($"Move result: {result}");
```

If the action fails server-side, the Task throws:

```csharp
try
{
    await room.Send("ATTACK", new { target = "player-2" });
}
catch (EdgeBaseException ex)
{
    Debug.LogError($"Action failed: {ex.Message}");
}
```

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

```cpp
room->send("MOVE", {{"to", {{"x", 5}, {"y", 3}}}},
    [](const json& result) {
        std::cout << "Move result: " << result.dump() << std::endl;
    },
    [](const std::string& error) {
        std::cerr << "Action failed: " << error << std::endl;
    }
);
```

</TabItem>
</Tabs>

---

## Signals and Legacy Messages

On unified clients, prefer `room.signals.on(...)`, `room.signals.onAny(...)`, `room.signals.send(...)`, and `room.signals.sendTo(...)`.

The flat `room.onMessage(...)` and `room.onAnyMessage(...)` APIs below remain documented as compatibility wrappers for server-sent messages from `room.sendMessage()` or `room.sendMessageTo()` in server-side code.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// Listen for a specific signal event
const sub = room.signals.on('game_over', (data) => {
  console.log('Winner:', data.winner);
});

sub.unsubscribe();
```

Listen for all messages regardless of type:

```typescript
const sub = room.signals.onAny((event, data) => {
  console.log(`Signal [${event}]:`, data);
});

sub.unsubscribe();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final sub = room.onMessage('game_over').listen((data) {
  print('Winner: ${data['winner']}');
});

sub.cancel();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let sub = room.onMessage("game_over") { data in
    if let winner = (data as? [String: Any])?["winner"] as? String {
        print("Winner: \(winner)")
    }
}

sub.unsubscribe()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val sub = room.onMessage("game_over") { data ->
    val winner = (data as? Map<*, *>)?.get("winner") as? String
    println("Winner: $winner")
}

sub.unsubscribe()
```

</TabItem>
<TabItem value="java" label="Java">

```java
Subscription sub = room.onMessage("game_over", data -> {
    Map<String, Object> map = (Map<String, Object>) data;
    System.out.println("Winner: " + map.get("winner"));
});

sub.unsubscribe();
```

</TabItem>
<TabItem value="csharp" label="C#/Unity">

```csharp
var sub = room.OnMessage("game_over", (data) =>
{
    var dict = data as Dictionary<string, object>;
    Debug.Log($"Winner: {dict?["winner"]}");
});

sub.Dispose();
```

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

```cpp
auto sub = room->on_message("game_over", [](const json& data) {
    std::string winner = data.value("winner", "");
    std::cout << "Winner: " << winner << std::endl;
});

sub.unsubscribe();
```

</TabItem>
</Tabs>

-> Server-side message sending: [Server Guide](server.md)

---

## Kicked

The server can kick a player. After being kicked, auto-reconnect is disabled. On the unified surface, this lives under `room.session.onKicked(...)`.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
room.session.onKicked(() => {
  console.log('You were kicked from the room');
  showKickedUI();
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
room.onKicked.listen((_) {
  print('You were kicked from the room');
  showKickedUI();
});
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
room.onKicked {
    print("You were kicked from the room")
    showKickedUI()
}
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
room.onKicked {
    println("You were kicked from the room")
    showKickedUI()
}
```

</TabItem>
<TabItem value="java" label="Java">

```java
room.onKicked(() -> {
    System.out.println("You were kicked from the room");
    showKickedUI();
});
```

</TabItem>
<TabItem value="csharp" label="C#/Unity">

```csharp
room.OnKicked(() =>
{
    Debug.Log("You were kicked from the room");
    ShowKickedUI();
});
```

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

```cpp
room->on_kicked([]() {
    std::cout << "You were kicked from the room" << std::endl;
    show_kicked_ui();
});
```

</TabItem>
</Tabs>

-> Server-side kick setup: [Server Guide](server.md)

---

## Error Handling

On the unified surface, error handling lives under `room.session.onError(...)`.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
room.session.onError((err) => {
  console.error(`Room error [${err.code}]: ${err.message}`);
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
room.onError.listen((err) {
  print('Room error [${err.code}]: ${err.message}');
});
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
room.onError { err in
    print("Room error [\(err.code)]: \(err.message)")
}
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
room.onError { err ->
    println("Room error [${err.code}]: ${err.message}")
}
```

</TabItem>
<TabItem value="java" label="Java">

```java
room.onError(err -> {
    System.err.println("Room error [" + err.getCode() + "]: " + err.getMessage());
});
```

</TabItem>
<TabItem value="csharp" label="C#/Unity">

```csharp
room.OnError((err) =>
{
    Debug.LogError($"Room error [{err.Code}]: {err.Message}");
});
```

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

```cpp
room->on_error([](const std::string& code, const std::string& message) {
    std::cerr << "Room error [" << code << "]: " << message << std::endl;
});
```

</TabItem>
</Tabs>

---

## Auto-Reconnect

Built-in with exponential backoff. If the WebSocket drops, the SDK automatically reconnects, re-authenticates, and replays the latest room state. On the unified surface, `room.session.onReconnect(...)` and `room.session.onConnectionStateChange(...)` are the primary lifecycle hooks.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

Configure via options:

```typescript
const room = client.room('game', 'lobby-1', {
  autoReconnect: true,           // default: true
  maxReconnectAttempts: 10,      // default: 10
  reconnectBaseDelay: 1000,      // default: 1000ms
  sendTimeout: 10000,            // default: 10000ms
});
```

React Native: Works transparently across app foreground/background transitions.

```typescript
room.session.onReconnect(({ attempt }) => {
  console.log('reconnecting attempt', attempt);
});

room.session.onConnectionStateChange((state) => {
  console.log('connection state', state);
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

Automatic. No configuration needed.

</TabItem>
<TabItem value="swift" label="Swift">

Uses `URLSessionWebSocketTask`. No configuration needed.

</TabItem>
<TabItem value="kotlin" label="Kotlin">

Uses Ktor WebSocket client. No configuration needed.

</TabItem>
<TabItem value="java" label="Java">

Uses `ScheduledExecutorService`. No configuration needed.

</TabItem>
<TabItem value="csharp" label="C#/Unity">

Automatic. No configuration needed.

:::note Unity WebGL
On WebGL, the SDK uses a JavaScript interop bridge (`jslib`) for WebSocket since `System.Net.WebSockets.ClientWebSocket` is not available. The API is identical.
:::

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

Uses an internal `std::thread`. No configuration needed.

</TabItem>
</Tabs>

---

## Unified Surface Reference

The unified Room namespaces are currently implemented in the SDKs listed on [SDK Support](/docs/room/sdk-support). Use this as the primary mental model when building new Room features.

| Namespace | Representative APIs |
| --- | --- |
| `room.state` | `getShared()`, `getMine()`, `onSharedChange()`, `onMineChange()`, `send()` |
| `room.meta` | `get()` |
| `room.members` | `list()`, `onSync()`, `onJoin()`, `onLeave()`, `setState()`, `clearState()`, `onStateChange()` |
| `room.signals` | `send()`, `sendTo()`, `on()`, `onAny()` |
| `room.media` *(beta)* | `list()`, `audio.enable()`, `audio.setMuted()`, `video.enable()`, `screen.start()`, `devices.switch()`, `onTrack()` |
| `room.admin` | `kick()`, `mute()`, `block()`, `setRole()`, `disableVideo()`, `stopScreenShare()` |
| `room.session` | `onError()`, `onKicked()`, `onReconnect()`, `onConnectionStateChange()` |

## Compatibility API Reference

The tabbed tables below keep the flat compatibility methods that are still widely available across SDKs and older examples.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

| Method / Property | Type | Description |
|---|---|---|
| `client.room(namespace, roomId, options?)` | `RoomClient` | Create a room client |
| `room.join()` | `Promise<void>` | Connect, authenticate, and join |
| `room.leave()` | `void` | Disconnect and clean up |
| `room.getSharedState()` | `Record<string, unknown>` | Get current shared state snapshot |
| `room.getPlayerState()` | `Record<string, unknown>` | Get current player state snapshot |
| `room.send(actionType, payload?)` | `Promise<unknown>` | Send action to server, returns result |
| `room.onSharedState(handler)` | `Subscription` | Shared state changes -- returns `{ unsubscribe() }` |
| `room.onPlayerState(handler)` | `Subscription` | Player state changes -- returns `{ unsubscribe() }` |
| `room.onMessage(type, handler)` | `Subscription` | Server message by type -- returns `{ unsubscribe() }` |
| `room.onAnyMessage(handler)` | `Subscription` | All server messages -- returns `{ unsubscribe() }` |
| `room.onError(handler)` | `Subscription` | Error occurred -- returns `{ unsubscribe() }` |
| `room.onKicked(handler)` | `Subscription` | Kicked from room -- returns `{ unsubscribe() }` |
| `room.namespace` | `string` | Room namespace |
| `room.roomId` | `string` | Room instance ID |

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

| Method / Property | Type | Description |
|---|---|---|
| `client.room(namespace, roomId)` | `RoomClient` | Create a room client |
| `room.join()` | `Future<void>` | Connect, authenticate, and join |
| `room.leave()` | `void` | Disconnect and clean up |
| `room.getSharedState()` | `Map<String, dynamic>` | Get current shared state snapshot |
| `room.getPlayerState()` | `Map<String, dynamic>` | Get current player state snapshot |
| `room.send(actionType, [payload])` | `Future<dynamic>` | Send action to server, returns result |
| `room.onSharedState` | `Stream<StateEvent>` | Shared state changes |
| `room.onPlayerState` | `Stream<StateEvent>` | Player state changes |
| `room.onMessage(type)` | `Stream<dynamic>` | Server message by type |
| `room.onError` | `Stream<RoomError>` | Error occurred |
| `room.onKicked` | `Stream<void>` | Kicked from room |
| `room.namespace` | `String` | Room namespace |
| `room.roomId` | `String` | Room instance ID |

</TabItem>
<TabItem value="swift" label="Swift">

| Method / Property | Type | Description |
|---|---|---|
| `client.room(namespace, roomId)` | `RoomClient` | Create a room client |
| `room.join()` | `async throws` | Connect, authenticate, and join |
| `room.leave()` | `void` | Disconnect and clean up |
| `room.getSharedState()` | `[String: Any]` | Get current shared state snapshot |
| `room.getPlayerState()` | `[String: Any]` | Get current player state snapshot |
| `room.send(_:payload:)` | `async throws -> Any` | Send action to server, returns result |
| `room.onSharedState(_:)` | `Subscription` | Shared state changes |
| `room.onPlayerState(_:)` | `Subscription` | Player state changes |
| `room.onMessage(_:handler:)` | `Subscription` | Server message by type |
| `room.onError(_:)` | `Subscription` | Error occurred |
| `room.onKicked(_:)` | `Subscription` | Kicked from room |
| `room.namespace` | `String` | Room namespace |
| `room.roomId` | `String` | Room instance ID |

</TabItem>
<TabItem value="kotlin" label="Kotlin">

| Method / Property | Type | Description |
|---|---|---|
| `client.room(namespace, roomId)` | `RoomClient` | Create a room client |
| `room.join()` | `suspend` | Connect, authenticate, and join |
| `room.leave()` | `Unit` | Disconnect and clean up |
| `room.getSharedState()` | `Map<String, Any?>` | Get current shared state snapshot |
| `room.getPlayerState()` | `Map<String, Any?>` | Get current player state snapshot |
| `room.send(actionType, payload?)` | `suspend -> Any?` | Send action to server, returns result |
| `room.onSharedState(handler)` | `Subscription` | Shared state changes |
| `room.onPlayerState(handler)` | `Subscription` | Player state changes |
| `room.onMessage(type, handler)` | `Subscription` | Server message by type |
| `room.onError(handler)` | `Subscription` | Error occurred |
| `room.onKicked(handler)` | `Subscription` | Kicked from room |
| `room.namespace` | `String` | Room namespace |
| `room.roomId` | `String` | Room instance ID |

</TabItem>
<TabItem value="java" label="Java">

| Method / Property | Type | Description |
|---|---|---|
| `client.room(namespace, roomId)` | `RoomClient` | Create a room client |
| `room.join()` | `CompletableFuture<Void>` | Connect, authenticate, and join |
| `room.leave()` | `void` | Disconnect and clean up |
| `room.getSharedState()` | `Map<String, Object>` | Get current shared state snapshot |
| `room.getPlayerState()` | `Map<String, Object>` | Get current player state snapshot |
| `room.send(actionType, payload)` | `CompletableFuture<Object>` | Send action to server, returns result |
| `room.onSharedState(handler)` | `Subscription` | Shared state changes |
| `room.onPlayerState(handler)` | `Subscription` | Player state changes |
| `room.onMessage(type, handler)` | `Subscription` | Server message by type |
| `room.onError(handler)` | `Subscription` | Error occurred |
| `room.onKicked(handler)` | `Subscription` | Kicked from room |
| `room.getNamespace()` | `String` | Room namespace |
| `room.getRoomId()` | `String` | Room instance ID |

</TabItem>
<TabItem value="csharp" label="C#/Unity">

| Method / Property | Type | Description |
|---|---|---|
| `client.Room(namespace, roomId)` | `RoomClient` | Create a room client |
| `room.Join()` | `Task` | Connect, authenticate, and join |
| `room.Leave()` | `void` | Disconnect and clean up |
| `room.GetSharedState()` | `Dictionary<string, object?>` | Get current shared state snapshot |
| `room.GetPlayerState()` | `Dictionary<string, object?>` | Get current player state snapshot |
| `room.Send(actionType, payload?)` | `Task<object>` | Send action to server, returns result |
| `room.OnSharedState(handler)` | `IDisposable` | Shared state changes |
| `room.OnPlayerState(handler)` | `IDisposable` | Player state changes |
| `room.OnMessage(type, handler)` | `IDisposable` | Server message by type |
| `room.OnError(handler)` | `IDisposable` | Error occurred |
| `room.OnKicked(handler)` | `IDisposable` | Kicked from room |
| `room.Namespace` | `string` | Room namespace |
| `room.RoomId` | `string` | Room instance ID |

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

| Method / Property | Type | Description |
|---|---|---|
| `client.room(namespace, room_id)` | `shared_ptr<RoomClient>` | Create a room client |
| `room->join()` | `void` | Connect, authenticate, and join |
| `room->leave()` | `void` | Disconnect and clean up |
| `room->get_shared_state()` | `json` | Get current shared state snapshot |
| `room->get_player_state()` | `json` | Get current player state snapshot |
| `room->send(type, payload, on_result, on_error)` | `void` | Send action to server (callback-based) |
| `room->on_shared_state(handler)` | `Subscription` | Shared state changes |
| `room->on_player_state(handler)` | `Subscription` | Player state changes |
| `room->on_message(type, handler)` | `Subscription` | Server message by type |
| `room->on_error(handler)` | `Subscription` | Error occurred |
| `room->on_kicked(handler)` | `Subscription` | Kicked from room |
| `room->namespace_id` | `std::string` | Room namespace |
| `room->room_id` | `std::string` | Room instance ID |
| `room->set_connect_fn(fn)` | `void` | Inject WebSocket connect |
| `room->set_send_fn(fn)` | `void` | Inject WebSocket send |
| `room->set_close_fn(fn)` | `void` | Inject WebSocket close |

</TabItem>
</Tabs>
