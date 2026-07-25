---
sidebar_position: 2
---

# CLI Reference

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

This page lists the EdgeBase CLI surface by command family. For task-oriented walkthroughs, start with [CLI Workflows](/docs/cli/workflows).

## Global Flags

| Flag | Meaning |
| --- | --- |
| `--verbose` | Print more detail while the command runs |
| `--quiet` | Suppress non-essential output |
| `--json` | Emit machine-readable JSON when the command supports it |
| `--non-interactive` | Disable prompts and return structured `needs_input` or `needs_user_action` results |

## Agent-Friendly Mode

Use `--json --non-interactive` when another tool or agent is orchestrating the CLI.

- `needs_input` means the CLI needs an explicit flag value instead of opening a prompt
- `needs_user_action` means a human step is required, such as a browser-based Cloudflare or Neon login
- `error` means the command cannot continue and includes a stable `code` plus optional `hint` and `details`
- successful commands continue to return their normal JSON payloads with `status: "success"`

The structured payloads follow a consistent shape:

| Status | Meaning | Common fields |
| --- | --- | --- |
| `success` | Command completed | `status` plus command-specific output fields |
| `needs_input` | A missing explicit choice blocked progress | `code`, `message`, `field`, `choices` |
| `needs_user_action` | A human must do something outside the CLI | `code`, `message`, `action` |
| `error` | The command failed without further interaction | `code`, `message`, `hint`, `details` |

To introspect the live command surface, use:

```bash
edgebase --json describe
edgebase --json describe --command "deploy"
edgebase --json describe --command "backup restore"
```

Long-running commands still treat `Ctrl+C` as an immediate cancellation. If a user interrupts the process, the CLI may exit with code `130` instead of emitting a final JSON payload.

## Aliases

| Command | Alias |
| --- | --- |
| `dev` | `dv` |
| `deploy` | `dp` |
| `logs` | `l` |
| `upgrade` | `up` |
| `migration` | `mg` |
| `backup` | `bk` |
| `typegen` | `tg` |

## Common Environment Variables

| Variable | Used by |
| --- | --- |
| `EDGEBASE_URL` | Remote commands such as `migrate`, `backup`, `export`, `admin`, and `plugins cleanup` |
| `EDGEBASE_SERVICE_KEY` | Remote admin commands that authenticate with the root Service Key |
| `CLOUDFLARE_API_TOKEN` | Non-interactive Cloudflare deploy/destroy and operations that touch account-level resources |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare operations that need account scoping, especially backup and plugin cleanup flows |
| `NEON_API_KEY` | Optional `edgebase neon setup` helper when you want non-interactive Neon provisioning |
| `EDGEBASE_TRUSTED_PROXY_CIDRS` | Docker/pack launcher peers whose complete forwarded header set may be preserved |
| `LOCAL_PROTOCOL`, `HTTPS_CERT_PATH`, `HTTPS_KEY_PATH` | Explicit TLS termination at the generated Docker/pack gateway |
| `EDGEBASE_GATEWAY_MAX_CONNECTIONS` | Docker/pack public-gateway connection cap; default `512`, range 1–65,535 |
| `EDGEBASE_GATEWAY_MAX_REQUEST_BODY_BYTES` | Streaming request cap; default and maximum `5368709120` (5 GiB) |
| `EDGEBASE_GATEWAY_HEADERS_TIMEOUT_MS` | Complete-header deadline; default `15000`, maximum `300000` |
| `EDGEBASE_GATEWAY_REQUEST_TIMEOUT_MS` | Complete-request deadline; default `900000`, maximum `86400000` |
| `EDGEBASE_GATEWAY_IDLE_TIMEOUT_MS` | Ordinary inbound socket idle timeout; default `30000`, maximum `3600000` |
| `EDGEBASE_GATEWAY_KEEP_ALIVE_TIMEOUT_MS` | Idle keep-alive timeout; default `5000`, maximum `300000` |
| `EDGEBASE_GATEWAY_UPSTREAM_TIMEOUT_MS` | Loopback-upstream idle timeout; default `300000`, maximum `3600000` |
| `EDGEBASE_GATEWAY_EVENT_COALESCE_WINDOW_MS` | Metadata-only failure-event collection window; default `5000`, maximum `60000` |
| `EDGEBASE_GATEWAY_MIN_FREE_BYTES` | Persistence reserve; default `536870912` (512 MiB), nonnegative safe integer |
| `EDGEBASE_GATEWAY_RECOVERY_FREE_BYTES` | Reopen watermark; default is the reserve plus `134217728` (128 MiB) and must be greater than the reserve |

All gateway values are positive integers. Invalid values fail launcher startup
before external admission. Established WebSockets clear HTTP idle/upstream
timers. Gateway operational events are coalesced by finite controlled event
class and omit request URLs, queries, headers, bodies, credentials, and client
identity.

The Docker/pack gateway shares one cached filesystem sample across HTTP,
WebSocket, and health admission. Storage pressure returns retryable `507`
without sending new work upstream; a failed capacity probe returns retryable
`503`. This physical reserve is not a content or tenant quota.

## Project Lifecycle

### `init`

```bash
npm create edgebase@latest <dir>
npm create edgebase@latest <dir> -- --no-dev
npm create edgebase@latest <dir> -- --open
```

Scaffold a new project and optionally auto-start local development. Pass `--open` if you want the admin dashboard opened in your browser while the dev server starts. `create-edgebase` installs the local CLI dependencies for you before handing the project back.

### `build-app`

```bash
npx edgebase build-app
npx edgebase build-app --output ./dist/edgebase-app
```

Build a self-contained app bundle that no longer imports the source project's `edgebase.config.ts` or `functions/` tree at runtime.

The bundle includes the runtime scaffold, bundled config modules, bundled function entrypoints, admin assets, optional frontend assets, `wrangler.toml`, and `edgebase-app.json`.

### `dev`

```bash
npx edgebase dev
npx edgebase dev --port 8787
npx edgebase dev --host 0.0.0.0
npx edgebase dev --isolated
npx edgebase dev --open
```

Boot the local runtime with config and function hot reload. The default local surface includes the REST API plus the database subscription WebSocket endpoint at `/api/db/subscribe`.

If `edgebase.config.ts` defines `frontend.directory`, `dev` also serves that prebuilt bundle from the same local origin. Build the frontend before starting the runtime.

`dev` now runs from a self-contained bundle staged under `.edgebase/targets/dev-app`, so local execution no longer depends on Wrangler importing your source tree directly at runtime.

`dev` is intentionally local-development only. It does not install the
production self-host gateway, authenticated control authority, durable schedule
supervisor, or bounded child-process-group shutdown. Use `docker run` or a
generated `pack` launcher for production self-hosting. The server package's
`dev:raw` script has the same development-only status.

If a generated config shim contains injected development values, the CLI
writes it with owner-only (`0600`) permissions on supported platforms. Shims
without embedded values remain ordinary generated source.

### `deploy`

```bash
npx edgebase deploy
npx edgebase deploy --dry-run
npx edgebase deploy --if-destructive reject
npx edgebase deploy --allow-worker-rename
npx edgebase deploy --allow-account-change
```

Validate config, upload release secrets when `.env.release` exists, provision managed Cloudflare resources, and deploy the Worker.

`deploy` also writes `.edgebase/cloudflare-deploy-manifest.json`, which later destroy and cleanup flows use to target the same project-scoped Cloudflare resources.

Managed KV, D1, default R2, Vectorize, and Hyperdrive resources use
deterministic Worker-scoped names, so newly provisioned resources for separate
Workers in one Cloudflare account do not collide on matching logical bindings.
Legacy account-global or truncation-only names are reused only
when the previous deploy manifest belongs to the current Cloudflare account
and proves the same binding/resource. Keep that
manifest when upgrading an existing legacy deployment.
If the file exists but is malformed or structurally invalid, deploy and
destroy stop instead of treating it as a first deployment. Restore a valid
backup; remove it only when you intentionally accept losing all local proof of
the prior Worker and managed-resource identities.

If the manifest records a different Worker name, deploy stops before any
remote mutation because a renamed Worker receives separate Durable Object
storage. Migrate or intentionally retire the old Worker first. Use
`--allow-worker-rename` only to acknowledge that the new name is a separate
Worker identity; the flag does not move data.

Deploy likewise stops when the authenticated Cloudflare account differs from
the account recorded by the manifest. A different account has separate Worker,
Durable Object, and managed-resource storage. Use `--allow-account-change`
only after intentionally migrating or retiring the prior account; the flag
does not move data or resources.

Resource provisioning is fail-closed: list/auth/timeout/parse errors, missing
PostgreSQL connection strings, create failures, and missing returned IDs abort
before `wrangler deploy` instead of publishing an incomplete runtime.

Values from `.env.release` are applied through Wrangler's temporary,
version-bound secrets file. Deploy and deploy dry-run do not copy those
plaintext values into `generated-config.ts`, the application bundle, or pack
artifacts.

Hosted runtime authority and local/test switches are not valid Worker secrets.
Deploy rejects protected names such as `EDGEBASE_CONFIG`, `EDGEBASE_TEST`,
`EDGEBASE_TEST_BUILD`, `EDGEBASE_LOCAL_DEV_BUILD`, `EDGEBASE_USE_TEST_CONFIG`, `VITEST*`, `NODE_ENV`,
`EDGEBASE_RUNTIME_MODE`, `EDGEBASE_DEV_SIDECAR_PORT`,
`EDGEBASE_INTERNAL_WORKER_URL`, `EDGEBASE_EMAIL_API_URL`, `EDGEBASE_SMS_API_URL`, and
`EDGEBASE_APP_WEB_*_URL` in `.env.release` or source Wrangler `[vars]`
(`EDGEBASE_RUNTIME_MODE` itself is normalized as a CLI-owned public var). It also inspects an existing
Worker's secret-name list before provisioning and publishing. If a legacy
protected secret exists, verify the Worker, inspect `npx edgebase secret list`,
then remove only the named entry explicitly with `npx edgebase secret delete
<name>`; deploy never deletes a live secret implicitly.

Deploy and dry-run also reject active ambient test/config
selectors in the CLI process (`EDGEBASE_CONFIG`, `EDGEBASE_TEST`, `EDGEBASE_TEST_BUILD`,
`EDGEBASE_LOCAL_DEV_BUILD`, `EDGEBASE_DEV_SIDECAR_PORT`, `EDGEBASE_INTERNAL_WORKER_URL`, mock email/SMS URLs,
`EDGEBASE_USE_TEST_CONFIG`, `VITEST*`, `NODE_ENV=test`, or a non-Cloudflare
`EDGEBASE_RUNTIME_MODE`). `NODE_ENV=production` is allowed. This prevents the
config evaluator from building a production bundle under test authority.

`EDGEBASE_TEST_BUILD` and `EDGEBASE_LOCAL_DEV_BUILD` are additionally forbidden
in source Wrangler `vars`/`define` declarations, including environment,
quoted, dotted, and inline-table forms. Build-app, deploy dry-run, pack, and
live deploy all apply the same check. Only EdgeBase's dedicated test config may
compile the test selector; only `edgebase dev` may inject the local selector.
The trusted local build permits its loopback sidecar port only when the
CLI-owned runtime mode is `local-development`. A runtime var, secret, env file,
or ambient shell value with either selector name never grants authority.

Deployment/control credentials are not application secrets. `.env.release`
and existing Worker-secret preflight reject Cloudflare account/API tokens,
Neon, npm, and GitHub tokens. Supply them only to the CLI process. The sole
exception is the explicit self-destruct opt-in, which maps the selected scoped
token to `CF_API_TOKEN`/`CF_ACCOUNT_ID`; the original credential name is never
uploaded.

When `email.provider` is `cloudflare`, deploy validates `email.binding` as a
Worker-safe JavaScript identifier (default `EMAIL`) and adds the required
`[[send_email]]` binding to its generated Wrangler configuration. An existing
matching binding and its destination restrictions are preserved.

The generated hosted Wrangler config also owns
`nodejs_compat_populate_process_env` (deduplicated with existing compatibility
flags), so version-bound Worker secrets remain available through `process.env`
even with compatibility dates before Cloudflare's newer default behavior.

For a release deployment, Wrangler must report the concrete, name-bound
`workers.dev` URL before EdgeBase can bootstrap the admin account and verify
the deployed admin surface. The URL must be an HTTPS origin whose first
hostname label exactly matches the configured Worker name; custom domains,
other Worker names, and URL paths/queries are not accepted as publish proof.
If the Worker publish succeeds but Wrangler does
not report that URL, the CLI preserves the local deploy manifest with no
unverified URL authority and exits with a partial-deploy error. Verify the
published Worker URL, complete `npx edgebase admin bootstrap --url
<worker-url>`, and rerun deploy instead of treating that run as release-ready.

Before invoking Wrangler, `deploy` now builds a fresh app bundle under `.edgebase/targets/deploy-app` and deploys that self-contained runtime instead of reading the source project tree directly.

If `frontend.directory` is configured, `deploy` packages that prebuilt static bundle into the Worker assets upload. Reserved routes such as `/api/*`, `/admin/*`, and `/openapi.json` still win before the frontend bundle.

In `--json --non-interactive` mode, interactive deploy branches surface as structured issues instead of opening prompts. Destructive schema confirmations return `needs_input`, and Cloudflare auth can return `needs_user_action` with browser-login instructions.

After deploy, verify both a public function route and a service-key-backed admin path before treating the release as healthy.

### `destroy`

```bash
npx edgebase destroy --dry-run
npx edgebase destroy --yes
npx edgebase destroy --dry-run --allow-untracked-resources --account-id <32-hex-id>
```

Remove only project-scoped resources whose managed ownership is recorded in the
deploy manifest. A missing, malformed, oversized, symbolic-link, directory, or
otherwise non-regular manifest fails closed; restore the regular file instead
of treating damaged state as a first deployment.

Legacy v1 manifests prove the account and Worker identity but did not prove
resource ownership, so their resources remain unmanaged by default. Recovery
from a missing/v1 manifest or `wrangler.toml`-only state requires
`--allow-untracked-resources` plus an exact 32-hex account proof from
`--account-id` or the top-level `account_id` in `wrangler.toml`. A non-dry-run
destroy also checks that proof against the authenticated Cloudflare account
before deleting anything.

The manifest Worker URL is authoritative for the optional pre-delete Storage
wipe. `EDGEBASE_URL` is deliberately ignored by `destroy`. A custom or otherwise
unproven `--url` requires `--allow-worker-url-override` after independent target
verification; a mismatched manifest URL is rejected without that acknowledgement.

| Flag | Description |
| --- | --- |
| `--dry-run` | Validate identity and print the plan without remote deletion |
| `--allow-untracked-resources` | Explicitly authorize legacy recovery inferred from `wrangler.toml` |
| `--account-id <id>` | Exact 32-hex Cloudflare account proof for untracked recovery |
| `--url <url>` | Exact HTTPS Worker origin for the optional Storage wipe |
| `--allow-worker-url-override` | Acknowledge an explicit URL not proven by the manifest |
| `--service-key <key>` | Service Key for the optional Storage wipe |
| `--yes` | Confirm the validated deletion plan non-interactively |

### `logs`

```bash
npx edgebase logs
npx edgebase logs --format json
npx edgebase logs --filter status:500
npx edgebase logs --name my-worker
```

Stream logs from the deployed Worker.

| Flag | Description |
| --- | --- |
| `--format <format>` | Output format (`json` or default pretty-print) |
| `--filter <filter>` | Filter expression (e.g., `status:500`) |
| `--name <name>` | Worker name, auto-detected from wrangler.toml |

### `upgrade`

```bash
npx edgebase upgrade
npx edgebase upgrade --check
npx edgebase upgrade --target <version>
```

Upgrade EdgeBase framework packages with package-manager auto detection.

## Data Workflow

### `migration`

```bash
npx edgebase migration create add-post-slug
npx edgebase migration create add-post-slug --table posts
```

Generate migration snippets to paste back into `edgebase.config.ts`.

### `migrate`

```bash
npx edgebase migrate
npx edgebase migrate --scope auth
npx edgebase migrate --scope data
npx edgebase migrate --namespace shared
```

Run provider migration flows when auth or data move between D1 and PostgreSQL/Neon.

### `seed`

```bash
npx edgebase seed
npx edgebase seed --file edgebase.seed.json
npx edgebase seed --namespace workspace --id demo-tenant
npx edgebase seed --reset
```

Load fixture data into local or remote namespaces.

### `backup`

```bash
npx edgebase backup create --url https://my-worker.workers.dev --service-key <service-key>
npx edgebase backup create --include-secrets --include-storage
npx edgebase backup restore --from ./backup/backup.json --url https://my-worker.workers.dev --service-key <service-key> --yes
```

Create and restore portable backups across DO, D1, R2, and secrets. The config
snapshot retains namespaces, tables, schemas, and feature settings, but always
redacts embedded provider credentials, connection strings, tokens, private
keys, and plugin-config credentials. `--include-secrets` controls the separate
explicit secrets payload; it never makes the config endpoint return plaintext
credentials.

`backup restore` is destructive. In `--non-interactive` mode, pass `--yes` up front or handle the returned `needs_input` response before retrying.

### `export`

```bash
npx edgebase export --table posts --url https://my-worker.workers.dev --service-key <service-key>
npx edgebase export --table posts --output artifacts/posts.json
```

Export a single table to JSON. For dynamic DB blocks, the CLI discovers namespaces and merges the data into one JSON array.

### `typegen`

```bash
npx edgebase typegen
npx edgebase typegen --output src/edgebase.d.ts
```

Generate TypeScript types from the current schema.

`typegen` fully evaluates `edgebase.config.ts`. Invalid or legacy config syntax fails fast instead of silently falling back to partial regex parsing.

### `neon`

```bash
npx edgebase neon setup --namespace shared
npx edgebase neon setup --auth
```

Provision or connect Neon PostgreSQL for auth or a data namespace.

This is an optional helper. The runtime-facing config model stays `provider: 'postgres'` plus a connection-string env key in `edgebase.config.ts`; the Neon command just writes those env values for you.

## Security And Admin

### `secret`

```bash
npx edgebase secret set STRIPE_SECRET_KEY
npx edgebase secret set STRIPE_SECRET_KEY --value sk_live_...
npx edgebase secret list
npx edgebase secret delete STRIPE_SECRET_KEY
```

Manage Cloudflare Workers secrets used by the project.

`secret set` refuses hosted runtime authority, test-selector, and mock/action
URL names reserved by EdgeBase, as well as deploy/control credential names.
`secret delete` remains available so legacy copies can be removed deliberately.

| Subcommand | Flag | Description |
| --- | --- | --- |
| `set` | `--value <value>` | Secret value, skip interactive prompt |

### `keys`

```bash
npx edgebase keys list
npx edgebase keys rotate
npx edgebase keys rotate-jwt
```

Inspect and rotate the root Service Key and JWT signing secrets.

### `admin`

```bash
npx edgebase admin bootstrap --url https://my-worker.workers.dev --service-key <service-key> --email admin@example.com
npx edgebase admin bootstrap --url http://localhost:8787 --service-key <service-key> --email admin@example.com
npx edgebase admin reset-password --local --email admin@example.com
npx edgebase admin reset-password --local --email admin@example.com --password new-password-123
npx edgebase admin reset-password --url https://my-worker.workers.dev --service-key <service-key>
npx edgebase admin reset-password --email admin@example.com --password new-password-123 --url https://my-worker.workers.dev --service-key <service-key>
```

Bootstrap the first admin account, then recover or rotate admin access credentials.

## Plugins And Tooling

### `describe`

```bash
npx edgebase --json describe
npx edgebase --json describe --command "backup restore"
```

Emit a machine-readable description of the CLI command tree, including aliases, arguments, options, and subcommands.

### `plugins`

```bash
npx edgebase plugins list
npx edgebase plugins cleanup @myorg/plugin-prefix --url https://my-worker.workers.dev --service-key <service-key> -y
```

Inspect configured plugins or remove namespaced data for a plugin that has been removed from config.

### `create-plugin`

```bash
npx edgebase create-plugin my-plugin
npx edgebase create-plugin my-plugin --with-client js
npx edgebase create-plugin my-plugin --with-client all
```

Scaffold a plugin package with server and optional client SDK boilerplate.

### `docker`

```bash
npx edgebase docker build
npx edgebase docker build --context-only
npx edgebase docker run
npx edgebase docker run --port 3000 --detach
npx edgebase docker run --bootstrap-admin-email admin@example.com
```

Build and run the self-hosted Docker image.

When `frontend.directory` is configured, `docker build` copies that prebuilt bundle into the image and `docker run` serves it on the same origin as the API.

`docker build` first creates a portable app bundle under `.edgebase/targets/docker-app`, then builds the image from that bundle-centric runtime layout.

Use `docker build --context-only` to prepare the portable bundle and the synthetic context under `.edgebase/targets/docker-context` without requiring or invoking a local Docker daemon. This is useful when another tool, host, or CI builder will build the image.

If the project Dockerfile needs additional build-time files, place them under a project-level `docker-context/` directory. EdgeBase copies its contents into the synthetic context after generating the portable bundle. `Dockerfile`, `.dockerignore`, and `.edgebase/` remain generator-owned; matching entries under `docker-context/` are ignored so they cannot replace the generated build inputs.

A custom Dockerfile's final stage must preserve the generated protected
entrypoint. Build validates the final-stage Dockerfile command, the built
image's effective JSON `Entrypoint`/`Cmd`, and the required files inside an
isolated read-only container. Shell-form, missing, shadowed, or raw Wrangler
commands that bypass `.edgebase/self-host/self-host-docker-entrypoint.mjs` fail
the build instead of producing an unsupported production image.

### `pack`

```bash
npx edgebase pack
npx edgebase pack --output ./dist/my-app
npx edgebase pack --format dir
npx edgebase pack --format portable
npx edgebase pack --format archive
```

Create a runnable artifact from the same self-contained app bundle produced by `build-app`.

Use `--format portable` to wrap that runnable bundle for the current platform:

- macOS: `.app` bundle with an embedded Node runtime
- Linux and Windows: self-contained portable directory with an embedded Node runtime and platform wrapper script

Use `--format archive` when you want a single distributable file built from that portable wrapper:

- macOS and Windows: `.zip`
- Linux: `.tar.gz`

If `frontend.directory` is configured, the packed artifact also includes the merged runtime assets for that prebuilt bundle. Backend-only projects still pack correctly without any frontend configured.

`pack` also copies the runtime dependencies needed by the generated bundle, rewrites the artifact `wrangler.toml` for local execution, and emits launcher entrypoints:

- `launcher.mjs` for the cross-platform Node launcher
- `run.sh` for Unix-like shells
- `run.cmd` for Windows shells

These launchers bind to `127.0.0.1` by default and persist local state in an
app-specific data directory unless you override it with `--data-dir` or
`--persist-to`. Runtime application variables come from optional
`.env`/`.env.local` files, an explicit `--env-file`, standard EdgeBase runtime
keys in the launcher's process environment, and custom process keys named by
`EDGEBASE_RUNTIME_ENV_ALLOWLIST` (a comma-separated list). Other ambient shell,
package-manager, CI, and tooling variables are not forwarded automatically;
put a deliberately required value in the explicit env file or allowlist it by
name instead.

The launcher materializes those bindings in a temporary, owner-only
`.dev.vars` file inside its runtime data directory. It writes the file
atomically with mode `0600` on Unix-like systems and removes the file after a
normal exit or launch failure.

Before binding its public port, the launcher validates one coherent generated
runtime generation (manifest plus asset byte lengths and SHA-256 digests),
starts Wrangler on loopback HTTP, and accepts readiness only from the exact
instance that presents its fresh control secret. It validates durable schedule
state and runs the manifest-derived supervisor before opening the gateway. The
gateway is the only external listener; direct HTTP and WebSocket requests to
internal or scheduled control paths receive `404`. Use `LOCAL_PROTOCOL=https`
with `HTTPS_CERT_PATH` and `HTTPS_KEY_PATH` for direct TLS, or set
`EDGEBASE_TRUSTED_PROXY_CIDRS` to exact reverse-proxy peers so their single
complete forwarded client/protocol/host set can be preserved. Forwarding
headers from every other peer are overwritten. The gateway strips any supplied
internal-proof header and injects a fresh launcher-owned proof before each HTTP
or WebSocket request reaches the Worker.

`GET /__edgebase/health` is the launcher readiness endpoint. It returns schema
version 1, `200` with `outcome: "ok"` or `"degraded"` only when external
admission is open and the scheduler is structurally ready, and `503` with
`outcome: "blocked"` otherwise. Application health routes are separate checks.

For packed launchers, the default runtime model is now:

- stable high local port derived from the app name instead of always using `8787`
- single-instance attach behavior by default
- OS app-data storage by default
  macOS: `~/Library/Application Support/<app>`
  Linux: `${XDG_DATA_HOME:-~/.local/share}/<app>`
  Windows: `%LOCALAPPDATA%\\<app>`
- explicit overrides via `--port`, `--data-dir`, and `--persist-to`

Archive mode is the current single-file distribution path. Native `.exe` and `AppImage` launcher binaries are still future work.

## Static Frontend Config

```ts title="edgebase.config.ts"
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  frontend: {
    directory: './web/dist',
    mountPath: '/',
    spaFallback: true,
    headers: {
      'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  },
});
```

Use `frontend` when you want EdgeBase to serve a prebuilt static app.

Build the frontend first. Commands such as `dev`, `deploy`, `docker build`, and `pack` then use this config when serving or bundling it.

| Field | Meaning |
| --- | --- |
| `directory` | Required build output directory to serve |
| `mountPath` | Optional URL prefix for the bundle, default `/` |
| `spaFallback` | Optional SPA navigation fallback to `index.html` for HTML requests |
| `headers` | Optional string response headers for successfully served frontend assets |

EdgeBase does not run your frontend build command. Build the bundle first, then run the runtime or packaging command you want.

### `webhook-test`

```bash
npx edgebase webhook-test stripe
npx edgebase webhook-test stripe --all
npx edgebase webhook-test stripe --event checkout.session.completed
```

Replay synthetic webhook payloads to local handlers.

### `completion`

```bash
npx edgebase completion zsh
npx edgebase completion bash
npx edgebase completion fish
```

Generate shell completion scripts.

Supported shells are `bash`, `zsh`, and `fish`. Unsupported shells return a structured `error` in JSON mode.

### `telemetry`

```bash
npx edgebase telemetry status
npx edgebase telemetry disable
npx edgebase telemetry enable
```

Inspect or change CLI telemetry preferences.
