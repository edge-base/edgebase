---
sidebar_position: 4
---

# Database Subscriptions & Room Internals

How EdgeBase delivers real-time database subscriptions and server-authoritative game/collaboration rooms.

## Database Subscription Architecture

Database subscriptions run inside **DatabaseLiveDO** (a Durable Object) using the Cloudflare **WebSocket Hibernation API**. There is no external message broker, no pub/sub service, and no per-message billing. Idle connections cost $0.

### Channel-DO Mapping

Each database subscription channel maps to a dedicated Durable Object instance:

| Channel Pattern | Example | Use Case |
|---|---|---|
| `dblive:{namespace}:{table}` | `dblive:app:posts` | Subscribe to all changes on a table (static DB) |
| `dblive:{namespace}:{instanceId}:{table}` | `dblive:workspace:ws-456:docs` | Subscribe to changes in a dynamic DB instance |
| `dblive:{namespace}:{table}:{docId}` | `dblive:app:posts:abc123` | Subscribe to a single document |

DatabaseLiveDO does **not use SQLite** — all state is held in memory because it is inherently ephemeral (connection-based). When a connection closes, the associated state is expected to disappear.

## WebSocket Hibernation API

The Hibernation API is the foundation of EdgeBase Database Subscriptions' cost model:

```
Active connections ──── DO is awake, processing messages
                           │
All connections idle ──── DO hibernates ($0 duration cost)
                           │
Message arrives ────────── DO wakes up instantly
```

When a DO hibernates, its in-memory state (subscriptions and filter registrations) is lost. EdgeBase handles this with the **RESYNC protocol**.

### RESYNC Protocol

When a DO wakes from hibernation, it broadcasts RESYNC messages to all connected clients:

```
DO wakes up (memory cleared)
  │
  └─ Send FILTER_RESYNC to authenticated connections
      → Clients re-send their subscription filters
```

The SDK handles RESYNC automatically — no developer intervention is needed. `FILTER_RESYNC` only goes to authenticated connections (requiring re-auth first).

## Authentication Handshake

WebSocket connections use a **message-based authentication** flow rather than URL query parameters. This prevents tokens from appearing in server access logs, browser history, and Referer headers.

```
Client                          Server
  │                               │
  ├── WebSocket upgrade ─────────►│
  │                               │
  ├── { type: "auth",            │
  │     token: "eyJhbG..." } ───►│── Verify JWT
  │                               │
  │◄── { type: "auth_success",   │
  │      userId: "..." } ────────│
  │                               │
  │   (Now: subscribe operations) │
```

- Authentication must complete within a timeout (default: 5000ms, configurable via `databaseLive.authTimeoutMs`)
- Any subscribe request before authentication results in an error and connection termination
- Authentication state is stored in WebSocket tags (Hibernation API metadata)

### Keep-Alive

Clients send `{ type: "ping" }` every 30 seconds. The server responds with `{ type: "pong" }`. This confirms connection liveness and resets the Hibernation idle timer.

### Auto Token Refresh

When the Access Token is refreshed (by any mechanism — HTTP request, another tab, scheduled refresh), the SDK's `DatabaseLiveClient` automatically sends a re-auth message on the existing WebSocket connection:

```json
{ "type": "auth", "token": "new-eyJhbG..." }
```

The server recognizes this as a re-authentication, updates the auth state, and keeps all existing subscriptions intact.

## Event Propagation

When data changes occur, the Database DO notifies DatabaseLiveDO directly — **without routing through the Worker**:

```
Client write
  │
  ▼
Database DO
  ├─ Execute SQL (INSERT/UPDATE/DELETE)
  ├─ Evaluate security rules
  └─ stub.fetch() → DatabaseLiveDO (direct DO-to-DO call)
                       │
                       ├─ Table channel: notify all table subscribers
                       └─ Document channel: notify single-doc subscribers
```

### Dual Propagation

Every CUD (Create, Update, Delete) event propagates to **both** the table-level channel and the document-level channel simultaneously. This ensures that subscribers watching the entire table and subscribers watching a specific document both receive real-time notifications.

### Event Types

| Event | Trigger |
|---|---|
| `added` | New record inserted |
| `modified` | Existing record updated |
| `removed` | Record deleted |
| `batch_changes` | Multiple changes in a single transaction (above threshold) |

### Batch Event Bundling

When a single transaction produces more changes than the batch threshold (default: 10, configurable via `databaseLive.batchThreshold`), events are bundled into a single `batch_changes` message:

```json
{
  "type": "batch_changes",
  "channel": "dblive:app:posts",
  "changes": [
    { "event": "modified", "data": { "id": "...", "title": "..." } },
    { "event": "modified", "data": { "id": "...", "title": "..." } }
  ],
  "total": 150
}
```

SDK version negotiation preserves protocol compatibility — older SDKs receive individual events, newer SDKs receive bundled messages.

## Server-Side Subscription Filters

Clients can register filters at subscription time to receive only matching events:

```json
{
  "type": "subscribe",
  "channel": "dblive:app:posts",
  "filters": [["authorId", "==", "user-123"]],
  "orFilters": [["status", "==", "published"], ["status", "==", "featured"]]
}
```

The filter logic translates to: `WHERE authorId = ? AND (status = ? OR status = ?)`.

| Filter Type | Logic | Max Conditions |
|---|---|---|
| `filters` | AND (all must match) | 5 |
| `orFilters` | OR (any must match) | 5 |

Filters are **additive restrictions** — they can only narrow what the security rules already allow, never bypass them. After hibernation wake-up, `FILTER_RESYNC` prompts the SDK to re-register all filters.

### Dynamic Filter Updates

Clients can update their filters without disconnecting using an `update_filters` message. This replaces the existing filters for a given channel subscription.

## Subscription Access Control

Database subscriptions reuse the table's `read` security rule, evaluated once at subscribe time. If the user does not have read access to the table, the subscription is rejected.

When a user's JWT is refreshed (re-auth), the server re-evaluates all of that user's active subscriptions. If a subscription no longer passes the rules (e.g., membership was revoked), the channel is gracefully unsubscribed and the client is notified via `revokedChannels`.

---

## Room Architecture

Room is a **server-authoritative** real-time state channel designed for multiplayer games, collaborative editors, and live dashboards. Unlike Database Subscriptions (which are data-driven), Room is action-driven: clients send intentions, the server decides state changes, and all clients receive the authoritative result.

```
Client A ── send("move", {x:5}) ──►  Room DO (onAction handler)
Client B ── send("attack", {}) ──►      │
                                         ├─ Server updates state
                                         ├─ Delta broadcast to all
                                         └─ Player-specific state unicast
```

### Three State Areas

| State Area | Visibility | Writer | Purpose |
|---|---|---|---|
| **sharedState** | All connected clients | Server only | Game world, shared document state |
| **playerState** | Only the owning player | Server only | Hand of cards, personal inventory |
| **serverState** | Server only | Server only | RNG seeds, hidden game logic, timers |

Clients never write state directly. They send **actions** via `send(actionType, payload)`, and the server's `onAction` handler decides how to modify state.

### Delta Broadcasting

When state changes, Room sends only the **diff** (delta), not the full state:

- `shared_delta` — broadcast to all connected clients
- `player_delta` — unicast to the specific player only

Deltas are buffered for **50 milliseconds** and throttled to **10 messages/second**, reducing network overhead for rapid state changes (e.g., real-time game physics).

### Members (Presence)

Room includes built-in member tracking via `room.members`. This replaces the standalone presence system — all presence is now scoped to rooms.

```typescript
const room = client.room('game', 'lobby');
await room.connect();
room.members.setState({ status: 'online', name: 'Alice' });

room.members.onJoin((member) => { ... });
room.members.onLeave((member) => { ... });
```

#### Member Cleanup on Disconnect

Clients that disconnect abnormally (network failure, crash, browser close without cleanup) are handled via the **reconnect timeout**:

- When a connection closes, the server holds the member's slot for the reconnect timeout (default: 30 seconds, configurable via `reconnectTimeout`)
- If the client does not reconnect within the timeout, the member entry is removed
- A `member_leave` event with `reason: 'disconnect'` is broadcast to remaining members
- Explicit disconnects produce `reason: 'leave'`, and server kicks produce `reason: 'kicked'`

This eliminates ghost users without requiring explicit cleanup logic from the application.

#### Member Constraints

- **Payload size limit**: 1 KB per member entry (enforced on both server and SDK)
- Member state is **memory-only** — it does not survive hibernation. The RESYNC protocol restores it from clients.

### Zero-Cost Hibernation

When the last player leaves a room, the DO enters hibernation:

1. All three state areas are persisted to DO Storage
2. The DO hibernates — **$0 duration cost**
3. When a player connects again, state is restored from storage
4. The room resumes exactly where it left off

State persistence also runs periodically (default: every 60 seconds via `stateSaveInterval`) to protect against crashes. A `stateTTL` (default: 24 hours) controls how long persisted state is kept — after expiration, the room starts fresh.

```typescript
// Manual save is also available
room.saveState();
```

### Lifecycle Hooks

```
Room created
  │
  ▼
onCreate ─── Initialize shared/server state
  │
  ▼
Player connects
  │
  ▼
onJoin(sender, room) ─── Validate, assign player state
  │                       (throw to reject)
  ▼
onAction[type](sender, payload, room)
  │  ├─ setSharedState(data)  → delta broadcast
  │  ├─ setPlayerState(userId, data) → delta unicast
  │  └─ setServerState(data)  → server only
  │
  ▼
Player disconnects
  │
  ▼
onLeave(sender, room) ─── reason: 'leave' | 'disconnect' | 'kicked'
  │
  ▼
Last player leaves
  │
  ▼
onDestroy ─── Cleanup, final save, hibernate
```

### Room Features

| Feature | Description |
|---|---|
| **Messaging** | `room.sendMessage(type, data)` for broadcast; `room.sendMessageTo(userId, type, data)` for unicast |
| **Broadcast Exclude** | `room.sendMessage(type, data, { exclude: [userId] })` to skip specific players |
| **Kick** | `room.kick(userId)` — triggers `onLeave` with `reason: 'kicked'` |
| **Named Timers** | `room.setTimer(name, ms, data?)` / `room.clearTimer(name)` — persisted across hibernation |
| **Metadata** | `room.setMetadata(data)` — queryable via HTTP without WebSocket (useful for lobbies) |
| **Admin Context** | `ctx.admin` is injected into handlers for DB access from within room logic |
| **State Size Warning** | `ROOM_STATE_WARNING` event fires when cumulative state reaches 80% of `maxStateSize` |
| **Members** | `room.members` — built-in presence tracking with join/leave events and TTL cleanup |
| **Signals** | `room.signals` — lightweight pub/sub for custom coordination (WebRTC signaling, cursors) |
| **Media Metadata** *(alpha)* | `room.media` — track audio/video/screen publish/mute state for conferencing UIs |

### Room Configuration Defaults

| Setting | Default | Description |
|---|---|---|
| `reconnectTimeout` | 30 seconds | How long to hold a player's slot after disconnect |
| `rateLimit.actions` | 10 (token bucket) | Max actions per second per player |
| `maxStateSize` | 1 MB | Maximum cumulative state across all three areas |
| `stateSaveInterval` | 60 seconds | How often state is persisted to DO Storage |
| `stateTTL` | 24 hours | How long persisted state is retained |
| Action timeout | 5 seconds | Max execution time per `onAction` handler |
| Delta buffer | 50 ms | Delta batching window |

### Player Information Security

The server does not automatically expose the player list to clients. To make player information visible, the developer must explicitly share it through `setSharedState` in the `onJoin` and `onLeave` handlers. This prevents unintended leaking of connection metadata.

## Next Steps

- [**Cost Analysis**](/docs/why-edgebase/cost-analysis) — Why Database Subscriptions and Room cost ~300x less than alternatives
- [**Security Model**](./security-model.md) — Channel access control and membership verification
