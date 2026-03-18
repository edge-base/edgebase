---
sidebar_position: 0
slug: /getting-started
---

# Introduction

**EdgeBase** is the first Backend-as-a-Service built entirely on serverless edge infrastructure. Auth, Database, Room, Storage, Functions — the entire stack runs natively on [workerd](https://github.com/cloudflare/workerd), Cloudflare's open-source runtime. This means automatic horizontal scaling with zero configuration, near-zero cost at any scale, and physical data isolation by default. It runs everywhere — on the cloud edge, in a Docker container, or directly on any Node.js server. No vendor lock-in, MIT licensed.

## Why EdgeBase?

| | Firebase | Supabase | PocketBase | **EdgeBase** |
|---|---|---|---|---|
| **Database** | NoSQL (Firestore) | PostgreSQL | SQLite | **SQLite + PostgreSQL** |
| **Auth Cost** | $275/100K MAU | Included in $25/mo | Free | **Free** |
| **Cold Start** | ~200ms | ~500ms | N/A | **~0ms** |
| **Egress** | $0.12/GB | $0.09/GB | Server-dependent | **$0** |
| **Self-Host** | No | Complex | Single binary | **3 ways** |
| **Live Subscriptions** | Yes | Yes | Yes | **Yes** |
| **Edge Deploy** | No | No | No | **Yes** |
| **Open Source** | No | Yes (AGPL) | Yes (MIT) | **Yes (MIT)** |

### Scales Automatically

Every other BaaS funnels traffic through a single database. When your app grows, you need replicas, connection pooling, and sharding. EdgeBase gives each user/tenant its own Durable Object with embedded SQLite — more users means more instances, not more load on a bottleneck. **10 users and 10 million users run the same code and config.**

### Runs Everywhere

Deploy your backend in whichever way suits your project:

| Mode | Command | Requirements | Best For |
|---|---|---|---|
| **Cloud Edge** | `npx edgebase deploy` | Cloudflare account | Production, global low-latency |
| **Docker** | `npx edgebase docker run` | Docker | Self-hosted, single container |
| **Node.js** | `npx edgebase dev` | Node.js | Local development, VPS |

Same code, same behavior across all three modes. No vendor lock-in.

### No Cost Explosion

Start free, scale without fear. No per-user auth charges (Firebase charges $4,415/mo at 1M MAU). No egress fees (R2 = $0). Idle instances cost $0 (DO Hibernation). Start at $5/month on the edge (account-level — covers unlimited projects), or self-host for free.

### 0ms Cold Start

Built on workerd -- your API responds instantly with no containers to spin up.

### Fully Open Source

MIT licensed. Export your data anytime. Run it anywhere.

## Core Features

- **Database** -- SQLite-backed storage across D1 and Durable Objects, with full SQL support including JOINs, FTS5 full-text search, and automatic schema management.

- **Authentication** -- Email/password, OAuth (14 providers: Google, GitHub, Apple, Discord, Microsoft, Facebook, Kakao, Naver, X, Reddit, Line, Slack, Spotify, Twitch), and anonymous auth. PBKDF2 password hashing via Web Crypto API.

- **Database Subscriptions** -- WebSocket-based `onSnapshot` subscriptions for live data changes with server-side filtering. Hibernation API for cost efficiency.

- **Room** -- Server-authoritative state synchronization with built-in members (presence), signals (pub/sub), and media metadata. Ideal for multiplayer, collaboration, and conferencing.

- **Storage** -- R2-backed file storage with $0 egress, signed URLs, multipart upload with resume, and per-bucket access rules.

- **Functions** -- Database triggers (`insert`, `update`, `delete`), authentication triggers (`beforeSignUp`, `onTokenRefresh`, etc.), cron-scheduled functions, and HTTP endpoints.

- **Push Notifications** -- Register devices, send to users/topics/devices, and broadcast. Managed via Service Key API.

- **Admin Dashboard** -- Built-in management UI at `/admin` for browsing data, managing users, and monitoring your backend.

## Architecture

```
Client SDK ──→ Worker (Hono) ──→ Durable Objects (isolated DB blocks, subscriptions, rooms)
                               ──→ D1 (auth + single-instance DB blocks)
                               ──→ R2 (File Storage)
                               ──→ KV (OAuth State, Cache)
```

DB blocks come in two types. **Single-instance** blocks (no instance ID) default to D1 — good for globally shared data. **Dynamic** blocks (`instance: true`) create a separate Durable Object per ID — good for isolated data. The block name is just a config key you choose; there are no reserved names.

- **Single-instance** (e.g., `app`, `catalog`, `public`) — one database, D1 by default.
- **Dynamic** (e.g., `mydata:{userId}`, `team:{teamId}`) — one Durable Object per ID, physically isolated.

Tables that need SQL JOINs share the same Durable Object by being defined under the same `databases.{namespace}.tables` block.

The same architecture runs identically on cloud edge, Docker, and Node.js. KV and R2 are emulated locally in Docker/Node.js mode.

## SDK Support

EdgeBase provides SDKs for **14 languages**:

| Language | Package | Registry |
|---|---|---|
| **JavaScript/TypeScript** | `@edgebase/web`, `@edgebase/react-native` | npm |
| **Flutter/Dart** | `edgebase_flutter` | pub.dev |
| **Swift (iOS)** | `edgebase-swift` | SPM |
| **Kotlin (Android)** | `dev.edgebase:edgebase-client-kotlin` | Maven Central |
| **Java (JVM)** | `dev.edgebase:edgebase-android-java` | Maven Central |
| **Scala (JVM)** | `dev.edgebase:edgebase-admin-scala` | Maven Central |
| **Python** | `edgebase` | PyPI |
| **C# (Unity/.NET)** | `EdgeBase` | NuGet / source copy |
| **Go** | `github.com/edge-base/sdk-go` | Go Modules |
| **PHP** | `edgebase/sdk` | Packagist |
| **Rust** | `edgebase-admin` | crates.io |
| **C++ (Unreal)** | Source distribution | GitHub Releases |
| **Ruby** | `edgebase_admin` | RubyGems |
| **Elixir** | `edgebase_admin` | Hex |

## Next Steps

- [**Quickstart**](/docs/getting-started/quickstart) -- Get running in 5 minutes
- [**Configuration**](/docs/getting-started/configuration) -- Set up your `edgebase.config.ts`
- [**Deployment**](/docs/getting-started/deployment) -- Choose your deployment mode
