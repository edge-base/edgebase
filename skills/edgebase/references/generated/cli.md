<!-- Generated from packages/cli/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase CLI

Use this file as a quick-reference contract for AI coding assistants working with `@edge-base/cli`.

## Package Boundary

Use `@edge-base/cli` to scaffold, develop, deploy, inspect, and operate EdgeBase projects.

Do not assume a public unscoped `edgebase` npm package exists. For new projects, use `npm create edgebase@latest`. Inside generated projects, use the local `edgebase` binary through `npx edgebase` or `npm run ...`.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/cli/README.md
- Quickstart: https://edgebase.fun/docs/getting-started/quickstart
- CLI overview: https://edgebase.fun/docs/cli
- CLI workflows: https://edgebase.fun/docs/cli/workflows
- CLI reference: https://edgebase.fun/docs/cli/reference

If examples, docs, and assumptions disagree, prefer the current CLI behavior and official docs over guessed flags.

## Canonical Examples

### Create a new project

```bash
npm create edgebase@latest my-app
```

### Start local development in a generated project

```bash
cd my-app
npm run dev
```

### Run the local CLI directly

```bash
cd my-app
npx edgebase dev
```

### Deploy

```bash
cp .env.release.example .env.release
npx edgebase deploy
```

### Automation-friendly mode

```bash
edgebase --json --non-interactive describe
edgebase --json --non-interactive deploy
```

## Command Areas

- Project lifecycle: `init`, `dev`, `deploy`, `destroy`, `logs`, `upgrade`
- Data workflow: `migration`, `migrate`, `seed`, `backup`, `export`, `typegen`, `neon`
- Security and admin: `secret`, `keys`, `admin`
- Plugins and tooling: `plugins`, `create-plugin`, `docker`, `webhook-test`, `completion`, `describe`, `telemetry`, `realtime`

## Common Mistakes

- use `npm create edgebase@latest <dir>` for bootstrapping, not `npm edgebase`
- inside a generated project, `npx edgebase ...` works because the CLI is installed locally
- outside a generated project, do not assume `npx edgebase ...` will work unless the CLI is globally installed
- for agents, CI, or editors, prefer `--json --non-interactive`
- if you need to inspect the live command surface, use `edgebase describe` instead of guessing flags
- remote commands often require `EDGEBASE_URL`
- Service Key protected flows require `EDGEBASE_SERVICE_KEY`
- destructive commands like `destroy` and `backup restore` should be preceded by dry runs or explicit confirmation

## Quick Reference

```text
edgebase dev                                 -> run local development
edgebase deploy                              -> deploy project resources and worker
edgebase destroy --dry-run                   -> inspect cleanup plan
edgebase typegen                             -> generate schema types
edgebase migration create <name>             -> generate migration snippet
edgebase backup create --url ... --service-key ... -> create portable backup
edgebase --json describe                     -> inspect command tree
edgebase --json describe --command "deploy"  -> inspect one command
```

## Environment Variables

- `EDGEBASE_URL`
- `EDGEBASE_SERVICE_KEY`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `NEON_API_KEY`
