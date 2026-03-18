<h1 align="center">@edge-base/plugin-core</h1>

<p align="center">
  <b>Public plugin authoring API for EdgeBase</b><br>
  Define plugin factories, typed plugin contexts, and plugin testing helpers for the EdgeBase plugin ecosystem
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@edge-base/plugin-core"><img src="https://img.shields.io/npm/v/%40edge-base%2Fplugin-core?color=brightgreen" alt="npm"></a>&nbsp;
  <a href="https://edgebase.fun/docs/plugins/creating-plugins"><img src="https://img.shields.io/badge/docs-plugins-blue" alt="Docs"></a>&nbsp;
  <a href="https://github.com/edge-base/edgebase/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://edgebase.fun/docs/plugins"><b>Plugins Overview</b></a> ·
  <a href="https://edgebase.fun/docs/plugins/creating-plugins"><b>Creating Plugins</b></a> ·
  <a href="https://edgebase.fun/docs/plugins/api-reference"><b>API Reference</b></a> ·
  <a href="https://edgebase.fun/docs/plugins/using-plugins"><b>Using Plugins</b></a>
</p>

---

`@edge-base/plugin-core` is the package plugin authors use to build installable EdgeBase plugins.

It gives you:

- `definePlugin()` for typed plugin factories
- typed contexts for functions, hooks, and migrations
- public plugin contracts like `PluginDefinition`
- `createMockContext()` for tests and local validation

This package is for **plugin packages**, not for normal application code.

> Beta: the public plugin contract is usable, but the ecosystem and tooling are still evolving.

## Documentation Map

- [Plugins Overview](https://edgebase.fun/docs/plugins)
  Understand how plugins fit into an EdgeBase project
- [Creating Plugins](https://edgebase.fun/docs/plugins/creating-plugins)
  End-to-end tutorial for building a plugin package
- [Plugin API Reference](https://edgebase.fun/docs/plugins/api-reference)
  Public types, contexts, and helper contracts
- [Using Plugins](https://edgebase.fun/docs/plugins/using-plugins)
  What host apps do after a plugin exists

## For AI Coding Assistants

This package ships with an `llms.txt` file for AI-assisted plugin development.

You can find it:

- after install: `node_modules/@edge-base/plugin-core/llms.txt`
- in the repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/plugins/core/llms.txt)

Use it when you want an agent to:

- generate plugin packages with the correct factory shape
- avoid confusing app code with plugin code
- use typed `ctx.pluginConfig` and `ctx.admin` correctly
- model migrations and hooks without guessing unsupported runtime behavior

## Installation

```bash
npm install @edge-base/plugin-core
```

If you want a starter layout, you can scaffold one with the CLI:

```bash
npx --package @edge-base/cli edgebase create-plugin my-plugin
```

## Quick Start

```ts
import { definePlugin } from '@edge-base/plugin-core';

interface StripeConfig {
  secretKey: string;
}

export const stripePlugin = definePlugin<StripeConfig>({
  name: '@edge-base/plugin-stripe',
  version: '0.1.0',
  tables: {
    customers: {
      schema: {
        email: { type: 'string', required: true },
      },
    },
  },
  functions: {
    'create-checkout': {
      trigger: { type: 'http', method: 'POST' },
      handler: async (ctx) => {
        const key = ctx.pluginConfig.secretKey;
        return Response.json({ ok: true, hasKey: !!key });
      },
    },
  },
});
```

`definePlugin()` returns a factory. The host app installs your plugin and calls that factory with user config from its EdgeBase project.

## What This Package Covers

| Area | Included |
| --- | --- |
| Plugin factory API | `definePlugin<TConfig>()` |
| Public plugin contracts | `PluginDefinition`, `PluginFunctionContext`, `PluginHooks`, `PluginMigrationContext` |
| Plugin admin surface | `ctx.admin` contracts for DB, auth, SQL, KV, D1, Vectorize, push, functions |
| Testing helpers | `createMockContext()` |
| Contract version export | `EDGEBASE_PLUGIN_API_VERSION` |

## Typical Plugin Capabilities

With `@edge-base/plugin-core`, a plugin can contribute:

- tables
- functions
- auth hooks
- storage hooks
- `onInstall` setup
- semver-keyed migrations

## Testing Plugin Logic

Use `createMockContext()` when you want to test handlers without running a full EdgeBase project:

```ts
import { createMockContext } from '@edge-base/plugin-core';

const ctx = createMockContext({
  pluginConfig: { secretKey: 'test-key' },
});
```

From there you can call your plugin handlers with a predictable mock context.

## Package Boundary

Reach for this package when you are:

- publishing an EdgeBase plugin to npm
- sharing reusable EdgeBase functionality across projects
- building plugin factories that host apps will configure

Do **not** use this package for:

- normal browser app code
- SSR app code
- server-side app admin logic

For those, use:

- [`@edge-base/web`](https://www.npmjs.com/package/@edge-base/web)
- [`@edge-base/ssr`](https://www.npmjs.com/package/@edge-base/ssr)
- [`@edge-base/admin`](https://www.npmjs.com/package/@edge-base/admin)

## License

MIT
