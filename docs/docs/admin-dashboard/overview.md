---
sidebar_position: 0
sidebar_label: Overview
slug: /admin-dashboard
---

# Admin Dashboard

EdgeBase ships with a built-in Admin Dashboard at `/admin` for local and production environments.

## Access

- Local: `http://localhost:8787/admin`
- Self-hosted: `https://your-domain.com/admin`
- Edge deployment: `https://your-project.edgebase.fun/admin`

## First Login

1. Start EdgeBase (`npm create edgebase@latest my-app` or `npx edgebase dev` — both open the dashboard automatically).
2. Create the first admin account.
3. Sign in and verify tables/users/storage views.

Admin password recovery is handled through the CLI, not by email.

- Local dev: `npx edgebase admin reset-password --local`
- Remote/self-hosted: `npx edgebase admin reset-password --url https://your-project.edgebase.fun --service-key <service-key>`

Use `--local` when you need to update the admin account stored in your local D1 dev database. Use the remote form when you need to recover a deployed dashboard.

## Features

For the current page-by-page route map, see [Navigation Map](/docs/admin-dashboard/navigation-map).

### Database Management

- **Create Database Blocks**: In dev mode, the dashboard can add new single-instance or per-tenant DB blocks directly to `edgebase.config.ts`, including PostgreSQL blocks with optional Neon helper flows. See [Schema Editor](/docs/admin-dashboard/schema-editor).
- **Records + Query**: Table detail pages keep records and query workspaces together for the current database target. Per-tenant databases require an instance ID before browsing records or running queries, and can auto-suggest targets from `edgebase.config.ts` via `databases[namespace].admin.instances`.
- **Create Row Drawer**: `+ Add Row` opens a right-side create-record drawer instead of an inline placeholder row, which keeps wider schemas easier to work with.
- **D1 to Postgres Upgrade**: In dev mode, single-instance D1 blocks can be upgraded from the table view to `provider: 'postgres'`, then connected to an existing Neon project or a newly created one. See [Schema Editor](/docs/admin-dashboard/schema-editor).
- **Schema ERD**: SVG-based entity-relationship diagram showing tables, fields, and foreign key relationships. Color-coded by namespace (shared, workspace, user). Pan and zoom support.
- **Rules Test**: Simulate access rule evaluation by selecting a user (or providing custom auth context) and testing read/insert/update/delete/access operations per table.
- **CSV Import/Export**: Export records to CSV or import from CSV with column mapping UI, type inference, and preview.

### Auth & Users

- **Users**: Browse, search, filter, and manage user accounts. Change roles, disable accounts, invalidate sessions.
- **Auth Settings**: In local dev, auth settings write back to `edgebase.config.ts`; outside dev they remain runtime read-only.

### Storage

- **Files**: Browse R2 buckets, list files, view metadata, and delete objects.
- **Create Buckets**: In dev mode, the storage view can add logical buckets to `edgebase.config.ts` without leaving the dashboard.

### Functions

- **Functions UI**: List all registered functions from config. Execute functions with custom HTTP method, JSON body, headers. View response status, body, and timing.

### Analytics & Monitoring

- **Analytics Overview**: API traffic metrics with range controls, optional `Exclude admin traffic`, category distribution, and top endpoints.
- **Overview Traffic Summary**: The dashboard home auto-selects `1H`, `6H`, or `24H` based on available history so the overview stays compact without a manual range picker.
- **Event Timeline**: Chronological timeline of auth events (signup, signin, signout, password reset) and custom events with type/time/user filtering.
- **Category Analytics**: Dedicated dashboards for Auth, Database, Storage, and Functions metrics.
- **Logs**: Request logs with prefix, level, and path filtering. Live mode with 2-second auto-refresh. Expandable JSON detail view.
- **Live Monitoring**: Active database-live and room WebSocket connections plus channel subscriber counts.

### System

- **API Docs**: Embedded docs surface at `/admin/docs` for fast lookup while you work in the dashboard.
- **Backup**: Create and restore project backups from the dashboard.
- **Settings**: Environment overview showing dev/production mode, release status, database configurations, auth settings, storage buckets, and native resource bindings (KV, D1, Vectorize).

## Security Notes

- Do not expose `SERVICE_KEY` in browser code.
- Restrict admin access behind HTTPS and IP/network controls when self-hosting.
- Rotate `JWT_ADMIN_SECRET` and `SERVICE_KEY` periodically.
- For reverse proxies, keep WebSocket upgrade headers enabled.

## Operational Checklist

- [ ] Admin account creation tested
- [ ] `/admin/api/*` endpoints accessible with admin auth
- [ ] Browser access forced to HTTPS in production
- [ ] Backup schedule in place for self-hosted data
