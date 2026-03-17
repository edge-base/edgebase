---
sidebar_position: 1
---

# Schema Editor

A visual schema editor built into the Admin Dashboard for modifying `edgebase.config.ts` during development.

:::warning Dev Mode Only
The schema editor is available only when running `npx edgebase dev`. It is not available in production deployments. Production schema changes must be made directly in `edgebase.config.ts` and redeployed.
:::

## How It Works

The schema editor uses a **CLI sidecar** architecture. Since the Cloudflare Workers runtime (`workerd`) cannot access `node:fs` or AST manipulation libraries, the CLI process starts a separate HTTP server alongside `wrangler dev` to handle file system operations.

```
Dashboard UI ── POST /schema/tables ──> CLI Sidecar (:8788)
                                              │  ts-morph AST manipulation
                                              v
                                        edgebase.config.ts modified
                                              │  fs.watch detects change
                                              v
                                        wrangler auto-restarts
```

### Architecture Components

| Component | Location | Role |
|-----------|----------|------|
| **Config Editor** | `packages/cli/src/lib/config-editor.ts` | Uses `ts-morph` to modify `edgebase.config.ts` via AST manipulation. Preserves comments, formatting, and function code (rules, hooks). |
| **Sidecar Server** | `packages/cli/src/lib/dev-sidecar.ts` | HTTP server with REST endpoints, Admin JWT verification, and CORS support. |
| **Dev Info Endpoint** | `GET /admin/api/data/dev-info` | Returns `{ devMode, sidecarPort }` so the dashboard can auto-discover the sidecar. |

## Enabling the Schema Editor

The sidecar starts automatically when all of these conditions are met:

1. You are running `npx edgebase dev`
2. `JWT_ADMIN_SECRET` is set in `.env.development`
3. The sidecar port (default: `8788`, which is the main dev server port + 1) is available

The CLI passes `EDGEBASE_DEV_SIDECAR_PORT` to the Worker via `wrangler --var`, so the Worker knows how to direct the dashboard to the sidecar.

## What You Can Do

The schema editor provides a visual interface for all schema operations:

### Database Blocks

- **Create a new database block** -- Open `Database -> Tables`, then use `+ DB` to add a new block directly to `edgebase.config.ts`.
- **Choose topology** -- Create either a `Single DB` block for app-wide data or a `Per-tenant DB` block for isolated instances.
- **Choose provider** -- Single DB blocks can start on D1, Durable Objects, or Postgres. Per-tenant DB blocks currently use Durable Objects.
- **Write admin discovery hints** -- Per-tenant DB creation can also write target labels, placeholder text, and helper copy so the dashboard knows how to pick an instance ID later.

### Postgres and Neon Setup

- **Recommended env key first** -- PostgreSQL-backed blocks always store a connection-string env key in config. The dashboard shows the recommended key up front and lets you override it only when needed.
- **Optional Neon shortcuts** -- When creating a PostgreSQL block in dev mode, the dashboard can either connect an existing Neon project or create a new Neon project for you. Both flows still end in the same runtime model: `provider: 'postgres'` plus a connection-string env key in `edgebase.config.ts`.
- **Manual connection strings still work** -- If you already have a Postgres or Neon connection string, you can ignore the Neon helper section, keep the recommended env key, and finish the block creation directly.

### Tables

- **Add a new table** -- Creates a new table entry under the selected database block
- **Edit a table** -- Modify table settings (FTS fields, index configuration)
- **Remove a table** -- Removes the table definition from config

### Fields

- **Add a field** -- Add a new column with type, default, constraints (required, unique, min, max, pattern)
- **Edit a field** -- Change field properties
- **Remove a field** -- Remove a column definition

### Indexes

- **Add an index** -- Create single or composite indexes on table fields
- **Remove an index** -- Remove an existing index definition

### Full-Text Search

- **Enable FTS** -- Specify which fields to include in FTS5 search
- **Disable FTS** -- Remove FTS configuration from a table

### Provider Upgrades

- **Upgrade a single-instance D1 block to Postgres** -- From a table detail page, use `Upgrade to Postgres` to migrate the entire database block, not just the current table.
- **Reuse the same Neon helper choices** -- The upgrade modal uses the same two Neon paths as database creation: connect an existing Neon project or create a new Neon project.
- **Block-wide migration** -- EdgeBase exports every table in the block, restarts the dev worker on Postgres, then restores the full block after the provider change.

## Typical Dev Flows

### Create a new database block

1. Open `Database -> Tables`.
2. Click `+ DB`.
3. Choose the block name, topology, and provider.
4. If you picked Postgres, either:
   - Keep the recommended env key and click `Create Database`, or
   - Use the optional Neon helper to connect an existing project or create a new one.
5. After the block is written to `edgebase.config.ts`, create the first table with `+ Table`.

### Upgrade a D1 block to Postgres

1. Open any table inside the target block.
2. Click `Upgrade to Postgres`.
3. Review the generated env key.
4. Choose whether to connect an existing Neon project or create a new one.
5. Wait for the block-wide export, worker restart, and restore to complete.

## How Changes Are Applied

When you make a change in the schema editor:

1. The dashboard sends a REST request to the CLI sidecar (port `:8788`)
2. The sidecar uses `ts-morph` to parse `edgebase.config.ts` as an AST
3. The AST is navigated: `default export` -> `defineConfig()` -> `databases` -> `{dbKey}` -> `tables` -> `{tableName}` -> `schema`
4. The targeted node is modified while preserving all surrounding code (comments, rules, hooks)
5. The modified AST is written back to `edgebase.config.ts`
6. `fs.watch` detects the file change
7. `wrangler dev` auto-restarts with the new config
8. The Lazy Schema Init process applies the schema changes on the next request

Changes are reflected immediately -- there is no manual reload or restart needed.

## Sidecar Security

The sidecar server enforces security:

- **Admin JWT verification**: Every request to the sidecar is authenticated using the same Admin JWT (HS256) as the main Admin Dashboard. The secret is read from `.env.development`.
- **CORS**: The sidecar allows cross-origin requests so the dashboard UI (served by the Worker on the main port) can communicate with the sidecar on a different port.
- **Dev mode only**: The sidecar is never started in production (`edgebase deploy`). It only runs during `edgebase dev`.

## Dev Info Discovery

The dashboard auto-discovers the sidecar port by calling:

```
GET /admin/api/data/dev-info
```

Response:

```json
{
  "devMode": true,
  "sidecarPort": 8788
}
```

When `devMode` is `false` (production), the schema editor UI is hidden entirely. When `devMode` is `true`, the dashboard uses `sidecarPort` to route schema editing requests to `http://localhost:{sidecarPort}`.

## Limitations

- **Dev mode only** -- Not available in production. Schema changes in production require editing `edgebase.config.ts` and redeploying with `npx edgebase deploy`.
- **Single developer** -- The sidecar runs on the local machine. Concurrent edits from multiple developers on the same dev server are not supported.
- **AST preservation** -- While `ts-morph` preserves comments and formatting, extremely complex TypeScript expressions in the config file may occasionally require manual review after editing.
- **No destructive migration generation** -- The schema editor modifies the config file but does not auto-generate migration entries. If you rename or delete a column via the editor, you will need to manually add a migration entry in the `migrations` array. The CLI will prompt you about destructive changes on the next `dev` restart.
