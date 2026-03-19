---
slug: /server/native-resources/d1/limits-pricing
---

# D1 Limits & Pricing

D1 is billed by rows read, rows written, and total account storage. Included storage is account-wide, while maximum database size is a separate per-database limit.

## Included Usage

| Metric | Free Plan | Workers Paid |
|--------|-----------|--------------|
| Rows read | 5M / day | 25B / month included, then $0.001 / million |
| Rows written | 100K / day | 50M / month included, then $1.00 / million |
| Storage | 5 GB total / account | First 5 GB included / account, then $0.75 / GB-month |

## Limits That Matter

| Limit | Free Plan | Workers Paid |
|-------|-----------|--------------|
| Maximum database size | 500 MB / database | 10 GB / database |
| Queries per Worker invocation | 50 | 1,000 |
| Simultaneous open connections per Worker invocation | 6 | 6 |
| Maximum columns per table | 100 | 100 |
| Maximum row or `BLOB` size | 2 MB | 2 MB |
| Maximum SQL statement length | 100 KB | 100 KB |

## Consistency and Read Replication

- D1 queries continue to run on the primary database unless you explicitly use the Sessions API.
- Read replication is opt-in. When enabled, Sessions API provides sequential consistency within a session.
- `withSession()` defaults to `first-unconstrained`, so use `first-primary` when the first query must start from the freshest primary state.

:::info Sources
Pricing and limits follow Cloudflare's official [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/), and [D1 Worker API](https://developers.cloudflare.com/d1/worker-api/d1-database/) docs.
:::
