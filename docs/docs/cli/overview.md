---
sidebar_position: 0
sidebar_label: Overview
slug: /cli
---

# CLI

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

The `edgebase` CLI is the front door for the full project lifecycle:

- scaffold a project
- run local development
- deploy and destroy Cloudflare resources
- generate types and migration snippets
- move data with seed, export, migrate, and backup flows
- manage Service Keys, JWT secrets, plugins, Docker, and developer tooling

If you are trying to understand **which command to use when**, start with [CLI Workflows](/docs/cli/workflows). If you already know what you want and need the exact syntax, jump to [CLI Reference](/docs/cli/reference).

## Install

```bash
npm install -g @edge-base/cli
```

Or run it without a global install:

```bash
npm create edgebase@latest my-app
cd my-app
npx edgebase <command>
```

## What The CLI Owns

| Area | Commands | What it covers |
| --- | --- | --- |
| Project lifecycle | `init`, `dev`, `deploy`, `destroy`, `logs`, `upgrade` | Bootstrap, local runtime, Cloudflare deploy/cleanup, runtime logs, package upgrades |
| Data workflow | `migration`, `migrate`, `seed`, `backup`, `export`, `typegen`, `neon` | Schema changes, provider moves, fixture data, portable backup/restore, table exports, generated TS types, Neon setup |
| Security and admin | `secret`, `keys`, `admin` | Workers Secrets, Service Key and JWT rotation, admin password recovery |
| Plugins and tooling | `plugins`, `create-plugin`, `docker`, `webhook-test`, `completion`, `describe`, `telemetry`, `realtime` | Plugin inspection/cleanup, plugin scaffolding, self-hosting commands, webhook simulation, shell completion, machine-readable CLI introspection, telemetry preferences, and Cloudflare Realtime provisioning for Room Media |

## Fast Start

### Start a new project

```bash
npm create edgebase@latest my-app
cd my-app
npx edgebase dev
```

`create-edgebase` scaffolds the project, installs the local CLI dependencies, and, unless you pass `--no-dev`, immediately boots local development and opens the admin dashboard.

### Ship to Cloudflare

```bash
cp .env.release.example .env.release
npx edgebase deploy
```

`deploy` validates the config, provisions the managed Cloudflare resources your project needs, uploads release secrets when `.env.release` exists, and writes local state under `.edgebase/`.

### Clean up a deployed project

```bash
npx edgebase destroy --dry-run
npx edgebase destroy --yes
```

`destroy` removes **project-scoped managed Cloudflare resources** discovered from the deploy manifest and project config. In practice this covers the deployed Worker plus managed KV, D1, R2, Vectorize, Hyperdrive, and Turnstile resources for the project. Use `--dry-run` first to inspect the plan.

## Global Flags

Every command inherits the same top-level flags:

| Flag | Meaning |
| --- | --- |
| `--verbose` | Print more detail while the command runs |
| `--quiet` | Suppress non-essential output |
| `--json` | Emit machine-readable JSON when the command supports it |
| `--non-interactive` | Disable prompts and return structured `needs_input` or `needs_user_action` results instead of waiting for input |

## Automation And Agent Use

When you are calling the CLI from an AI agent, CI job, or another automation layer, prefer:

```bash
edgebase --json --non-interactive <command>
```

In this mode the CLI does not silently pick defaults for prompts. Instead it either:

- continues when the next step is unambiguous
- returns `needs_input` with explicit choices and the flags needed to retry
- returns `needs_user_action` when a human step is required, such as a browser login flow
- returns `error` with a stable `code`, a human-readable `message`, and optional `hint` or `details`

This is especially useful for commands that may need Cloudflare or Neon authentication, because the CLI can describe the browser step instead of hanging on a prompt.

### Structured JSON Contract

When you combine `--json` with `--non-interactive`, treat the CLI as a small protocol rather than as plain console text:

- success responses include `status: "success"` plus command-specific output fields
- prompt-like branches return `status: "needs_input"` with the missing `field`, optional `choices`, and retry hints
- human steps such as browser auth return `status: "needs_user_action"` with an `action` object and suggested instructions
- hard failures return `status: "error"` with a stable `code`, `message`, and optional `hint` or `details`

Example shapes:

```json
{ "status": "success", "file": "backup/edgebase-backup-2026-03-17.json" }
```

```json
{
  "status": "needs_input",
  "code": "backup_restore_confirmation_required",
  "field": "yes",
  "message": "Restore will overwrite the current target."
}
```

```json
{
  "status": "needs_user_action",
  "code": "cloudflare_login_required",
  "message": "Cloudflare authentication is required before deployment can continue."
}
```

```json
{
  "status": "error",
  "code": "deploy_config_invalid",
  "message": "edgebase.config.ts contains validation errors."
}
```

Long-running commands still treat `Ctrl+C` as an immediate user cancellation. In that case the process may exit with code `130` instead of printing a final JSON envelope. Automation should treat that as an intentional abort rather than as a schema violation.

For tool orchestration, you can also inspect the command surface itself:

```bash
edgebase --json describe
edgebase --json describe --command "backup restore"
```

This returns the current command tree, options, aliases, and arguments directly from the live CLI rather than from static docs.

## Common Environment Variables

| Variable | Used by |
| --- | --- |
| `EDGEBASE_URL` | Remote commands such as `migrate`, `backup`, `export`, `admin`, `plugins cleanup`, and `destroy` |
| `EDGEBASE_SERVICE_KEY` | Remote admin commands that authenticate with the root Service Key |
| `CLOUDFLARE_API_TOKEN` | Non-interactive Cloudflare deploy/destroy and operations that touch account-level resources |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare operations that need account scoping, especially backup/plugin cleanup flows |
| `NEON_API_KEY` | `edgebase neon setup` when you want non-interactive Neon provisioning |

## Command Aliases

Some high-frequency commands have short aliases:

| Command | Alias |
| --- | --- |
| `dev` | `dv` |
| `deploy` | `dp` |
| `logs` | `l` |
| `upgrade` | `up` |
| `migration` | `mg` |
| `backup` | `bk` |
| `typegen` | `tg` |

## Read Next

| Page | When to read it |
| --- | --- |
| [CLI Workflows](/docs/cli/workflows) | You want task-oriented examples: local dev, deploy, cleanup, backup, plugin work |
| [CLI Reference](/docs/cli/reference) | You need the full command inventory, aliases, flags, prerequisites, and environment variables |
