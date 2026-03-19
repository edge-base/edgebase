---
sidebar_position: 6
---

# Rate Limiting Architecture

How EdgeBase protects against abuse with a 2-layer rate limiting system, auth-specific defenses, and a WebSocket DDoS gate.

## Mental Model

Think of EdgeBase rate limiting as two different tools working together:

| Tool | Role | Good For | Not Good For |
|------|------|----------|--------------|
| Software counter | App-level soft limit | Abuse protection, traffic shaping, per-group tuning | Exact global quotas or billing |
| Cloudflare binding | Edge safety net | Catching overflow that slips past per-isolate memory | Precise cross-region accounting |

If you need strict global counting, use a central state system such as a Durable Object-based limiter.

## 2-Layer Architecture

Every HTTP request passes through two independent rate limiting layers before reaching any Durable Object:

```
Request
  │
  ▼
Layer 1: Software Counter (per-isolate memory)
  │  ├─ Config-driven limits per group
  │  └─ Primary defense line
  │
  ▼
Layer 2: Cloudflare Rate Limiting Binding
  │  ├─ Deploy-time edge ceiling for built-in groups
  │  └─ Safety net for isolate restarts and distributed traffic
  │
  ▼
Durable Object (only reached if both layers pass)
```

### Layer 1 — Software Counter

The primary defense. A per-isolate **Fixed Window Counter** in memory, configured through `edgebase.config.ts`:

| Group | Default Limit | Key | What It Protects |
|---|---|---|---|
| `global` | 10,000,000 / 60s | IP | Overall request ceiling |
| `db` | 100 / 60s | IP | Database CRUD operations |
| `storage` | 50 / 60s | IP | File upload/download |
| `functions` | 50 / 60s | IP | App Functions execution |
| `auth` | 30 / 60s | IP | All auth endpoints |
| `authSignin` | 10 / 60s | email | Sign-in brute force protection |
| `authSignup` | 10 / 60s | IP | Sign-up spam prevention |
| `events` | 100 / 60s | IP | Analytics event endpoints |

Most groups use the client's **IP address** as the rate limit key because the middleware runs before authentication (no `auth.id` is available yet). The `authSignin` group is the exception — it uses the **email address** to prevent credential stuffing against specific accounts.

When a limit is exceeded, the server returns `429 Too Many Requests` with a `Retry-After` header.

### Layer 2 — Binding Ceiling

The safety net. By default, EdgeBase synthesizes Cloudflare Rate Limiting Bindings for the built-in groups at **10,000,000 requests per 60 seconds**, and you can override those binding values from config. This layer catches requests that slip through when:

- The Worker isolate restarts (resetting in-memory counters)
- Traffic is spread across many isolates or edge instances
- Memory pressure causes counter eviction

Miniflare emulates these bindings in Docker and local development environments, so the same architecture works in dev as well.

## Configuration

Customize rate limits in `edgebase.config.ts`:

```typescript
export default defineConfig({
  rateLimiting: {
    db:          { requests: 200, window: '60s' },
    storage:     { requests: 100, window: '60s' },
    auth:        { requests: 60,  window: '60s' },
    authSignin:  { requests: 20,  window: '5m' },
    authSignup:  { requests: 5,   window: '60s' },
  },
});
```

Only the groups you specify are overridden — all others keep their defaults. The `global` group is intentionally set high (10M/60s) and is rarely customized.

For built-in groups, you can also add `binding` settings if you want the generated Cloudflare binding to match your app policy more closely. Custom groups remain software-counter only.

## Auth-Specific 3-Layer Defense

Authentication endpoints receive additional protection through **3 specialized rate limit groups**, all of which must pass before the request reaches the auth handler:

```
Auth request (e.g., POST /auth/signin)
  │
  ▼
Group 1: auth (IP-based, 30/60s)
  │  └─ Blocks IP-level flooding of all auth endpoints
  │
  ▼
Group 2: authSignin (email-based, 10/60s)
  │  └─ Blocks brute-force against a specific account
  │
  ▼
Group 3: authSignup (IP-based, 10/60s)
  │  └─ Blocks mass account creation from a single IP
  │
  ▼
Captcha (if enabled)
  │
  ▼
Auth Handler (D1)
```

This layered approach means:
- A general flood is caught by the `auth` group
- Targeted credential stuffing is caught by `authSignin` (email-keyed)
- Account creation spam is caught by `authSignup`
- Bot traffic is caught by Captcha (Cloudflare Turnstile)

All three groups plus the global group must pass — failing any single one returns `429`.

:::important This Is Still Soft Protection
Even with multiple layers, this architecture is for abuse mitigation, not exact quota accounting. It is appropriate for protecting endpoints, but not for billing or hard tenant quotas.
:::

## WebSocket DDoS Gate

WebSocket connections present a unique challenge: the upgrade happens before authentication, so an attacker could open thousands of unauthenticated connections to overwhelm the DatabaseLiveDO.

EdgeBase adds a **best-effort pending-connection gate** before handing a WebSocket off to the target runtime:

```
WebSocket upgrade request
  │
  ▼
KV: ws:pending:{ip}
  │
  ├─ Count < 5 → Try to reserve a short-lived slot, allow upgrade
  │                 │
  │                 ▼
  │              DatabaseLiveDO
  │                 │
  │                 ├─ Auth succeeds → Release slot
  │                 └─ Auth fails/timeout → Connection closed
  │                                         (slot eventually expires)
  │
  └─ Count >= 5 → 429 Too Many Requests (upgrade rejected)
```

| Parameter | Value |
|---|---|
| Max pending connections per IP | 5 |
| KV key | `ws:pending:{ip}` |
| TTL | 60 seconds on Cloudflare-compatible KV |

### Why Not Treat KV As An Exact Counter?

The Rate Limiting Binding's `limit()` API is a **one-way counter** (increment only). Pending WebSocket tracking needs a short-lived reservation concept instead of a simple monotonic counter.

Workers KV is only a coarse guardrail here:

- KV is eventually consistent.
- Writes to the same key are limited to 1 per second.
- Expiration TTL must be at least 60 seconds.

That makes this a conservative, best-effort gate rather than a strongly consistent distributed counter. If you need exact hot per-IP counters, move that state into Durable Objects or another strongly consistent store.

### Self-Healing

The short KV TTL means pending slots eventually clear even if a release step is missed because of a crash or abrupt disconnect. That keeps the protection lightweight without permanent cleanup state.

## Service Key Rate Limit Policy

Requests authenticated with a **Service Key** bypass EdgeBase's app-level rate limits entirely (`global`, `db`, `storage`, `functions`, `auth`).

| Rate Limit Group | Normal Request | Service Key Request |
|---|---|---|
| `global` | Applied | **Bypassed** |
| `db` | Applied | **Bypassed** |
| `storage` | Applied | **Bypassed** |
| `functions` | Applied | **Bypassed** |
| `auth` | Applied | **Bypassed** |
| `authSignin` | Applied | **Bypassed** |
| `authSignup` | Applied | **Bypassed** |
| `events` | Applied | **Bypassed** |

This policy allows server-to-server operations (bulk migrations, admin scripts, automated backups) to run without hitting rate limits designed for end-user traffic.

## How It All Fits Together

```
                    ┌─────────── HTTP Request ───────────┐
                    │                                     │
                    ▼                                     │
          Global Rate Limit (IP, 10M/60s)                │
                    │                                     │
                    ▼                                     │
          Group Rate Limit (db/storage/auth/etc.)        │
                    │                                     │
                    ▼                                     │
          [Auth endpoints only]                          │
          Auth-specific groups (auth + authSignin/Signup) │
                    │                                     │
                    ▼                                     │
          [Auth endpoints only]                          │
          Captcha (Cloudflare Turnstile)                 │
                    │                                     │
                    ▼                                     │
          JWT Verification (local crypto)                │
                    │                                     │
                    ▼                                     │
          Access Rules                                   │
                    │                                     │
                    ▼                                     │
          Durable Object                                 │
                    │                                     │
                    └──────── Response ──────────────────┘


                    ┌─────── WebSocket Upgrade ──────────┐
                    │                                     │
                    ▼                                     │
          Global Rate Limit (IP, 10M/60s)                │
                    │                                     │
                    ▼                                     │
          WS DDoS Gate (KV, 5 pending/IP)                │
                    │                                     │
                    ▼                                     │
          DatabaseLiveDO                                 │
                    │                                     │
                    ├─ Auth message (5s timeout)          │
                    ├─ Subscribe/Presence/Broadcast       │
                    │                                     │
                    └──────── WebSocket ─────────────────┘
```

## Next Steps

- [**Security Model**](./security-model.md) — Membership verification and access rules
- [**Authentication Architecture**](./auth-architecture.md) — Token lifecycle and session management
