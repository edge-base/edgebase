---
sidebar_position: 4
---

# Migrations

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

How EdgeBase handles schema evolution across D1-backed single-instance blocks and large fleets of dynamic Durable Object instances.

## Overview

EdgeBase uses a **Lazy Migration** architecture. Instead of running one central migration job across every backing database, each DB block syncs its schema on the first request it receives after a deploy. Single-instance blocks usually materialize once on D1, while dynamic blocks may fan out to thousands of Durable Object instances, so per-instance lazy migration is the practical model.

There are two categories of schema changes:

| Change Type | Example | Handling |
|-------------|---------|----------|
| **Non-destructive** | Add a new column, add a new table | Automatic (Lazy Schema Init) |
| **Destructive** | Rename column, delete column, change type | Manual migration required |

## Lazy Schema Init

Every time a DB block instance receives a request, it checks whether its schema is up to date:

```
DB block receives request
  → Read stored schemaHash from _meta table
  → Compute djb2 hash of the deployed config schema
  → If hashes match → skip, serve request
  → If hashes differ → run Lazy Schema Init:
      - Missing tables → CREATE TABLE
      - Missing columns → ALTER TABLE ADD COLUMN
      - FTS5 virtual tables + triggers → CREATE IF NOT EXISTS
      - Indexes → CREATE INDEX IF NOT EXISTS
  → Store new hash in _meta
```

The hash is computed using `djb2` over `JSON.stringify(deepSort({ schema: config.schema ?? {} }))`. It only hashes the `schema` field (column definitions), not the full table config. This means changes to `fts`, `indexes`, or `migrations` alone do not trigger a hash mismatch — those are re-checked on every request regardless of hash.

### What Lazy Schema Init Handles

- **New tables**: `CREATE TABLE` with the full schema
- **New columns**: `ALTER TABLE ADD COLUMN` with defaults
- **FTS5 setup**: Virtual table and insert/update/delete triggers (always re-checked regardless of hash)
- **Index creation**: `CREATE INDEX IF NOT EXISTS` (always re-checked regardless of hash)

### What It Does Not Handle

- Column renames
- Column deletions
- Column type changes
- Table deletions

These **destructive changes** require explicit migrations.

## Destructive Changes (Lazy Migration)

For changes that Lazy Schema Init cannot handle, define migrations in `edgebase.config.ts`:

```typescript
// edgebase.config.ts
export default defineConfig({
  databases: {
    app: {
      tables: {
        posts: {
          schema: {
            // Current final schema (after all migrations)
            title: { type: 'string', required: true },
            displayName: { type: 'string' },
            content: { type: 'text' },
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

### How Migration Execution Works

```
DB block receives request
  → Lazy Schema Init runs first (hash comparison)
  → Lazy Migration runs next:
      → Read migration_version from _meta (default: 1)
      → Execute unapplied migrations in order
      → Each migration is executed directly (not wrapped in an explicit transaction)
      → On success: update migration_version in _meta
      → On failure: stop at the failed migration, return 503
      → Next request retries from the failed migration
```

### New Instances Skip Migrations

When a DB block instance is created for the first time (no `migration_version` key in `_meta`), it has never stored any data. Lazy Schema Init creates the table with the **final schema** directly. All migrations are skipped, and the latest migration version is recorded in `_meta`.

This means new D1 databases or new Durable Object instances never execute historical migrations -- they always start with the current schema.

### Migration Rules

| Rule | Detail |
|------|--------|
| **Single SQL statement** | Use one SQL statement per migration entry |
| **Version numbers** | Must be sequential integers starting from 2 (version 1 is the initial schema) |
| **Schema field** | Always reflects the current final state (after all migrations) |
| **`BEGIN...END` blocks** | `CREATE TRIGGER` or similar multi-statement blocks must be in separate migration entries |
| **Direct execution** | Each migration is executed via `execMulti()` (no explicit transaction wrapper) |
| **Failure behavior** | Failed migration returns HTTP 503; the DO retries on next request |
| **`upPg` (optional)** | PostgreSQL-specific migration SQL. When present, `upPg` is used instead of `up` for PostgreSQL-backed databases (e.g., Neon). Use this when the migration SQL differs between SQLite and PostgreSQL. |

:::tip
Keep each migration to a single SQL statement. If you need a `CREATE TRIGGER` with a `BEGIN...END` block, put it in its own migration entry.
:::

## Schema Locking

When you run `edgebase deploy` or `edgebase dev`, the CLI compares your current schema against a saved snapshot file (`edgebase-schema.lock.json`) to detect destructive changes **before** they reach production.

### What Gets Detected

- **Column deleted** -- a field was removed from the schema
- **Column type changed** -- a field's type was modified (e.g., `string` to `number`)
- **Table deleted** -- an entire table was removed from config

### How It Works

```
edgebase deploy / edgebase dev
  → Load edgebase-schema.lock.json (first deploy = no snapshot, just saves)
  → Build snapshot from current config
  → Diff against saved snapshot → list destructive changes
  → Per-table migration auto-pass filter (compare migration versions)
  → If unresolved changes remain:
      - release: true → print migration guide and exit (reset not allowed)
      - release: false → offer [r] Reset DB / [m] Migration guide
  → On successful deploy → save updated snapshot
```

The snapshot file records each table's effective schema (including auto fields like `id`, `createdAt`, `updatedAt`) and the latest migration version.

### Migration Auto-Pass

If you have already written a migration for a table (i.e., the table's latest migration version in the snapshot is older than the newest migration in config), the destructive change detection is automatically resolved for that table. Each table is evaluated independently.

### Developer Mode (`release: false`)

When destructive changes are detected, the CLI prompts you to choose:

- **`[r]` Reset** -- Delete local database state and start fresh. All data is lost.
- **`[m]` Migration guide** -- The CLI prints suggested SQL for each change. Write a migration and re-run.

### Release Mode (`release: true`)

Database reset is not available. You must write migrations. The CLI prints a migration guide and exits with an error.

### CI/CD (Non-Interactive)

Use the `--if-destructive` flag to control behavior in automated environments:

```bash
# Reject destructive changes — exits with error (default)
edgebase deploy --if-destructive=reject

# Auto-reset in dev (not allowed with release: true)
edgebase deploy --if-destructive=reset
```

## Isolated DO Considerations

In isolated DO environments (e.g., `user:{id}` namespace), individual DOs may remain dormant for extended periods. When they finally receive a request, they will run all pending migrations at that time.

This means some DOs may operate on older schema versions while others have already migrated. This is a known characteristic of the Lazy Migration pattern and is generally acceptable because each DO's data is independent.

## CLI Migration Helpers

Generate a migration skeleton:

```bash
npx edgebase migration create <name>
# Example:
npx edgebase migration create rename-username --table posts
```

The `<name>` argument is required and becomes the migration description. Use `--table <name>` to auto-detect the next version number from your config.
