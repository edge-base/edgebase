---
sidebar_position: 4
---

# Database Subscriptions API

WebSocket-based real-time database change notifications with server-side filtering.

---

## Connection

Use the optional HTTP preflight first when you want a lightweight readiness check before opening a WebSocket:

### `GET /api/db/connect-check`

You can pass either a full `channel` or structured database target parameters:

| Query Parameter | Type | Required | Description |
|---|---|---|---|
| `channel` | string | No | Legacy full channel name such as `dblive:shared:posts` |
| `namespace` | string | Conditionally | Database namespace when not using `channel` |
| `table` | string | Conditionally | Table name when not using `channel` |
| `instanceId` | string | No | Dynamic database instance ID |
| `docId` | string | No | Optional document-specific subscription target |

Example:

```bash
curl "https://your-project.edgebase.fun/api/db/connect-check?namespace=shared&table=posts"
```

Successful response:

```json
{
  "ok": true,
  "type": "db_connect_ready",
  "category": "ready",
  "message": "Database live subscription preflight passed",
  "channel": "dblive:shared:posts",
  "pendingCount": 0,
  "maxPending": 5
}
```

Open the WebSocket by passing either the same structured parameters or a legacy `channel`:

```
wss://your-project.edgebase.fun/api/db/subscribe?namespace=shared&table=posts
```

Legacy form:

```
wss://your-project.edgebase.fun/api/db/subscribe?channel=dblive:shared:posts
```

---

## Authentication

After establishing the WebSocket connection, send an authentication message as the first message:

```json
{ "type": "auth", "token": "<accessToken>" }
```

On success, the server responds with:

```json
{ "type": "auth_success", "userId": "user_123" }
```

If the token is refreshed during the connection lifetime, the server sends:

```json
{ "type": "auth_refreshed", "userId": "user_123" }
```

On authentication failure:

```json
{ "type": "auth_error", "message": "Invalid or expired token" }
```

---

## Client to Server Messages

### Subscribe

Subscribe to a channel to begin receiving database change events.

```json
{ "type": "subscribe", "channel": "dblive:app:posts" }
```

### Unsubscribe

Stop receiving events from a channel.

```json
{ "type": "unsubscribe", "channel": "dblive:app:posts" }
```

### Subscribe with Filters

Subscribe to a channel with optional server-side filters.

```json
{
  "type": "subscribe",
  "channel": "dblive:app:posts",
  "filters": [
    ["status", "==", "published"],
    ["authorId", "==", "user-123"]
  ],
  "orFilters": [
    ["category", "==", "news"],
    ["category", "==", "tech"]
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `channel` | string | Yes | Channel to subscribe to |
| `filters` | array | No | AND conditions — all must match |
| `orFilters` | array | No | OR conditions — any one match is sufficient |

Filter tuple format: `[field, operator, value]`. Max 5 conditions per filter array.

### Update Filters

Update filter conditions on an existing subscription without resubscribing.

```json
{
  "type": "update_filters",
  "channel": "dblive:app:posts",
  "filters": [["status", "==", "draft"]],
  "orFilters": null
}
```

Server responds with:

```json
{
  "type": "filters_updated",
  "channel": "dblive:app:posts",
  "serverFilter": true
}
```

Set `filters` or `orFilters` to `null` to clear that filter type.

### Ping

Send a keepalive ping to the server. Recommended ping interval: **30 seconds**.

```json
{ "type": "ping" }
```

The server responds with a `pong` message.

---

## Server to Client Messages

### `pong`

Response to a client `ping` message.

```json
{ "type": "pong" }
```

### `auth_success`

Authentication succeeded.

```json
{ "type": "auth_success", "userId": "user_123" }
```

### `auth_refreshed`

Token was refreshed during the connection. When a client's auth token is refreshed on a long-lived WebSocket connection, the server re-evaluates channel access and includes any channels the client lost access to.

```json
{
  "type": "auth_refreshed",
  "userId": "user_123",
  "revokedChannels": ["db:private-table"]
}
```

| Field | Type | Description |
|---|---|---|
| `userId` | string | The authenticated user ID |
| `revokedChannels` | string[] | List of channels the client lost access to after token refresh. Empty array if no channels were revoked. |

- The client should handle this by removing subscriptions for revoked channels
- This occurs when user roles/permissions change while connected
- If the refresh fails, the server responds with an `error` instead and preserves the existing auth

### `auth_error`

Authentication failed.

```json
{ "type": "auth_error", "message": "Invalid or expired token" }
```

### `subscribed`

Successfully subscribed to a channel.

```json
{ "type": "subscribed", "channel": "dblive:app:posts", "serverFilter": false }
```

| Field | Type | Description |
|---|---|---|
| `channel` | string | The subscribed channel name |
| `serverFilter` | boolean | Whether server-side filtering is active for this subscription |

### `db_change`

A database change event on a subscribed table.

```json
{
  "type": "db_change",
  "table": "posts",
  "changeType": "added",
  "docId": "01J...",
  "data": {
    "id": "01J...",
    "title": "New Post",
    "createdAt": "2026-01-01T00:00:00.000Z"
  },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

| Field | Type | Description |
|---|---|---|
| `table` | string | Table name where the change occurred |
| `changeType` | string | One of `added`, `modified`, or `removed` |
| `docId` | string | The document ID that changed |
| `data` | object \| null | The full document data (for `added`/`modified`) or `null` (for `removed`) |
| `timestamp` | string | ISO 8601 timestamp of the change |

### `batch_changes`

Multiple changes delivered as a batch.

```json
{
  "type": "batch_changes",
  "channel": "dblive:app:posts",
  "changes": [
    { "table": "posts", "changeType": "added", "docId": "01J...", "data": { "..." : "..." }, "timestamp": "..." },
    { "table": "posts", "changeType": "modified", "docId": "01K...", "data": { "..." : "..." }, "timestamp": "..." }
  ],
  "total": 2
}
```

| Field | Type | Description |
|---|---|---|
| `channel` | string | The channel for these changes |
| `changes` | array | Array of `db_change` objects |
| `total` | number | Total number of changes in the batch |

### `error`

An error occurred.

```json
{ "type": "error", "code": "AUTH_FAILED", "message": "Invalid or expired token" }
```

| Field | Type | Description |
|---|---|---|
| `code` | string | Machine-readable error code |
| `message` | string | Human-readable error description |

---

## Channel Patterns

| Pattern | Description |
|---|---|
| `dblive:{namespace}:{tableName}` | Subscribe to all changes on a table (e.g., `dblive:app:posts`) |
| `dblive:{namespace}:{tableName}:{docId}` | Subscribe to changes on a single document in a static namespace |
| `dblive:{namespace}:{instanceId}:{tableName}` | Subscribe to a dynamic DB block table |
| `dblive:{namespace}:{instanceId}:{tableName}:{docId}` | Subscribe to a single document inside a dynamic DB block |

### Examples

```
dblive:app:posts                   # All changes on the "posts" table in app namespace
dblive:app:posts:01J...            # Single document in the app namespace
dblive:workspace:ws-123:documents        # Dynamic DB block table subscription
dblive:workspace:ws-123:documents:doc-9  # Dynamic DB block single-document subscription
```

---

## Server-Side Broadcast

`POST /api/db/broadcast`

Send a broadcast message from the server to all subscribers on a database subscription channel. This is a REST endpoint, not a WebSocket message.

**Auth**: Service Key required (`X-EdgeBase-Service-Key` header)

| Request Body | Type | Required | Description |
|---|---|---|---|
| `channel` | string | Yes | Target database subscription channel |
| `event` | string | Yes | Event name |
| `payload` | object | Yes | Data to broadcast |

```json
{
  "channel": "dblive:app:posts",
  "event": "refresh",
  "payload": { "reason": "bulk-import-complete" }
}
```

**Response** `200`

```json
{ "ok": true }
```

| Error | Status | Description |
|---|---|---|
| Missing Service Key | `403` | `X-EdgeBase-Service-Key` header not provided |
| Invalid Service Key | `401` | Service Key does not match |
