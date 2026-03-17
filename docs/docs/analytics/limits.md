---
sidebar_position: 3
---

# Limits

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Technical limits for EdgeBase Analytics.

## Custom Events

| Limit | Value | Notes |
|-------|-------|-------|
| Max events per request | **100** | Single `POST /api/analytics/track` call |
| Max properties per event | **50** keys | Flat key-value only (no nested objects) |
| Max properties size | **4,096 bytes** | JSON-serialized total |
| Property value types | `string`, `number`, `boolean` | Arrays and objects not supported |
| Event name | Non-empty string | Required for every event |

## Data Retention

| Data | Raw Retention | Rollup |
|------|--------------|--------|
| Custom events (`_events`) | **90 days** | Aggregated into daily summaries after 90 days |
| Daily summaries (`_events_daily`) | **Indefinite** | Event count + unique users per day |
| Request logs (`_logs`) | **90 days** | Aggregated into daily summaries after 90 days |

## Query Limits

| Parameter | Range | Default |
|-----------|-------|---------|
| `range` | `1h`, `6h`, `24h`, `7d`, `30d`, `90d` | `24h` |
| `limit` (list metric) | 1–1000 | 50 |
| `groupBy` | `minute`, `hour`, `day` | `hour` |

## Rate Limiting

| Group | Default | Key | Notes |
|-------|---------|-----|-------|
| `events` | **100 req / 60s** | IP | Applies to `POST /api/analytics/track` |
| `global` | **10,000,000 req / 60s** | IP | Applies to all other analytics endpoints |

The `events` rate limit protects the event ingestion endpoint from abuse, especially for anonymous (unauthenticated) callers.

## Authentication

| Endpoint | Auth Required |
|----------|--------------|
| `POST /api/analytics/track` | Optional — JWT, Service Key, or anonymous |
| `GET /api/analytics/query` | Service Key |
| `GET /api/analytics/events` | Service Key |

Those Service Key-protected analytics queries are available across all Admin SDKs.

## Storage

| Environment | Request Logs | Custom Events |
|-------------|-------------|---------------|
| Cloud (Cloudflare) | Analytics Engine + LogsDO | LogsDO (SQLite) |
| Docker / Self-hosted | LogsDO (SQLite) | LogsDO (SQLite) |

All custom events are stored in LogsDO regardless of environment. Request logs use Analytics Engine on Cloud for higher-performance aggregation queries.
