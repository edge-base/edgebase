---
sidebar_position: 0
sidebar_label: Overview
slug: /architecture
---

# Architecture Overview

How EdgeBase processes every request — from HTTP entry to the correct storage backend.

## High-Level Architecture

```
Client SDK ──HTTP/WS──▶ Worker (Hono)
                            │
          ┌─────────────────┼─────────────────┬─────────────┐
          │                 │                 │             │
     DatabaseDO        D1 DB Blocks     D1 (AUTH_DB)    D1 (CONTROL_DB)   DatabaseLiveDO   RoomsDO      LogsDO
   (dynamic SQLite)  (single-instance)   (auth data)     (ops metadata)   (DB subs &       (rooms,      (structured
                                                                           broadcast)       presence,     logging)
                                                                                            broadcast ch.)
              │
        ┌─────┴─────┐
       R2           KV
   (File storage)  (Cache, OAuth,
                    Push Tokens)
```

Every request enters through a single **Cloudflare Worker** running Hono, which routes to the appropriate backend. Dynamic DB blocks use **DatabaseDO** with embedded SQLite, single-instance DB blocks default to **D1**, auth uses **AUTH_DB**, plugin/control-plane metadata uses **CONTROL_DB**, DB subscriptions and server broadcast use **DatabaseLiveDO**, rooms/presence/broadcast channels use **RoomsDO**, and structured logging uses **LogsDO**.

## Request Lifecycle

### Middleware Chain

Every HTTP request passes through a strict middleware chain before reaching any backend:

```
Request
  │
  ▼
Error Handler ─── Global error boundary, catches all exceptions
  │
  ▼
Logger ─────────── Request/response logging
  │
  ▼
CORS ───────────── Cross-origin resource sharing
  │
  ▼
Rate Limit ─────── 2-tier: software counter + Cloudflare Binding ceiling
  │
  ▼
Auth ───────────── JWT verification (local crypto, no DO call)             [/api/*]
  │
  ▼
Rules ──────────── Declarative access rules (TypeScript functions, deny-by-default)  [/api/db/*]
  │
  ▼
Internal Guard ─── Restricts /internal/* endpoints                         [/internal/*]
  │
  ▼
Route Handler ──── Routes to D1, DatabaseDO, PostgreSQL, DatabaseLiveDO, or RoomsDO
```

The ordering is intentional. Auth runs before Rules because access rules need the authenticated user ID to evaluate per-record permissions.

### Request → DB Block Routing

The Worker determines which backend to contact based on the DB block configuration:

```
GET /api/db/shared/tables/notes?filter=...

Worker:
  1. JWT verify (local crypto) → extract auth.id
  2. Resolve backend + database identity:
     - single-instance DB → D1 binding by default (e.g. DB_D1_SHARED)
     - dynamic DB         → DO name "user:{userId}" | "workspace:{wsId}"
     - postgres/neon      → Worker-side PostgreSQL handler
  3. Route request to the resolved backend
```

## Durable Object Types

### DatabaseDO

The workhorse for dynamic DB blocks. Each instance owns an embedded SQLite database.

| Responsibility    | Details                                                          |
| ----------------- | ---------------------------------------------------------------- |
| CRUD operations   | Create, read, update, delete with filtering, sorting, pagination |
| Schema management | Lazy table creation on first request, automatic migrations       |
| Full-text search  | FTS5 powered, configured per table                               |
| Access rules      | Evaluated per record using TypeScript functions                  |
| Event emission    | Notifies DatabaseLiveDO on data changes                          |

**Naming convention**: `{namespace}` (static, e.g. `shared`) or `{namespace}:{id}` (dynamic, e.g. `user:abc123`, `workspace:ws_456`)

A single DatabaseDO processes requests serially (single-threaded). This eliminates concurrency bugs but bounds throughput to ~200-1,000 writes/sec per instance. The DB-block pattern (`user:{id}`, `workspace:{id}`, etc.) distributes load across many independent DO instances.

### Auth (D1-First)

All authentication is handled by D1 (AUTH_DB) directly — no Durable Objects involved:

```
D1 (AUTH_DB) ── All auth data (users, sessions, OAuth, MFA, passkeys)
D1 (CONTROL_DB) ── Internal control-plane metadata (plugin versions, cleanup state)
```

The Worker routes auth requests directly to D1 via `auth-d1-service.ts` (~61 functions). The Auth DO binding (`AUTH`) exists only as an empty shell for Cloudflare migration compatibility (returns 410 Gone).

**Key design decision**: Data requests verify JWT locally and then go straight to the configured DB backend. No separate auth infrastructure hop is needed first.

### DatabaseLiveDO

Manages real-time DB subscription streaming and server-side broadcast via Cloudflare's **Hibernation API**:

| Responsibility    | Details                                                  |
| ------------------ | -------------------------------------------------------- |
| Subscriptions      | Collection change notifications with server-side filters |
| Server broadcast   | HTTP-based broadcast via `/api/db/broadcast`             |
| Hibernation        | Idle connections cost $0, wake on message                |

### RoomsDO

Server-authoritative real-time state channel for multiplayer games, collaborative editing, and live dashboards:

| Responsibility | Details                                                  |
| -------------- | -------------------------------------------------------- |
| Room state     | Shared, player, and server state areas                   |
| Members        | Online/offline user tracking per room (replaces presence)|
| Signals        | Arbitrary message passing between connected clients      |
| Hibernation    | Idle rooms cost $0, state persisted to DO Storage        |

## Auxiliary Storage

| Service | Role                                | Examples                                                                                                    |
| ------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **D1**  | Auth database (AUTH_DB)             | All auth data: users, sessions, OAuth, email tokens, MFA, passkeys, public profiles                         |
| **D1**  | Internal control plane (CONTROL_DB) | Plugin versions and other internal operational metadata                                                     |
| **KV**  | Ephemeral state cache               | OAuth state (300s), WebSocket pending (10s), multipart upload tracking (7d), email tokens, push tokens/logs |
| **R2**  | File storage                        | User uploads, signed URLs, multipart uploads                                                                |

All KV entries are TTL-based and self-healing — they regenerate naturally after expiration or data loss, requiring no backup.

## Three Deployment Modes

The same codebase runs identically across three environments because Cloudflare's `workerd` runtime is open source:

| Mode        | Command                   | Runtime               | Best For                  |
| ----------- | ------------------------- | --------------------- | ------------------------- |
| **Edge**    | `npx edgebase deploy`     | Cloudflare Workers    | Global, ~0ms cold start   |
| **Docker**  | `npx edgebase docker run` | workerd in container  | Self-hosted, full control |
| **Node.js** | `npx edgebase dev`        | workerd via Miniflare | Development, VPS          |

All state persists in a single `/data` directory (Docker) or Cloudflare's infrastructure (Edge). No external database server is required.

## Next Steps

- [**Isolation & Multi-tenancy**](/docs/why-edgebase/data-isolation) — How DB blocks create physical data separation
- [**Security Model**](./security-model.md) — 3-stage membership verification and attack prevention
- [**Cost Analysis**](/docs/why-edgebase/cost-analysis) — Why EdgeBase costs nearly $0 at scale and how it compares to Firebase, Supabase, and PocketBase
- [**Authentication Architecture**](./auth-architecture.md) — D1-first auth architecture and token lifecycle
- [**Database Internals**](./database-internals.md) — Lazy Schema Init, migrations, transactions, and UUID v7
- [**Database Subscriptions & Room Internals**](./database-live-internals.md) — WebSocket Hibernation, RESYNC, and server-authoritative rooms
- [**Deployment Architecture**](./deployment.md) — 3 deployment modes and config injection
- [**Rate Limiting**](./rate-limiting.md) — 2-layer defense, auth-specific protection, and WebSocket DDoS gate
