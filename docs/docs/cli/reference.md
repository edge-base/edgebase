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
| `EDGEBASE_URL` | Remote commands such as `migrate`, `backup`, `export`, `admin`, `plugins cleanup`, and `destroy` |
| `EDGEBASE_SERVICE_KEY` | Remote admin commands that authenticate with the root Service Key |
| `CLOUDFLARE_API_TOKEN` | Non-interactive Cloudflare deploy/destroy and operations that touch account-level resources |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare operations that need account scoping, especially backup and plugin cleanup flows |
| `NEON_API_KEY` | Optional `edgebase neon setup` helper when you want non-interactive Neon provisioning |

## Project Lifecycle

### `init`

```bash
npm create edgebase@latest <dir>
npm create edgebase@latest <dir> -- --no-dev
npm create edgebase@latest <dir> -- --open
```

Scaffold a new project and optionally auto-start local development. Pass `--open` if you want the admin dashboard opened in your browser while the dev server starts. `create-edgebase` installs the local CLI dependencies for you before handing the project back.

### `dev`

```bash
npx edgebase dev
npx edgebase dev --port 8787
npx edgebase dev --host 0.0.0.0
npx edgebase dev --isolated
npx edgebase dev --open
```

Boot the local runtime with config and function hot reload. The default local surface includes the REST API plus the database subscription WebSocket endpoint at `/api/db/subscribe`.

### `deploy`

```bash
npx edgebase deploy
npx edgebase deploy --dry-run
npx edgebase deploy --if-destructive reject
```

Validate config, upload release secrets when `.env.release` exists, provision managed Cloudflare resources, and deploy the Worker.

`deploy` also writes `.edgebase/cloudflare-deploy-manifest.json`, which later destroy and cleanup flows use to target the same project-scoped Cloudflare resources.

In `--json --non-interactive` mode, interactive deploy branches surface as structured issues instead of opening prompts. Destructive schema confirmations return `needs_input`, and Cloudflare auth can return `needs_user_action` with browser-login instructions.

After deploy, verify both a public function route and a service-key-backed admin path before treating the release as healthy.

### `destroy`

```bash
npx edgebase destroy --dry-run
npx edgebase destroy --yes
```

Remove project-scoped managed Cloudflare resources discovered from the deploy manifest and project config.

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

Create and restore portable backups across DO, D1, R2, and secrets.

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
npx edgebase admin reset-password --local --email admin@example.com
npx edgebase admin reset-password --local --email admin@example.com --password new-password-123
npx edgebase admin reset-password --url https://my-worker.workers.dev --service-key <service-key>
npx edgebase admin reset-password --email admin@example.com --password new-password-123 --url https://my-worker.workers.dev --service-key <service-key>
```

Recover or rotate admin access credentials.

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
npx edgebase docker run
npx edgebase docker run --port 3000 --detach
```

Build and run the self-hosted Docker image.

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

### `realtime`

```bash
npx edgebase realtime provision
npx edgebase realtime provision --app-name <name>
npx edgebase realtime provision --turn-name <name>
npx edgebase realtime provision --force-create-app
npx edgebase realtime provision --force-create-turn
npx edgebase realtime provision --skip-workers-secrets
```

Provision Cloudflare Calls (WebRTC) resources for Room Media. Creates the required Calls App and TURN service, then stores the credentials as Workers secrets.

### `telemetry`

```bash
npx edgebase telemetry status
npx edgebase telemetry disable
npx edgebase telemetry enable
```

Inspect or change CLI telemetry preferences.
