---
sidebar_position: 3
title: Advanced
description: State persistence, serverState, reconnect handling, security model, cost structure, limits.
---

# Advanced

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

This page covers operational topics: state persistence, the serverState area, reconnect behaviour, security model, cost structure, and limitations.

---

## State Persistence

All three state areas (sharedState, playerState, serverState) are periodically saved to Durable Object Storage. This means:

- **Hibernation recovery is automatic** -- when a Durable Object wakes from hibernation, state is restored from storage.
- **No developer action needed** -- unlike previous versions, there is no `onResync` hook or manual recovery step.
- **All three areas are preserved** -- including `serverState`, which was previously lost on hibernation.

### How It Works

1. State is saved to DO Storage every `stateSaveInterval` (default: 60 seconds).
2. Saves only happen when state has actually changed (dirty flag).
3. On hibernation wake-up, state is loaded from storage automatically.
4. Saved state expires after `stateTTL` (default: 24 hours) as a safety net.
5. When a room is destroyed (last player leaves), stored state is immediately deleted.

### Manual Save

For critical state changes that must survive even if the interval hasn't elapsed:

```typescript
handlers: {
  actions: {
    PURCHASE: async (_payload, room) => {
      // Process purchase...
      room.setSharedState(s => ({ ...s, items: newItems }));

      // Force immediate save -- don't wait for the next interval
      await room.saveState();

      return { purchased: true };
    },
  },
},
```

### Configuration

```typescript
rooms: {
  'game': {
    stateSaveInterval: 30000,   // Save every 30 seconds (default: 60000)
    stateTTL: 3600000,          // Expire saved state after 1 hour (default: 86400000 = 24h)
  },
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `stateSaveInterval` | `60000` (1 min) | How often state is saved to DO Storage (ms) |
| `stateTTL` | `86400000` (24h) | How long saved state remains valid (ms). After this, state is auto-deleted. |

### Cost

At the default 1-minute interval:
- ~1,440 writes/day per active room
- Cost: ~$0.001/day per room (DO Storage pricing)
- Empty rooms cost $0 (hibernated, no writes)

---

## serverState

`serverState` is a state area visible only to server-side code. It is never sent to clients.

| Aspect | Detail |
|--------|--------|
| **Visibility** | Never sent to clients. Only accessible in `handlers.actions`, `handlers.lifecycle.onCreate`, `handlers.lifecycle.onDestroy`, etc. |
| **Persistence** | Automatically saved with sharedState and playerState. Survives hibernation. |
| **Best for** | RNG seeds, anti-cheat counters, transient computation caches |

```typescript
rooms: {
  'game': {
    handlers: {
      lifecycle: {
        onCreate(room) {
          room.setServerState(() => ({
            seed: Math.random(),
            moveCount: 0,
          }));
        },
      },
      actions: {
        MOVE: (_payload, room) => {
          const server = room.getServerState();
          room.setServerState(s => ({
            ...s,
            moveCount: (s.moveCount as number) + 1,
          }));
          return { moveNumber: (server.moveCount as number) + 1 };
        },
      },
    },
  }
}
```

---

## Reconnect Handling

When a client disconnects, the server does not immediately fire `handlers.lifecycle.onLeave`. Instead, it starts a **reconnect timer** based on `reconnectTimeout` (default: 30 seconds).

### Timeline

```
Client disconnects
  |
  +-- reconnectTimeout counting...
  |     |
  |     +-- Client reconnects within timeout?
  |     |     -> Cancel timer, resume session
  |     |     -> Player state preserved
  |     |
  |     +-- Timeout expires
  |           -> handlers.lifecycle.onLeave(sender, room, ctx, 'disconnect') fires
  |           -> Player state cleaned up
  |           -> If last player: handlers.lifecycle.onDestroy fires
```

Setting `reconnectTimeout: 0` means `handlers.lifecycle.onLeave` fires immediately when the WebSocket closes.

---

## Security Model

### Client Cannot Write State

The client can only **read**, **subscribe**, and **send()**. There is no client-side `setState` or `patchState`. All state mutations go through server-side `handlers.actions`, which means:

- Every state change is validated by the server.
- No trust is placed in client input.
- The server controls what data each player can see (sharedState vs playerState).

### Player Information is Not Automatically Exposed

Room does not broadcast player join/leave events or player lists to clients. The developer explicitly controls what player information is shared via `setSharedState` in `handlers.lifecycle.onJoin` / `handlers.lifecycle.onLeave`. See [Server Guide — Player Tracking](server.md#player-tracking) for details.

### Authentication

All Room connections require JWT authentication. The `auth` message must be the first WebSocket message sent within 5 seconds. Unauthenticated connections are closed with `AUTH_TIMEOUT`.

Token refresh is supported during the connection lifetime -- send another `auth` message with the new token. On success, the server responds with `auth_refreshed`.

### State Visibility

| State Area | Who Can Read | Who Can Write |
|------------|-------------|---------------|
| sharedState | All connected clients | Server only (`setSharedState`) |
| playerState | Only the owning player | Server only (`setPlayerState`) |
| serverState | Server only | Server only (`setServerState`) |

:::warning Do not store secrets in sharedState
`sharedState` is broadcast to all connected clients. Never put API keys, tokens, other users' PII, or any sensitive data in sharedState. Use `serverState` for server-only secrets, or store them in the database.
:::

### Join Rejection

Use `handlers.lifecycle.onJoin` to reject unauthorized players:

```typescript
handlers: {
  lifecycle: {
    onJoin(sender) {
      if (sender.role !== 'premium') {
        throw new Error('Premium subscription required');
      }
    },
  },
},
```

Throwing in `handlers.lifecycle.onJoin` sends `JOIN_DENIED` to the client and closes the connection.

### Admin Context Security

The `ctx.admin` object in handlers bypasses all access rules:

- Never expose raw admin query results to clients without filtering.
- Never pass unsanitized client input to `ctx.admin.db()` operations.
- Validate `payload` before using it in database operations.

---

## Cost Model

Rooms are backed by Cloudflare Durable Objects with Hibernatable WebSockets:

| Resource | What Counts | Pricing |
|----------|-------------|---------|
| **Durable Object requests** | Each WebSocket message (send or receive) | $0.15 / million requests |
| **Durable Object duration** | Wall-clock time while >= 1 connection exists | $12.50 / million GB-s |
| **DO Storage writes** | State saves (every `stateSaveInterval`) | $1.00 / million writes |
| **WebSocket connections** | Concurrent open connections | Included in DO pricing |
| **Hibernation** | Empty rooms with no connections | **$0** -- fully hibernated |
| **Data transfer** | Outbound data to clients | Standard Workers bandwidth |

### Cost Optimization Tips

- Use `setSharedState` with minimal changes -- deltas are computed automatically and only changed fields are broadcast.
- Use `playerState` for per-player data instead of embedding it in `sharedState` -- player deltas are unicast, not broadcast.
- Use `sendMessage()` / `sendMessageTo()` for ephemeral events (chat, effects) that do not need to be persisted in state.
- Keep state small -- large states mean more bytes per `sync` message on rejoin.
- Set `reconnectTimeout` appropriately -- shorter timeouts mean fewer lingering connections.
- Increase `stateSaveInterval` for rooms where data loss is acceptable (e.g. casual chat).

---

## Limitations and Best Practices

### Latency

Action round-trip: approximately 50-150 ms (client -> DO -> handler -> broadcast). Actual latency depends on proximity to the nearest Cloudflare edge and handler processing time.

Delta batching: shared state updates are batched for 50 ms before broadcast. This reduces message count for rapid sequential mutations within a single handler.

### State Design

- **sharedState**: Keep it flat and minimal. All clients receive every change.
- **playerState**: Use for per-player data that other players should not see.
- **serverState**: Use for server-only data. Survives hibernation automatically.

### High-Frequency Updates

For use cases like real-time cursor tracking or typing indicators:

- Prefer `sendMessage()` / `sendMessageTo()` over state mutations -- messages are sent once and not persisted.
- If using state, keep the update payload minimal.
- Consider increasing `rateLimit.actions` if your use case requires more than 10 actions/sec per player.
- For signaling-heavy collaboration flows, tune `rateLimit.signals` so bursts do not consume the same bucket as gameplay or app actions.

### Docker / Self-Hosted

Room requires Durable Objects, which are a Cloudflare-specific primitive. In Docker / self-hosted deployments, Room uses an in-memory fallback with the same API but no cross-instance persistence. This is suitable for development and testing but not production multi-instance deployments.

---

## Named Timers

Named timers let you schedule delayed actions inside a room — turn timers, countdowns, periodic effects, and more. Timer handlers are defined in `handlers.timers` and triggered via `room.setTimer()`.

### API

| Method | Description |
|--------|-------------|
| `room.setTimer(name, ms, data?)` | Schedule a named timer. Calls `handlers.timers[name]` after `ms` milliseconds. Overwrites any existing timer with the same name. |
| `room.clearTimer(name)` | Cancel a pending named timer. No-op if the timer does not exist. |

### Example

```js
room: {
  rooms: {
    'game-room': {
      handlers: {
        lifecycle: {
          onJoin(_sender, room) {
            room.setTimer('countdown', 30000, { round: 1 });
          },
        },
        timers: {
          countdown(room, _ctx, data) {
            room.sendMessage('round-end', { round: data.round });
            room.setTimer('countdown', 30000, { round: data.round + 1 });
          }
        },
      },
    }
  }
}
```

### Timer Handler Signature

```typescript
(room: RoomServerAPI, ctx: RoomHandlerContext, data?: unknown) => Promise<void> | void;
```

- **No `sender` parameter** — timers are not triggered by a player.
- **`data`** is the optional payload passed as the third argument to `room.setTimer()`.
- **Timers persist across hibernation** — they are stored in Durable Object storage and survive DO sleep/wake cycles.
- **Multiple named timers can coexist** — they are multiplexed through a single DO alarm internally.
- Timer handlers do **not** count against action rate limits.
- A timer can schedule another timer (e.g., recurring countdown as shown above).
- Setting a timer with the same name overwrites the previous one — no duplicates.

---

## Broadcast Exclude

When broadcasting messages from server-side code, you can selectively exclude specific users or send messages to a single user.

### Broadcast to all players

```js
room.sendMessage('game-update', { score: 100 });
```

### Broadcast to all except specific users

```js
room.sendMessage('game-update', { score: 100 }, { exclude: ['user-123'] });
```

The `exclude` option accepts an array of user IDs. All connected clients **except** those users will receive the message. This is useful for scenarios like notifying other players about an action without sending it back to the actor.

### Send to a specific user only

```js
room.sendMessageTo('user-123', 'private-msg', { text: 'Hello' });
```

`sendMessageTo` sends to **all connections** of the specified user (a user may have multiple tabs/devices connected). The message format is the same as `sendMessage`.

Both `sendMessage` and `sendMessageTo` are fire-and-forget — messages are not persisted in state. Use them for ephemeral events like chat messages, sound effects, or notifications.

---

## Limits

| Limit | Default | Configurable |
|-------|---------|-------------|
| Max players per room | 100 | `maxPlayers` (1 -- 32768) |
| Max state size (shared + all player) | 1 MB | `maxStateSize` (min 1 KB) |
| Rate limit (actions/sec/connection) | 10 | `rateLimit.actions` |
| Reconnect grace period | 30 seconds | `reconnectTimeout` |
| State save interval | 60 seconds | `stateSaveInterval` |
| State TTL | 24 hours | `stateTTL` |
| Auth timeout | 5 seconds | No |
| `handlers.actions` timeout | 5 seconds | No |
| Delta batch interval | 50 ms | No |
| Max dot-path depth | 5 levels | No |
| Idle timeout (empty room to hibernation) | 300 seconds | No |

### State Size Warning

When the combined state size (sharedState + all playerStates) reaches **80%** of `maxStateSize`, all connected clients receive a warning:

```json
{ "type": "ROOM_STATE_WARNING", "code": "ROOM_STATE_WARNING", "usage": 0.85, "percentage": 85 }
```

If state exceeds `maxStateSize`, the mutation is rejected with `STATE_TOO_LARGE`.
