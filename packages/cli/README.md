<h1 align="center">@edgebase-fun/cli</h1>

<p align="center">
  <b>Command-line workflow for EdgeBase</b><br>
  Scaffold projects, run local development, deploy to Cloudflare, and operate your EdgeBase stack from one CLI
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@edgebase-fun/cli"><img src="https://img.shields.io/npm/v/%40edgebase-fun%2Fcli?color=brightgreen" alt="npm"></a>&nbsp;
  <a href="https://edgebase.fun/docs/cli"><img src="https://img.shields.io/badge/docs-cli-blue" alt="Docs"></a>&nbsp;
  <a href="https://github.com/edge-base/edgebase/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://edgebase.fun/docs/getting-started/quickstart"><b>Quickstart</b></a> ·
  <a href="https://edgebase.fun/docs/cli"><b>CLI Overview</b></a> ·
  <a href="https://edgebase.fun/docs/cli/workflows"><b>CLI Workflows</b></a> ·
  <a href="https://edgebase.fun/docs/cli/reference"><b>CLI Reference</b></a>
</p>

---

`@edgebase-fun/cli` is the command surface for the full EdgeBase project lifecycle.

Use it to:

- bootstrap a new project
- run local development with hot reload
- deploy and destroy project-scoped Cloudflare resources
- generate types, migrations, backups, and exports
- manage secrets, keys, plugins, and admin operations

> Beta: the CLI is already usable, but some commands and flags may still evolve before general availability.

## Documentation Map

- [Quickstart](https://edgebase.fun/docs/getting-started/quickstart)
  Start a new EdgeBase project with `npm create edgebase@latest`
- [CLI Overview](https://edgebase.fun/docs/cli)
  Understand what the CLI owns across local development, deploy, data workflows, and tooling
- [CLI Workflows](https://edgebase.fun/docs/cli/workflows)
  Task-focused guides for common flows
- [CLI Reference](https://edgebase.fun/docs/cli/reference)
  Full command inventory, aliases, and environment variables

## For AI Coding Assistants

This package ships with an `llms.txt` file for AI-assisted CLI usage.

You can find it:

- after install: `node_modules/@edgebase-fun/cli/llms.txt`
- in the repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/cli/llms.txt)

Use it when you want an agent to:

- pick the right command for a workflow
- avoid guessing package-manager entrypoints
- prefer `--json --non-interactive` in automation
- stay inside the supported EdgeBase project structure

## Installation

For new projects, the best starting point is:

```bash
npm create edgebase@latest my-app
```

That scaffold installs the local CLI into the generated project for you.

If you want the CLI globally:

```bash
npm install -g @edgebase-fun/cli
```

After that, you can run:

```bash
edgebase --help
```

## Quick Start

### Start a new project

```bash
npm create edgebase@latest my-app
cd my-app
npm run dev
```

Inside an EdgeBase project, the local CLI is available through:

```bash
npx edgebase dev
```

### Deploy to Cloudflare

```bash
cp .env.release.example .env.release
npx edgebase deploy
```

### Generate types

```bash
npx edgebase typegen
```

## What The CLI Covers

| Area | Commands | What it covers |
| --- | --- | --- |
| Project lifecycle | `init`, `dev`, `deploy`, `destroy`, `logs`, `upgrade` | Bootstrap, local runtime, deploy, cleanup, logging, and package upgrades |
| Data workflow | `migration`, `migrate`, `seed`, `backup`, `export`, `typegen`, `neon` | Schema changes, provider migrations, fixture data, backups, exports, generated types, Neon setup |
| Security and admin | `secret`, `keys`, `admin` | Secrets, Service Key/JWT rotation, and admin recovery flows |
| Plugins and tooling | `plugins`, `create-plugin`, `docker`, `webhook-test`, `completion`, `describe`, `telemetry`, `realtime` | Plugin scaffolding, plugin maintenance, Docker support, completions, machine-readable command descriptions, telemetry, and Cloudflare Realtime setup |

## Recommended Usage Pattern

Most teams do **not** need a global install.

A good default flow is:

1. scaffold with `npm create edgebase@latest`
2. keep the CLI local to the generated project
3. run commands with `npm run ...` or `npx edgebase ...`

If you are adding EdgeBase to an existing frontend repo, a clean default is to scaffold into a dedicated subdirectory:

```bash
cd your-frontend-project
npm create edgebase@latest edgebase
```

That keeps the frontend app and the EdgeBase project close together without mixing them into the same root by accident.

## Automation And CI

When another tool, agent, or CI job is driving the CLI, prefer:

```bash
edgebase --json --non-interactive <command>
```

This makes the CLI return structured responses instead of hanging on prompts.

Useful companion commands:

```bash
edgebase --json describe
edgebase --json describe --command "deploy"
edgebase --json describe --command "backup restore"
```

Read more: [CLI Reference](https://edgebase.fun/docs/cli/reference)

## Common Environment Variables

| Variable | Used by |
| --- | --- |
| `EDGEBASE_URL` | Remote commands such as `migrate`, `backup`, `export`, `admin`, `plugins cleanup`, and `destroy` |
| `EDGEBASE_SERVICE_KEY` | Remote admin commands and Service Key authenticated flows |
| `CLOUDFLARE_API_TOKEN` | Non-interactive deploy/destroy flows |
| `CLOUDFLARE_ACCOUNT_ID` | Account-scoped Cloudflare operations |
| `NEON_API_KEY` | `edgebase neon setup` in non-interactive environments |

## Related Packages

- [`create-edgebase`](https://www.npmjs.com/package/create-edgebase)
  First-run project bootstrap package
- [`@edgebase-fun/web`](https://www.npmjs.com/package/@edgebase-fun/web)
  Browser SDK for app code
- [`@edgebase-fun/admin`](https://www.npmjs.com/package/@edgebase-fun/admin)
  Trusted server-side SDK for admin tasks

## License

MIT
