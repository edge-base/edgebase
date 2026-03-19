---
sidebar_position: 12
---

# Limits

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Technical limits for EdgeBase Database. Limits marked **configurable** can be changed in `edgebase.config.ts`. All others are platform constraints.

## Storage

| Limit | Value | Notes |
|-------|-------|-------|
| Single-instance DB block (default D1) | **500 MB / database (Free)**, **10 GB / database (Paid)** | Cloudflare D1 database size limit depends on Workers plan |
| Dynamic DB block (DO-backed SQLite) | **10 GB / instance** | SQLite-backed Durable Object storage limit |
| Docker / Node.js | Disk-bound | Limited only by available disk space |

## Operations

| Limit | Default | Configurable | Notes |
|-------|---------|:---:|-------|
| Batch size (inserts + updates + deletes) | **500** per request | No | All-or-nothing transaction via `transactionSync()` |
| `batch-by-filter` per iteration | **500** rows | No | SDK auto-repeats until `processed === 0` (max 100 iterations) |
| `insertMany` chunk size | **500** | No | SDK auto-chunks; each chunk is an independent transaction |
| Rule evaluation timeout (Worker-level) | **50 ms** | No | Fail-closed — timeout = deny. Applies to insert/update/delete access rule checks evaluated in the Worker. |
| Rule evaluation timeout (DB-level) | **2 000 ms** | No | Fail-closed — timeout = deny. Applies to DB access rules evaluated in the Worker middleware (rules.ts) for read/list operations. The longer timeout accommodates cold-start latency. |
| OR filter conditions | **5** per `.or()` group | No | |
| Default page size | **20** rows | Yes | `limit` query parameter |
| Max page size | **No enforcement** (default 20, recommended max 500) | No | Batch operations enforce 500-item limit separately |

## Backend-Specific Cloudflare Limits

These apply when you deploy on Cloudflare Edge.

| Backend | Limit | Value | Notes |
|---------|-------|-------|-------|
| D1 | Queries per Worker invocation | **50 (Free)**, **1,000 (Paid)** | Relevant to raw SQL or unusually chatty server-side flows |
| D1 | Simultaneous open connections per Worker invocation | **6** | Relevant to `admin.d1()` or custom SQL usage |
| D1 / DO SQLite | Max columns per table | **100** | Cloudflare SQLite platform limit |
| D1 / DO SQLite | Max row or BLOB size | **2 MB** | Includes large JSON/text payloads |
| D1 / DO SQLite | Max SQL statement length | **100 KB** | Mostly relevant to raw SQL and generated queries |
| D1 / DO SQLite | Max bound parameters per query | **100** | Mostly relevant to raw SQL |
| D1 / DO SQLite | Max `LIKE` / `GLOB` pattern length | **50 bytes** | Inherited Cloudflare SQLite safeguard |

## Schema

| Limit | Value | Notes |
|-------|-------|-------|
| Auto fields | `id`, `createdAt`, `updatedAt` | Auto-injected if not defined; type override not allowed, only `false` to disable |
| ID format | UUID v7 | Client-specified IDs allowed |
| FTS tokenizer | `trigram` | Supports CJK languages; configured per table in `fts` field |
| Cross-DB-block JOINs | **Not supported** | Each DB block is a separate SQLite database |
| Multi-statement DB block transactions | **Not supported** | Use batch APIs; DB block CRUD is not an exposed raw `BEGIN`/`COMMIT` surface |
| Destructive schema changes | Migration required | `ALTER TABLE DROP COLUMN`, type changes, etc. require explicit migrations |

## Rate Limiting

| Group | Default | Key | Configurable |
|-------|---------|-----|:---:|
| `db` | **100 req / 60s** | IP | Yes |
| `global` | **10,000,000 req / 60s** | IP | Yes |

Service Key requests bypass EdgeBase's app-level rate limits entirely.

That bypass behavior is the same across all Admin SDKs.

:::tip Self-hosting
When running on Docker or Node.js, Cloudflare-specific D1 and Durable Object storage ceilings do not apply. Storage is limited only by disk space. API-level limits such as batch size, default page size, and access-rule behavior remain the same.
:::
