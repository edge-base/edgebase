---
sidebar_position: 7
---

# i18n & Localization Guide

EdgeBase docs use Docusaurus i18n with:

- `defaultLocale: 'en'`
- `locales: ['en', 'ko']`

## Add a New Locale

1. Update `docs/docusaurus.config.ts`:

```ts
i18n: {
  defaultLocale: 'en',
  locales: ['en', 'ko', 'ja'],
}
```

2. Generate translation scaffolding:

```bash
pnpm --filter docs write-translations -- --locale ja
```

3. Add localized docs under:

```text
docs/i18n/ja/docusaurus-plugin-content-docs/current/
```

4. Build and verify locale output:

```bash
pnpm --filter docs build
```

## Korean Translation Workflow

1. Copy target source doc from `docs/docs/**`.
2. Place translated file at matching path under `docs/i18n/ko/docusaurus-plugin-content-docs/current/**`.
3. Keep code samples unchanged unless language syntax differs.
4. Preserve headings and section structure to minimize diff noise between locales.

## Translation Contribution Rules

- Keep technical terms consistent (`Collection`, `Database Subscriptions`, `Room`, `Service Key`).
- Keep SDK inventory pages synchronized when language counts change (for example, Scala and Elixir additions on Admin SDK pages).
- Do not translate CLI command flags or API field names.
- Prefer concise Korean for explanations and keep English identifiers in backticks.
- Update both English and Korean docs when behavior changes.
- Run `pnpm --filter docs verify:m25` before opening a PR.
