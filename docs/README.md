# EdgeBase Docs

Docusaurus-based docs site for EdgeBase.

## Ownership

- `docs/` owns public product docs: guides, configuration usage, API reference prose, SDK setup, and architecture explanations meant for users.
- `packages/server/openapi.json` owns the machine-readable HTTP contract.
- Internal architecture and governance notes are maintained separately from the public docs source of truth.

## Prerequisites

- Node.js 20.19+ (Node.js 24.x recommended)
- pnpm 9+

## Install

```bash
pnpm install
```

This docs workspace is maintained with `pnpm` only.

## Local Development

```bash
pnpm --filter docs start
```

Local search is enabled in the docs navbar. Use `Cmd+K` / `Ctrl+K` to open it.
The dev server refreshes a local search snapshot before startup so navbar search works during development too.

## Build

```bash
pnpm --filter docs build
```

This generates static output in `docs/build`, including the local search index.

## M25 Verification

```bash
pnpm --filter docs verify:m25
```

Checks:

- locale config (`en`)
- SDK tab blocks include 5 languages

## Full Docs Verification

```bash
pnpm --filter docs verify
```

Checks:

- landing/home marketing copy stays aligned with shared docs metadata
- OAuth provider docs, positions, and count copy stay in sync
- manual sidebar IA, category metadata, and ordered docs remain valid
- CLI command families and documented examples stay aligned with the shipped CLI surface
- Admin dashboard route coverage stays aligned with the shipped dashboard

## OAuth Docs Verification

```bash
pnpm --filter docs verify:oauth-docs
```

Checks:

- OAuth provider docs and their sidebar positions stay in sync
- shared provider count copy stays aligned across the docs surface

## Sidebar Coverage Verification

```bash
pnpm --filter docs verify:sidebar
```

Checks:

- every visible doc is included exactly once in `sidebars.ts`
- every visible doc keeps a `sidebar_position`
- every docs category keeps `_category_.json` metadata
- legacy pre-split Why EdgeBase paths stay removed

## CLI Docs Verification

```bash
pnpm --filter docs verify:cli-docs
```

Checks:

- every top-level CLI command registered in `packages/cli/src/index.ts` is documented in the CLI overview and reference
- documented CLI command sections include examples for the subcommands shipped in each command file

## Admin Dashboard Docs Verification

```bash
pnpm --filter docs verify:admin-dashboard
```

Checks:

- every shipped admin dashboard page route is listed in the navigation map doc
- sidebar labels and routes stay aligned with the admin dashboard navigation map

## Cloudflare Pages Deployment

EdgeBase docs are designed for Cloudflare Pages (`edgebase.fun`).

Recommended Pages settings:

- Framework preset: `None`
- Build command: `pnpm install --frozen-lockfile && pnpm --filter docs build`
- Build output directory: `docs/build`
- Root directory: repository root

Preview URLs are provided automatically per PR in Cloudflare Pages.

## i18n Expansion Guide

Current locales:

- English (`en`, default)

`docs/i18n/` is prepared for future locales, but only `en` is currently enabled in `docusaurus.config.ts`.

Add a locale:

1. Edit `docs/docusaurus.config.ts` and append locale code.
2. Run `pnpm --filter docs write-translations -- --locale <locale>`.
3. Add localized docs under:
   `docs/i18n/<locale>/docusaurus-plugin-content-docs/current/`
4. Build and validate.

## Translation Contribution Guide

- Keep commands/API fields in English with backticks.
- Keep SDK examples in original language syntax.
- Match section structure with English source docs.
- Run `pnpm --filter docs verify:m25` before commit.
- Run `pnpm --filter docs verify:oauth-docs`.
- Run `pnpm --filter docs verify:sidebar`.

## Versioning

Docs versioning is disabled until the first public release.

Do not create `versioned_docs/`, `versioned_sidebars/`, or `versions.json` in the current pre-launch docs workflow.
