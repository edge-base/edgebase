---
sidebar_position: 2
sidebar_label: Analytics
---

# Analytics Dashboard

EdgeBase includes a built-in Analytics Dashboard that provides real-time insights into your API traffic, authentication patterns, database usage, storage operations, and function execution.

## Overview

Navigate to **Analytics** in the sidebar or open `/admin/analytics` to see:

- **Total Requests** — aggregate API call volume
- **Unique Users** — distinct authenticated users
- **5xx Rate** — percentage of server-side 5xx responses
- **Average Latency** — mean response time in milliseconds
- **Requests over time** — time series chart
- **Category distribution** — breakdown by feature area (auth, db, storage, etc.)
- **Top endpoints** — most frequently called API paths
- **Exclude admin traffic** — optional toggle to hide dashboard-generated requests from the analytics page

The dashboard home at `/admin` shows a smaller traffic summary card and chart. That overview auto-selects `1H`, `6H`, or `24H` based on the amount of history available, while the full analytics page keeps the full range picker.

## Dashboard Pages

| Page | Path | What it shows |
|------|------|---------------|
| **Overview** | `/admin/analytics` | Global API traffic metrics |
| **Auth** | `/admin/analytics/auth` | Signup/signin rates, OAuth provider distribution |
| **Database** | `/admin/analytics/database` | CRUD operation ratios, table-level usage |
| **Storage** | `/admin/analytics/storage` | Upload/download rates, bucket usage |
| **Functions** | `/admin/analytics/functions` | Per-function invocation count, duration, errors |

## Time Ranges

Use the range selector at the top-right to view data for different time windows:

- **1H** — last hour (minute-level granularity)
- **6H** — last 6 hours (10-minute granularity)
- **24H** — last 24 hours (hourly granularity, default)
- **7D** — last 7 days (daily granularity)
- **30D** — last 30 days (daily granularity)
- **Custom** — explicit start/end timestamps

Auto-refresh is enabled by default (30-second interval). Toggle it with the refresh button.

## How It Works

EdgeBase automatically collects analytics data from every API request. The storage backend depends on your environment:

### Cloud (Cloudflare Workers)

Uses **Cloudflare Analytics Engine** — a ClickHouse-backed analytics service that:

- Writes data points on every request (fire-and-forget, non-blocking)
- Uses statistical sampling at high volumes (`_sample_interval` for accurate totals)
- Retains data for 90 days
- Costs effectively nothing for most projects (10M writes/month included in $5 Workers Paid plan)

**Required environment variables** for the dashboard to query Analytics Engine:

```
CF_ACCOUNT_ID=your-cloudflare-account-id
CF_API_TOKEN=your-api-token-with-analytics-read
```

### Docker / Self-Hosted

Uses **LogsDO** — a dedicated Durable Object with SQLite storage:

- Exact per-request data (no sampling)
- 3-tier pre-aggregation for fast dashboard queries:
  - Raw logs: 24-hour retention (real-time dashboard)
  - Hourly aggregates: 90-day retention (trend charts)
  - Daily aggregates: permanent retention (long-term statistics)
- Alarm-based hourly aggregation runs automatically
- WAL mode for high write throughput (~70K writes/sec)

### Local Development

Standard `edgebase dev` includes a local `LOGS` Durable Object binding, so analytics pages can show data locally after requests accumulate. If you run a custom local worker without a `LOGS` binding, the dashboard falls back to an empty state.

## Data Collected

Each request logs the following fields:

| Field | Description | Example |
|-------|-------------|---------|
| `method` | HTTP method | `GET`, `POST` |
| `path` | URL path | `/api/db/shared/tables/posts` |
| `status` | HTTP status code | `200`, `404`, `500` |
| `duration` | Response time (ms) | `42` |
| `userId` | Authenticated user ID | `usr_abc123` |
| `category` | Feature area | `auth`, `db`, `storage`, `function` |
| `subcategory` | Sub-action | `signup`, `upload`, `connect` |
| `target1` | Primary target | namespace, bucket, function name |
| `target2` | Secondary target | table name, provider |
| `operation` | CRUD operation | `getOne`, `insert`, `delete` |
| `region` | Edge location | `ICN`, `LAX`, `FRA` |
| `requestSize` | Request body size | `1024` |
| `responseSize` | Response body size | `4096` |

## Pricing

### Analytics Engine (Cloud)

| Tier | Writes | Reads | Cost |
|------|--------|-------|------|
| Free | 100K/day | 10K/day | $0 |
| Workers Paid | 10M/month | 1M/month | $5/month (plan) |
| Overage | — | — | $0.25/1M writes, $1/1M reads |

For most projects, the Workers Paid plan covers all analytics needs.

### Self-Hosted

No additional cost — uses SQLite within the existing Durable Object.
