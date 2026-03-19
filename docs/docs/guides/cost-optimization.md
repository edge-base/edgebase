---
sidebar_position: 6
---

# Cost Optimization

Minimize costs when running EdgeBase on Cloudflare.

## Cloudflare Pricing Overview

| Resource | Free Tier | Paid Plan |
|----------|-----------|-----------|
| Workers Requests | 100K/day | 10M/month included |
| DO Requests | 100K/day | 1M/month included |
| DO Storage | 5 GB total | 5 GB included |
| R2 Storage | 10GB | 10GB + $0.015/GB |
| R2 Operations | 1M reads/month | 10M + $0.36/M |
| R2 Egress | **$0** | **$0** |
| KV Reads | 100K/day | 10M/month |

## Cost Strategies

### 1. Use `DB block` for Multi-Tenancy

Isolating by user or workspace distributes data across Durable Objects, keeping each DO small:

```typescript
tables: {
  notes: {
    user:{id} DB block,  // Each user = own DO
  },
}
```

✅ Benefits: Small SQLite databases, fast queries, natural data isolation
⚠️ Tradeoff: Cross-user queries require aggregation patterns

### 2. Minimize DO Billing Duration

Durable Objects charge per GB-second while a DO has an active request. EdgeBase uses `context.waitUntil()` for background work to return responses fast, minimizing billing duration.

### 3. Rate Limiting at Zero Cost

HTTP rate limiting uses a 2-layer approach: a per-isolate software counter (primary) and a Cloudflare Rate Limiting Binding (safety net). That path does not use DO storage. The database subscriptions pending-connection gate does use KV, so treat it as a different mechanism. See [Rate Limiting](/docs/server/rate-limiting) for details.

### 4. R2 for Zero-Egress Storage

Cloudflare R2 has $0 egress. Serve files (images, videos, PDFs) from R2 instead of bundling in DO storage.

### 5. D1-Based Auth (Built-in)

Auth operations go directly to D1 (AUTH_DB), with no Durable Object overhead. D1 works well on the Free plan for small apps, and the Workers Paid plan raises limits to 25B reads and 50M writes per month. If you outgrow D1 limits, switch to Neon PostgreSQL with a single config change — no code modifications, no migration downtime.

## Example Monthly Costs

### Small App (1K MAU, 100K requests/month)

| Resource | Usage | Cost |
|----------|-------|------|
| Workers Paid | Base (account-level) | $5.00 |
| DO Requests | ~200K | $0 (included) |
| R2 Storage | 1GB | $0 (included) |
| **Total** | | **$5/month** |

### Medium App (50K MAU, 5M requests/month)

| Resource | Usage | Cost |
|----------|-------|------|
| Workers Paid | Base | $5.00 |
| DO Requests | ~10M | $0.15 × 9 = $1.35 |
| DO Storage | 5GB | $0.20 × 4 = $0.80 |
| R2 Storage | 50GB | $0.015 × 40 = $0.60 |
| **Total** | | **~$8/month** |

### Large App (500K MAU, 50M requests/month)

| Resource | Usage | Cost |
|----------|-------|------|
| Workers Paid | Base | $5.00 |
| Workers Requests | 50M | $0.30 × 40 = $12.00 |
| DO Requests | ~100M | $0.15 × 99 = $14.85 |
| DO Storage | 50GB | $0.20 × 49 = $9.80 |
| R2 Storage | 500GB | $0.015 × 490 = $7.35 |
| **Total** | | **~$49/month** |

Compare with Firebase ($275 auth alone at 100K MAU) or Supabase ($25 base + usage).
