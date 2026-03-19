---
sidebar_position: 3
---

# Defining Tables

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

How to define tables, columns, types, and validation rules in your config.

## Start With A DB Block

Tables always live inside a DB block under `databases[blockName].tables`.

If you have not created the block yet, start with [Create Database](/docs/database/create-database). That page covers:

- single-instance vs dynamic blocks
- D1 / Durable Object / Postgres provider choices
- local Admin Dashboard creation flow with `+ DB`
- optional Neon helper setup for Postgres blocks
- D1-to-Postgres block upgrades

Once the block exists, come back here to define the table schema itself.

## Schemaless Mode

The `schema` property is **optional** in table configuration. When omitted, EdgeBase operates in schemaless mode:

```typescript
// edgebase.config.ts
databases: {
  app: {
    tables: {
      logs: {},           // No schema — accepts any fields
      notes: {
        access: { /* ... */ },         // Access rules still work
      },
    },
  },
}
```

In schemaless mode:
- **Dynamic columns** — When you insert or update a record, the server automatically adds `TEXT` columns for any fields that don't exist yet via `ALTER TABLE ADD COLUMN`.
- **No validation** — No type checking, `required`, `min/max`, or `pattern` constraints are enforced.
- **Auto fields still apply** — `id`, `createdAt`, and `updatedAt` are injected as usual.
- **All values stored as TEXT** — Without type hints, booleans and numbers are stored as strings. Define a schema if you need typed queries (e.g., numeric comparisons).

:::tip When to use schemaless mode
Schemaless mode is useful for prototyping, logging, or tables where the shape of data is unpredictable. For production data with integrity requirements, define a schema.
:::

## How Config Translates to SQL

```typescript
// Config
posts: {
  schema: {
    title: { type: 'string', required: true, max: 200 },
    content: { type: 'text' },
    views: { type: 'number', default: 0 },
    featured: { type: 'boolean', default: false },
  },
  indexes: [{ fields: ['views'] }],
  fts: ['title', 'content'],
}

// Generated DDL
// CREATE TABLE posts (
//   id TEXT PRIMARY KEY,
//   title TEXT NOT NULL,
//   content TEXT,
//   views REAL DEFAULT 0,
//   featured INTEGER DEFAULT 0,
//   createdAt TEXT,
//   updatedAt TEXT
// );
// CREATE INDEX idx_posts_views ON posts(views);
// CREATE VIRTUAL TABLE posts_fts USING fts5(title, content, content=posts, content_rowid=rowid);
```

## Type Mapping

| Schema Type | SQLite Type | JS Type | Validation |
|-------------|------------|---------|------------|
| `string` | `TEXT` | `string` | `min/max` = length, `pattern` = regex |
| `text` | `TEXT` | `string` | Same validation as string; conventionally used without length constraints |
| `number` | `REAL` | `number` | `min/max` = value range |
| `boolean` | `INTEGER` | `boolean` | 0/1 storage |
| `datetime` | `TEXT` | `string` | ISO 8601 format validated |
| `json` | `TEXT` | `object` | JSON.parse validation |

## Validation Constraints

### Full Schema Field Options

| Option | Type | Applies to | Description |
|--------|------|-----------|-------------|
| `required` | `boolean` | All | Field must be provided on insert |
| `default` | `unknown` | All | Default value if not provided |
| `unique` | `boolean` | All | UNIQUE constraint (required for upsert `conflictTarget`) |
| `min` | `number` | string: char count, number: value | Minimum (application-level validation only, not a SQLite CHECK constraint) |
| `max` | `number` | string: char count, number: value | Maximum (application-level validation only, not a SQLite CHECK constraint) |
| `pattern` | `string` | string | Regex pattern validation |
| `enum` | `string[]` | string | Allowed values list |
| `onUpdate` | `'now'` | datetime | Auto-set to current timestamp on every update |
| `check` | `string` | All | Raw SQLite CHECK expression |
| `references` | `string \| FkReference` | string | Foreign key reference (see [Foreign Keys](#foreign-keys)) |

### Example

```typescript
posts: {
  schema: {
    title:    { type: 'string', required: true, min: 1, max: 200 },
    slug:     { type: 'string', unique: true, pattern: '^[a-z0-9-]+$' },
    status:   { type: 'string', default: 'draft', enum: ['draft', 'published', 'archived'] },
    views:    { type: 'number', default: 0, min: 0 },
    rating:   { type: 'number', min: 1, max: 5 },
    authorId: { type: 'string', required: true, references: 'users' },
  },
}
```

### Validation Errors

When validation fails, the server returns `400` with per-field error details:

```json
{
  "code": 400,
  "message": "Validation failed.",
  "data": {
    "title": { "code": "REQUIRED", "message": "Field is required." },
    "slug": { "code": "PATTERN", "message": "Must match pattern: ^[a-z0-9-]+$" },
    "rating": { "code": "MAX", "message": "Must be at most 5." }
  }
}
```

## Foreign Keys

The `references` option creates a SQLite foreign key constraint when the target table lives in the same DB block. You can use the short string form or the full object form with cascade options:

### String Form (Simple)

```typescript
posts: {
  schema: {
    authorId: { type: 'string', required: true, references: 'users' },
  },
}
// → logical auth-user reference only (no physical FK, because auth users live in AUTH_DB)
```

When the string-form reference points to a non-auth table (i.e., a table in the same DB block), the generated DDL uses `ON DELETE SET NULL` by default. However, if you use the `table(column)` syntax (e.g., `references: 'posts(id)'`), the generated DDL uses `ON DELETE CASCADE` instead. To use a different cascade action, use the object form below.

### Object Form (With Cascade Options)

```typescript
comments: {
  schema: {
    postId: {
      type: 'string',
      required: true,
      references: {
        table: 'posts',
        column: 'id',            // defaults to 'id' if omitted
        onDelete: 'CASCADE',     // CASCADE | SET NULL | RESTRICT | NO ACTION
        onUpdate: 'CASCADE',     // CASCADE | SET NULL | RESTRICT | NO ACTION
      },
    },
  },
}
// → REFERENCES posts(id) ON DELETE CASCADE ON UPDATE CASCADE
```

:::note
Foreign keys only work between tables in the same DB block, because they must share the same backing SQLite database. That means same D1 database for single-instance blocks, or the same Durable Object-backed SQLite instance for dynamic blocks. Cross-block foreign keys, including auth-user references such as `references: 'users'`, are silently excluded from the DDL and remain logical references only.
:::

## Auto Fields

Every table automatically includes three fields: `id`, `createdAt`, and `updatedAt`. You don't need to define them in your schema — they are injected by the server.

| Field | Type | Behavior |
|-------|------|----------|
| `id` | `string` (TEXT PRIMARY KEY) | UUID v7 auto-generated if not provided. Client-specified values are accepted (for offline-first scenarios). |
| `createdAt` | `datetime` (TEXT) | Set once on creation with server timestamp. Client values are ignored. |
| `updatedAt` | `datetime` (TEXT) | Updated to server timestamp on every write. |

### Disabling Auto Fields

Set an auto field to `false` to exclude it from the table:

```typescript
posts: {
  schema: {
    updatedAt: false,        // Disable updatedAt
    title: { type: 'string' },
  },
}
```

### Type Override is Not Allowed

Auto fields cannot have their type changed. The server generates these values with hardcoded logic (`generateId()` → UUID v7 string, `new Date().toISOString()` → datetime), so a type mismatch would cause runtime errors.

```typescript
// ✗ This will throw an error at config validation
posts: {
  schema: {
    id: { type: 'number', primaryKey: true }, // Error!
  },
}

// ✓ Use false to disable, or omit to use defaults
posts: {
  schema: {
    id: false,               // OK — disables the auto field
    title: { type: 'string' },
  },
}
```

## Migrations

EdgeBase uses a **Lazy Migration** engine. Each Durable Object runs migrations on its first request after a deploy.

### Automatic (Non-Destructive) Changes

When you add new columns or tables, EdgeBase handles them automatically:

1. Schema changes in `edgebase.config.ts` are detected by hash comparison
2. New tables → `CREATE TABLE`
3. New columns → `ALTER TABLE ADD COLUMN`

No migration code is needed for these changes.

### Manual (Destructive) Changes

Destructive changes — column deletion, column rename, type change — require explicit migration SQL:

```typescript
// edgebase.config.ts
tables: {
  posts: {
    schema: { /* current final schema */ },
    migrations: [
      {
        version: 2,
        description: 'Rename username to displayName',
        up: 'ALTER TABLE posts RENAME COLUMN username TO displayName',
      },
      {
        version: 3,
        description: 'Remove legacy field',
        up: 'ALTER TABLE posts DROP COLUMN legacyField',
      },
    ],
  },
}
```

Each migration is executed directly (without an explicit transaction wrapper). If a migration fails, the Durable Object returns 503 and retries on the next request.

:::tip
Use a single SQL statement per migration. `CREATE TRIGGER` or other `BEGIN...END` blocks should be in separate migration entries.
:::

## Destructive Change Detection

When you run `edgebase deploy` or `edgebase dev`, the CLI compares your current schema against a saved snapshot (`edgebase-schema.lock.json`) to detect destructive changes before they reach production.

### What Gets Detected

- **Column deleted** — a field was removed from the schema
- **Column type changed** — a field's type was modified (e.g., `string` → `number`)
- **Table deleted** — an entire table was removed from config

### How It Works

```
edgebase deploy / edgebase dev
  → Load edgebase-schema.lock.json (first deploy = no snapshot, just saves)
  → Build snapshot from current config
  → Diff against saved snapshot → list destructive changes
  → Filter: tables with new migrations auto-pass
  → If unresolved changes remain → prompt for action
  → On successful deploy → save updated snapshot
```

The snapshot file tracks each table's effective schema (including auto fields) and latest migration version.

### Developer Mode (`release: false`)

When destructive changes are detected, you choose:

- **`[r]` Reset** — Delete local database state and start fresh. Data is lost.
- **`[m]` Migration guide** — Shows suggested SQL for each change. Write a migration and re-run.

### Release Mode (`release: true`)

Database reset is **not available** in release mode. You must write migrations to handle destructive changes. The CLI prints a migration guide and exits.

### CI/CD (Non-Interactive)

Use the `--if-destructive` flag:

```bash
# Reject destructive changes (default) — exits with error
edgebase deploy --if-destructive=reject

# Auto-reset in dev (not allowed with release: true)
edgebase deploy --if-destructive=reset
```

### Migration Auto-Pass

If you've already written a migration for a table, the destructive change detection is automatically resolved for that table. Each table is evaluated independently — a migration on table A does not affect table B's detection.
