---
sidebar_label: Overview
slug: /why-edgebase
title: Why EdgeBase?
sidebar_position: 0
---

# Why EdgeBase?

EdgeBase is an **open-source edge-native BaaS built on Workers, Durable Objects, D1, and R2**. Instead of centering everything on a single app server and single database, EdgeBase composes distributed serverless primitives for auth, database, realtime, storage, and functions. Shared blocks can also switch to PostgreSQL when you need conventional Postgres semantics.

That architecture is why EdgeBase can pair no egress or bandwidth fees, ~0ms cold starts, and scale-out by design.

---

## Scale-Out by Design

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

## Costs Track Compute, Not Users

The real fear for startups: start free, app goes viral, next month's bill is catastrophic. EdgeBase eliminates this structurally.

| Component                                 | Firebase         | Supabase         | **EdgeBase**                  |
| ----------------------------------------- | ---------------- | ---------------- | ----------------------------- |
| Auth (1M MAU)                             | $4,415           | $2,925           | **$0**                        |
| Egress (100 TB)                           | $12,000          | $8,978           | **$0**                        |
| DB Subscriptions (900M msg)               | $5,400           | $2,263           | **Included in compute (~$7)** |
| Idle instances                            | Server runs 24/7 | Server runs 24/7 | **$0**                        |
| **Total (1M MAU social app, core stack)** | **$22,048/mo**   | **$14,297/mo**   | **~$149/mo**                  |

**Why?** Because the architecture changes which line items exist in the first place:

- **No per-MAU auth fee** — ordinary requests verify JWTs locally; D1 stores
  durable auth records and a key-sharded Durable Object atomically coordinates
  OAuth state. Normal infrastructure usage still applies.
- **No egress or bandwidth fees** — R2 serves files with $0 egress, and Workers/D1 do not add separate transfer or throughput billing. Realtime stays inside DO compute instead of creating a separate per-recipient bill.
- **Database subscriptions stay inside compute** — WebSocket broadcast happens inside a DO, so the billing model is compute + ops rather than a separate per-recipient realtime product.
- **Idle $0** — Durable Objects hibernate. No traffic = no cost.
- **Cold start ~0ms** — V8 isolates boot in under a millisecond. No container spin-up, no runtime initialization. Your API responds instantly even after hours of inactivity.

That **~$149/mo** figure is the core social-app stack (auth + DB + storage + database subscriptions). Add a casual Room mini-game workload and the same scenario rises to about **~$159/mo**.

[Full cost analysis →](/docs/why-edgebase/cost-analysis)

---

## Same App, Three Deploy Modes

`workerd`, Cloudflare's edge runtime, is open source. The same code runs in development and production with zero changes.

```bash
npx edgebase dev          # Start locally (like PocketBase)
npx edgebase deploy       # Deploy to 300+ edge locations globally
npx edgebase docker run   # Self-host in a single container
```

|                 | PocketBase             | Supabase                        | **EdgeBase**             |
| --------------- | ---------------------- | ------------------------------- | ------------------------ |
| **Start**       | Single binary          | docker-compose (10+ containers) | **`npx edgebase dev`**   |
| **Scale**       | Single process ceiling | Manual (replicas, pooling)      | **Scale-out by design**  |
| **Edge deploy** | No                     | No                              | **Yes (300+ cities)**    |
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

## Contract and Drift Guardrails

EdgeBase keeps its spec-backed HTTP surface close to the server implementation.
Hono routes and Zod schemas feed the OpenAPI document, which in turn generates
the transport core shared across the SDKs.

```
Server route definition (Hono + Zod)
    │
    ├──→ Runtime validation       (where a route declares a Zod schema)
    ├──→ OpenAPI document         (spec-backed routes)
    ├──→ Generated SDK cores      (HTTP method/path/query/body bindings)
    └──→ Generated smoke tests    (regenerated and diff-checked in CI)
```

Public SDK clients also contain hand-written behavior such as token storage,
auth side effects, database subscriptions, Room, push, CAPTCHA, and App
Functions helpers. Those surfaces require deliberate implementation and tests;
code generation alone cannot guarantee their parity.

**When adding a new spec-backed endpoint**, the repository workflow is:

| Step | What happens |
| --- | --- |
| Define route and schema | The server owns the runtime behavior and OpenAPI contract |
| Regenerate | SDK HTTP cores and generated smoke tests are updated from OpenAPI |
| Expose public behavior | Hand-written client entrypoints are updated where needed |
| Add conformance coverage | Language-specific tests cover the public surface |
| Run CI drift checks | Regeneration must leave the committed generated paths clean |

**What this means for you:**

- **Generated transport drift is difficult to miss.** CI regenerates the cores
  and smoke tests and rejects committed-output differences.
- **Runtime inputs are validated where route schemas declare the contract.**
- **Public client parity remains test-driven.** Hand-written platform behavior
  is covered by SDK unit, E2E, and role-contract suites rather than assumed.
- **Performance and security have dedicated checks.** Their result belongs to
  the exact commit and CI run, not to a permanent blanket certification.

The generated core therefore makes HTTP contract drift hard; it does not make
every public SDK surface automatically identical. See
[SDK Architecture](/docs/sdks/architecture) and
[SDK Verification Matrix](/docs/sdks/verification-matrix) for the exact model
and checked-in evidence.

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
| **Scaling**            |      Manual       |  Manual (replicas)  | Single process limit | **Scale-out by design**  |
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

---

## Why It Also Fits AI Coding

This architecture also makes EdgeBase a strong fit for AI-assisted development. Instead of splitting your backend across dashboard clicks, policy DSLs, and project-side state, EdgeBase keeps more of the contract in code.

Schema, access rules, hooks, functions, and type generation can stay in one repo and one TypeScript workflow. That lets an agent update the backend in one patch and makes review, diffs, and iteration much simpler.

For the practical routing rules that keep agents on the right SDK and trust boundary, see [Use EdgeBase With AI](/docs/getting-started/ai).
