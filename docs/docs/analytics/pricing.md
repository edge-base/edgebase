---
sidebar_position: 4
---

# Pricing

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

EdgeBase Analytics runs entirely on Durable Objects (LogsDO) and optionally Analytics Engine — both included in standard Cloudflare Workers pricing. There are no additional per-event charges. Free plan covers smaller workloads; Workers Paid raises the included monthly usage.

## Edge (Cloudflare)

| Resource | Used For | Cost |
|----------|----------|------|
| Durable Objects requests | Event writes + queries | $0.15 / million (included in first 1M) |
| Durable Objects storage | Event data (SQLite) | $0.20 / GB-month (first 1 GB included) |
| Analytics Engine | Request log metrics (optional) | Free tier available; Workers Paid includes 10M writes/month |
| Workers requests | API endpoint handling | $0.30 / million (10M/mo included) |

### Example: 100K Events/Day

| Resource | Usage | Cost |
|----------|-------|------|
| DO requests | ~6M / month (writes + queries) | $0.75 |
| DO storage | ~500 MB (90 days raw + rollups) | $0 (included) |
| Analytics Engine | ~3M data points / month | $0 (included) |
| Workers requests | ~6M / month | $0 (included) |
| **Total** | | **~$0.75/mo** |

### Example: 1M Events/Day

| Resource | Usage | Cost |
|----------|-------|------|
| DO requests | ~60M / month | $8.85 |
| DO storage | ~5 GB | $0.80 |
| Workers requests | ~60M / month | $15.00 |
| **Total** | | **~$25/mo** |

## Self-Hosting

On Docker, LogsDO runs as an in-process SQLite database. There are no external service charges — analytics storage is part of your server's local disk.

:::info Pricing source
Durable Objects, Workers, and Analytics Engine pricing reflects Cloudflare's published rates as of February 2026. Analytics Engine includes both a Free tier and higher Workers Paid limits.
:::
