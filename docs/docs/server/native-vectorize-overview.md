---
slug: /server/native-resources/vectorize
sidebar_position: 15
---

# Vectorize

Cloudflare Vectorize is a vector search index for building semantic search, retrieval workflows, and recommendation features.

## Config

```typescript title="edgebase.config.ts"
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  vectorize: {
    embeddings: {
      binding: 'EMBEDDINGS_INDEX',
      dimensions: 1536,
      metric: 'cosine',
    },
  },
});
```

| Field | Required | Description |
|-------|----------|-------------|
| `binding` | No | Optional Wrangler binding override. Defaults to an EdgeBase-managed binding name |
| `dimensions` | Yes | Vector dimensionality and must match your embedding model output |
| `metric` | Yes | Distance metric: `cosine`, `euclidean`, or `dot-product` |

## Common Use Cases

- **Semantic search**: embed documents and search by meaning instead of keywords.
- **Retrieval workflows**: retrieve relevant context for semantic search and ranked lookup flows.
- **Recommendations**: find similar items based on user behavior or item attributes.

:::warning Local Development
Cloudflare does not provide a local Vectorize simulation. Wrangler supports remote binding connections for Vectorize during local development, but EdgeBase currently falls back to stub responses when a Vectorize binding is unavailable in local or Docker environments.
:::

## Next Steps

- Use the [Vectorize Admin SDK](/docs/server/native-resources/vectorize/admin-sdk) for backend code.
- Review [Vectorize limits & pricing](/docs/server/native-resources/vectorize/limits-pricing) before choosing dimensions, filters, or query shape.
- Use the [Native Resources API reference](/docs/api/native-resources#vectorize) if you need raw HTTP access.
- Use [context.admin.vector()](/docs/functions/context-api#contextadminvectorindex) inside App Functions.
