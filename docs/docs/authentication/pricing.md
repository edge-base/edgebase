---
sidebar_position: 23
---

# Pricing

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

EdgeBase charges **no per-MAU license fee**. Your Cloudflare or self-hosted
infrastructure usage still applies.

## Why $0?

Ordinary authenticated data requests use local JWT verification — pure
cryptography with no database or Durable Object hop. Session mutations use D1,
and OAuth start/callback uses a short-lived key-sharded Durable Object for
atomic state consumption.

| Operation | How it works | Cost |
|-----------|-------------|------|
| Sign in / Sign up | D1 (AUTH_DB) read/write | Covered by D1 limits (Free or Paid) |
| Token verification | Local JWT signature check | $0 (no I/O) |
| Token refresh | D1 (AUTH_DB) read/write | Covered by D1 limits (Free or Paid) |
| Session management | D1 (AUTH_DB) operations | Covered by D1 limits (Free or Paid) |
| OAuth start / callback | D1 plus key-sharded AUTH Durable Object | Covered by the selected Workers/Durable Objects plan |

## Comparison

| Scale | Firebase | Supabase | EdgeBase |
|-------|---------|----------|----------|
| 1K MAU | ~$0 (free tier) | $25 (Pro base) | Usage-based infrastructure; no MAU fee |
| 10K MAU | ~$70 | $25 | Usage-based infrastructure; no MAU fee |
| 100K MAU | ~$550 | $25 | Usage-based infrastructure; no MAU fee |
| 1M MAU | ~$4,700 | ~$2,950 | Usage-based infrastructure; no MAU fee |
| 10M MAU | ~$46,000 | ~$32,000 | Usage-based infrastructure; no MAU fee |

*Firebase charges per-MAU after 50K free tier. Supabase charges $0.00325/MAU after 100K included.*

:::tip Scaling beyond D1
The Free plan already includes 5M reads/day and 100K writes/day. The Workers Paid plan raises this to 25B reads and 50M writes/month. If you outgrow D1 limits, switch the auth provider to **Neon PostgreSQL** with a single config change — no code modifications. Auth remains $0 per MAU regardless of provider.
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

On Docker, D1 and Durable Object storage are local runtime resources. There is
no managed-service bill, but compute, storage, and operations are still your
infrastructure cost.

:::info Pricing source
Prices reflect each provider's published rates as of February 2026. Verify against official pricing pages before making decisions.
:::
