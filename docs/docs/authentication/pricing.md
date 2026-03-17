---
sidebar_position: 23
---

# Pricing

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

EdgeBase Authentication costs **$0** regardless of user count. There is no per-MAU pricing.

## Why $0?

Authentication uses JWT verification — pure cryptography with no network call and no Durable Object hit per request. Whether you have 100 or 10 million users, the per-request auth cost is the same: effectively zero.

| Operation | How it works | Cost |
|-----------|-------------|------|
| Sign in / Sign up | D1 (AUTH_DB) read/write | Included in Workers Paid plan |
| Token verification | Local JWT signature check | $0 (no I/O) |
| Token refresh | D1 (AUTH_DB) read/write | Included in Workers Paid plan |
| Session management | D1 (AUTH_DB) operations | Included in Workers Paid plan |

## Comparison

| Scale | Firebase | Supabase | EdgeBase |
|-------|---------|----------|----------|
| 1K MAU | ~$0 (free tier) | $25 (Pro base) | **$0** |
| 10K MAU | ~$70 | $25 | **$0** |
| 100K MAU | ~$550 | $25 | **$0** |
| 1M MAU | ~$4,700 | ~$2,950 | **$0** |
| 10M MAU | ~$46,000 | ~$32,000 | **$0** |

*Firebase charges per-MAU after 50K free tier. Supabase charges $0.00325/MAU after 100K included.*

:::tip Scaling beyond D1
D1's included limits (25B reads, 50M writes, 10GB storage per month) handle the vast majority of applications. If you outgrow them, switch the auth provider to **Neon PostgreSQL** with a single config change — no code modifications. Auth remains $0 per MAU regardless of provider.
:::

## Email Costs

Transactional emails (verification, password reset) use an external email provider:

| Provider | Free Tier | Notes |
|----------|-----------|-------|
| Resend (recommended) | 3,000 / month | Developer-friendly API |
| SendGrid | 100 / day | Most popular |
| Mailgun | 1,000 / month (3 months) | EU data sovereignty |
| AWS SES | $0.10 / 1,000 emails | Lowest at scale |

## Self-Hosting

On Docker, authentication has no external cost. D1 is emulated as local SQLite. All auth operations run against local D1.

:::info Pricing source
Prices reflect each provider's published rates as of February 2026. Verify against official pricing pages before making decisions.
:::
