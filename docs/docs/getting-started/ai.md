---
sidebar_position: 5
title: Use EdgeBase With AI
---

# Use EdgeBase With AI

EdgeBase is designed to work well with AI coding agents. The goal is simple: let the agent keep moving in natural language, while EdgeBase keeps the backend contract, SDK boundaries, and project structure explicit enough to avoid common mistakes.

If an agent discovers EdgeBase from search results, this page is the best canonical starting point before it generates code.

## Best Setup For High Accuracy

For the highest hit rate:

1. Start from [`npm create edgebase@latest`](/docs/getting-started/quickstart).
2. Keep the scaffolded `AGENTS.md` and `.github/copilot-instructions.md` files in the repo.
3. If your AI tool supports installable skills, install the public `edgebase` skill bundle and let it route to the right SDK reference.

That combination gives the agent three strong signals:

- the official EdgeBase docs
- the project-local AI hint files
- the installable `edgebase` skill when available

## Runtime Routing Rules

Choose the SDK by runtime and trust boundary, not by language alone.

- Browser or other untrusted JavaScript/TypeScript client code: use `@edge-base/web`
- Trusted backend or automation code using Service Keys: use the matching admin SDK for that language
- Server-side JavaScript acting as the current cookie-authenticated user: use `@edge-base/ssr`
- React Native apps: use `@edge-base/react-native`
- Flutter apps: use `edgebase_flutter`
- Native client platforms such as Swift, Kotlin, Java, Unity, or Unreal: use the platform-specific client package, not an admin SDK

## Rules That Prevent Most Mistakes

- Never ship Service Keys or other admin credentials in browser, mobile, desktop, Unity, Unreal, or other distributed client code.
- If the repo already imports a specific EdgeBase package, follow that package instead of guessing.
- Do not mix client examples and admin examples in the same runtime.
- If the runtime is ambiguous, prefer the lower-privilege client/core SDK and state the assumption.
- For project creation, local development, deploy, typegen, backup, or other workflow tasks, use the EdgeBase CLI rather than inventing custom commands.

## What The Scaffold Adds

`npm create edgebase@latest` now writes EdgeBase-specific AI hints into:

- `AGENTS.md`
- `.github/copilot-instructions.md`

Those files tell an agent that the repo uses EdgeBase and that it should prefer the installed `edgebase` skill and the official package boundaries before generating code.

## Recommended Reading Order

When an agent is starting from scratch:

1. Read the [Quickstart](/docs/getting-started/quickstart)
2. Read the [CLI docs](/docs/cli) for project workflows
3. Read the relevant [SDK docs](/docs/sdks) for the current runtime
4. If available in the project or toolchain, load the `edgebase` skill and the narrowest package reference for the task

## Good Prompts

- `Build this Next.js app with EdgeBase auth and database`
- `Use EdgeBase for a Flutter app and keep admin credentials on the server only`
- `Add EdgeBase to this existing repo and scaffold it into a dedicated subdirectory`
- `Use EdgeBase CLI commands only; do not invent deploy or typegen flows`

## Related Docs

- [Quickstart](/docs/getting-started/quickstart)
- [CLI Overview](/docs/cli)
- [SDKs](/docs/sdks)
- [Why EdgeBase?](/docs/why-edgebase)
