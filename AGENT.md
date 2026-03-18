# AGENT.md

Repository-wide instructions for coding agents and AI collaborators.

## Purpose

Use this file as the primary agent guide for this repository.
If a tool looks for `CLAUDE.md`, `CLAUDE.md` should point here instead of duplicating rules.

## Reference Documentation

- [`docs/docs/`](docs/docs/) — product docs, architecture, API, and guides
- [`packages/server/openapi.json`](packages/server/openapi.json) — machine-readable HTTP contract
- Code and docs should be cross-checked together; do not assume one side is up to date without reading both

## Source Of Truth

When changing behavior, verify which layer owns the contract:

- Runtime/server behavior: server code and tests
- HTTP/API surface: `packages/server/openapi.json` plus route implementation
- SDK surface: generated code plus wrapper code in `packages/sdk/**`
- User-facing guidance: `docs/docs/**`

If multiple layers disagree, resolve the mismatch instead of patching around it locally.

## Code Principles

- Read related server, SDK, and docs code before changing behavior
- Do not guess function names, route shapes, config fields, or SDK APIs
- Fix root causes; do not hide bugs with broad try/catch, silent fallbacks, or workaround-only patches
- Keep changes aligned across runtime, contracts, generated outputs, docs, and tests when needed
- If a design choice is genuinely ambiguous, stop and ask instead of inventing a direction

## Workflow

1. Review relevant docs and source files before editing
2. Identify the real source of truth for the change
3. Implement the code change
4. Update related docs or generated/contract files if required
5. Add or update tests
6. Share results clearly before or with commit preparation

## Testing

Start with the narrowest relevant test target, then expand if the change touches shared behavior.

```bash
# CLI tests
pnpm --filter cli test

# Admin dashboard tests
pnpm --filter @edge-base/dashboard test

# Server unit tests
pnpm --dir packages/server test
```

## Test Debugging Principles

- Never skip failing tests just to get green
- Never mock away the system you actually changed unless the test is explicitly unit-scoped
- If the issue is in the server, read server code deeply
- If the issue is in an SDK, read the full wrapper and generated path involved
- Use real route names, config names, and API shapes from the codebase

## Commit Guidance

- Prefer small, reviewable commits
- Use English commit messages
- Do not commit until the user has reviewed or approved when that workflow matters
