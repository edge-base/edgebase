---
sidebar_position: 3
---

# Database Internals

How EdgeBase manages schemas, migrations, transactions, and IDs across its SQLite backends: D1 for single-instance blocks, embedded SQLite inside Durable Objects for dynamic blocks.

## Lazy Schema Init

Single-instance DB blocks default to D1, while dynamic blocks can create thousands or millions of Durable Object instances (one per user, workspace, or tenant). Running a centralized migration across every backing database is impractical, so EdgeBase uses **Lazy Schema Init**: each D1 database or DO-backed SQLite instance synchronizes its own schema on the first request it receives after a deployment.

```
DB instance receives a request
  │
  ▼
Query _meta table for stored schemaHash
  │
  ▼
Compare with the deployed config's schema hash
  │
  ├─ Match → Skip schema init, proceed to request
  │
  └─ Mismatch → Run Lazy Schema Init:
       ├─ CREATE TABLE (if table doesn't exist)
       ├─ ADD COLUMN (if column is missing)
       └─ Save new hash to _meta
  │
  ▼
FTS5 + Index self-healing (always runs):
  ├─ Create FTS5 virtual tables + triggers (IF NOT EXISTS)
  └─ Create indexes (IF NOT EXISTS)
  │
  ▼
Proceed to handle the request
```

This means inactive databases are never touched, and each backing database only runs schema initialization when its state is actually out of date.

### Schema Hash Comparison

EdgeBase uses a **djb2 hash** of the serialized config to detect schema changes — not version numbers. Version numbers are difficult to synchronize across a multi-database environment where each DO may have been created at a different time. A hash comparison is stateless and always produces the correct result:

```
hash = djb2(JSON.stringify(config, Object.keys(config).sort()))
```

The hash covers top-level configuration keys (schema, FTS settings, indexes, migrations), so adding a new FTS field or index triggers re-initialization on the next request.

### What Lazy Schema Init Handles

| Change Type     | Handled? | Method                   |
| --------------- | -------- | ------------------------ |
| New table       | Yes      | `CREATE TABLE`           |
| New column      | Yes      | `ALTER TABLE ADD COLUMN` |
| Column deletion | No       | Requires Lazy Migration  |
| Column rename   | No       | Requires Lazy Migration  |
| Type change     | No       | Requires Lazy Migration  |

Lazy Schema Init is **non-destructive** by design. It only adds — never removes or modifies existing columns.

## Lazy Migration

For destructive schema changes (column deletion, renaming, type changes), EdgeBase provides a **version-based sequential migration** system:

```typescript
export default defineConfig({
  databases: {
    app: {
      tables: {
        posts: {
          schema: {
            /* current final schema */
          },
          migrations: [
            {
              version: 2,
              description: 'Rename column',
              up: 'ALTER TABLE posts RENAME COLUMN username TO displayName',
            },
            {
              version: 3,
              description: 'Remove legacy field',
              up: 'ALTER TABLE posts DROP COLUMN legacyField',
            },
          ],
        },
      },
    },
  },
});
```

Migrations execute after Lazy Schema Init, on the first request to each backing database:

```
Lazy Schema Init completes
  │
  ▼
Read migration_version from _meta (default: 1)
  │
  ▼
Run unapplied migrations sequentially
  │  (each migration in its own transaction)
  │
  ├─ Success → Save new migration_version to _meta
  └─ Failure → Stop at failed migration, return 503
               (retries on next request)
```

**New D1/DO instances** (created after migrations are defined) skip all migrations entirely — Lazy Schema Init creates the final schema directly, and the latest migration version is recorded immediately.

:::tip
Use a **single SQL statement per migration**. Constructs with `BEGIN...END` blocks (like `CREATE TRIGGER`) should be split into separate migration entries.
:::

### Build-Time Destructive Change Detection

The CLI (`edgebase deploy` / `edgebase dev`) compares the current config against a schema snapshot file (`edgebase-schema.lock.json`) to detect destructive changes before deployment:

- **Release mode** (`release: true`): Shows a migration guide and blocks deployment until migrations are written
- **Development mode** (`release: false`): Offers a choice between resetting the database or writing migrations

## Transaction Model

For DO-backed DB blocks, Durable Objects do not support SQL-level `BEGIN`/`COMMIT` transactions. Instead, EdgeBase uses the **`transactionSync()` API** provided by the DO runtime:

```typescript
ctx.storage.transactionSync(() => {
  // All operations in this callback are atomic
  for (const item of body.inserts) {
    /* INSERT */
  }
  for (const { id, data } of body.updates) {
    /* UPDATE */
  }
  for (const id of body.deletes) {
    /* DELETE */
  }
});
```

This provides all-or-nothing atomicity for batch operations (up to 500 items per batch). If any operation fails — including security rule evaluation — the entire batch rolls back.

| Operation                   | Transaction Scope                                                     |
| --------------------------- | --------------------------------------------------------------------- |
| Single CRUD                 | Implicit single-statement transaction                                 |
| Batch (up to 500)           | `transactionSync()` all-or-nothing                                    |
| Batch over 500              | SDK auto-chunks into 500-item batches; each chunk is independent      |
| `deleteMany` / `updateMany` | Server-side `batch-by-filter`; each 500-item iteration is independent |

:::warning
For operations exceeding 500 items, each chunk is an independent transaction. If a middle chunk fails, previous chunks remain committed (partial failure). Use the direct batch API with 500 or fewer items when you need a single atomic transaction.
:::

## DB Block Topology

EdgeBase routes DB blocks by isolation mode and provider:

### Single-Instance DB

Single-instance blocks such as `app` default to D1:

```
Config key:  "app"
Backend:     D1 (DB_D1_APP)
Route shape: /api/db/app/tables/...
```

All tables in the block share the same backing database, so they can `JOIN` each other.

If you explicitly set `provider: 'do'`, the same single-instance block routes to one Durable Object-backed SQLite database instead.

If you set `provider: 'postgres'`, the block routes to a Worker-side PostgreSQL handler backed by a Hyperdrive binding. It is still one logical DB block, so tables inside that block can still `JOIN` each other, but the storage engine is PostgreSQL rather than SQLite. Legacy `provider: 'neon'` configs continue to map to the same PostgreSQL path during the transition.

### Dynamic DB (Per-User, Per-Workspace, etc.)

Dynamic blocks route to one Durable Object per `(namespace, instanceId)` pair:

```
Config key: "workspace"
DO name:    "workspace:ws-456"
```

```
Config key: "user"
DO name:    "user:abc-123"
```

Each instance gets its own isolated SQLite database. Tables within the same DB block share one backing database per instance and can `JOIN` each other. Tables across different DB blocks, or across different instances of the same block, cannot.

Today, dynamic multi-tenant blocks remain Durable Object-backed SQLite. PostgreSQL providers are intended for single-instance blocks such as `app` or analytics-oriented namespaces.

### System DO (Eliminated)

The `db:_system` DO has been eliminated. Its former responsibilities are now handled by:

| Former Table    | New Location             | Notes                                           |
| --------------- | ------------------------ | ----------------------------------------------- |
| `_users_public` | D1 (AUTH_DB)             | Public user profiles, synced on auth operations |
| `_schedules`    | Cloudflare Cron Triggers | Each schedule is a separate cron trigger        |
| `_meta`         | D1 (CONTROL_DB)          | Plugin versions and control-plane metadata      |

## UUID v7 Implementation

All auto-generated primary keys use **UUID v7** (RFC 9562, Monotonic Random):

```typescript
import { generateId } from '../lib/uuid.js';
const id = generateId(); // 0190a6f2-d42f-7b3c-8e1a-4f5d6e7f8a9b
```

UUID v7 embeds a millisecond-precision timestamp in the high bits, which provides two key advantages:

1. **Natural time ordering**: Records sort chronologically by their primary key, making cursor-based pagination efficient without a separate index:

```sql
-- Cursor pagination (no offset needed)
SELECT * FROM posts WHERE id > :lastId ORDER BY id ASC LIMIT 20;

-- Latest records
SELECT * FROM posts ORDER BY id DESC LIMIT 20;
```

2. **Monotonic guarantee**: In the single-threaded DO environment, the monotonic counter naturally prevents collisions within the same millisecond.

The implementation is manual (`crypto.getRandomValues()` based) with zero external dependencies.

## Auto Fields

Every table automatically includes three fields unless explicitly disabled:

| Field       | Type               | Behavior                                                                                                     |
| ----------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `id`        | `TEXT PRIMARY KEY` | UUID v7, auto-generated if not provided. Client-specified values are accepted (for offline-first scenarios). |
| `createdAt` | `TEXT` (ISO 8601)  | Set once on creation. Server timestamp always overrides client values.                                       |
| `updatedAt` | `TEXT` (ISO 8601)  | Updated on every write with the server timestamp.                                                            |

Auto fields cannot have their **type** overridden — the server generates them with hardcoded logic (`generateId()` for UUID v7, `new Date().toISOString()` for timestamps). You can disable any auto field by setting it to `false` in your schema:

```typescript
posts: {
  schema: {
    id: false,      // Disable auto-generated ID (you must provide your own)
    createdAt: false, // Disable auto timestamp
    title: 'string',
    body: 'text',
  },
}
```

## Full-Text Search

EdgeBase uses SQLite **FTS5** with the `trigram` tokenizer by default:

```sql
CREATE VIRTUAL TABLE posts_fts USING fts5(title, content, tokenize='trigram');
```

### Why Trigram?

The default `unicode61` tokenizer splits text on whitespace, which does not work for CJK languages (Chinese, Japanese, Korean) where words are not space-delimited. The `trigram` tokenizer splits text into 3-character segments, providing functional search across all languages.

### FTS Self-Healing

FTS virtual tables and their associated triggers are recreated on every schema init pass (using `IF NOT EXISTS`), regardless of whether the schema hash changed. This ensures FTS stays in sync even after edge cases like partial initialization failures.

### Search API

```typescript
const results = await client.db('app').table('posts').search('query text').limit(20).getList();
```

The server executes a FTS5 `MATCH` query, wrapping the search term in double quotes to ensure literal matching (preventing special characters like `-` or `*` from being interpreted as FTS5 operators).

## System Tables

Each DO type manages its own system tables, created via hardcoded DDL on initialization:

| System Table            | Owner            | Purpose                                           |
| ----------------------- | ---------------- | ------------------------------------------------- |
| `_meta`                 | All Database DOs | Schema hash, migration version, metadata          |
| `_meta`                 | D1 (CONTROL_DB)  | Plugin versions and internal operational metadata |
| `_users`                | D1 (AUTH_DB)     | User credentials and profiles                     |
| `_sessions`             | D1 (AUTH_DB)     | Session and token management                      |
| `_oauth_accounts`       | D1 (AUTH_DB)     | OAuth provider account linking                    |
| `_email_tokens`         | D1 (AUTH_DB)     | Email verification and password reset tokens      |
| `_users_public`         | D1 (AUTH_DB)     | Public user profiles                              |
| `_mfa_factors`          | D1 (AUTH_DB)     | Multi-factor authentication factors               |
| `_mfa_recovery_codes`   | D1 (AUTH_DB)     | MFA recovery codes                                |
| `_webauthn_credentials` | D1 (AUTH_DB)     | Passkey/WebAuthn credentials                      |
| `_phone_index`          | D1 (AUTH_DB)     | Phone number uniqueness index                     |

System tables are independent of the user's config — they are always present and managed internally.

## Schemaless Mode

The `schema` field in table configuration is optional. When omitted, EdgeBase operates in **schemaless mode**:

- On INSERT/UPDATE, if a field doesn't have a corresponding column, the server auto-executes `ALTER TABLE ADD COLUMN ... TEXT`
- All values are stored as TEXT with no type validation
- Auto fields (`id`, `createdAt`, `updatedAt`) still work normally

This is useful for rapid prototyping, but production applications should define schemas for type safety and validation.

## Next Steps

- [**Isolation & Multi-tenancy**](/docs/why-edgebase/data-isolation) — How DB blocks create physical data separation
- [**Deployment Architecture**](./deployment.md) — How the same codebase runs across Edge, Docker, and Node.js
