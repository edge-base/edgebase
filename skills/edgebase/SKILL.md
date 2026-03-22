---
name: edgebase
description: Use when the user mentions EdgeBase, @edge-base packages, edgebase.fun, edgebase.config.ts, npx edgebase, createClient, createAdminClient, createServerClient, or wants to build, authenticate, query, deploy, or operate an app with EdgeBase. Route to the correct CLI or SDK reference by runtime, language, and trust boundary before generating code.
---

# EdgeBase

Use this skill for EdgeBase product, CLI, SDK, and project-setup tasks.

Do not read every reference file by default. First inspect the repo, runtime, and trust boundary, then open only the narrowest matching reference.

## Routing

- Project setup, local dev, deploy, operations, or command usage:
  read `references/generated/cli.md`
- New project scaffolding and generated app layout:
  read `references/generated/create-edgebase.md`
- Plugin authoring:
  read `references/generated/plugin-core.md`
- Browser or other untrusted JavaScript/TypeScript client code:
  read `references/generated/js-web.md`
- Trusted server code using Service Keys:
  read the matching `*-admin.md` reference for the current language
- Server-side code acting as the current cookie-authenticated user:
  read `references/generated/js-ssr.md`
- React auth UI package:
  read `references/generated/js-auth-ui-react.md`
- Kotlin Multiplatform app clients:
  read `references/generated/kotlin-client.md`
- React Native apps:
  read `references/generated/react-native.md`
- Flutter apps:
  read `references/generated/dart-flutter.md`
- Pure Dart app/runtime without Flutter widgets:
  read `references/generated/dart-core.md`
- Unity:
  read `references/generated/csharp-unity.md`
- Unreal Engine:
  read `references/generated/cpp-unreal.md`
- Native C++ client without Unreal wrappers:
  read `references/generated/cpp-core.md`
- Android-specific Java client work:
  read `references/generated/java-android.md`
- iOS-specific Swift package work:
  read `references/generated/swift-ios.md`

## Selection Rules

- If the repo already imports a specific EdgeBase package, follow that package instead of guessing.
- If a language has a single generated reference file, read that file directly (for example `go.md` or `react-native.md`).
- If a language has multiple generated reference files, choose the file whose name matches both the language and the runtime/package boundary (for example `python-admin`, `kotlin-client`, `swift-ios`, or `cpp-unreal`).
- If a language has both client/core and admin references, use the admin reference only for trusted backend/server code.
- When the runtime or trust boundary is ambiguous, prefer the lower-privilege client/core reference and state the assumption.
- If multiple references are relevant, read the narrowest package reference first and only add a second reference if the task crosses boundaries.

## Safety

- Never use admin/server references for browser, mobile, game-client, desktop-client, or other shipped client code.
- Do not invent package surfaces that are not present in the selected reference.
- Treat `llms.txt`-derived references as package contracts; when they conflict with guessed examples, trust the reference and the repository code.
