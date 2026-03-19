---
sidebar_position: 8
---

# Direct Control

Declare and use Cloudflare-native KV, D1, and Vectorize resources directly from your EdgeBase project. These are user-defined resources, completely isolated from EdgeBase's internal bindings.

> For endpoint details, see the [Native Resources API Reference](/docs/api/native-resources).

## Overview

Direct Control lets you declare Cloudflare-native resources in `edgebase.config.ts` and access them from the Admin SDK, [App Functions](/docs/functions/context-api), or the centralized [Native Resources API reference](/docs/api/native-resources) when you need raw HTTP access. It is the right fit when you want lower-level control than EdgeBase's built-in database, storage, and room abstractions.

| Resource | What It Is | Best For | Docs |
|----------|-----------|----------|------|
| **KV** | Global key-value store | Caching, sessions, feature flags | [Overview](/docs/server/native-resources/kv) |
| **D1** | SQLite database | Analytics, logs, relational queries | [Overview](/docs/server/native-resources/d1) |
| **Vectorize** | Vector search index | Semantic search, RAG, recommendations | [Overview](/docs/server/native-resources/vectorize) |

Direct-control resources are not accessible from client SDKs. External HTTP and Admin SDK access require a [Service Key](/docs/server/service-keys) (`X-EdgeBase-Service-Key` header).

:::info Language Coverage
KV, D1, and Vectorize are available from all Admin SDKs.
:::

## How It Is Organized

- Start with [KV](/docs/server/native-resources/kv), [D1](/docs/server/native-resources/d1), or [Vectorize](/docs/server/native-resources/vectorize) depending on the resource you want to use.
- Each resource is split into three focused pages: overview, Admin SDK, and limits & pricing.
- HTTP endpoint details live in the centralized [Native Resources API reference](/docs/api/native-resources) instead of being repeated in each resource section.
- R2 remains documented under [Storage](/docs/storage) because EdgeBase Storage already wraps the file workflow around it.

## Auto-Provisioning

When you run `npx edgebase deploy`, EdgeBase automatically creates any declared resources that do not already exist:

- **KV**: `wrangler kv namespace create`
- **D1**: `wrangler d1 create`
- **Vectorize**: creates an index with the specified dimensions and metric

Re-deploys are safe. Existing resources are reused without modification.

A temporary `wrangler.toml` is generated with the required bindings during deployment. Your source `wrangler.toml` is never modified.

## Internal vs. User Resources

EdgeBase uses its own internal KV and D1 bindings for system purposes. Today that includes OAuth state in KV plus two internal D1 databases: `AUTH_DB` for auth state and `CONTROL_DB` for plugin and control-plane metadata.

User-defined direct-control resources are completely separate Wrangler bindings. There is no way to access internal resources through the direct-control APIs, and no risk of collision.

## Access from App Functions

Inside [App Functions](/docs/functions/context-api), direct-control resources are available through `context.admin`:

```typescript
// functions/recommend.ts
import { defineFunction } from '@edge-base/shared';

export default defineFunction({
  trigger: { type: 'http', method: 'GET', path: '/recommendations' },
  handler: async ({ admin, auth }) => {
    const cacheKey = `recs:${auth.id}`;
    const cached = await admin.kv('cache').get(cacheKey);
    if (cached) return JSON.parse(cached);

    const events = await admin.d1('analytics').exec(
      'SELECT item_id, COUNT(*) as views FROM events WHERE user_id = ? GROUP BY item_id ORDER BY views DESC LIMIT 5',
      [auth.id]
    );

    const embedding = await generateEmbedding(events.rows);
    const similar = await admin.vector('embeddings').search(embedding, { topK: 10 });

    const result = similar.matches;
    await admin.kv('cache').set(cacheKey, JSON.stringify(result), { ttl: 600 });

    return result;
  },
});
```

See [context.admin.kv()](/docs/functions/context-api#contextadminkvnamespace), [context.admin.d1()](/docs/functions/context-api#contextadmind1database), and [context.admin.vector()](/docs/functions/context-api#contextadminvectorindex) for function-specific examples.

## Security

- **Allowlist**: Only resources declared in `edgebase.config.ts` are accessible. Requests to undeclared names return **404**.
- **Service Key required**: All direct-control routes require a valid Service Key. Missing key returns **403**, invalid key returns **401**.
- **Scoped keys**: Use [scoped Service Keys](/docs/server/service-keys#scoped-key-example) for fine-grained access control such as `kv:namespace:cache:read`, `d1:database:analytics:exec`, or `vectorize:index:embeddings:query`.
- **Isolation**: User-defined resources are completely separate from EdgeBase's internal KV and D1 bindings.

## Environment Compatibility

| Resource | Edge | Docker | Node.js (`edgebase dev`) |
|----------|------|--------|--------------------------|
| **KV** | Native | Miniflare emulation | Miniflare emulation |
| **D1** | Native | Miniflare emulation | Miniflare emulation |
| **Vectorize** | Native | EdgeBase stub fallback | EdgeBase stub fallback |

:::info Local Development
Cloudflare does not provide a local Vectorize simulation. Wrangler can connect Vectorize to remote resources during local development, while EdgeBase currently falls back to stub responses when the Vectorize binding is unavailable in local or Docker environments.
:::
