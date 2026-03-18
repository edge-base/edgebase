---
sidebar_position: 5
---

# Rate Limiting

EdgeBase comes with built-in rate limiting to protect your API from abuse. You can configure limits per group through `edgebase.config.ts`.

## At a Glance

| Layer | Config | Purpose | What to Expect |
|-------|--------|---------|----------------|
| Soft limit | `requests`, `window` | Primary abuse protection | Fast and flexible, but best-effort rather than strict global accounting |
| Binding ceiling | `binding.limit`, `binding.period`, `binding.namespaceId` | Cloudflare-backed safety net for built-in groups | Stronger edge safety net, still not a billing-grade global quota |

:::important Best-Effort, Not Strict Quota
EdgeBase rate limiting is designed for **abuse protection and traffic shaping**. It is **not** a strict globally consistent quota or billing system.

If you need exact project-wide counting for hard quotas, billing, or guaranteed global enforcement, use a central state system such as a Durable Object-based limiter.
:::

## Configuration

```typescript
import { defineConfig } from '@edgebase-fun/shared';

export default defineConfig({
  rateLimiting: {
    global:      { requests: 10000000, window: '60s' },
    db:          {
      requests: 200,
      window: '60s',
      binding: { limit: 250, period: 60, namespaceId: '2002' },
    },
    storage:     { requests: 50,      window: '60s' },
    functions:   { requests: 50,      window: '60s' },
    auth:        { requests: 30,      window: '60s' },
    authSignin:  { requests: 10,      window: '1m' },
    authSignup:  { requests: 10,      window: '60s' },
    events:      { requests: 100,     window: '60s' },
  },
});
```

`binding` is optional. When set, `edgebase dev` and `edgebase deploy` synthesize matching Cloudflare Rate Limiting Bindings for the built-in groups. Cloudflare currently supports only `10` or `60` second binding periods.

### What Each Field Means

| Field | Meaning |
|-------|---------|
| `requests` | Your app-level soft limit for the group |
| `window` | Soft-limit time window (`60s`, `5m`, `1h`, ...) |
| `binding.*` | Deploy-time Cloudflare binding settings for built-in groups only |

Changes to `requests` and `window` apply when you restart `edgebase dev` or run `edgebase deploy`. Binding changes also apply through `edgebase dev` / `edgebase deploy`, because the CLI generates a temporary `wrangler.toml` from your config.

## Rate Limit Groups

Every incoming request is classified into a group based on its URL path. Each group has its own counter.

| Group | Path Prefix | Default Limit | Identifier | Purpose |
|-------|-------------|---------------|------------|---------|
| `global` | All routes | 10,000,000 / 60s | IP | Last-resort safety net |
| `db` | `/api/db/*` | 100 / 60s | IP | DB CRUD abuse prevention |
| `storage` | `/api/storage/*` | 50 / 60s | IP | File upload/download throttle |
| `functions` | `/api/functions/*` | 50 / 60s | IP | Custom function call throttle |
| `auth` | `/api/auth/*` | 30 / 60s | IP | Auth endpoint protection |
| `authSignin` | `/api/auth/signin` | 10 / 1m | email | Brute-force login prevention |
| `authSignup` | `/api/auth/signup` | 10 / 60s | IP | Signup spam prevention |
| `events` | `/api/events/*` | 100 / 60s | IP | SSE/event endpoint throttle |

:::info Layered Enforcement
Non-global routes are checked against **both** their group limit and the global limit. For example, a request to `/api/db/app/tables/posts` must pass both the `db` and `global` counters.
:::

### Custom Rate Limit Groups

You can also define custom groups in your configuration. Custom groups follow the same `{ requests, window }` shape and can be applied programmatically in your App Functions or middleware.

Custom groups are **software-counter only**. EdgeBase only synthesizes Cloudflare Rate Limiting Bindings for the built-in groups listed above.

## Window Format

The `window` field accepts a duration string:

| Format | Example | Description |
|--------|---------|-------------|
| `Ns` | `30s` | N seconds |
| `Nm` | `5m` | N minutes |
| `Nh` | `1h` | N hours |

## Service Key Bypass

Requests authenticated with a [Service Key](/docs/server/config-reference) bypass EdgeBase's app-level rate limits entirely (`global`, `db`, `storage`, `functions`, `auth`). This keeps trusted server-to-server traffic, migrations, and admin jobs from being throttled by IP-based counters.

The same bypass semantics apply to all Admin SDKs.

```typescript
// Next.js API route — Service Key bypasses app-level limits
const client = createAdminClient('https://your-project.workers.dev', {
  serviceKey: process.env.EDGEBASE_SERVICE_KEY,
});

// No EdgeBase app-level rate limit applies
await client.db('app').table('logs').insert(bulkData);
```

## Response on Limit Exceeded

When a rate limit is exceeded, EdgeBase returns:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{
  "code": 429,
  "message": "Too many requests. Please try again later."
}
```

The `Retry-After` header indicates how many seconds to wait before retrying.

## Architecture

EdgeBase uses a **2-layer rate limiting architecture** for reliability:

```
Request → Layer 1: Software Counter → Layer 2: Binding Ceiling → Handler
              (config-driven)           (infrastructure safety net)
```

### Layer 1 — Software Counter (Primary)

A per-isolate in-memory [Fixed Window Counter](https://en.wikipedia.org/wiki/Fixed_window_counter) provides the main enforcement. It reads limits from your `edgebase.config.ts` and falls back to sensible defaults.

This is the layer to think of as your **soft limit**:
- It is the main line of defense for ordinary abuse protection
- It is configurable in app config
- It is not a single exact global counter across all isolates

**Why software counters?** They let you keep app-level throttles in config instead of hardcoding them into infrastructure. Update your config, then restart `edgebase dev` or run `edgebase deploy` to apply the new values.

### Layer 2 — Cloudflare Binding Ceiling (Safety Net)

[Cloudflare Rate Limiting Binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) adds a provider-managed safety net on top of the software counter. By default EdgeBase synthesizes a `10,000,000 / 60s` binding for each built-in group, and you can override those values per group through `rateLimiting.*.binding`.

This layer is best understood as a **ceiling**, not a perfect quota system:
- It is generated at dev/deploy time from your config
- It only applies to built-in groups
- It helps when isolate-local memory counters are reset or split across many edge instances
- It still should not be treated as billing-grade global accounting

### Self-Hosting

Both layers work when self-hosting with Docker. [Miniflare](https://miniflare.dev/) emulates the Cloudflare Binding locally, and the software counter runs in the same Node.js process.

That means the soft counter is often **more consistent per process** in local/self-hosted setups, but it is still best to think of the whole system as abuse protection rather than strict quota enforcement.

:::danger Reverse Proxy Required for IP-Based Rate Limiting
On Cloudflare Edge, the tamper-proof `CF-Connecting-IP` header identifies clients. In self-hosted environments, EdgeBase only uses `X-Forwarded-For` when `trustSelfHostedProxy: true` is enabled, and that header **must be set by a trusted reverse proxy** (Nginx or Caddy).

**Without a reverse proxy**, leave `trustSelfHostedProxy: false` so client-supplied `X-Forwarded-For` headers are ignored. If you need per-client rate limiting while self-hosting, enable `trustSelfHostedProxy: true` and configure the proxy to overwrite `X-Forwarded-For`. See the [Self-Hosting Guide](/docs/getting-started/self-hosting#3-https-reverse-proxy) for proper proxy configuration.
:::

:::tip Why not just use Bindings for everything?
Bindings are useful, but they are deploy-time infrastructure settings. The software layer keeps request throttles in your app config, while the binding layer adds an edge safety net for the built-in groups.

That split is why EdgeBase treats rate limiting as:
- **soft, configurable app policy** at the config level
- **provider-backed ceiling** at the infrastructure level
:::
