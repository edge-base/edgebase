---
slug: /server/native-resources/kv/limits-pricing
---

# KV Limits & Pricing

Workers KV is inexpensive and globally distributed, but it is optimized for read-heavy workloads rather than strongly consistent state.

## Included Usage

| Metric | Free Plan | Workers Paid |
|--------|-----------|--------------|
| Reads | 100,000 / day | 10M / month included, then $0.50 / million |
| Writes | 1,000 / day | 1M / month included, then $5.00 / million |
| Deletes | 1,000 / day | 1M / month included, then $5.00 / million |
| List requests | 1,000 / day | 1M / month included, then $5.00 / million |
| Stored data | 1 GB | 1 GB included, then $0.50 / GB-month |

## Limits That Matter

| Limit | Value |
|-------|-------|
| Writes to the same key | 1 / second |
| Value size | 25 MiB |
| Key size | 512 bytes |
| Metadata size | 1,024 bytes |
| Operations per Worker invocation | 1,000 |
| Expiration TTL minimum | 60 seconds |
| Storage per namespace | 1 GB Free / Unlimited Paid |

## Operational Caveats

- KV is eventually consistent. Writes can take up to 60 seconds or more to appear in other regions.
- KV is not ideal for atomic counters or transactional state. Use Durable Objects if you need stronger consistency.
- A short TTL does not bypass KV's write model. Expiring keys still follow the same per-key write-rate limits.

:::info Sources
Pricing and limits follow Cloudflare's official [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/), [KV limits](https://developers.cloudflare.com/kv/platform/limits/), and [How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/) docs.
:::
