---
sidebar_position: 7
---

# Analytics API

Request log metrics and custom event tracking.

EdgeBase Analytics provides automatic request log metrics and custom event tracking. The query and events endpoints require a Service Key, while the track endpoint supports JWT, Service Key, and anonymous access.

---

## Query Request Log Metrics

`GET /api/analytics/query`

**Auth**: Service Key required (`X-EdgeBase-Service-Key` header)

Query automatic API usage metrics (same data shown in the Admin Dashboard).

`totalErrors`, `errors`, and `errorRate` count only server-side `5xx` responses. Client-side `4xx` responses are excluded from these metrics.

| Query Parameter | Type | Default | Description |
|---|---|---|---|
| `range` | string | `"24h"` | `"1h"`, `"6h"`, `"24h"`, `"7d"`, `"30d"`, `"90d"` |
| `metric` | string | `"overview"` | `"overview"`, `"timeSeries"`, `"breakdown"`, `"topEndpoints"` |
| `category` | string | — | Filter by route category. Common values include `"auth"`, `"db"`, `"storage"`, `"databaseLive"`, `"room"`, `"push"`, `"function"`, `"kv"`, `"sql"`, `"d1"`, `"vectorize"`, `"admin"`, `"config"`, and `"health"` |
| `groupBy` | string | `"hour"` | `"minute"`, `"tenMinute"`, `"hour"`, `"day"` |
| `start` | string | — | Custom ISO start time (e.g. `"2026-03-01T00:00:00Z"`). When both `start` and `end` are set, overrides `range`. |
| `end` | string | — | Custom ISO end time (e.g. `"2026-03-02T00:00:00Z"`) |
| `excludeCategory` | string | — | Exclude a category from the result set (e.g. `"admin"` to hide dashboard traffic) |

```bash
curl -H "X-EdgeBase-Service-Key: YOUR_SERVICE_KEY" \
  "https://my-app.edgebase.fun/api/analytics/query?range=7d&metric=overview"
```

**Response** `200` (metric=overview)

```json
{
  "timeSeries": [
    { "timestamp": 1709337600000, "requests": 145, "errors": 2, "avgLatency": 23.5, "uniqueUsers": 42 }
  ],
  "summary": {
    "totalRequests": 12450,
    "totalErrors": 34,
    "avgLatency": 18.7,
    "uniqueUsers": 342
  },
  "breakdown": [
    { "label": "db", "count": 8200, "percentage": 65.8, "avgLatency": 15.2, "errorRate": 0.01 }
  ],
  "topItems": [
    { "label": "GET /api/db/shared/posts", "count": 4500, "avgLatency": 12.3, "errorRate": 0.02 }
  ]
}
```

| Error | Status | Description |
|---|---|---|
| Missing Service Key | `403` | `X-EdgeBase-Service-Key` header not provided |
| Invalid Service Key | `401` | Service Key does not match |

---

## Track Custom Events

`POST /api/analytics/track`

**Auth**: JWT Bearer Token, Service Key, or anonymous (rate-limited)

Ingest custom events. Supports batch sending (up to 100 events per request).

| Request Body | Type | Required | Description |
|---|---|---|---|
| `events` | array | Yes | Array of event objects (1–100) |
| `events[].name` | string | Yes | Event name |
| `events[].properties` | object | No | Key-value data (max 50 keys, 4 KB) |
| `events[].timestamp` | number | No | Unix timestamp in ms (default: now) |
| `events[].userId` | string | No | User ID (Service Key only — ignored with JWT) |

```json
{
  "events": [
    {
      "name": "purchase",
      "properties": { "plan": "pro", "amount": 29.99 },
      "userId": "user_123"
    },
    {
      "name": "page_view",
      "properties": { "path": "/pricing" }
    }
  ]
}
```

**Response** `200`

```json
{
  "ok": true,
  "count": 2
}
```

### Authentication Behavior

| Auth Method | userId Resolution |
|---|---|
| JWT (`Authorization: Bearer`) | Automatically set to `auth.id` from token |
| Service Key | Uses `userId` from request body (if provided) |
| Anonymous | `null` — rate limited to 100 req/60s per IP |

| Error | Status | Description |
|---|---|---|
| Empty or missing events array | `400` | `events` must be a non-empty array |
| Over 100 events | `400` | Maximum 100 events per request |
| Missing event name | `400` | Each event must have a `name` string |
| Invalid properties | `400` | Properties must be a plain object (not array) |
| Over 50 property keys | `400` | Maximum 50 keys per event |
| Invalid JSON | `400` | Request body is not valid JSON |

---

## Query Custom Events

`GET /api/analytics/events`

**Auth**: Service Key required (`X-EdgeBase-Service-Key` header)

Query custom events with flexible filtering and aggregation.

| Query Parameter | Type | Default | Description |
|---|---|---|---|
| `metric` | string | `"list"` | `"list"`, `"count"`, `"timeSeries"`, `"topEvents"` |
| `range` | string | `"24h"` | `"1h"`, `"6h"`, `"24h"`, `"7d"`, `"30d"`, `"90d"` |
| `event` | string | — | Filter by event name |
| `userId` | string | — | Filter by user ID |
| `groupBy` | string | `"hour"` | For timeSeries: `"minute"`, `"tenMinute"`, `"hour"`, `"day"` |
| `limit` | number | `50` | Max results per page (for list) |
| `cursor` | string | — | Pagination cursor |

### metric=list

```bash
curl -H "X-EdgeBase-Service-Key: YOUR_SERVICE_KEY" \
  "https://my-app.edgebase.fun/api/analytics/events?metric=list&event=purchase&range=7d"
```

```json
{
  "events": [
    {
      "id": 42,
      "timestamp": 1709337600000,
      "userId": "user_123",
      "eventName": "purchase",
      "properties": { "plan": "pro", "amount": 29.99 }
    }
  ],
  "cursor": "eyJpZCI6NDJ9",
  "hasMore": true
}
```

### metric=count

```json
{
  "totalEvents": 1234,
  "uniqueUsers": 567
}
```

### metric=timeSeries

```json
{
  "timeSeries": [
    { "timestamp": 1709337600000, "count": 45 },
    { "timestamp": 1709341200000, "count": 62 }
  ]
}
```

### metric=topEvents

```json
{
  "topEvents": [
    { "eventName": "page_view", "count": 8500, "uniqueUsers": 1200 },
    { "eventName": "button_click", "count": 3200, "uniqueUsers": 890 }
  ]
}
```

| Error | Status | Description |
|---|---|---|
| Missing Service Key | `403` | `X-EdgeBase-Service-Key` header not provided |
| Invalid Service Key | `401` | Service Key does not match |
