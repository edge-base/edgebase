---
sidebar_position: 14
---

# Create Database

Before you define tables, you first create a DB block under `databases[blockName]`.

A DB block is the storage boundary for one part of your app. Tables inside the same block share the same backing database, can join each other, and are managed together for schema edits and provider migrations.

## Choose A Database Type

EdgeBase supports two DB block shapes:

| Type | Config | Backing Store | Use When |
|------|--------|---------------|----------|
| **Single-instance** | omit `instance` | D1 by default, or DO / Postgres | Shared app data such as posts, catalog data, settings, or analytics |
| **Dynamic** | `instance: true` | Durable Objects + SQLite | One isolated database per user, workspace, store, or tenant |

## Quick Example

```typescript
// edgebase.config.ts
databases: {
  app: {
    tables: {
      posts: {
        schema: {
          title: { type: 'string', required: true },
        },
      },
    },
  },

  workspace: {
    instance: true,
    admin: {
      instances: {
        targetLabel: 'Workspace',
        placeholder: 'Enter workspace ID',
        helperText: 'Pick a workspace before browsing tenant data.',
      },
    },
    tables: {
      docs: {
        schema: {
          title: { type: 'string', required: true },
        },
      },
    },
  },

  analytics: {
    provider: 'postgres',
    connectionString: 'DB_POSTGRES_ANALYTICS_URL',
    tables: {
      events: {
        schema: {
          kind: { type: 'string', required: true },
        },
      },
    },
  },
}
```

## Create In Config

### Single-instance database

Use this for one shared database:

```typescript
databases: {
  app: {
    tables: {
      posts: {},
    },
  },
}
```

- D1 is the default provider.
- You can also set `provider: 'do'` for single-instance Durable Object SQLite.
- Use `provider: 'postgres'` when you want PostgreSQL semantics through Hyperdrive-backed bindings.

### Dynamic database

Use this when each instance ID should get its own isolated database:

```typescript
databases: {
  workspace: {
    instance: true,
    admin: {
      instances: {
        targetLabel: 'Workspace',
        placeholder: 'Enter workspace ID',
        helperText: 'Pick a workspace before browsing tenant data.',
      },
    },
    tables: {
      docs: {},
      comments: {},
    },
  },
}
```

- Dynamic blocks always use Durable Objects.
- `admin.instances` controls how the Admin Dashboard asks for the instance ID when browsing records or running queries.

## Create From The Admin Dashboard

In local dev, you can create the database visually:

1. Open `Database -> Tables`.
2. Click `+ DB`.
3. Enter the database name.
4. Choose `Single DB` or `Per-tenant DB`.
5. Choose the provider.
6. Click `Create Database`.

After the database exists, click `+ Table` to add the first table.

For the dashboard-specific editing flow, see [Admin Dashboard Schema Editor](/docs/admin-dashboard/schema-editor).

## Postgres And Neon

Postgres-backed databases still use the same core config shape:

```typescript
databases: {
  analytics: {
    provider: 'postgres',
    connectionString: 'DB_POSTGRES_ANALYTICS_URL',
    tables: {
      events: {},
    },
  },
}
```

### Neon helper in local dev

When you create a Postgres database from the Admin Dashboard in dev mode, EdgeBase can also:

- connect an existing Neon project, or
- create a new Neon project for you

This is only a helper. The final runtime config is still `provider: 'postgres'` plus a connection-string env key.

If you already have a Postgres or Neon connection string, you can skip the helper and keep the recommended env key.

## Upgrade D1 To Postgres

In local dev, single-instance D1 databases can be upgraded from a table detail page:

1. Open any table inside the target database.
2. Click `Upgrade to Postgres`.
3. Review the generated env key.
4. Choose whether to connect an existing Neon project or create a new one.
5. Wait for the database-wide export, restart, and restore flow to complete.

The migration applies to the entire DB block, not just the current table.

## What To Read Next

- [Defining Tables](/docs/database/defining-tables)
- [Config Reference](/docs/server/config-reference)
- [Admin Dashboard Schema Editor](/docs/admin-dashboard/schema-editor)
