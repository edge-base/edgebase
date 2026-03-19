---
sidebar_position: 9
---

# Pricing

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

App Functions run inside the same Cloudflare Worker as the rest of EdgeBase. There is no separate Functions billing — it's included in Workers compute.

## Edge (Cloudflare)

| Resource | Included (Workers Paid $5/mo) | Overage |
|----------|-------------------------------|---------|
| Workers requests | 10M / month | $0.30 / million |
| Workers CPU time | 30M ms / month | $0.02 / million ms |
| DO requests (if accessing DB) | 1M / month | $0.15 / million |

### Example: 1M Function Calls/Month

| Resource | Usage | Cost |
|----------|-------|------|
| Workers requests | 1M | $0 (included) |
| CPU time | ~5M ms | $0 (included) |
| DO requests (DB access) | ~2M | $0.15 |
| **Total** | | **~$0.15/mo** |

## Comparison

| Feature | Firebase Functions | Supabase Edge Functions | EdgeBase App Functions |
|---------|-------------------|------------------------|----------------------|
| Cold start | ~100-500ms | ~200ms | **~0ms** (same Worker) |
| Invocations | $0.40/M (2M free) | $2/M (500K free) | **$0.30/M** (10M free) |
| CPU time | $0.0000025/GHz-s | Included | **$0.02/M ms** (30M free) |
| Memory | 256 MB default | 150 MB | **128 MB** (Worker limit) |

EdgeBase Functions have near-zero cold start because they run inside the same Worker process — there is no separate function container to spin up.

## Database Triggers & Authentication Triggers

Database triggers and authentication triggers are regular App Functions. They share the same Workers compute budget with no additional cost. Since they execute via `ctx.waitUntil()`, they don't add latency to the triggering API response.

## Self-Hosting

On Docker, all App Functions run in the same Node.js process. No per-invocation or CPU charges apply.

:::info Pricing source
Prices reflect Cloudflare's published Workers rates as of February 2026.
:::
