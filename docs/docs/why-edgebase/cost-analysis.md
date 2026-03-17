---
sidebar_position: 1
---

# Cost Analysis

Why EdgeBase costs nearly $0 at scale — by design, not optimization — and how it compares to existing BaaS platforms.

## Three Generations of BaaS

### Generation 1 — Proprietary Cloud (2012~)

**Representative**: Firebase

- Proprietary database (Firestore/RTDB) with vendor-specific query language
- Fully managed — zero setup, excellent DX for prototyping
- Complete vendor lock-in — no self-hosting, no data portability
- Pricing scales steeply with usage (per-MAU auth, per-GB egress)

### Generation 2 — Open Database (2020~)

**Representative**: Supabase, PocketBase

- Standard databases (PostgreSQL, SQLite) with full SQL support
- Open source with self-hosting option
- Row-Level Security for multi-tenancy (logical isolation)
- Traditional server architecture — central database bottleneck at scale

### EdgeBase — Edge-Native Physical Isolation

- Embedded SQLite inside Durable Objects — no external database
- Physical isolation per tenant via DB blocks (`user:{id}`, `workspace:{id}`)
- Edge-native with ~0ms cold start at 300+ locations
- Three deployment modes: Edge, Docker, Node.js
- Deny-by-default access rules

## Architecture Comparison

| Aspect             | Firebase               | Supabase                 | PocketBase       | EdgeBase                          |
| ------------------ | ---------------------- | ------------------------ | ---------------- | --------------------------------- |
| **Database**       | Proprietary NoSQL      | PostgreSQL               | Embedded SQLite  | SQLite + PostgreSQL               |
| **Scaling model**  | Managed black box      | DB replicas (manual)     | Single process   | DB-block auto-distribution        |
| **Multi-tenancy**  | Collection per project | RLS (logical)            | RLS (logical)    | **Physical DO isolation**         |
| **Runtime**        | Proprietary cloud      | VM/Container             | Single Go binary | Edge (workerd)                    |
| **Cold start**     | ~100ms                 | ~200ms (connection pool) | ~0ms (embedded)  | **~0ms**                          |
| **Deployment**     | Google Cloud only      | Self-host possible       | Single binary    | **Edge / Docker / Node.js**       |
| **Vendor lock-in** | Complete               | Partial (PostgreSQL)     | None (SQLite)    | **None (workerd is open source)** |
| **SQL support**    | No (Firestore QL)      | Full PostgreSQL          | Full SQLite      | Full SQLite + PostgreSQL          |

## Why So Cheap?

EdgeBase doesn't optimize expensive operations — it eliminates the conditions that create them.

### Authentication: $0

Traditional BaaS charges per-MAU because the server manages sessions per user. EdgeBase issues a JWT on sign-in, then every subsequent request verifies the JWT signature locally (pure cryptography, no network call, no Durable Object hit). Whether you have 100 or 10 million users, the per-request auth cost is the same. The Workers Paid plan ($5/mo) includes 25B D1 reads and 50M writes per month — auth is effectively unlimited. And if you ever outgrow D1 limits, a single config change switches auth to Neon PostgreSQL with no code modifications.

### Egress: $0

Cloudflare R2 charges $0 for egress bandwidth. This is a structural property of R2's architecture, not a promotional offer. A social media app serving 1 TB of images per month pays $0 in bandwidth.

### Compute: Pay-per-Request

Durable Objects activate on demand. Idle DOs cost $0. When a user returns, the DO activates in milliseconds. You only pay for actual request processing.

### Database Subscriptions: ~300× Cheaper

Traditional BaaS platforms charge per-message with per-recipient billing. If one user sends a message that fans out to 20 recipients, that counts as 20 billed messages. EdgeBase Database Subscriptions are structurally different:

1. **20:1 WebSocket billing** — Cloudflare counts 20 incoming WebSocket messages as 1 Durable Object request. Outgoing messages are free.
2. **Fan-out inside the DO** — when a message broadcasts to 20 recipients, EdgeBase iterates through WebSocket handles inside a single Durable Object. There is no per-recipient API call or message queue charge.
3. **Hibernation API** — idle WebSocket connections are suspended at $0 duration cost. A chat app with 10,000 connected but idle users pays nothing until messages actually flow.

The result at 900M fan-out messages/month:

| Platform     | Billing Model                    | Cost    |
| ------------ | -------------------------------- | ------- |
| **Supabase** | $2.50/M messages (per-recipient) | ~$2,263 |
| **Firebase** | $1/GB downloaded                 | ~$5,400 |
| **Ably**     | $2.50/M messages                 | ~$2,250 |
| **EdgeBase** | DO requests only (20:1 ratio)    | **~$7** |

### Storage: No Server to Manage

SQLite embedded in each DO eliminates the need for database server provisioning, connection pooling, or replica configuration. Cloudflare handles durability.

## Cost Comparison: 1M MAU Social App

| Component               | Firebase       | Supabase       | Appwrite       | EdgeBase (Edge)               |
| ----------------------- | -------------- | -------------- | -------------- | ----------------------------- |
| **Auth** (1M MAU)       | $4,415         | $2,925         | $2,400         | **$0**                        |
| **DB Reads** (90M)      | $27            | included       | included       | **$0**                        |
| **DB Writes** (24M)     | $21.60         | included       | included       | **$0**                        |
| **DB Deletes** (3M)     | $0.30          | included       | included       | **$0**                        |
| **DB Storage** (50 GB)  | $7.50          | $5             | included       | **$9**                        |
| **Compute / Functions** | $125           | $61            | $58            | **$55**                       |
| **File Storage** (2 TB) | $52            | $40            | $53            | **$80**                       |
| **Egress** (100 TB)     | $12,000        | $8,978         | $14,700        | **$0**                        |
| **DB Subscriptions** (900M msg) | $5,400         | $2,263         | $630           | **included in Compute (~$7)** |
| **Room** (mini-game)\*  | $2,700         | $13,500        | $3,800         | **$10**                       |
| **Base fee**            | —              | $25            | $25            | $5 (account-level)            |
| **Total**               | **$24,748/mo** | **$27,797/mo** | **$21,666/mo** | **~$159/mo**                  |
| **Annual**              | **$296,976**   | **$333,564**   | **$259,992**   | **~$1,908**                   |

\* Room (mini-game): No competing BaaS offers ephemeral in-memory rooms. Costs assume DB writes+reads (Firebase), per-recipient message billing (Supabase), or DB reads/writes with bandwidth (Appwrite). EdgeBase Room runs entirely in DO in-memory with no per-message billing, only Duration charges.

Without the optional Room workload, the same core social-app scenario lands around **~$149/mo** on EdgeBase. The **~$159/mo** total above includes the mini-game Room workload.

<details>
<summary>Scenario assumptions & unit price sources</summary>

**Scenario — social app with image feeds, likes, comments, real-time notifications, and casual mini-games:**
1M MAU, ~100K DAU (10%), 30 DB reads / 8 writes / 1 delete per user per day, 50 GB database, 2 TB file storage (user images/video), 100 TB monthly egress (feed image serving), 900M database subscription messages/month (each user action fans out to ~10 recipients — other providers count per-recipient, EdgeBase broadcasts inside a DO with no per-message billing).

**Room (mini-game)** — 10K DAU play 3 rounds/day, 4 players per room, 5 state updates/sec per player, average 5 min per game. Monthly: 1.35B sends, 4.05B receives (fan-out to 3 other players). Firebase/Supabase/Appwrite have no ephemeral room feature — costs assume DB writes+reads (Firebase: writes $0.9/M + reads $0.36/M), per-recipient message billing (Supabase: $2.50/M counting both send and receive), or DB reads/writes (Appwrite: writes $0.10/100K + reads $0.06/100K). EdgeBase Room runs entirely in DO in-memory with no per-message billing, only Duration charges (~250 concurrent rooms x 5MB x 8h/day).

**Unit prices (as of February 2026):**

- Firebase Auth — 50K free, 50K-100K at $0.0055, 100K-1M at $0.0046/MAU. Firestore — reads $0.03/100K, writes $0.09/100K, deletes $0.01/100K, storage $0.15/GB. Cloud Storage $0.026/GB, egress $0.12/GB.
- Supabase Pro $25/mo — 100K MAU included, overage $0.00325/MAU. Egress $0.09/GB (250 GB included). File storage $0.021/GB (100 GB included). Database Subscriptions $2.50/M messages (5M included).
- Appwrite Pro $25/mo — 200K MAU included, overage $3/1K users. Bandwidth $15/100 GB (2 TB included). Storage $2.80/100 GB (150 GB included). DB reads $0.06/100K (1.75M included), DB writes $0.10/100K (750K included).
- EdgeBase (Cloudflare) — Workers $5/mo base, requests $0.30/M (10M included), CPU $0.02/M ms (30M ms included). DO requests $0.15/M (1M included), duration $12.50/M GB-s (400K GB-s included), storage $0.20/GB (5 GB included). DO row reads $0.001/M (25B included), row writes $1.00/M (50M included). R2 storage $0.015/GB (10 GB included), Class A $4.50/M (1M included), Class B $0.36/M (10M included), egress $0.

</details>

| Cost Category         | Why It Exists Elsewhere                   | Why It Doesn't Exist in EdgeBase             |
| --------------------- | ----------------------------------------- | -------------------------------------------- |
| Per-user auth pricing | Server manages sessions per user          | JWT verified locally, no session storage     |
| Egress bandwidth      | AWS/GCP charge for outbound traffic       | R2 has $0 egress by design                   |
| Idle database cost    | DB server runs 24/7 regardless of traffic | DOs hibernate when unused                    |
| Connection pooling    | Shared DB needs connection management     | Each DO has its own embedded SQLite          |
| Replica management    | Read scaling requires read replicas       | DB-block pattern distributes reads naturally |

:::warning Disclaimer
Prices reflect each provider's published rates as of February 2026 and may change. **Egress costs assume direct origin serving without a CDN.** In practice, placing any CDN (Cloudflare, Fastly, CloudFront) in front of Firebase or Supabase can reduce their egress bills by 90%+. EdgeBase uses R2 with $0 egress natively, so no CDN is needed for cost savings. Actual costs vary by usage pattern, region, and negotiated contracts. Verify against each provider's official pricing page before making decisions.
:::

## Cost at Every Scale

The cost advantage is not limited to the 1M MAU scenario. It widens at every scale:

| Scale        | Firebase (Auth only) | Supabase (Pro base) | EdgeBase (Edge) | EdgeBase (Docker) |
| ------------ | -------------------- | ------------------- | --------------- | ----------------- |
| **1K MAU**   | ~$0 (free tier)      | $25                 | $5              | ~$4 (VPS)         |
| **10K MAU**  | ~$70                 | $25                 | $5              | ~$4               |
| **100K MAU** | ~$550                | $25                 | $5              | ~$6               |
| **1M MAU**   | ~$4,700              | ~$2,950             | $5              | ~$12              |
| **10M MAU**  | ~$46,000             | ~$32,000            | $5              | ~$40              |

_Auth cost only. Firebase charges per-MAU after 50K; Supabase charges $0.00325/MAU after 100K. EdgeBase auth is always $0 — JWT verification is local crypto with no session storage or per-user billing. The $5/mo Workers Paid plan is account-level — one subscription covers unlimited projects._

At small scales, Firebase's free tier is hard to beat. But the moment you cross 50K MAU or start serving media, EdgeBase's structural advantages ($0 per-MAU auth, $0 egress) create a widening gap. The cost curve stays flat because EdgeBase charges for compute, not for users.

## Self-Hosting Cost

For Docker deployments on a VPS:

| Provider           | Spec             | Monthly Cost |
| ------------------ | ---------------- | ------------ |
| Hetzner CAX11      | 2 vCPU, 4 GB RAM | ~$4          |
| DigitalOcean Basic | 1 vCPU, 2 GB RAM | ~$6          |
| AWS Lightsail      | 1 vCPU, 1 GB RAM | ~$5          |

A single small VPS can handle thousands of concurrent users because SQLite has no connection overhead, workerd is lightweight (~50 MB memory), and there's no separate database process to run.

## Deployment Flexibility

|                 | Firebase      | Supabase                 | PocketBase       | EdgeBase                          |
| --------------- | ------------- | ------------------------ | ---------------- | --------------------------------- |
| **Cloud**       | Google only   | AWS/GCP/Azure            | Any VPS          | **Cloudflare Edge (300+ cities)** |
| **Self-host**   | Impossible    | Complex (10+ containers) | Single binary    | **Single container or binary**    |
| **Development** | Emulators     | docker-compose           | Direct run       | **`npx edgebase dev`**            |
| **Migration**   | Vendor-locked | Export PostgreSQL        | Copy SQLite file | **`npx edgebase backup`**         |

EdgeBase achieves deployment flexibility because Cloudflare's `workerd` runtime is open source. The same code that runs on Cloudflare's global edge network runs identically in a Docker container or local Node.js process.

## Trade-offs

EdgeBase's architecture is not universally better. There are scenarios where other platforms excel:

| Scenario                                        | Better Choice                 | Why                                                                                                                                       |
| ----------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| PostGIS / geospatial queries                    | Supabase                      | SQLite lacks PostGIS extensions. EdgeBase's PostgreSQL provider gives you Postgres, but PostGIS setup still requires manual configuration.           |
| Zero-config prototype (1 day)                   | Firebase                      | Unmatched onboarding speed and documentation                                                                                              |
| Existing PostgreSQL ecosystem                   | Supabase                      | pg_vector, PostGIS, foreign data wrappers, etc. — though EdgeBase's PostgreSQL provider covers most general Postgres use cases.                       |
| Multi-statement transactions                    | Supabase                      | EdgeBase supports `transactionSync()` only — no `BEGIN`/`COMMIT`                                                                          |

:::tip PostgreSQL Provider
Cross-tenant analytics, complex SQL JOINs, and datasets exceeding 10 GB are all handled within EdgeBase by switching static DB blocks to `provider: 'postgres'` and supplying a connection-string env key. Dynamic multi-tenant blocks (workspace/user) each have a 10 GB limit per instance, which is rarely reached in practice. If you use Neon, the CLI and dev dashboard can provision that env key for you.
:::

## Where EdgeBase Excels

| Scenario                                        | Why EdgeBase Wins                                  |
| ----------------------------------------------- | -------------------------------------------------- |
| Per-user data (notes, settings, personal feeds) | `'user:{id}'` DB block — linear scaling, $0 auth   |
| B2B SaaS with tenant isolation                  | Physical isolation > RLS, GDPR deletion is trivial |
| High-traffic apps with egress                   | R2's $0 egress vs $0.09+/GB on others              |
| Edge-first applications                         | ~0ms cold start, 300+ global locations             |
| Self-hosting simplicity                         | `docker run` vs 10+ container docker-compose       |
| Cost-sensitive projects                         | ~$5/mo at 100K MAU vs $165+ elsewhere              |
