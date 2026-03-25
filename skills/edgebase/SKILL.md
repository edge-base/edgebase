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

## Common Footguns

- Do not assume old auth response shapes from memory or stale examples. Before destructuring auth results, verify the selected package reference and the current repo types.
- Do not assume a public option is functional just because it exists in a constructor type. If the reference does not describe behavior, treat the option as inert until repo code proves otherwise.
- Do not infer type-safe table models from `edgebase typegen` unless the selected package reference shows the exact integration pattern. Prefer explicit table generics or generated types already used by the repo.
- Do not read `table.where(...).onSnapshot(...)` as a server-filtered live query by default. Verify whether the selected SDK surface still needs `{ serverFilter: true }` before claiming the subscription is narrow or cheap.
- Do not mix callback contracts between `table.onSnapshot(...)` and `table.doc(id).onSnapshot(...)`. Verify whether the current surface emits a table snapshot or a `(data, change)` pair before wiring handlers.
- Do not assume Room member state automatically solves lobby/list occupancy. If a UI needs room data outside a joined room, verify the current SDK surface for a queryable occupancy primitive before inventing or implying one.
- Do not treat media transport as guaranteed. Before calling `transport.connect()` or promising camera/mic UX, verify the selected reference, current environment, and fallback path for unsupported or unconfigured runtimes.
- Do not assume auth persistence is automatically isolated between colocated apps, localhost ports, or embedded previews. If multiple EdgeBase clients share one origin, verify storage keys, BroadcastChannel names, and SSR cookies will not collide.
- When a task spans app code and a nested `edgebase/` project, check both package manifests and lockfiles before saying versions are aligned.
- For example apps, do not stop at `build` or `tsc`. Verify the actual user flow, especially cross-client sync, auth, and any button that claims to perform a server-backed action.
- Do not treat a visible button or optimistic state flip as proof that a feature works. Verify the intended server write, realtime fan-out, and reconciliation path before calling the UX complete.

## Validation

- For SDK, CLI, or version-upgrade work:
  verify the latest published version first, align every relevant package and lockfile, then run the smallest meaningful compile/build/test loop before declaring success.
- For auth changes:
  test the real sign-in path used by the app and confirm the returned shape matches the selected reference before wiring cookies, tokens, or redirects.
- For realtime changes:
  verify both the callback shape and the server-vs-client filtering behavior from the selected reference before optimizing or claiming scale characteristics.
- For Room-based features:
  separate in-room state from out-of-room discovery. Test lobby occupancy, first-join behavior, and post-leave cleanup from a client that is not already inside the room.
- For optimistic realtime UI:
  test that pending rows survive snapshot reconciliation and are replaced cleanly when the server write arrives; do not assume local insert and live-subscription ordering will line up.
- For optional media features:
  verify the app still works when media transport is unavailable, unsupported, denied, or intentionally disabled. Keep chat/presence flows usable unless the feature truly requires media.
- For schema or config changes:
  run `edgebase typegen` when the repo uses generated types, and verify any generated files that the app imports.
- For example-app QA:
  prefer fixed ports, concurrent clients, and real end-to-end interaction over mocked verification. Check optimistic UI, server reconciliation, honest placeholders for unimplemented features, and auth isolation across simultaneous clients.
- For multi-app or nested-project work:
  verify the top-level app, the nested `edgebase/` project, and their dev ports/scripts agree before declaring the setup reproducible.

## Safety

- Never use admin/server references for browser, mobile, game-client, desktop-client, or other shipped client code.
- Do not invent package surfaces that are not present in the selected reference.
- Treat `llms.txt`-derived references as package contracts; when they conflict with guessed examples, trust the reference and the repository code.
