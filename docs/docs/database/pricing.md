---
sidebar_position: 13
---

# Pricing

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

EdgeBase Database uses two storage backends on Cloudflare Edge:

- **Single-instance DB blocks** default to **D1**
- **Dynamic DB blocks** use **Durable Objects + SQLite**

There is still no per-MAU database pricing. You pay only for the Cloudflare infrastructure your block type uses.

## Single-Instance DB Blocks (D1 Default)

| Resource | Included (Workers Paid $5/mo) | Overage |
|----------|-------------------------------|---------|
| D1 row reads | 25B / month | $0.001 / million |
| D1 row writes | 50M / month | $1.00 / million |
| D1 storage | 5 GB-month / month | $0.75 / GB-month |
| Workers requests | 10M / month | $0.30 / million |
| Workers CPU | 30M ms / month | $0.02 / million ms |

For a typical global `app` block, the main bill is usually **Workers requests/CPU**. D1 read allowance is extremely high, so many CRUD-heavy apps stay inside the included D1 row quota.

## Dynamic DB Blocks (Durable Objects + SQLite)

| Resource | Included (Workers Paid $5/mo) | Overage |
|----------|-------------------------------|---------|
| DO requests | 1M / month | $0.15 / million |
| DO duration | 400,000 GB-s / month | $12.50 / million GB-s |
| DO row reads | 25B / month | $0.001 / million |
| DO row writes | 50M / month | $1.00 / million |
| DO SQL stored data | 5 GB-month / month | $0.20 / GB-month |
| Workers requests | 10M / month | $0.30 / million |
| Workers CPU | 30M ms / month | $0.02 / million ms |

Dynamic blocks cost more per hot path because each request hits both the Worker and the target Durable Object, but in return you get physically isolated storage and independent horizontal scaling per user/workspace/tenant.

## Practical Reading

- **Use a single-instance D1-backed block** for global catalogs, posts, settings, leaderboards, and other data that should live in one logical database.
- **Use DO-backed dynamic blocks** when isolation and per-tenant scaling matter more than raw per-request cost.
- You can still force a single-instance block onto Durable Objects with `provider: 'do'`, but D1 is now the default path for that shape.

## Self-Hosting (Docker)

| Provider | Spec | Monthly Cost |
|----------|------|------|
| Hetzner CAX11 | 2 vCPU, 4 GB RAM | ~$4 |
| DigitalOcean Basic | 1 vCPU, 2 GB RAM | ~$6 |
| AWS Lightsail | 1 vCPU, 1 GB RAM | ~$5 |

Self-hosted deployments have no per-request or per-storage charges beyond the VPS cost.

## Why So Cheap?

EdgeBase eliminates the traditional database server:

- **No connection pooling** — each DB block is still just SQLite, not a separate managed server
- **Cheap single-instance storage** — D1 covers global app data without a dedicated database VM
- **Scale-out isolation** — dynamic blocks distribute hot tenants across many Durable Objects
- **No per-MAU pricing** — unlike Firebase, there is no user-count billing

:::info Account-level pricing
The $5/mo Workers Paid plan is **per account, not per project**. One subscription covers all Workers, D1 databases, Durable Objects, R2 buckets, and KV namespaces on your account. Run as many EdgeBase projects as you want — you only pay $5 base + usage overage.
:::

:::info Pricing source
Prices reflect Cloudflare's published rates as of February 2026. Verify against the [Cloudflare pricing page](https://developers.cloudflare.com/workers/platform/pricing/) before making decisions.
:::
