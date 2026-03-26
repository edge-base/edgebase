---
sidebar_position: 100
sidebar_label: FAQ
---

# FAQ

## Why is EdgeBase so much cheaper than Firebase or Supabase?

It's not optimization — it's a different cost structure. EdgeBase runs on Cloudflare's serverless edge, which eliminates three major cost categories that other platforms are built on:

- **Auth $0** — JWT is verified locally using cryptography. There's no session server, no per-user billing. Whether you have 100 or 10 million users, auth costs the same: nothing.
- **Egress $0** — Cloudflare R2 charges zero egress by design. This is a structural property of R2, not a promotional offer.
- **Idle $0** — Durable Objects hibernate when unused. No traffic = no cost. Traditional BaaS runs a database server 24/7 regardless.
- **Database Subscriptions ~300× cheaper** — WebSocket messages broadcast inside a single Durable Object. There's no per-recipient billing. Cloudflare also counts 20 incoming WebSocket messages as 1 DO request.

In a 1M MAU social app scenario, the core stack lands around ~$149/mo on EdgeBase, or ~$159/mo if you also run a casual Room mini-game. Competing platforms land around $14,000–$25,000/mo. See the [full cost analysis](/docs/why-edgebase/cost-analysis) for unit prices, scenario details, and disclaimers.

## Why is EdgeBase fast?

Two reasons:

1. **V8 isolates, not containers.** Cloudflare Workers run on V8 isolates that are pre-warmed at 300+ edge locations worldwide. There's no container boot, no runtime initialization. Cold start is ~0ms.
2. **SQLite is in-process.** The database runs in the same thread as the application — no network round-trip to a separate database server. Single-query latency is microseconds, not milliseconds.

|                |   Firebase    |   Supabase    |    EdgeBase     |
| -------------- | :-----------: | :-----------: | :-------------: |
| Cold start     |    Seconds    |      ~1s      |      ~0ms       |
| DB access      | Network (ms)  | Network (ms)  | In-process (μs) |
| Edge locations | Single region | Single region |   300+ cities   |

## Am I locked into Cloudflare?

No. EdgeBase runs on [workerd](https://github.com/cloudflare/workerd), Cloudflare's open-source JavaScript runtime. The same code runs in three environments:

| Mode        | Command                   | Requires Cloudflare? |
| ----------- | ------------------------- | :------------------: |
| **Edge**    | `npx edgebase deploy`     |         Yes          |
| **Docker**  | `npx edgebase docker run` |          No          |
| **Node.js** | `npx edgebase dev`        |          No          |

Same code, same behavior. You can start on Docker, move to Edge later, or go back — `npx edgebase backup` handles cross-environment migration. There's no proprietary API or data format.

## How much does it cost to self-host with Docker?

A small VPS is enough:

| Provider           | Spec             | Monthly Cost |
| ------------------ | ---------------- | ------------ |
| Hetzner CAX11      | 2 vCPU, 4 GB RAM | ~$4          |
| DigitalOcean Basic | 1 vCPU, 2 GB RAM | ~$6          |
| AWS Lightsail      | 1 vCPU, 1 GB RAM | ~$5          |

SQLite has no connection overhead, workerd uses ~50 MB of memory, and there's no separate database process. A single small VPS can handle thousands of concurrent users. The 10 GB per-DO storage limit also doesn't apply in Docker — storage is limited only by disk space.

See the [Self-Hosting Guide](/docs/getting-started/self-hosting) for setup instructions.

## When should I use EdgeBase instead of Firebase / Supabase / PocketBase?

**EdgeBase is a strong fit for:**

| Scenario                               | Why                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------ |
| Per-user data (notes, settings, feeds) | Each user gets a physically isolated database. Linear scaling, $0 auth.  |
| B2B SaaS with tenant isolation         | Physical isolation is stronger than RLS. GDPR deletion = delete the DO.  |
| High-traffic apps serving media        | R2's $0 egress vs $0.09–$0.12/GB elsewhere.                              |
| Edge-first applications                | ~0ms cold start at 300+ locations.                                       |
| Self-hosting simplicity                | `docker run` vs 10+ container docker-compose.                            |
| Multiplayer / real-time games          | Built-in Room with server-authoritative state — no separate game server. |

**PostgreSQL-specific notes:**

| Scenario                      | EdgeBase approach                                      | Notes                                                                                                         |
| ----------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Geospatial queries (PostGIS)  | Switch the block to `provider: 'postgres'`             | EdgeBase's PostgreSQL provider gives you Postgres, but PostGIS setup still requires manual configuration.    |
| Existing PostgreSQL ecosystem | Use PostgreSQL-backed blocks for shared/static data    | Covers most general Postgres use cases; some extension-heavy workflows may still require direct setup.       |
| Multi-statement transactions  | Plan around EdgeBase's `transactionSync()` model       | The app-facing DB API does not expose raw `BEGIN`/`COMMIT`, even when the backing provider is PostgreSQL.   |

**Other platforms may be a better fit for:**

| Scenario                       | Better Choice | Why                                                     |
| ------------------------------ | ------------- | ------------------------------------------------------- |
| Zero-config prototype in 1 day | Firebase      | Unmatched onboarding speed and documentation ecosystem. |

:::tip PostgreSQL Provider
For shared/static DB blocks that need cross-tenant analytics, unlimited storage, or full PostgreSQL capabilities, switch to `provider: 'postgres'` and add a connection-string env key such as `DB_POSTGRES_ANALYTICS_URL`. No SDK or application code changes are required. The optional Neon helper can provision or reconnect that env value for you.
:::

## How much write throughput can a single Durable Object handle?

A single DO processes requests serially (single-threaded) and handles approximately **200–1,000 writes/sec**. This sounds low, but the architecture distributes load across many independent instances:

| Active DO Instances | Writes/sec per DO | Total Platform Writes/sec |
| ------------------- | ----------------- | ------------------------- |
| 1,000               | 500               | 500,000                   |
| 100,000             | 500               | 50,000,000                |

The key insight is that EdgeBase uses **DB blocks** (`user:{id}`, `workspace:{id}`) to distribute data across DOs. Each user or tenant gets their own instance, so write throughput scales linearly with the number of instances.

**Where this is not enough:**

Each hot dynamic DB instance is still a single DO. If one workspace, tenant, or channel receives more than ~500 writes/sec, you need to shard that workload or use App Functions. Single-instance blocks such as `app` default to D1 unless you explicitly choose `provider: 'do'`.

For read-heavy global data (leaderboards, announcements), this is rarely a problem. For write-heavy global data (counters, feeds), consider restructuring to per-user blocks with periodic aggregation.

## Can I migrate from Firebase or Supabase?

Yes. See the [Migration Guide](/docs/guides/migration) for step-by-step instructions covering schema conversion, data export/import, auth provider setup, and SDK replacement for both Firebase and Supabase.

## Is EdgeBase open source?

Yes. EdgeBase is MIT licensed. The server, all 30+ SDK packages, the CLI, and the admin dashboard are all open source. You can self-host with no restrictions.

## Is it production-ready?

EdgeBase is under active development. The core features — Database, Auth, Storage, Functions, Room, Push — are implemented and tested (2,020+ integration tests, 10-layer defense system including mutation testing). That said, evaluate it for your use case and risk tolerance. The project uses semantic versioning and documents breaking changes.

## What database does EdgeBase use?

EdgeBase uses SQLite-backed engines throughout the stack: D1 by default for single-instance DB blocks, and embedded SQLite inside Durable Objects for isolated multi-tenant blocks. This means:

- **Full SQL support** — JOINs, subqueries, views, CTEs, window functions
- **FTS5 full-text search** — with trigram tokenizer (works with CJK and all languages)
- **No connection management** — no pooling, no max connections, no connection timeouts
- **In-process queries** — microsecond latency, not millisecond

The trade-off is no cross-DO JOINs between dynamic DB blocks. Each block (`user:{id}`, `workspace:{id}`) is an independent SQLite database. For cross-tenant analytics, place shared data in a static block with `provider: 'postgres'` — or use [App Functions](/docs/functions) to aggregate across DOs.

## How does multi-tenancy work?

EdgeBase uses **DB blocks** to physically isolate tenants. You declare them in `edgebase.config.ts`:

```typescript
'workspace:{id}': {
  access: {
    access(auth, id, ctx) { /* membership check */ },
  },
  tables: {
    documents: { schema: { title: 'string' } },
  },
}
```

Each workspace gets its own Durable Object with its own SQLite database. There's no RLS to configure, no WHERE clause to forget. Data leakage between tenants is structurally impossible.

See [Scaling & Data Isolation](/docs/why-edgebase/data-isolation) for details.

## How does auth work? Is it really free?

Yes, auth is free at any scale. Here's how:

1. **Sign-up / sign-in** goes directly to D1 (AUTH_DB), Cloudflare's serverless SQL database, which stores all auth data — users, sessions, OAuth accounts, email tokens. No Durable Object is involved. Even the Free plan includes 5M D1 reads and 100K writes per day — enough for most apps. The Workers Paid plan ($5/mo) raises this to 25B reads and 50M writes per month. If you ever outgrow D1 limits, a single config change switches auth to Neon PostgreSQL — no code modifications needed.
2. **Every subsequent request** verifies the JWT locally in the Worker using cryptographic signature verification. No Durable Object is contacted, no database is queried. This is why auth doesn't scale with user count.

Auth methods: Email/password, Magic Link, Email OTP, Passkeys (WebAuthn), 14 OAuth providers, Phone/SMS, Anonymous, MFA/TOTP. See [Authentication](/docs/authentication).

## What SDKs are available?

14 languages, 30+ packages:

- **Client SDKs** (browser, mobile, game engines): JavaScript (Web & React Native), Dart/Flutter, Swift, Kotlin (KMP), Java, C# (Unity), C++ (Unreal)
- **Admin SDKs** (server-side, Service Key auth): JavaScript, Dart, Kotlin, Java, Scala, Python, Go, PHP, Rust, C#, Ruby, Elixir

All SDKs are auto-generated from the same OpenAPI spec — they always match the server. See the [SDK Overview](/docs/sdks).

## How do access rules work?

EdgeBase uses **deny-by-default** access control. Every table, storage bucket, and room requires an explicit access policy:

```typescript
access: {
  read(auth, row) { return true },                         // Public read
  insert(auth) { return auth !== null },                    // Authenticated only
  update(auth, row) { return auth?.id === row.authorId },   // Owner only
  delete(auth) { return auth?.role === 'admin' },           // Admin only
}
```

Access rules are TypeScript functions bundled into the runtime. No `eval()`. Admin SDK requests with a Service Key bypass them. See [Access Rules](/docs/server/access-rules).

## Can multiple users share data?

Yes. Use a **static DB block** (`app`) for global data, or a **dynamic DB block** (`workspace:{id}`) for group-scoped data with membership checks:

- `app` — one database for all users (e.g., public posts, leaderboards)
- `user:{id}` — private per-user database
- `workspace:{id}` — one isolated database per group, with `access` rules that verify membership

See [Data Modeling Guide](/docs/guides/data-modeling) for patterns.

## Does EdgeBase support full-text search?

Yes. EdgeBase uses SQLite's **FTS5** with a trigram tokenizer. This means:

- Works with **all languages** including CJK (Chinese, Japanese, Korean)
- Substring matching (no need for exact word boundaries)
- Configured per table in `edgebase.config.ts`

```typescript
posts: {
  schema: { title: 'string', body: 'text' },
  fts: ['title', 'body'],   // Enable FTS on these columns
}
```

## How do database subscriptions and rooms work?

EdgeBase provides two real-time systems:

- **Database Subscriptions** — `onSnapshot()` on any database query. When data changes, the DatabaseDO notifies the DatabaseLiveDO via direct DO-to-DO communication (no Worker hop), and updates are pushed to all matching subscribers. Idle connections use Cloudflare's Hibernation API and cost $0. See [Database Subscriptions](/docs/database/subscriptions).
- **Room** — server-authoritative state channel with built-in members (presence), signals (pub/sub), and media metadata. See [Room](/docs/room).

|                  | Database Subscriptions                   | Room                                                              |
| ---------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| State management | Client-driven (DB writes trigger events) | Server-authoritative (clients send actions, server mutates state) |
| Use case         | Live feeds, dashboards                   | Games, collaboration, conferencing, chat                          |
| Idle cost        | $0 (Hibernation API)                     | $0 (Hibernation API)                                              |

## How do backups work?

Two methods:

1. **Volume copy** (fast, same-environment only): Copy the Docker volume or `.wrangler/state/` directory directly.
2. **CLI portable backup** (cross-environment): `npx edgebase backup create` exports all data as JSON. Supports `--include-secrets` (for environment migration) and `--include-storage` (for R2 files).

Restore: `npx edgebase backup restore --from backup.json`. Works across all three deployment modes (Edge ↔ Docker ↔ Node.js). See [Backup & Restore](/docs/guides/backup-restore).

## Is there a free tier?

On **Cloudflare Edge**: Yes — you can start on the Cloudflare Free plan. Core EdgeBase services use Workers, Durable Objects, D1, and KV. R2 also has free usage, but Cloudflare requires a separate R2 subscription / billing activation before first use.

<div className="docs-badge-row">
  <span className="docs-badge docs-badge--free">Free Plan</span>
  <span className="docs-badge docs-badge--setup">R2 Billing Setup</span>
</div>

| Resource | Free Plan | Paid Plan ($5/mo) |
|----------|-----------|-------------------|
| Workers requests | 100K / day | 10M / month |
| DO requests | 100K / day | 1M / month (+ overage) |
| DO SQLite storage | 5 GB total | 5 GB-month (+ overage) |
| D1 reads | 5M / day | 25B / month |
| R2 storage | 10 GB | 10 GB (+ overage) |
| KV reads | 100K / day | 10M / month (+ overage) |

Most EdgeBase features work on the Free plan. In practice, the paid plan is mainly about higher included usage rather than unlocking a separate core feature set.

For higher limits, the Workers Paid plan ($5/mo) is **account-level** — one subscription covers all your Workers, D1, DO, R2, and KV across unlimited projects.

On **Docker / Node.js**: Just the cost of your VPS (~$4–6/mo). No Cloudflare account needed.

## Where is my data stored?

- **Edge mode**: Cloudflare's global network. Durable Objects are automatically placed close to where they're most frequently accessed. R2 storage is globally distributed.
- **Docker / Node.js mode**: All data lives in a single `/data` directory on your server. Full data sovereignty — nothing leaves your machine.

## Does EdgeBase support GDPR compliance?

The architecture makes GDPR significantly easier:

- **Data isolation**: Each user/tenant is a separate Durable Object. No single shared tenant database with scattered user data.
- **Right to deletion**: Delete the user's DO — all their data is gone. No need to hunt through every table with `DELETE WHERE user_id = ?`.
- **Data portability**: Export a user's entire database with the backup CLI.
- **Self-hosting**: Run on Docker in your preferred region for full data sovereignty.
