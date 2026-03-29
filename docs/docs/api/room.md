---
sidebar_position: 5
---

# Room API

WebSocket-based state synchronisation (v2 protocol). Rooms use in-memory state for fast reads/writes with periodic Durable Object Storage persistence for hibernation recovery. When all players disconnect, the room hibernates to zero cost and restores state on reconnect. Suitable for game lobbies, collaborative editors, and live dashboards.

---

## Connection

```
wss://your-project.edgebase.fun/api/room?namespace=game&id=lobby-1
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Room namespace (e.g. `game`, `chat`) |
| `id` | string | Yes | Room instance ID within the namespace |

### `GET /api/room/connect-check`

Use the room preflight endpoint when you want to validate namespace/runtime configuration before attempting a WebSocket upgrade:

```bash
curl "https://your-project.edgebase.fun/api/room/connect-check?namespace=game&id=lobby-1"
```

Successful response:

```json
{
  "ok": true,
  "type": "room_connect_ready",
  "category": "ready",
  "message": "Room WebSocket preflight passed",
  "namespace": "game",
  "roomId": "lobby-1",
  "runtime": "rooms",
  "pendingCount": 0,
  "maxPending": 5
}
```

### `GET /api/room/summary`

Use the room summary endpoint when you want lobby-card data before join, including public metadata and live occupancy:

```bash
curl "https://your-project.edgebase.fun/api/room/summary?namespace=game&id=lobby-1"
```

Successful response:

```json
{
  "namespace": "game",
  "roomId": "lobby-1",
  "metadata": {
    "mode": "classic",
    "title": "Beginner Lobby"
  },
  "occupancy": {
    "activeMembers": 3,
    "activeConnections": 4
  },
  "updatedAt": "2026-03-27T00:00:00.000Z"
}
```

`/api/room/summary` follows the same public metadata access gate as `/api/room/metadata`. If metadata is not public for the room namespace, the summary endpoint also requires auth/authorization.

### `POST /api/room/summaries`

Use the batch summary endpoint when you want lobby-card data for multiple rooms in one request:

```bash
curl "https://your-project.edgebase.fun/api/room/summaries" \
  -H "Content-Type: application/json" \
  -d '{"namespace":"game","ids":["lobby-1","lobby-2"]}'
```

Successful response:

```json
{
  "namespace": "game",
  "items": [
    {
      "namespace": "game",
      "roomId": "lobby-1",
      "metadata": {
        "mode": "classic",
        "title": "Beginner Lobby"
      },
      "occupancy": {
        "activeMembers": 3,
        "activeConnections": 4
      },
      "updatedAt": "2026-03-27T00:00:00.000Z"
    }
  ],
  "deniedIds": [
    "lobby-2"
  ],
  "updatedAt": "2026-03-27T00:00:00.000Z"
}
```

`deniedIds` contains room IDs that failed the same metadata access gate used by `/api/room/summary`.

---

## Authentication

Send an `auth` message as the first WebSocket message:

```json
{ "type": "auth", "token": "<accessToken>" }
```

On success:

```json
{ "type": "auth_success", "userId": "user_123", "connectionId": "conn_abc" }
```

On re-authentication (token refresh during connection):

```json
{ "type": "auth_refreshed", "userId": "user_123", "connectionId": "conn_abc" }
```

On failure:

```json
{ "type": "error", "code": "AUTH_FAILED", "message": "Invalid or expired token" }
```

Authentication must be completed within 5 seconds (default) or the connection is closed with `AUTH_TIMEOUT`.

---

## Client to Server Messages

### `auth`

Authenticate the connection.

```json
{ "type": "auth", "token": "<accessToken>" }
```

### `join`

Join the room after authentication. Supports state recovery via last known versions.

```json
{ "type": "join" }
```

With state recovery (reconnect/eviction recovery):

```json
{
  "type": "join",
  "lastSharedState": { "score": 10 },
  "lastSharedVersion": 5,
  "lastPlayerState": { "inventory": [] },
  "lastPlayerVersion": 3
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `lastSharedState` | object | No | Last known shared state for recovery |
| `lastSharedVersion` | number | No | Last known shared state version |
| `lastPlayerState` | object | No | Last known player state for recovery |
| `lastPlayerVersion` | number | No | Last known player state version |

### `send`

Send an action to the server-side `onAction` handler. The server responds with `action_result` or `action_error` matched by `requestId`.

```json
{
  "type": "send",
  "actionType": "MOVE",
  "payload": { "x": 10, "y": 20 },
  "requestId": "req-abc123"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `actionType` | string | Yes | The action type to execute |
| `payload` | any | No | Action payload (defaults to `{}`) |
| `requestId` | string | Yes | Unique ID for matching the response |

### `ping`

Keep-alive heartbeat. Server responds with `pong`.

```json
{ "type": "ping" }
```

---

## Server to Client Messages

### `auth_success`

First successful authentication.

```json
{ "type": "auth_success", "userId": "user_123", "connectionId": "conn_abc" }
```

### `auth_refreshed`

Successful re-authentication (token refresh).

```json
{ "type": "auth_refreshed", "userId": "user_123", "connectionId": "conn_abc" }
```

### `sync`

Full state snapshot. Sent on join or after hibernation recovery. Contains both shared and player state.

```json
{
  "type": "sync",
  "sharedState": { "round": 1, "phase": "lobby" },
  "sharedVersion": 1,
  "playerState": { "inventory": ["sword"] },
  "playerVersion": 1
}
```

| Field | Type | Description |
|---|---|---|
| `sharedState` | object | Complete shared state visible to all players |
| `sharedVersion` | number | Shared state version |
| `playerState` | object | This player's private state |
| `playerVersion` | number | Player state version |

### `shared_delta`

Incremental shared state change using dot-path keys.

```json
{
  "type": "shared_delta",
  "delta": { "player.position.x": 10 },
  "version": 2
}
```

| Field | Type | Description |
|---|---|---|
| `delta` | object | Changed dot-path keys and their new values (null = delete) |
| `version` | number | New shared state version |

### `player_delta`

Incremental player state change using dot-path keys.

```json
{
  "type": "player_delta",
  "delta": { "inventory.0": "shield" },
  "version": 2
}
```

| Field | Type | Description |
|---|---|---|
| `delta` | object | Changed dot-path keys and their new values (null = delete) |
| `version` | number | New player state version |

### `action_result`

Successful action execution result. Sent only to the client that sent the action, matched by `requestId`.

```json
{
  "type": "action_result",
  "requestId": "req-abc123",
  "result": { "newPosition": { "x": 5, "y": 3 } }
}
```

### `action_error`

Action execution failed. Sent only to the client that sent the action, matched by `requestId`.

```json
{
  "type": "action_error",
  "requestId": "req-abc123",
  "message": "Invalid move"
}
```

### `message`

Server-sent message (sent by `room.sendMessage()` or `room.sendMessageTo()` in server-side code).

```json
{
  "type": "message",
  "messageType": "game_over",
  "data": { "winner": "user_1" }
}
```

### `kicked`

This client was kicked from the room by server-side code.

```json
{ "type": "kicked" }
```

### `error`

Error notification.

```json
{ "type": "error", "code": "RATE_LIMITED", "message": "Too many messages" }
```

### `pong`

Response to `ping`.

---

## Error Codes

| Code | Description |
|---|---|
| `AUTH_FAILED` | Authentication failed or token invalid |
| `AUTH_REFRESH_FAILED` | Re-authentication failed; existing auth preserved |
| `AUTH_TIMEOUT` | Auth message not received within timeout |
| `INVALID_JSON` | Message not valid JSON (closes connection with 4000) |
| `NOT_AUTHENTICATED` | Operation requires auth (closes connection with 4000) |
| `RATE_LIMITED` | Too many messages (default: 10 msg/s) |
| `INVALID_ACTION` | send message missing actionType |
| `NO_HANDLER` | No onAction handler registered for this action type |
| `UNAUTHENTICATED` | Action requires authenticated userId |
| `JOIN_DENIED` | Join rule evaluation failed |
| `ROOM_FULL` | Room at maxPlayers capacity (HTTP 403) |

---

## Limits

| Limit | Default |
|---|---|
| Max players per room | 100 |
| Max state size | 1 MB (configurable up to 10 MB) |
| Max message rate | 10 msg/s per connection |
| Max dot-path depth | 5 levels |
| `onAction` timeout | 5 seconds |
| Auth timeout | 5 seconds |
| Send timeout (client) | 10 seconds |
| Pending connections per IP | 5 |
| Delta batch interval | 50ms |
| Hibernation idle timeout | 300 seconds |
| State save interval | 60 seconds |
| State TTL | 24 hours |

---

## Metadata HTTP Endpoint

### `GET /api/room/metadata?namespace={ns}&id={roomId}`

Retrieve room metadata without joining the room or establishing a WebSocket connection. Metadata is set server-side via `room.setMetadata()` and persisted to Durable Object storage.

| Query Parameter | Type   | Required | Description                        |
|-----------------|--------|----------|------------------------------------|
| `namespace`     | string | Yes      | Room namespace (e.g. `game`)       |
| `id`            | string | Yes      | Room instance ID within the namespace |

```bash
curl "https://your-project.edgebase.fun/api/room/metadata?namespace=game&id=lobby-1"
```

**Response** `200`

```json
{
  "mode": "classic",
  "playerCount": 5
}
```

Returns an empty object `{}` if no metadata has been set for the room.

:::warning Authentication depends on configuration
In **release mode**, the metadata endpoint requires either an `access.metadata` rule or `public.metadata: true` in the room namespace configuration. Without one of these, the endpoint returns `403`. In **development mode**, metadata is allowed by default (with a console warning).

Developers control what data is exposed by choosing what to pass to `room.setMetadata()` in their server-side hooks. Only include publicly safe information — never store tokens, emails, or other sensitive data in metadata.
:::

This endpoint is useful for lobby screens, matchmaking UIs, or any scenario where you need to query room information without opening a WebSocket connection.

---
