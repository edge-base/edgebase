---
slug: /server/native-resources/kv
sidebar_position: 12
---

# KV

Cloudflare KV is a globally distributed key-value store that works well for caching, session data, feature flags, and lightweight configuration.

Use KV when you need fast key lookups, optional TTLs, and global distribution without relational querying.

:::caution Consistency
Workers KV is eventually consistent. Writes are usually visible first in the region where they were made and can take up to 60 seconds or more to appear in other regions. Writes to the same key are also limited to 1 per second.
:::

If you need atomic updates, hot counters, or transactional state, use Durable Objects instead of KV.

## Config

```typescript title="edgebase.config.ts"
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  kv: {
    cache: { binding: 'CACHE_KV' },
    sessions: { binding: 'SESSIONS_KV' },
  },
});
```

This declares two KV namespaces, `cache` and `sessions`, each with an explicit Wrangler binding name.

## Access Rules

KV namespaces support optional `read` and `write` rules for access control:

```typescript title="edgebase.config.ts"
export default defineConfig({
  kv: {
    cache: {
      binding: 'CACHE_KV',
      rules: {
        read(auth) {
          return auth !== null
        },
        write(auth) {
          return auth !== null && auth.role === 'admin'
        },
      },
    },
  },
});
```

| Rule | Operations | Signature |
|------|-----------|-----------|
| `read` | `get`, `list` | `(auth: AuthContext \| null) => boolean` |
| `write` | `set`, `delete` | `(auth: AuthContext \| null) => boolean` |

Without rules defined, KV access falls back to Service Key validation only. See [Service Keys](/docs/server/service-keys) for scoped access such as `kv:namespace:cache:read` and `kv:namespace:cache:write`.

## Next Steps

- Use the [KV Admin SDK](/docs/server/native-resources/kv/admin-sdk) if you are calling KV from a backend service.
- Review [KV limits & pricing](/docs/server/native-resources/kv/limits-pricing) before using it for anything stateful.
- Use the [Native Resources API reference](/docs/api/native-resources#kv) if you need raw HTTP access.
- Use [context.admin.kv()](/docs/functions/context-api#contextadminkvnamespace) inside App Functions.
