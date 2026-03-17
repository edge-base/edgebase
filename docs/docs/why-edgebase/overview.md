---
sidebar_label: Overview
slug: /why-edgebase
title: Why EdgeBase?
sidebar_position: 0
---
# Why EdgeBase?

EdgeBase is the **first Backend-as-a-Service built entirely on serverless edge infrastructure**. Every other BaaS — Firebase, Supabase, Appwrite, PocketBase — runs on traditional server architecture: a central database, a container, or a single process. EdgeBase runs Auth, Database, Storage, and Functions natively on Cloudflare Workers and Durable Objects.

This single architectural decision is why everything else is different.

---

## Zero Scaling Effort

Traditional BaaS platforms funnel all traffic through a single database. When your app grows, you deal with connection pooling, read replicas, database sharding, and capacity planning. EdgeBase has none of this.

Dynamic DB blocks give each user, workspace, or tenant its own independent Durable Object with an embedded SQLite database. Single-instance blocks can stay on D1. More users = more instances, not more load on a bottleneck. **10 users and 1 billion users run the same code, same config, zero changes.**

```
Traditional BaaS:              EdgeBase:

All users ──▶ Single DB        User A ──▶ DO (SQLite)
              (bottleneck)     User B ──▶ DO (SQLite)
              ▼                User C ──▶ DO (SQLite)
         Need replicas?           ...
         Need sharding?        User 1B ──▶ DO (SQLite)
         Need pooling?
                               Nothing to configure.
                               Nothing to migrate.
```

| Active Instances | Writes/sec per DO | Total Platform Writes/sec |
| ---------------- | ----------------- | ------------------------- |
| 1,000            | 500               | 500,000                   |
| 100,000          | 500               | 50,000,000                |
| 1,000,000,000    | 500               | 500,000,000,000           |

No shared locks. No connection pool limits. No contention.

---

## No Cost Explosion

The real fear for startups: start free, app goes viral, next month's bill is catastrophic. EdgeBase eliminates this structurally.

| Component                                 | Firebase         | Supabase         | **EdgeBase**                  |
| ----------------------------------------- | ---------------- | ---------------- | ----------------------------- |
| Auth (1M MAU)                             | $4,415           | $2,925           | **$0**                        |
| Egress (100 TB)                           | $12,000          | $8,978           | **$0**                        |
| DB Subscriptions (900M msg)               | $5,400           | $2,263           | **Included in compute (~$7)** |
| Idle instances                            | Server runs 24/7 | Server runs 24/7 | **$0**                        |
| **Total (1M MAU social app, core stack)** | **$22,048/mo**   | **$14,297/mo**   | **~$149/mo**                  |

**Why?** Because serverless edge architecture eliminates the cost structures that other platforms are built on:

- **Auth $0** — JWT verified locally (pure crypto), no session server. D1 included allowance (25B reads/month) handles all auth data. Outgrow D1? Switch to Neon PostgreSQL with one config change.
- **Egress $0** — Cloudflare charges zero egress across the entire stack: R2 (Storage), D1 (Auth DB), Workers (compute), Durable Objects (database & database subscriptions), and WebSocket traffic. This is by design, not a promotional offer.
- **Database Subscriptions ~300x cheaper** — WebSocket broadcast inside a DO. No per-recipient billing.
- **Idle $0** — Durable Objects hibernate. No traffic = no cost.
- **Cold start ~0ms** — V8 isolates boot in under a millisecond. No container spin-up, no runtime initialization. Your API responds instantly even after hours of inactivity.

That **~$149/mo** figure is the core social-app stack (auth + DB + storage + database subscriptions). Add a casual Room mini-game workload and the same scenario rises to about **~$159/mo**.

[Full cost analysis →](/docs/why-edgebase/cost-analysis)

---

## One Command to Start, One Command to Deploy

`workerd`, Cloudflare's edge runtime, is open source. The same code runs in development and production with zero changes.

```bash
npx edgebase dev          # Start locally (like PocketBase)
npx edgebase deploy       # Deploy to 330+ edge locations globally
npx edgebase docker run   # Self-host in a single container
```

|                 | PocketBase             | Supabase                        | **EdgeBase**             |
| --------------- | ---------------------- | ------------------------------- | ------------------------ |
| **Start**       | Single binary          | docker-compose (10+ containers) | **`npx edgebase dev`**   |
| **Scale**       | Single process ceiling | Manual (replicas, pooling)      | **Automatic (infinite)** |
| **Edge deploy** | No                     | No                              | **Yes (330+ cities)**    |
| **Cold start**  | ~0ms                   | ~500ms                          | **~0ms**                 |

---

## Physical Isolation — For Free

This isn't a feature we built. It's a natural consequence of the architecture.

Since each tenant is a separate Durable Object with its own SQLite, data isolation is physical, not logical. There's no RLS policy to misconfigure, no WHERE clause to forget.

|                        | Traditional BaaS                  | EdgeBase                   |
| ---------------------- | --------------------------------- | -------------------------- |
| **Isolation**          | RLS policy (can be misconfigured) | Separate process + storage |
| **SQL injection risk** | Exposes all tenants               | Only one tenant accessible |
| **Noisy neighbor**     | Shared DB = shared performance    | Independent performance    |
| **GDPR deletion**      | DELETE across every table         | Delete the DO — done       |

[Learn more about data isolation →](/docs/why-edgebase/data-isolation)

---

## Built-in Multiplayer Room

No other BaaS has a built-in server-authoritative real-time state channel. Firebase, Supabase, and Appwrite all require a separate game server.

EdgeBase Room is possible because Durable Objects are stateful, single-threaded servers — exactly what a game room needs:

- **Server-authoritative state** — clients send actions, server validates and mutates
- **Delta broadcasting** — only changed fields sent, not full state
- **Three state areas** — shared, player (private), server-only
- **Zero idle cost** — hibernates when empty

[Explore Room →](/docs/room)

---

## Architectural Quality Guarantee

Most BaaS platforms break silently. You update the server, forget to update an SDK, and a mobile app crashes in production. Or the backend team adds a field but the admin dashboard doesn't know about it. EdgeBase eliminates these failures structurally.

**Server code is the spec.** Every API endpoint is defined with Hono + Zod. The route definition is simultaneously the runtime validator, the OpenAPI spec, and the SDK generation source. There's no separate spec to maintain. There's nothing to forget to update.

```
Server route definition (Hono + Zod)
    │
    ├──→ Runtime validation    (Zod rejects invalid requests automatically)
    ├──→ Generated SDK cores   (14 languages, never hand-written)
    ├──→ 129 E2E smoke tests    (auto-generated from the spec)
    └──→ CI blocks any drift    (generated code ≠ committed code → PR rejected)
```

**When you add a new API endpoint**, all of the following happen automatically — you only write the server route:

| Step                      | What happens                    | Who does it |
| ------------------------- | ------------------------------- | ----------- |
| OpenAPI spec updates      | Extracted from route definition | Automatic   |
| 14 language SDKs update   | Core regenerated from spec      | Automatic   |
| Smoke tests added         | Generated from spec             | Automatic   |
| Runtime validation active | Zod schema in route             | Automatic   |
| Missing test detected     | Meta-test export scan           | CI blocks   |

**What this means for you:**

- **Every SDK always matches the server.** Not "eventually" — structurally. It's the same spec.
- **API changes can't break silently.** Zod validates every request and response at runtime.
- **Performance regressions are caught.** CI benchmarks block PRs that exceed P95 thresholds.
- **Security is tested, not assumed.** 57 security tests cover IDOR, token manipulation, and scope violations.

|                               | Other BaaS         | **EdgeBase**                |
| ----------------------------- | ------------------ | --------------------------- |
| **SDK sync**                  | Manual (weeks lag) | **Automatic (same spec)**   |
| **Runtime validation**        | Optional           | **Always on (Zod)**         |
| **Breaking change detection** | Hope & pray        | **CI blocks automatically** |
| **SDK count sustainable?**    | 3-5 is hard        | **30 packages, zero drift** |

---

## 30+ SDK packages across 14 languages

**Client**: JavaScript (Web & React Native), Dart, Swift, Kotlin, Java, C# (Unity), C++ (Unreal)

**Admin**: JavaScript, Dart, Kotlin, Java, Scala, Python, Go, PHP, Rust, C#, Ruby, Elixir

[Browse all SDKs →](/docs/sdks)

---

## Feature Comparison

|                        |     Firebase      |      Supabase       |      PocketBase      |       **EdgeBase**       |
| ---------------------- | :---------------: | :-----------------: | :------------------: | :----------------------: |
| **Architecture**       |    Central DB     |     Central DB      |    Single process    |   **Serverless edge**    |
| **Scaling**            |      Manual       |  Manual (replicas)  | Single process limit | **Automatic (infinite)** |
| **Deploy**             |   Managed only    | Managed / Self-host |      Self-host       | **Edge / Docker / Node** |
| **Database**           | Firestore (NoSQL) |     PostgreSQL      |        SQLite        | **SQLite + PostgreSQL**  |
| **Auth cost** (1M MAU) |      $4,415       |       $2,925        |         Free         |         **Free**         |
| **Egress**             |     $0.12/GB      |      $0.09/GB       |     Server cost      |          **$0**          |
| **Cold start**         |      Seconds      |         ~1s         |         ~0ms         |         **~0ms**         |
| **Multiplayer Room**   |        ❌         |         ❌          |          ❌          |       **Built-in**       |
| **Push Notifications** |     FCM only      |         ❌          |          ❌          |       **Built-in**       |
| **Full-text search**   |        ❌         |       pg_trgm       |          ❌          |         **FTS5**         |
| **SDK auto-sync**      |     ❌ Manual     |      ❌ Manual      |      ❌ Manual       |    **Auto (OpenAPI)**    |
| **Runtime validation** |        ❌         |         ❌          |          ❌          |   **Zod (always on)**    |
| **License**            |    Proprietary    |     Apache-2.0      |         MIT          |         **MIT**          |
