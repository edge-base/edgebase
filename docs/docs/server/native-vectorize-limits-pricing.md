---
slug: /server/native-resources/vectorize/limits-pricing
sidebar_position: 17
---

# Vectorize Limits & Pricing

Vectorize bills by queried vector dimensions and stored vector dimensions, not by the number of indexes or active hours.

## Included Usage

| Metric | Free Plan | Workers Paid |
|--------|-----------|--------------|
| Queried vector dimensions | 30M / month | First 50M / month included, then $0.01 / million |
| Stored vector dimensions | 5M total | First 10M included, then $0.05 / 100M |
| Egress | $0 | $0 |

## Limits That Matter

| Limit | Free Plan | Workers Paid |
|-------|-----------|--------------|
| Indexes per account | 100 | 50,000 |
| Maximum dimensions per vector | 1536 | 1536 |
| Metadata per vector | 10 KiB | 10 KiB |
| `topK` with values or metadata | 50 | 50 |
| `topK` without values or metadata | 100 | 100 |
| Upsert batch size | 1,000 (Workers) / 5,000 (HTTP API) | 1,000 (Workers) / 5,000 (HTTP API) |
| Namespaces per index | 1,000 | 50,000 |
| Maximum vectors per index | 10,000,000 | 10,000,000 |
| Metadata indexes per index | 10 | 10 |

## Operational Caveats

- `insert`, `upsert`, and `delete` are asynchronous. It typically takes a few seconds before queries reflect the change.
- Namespace filtering works by default. Filtering on other metadata properties requires metadata indexes.
- Vectors written before a metadata index exists must be re-upserted before that property becomes filterable.
- Cloudflare has no local Vectorize simulation. During local development, use remote bindings in Wrangler if you need real Vectorize behavior.

:::info Sources
Pricing and limits follow Cloudflare's official [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/), [Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/), [Vectorize API](https://developers.cloudflare.com/vectorize/reference/client-api/), [metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/), and [Workers local development bindings](https://developers.cloudflare.com/workers/development-testing/bindings-per-env/) docs.
:::
