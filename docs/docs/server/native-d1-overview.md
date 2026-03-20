---
slug: /server/native-resources/d1
sidebar_position: 9
---

# D1

Cloudflare D1 is a SQL database built on SQLite. Unlike EdgeBase's built-in Durable Object collections, D1 is a standalone database with no per-instance isolation, which makes it a good fit for cross-cutting data such as analytics, logs, and reporting.

## Config

```typescript title="edgebase.config.ts"
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  d1: {
    analytics: { binding: 'ANALYTICS_DB' },
  },
});
```

Each D1 database is declared by name and mapped to a Wrangler binding.

D1 supports common SQL workflows including DDL, DML, indexes, and aggregations, with Cloudflare-specific limits and SQLite compatibility differences documented in the official D1 docs.

:::caution D1 Consistency
D1 queries run against the primary database by default. Read replication is opt-in. If you enable read replication and need sequential consistency across multiple queries, use the D1 Sessions API in lower-level Worker code.
:::

## Next Steps

- Use the [D1 Admin SDK](/docs/server/native-resources/d1/admin-sdk) for backend code.
- Review [D1 limits & pricing](/docs/server/native-resources/d1/limits-pricing) before deciding whether it fits your workload.
- Use the [Native Resources API reference](/docs/api/native-resources#d1) if you need raw HTTP access.
- Use [context.admin.d1()](/docs/functions/context-api#contextadmind1database) inside App Functions.
