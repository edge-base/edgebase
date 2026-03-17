---
sidebar_position: 5
---

# Deployment Architecture

How EdgeBase runs identically across Cloudflare Edge, Docker, and Node.js — using the same codebase and the same `workerd` runtime.

## Three Deployment Modes

EdgeBase runs on `workerd`, Cloudflare's open-source Workers runtime. Because `workerd` is available as a standalone binary, the exact same Worker + Durable Object architecture runs in three environments:

| Mode                 | Command                   | Runtime               | Best For                           |
| -------------------- | ------------------------- | --------------------- | ---------------------------------- |
| **Cloudflare Edge**  | `npx edgebase deploy`     | Cloudflare Workers    | Production, global ~0ms cold start |
| **Docker**           | `npx edgebase docker run` | workerd in container  | Self-hosted, full data control     |
| **Node.js (Direct)** | `npx edgebase dev`        | workerd via Miniflare | Local development, VPS deployment  |

All three modes execute the same middleware chain, the same Durable Object classes, the same security rules, and the same SQLite-based storage. The differences are only in how state is persisted and how infrastructure services (KV, R2, D1) are provided.

## Config Injection

EdgeBase configuration is defined in `edgebase.config.ts` and injected at **build time** via esbuild bundling:

```
npx edgebase deploy
  │
  ├─ 1. Read edgebase.config.ts
  ├─ 2. Serialize config to JSON
  ├─ 3. Inline JSON into Worker code (esbuild)
  ├─ 4. Deploy bundled Worker
  └─ 5. Each DO runs Lazy Schema Init on first request
```

This means config changes require a redeployment — there is no runtime config fetch. This is intentional: config defines your schema and security rules, so changing it is equivalent to a schema migration and should go through a deploy cycle.

```typescript
// edgebase.config.ts — evaluated at build time
export default defineConfig({
  databases: {
    app: {
      tables: {
        posts: {
          schema: { title: 'string', body: 'text' },
          access: {
            read: () => true,
            insert: (auth) => auth !== null,
          },
        },
      },
    },
  },
});
```

Build-time environment variables and conditional logic are supported:

```typescript
export default defineConfig({
  databases: {
    app: {
      tables: {
        posts: {
          access:
            process.env.NODE_ENV === 'development'
              ? { read: () => true, insert: () => true }
              : { read: () => true, insert: (auth) => auth !== null },
        },
      },
    },
  },
});
```

Runtime dynamic logic (function references, async operations) cannot be serialized and is not supported.

## DO Deterministic Hashing

Durable Object instances are identified by `idFromName()`, which uses **deterministic hashing** to map a string name to a persistent DO identity:

```
"app"                 → DO instance (always the same one)
"workspace:ws-456"    → DO instance (always the same one)
```

This means:

- No mapping table is needed to find a DO — the name alone determines its identity and storage location
- Restarting the server or redeploying does not change which DO handles which data
- Docker volume persistence works because DO storage files are deterministically named

### DO Bindings

| Binding Name | Class        | Role                                                          |
| ------------ | ------------ | ------------------------------------------------------------- |
| `DATABASE`   | `DatabaseDO` | Business data (static, per-user, per-workspace, etc.)         |
| `AUTH`       | `AuthDO`     | Legacy empty shell (returns 410 Gone; all auth handled by D1) |
| `DATABASE_LIVE` | `DatabaseLiveDO` | DB subscription streaming and server broadcast                |
| `ROOMS`      | `RoomsDO`    | Room state, presence, broadcast channels                      |
| `LOGS`       | `LogsDO`     | Analytics log aggregation (Docker/self-hosted)                |

## Cloudflare Edge Deployment

The production deployment mode. Worker code runs at 300+ edge locations worldwide.

```bash
npx edgebase deploy
```

The deploy process:

1. Bundle `edgebase.config.ts` into the Worker
2. Provision internal D1 bindings (`AUTH_DB`, `CONTROL_DB`) plus any user-defined native resources (`config.kv`, `config.d1`, `config.vectorize`) via Wrangler CLI
3. For DB blocks or auth configured with `provider: 'postgres'`, provision or reuse the matching Hyperdrive bindings automatically (legacy `provider: 'neon'` configs are still accepted during transition)
4. If `captcha: true`, auto-provision a Cloudflare Turnstile widget and store the secret
5. Generate temporary `wrangler.toml` with all bindings
6. Run `wrangler deploy`
7. Generate Cloudflare Cron Triggers from the managed cron set (system cron `0 3 * * *` + user schedule crons + `cloudflare.extraCrons`)

Notes on config ownership:

- `edgebase.config.ts` is the source of truth for EdgeBase-managed topology during `dev` and `deploy`, including DB block routing, managed native-resource bindings, and deploy-managed cron triggers.
- `wrangler.toml` is treated as the base Cloudflare runtime template for Worker-level settings such as the Worker name, compatibility flags, assets, and advanced Wrangler-only fields.
- `wrangler.toml` `[triggers]` is generated deploy input, not a manually merged schedule registry.
- `cloudflare.extraCrons` adds extra wake-ups for the Worker's `scheduled()` handler; it does not automatically route execution into a specific App Function.

Infrastructure services:

- **D1**: Cloudflare's distributed SQLite (AUTH_DB — all auth data, CONTROL_DB — internal operational metadata)
- **Hyperdrive**: Auto-managed PostgreSQL connectivity for `provider: 'postgres'` blocks and auth (legacy `provider: 'neon'` configs still map here)
- **KV**: Cloudflare KV (ephemeral state: OAuth, WebSocket pending, push tokens)
- **R2**: Cloudflare R2 (file storage, $0 egress)
- **DO Storage**: Managed by Cloudflare (automatic replication and durability)

### Post-Deploy Verification

Treat deployment success and application readiness as separate checks.

After `edgebase deploy`, verify both:

- A public route such as `GET /api/functions/ping`
- A service-key-backed admin path that touches managed resources, such as `admin.sql('app', 'SELECT 1')` or `admin.auth.listUsers()`

This catches broken D1/KV/resource wiring that a public-only smoke test can miss.

Deploy also writes `.edgebase/cloudflare-deploy-manifest.json`. That manifest is the project-scoped source of truth for managed Cloudflare resources and is used later by cleanup and destroy flows.

### Worker Bundle Size

The EdgeBase server bundles to approximately **434 KB** (88 KB gzipped), well within Cloudflare's 10 MB limit for paid plans (~1% utilization).

## Docker Deployment

A single container includes the full EdgeBase stack — no sidecars, no external databases, no docker-compose orchestration:

```bash
npx edgebase docker run
```

### Persistence Path Mapping

All state persists under a single `/data` directory, which maps to a Docker Named Volume:

| Data              | Path           | Description                                       |
| ----------------- | -------------- | ------------------------------------------------- |
| D1 (Auth)         | `/data/v3/d1/` | AUTH_DB: auth data and indexes                    |
| D1 (Control)      | `/data/v3/d1/` | CONTROL_DB: plugin versions and internal metadata |
| DO SQLite         | `/data/v3/do/` | All DatabaseDO instances                          |
| KV (internal)     | `/data/v3/kv/` | OAuth state, WebSocket pending, push tokens       |
| R2 (files)        | `/data/v3/r2/` | Uploaded files                                    |
| KV (user-defined) | `/data/v3/kv/` | User-defined KV namespaces                        |
| D1 (user-defined) | `/data/v3/d1/` | User-defined D1 databases                         |

Because DO instances use deterministic name hashing, preserving the `/data` volume is sufficient to restore **all** state — all dynamically created Database DOs, all isolated tenant DOs, and D1 auth data.

### Docker Operations

```bash
# Build the container
npx edgebase docker build

# Run with persistent storage
npx edgebase docker run

# Or manually with Docker
docker run \
  -v edgebase-data:/data \
  --env-file .env.release \
  -p 8787:8787 \
  edgebase
```

### Environment Configuration

| Context              | Secrets Source                          |
| -------------------- | --------------------------------------- |
| Cloudflare Edge      | Workers Secrets (`wrangler secret put`) |
| Docker (development) | `.env.development` file                 |
| Docker (production)  | `.env.release` file                     |

### Health Check

Docker containers expose `GET /api/health` for liveness probes:

```yaml
# docker-compose.yml
healthcheck:
  test: ['CMD', 'curl', '-f', 'http://localhost:8787/api/health']
  interval: 30s
  timeout: 10s
  retries: 3
```

Use `/api/health` as a liveness signal only. For App Functions release verification, also call a real function route and at least one service-key-backed admin check.

## Node.js Direct Execution

The simplest mode — runs workerd via Miniflare directly on the host machine:

```bash
npx edgebase dev
```

This is the recommended mode for:

- **Local development**: Fast iteration with hot-reload
- **VPS deployment**: Run on any Linux/macOS server with Node.js

Infrastructure services are emulated locally:

- D1 → Local SQLite files (`.wrangler/state/v3/d1/`)
- KV → Local file-based KV
- R2 → Local file-based storage
- Rate Limiting Bindings → Miniflare emulation

## Architecture Separation

The Worker and Durable Objects have strictly separated responsibilities:

```
Worker (Hono)
  ├─ Middleware chain (error, logging, CORS, rate limit, auth, rules)
  ├─ Request routing
  └─ Policy enforcement
       │
       ├─→ D1 (AUTH_DB) ─── All auth data (users, sessions, tokens)
       ├─→ D1 (CONTROL_DB) ─ Internal operational metadata
       ├─→ Database DO ──── Business data (DB-block based isolation)
       ├─→ DatabaseLive DO ─ DB subscription streaming & server broadcast
       └─→ Rooms DO ──────── Room state, presence, broadcast channels
```

This separation limits **blast radius**: a D1 auth failure does not affect business data DOs, and vice versa. The Worker is stateless and restarts instantly; DOs hold state and recover automatically.

## Self-Hosting Cost

Docker deployment on a VPS is remarkably affordable because there is no external database server to run:

| Provider           | Spec             | Monthly Cost |
| ------------------ | ---------------- | ------------ |
| Hetzner CAX11      | 2 vCPU, 4 GB RAM | ~$4          |
| DigitalOcean Basic | 1 vCPU, 2 GB RAM | ~$6          |
| AWS Lightsail      | 1 vCPU, 1 GB RAM | ~$5          |

SQLite has no connection overhead, workerd uses approximately 50 MB of memory, and there is no separate database process. A single small VPS can handle thousands of concurrent users.

## Next Steps

- [**Architecture Overview**](./overview.md) — High-level request lifecycle
- [**Database Internals**](./database-internals.md) — Schema management and transactions inside DOs
- [**Cost Analysis**](/docs/why-edgebase/cost-analysis) — Detailed cost comparison across deployment modes
