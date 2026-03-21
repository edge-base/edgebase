---
sidebar_position: 8
title: Advanced Patterns
description: Practical patterns for multiplayer games, collaborative editing, presence indicators, and room lifecycle.
sidebar_label: Advanced Patterns
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Advanced Patterns

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

This guide covers real-world patterns built on top of Room's core capabilities: [State](/docs/room/state), [Members](/docs/room/members), and [Signals](/docs/room/signals). Each pattern shows both server-side configuration and client-side usage.

---

## Multiplayer Game State

Games typically split data between shared state (the board, scores, turn order) and player state (each player's hand, HP, inventory). The server is the sole authority on both.

### Server Configuration

```typescript
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  rooms: {
    'game': {
      maxPlayers: 8,
      reconnectTimeout: 15000,
      rateLimit: { actions: 20 },
      handlers: {
        lifecycle: {
          onCreate(room) {
            room.setSharedState(() => ({
              phase: 'lobby',
              turn: null,
              board: Array(9).fill(null),
              players: [],
            }));
            room.setServerState(() => ({
              turnOrder: [],
              moveHistory: [],
            }));
          },

          onJoin(sender, room) {
            const shared = room.getSharedState();
            if (shared.phase !== 'lobby') {
              throw new Error('Game already in progress');
            }
            room.setSharedState(s => ({
              ...s,
              players: [...(s.players as any[]), {
                id: sender.userId,
                score: 0,
                connected: true,
              }],
            }));
            room.setPlayerState(sender.userId, () => ({
              hand: [],
              hp: 100,
              inventory: [],
            }));
          },

          onLeave(sender, room, _ctx, reason) {
            if (reason === 'disconnect') {
              // Mark as disconnected but keep in game during reconnect window
              room.setSharedState(s => ({
                ...s,
                players: (s.players as any[]).map(p =>
                  p.id === sender.userId ? { ...p, connected: false } : p
                ),
              }));
            } else {
              // Full removal on explicit leave or kick
              room.setSharedState(s => ({
                ...s,
                players: (s.players as any[]).filter(p => p.id !== sender.userId),
              }));
            }
          },
        },

        actions: {
          START_GAME: (_payload, room) => {
            const players = room.getSharedState().players as any[];
            if (players.length < 2) throw new Error('Need at least 2 players');

            const turnOrder = players.map(p => p.id);
            room.setServerState(s => ({ ...s, turnOrder }));
            room.setSharedState(s => ({
              ...s,
              phase: 'playing',
              turn: turnOrder[0],
            }));
            room.setTimer('turnTimeout', 30000);
          },

          PLACE_PIECE: (payload, room, sender) => {
            const shared = room.getSharedState();
            if (shared.turn !== sender.userId) throw new Error('Not your turn');
            if ((shared.board as any[])[payload.index] !== null) {
              throw new Error('Cell occupied');
            }

            const board = [...(shared.board as any[])];
            board[payload.index] = sender.userId;

            // Advance turn
            const server = room.getServerState();
            const order = server.turnOrder as string[];
            const nextIdx = (order.indexOf(sender.userId) + 1) % order.length;

            room.setSharedState(s => ({
              ...s,
              board,
              turn: order[nextIdx],
            }));

            room.clearTimer('turnTimeout');
            room.setTimer('turnTimeout', 30000);

            return { placed: payload.index };
          },
        },

        timers: {
          turnTimeout(room) {
            // Auto-skip turn when player takes too long
            const shared = room.getSharedState();
            const server = room.getServerState();
            const order = server.turnOrder as string[];
            const currentIdx = order.indexOf(shared.turn as string);
            const nextIdx = (currentIdx + 1) % order.length;

            room.setSharedState(s => ({ ...s, turn: order[nextIdx] }));
            room.sendMessage('turn_skipped', { userId: shared.turn });
            room.setTimer('turnTimeout', 30000);
          },
        },
      },
    },
  },
});
```

### Client Usage

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const room = client.room('game', 'lobby-42');
await room.join();

// Render the board whenever shared state changes
room.state.onSharedChange((state) => {
  renderBoard(state.board);
  highlightCurrentTurn(state.turn);
  updatePlayerList(state.players);
});

// Render private data (hand, HP) from player state
room.state.onMineChange((state) => {
  renderHand(state.hand);
  renderHP(state.hp);
});

// Handle turn skips
room.signals.on('turn_skipped', (data) => {
  showToast(`${data.userId}'s turn was skipped`);
});

// Place a piece
await room.state.send('PLACE_PIECE', { index: 4 });
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final room = client.room('game', 'lobby-42');
await room.join();

room.state.onSharedChange((state, delta) {
  renderBoard(state['board']);
  highlightCurrentTurn(state['turn']);
  updatePlayerList(state['players']);
});

room.state.onMineChange((state, delta) {
  renderHand(state['hand']);
  renderHP(state['hp']);
});

room.signals.on('turn_skipped', (payload, meta) {
  showToast("${payload['userId']}'s turn was skipped");
});

await room.state.send('PLACE_PIECE', {'index': 4});
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let room = client.room(namespace: "game", id: "lobby-42")
try await room.join()

room.state.onSharedChange { state, _ in
    renderBoard(state["board"])
    highlightCurrentTurn(state["turn"])
    updatePlayerList(state["players"])
}

room.state.onMineChange { state, _ in
    renderHand(state["hand"])
    renderHP(state["hp"])
}

room.signals.on("turn_skipped") { payload, _ in
    if let data = payload as? [String: Any], let userId = data["userId"] {
        showToast("\(userId)'s turn was skipped")
    }
}

try await room.state.send("PLACE_PIECE", payload: ["index": 4])
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val room = client.room("game", "lobby-42")
room.join()

room.state.onSharedChange { state, _ ->
    renderBoard(state["board"])
    highlightCurrentTurn(state["turn"])
    updatePlayerList(state["players"])
}

room.state.onMineChange { state, _ ->
    renderHand(state["hand"])
    renderHP(state["hp"])
}

room.signals.on("turn_skipped") { payload, _ ->
    val userId = (payload as? Map<*, *>)?.get("userId")
    showToast("$userId's turn was skipped")
}

room.state.send("PLACE_PIECE", mapOf("index" to 4))
```

</TabItem>
<TabItem value="java" label="Java">

```java
RoomClient room = client.room("game", "lobby-42");
room.join().join();

room.state.onSharedChange((state, delta) -> {
    renderBoard(state.get("board"));
    highlightCurrentTurn(state.get("turn"));
    updatePlayerList(state.get("players"));
});

room.state.onMineChange((state, delta) -> {
    renderHand(state.get("hand"));
    renderHP(state.get("hp"));
});

room.signals.on("turn_skipped", (payload, meta) -> {
    Map<String, Object> data = (Map<String, Object>) payload;
    showToast(data.get("userId") + "'s turn was skipped");
});

room.state.send("PLACE_PIECE", Map.of("index", 4)).join();
```

</TabItem>
<TabItem value="csharp" label="C#/Unity">

```csharp
var room = client.Room("game", "lobby-42");
await room.Join();

room.State.OnSharedChange((state, delta) =>
{
    RenderBoard(state["board"]);
    HighlightCurrentTurn(state["turn"]);
    UpdatePlayerList(state["players"]);
});

room.State.OnMineChange((state, delta) =>
{
    RenderHand(state["hand"]);
    RenderHP(state["hp"]);
});

room.Signals.On("turn_skipped", (payload, meta) =>
{
    var data = (Dictionary<string, object?>)payload!;
    ShowToast($"{data["userId"]}'s turn was skipped");
});

await room.State.Send("PLACE_PIECE", new Dictionary<string, object?> { ["index"] = 4 });
```

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

```cpp
auto room = client.room("game", "lobby-42");
room->join();

room->state.on_shared_change([](const json& state, const json&) {
    render_board(state["board"]);
    highlight_current_turn(state["turn"]);
    update_player_list(state["players"]);
});

room->state.on_mine_change([](const json& state, const json&) {
    render_hand(state["hand"]);
    render_hp(state["hp"]);
});

room->signals.on("turn_skipped", [](const json& payload, const json&) {
    show_toast(payload.value("userId", "") + std::string("'s turn was skipped"));
});

room->state.send("PLACE_PIECE", {{"index", 4}}, [](const json&) {}, [](const std::string&) {});
```

</TabItem>
</Tabs>

### Key Takeaways

- **Shared state** holds the board, scores, and public player info visible to everyone.
- **Player state** holds per-player secrets (hand, inventory) that only the owning player can see.
- **Server state** holds internal data like turn order and move history that clients never see.
- **Timers** handle turn timeouts without client involvement.

---

## Collaborative Editing

Collaborative editing uses a combination of authoritative state for the document and signals for ephemeral cursor/selection data. The server validates and merges edits, preventing conflicts.

### Last-Write-Wins with Sections

A practical approach for structured documents is to lock edits at the section level. Only one user can edit a section at a time.

```typescript
rooms: {
  'document': {
    maxPlayers: 50,
    handlers: {
      lifecycle: {
        onCreate(room) {
          room.setSharedState(() => ({
            sections: {},
            sectionOrder: [],
            locks: {},   // { sectionId: userId }
          }));
        },
      },

      actions: {
        LOCK_SECTION: (payload, room, sender) => {
          const locks = room.getSharedState().locks as Record<string, string>;
          if (locks[payload.sectionId] && locks[payload.sectionId] !== sender.userId) {
            throw new Error('Section is locked by another user');
          }
          room.setSharedState(s => ({
            ...s,
            locks: { ...(s.locks as any), [payload.sectionId]: sender.userId },
          }));
          // Auto-unlock after 5 minutes of inactivity
          room.setTimer(`unlock-${payload.sectionId}`, 300000, {
            sectionId: payload.sectionId,
          });
          return { locked: true };
        },

        UPDATE_SECTION: (payload, room, sender) => {
          const locks = room.getSharedState().locks as Record<string, string>;
          if (locks[payload.sectionId] !== sender.userId) {
            throw new Error('You do not hold the lock for this section');
          }
          room.setSharedState(s => ({
            ...s,
            sections: {
              ...(s.sections as any),
              [payload.sectionId]: {
                content: payload.content,
                lastEditedBy: sender.userId,
                updatedAt: Date.now(),
              },
            },
          }));
          // Reset the auto-unlock timer
          room.setTimer(`unlock-${payload.sectionId}`, 300000, {
            sectionId: payload.sectionId,
          });
          return { updated: true };
        },

        UNLOCK_SECTION: (payload, room, sender) => {
          const locks = room.getSharedState().locks as Record<string, string>;
          if (locks[payload.sectionId] !== sender.userId) {
            throw new Error('You do not hold the lock');
          }
          const newLocks = { ...(locks as any) };
          delete newLocks[payload.sectionId];
          room.setSharedState(s => ({ ...s, locks: newLocks }));
          room.clearTimer(`unlock-${payload.sectionId}`);
        },
      },

      timers: {
        // Timer names are dynamic: 'unlock-{sectionId}'
        // Timer handler names must match exactly, so use a single handler:
      },
    },
  },
}
```

### Client Usage

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const room = client.room('document', 'doc-abc');
await room.join();

// Watch document changes
room.state.onSharedChange((state) => {
  renderDocument(state.sections, state.sectionOrder);
  renderLockIndicators(state.locks);
});

// Show collaborator cursors via member state
room.members.onSync((members) => {
  renderCollaboratorAvatars(members);
});

room.members.onStateChange((member, state) => {
  renderCursor(member.memberId, state?.cursor);
});

// Broadcast your cursor position as ephemeral member state
document.addEventListener('mousemove', debounce((e) => {
  room.members.setState({ cursor: { x: e.clientX, y: e.clientY } });
}, 50));

// Edit flow
await room.state.send('LOCK_SECTION', { sectionId: 'intro' });
await room.state.send('UPDATE_SECTION', {
  sectionId: 'intro',
  content: 'Updated introduction text...',
});
await room.state.send('UNLOCK_SECTION', { sectionId: 'intro' });
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final room = client.room('document', 'doc-abc');
await room.join();

room.state.onSharedChange((state, delta) {
  renderDocument(state['sections'], state['sectionOrder']);
  renderLockIndicators(state['locks']);
});

room.members.onSync((members) {
  renderCollaboratorAvatars(members);
});

room.members.onStateChange((member, state) {
  renderCursor(member['memberId'], state['cursor']);
});

// Call this from your pointer-move handler
await room.members.setState({
  'cursor': {'x': 120, 'y': 48},
});

await room.state.send('LOCK_SECTION', {'sectionId': 'intro'});
await room.state.send('UPDATE_SECTION', {
  'sectionId': 'intro',
  'content': 'Updated introduction text...',
});
await room.state.send('UNLOCK_SECTION', {'sectionId': 'intro'});
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let room = client.room(namespace: "document", id: "doc-abc")
try await room.join()

room.state.onSharedChange { state, _ in
    renderDocument(state["sections"], state["sectionOrder"])
    renderLockIndicators(state["locks"])
}

room.members.onSync { members in
    renderCollaboratorAvatars(members)
}

room.members.onStateChange { member, state in
    renderCursor(member["memberId"], state["cursor"])
}

// Call this from your pointer-move handler
try await room.members.setState([
    "cursor": ["x": 120, "y": 48],
])

try await room.state.send("LOCK_SECTION", payload: ["sectionId": "intro"])
try await room.state.send("UPDATE_SECTION", payload: [
    "sectionId": "intro",
    "content": "Updated introduction text...",
])
try await room.state.send("UNLOCK_SECTION", payload: ["sectionId": "intro"])
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val room = client.room("document", "doc-abc")
room.join()

room.state.onSharedChange { state, _ ->
    renderDocument(state["sections"], state["sectionOrder"])
    renderLockIndicators(state["locks"])
}

room.members.onSync { members ->
    renderCollaboratorAvatars(members)
}

room.members.onStateChange { member, state ->
    renderCursor(member["memberId"], state["cursor"])
}

// Call this from your pointer-move handler
room.members.setState(
    mapOf("cursor" to mapOf("x" to 120, "y" to 48)),
)

room.state.send("LOCK_SECTION", mapOf("sectionId" to "intro"))
room.state.send(
    "UPDATE_SECTION",
    mapOf(
        "sectionId" to "intro",
        "content" to "Updated introduction text...",
    ),
)
room.state.send("UNLOCK_SECTION", mapOf("sectionId" to "intro"))
```

</TabItem>
<TabItem value="java" label="Java">

```java
RoomClient room = client.room("document", "doc-abc");
room.join().join();

room.state.onSharedChange((state, delta) -> {
    renderDocument(state.get("sections"), state.get("sectionOrder"));
    renderLockIndicators(state.get("locks"));
});

room.members.onSync(members -> {
    renderCollaboratorAvatars(members);
});

room.members.onStateChange((member, state) -> {
    renderCursor(member.get("memberId"), state.get("cursor"));
});

// Call this from your pointer-move handler
room.members.setState(Map.of("cursor", Map.of("x", 120, "y", 48))).join();

room.state.send("LOCK_SECTION", Map.of("sectionId", "intro")).join();
room.state.send(
    "UPDATE_SECTION",
    Map.of(
        "sectionId", "intro",
        "content", "Updated introduction text..."
    )
).join();
room.state.send("UNLOCK_SECTION", Map.of("sectionId", "intro")).join();
```

</TabItem>
<TabItem value="csharp" label="C#/Unity">

```csharp
var room = client.Room("document", "doc-abc");
await room.Join();

room.State.OnSharedChange((state, delta) =>
{
    RenderDocument(state["sections"], state["sectionOrder"]);
    RenderLockIndicators(state["locks"]);
});

room.Members.OnSync(members =>
{
    RenderCollaboratorAvatars(members);
});

room.Members.OnStateChange((member, state) =>
{
    RenderCursor(member["memberId"], state["cursor"]);
});

// Call this from your pointer-move handler
await room.Members.SetState(new Dictionary<string, object?>
{
    ["cursor"] = new Dictionary<string, object?> { ["x"] = 120, ["y"] = 48 },
});

await room.State.Send("LOCK_SECTION", new Dictionary<string, object?> { ["sectionId"] = "intro" });
await room.State.Send("UPDATE_SECTION", new Dictionary<string, object?>
{
    ["sectionId"] = "intro",
    ["content"] = "Updated introduction text...",
});
await room.State.Send("UNLOCK_SECTION", new Dictionary<string, object?> { ["sectionId"] = "intro" });
```

</TabItem>
<TabItem value="cpp" label="C++/Unreal">

```cpp
auto room = client.room("document", "doc-abc");
room->join();

room->state.on_shared_change([](const json& state, const json&) {
    render_document(state["sections"], state["sectionOrder"]);
    render_lock_indicators(state["locks"]);
});

room->members.on_sync([](const json& members) {
    render_collaborator_avatars(members);
});

room->members.on_state_change([](const json& member, const json& state) {
    render_cursor(member["memberId"], state["cursor"]);
});

// Call this from your pointer-move handler
room->members.set_state(
    {{"cursor", {{"x", 120}, {"y", 48}}}},
    []() {},
    [](const std::string&) {}
);

room->state.send("LOCK_SECTION", {{"sectionId", "intro"}}, [](const json&) {}, [](const std::string&) {});
room->state.send(
    "UPDATE_SECTION",
    {{"sectionId", "intro"}, {"content", "Updated introduction text..."}},
    [](const json&) {},
    [](const std::string&) {}
);
room->state.send("UNLOCK_SECTION", {{"sectionId", "intro"}}, [](const json&) {}, [](const std::string&) {});
```

</TabItem>
</Tabs>

---

## Presence Indicators

Presence indicators show who is online, what they are doing, and when they are typing. This pattern uses `room.members` for the roster and ephemeral member state for activity.

### Who's Online

```typescript
// Client: render the online roster
room.members.onSync((members) => {
  const onlineUsers = members.map(m => ({
    id: m.memberId,
    name: m.displayName,
    avatar: m.avatarUrl,
    status: m.state?.status ?? 'online',
  }));
  renderOnlineList(onlineUsers);
});

room.members.onJoin((member) => {
  showToast(`${member.displayName} joined`);
});

room.members.onLeave((member, reason) => {
  showToast(`${member.displayName} left (${reason})`);
});
```

### Typing Indicators

Use member state for lightweight, ephemeral typing status. Member state is automatically cleaned up when the user leaves.

```typescript
// Client: broadcast typing status
let typingTimeout: ReturnType<typeof setTimeout>;

inputElement.addEventListener('input', () => {
  room.members.setState({ typing: true });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    room.members.setState({ typing: false });
  }, 2000);
});

// Client: render typing indicators
room.members.onStateChange((member, state) => {
  if (state?.typing) {
    showTypingIndicator(member.memberId);
  } else {
    hideTypingIndicator(member.memberId);
  }
});
```

### Custom Status

```typescript
// Set rich presence
await room.members.setState({
  status: 'away',
  activity: 'Editing section 3',
  lastActiveAt: Date.now(),
});

// Clear on focus
window.addEventListener('focus', () => {
  room.members.setState({ status: 'online', activity: null });
});

window.addEventListener('blur', () => {
  room.members.setState({ status: 'away' });
});
```

### Members vs State for Presence

| Use case | Best tool |
| --- | --- |
| Who is online right now | `room.members.onSync` |
| Typing / cursor / ephemeral activity | `room.members.setState` |
| Persistent player data (HP, score) | `room.state` (playerState) |
| Chat messages, notifications | `room.signals` |

---

## Room Lifecycle

Understanding the full lifecycle of a Room connection helps you build robust reconnection UX and clean resource management.

### Connection Flow

```
client.room('ns', 'id')          Create room reference (no connection yet)
     |
room.join()                      Open WebSocket, authenticate, join
     |
room.session.onConnectionStateChange('connected')
     |
     +-- room.state.onSharedChange(...)    Start receiving state
     +-- room.members.onSync(...)          Start receiving roster
     +-- room.signals.on(...)              Start receiving signals
     |
     ~ normal operation ~
     |
     +-- WebSocket drops
     |     |
     |     room.session.onConnectionStateChange('reconnecting')
     |     |
     |     +-- SDK auto-reconnects (exponential backoff)
     |     |
     |     room.session.onReconnect({ attempt })
     |     room.session.onConnectionStateChange('connected')
     |     |
     |     ~ state re-synced automatically ~
     |
room.leave()                     Clean disconnect
     |
room.session.onConnectionStateChange('disconnected')
```

### Handling Reconnection

```typescript
const room = client.room('game', 'lobby-1', {
  autoReconnect: true,
  maxReconnectAttempts: 10,
  reconnectBaseDelay: 1000,
});

await room.join();

// Track connection state for UI
room.session.onConnectionStateChange((state) => {
  switch (state) {
    case 'connected':
      hideReconnectBanner();
      break;
    case 'reconnecting':
      showReconnectBanner('Reconnecting...');
      break;
    case 'disconnected':
      showReconnectBanner('Disconnected. Please refresh.');
      break;
  }
});

room.session.onReconnect(({ attempt }) => {
  console.log(`Reconnect attempt ${attempt}`);
});

// Handle being kicked
room.session.onKicked(() => {
  showModal('You were removed from this room.');
  navigateToLobby();
});

// Handle errors
room.session.onError((err) => {
  if (err.code === 'RATE_LIMITED') {
    showToast('Slow down! Too many actions.');
  }
});
```

### Clean Resource Management

```typescript
// Store subscriptions for cleanup
const subs = [
  room.state.onSharedChange((state) => render(state)),
  room.members.onSync((members) => renderRoster(members)),
  room.signals.on('chat', (msg) => appendChat(msg)),
];

// On component unmount or navigation
function cleanup() {
  subs.forEach(sub => sub.unsubscribe());
  room.leave();
}
```

### Server-Side Lifecycle

```typescript
handlers: {
  lifecycle: {
    onCreate(room) {
      // First player joined -- initialize state
      room.setSharedState(() => ({ /* ... */ }));
    },

    onJoin(sender, room) {
      // Validate and set up player
      // Throw to reject the join
    },

    onLeave(sender, room, _ctx, reason) {
      // reason: 'leave' | 'disconnect' | 'kicked'
      // 'disconnect' only fires after reconnectTimeout expires
    },

    async onDestroy(room, ctx) {
      // Last player left -- persist results, clean up
      const state = room.getSharedState();
      await ctx.admin.db('app').table('game_results').insert({
        finalState: state,
        endedAt: new Date().toISOString(),
      });
    },
  },
},
```

---

## Media Tracks *(Beta)*

:::info Beta
This feature is in **beta**. Prefer the default `cloudflare_realtimekit`
transport for the broadest production-oriented support matrix.
:::

Room's media layer handles audio, video, and screen-share state. The actual WebRTC negotiation happens through Cloudflare Realtime or your own SFU; `room.media` manages the control plane (who is publishing, mute state, device selection).

### Basic Voice Chat

```typescript
const room = client.room('voice-chat', 'channel-1');
await room.join();

// Enable microphone
await room.media.audio.enable();

// Attach incoming audio tracks
room.media.onTrack((track, member) => {
  if (track.kind === 'audio') {
    const audio = new Audio();
    audio.srcObject = new MediaStream([track]);
    audio.play();
  }
});

// Mute/unmute toggle
toggleMuteButton.addEventListener('click', async () => {
  const isMuted = !room.media.audio.isMuted();
  await room.media.audio.setMuted(isMuted);
  updateMuteIcon(isMuted);
});
```

### Video with Screen Share

```typescript
// Enable camera
await room.media.video.enable({ deviceId: preferredCamera });

// Start screen share
await room.media.screen.start();

// Render all tracks
room.media.onTrack((track, member) => {
  const el = track.kind === 'video'
    ? createVideoElement(member.memberId, track)
    : createAudioElement(member.memberId, track);
  mediaContainer.appendChild(el);
});

room.media.onTrackRemoved((track, member) => {
  removeMediaElement(member.memberId, track.kind);
});

// Monitor media state changes (mute, device switch)
room.media.onStateChange((member, state) => {
  updateMediaIndicator(member.memberId, {
    audioMuted: state.audioMuted,
    videoEnabled: state.videoEnabled,
    screenSharing: state.screenSharing,
  });
});
```

### Device Selection

```typescript
// Switch audio input
await room.media.devices.switch({ audioInputId: 'new-mic-id' });

// List available devices and let user choose
room.media.onDeviceChange((devices) => {
  renderDeviceSelector(devices);
});
```

### Admin Moderation

Moderators can control other members' media through `room.admin`:

```typescript
// Mute a disruptive user (server-validated)
await room.admin.mute(memberId);

// Disable a user's video
await room.admin.disableVideo(memberId);

// Stop a user's screen share
await room.admin.stopScreenShare(memberId);
```

The server validates that the caller has the required role before executing these operations. Configure access via `access.media.control` in the room config.

---

## Related Docs

- [State](/docs/room/state)
- [Members (Presence)](/docs/room/members)
- [Signals (Broadcast)](/docs/room/signals)
- [Media (Voice/Video)](/docs/room/media)
- [Server Hooks and Actions](/docs/room/server)
- [Advanced](/docs/room/advanced) -- persistence, security model, cost
