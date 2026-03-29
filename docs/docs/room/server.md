---
sidebar_position: 2
title: Server Guide
sidebar_label: Server Hooks and Actions
description: Room server configuration — action handlers, lifecycle hooks, state management, player tracking, admin context.
---

# Server Guide

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

All Room settings are defined in `edgebase.config.ts` under the `rooms` key. Each key is a **namespace** (e.g. `'game'`, `'lobby'`), and clients connect with `client.room(namespace, roomId)`.

The `ctx.admin` examples in this guide map to the same server-side capabilities exposed by all Admin SDKs.

---

## Room Configuration

```typescript
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  rooms: {
    'game': {
      maxPlayers: 10,
      handlers: {
        lifecycle: {
          onCreate(room) {
            room.setSharedState(() => ({ turn: 0, score: 0 }));
          },
          onJoin(sender, room) {
            room.setPlayerState(sender.userId, () => ({ hp: 100 }));
          },
        },
        actions: {
          SET_SCORE: (payload, room) => {
            room.setSharedState(s => ({ ...s, score: payload.score }));
            return { score: payload.score };
          },
        },
      },
    },
  },
});
```

### Namespace Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxPlayers` | `number` | `100` | Maximum concurrent connections per room instance (1 -- 32768) |
| `maxStateSize` | `number` (bytes) | `1048576` (1 MB) | Maximum combined size of sharedState + all playerStates. Min 1 KB. |
| `reconnectTimeout` | `number` (ms) | `30000` | Grace period before `handlers.lifecycle.onLeave` fires after disconnect. `0` = immediate. |
| `rateLimit` | `{ actions: number; signals?: number; admin?: number }` | `{ actions: 10 }` | Token-bucket room WebSocket rate limits per second per connection. Omitted scopes fall back to `actions`. |
| `stateSaveInterval` | `number` (ms) | `60000` | How often state is saved to DO Storage. Lower = less data loss, more writes. |
| `stateTTL` | `number` (ms) | `86400000` | How long saved state remains valid. After expiry, state is auto-deleted. |

---

## Lifecycle Hooks

| Hook | Signature | Description |
|------|-----------|-------------|
| `handlers.lifecycle.onCreate` | `(room, ctx) => void` | Called once when the first player joins. Initialize state here. |
| `handlers.lifecycle.onJoin` | `(sender, room, ctx) => void` | Called each time a player joins. Throw to reject the join. |
| `handlers.lifecycle.onLeave` | `(sender, room, ctx, reason) => void` | Called when a player leaves. `reason`: `'leave'` \| `'disconnect'` \| `'kicked'` |
| `handlers.lifecycle.onDestroy` | `(room, ctx) => void` | Called after the last player leaves, before hibernation. Persist results here. |

All hooks can be `async`.

```typescript
rooms: {
  'game': {
    handlers: {
      lifecycle: {
        onCreate(room) {
          room.setSharedState(() => ({
            phase: 'waiting',
            round: 0,
          }));
          room.setServerState(() => ({
            seed: Math.random(),
          }));
        },

        onJoin(sender, room) {
          // Reject unauthorized players
          if (sender.role === 'banned') {
            throw new Error('You are banned');
          }
          room.setPlayerState(sender.userId, () => ({
            hp: 100,
            position: { x: 0, y: 0 },
          }));
        },

        onLeave(sender, room, _ctx, reason) {
          room.setSharedState(s => ({
            ...s,
            lastLeave: { userId: sender.userId, reason },
          }));
        },

        async onDestroy(room, ctx) {
          const state = room.getSharedState();
          await ctx.admin.db('app').table('game_results').insert({
            round: state.round,
            finalScore: state.score,
          });
        },
      },
    },
  },
}
```

---

## Action Handlers

All state mutations go through **server-side action handlers**. Clients call `room.send(type, payload)`, the server runs the matching handler, mutates state, and broadcasts changes automatically.

```
Client                            Server
  │                                  │
  │── send('type', payload) ────────▶│
  │                                  │  handlers.actions['type'] runs
  │                                  │  setSharedState / setPlayerState / setServerState
  │◀── action_result (return value) ─│
  │◀── shared_delta / player_delta ──│  (auto-broadcast)
```

### Defining Handlers

```typescript
handlers: {
  actions: {
    MOVE: (payload, room, sender) => {
      room.setPlayerState(sender.userId, s => ({
        ...s,
        position: { x: payload.x, y: payload.y },
      }));
      return { moved: true };
    },

    ATTACK: async (payload, room) => {
      const target = room.player(payload.targetId);
      if (!target) throw new Error('Target not found');

      room.setPlayerState(payload.targetId, s => ({
        ...s,
        hp: Math.max(0, (s.hp as number) - 10),
      }));

      return { damage: 10 };
    },

    CHAT: (payload, room, sender) => {
      room.sendMessage('chat', {
        from: sender.userId,
        text: payload.text,
      });
    },
  },
},
```

### Handler Signature

```typescript
(payload: unknown, room: RoomServerAPI, sender: RoomSender, ctx: RoomHandlerContext)
  => Promise<unknown> | unknown;
```

### `payload`

The data sent by the client via `room.send(type, payload)`. Can be any JSON-serializable value. Always validate before use.

### `sender` — `RoomSender`

| Field | Type | Description |
|-------|------|-------------|
| `sender.userId` | `string` | Authenticated user ID (from JWT `sub`) |
| `sender.connectionId` | `string` | Unique connection ID for this WebSocket session |
| `sender.role` | `string?` | User role from JWT (if set) |

### Return Values and Errors

The handler's return value is sent back **only to the client that sent the action**:

```typescript
handlers: {
  actions: {
    BET: (payload, room) => {
      room.setSharedState(s => ({ ...s, pot: (s.pot as number) + payload.amount }));
      return { newPot: (room.getSharedState().pot as number) + payload.amount };
    },
  },
}
// Client receives: { type: 'action_result', result: { newPot: 150 }, requestId: '...' }
```

```typescript
handlers: {
  actions: {
    BET: (payload, room) => {
      if (payload.amount > 100) {
        throw new Error('Bet exceeds maximum');
      }
    },
  },
}
// Client receives: { type: 'action_error', message: 'Bet exceeds maximum', requestId: '...' }
```

Each `handlers.actions` entry has a **5-second timeout**. If it does not return within that window, the client receives an `action_error`.

---

## RoomServerAPI

The `room` parameter in all hooks and action handlers provides the server-side API.

### Shared State (visible to all clients)

| Method | Description |
|--------|-------------|
| `room.getSharedState()` | Returns a read-only snapshot of the current shared state. |
| `room.setSharedState(updater)` | Mutate shared state. `updater: (state) => newState`. Delta auto-broadcast to all clients. |

```typescript
// Read
const state = room.getSharedState();
console.log(state.score);

// Write (updater function pattern)
room.setSharedState(s => ({ ...s, score: (s.score as number) + 1 }));
```

### Player State (visible only to the owning player)

| Method | Description |
|--------|-------------|
| `room.player(userId)` | Get a specific player's state (read-only snapshot). |
| `room.players()` | Get all players as `[userId, state][]`. |
| `room.setPlayerState(userId, updater)` | Mutate a player's state. Delta unicast to that player only. |

```typescript
// Read one player
const hp = room.player(sender.userId).hp;

// Read all players
const allPlayers = room.players(); // [['user1', {...}], ['user2', {...}]]

// Write
room.setPlayerState(sender.userId, s => ({ ...s, hp: (s.hp as number) - 10 }));
```

### Server State (server-only, never sent to clients)

| Method | Description |
|--------|-------------|
| `room.getServerState()` | Returns a snapshot of server-only state. |
| `room.setServerState(updater)` | Mutate server-only state. No broadcast. |

```typescript
room.setServerState(s => ({ ...s, seed: Math.random() }));
const secret = room.getServerState().seed;
```

`serverState` is automatically persisted alongside sharedState and playerState. It survives Durable Object hibernation. Use it for RNG seeds, anti-cheat counters, and internal computation caches.

### Messaging and Control

| Method | Description |
|--------|-------------|
| `room.sendMessage(type, data?, options?)` | Broadcast a one-off message to all connected clients. `options.exclude`: array of userIds to skip. |
| `room.sendMessageTo(userId, type, data?)` | Send a one-off message to a specific user only. |
| `room.kick(userId)` | Forcefully disconnect a player. Triggers `handlers.lifecycle.onLeave` with `reason='kicked'`. |
| `room.saveState()` | Force immediate state save to DO Storage. |
| `room.setTimer(name, ms, data?)` | Schedule a named timer. Calls `handlers.timers[name]` after `ms` milliseconds. |
| `room.clearTimer(name)` | Cancel a named timer. No-op if timer doesn't exist. |
| `room.setMetadata(data)` | Set developer-defined metadata (queryable via HTTP without joining). |
| `room.getMetadata()` | Get current room metadata. |

```typescript
// Broadcast a message (clients receive via room.onMessage('game_over', handler))
room.sendMessage('game_over', { winner: sender.userId });

// Broadcast excluding specific users
room.sendMessage('player_moved', { userId: sender.userId, x: 10 }, {
  exclude: [sender.userId],
});

// Send to a specific player (clients receive via room.onMessage)
room.sendMessageTo(payload.targetUserId, 'private_hint', { hint: 'look left' });

// Kick a player
room.kick(payload.targetUserId);

// Force save after critical change
await room.saveState();
```

Messages are fire-and-forget — they are not persisted in state. Use them for ephemeral events like chat, sound effects, or notifications. `sendMessageTo` sends to all connections of the specified user (same format as `sendMessage`).

---

## Player Tracking

Room does not automatically expose player information to clients. This is a security decision — the developer controls exactly what player data is shared via `setSharedState`.

### Server

```typescript
rooms: {
  'game': {
    handlers: {
      lifecycle: {
        onJoin(sender, room) {
          room.setSharedState(s => ({
            ...s,
            players: [...(s.players || []), { id: sender.userId }],
          }));
        },
        onLeave(sender, room) {
          room.setSharedState(s => ({
            ...s,
            players: (s.players || []).filter(p => p.id !== sender.userId),
          }));
        },
      },
    },
  },
}
```

### Client

```typescript
room.onSharedState((state) => {
  renderPlayerList(state.players);
});
```

:::warning sharedState is visible to all clients
Everything in `sharedState` is broadcast to **all connected clients**.
Only include publicly safe information (nicknames, avatars, etc.).
Never include emails, tokens, or other sensitive data.

For data that only a specific player should see, use `setPlayerState` — it is unicast to the owning player only.
:::

---

## Reconnect

When a client disconnects, the server waits for `reconnectTimeout` before firing `handlers.lifecycle.onLeave`. If the client reconnects within this window, the session resumes with state preserved.

```typescript
rooms: {
  'game': {
    reconnectTimeout: 15000,  // 15 seconds grace period
  },
  'ephemeral-chat': {
    reconnectTimeout: 0,      // Immediate handlers.lifecycle.onLeave on disconnect
  },
}
```

- `reconnectTimeout: 0` — `handlers.lifecycle.onLeave` fires immediately on disconnect.
- Client SDKs handle auto-reconnect automatically (exponential backoff).
- `handlers.lifecycle.onLeave` receives `reason`:
  - `'leave'` — client called `room.leave()` explicitly
  - `'disconnect'` — WebSocket dropped and reconnect timeout expired
  - `'kicked'` — server called `room.kick(userId)`

---

## Admin Context (`ctx`)

Admin context for cross-DO operations. Bypasses all access rules.

| Property | Description |
|----------|-------------|
| `ctx.admin.db(namespace, id?)` | Access a database namespace. Returns a DB proxy. |
| `ctx.admin.push.send(userId, payload)` | Send a push notification to a user. |
| `ctx.admin.push.sendMany(userIds, payload)` | Send push notifications to multiple users. |
| `ctx.admin.broadcast(channel, event, data?)` | Broadcast on a database subscription channel (outside Room). |

### Database Access

Use `ctx.admin.db()` to read/write databases from within action handlers:

```typescript
handlers: {
  actions: {
    SAVE_SCORE: async (_payload, room, sender, ctx) => {
      const state = room.getSharedState();

      // Write to database (cross-DO, may have latency)
      await ctx.admin.db('app').table('scores').insert({
        usedId: sender.userId,
        score: state.score,
      });

      return { saved: true };
    },

    LOAD_INVENTORY: async (_payload, room, sender, ctx) => {
      // Read from a per-user database
      const items = await ctx.admin
        .db('user', sender.userId)
        .table('inventory')
        .list();

      room.setPlayerState(sender.userId, s => ({
        ...s,
        inventory: items,
      }));

      return { itemCount: items.length };
    },
  },
},
```

The DB proxy supports: `get(id)`, `list(filter?)`, `insert(data)`, `update(id, data)`, `delete(id)`.

:::warning Admin bypasses access rules
`ctx.admin` operations bypass all access rules and use service-key-level access. Validate `payload` before using it in database operations. Never expose raw admin results to clients without filtering.
:::

:::caution Cross-DO latency
Database operations go through Durable Object stubs (cross-DO), which can introduce latency of several seconds. Use `void ctx.admin.db(...).catch(...)` for fire-and-forget writes when the result is not needed for the action response.
:::

---

## Timers

Schedule named timers in action handlers. Essential for game logic — turn timers, countdowns, delayed effects.

### Defining Timer Handlers

```typescript
rooms: {
  'game': {
    handlers: {
      timers: {
        turnEnd: (room) => {
          room.setSharedState(s => ({ ...s, phase: 'next_turn' }));
          room.sendMessage('turn_ended', {});
        },
        countdown: (room, _ctx, data) => {
          room.sendMessage('countdown_tick', { remaining: data.remaining });
          if (data.remaining > 0) {
            room.setTimer('countdown', 1000, { remaining: data.remaining - 1 });
          }
        },
      },

      actions: {
        START_TURN: (_payload, room) => {
          room.setTimer('turnEnd', 30000); // 30s turn timer
        },
        CANCEL_TURN: (_payload, room) => {
          room.clearTimer('turnEnd');
        },
        START_COUNTDOWN: (_payload, room) => {
          room.setTimer('countdown', 1000, { remaining: 10 });
        },
      },
    },
  },
},
```

### Timer API

| Method | Description |
|--------|-------------|
| `room.setTimer(name, ms, data?)` | Schedule a named timer. Calls `handlers.timers[name]` after `ms` milliseconds. Overwrites existing timer with same name. |
| `room.clearTimer(name)` | Cancel a named timer. No-op if timer doesn't exist. |

### Timer Handler Signature

```typescript
(room: RoomServerAPI, ctx: RoomHandlerContext, data?: unknown) => Promise<void> | void;
```

- No `sender` parameter — timers are not triggered by a player.
- `data` is the optional payload passed to `setTimer()`.
- Timers survive DO hibernation (persisted to storage).
- Timer handlers do **not** count against action rate limits.
- A timer can schedule another timer (e.g., recurring countdown).
- Setting a timer with the same name overwrites the previous one.

---

## Room Metadata

Developer-defined metadata that can be queried via HTTP without joining the room. Useful for lobby screens (player count, game mode, etc.).

### Server

```typescript
rooms: {
  'game': {
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
},
```

### Client (HTTP GET, no WebSocket needed)

```typescript
// Via client instance
const meta = await client.getRoomMetadata('game', 'room-123');
console.log(meta.mode, meta.playerCount);

// Via static method
const meta = await RoomClient.getMetadata(baseUrl, 'game', 'room-123');

// Via room instance (before or after joining)
const room = client.room('game', 'room-123');
const meta = await room.getMetadata();
```

### REST API

```
GET /api/room/metadata?namespace={ns}&id={roomId}
```

Returns JSON object. No authentication required — developers control what data is exposed via `room.setMetadata()`.

:::warning Only put public-safe data in metadata
Metadata is accessible without authentication. Never include tokens, emails, or other sensitive data. Only include information you want lobby/matchmaking screens to see.
:::

---

## Full Example

```typescript
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  rooms: {
    'battle': {
      maxPlayers: 10,
      maxStateSize: 512 * 1024,       // 512 KB
      reconnectTimeout: 15000,        // 15 seconds
      rateLimit: {
        actions: 20,
        signals: 80,
        admin: 10,
      },
      stateSaveInterval: 30000,       // Save every 30 seconds
      stateTTL: 7200000,              // 2 hours
      handlers: {
        lifecycle: {
          onCreate(room) {
            room.setSharedState(() => ({
              round: 0,
              phase: 'waiting',
              players: [],
            }));
            room.setServerState(() => ({
              seed: Math.random(),
            }));
            room.setMetadata({ mode: 'battle', playerCount: 0 });
          },

          onJoin(sender, room) {
            if (sender.role === 'banned') {
              throw new Error('You are banned');
            }
            room.setSharedState(s => ({
              ...s,
              players: [...(s.players || []), { id: sender.userId }],
            }));
            room.setPlayerState(sender.userId, () => ({
              hp: 100,
              position: { x: 0, y: 0 },
            }));
            const meta = room.getMetadata();
            room.setMetadata({ ...meta, playerCount: (meta.playerCount as number) + 1 });
          },

          onLeave(sender, room, _ctx, reason) {
            room.setSharedState(s => ({
              ...s,
              players: (s.players || []).filter(p => p.id !== sender.userId),
              lastLeave: { userId: sender.userId, reason },
            }));
            const meta = room.getMetadata();
            room.setMetadata({ ...meta, playerCount: Math.max(0, (meta.playerCount as number) - 1) });
          },

          async onDestroy(room, ctx) {
            const state = room.getSharedState();
            await ctx.admin.db('app').table('game_results').insert({
              round: state.round,
              finalScore: state.score,
            });
          },
        },

        timers: {
          turnEnd: (room) => {
            room.setSharedState(s => ({
              ...s,
              round: (s.round as number) + 1,
              phase: 'waiting',
            }));
            room.sendMessage('turn_ended', { round: room.getSharedState().round });
          },
        },

        actions: {
          ATTACK: (payload, room, sender) => {
            const damage = 10;
            room.setPlayerState(payload.targetId, s => ({
              ...s,
              hp: Math.max(0, (s.hp as number) - damage),
            }));
            // Notify everyone except the attacker
            room.sendMessage('player_attacked', {
              attacker: sender.userId,
              target: payload.targetId,
              damage,
            }, { exclude: [sender.userId] });
            return { damage };
          },

          MOVE: (payload, room, sender) => {
            room.setPlayerState(sender.userId, s => ({
              ...s,
              position: { x: payload.x, y: payload.y },
            }));
            return { moved: true };
          },

          NEXT_ROUND: (_payload, room) => {
            room.setSharedState(s => ({
              ...s,
              round: (s.round as number) + 1,
              phase: 'playing',
            }));
            // Start 30s turn timer
            room.setTimer('turnEnd', 30000);
          },

          async CRITICAL_UPDATE(payload, room) {
            room.setSharedState(s => ({ ...s, ...payload }));
            // Force immediate save for critical data
            await room.saveState();
          },

          KICK_PLAYER: (payload, room, sender) => {
            if (sender.role !== 'admin') throw new Error('Not authorized');
            room.kick(payload.userId);
          },
        },
      },
    },
  },
});
```
