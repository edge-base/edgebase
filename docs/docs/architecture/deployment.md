---
sidebar_position: 5
---

# Deployment Architecture

How EdgeBase runs the same application bundle across Cloudflare Edge and the
protected Docker/pack self-host launchers, with `edgebase dev` reserved for
local development.

## Three Deployment Modes

EdgeBase runs on `workerd`, Cloudflare's open-source Workers runtime. Because `workerd` is available as a standalone binary, the exact same Worker + Durable Object architecture runs in three environments:

| Mode                 | Command                   | Runtime               | Best For                           |
| -------------------- | ------------------------- | --------------------- | ---------------------------------- |
| **Cloudflare Edge**  | `npx edgebase deploy`     | Cloudflare Workers    | Production, global ~0ms cold start |
| **Docker**           | `npx edgebase docker run` | workerd in container  | Self-hosted, full data control     |
| **Local development** | `npx edgebase dev`      | workerd via Miniflare | Hot reload and local iteration     |

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
| `AUTH`       | `AuthDO`     | Key-sharded, atomically consumed OAuth state and link continuations; legacy backup routes remain compatibility no-ops |
| `DATABASE_LIVE` | `DatabaseLiveDO` | DB subscription streaming and server broadcast                |
| `ROOMS`      | `RoomsDO`    | Room state, presence, broadcast channels                      |
| `LOGS`       | `LogsDO`     | Analytics log aggregation (Docker/self-hosted)                |

## Cloudflare Edge Deployment

The production deployment mode. Worker code runs at 300+ edge locations worldwide.

```bash
npx edgebase deploy
```

The deploy process:

1. Build the app bundle and its immutable managed-schedule manifest from filesystem functions, plugin functions, `cloudflare.extraCrons`, and system schedules
2. Provision internal D1 bindings (`AUTH_DB`, `CONTROL_DB`) plus any user-defined native resources (`config.kv`, `config.d1`, `config.vectorize`) via Wrangler CLI
3. For DB blocks or auth configured with `provider: 'postgres'`, provision or reuse the matching Hyperdrive bindings automatically (legacy `provider: 'neon'` configs are still accepted during transition)
4. If `captcha: true`, acquire an expiring remote `CONTROL_DB` lease, re-read authoritative Worker state, keep the live Turnstile site-key/secret tuple, stage `old∪new` hostnames with pre/post live-version checks, publish the version-bound Worker secret and exact runtime policy, renew the lease after Wrangler and immediately before the final PUT, verify the reported version alone serves 100% of traffic, finalize exact widget hostnames, and release the lease
5. Generate temporary `wrangler.toml` with all bindings and the expression-deduplicated cron list from `edgebase-app.json`
6. Run `wrangler deploy`

Notes on config ownership:

- Source files and evaluated `edgebase.config.ts` declarations are build inputs. The resulting `edgebase-app.json` schedule manifest is the single deploy/package authority for managed cron triggers.
- `wrangler.toml` is treated as the base Cloudflare runtime template for Worker-level settings such as the Worker name, compatibility flags, assets, and advanced Wrangler-only fields.
- `wrangler.toml` `[triggers]` is generated deploy input, not a manually merged schedule registry.
- `cloudflare.extraCrons` adds extra wake-ups for the Worker's `scheduled()` handler; it does not automatically route execution into a specific App Function.
- Docker and directory/portable pack manifests carry the same schedule manifest digest as the app bundle, so self-hosted runtimes do not rescan project source.
- Generated Docker and pack launchers verify the manifest plus SHA-256/byte contracts for the gateway, schedule supervisor, and Docker entrypoint before launch. They bind Wrangler to loopback HTTP, prove ownership through a fresh authenticated control secret, validate schedule state, run the first supervisor pass, and only then open the external gateway. Invalid regular schedule-state content is moved to one fixed `.corrupt` sibling and rebuilt through the manifest plus durable delivery authority; path, permission, or quarantine failures stay fatal. The gateway is the sole public listener and blocks every internal/scheduled control path for HTTP and WebSocket requests.
- Self-host launchers log each initial schedule outcome once. Later successful passes stay quiet; failed or ambiguous attempts remain error-level records with their target and boundary identity, and the first later success for that target emits one recovery record.
- `edgebase dev` and the server package's `dev:raw` command are development tools, not claimed self-host deployment launchers. They intentionally omit the external gateway and long-lived self-host schedule supervisor. Cloudflare deploys instead use provider cron events; production self-hosting must use the generated Docker or pack launcher.

Infrastructure services:

- **D1**: Cloudflare's distributed SQLite (AUTH_DB — all auth data, CONTROL_DB — internal operational metadata)
- **Hyperdrive**: Auto-managed PostgreSQL connectivity for `provider: 'postgres'` blocks and auth (legacy `provider: 'neon'` configs still map here)
- **KV**: Cloudflare KV (ephemeral caches, WebSocket pending, push tokens, and a best-effort legacy OAuth migration mirror)
- **R2**: Cloudflare R2 (file storage, $0 egress)
- **DO Storage**: Managed by Cloudflare (database/room state plus key-sharded, atomically consumed OAuth callback authority)

### Post-Deploy Verification

Treat deployment success and application readiness as separate checks.

After `edgebase deploy`, verify both:

- A public route such as `GET /api/functions/ping`
- A service-key-backed admin path that touches managed resources, such as `admin.sql('app', 'SELECT 1')` or `admin.auth.listUsers()`

This catches broken D1/KV/resource wiring that a public-only smoke test can miss.

Deploy also writes `.edgebase/cloudflare-deploy-manifest.json`. That manifest is the project-scoped source of truth for managed Cloudflare resources and is used later by cleanup and destroy flows.

The manifest is a fail-closed trust boundary: only a bounded regular file with
valid account, Worker, resource ID, ownership, and source fields is accepted.
A v1 manifest preserves identity compatibility but grants no resource deletion
authority unless an operator explicitly acknowledges untracked recovery.
Destroy uses only a name-bound `workers.dev` origin recorded by deployment for
automatic Storage cleanup; custom URLs need a separate explicit override.

Account-global auto-provisioned resources are isolated by Worker. KV namespace,
D1 database, default R2 bucket, Vectorize index, and Hyperdrive config names
include a deterministic, length-bounded Worker identity; newly provisioned
resources for two Workers in the same Cloudflare account do not collide merely
because their config bindings or database names match. Older EdgeBase releases
used account-global or truncation-only legacy names. Deploy
reuses a legacy resource only when the previous local deploy manifest belongs
to the current Cloudflare account and proves the same binding (and, when
recorded, the same resource ID). Without that
proof, a new project creates its own Worker-scoped resource instead of adopting
another project's legacy resource.

Provisioning is fail-closed. EdgeBase must successfully list and validate the
current resource inventory, create or resolve every requested binding, and
parse every returned resource ID before Wrangler can publish the Worker. An
authentication error, timeout, malformed Wrangler response, missing PostgreSQL
connection string, unsupported plan, or failed resource create aborts the
deployment rather than publishing a Worker with partial bindings. Preserve
`.edgebase/cloudflare-deploy-manifest.json` when migrating an older deployment
that must keep using its legacy resources.

### Worker Bundle Size

The EdgeBase server bundles to approximately **434 KB** (88 KB gzipped), well within Cloudflare's 10 MB limit for paid plans (~1% utilization).

## Docker Deployment

A single container includes the full EdgeBase stack — no sidecars, no external databases, no docker-compose orchestration:

```bash
npx edgebase docker run
```

The generated container exposes only the gateway port. Wrangler listens on a
separate loopback-only HTTP port, and the container will not open external
admission if the authenticated runtime readiness check, runtime-asset digest,
schedule manifest, or non-recoverable schedule-state filesystem/quarantine
check fails. Invalid regular schedule-state content is quarantined and rebuilt
before admission. `LOCAL_PROTOCOL=https`
terminates TLS at this gateway and requires `HTTPS_CERT_PATH` plus
`HTTPS_KEY_PATH`. When a reverse proxy terminates TLS, list only its exact peer
addresses in `EDGEBASE_TRUSTED_PROXY_CIDRS`; untrusted peers cannot supply
forwarded client, protocol, or host authority. The launcher also injects a
fresh internal gateway proof into every Worker request, so a client cannot make
forged forwarding headers authoritative by copying the public header name.

Custom Dockerfiles remain supported only when the final image still launches
the generated protected entrypoint. `edgebase docker build` checks the final
Dockerfile stage, the built image's effective JSON `Entrypoint`/`Cmd`, and the
required bundle files. A shell-form command, a later command that shadows the
entrypoint, or an image that bypasses
`.edgebase/self-host/self-host-docker-entrypoint.mjs` is rejected. Raw custom
Wrangler containers are outside the supported production self-host contract.

### Persistence Path Mapping

All state persists under a single `/data` directory, which maps to a Docker Named Volume:

| Data              | Path           | Description                                       |
| ----------------- | -------------- | ------------------------------------------------- |
| D1 (Auth)         | `/data/v3/d1/` | AUTH_DB: auth data and indexes                    |
| D1 (Control)      | `/data/v3/d1/` | CONTROL_DB: plugin versions and internal metadata |
| DO SQLite         | `/data/v3/do/` | Database/room instances and atomic OAuth state    |
| KV (internal)     | `/data/v3/kv/` | Caches, WebSocket pending, push tokens, legacy OAuth mirror |
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

Docker and pack gateways expose `GET /__edgebase/health` as the protected
runtime readiness endpoint:

```yaml
# docker-compose.yml
healthcheck:
  test: ['CMD', 'curl', '-f', 'http://localhost:8787/__edgebase/health']
  interval: 30s
  timeout: 10s
  retries: 3
```

The response uses schema version 1 and reports `outcome: "ok"` or
`"degraded"` with the scheduler status when admission and structural scheduler
readiness are available. It returns `503` with `outcome: "blocked"` before
admission, after a structural scheduler failure, or during shutdown. A
degraded item is visible but does not make the structurally healthy runtime
unreachable. `/api/health`, when your app defines it, remains an application
check rather than launcher readiness. For release verification, also call a
real function route and at least one service-key-backed admin check.

## Local Node.js Development

This development mode runs workerd via Miniflare directly on the host machine:

```bash
npx edgebase dev
```

Use it for fast local iteration and hot reload. It does not install the
production self-host gateway, authenticated control plane, durable schedule
supervisor, or bounded shutdown ownership. For a Node-distributed production
artifact, use `npx edgebase pack`; for a container, use
`npx edgebase docker run`. The server package's `dev:raw` command is also a
development tool and is not a supported production launcher.

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
