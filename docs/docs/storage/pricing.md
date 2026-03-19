---
sidebar_position: 8
---

# Pricing

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

EdgeBase Storage uses Cloudflare R2 with **$0 egress** — downloading files costs nothing regardless of bandwidth.

:::tip Free Plan
<div className="docs-badge-row">
  <span className="docs-badge docs-badge--free">Free Plan</span>
  <span className="docs-badge docs-badge--setup">Billing Setup</span>
</div>

R2 is available on the Cloudflare Free plan. It includes 10 GB free storage, but Cloudflare requires a separate R2 subscription / billing activation before first use: **R2 Object Storage → Get Started**.
:::

## Edge (Cloudflare)

| Resource | Free Plan | Workers Paid | Overage |
|----------|-----------|-------------|---------|
| R2 storage | 10 GB / month | 10 GB / month | $0.015 / GB |
| R2 Class A ops (writes) | 1M / month | 1M / month | $4.50 / million |
| R2 Class B ops (reads) | 10M / month | 10M / month | $0.36 / million |
| R2 egress | **Unlimited** | **Unlimited** | **$0** |

### Example: Social App (2 TB Files, 100 TB Egress/Month)

| Platform | Storage | Egress | Total |
|----------|---------|--------|-------|
| Firebase | $52 | $12,000 | **$12,052** |
| Supabase | $40 | $8,978 | **$9,018** |
| **EdgeBase** | $30 | $0 | **$30** |

### Example: Small App (50 GB Files)

| Resource | Usage | Cost |
|----------|-------|------|
| R2 storage | 50 GB | $0.60 |
| R2 Class A | ~100K writes | $0 (included) |
| R2 Class B | ~1M reads | $0 (included) |
| Egress | Any amount | $0 |
| **Total** | | **~$1/mo** |

## Why $0 Egress?

Cloudflare R2 charges $0 for egress bandwidth. This is a structural property of R2's architecture, not a promotional offer. A social media app serving 1 TB of images per month pays $0 in bandwidth.

## Self-Hosting

On Docker, Storage is emulated as local file storage. No R2 charges apply — cost is limited to VPS disk space.

:::info Pricing source
Prices reflect Cloudflare's published R2 rates as of February 2026. Verify against the [R2 pricing page](https://developers.cloudflare.com/r2/pricing/) before making decisions.
:::
