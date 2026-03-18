<h1 align="center">create-edgebase</h1>

<p align="center">
  <b>Bootstrap a new EdgeBase project</b><br>
  Scaffold the project, install dependencies, and start local development in one command
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/create-edgebase"><img src="https://img.shields.io/npm/v/create-edgebase?color=brightgreen" alt="npm"></a>&nbsp;
  <a href="https://edgebase.fun/docs/getting-started/quickstart"><img src="https://img.shields.io/badge/docs-quickstart-blue" alt="Docs"></a>&nbsp;
  <a href="https://github.com/edge-base/edgebase/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://edgebase.fun/docs/getting-started/quickstart"><b>Quickstart</b></a> ·
  <a href="https://edgebase.fun/docs/cli"><b>CLI Overview</b></a> ·
  <a href="https://edgebase.fun/docs/cli/workflows"><b>CLI Workflows</b></a>
</p>

---

`create-edgebase` is the package behind:

```bash
npm create edgebase@latest
```

It wraps the EdgeBase CLI and does the first-run setup for you:

1. scaffold a new EdgeBase project
2. install local project dependencies
3. start local development unless you opt out

> Beta: the bootstrap flow is usable today, but some templates and defaults may still evolve before general availability.

## No Manual Install Required

You normally do **not** install this package directly.

Use it through npm create:

```bash
npm create edgebase@latest my-app
```

## Documentation Map

- [Quickstart](https://edgebase.fun/docs/getting-started/quickstart)
  First-run setup for a new EdgeBase project
- [CLI Overview](https://edgebase.fun/docs/cli)
  What the local CLI covers once the project exists
- [CLI Workflows](https://edgebase.fun/docs/cli/workflows)
  Common flows after scaffolding

## For AI Coding Assistants

This package ships with an `llms.txt` file for AI-assisted scaffolding.

You can find it:

- after install: `node_modules/create-edgebase/llms.txt`
- in the repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/create-edgebase/llms.txt)

Use it when you want an agent to:

- choose the correct bootstrap command
- understand the `--no-dev` and `--no-open` flags
- scaffold EdgeBase into an existing repo safely
- avoid confusing `create-edgebase` with the runtime CLI package

## Quick Start

### Create a dedicated EdgeBase project

```bash
npm create edgebase@latest my-app
```

### Add EdgeBase inside an existing frontend project

```bash
cd your-frontend-project
npm create edgebase@latest edgebase
```

That layout is recommended, not required. You can still keep EdgeBase in a separate repo or choose a different subdirectory name.

## Flags

### Skip auto-starting development

```bash
npm create edgebase@latest my-app -- --no-dev
```

### Prevent the browser from opening during `dev`

```bash
npm create edgebase@latest my-app -- --no-open
```

### Skip dependency install in automation

```bash
EDGEBASE_CREATE_SKIP_INSTALL=1 npm create edgebase@latest my-app -- --no-dev
```

## What Gets Created

The scaffold sets up an EdgeBase project with the local CLI already wired in.

Typical outputs include:

- `edgebase.config.ts`
- `functions/`
- `package.json` with local EdgeBase dev dependencies and scripts
- `.gitignore` entries for local secrets and generated files
- local runtime metadata under `.edgebase/` during development and deploy flows

If the target directory already contains `package.json` or `.gitignore`, the scaffold merges EdgeBase-specific entries instead of blindly replacing the file.

## What Happens Next

After scaffolding, the usual next step is:

```bash
cd my-app
npm run dev
```

From there you can keep using the local CLI:

```bash
npx edgebase deploy
npx edgebase typegen
```

## Related Packages

- [`@edge-base/cli`](https://www.npmjs.com/package/@edge-base/cli)
  The underlying CLI package used after project creation
- [`@edge-base/web`](https://www.npmjs.com/package/@edge-base/web)
  Browser SDK for your app code

## License

MIT
