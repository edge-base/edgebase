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

1. Start EdgeBase (`npm create edgebase@latest my-app` or `npx edgebase dev`). Use `npx edgebase dev --open` if you want the browser to open automatically.
2. Create the first admin account.
3. Sign in and verify tables/users/storage views.

In local development started with `npx edgebase dev`, the login screen can still create the first admin directly in the browser. Other deployments, including non-release staging or self-hosted environments, bootstrap the first admin through the CLI so `/admin` never exposes a public setup form:

```bash
npx edgebase admin bootstrap --url https://your-project.edgebase.fun --service-key <service-key>
```

Admin password recovery is handled through the CLI, not by email.

- First admin bootstrap: `npx edgebase admin bootstrap --url https://your-project.edgebase.fun --service-key <service-key>`
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

## Dashboard Sessions

Starting with EdgeBase 0.3.6, the browser dashboard never persists admin
access or refresh tokens in `localStorage` or `sessionStorage`. The short-lived
15-minute admin access token exists only in page memory. The rotating refresh token is a
host-only `HttpOnly` cookie. HTTPS uses
`__Host-edgebase-admin-refresh; Secure; Path=/`; plain-HTTP local development
uses the unprefixed name with `Path=/admin/api/auth`. Same-origin deployments
use `SameSite=Strict`, and release mode rejects plain-HTTP cookie auth except on
an explicit CLI-owned `local-development` loopback request. Cloudflare and
self-hosted release runtimes never receive that exception.

Secure deployments expire but never read or migrate the predecessor
`__Secure-` and unprefixed path-scoped cookies. Users with one of those older
cookies must sign in again; this avoids silently promoting a less strictly
scoped credential.

The dashboard explicitly negotiates this transport with
`X-EdgeBase-Auth-Transport: cookie` and credentialed requests. The server does
not treat the ambient cookie alone as authorization. Login, refresh, setup, and
logout also require a verifiable browser `Origin`, and logout revokes the
backing `_admin_sessions` row before expiring the cookie.

New access and refresh JWTs carry the same server-side session ID and distinct
nonces. Protected admin routes verify that session row on every admin access,
so logout and password reset invalidate the in-memory access token immediately
instead of waiting for its expiry. Pre-0.3.6 access JWTs without a session ID
remain accepted only for their original lifetime during a rolling upgrade.

If a pre-0.3.6 dashboard session is found during upgrade, the old browser
storage entry is removed immediately and its refresh token may be exchanged
once for the HttpOnly cookie. New `_admin_sessions` rows store only a prefixed
SHA-256 token digest. A valid legacy plaintext row is rewritten to the digest
during its next refresh, so existing sessions migrate without a forced global
sign-out.

Refresh and logout operations are serialized across tabs with the browser Web
Locks API, with a token-free localStorage lease as the compatibility fallback.
Each cookie-mutating session request has a bounded timeout and is aborted on a
same-tab logout, so an unresponsive login, setup, or refresh cannot retain the
lock indefinitely. Refresh rotation itself is an atomic compare-and-swap on
the current session credential; concurrent refresh and logout requests cannot
resurrect a revoked admin session.
The dashboard also shares only a non-secret admin-ID marker across tabs. If one
tab changes the shared cookie to a different admin, other tabs immediately
discard their old in-memory access state and verify the new principal with the
server; bearer tokens are never copied through browser storage.
If logout cannot reach the server, the dashboard persists only a non-secret
pending-logout marker. Reload then stays signed out and retries revocation
before any cookie restore or new login, so an offline logout cannot silently
reopen the old admin session.

Non-browser and generated SDK clients keep the legacy body transport for
compatibility: login and refresh continue to return a refresh token unless the
cookie transport header was explicitly supplied.

### Separately hosted dashboards

Prefer serving `/admin` and the Worker from the same origin. If the dashboard
must use a different site, all of the following are required:

- HTTPS for both dashboard and API (or an explicitly trusted TLS proxy)
- the dashboard's exact origin in `cors.origin`
- `cors.credentials: true`
- browser requests with credentials and the custom transport header

Cross-site admin cookies use `SameSite=None; Secure`. Wildcard CORS origins,
missing origins, disabled CORS credentials, and cross-site plain HTTP are
rejected. Browser third-party-cookie policies can still block this topology,
so a same-origin dashboard remains the reliable deployment model.

Development mode does not trust every localhost port. If the standalone Vite
dashboard is run on a different port from the Worker, add that exact
`http://localhost:<port>` origin to `cors.origin`; an arbitrary loopback page
cannot use the ambient admin cookie.

## Security Notes

- Do not expose `SERVICE_KEY` in browser code.
- Restrict admin access behind HTTPS and IP/network controls when self-hosting.
- Rotate `JWT_ADMIN_SECRET` and `SERVICE_KEY` periodically.
- Confirm browser storage contains no `edgebase_admin_auth` token payload after upgrading.
- For reverse proxies, keep WebSocket upgrade headers enabled.

## Operational Checklist

- [ ] Admin account creation tested
- [ ] `/admin/api/*` endpoints accessible with admin auth
- [ ] Browser access forced to HTTPS in production
- [ ] Backup schedule in place for self-hosted data
