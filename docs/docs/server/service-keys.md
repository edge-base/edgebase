---
sidebar_position: 4
---

# Service Keys

Server-side API keys that bypass access rules. Service Keys are used by the [Admin SDK](/docs/sdks/client-vs-server) to authenticate backend operations — admin scripts, CI/CD pipelines, and microservice-to-microservice calls.

:::info What is a Service Key?
A Service Key is **any string you choose** (e.g. `my-super-secret-key-123`). There is no special format or generation step — just pick a strong, random string and store it as a secret.
:::

## Quick Start

### 1. Define Keys in Config

```typescript title="edgebase.config.ts"
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  serviceKeys: {
    keys: [
      {
        kid: 'backend',
        tier: 'root',
        scopes: ['*'],
        secretSource: 'dashboard',
        secretRef: 'SERVICE_KEY_BACKEND',
      },
    ],
  },
});
```

### 2. Set the Secret

The secret value is **any string you choose**. Pick something long and random:

Add the secret to your environment file. Pick something long and random:

```env
# .env.development (local) or .env.release (production)
SERVICE_KEY_BACKEND=my-super-secret-key-abc123xyz
```

Production secrets in `.env.release` are uploaded automatically when you run `npx edgebase deploy`.

### 3. Use with the Admin SDK

Service Keys authenticate the [Admin SDK](/docs/sdks/client-vs-server). Pass the same string you stored as a secret:

```typescript
import { createAdminClient } from '@edge-base/admin';

const admin = createAdminClient('https://your-worker.workers.dev', {
  serviceKey: process.env.SERVICE_KEY_BACKEND, // The string you chose
});

// All operations bypass access rules
const posts = await admin.db('app').table('posts').getList();
```

See [Admin SDK](/docs/sdks/client-vs-server) for full setup instructions for all Admin SDKs.

For raw HTTP requests, use `X-EdgeBase-Service-Key` as the canonical header. Some routes also accept `Authorization: Bearer ...`, but the dedicated header is the stable public contract.

:::info Captcha Bypass
Requests authenticated with a Service Key automatically **bypass captcha verification**. This allows all Admin SDKs and backend automation to call auth-related endpoints without a Turnstile token. See [Captcha](/docs/authentication/captcha) for details.
:::

## Key Tiers

| Tier | Description | Use Case |
|------|-------------|----------|
| `root` | Full access — bypasses all rules and scopes | Admin scripts, migrations |
| `scoped` | Only allowed for matching scopes | Microservice-to-microservice |

### Scoped Key Example

```typescript
{
  kid: 'analytics',
  tier: 'scoped',
  scopes: ['db:table:events:write'],
  secretSource: 'dashboard',
  secretRef: 'SERVICE_KEY_ANALYTICS',
}
```

This key can only write to the `events` table. Any other operation returns 401.

### Scope Format

```
{domain}:{resource-type}:{resource-name}:{action}
```

| Scope | Meaning |
|-------|---------|
| `*` | Full access (root only) |
| `db:table:posts:read` | Read posts |
| `db:table:*:read` | Read any table |
| `storage:bucket:photos:write` | Write to photos bucket |
| `storage:bucket:*:*` | Full storage access |
| `push:notification:*:send` | Send push notifications |
| `push:token:*:read` | Read device tokens |
| `push:log:*:read` | Read push logs |
| `sql:table:posts:exec` | Run raw SQL on posts |
| `dblive:channel:*:broadcast` | Broadcast to any channel |
| `kv:namespace:cache:read` | Read from cache namespace |
| `kv:namespace:cache:write` | Write to cache namespace |
| `d1:database:analytics:exec` | Run SQL on analytics D1 |
| `vectorize:index:embeddings:query` | Query embeddings index |

## Secret Management

### `dashboard` (Recommended)

Secret is stored as a Cloudflare Workers Secret — never in code.

```typescript
{
  secretSource: 'dashboard',
  secretRef: 'SERVICE_KEY_BACKEND',  // env var name in Workers
}
```

### `inline` (Local Dev Only)

Secret is written directly in config. **Never use in production.**

```typescript
{
  secretSource: 'inline',
  inlineSecret: 'my-dev-secret',
}
```

:::warning
`npx edgebase deploy` will warn if any key uses `secretSource: 'inline'`.
:::

## Key Format

When configuring `secretSource: 'dashboard'`, the secret value you store can be **any string**. Optionally, you can use the structured `jb_{kid}_{secret}` format to enable faster lookup:

```env
# .env.development or .env.release
# Structured format (recommended for scoped keys): jb_{kid}_{your-secret-value}
SERVICE_KEY_ANALYTICS=jb_analytics_abc123xyz456secretvalue

# Or plain string (works for root-tier keys):
SERVICE_KEY_BACKEND=mysecretkey-abc123
```

The `kid` in `jb_{kid}_{...}` must match the `kid` field in your config:

```typescript
{
  kid: 'analytics',           // ← must match the jb_analytics_... prefix
  secretRef: 'SERVICE_KEY_ANALYTICS',
}
```

`kid` values must use letters, numbers, and hyphens only. Underscore is reserved as the delimiter in `jb_{kid}_{secret}`.

For **root-tier keys**, any plain string works — the `jb_` prefix is optional.

If you use authentication triggers, authentication delivery hooks, storage hooks, plugin migrations, or function admin helpers, keep one dedicated root-tier key for internal self-calls. The recommended setup is `secretRef: 'SERVICE_KEY'` with no `tenant` or `ipCidr` constraint:

```typescript
{
  kid: 'root',
  tier: 'root',
  scopes: ['*'],
  secretSource: 'dashboard',
  secretRef: 'SERVICE_KEY',
}
```

This same canonical root key is what `npx edgebase admin reset-password` uses for admin recovery, so it should exist in every environment where you operate the Admin Dashboard.

## Constraints

Constraints add conditions that must pass **in addition to** scope matching.

```typescript
{
  kid: 'prod-backend',
  tier: 'root',
  scopes: ['*'],
  secretSource: 'dashboard',
  secretRef: 'SERVICE_KEY_PROD',
  constraints: {
    expiresAt: '2025-12-31T23:59:59Z',
    env: ['prod'],
    ipCidr: ['10.0.0.0/8', '172.16.0.0/12'],
    tenant: 'workspace-123',
  },
}
```

### `expiresAt`

ISO 8601 timestamp. Key is rejected after this time.

```typescript
constraints: { expiresAt: '2025-06-30T00:00:00Z' }
```

### `env`

Restrict key to specific server environments. Compared against the `ENVIRONMENT` env var.

```typescript
constraints: { env: ['prod'] }          // Only works in production
constraints: { env: ['dev', 'staging'] } // Dev + staging only
```

Set your environment name in `wrangler.toml`:

```toml title="wrangler.toml"
[vars]
ENVIRONMENT = "prod"
```

### `ipCidr`

Restrict to specific IP ranges. Supports IPv4 and IPv6 CIDR notation.

```typescript
constraints: {
  ipCidr: [
    '10.0.0.0/8',        // Internal network
    '172.16.0.0/12',      // Docker default
    '2001:db8::/32',      // IPv6 range
  ],
}
```

The client IP is extracted from:

- `CF-Connecting-IP` on Cloudflare Edge
- `X-Forwarded-For` in self-hosted environments only when `trustSelfHostedProxy: true`

If you self-host and want `ipCidr` constraints to match the real client IP, place EdgeBase behind a reverse proxy that overwrites `X-Forwarded-For`, then enable `trustSelfHostedProxy: true` in `edgebase.config.ts`.

### `tenant`

Restrict to a specific tenant. Matched against the DB instance ID (`namespace:id`) in the request path.

```typescript
constraints: { tenant: 'workspace-123' }
```

When using user-namespaced DB blocks, the namespace and instance ID are passed via the URL:

```typescript
// client.db('workspace', 'workspace-123').table('docs') — namespace+id in URL 
// This key only works when the instance ID matches 'workspace-123'
```

### Behavior When Context is Missing

All constraints except `expiresAt` are **fail-closed**:

| Constraint | Context Missing | Result |
|------------|----------------|--------|
| `env` | `ENVIRONMENT` not set | ❌ Denied |
| `ipCidr` | No trusted client IP (for example self-hosted without `trustSelfHostedProxy`) | ❌ Denied |
| `tenant` | No instance ID in path | ❌ Denied |
| `expiresAt` | — | Always enforced |

This prevents constrained keys from silently becoming broader when the server cannot prove the required context. In local development, use unconstrained keys or provide matching `ENVIRONMENT`, client IP forwarding, and DB instance IDs.

## Full Config Example

```typescript title="edgebase.config.ts"
export default defineConfig({
  serviceKeys: {
    keys: [
      // Root key for admin operations
      {
        kid: 'admin',
        tier: 'root',
        scopes: ['*'],
        secretSource: 'dashboard',
        secretRef: 'SERVICE_KEY_ADMIN',
        constraints: {
          env: ['prod'],
          ipCidr: ['10.0.0.0/8'],
        },
      },
      // Scoped key for analytics microservice
      {
        kid: 'analytics',
        tier: 'scoped',
        scopes: ['db:table:events:write'],
        secretSource: 'dashboard',
        secretRef: 'SERVICE_KEY_ANALYTICS',
        constraints: {
          expiresAt: '2026-01-01T00:00:00Z',
        },
      },
      // Local dev key (never deploy to production)
      {
        kid: 'local',
        tier: 'root',
        scopes: ['*'],
        secretSource: 'inline',
        inlineSecret: 'dev-secret-123',
        constraints: {
          env: ['dev'],
        },
      },
    ],
  },
});
```

## Key Rotation

To rotate a key without downtime:

1. Add the new key entry with a different `kid`
2. Deploy the config
3. Update your backend to use the new key
4. Disable the old key: `enabled: false`
5. Deploy again

```typescript
{
  kid: 'backend-v1',
  tier: 'root',
  scopes: ['*'],
  secretSource: 'dashboard',
  secretRef: 'SERVICE_KEY_V1',
  enabled: false,  // Disabled — no longer accepted
},
{
  kid: 'backend-v2',
  tier: 'root',
  scopes: ['*'],
  secretSource: 'dashboard',
  secretRef: 'SERVICE_KEY_V2',
},
```

:::tip Current Contract
Define every Service Key in `config.serviceKeys`. The default root key usually references the `SERVICE_KEY` Worker secret via `secretRef`, and `npx edgebase keys rotate` replaces that secret immediately.
:::
