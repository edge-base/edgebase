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
- Do not treat a recent `npm view` result or your own memory as definitive during a fresh release window. If version reports conflict, compare npm registry dist-tags, installed dependency trees, and every manifest/lockfile that can affect the running app, including nested `edgebase/` projects, before changing versions or filing regressions.
- Do not stop at declared CLI versions when functions are involved. Verify the installed CLI-transitive runtime packages too, plus the actual `npx edgebase --version`, before saying the function runtime is aligned.
- Do not assume a public option is functional just because it exists in a constructor type. If the reference does not describe behavior, treat the option as inert until repo code proves otherwise.
- Do not infer type-safe table models from `edgebase typegen` unless the selected package reference shows the exact integration pattern. Prefer explicit table generics or generated types already used by the repo.
- Do not infer an SDK or runtime bug from a README snippet alone. When examples, types, and observed behavior disagree, check the published typings and implementation before escalating.
- Do not read `table.where(...).onSnapshot(...)` as a server-filtered live query by default. Verify whether the selected SDK surface still needs `{ serverFilter: true }` before claiming the subscription is narrow or cheap.
- Do not mix callback contracts between `table.onSnapshot(...)` and `table.doc(id).onSnapshot(...)`. Verify whether the current surface emits a table snapshot or a `(data, change)` pair before wiring handlers.
- Do not assume the function-runtime DB surface differs from the client query-builder surface because of stale memory or old examples. Verify the current `ctx.db(...)` and `ctx.admin.db(...)` contract before rewriting working code or filing an API-parity bug.
- Do not assume a flaky multi-client flow is an SDK/server bug before ruling out app-layer caching, polling, optimistic reconciliation, or search/discoverability code. Separate platform behavior from app behavior before escalating.
- Do not bolt full-table reloads on top of snapshot payloads unless the reference or repo proves it is necessary. The extra round trips can create fake performance regressions and hide the original ordering problem.
- Do not assume Room member state automatically solves lobby/list occupancy. If a UI needs room data outside a joined room, verify the current SDK surface for a queryable occupancy primitive before inventing or implying one.
- Do not assume auth persistence is automatically isolated between colocated apps, localhost ports, or embedded previews. If multiple EdgeBase clients share one origin, verify storage keys, BroadcastChannel names, and SSR cookies will not collide.
- Do not assume a raw `fetch()` to EdgeBase auth or function routes carries the same auth context as SDK helpers. Verify which token, cookie, or header actually authenticates the request in the current origin and port setup before blaming the backend.
- Do not hardcode localhost origins for server self-calls, cleanup hooks, or seed flows when the runtime can move across ports or environments. Derive the worker origin from the request or environment and verify both request-driven and scheduled paths.
- Do not treat `EBADENGINE` as proof that the runtime is either broken or supported. Separate metadata warnings from actual runtime verification, and report both honestly.
- Do not assume `edgebase dev --port X` means the live process is still serving `X`. For fixed-port workflows, re-check the real bound port and a health path after restarts.
- Do not trust an occupied port or a dev-process PID as proof that the app is healthy. Verify a real page response and at least one expected asset or manifest path before reusing the process for QA.
- Do not escalate an SDK/server bug before ruling out app-layer optimistic merge bugs, snapshot reconciliation bugs, stale cache/search/list logic, or redundant full-table reloads layered on top of realtime payloads.
- Do not treat a visible button, toast, or optimistic state flip as proof that a server-backed action works. Prove the write, read-after-write, and cross-client effect from another client when the feature claims shared state.
- Do not assume a failing QA script, Playwright assertion, or stale browser tab proves the app is wrong. First verify every client, URL, selector, and record ID still points at the same entity after uploads, redirects, sorting, or route changes.
- Do not derive cross-client identity from mutable titles, sort order, or a previously captured URL when the app can create a new row or route. Re-resolve the canonical ID after the write before comparing states.
- Do not leave repeated verification trapped in one-off temp scripts or chat history. If the check will matter again, promote it into repo-local scripts or tests so the next agent can rerun the same workflow.
- Do not leave visible controls in an example app as implied no-ops. Either wire them, disable them, or label them honestly as not implemented before calling the UX complete.
- Do not treat scary local-runtime warnings as proof of a platform regression when the app still works. Separate noisy diagnostics from reproducible behavior before filing an SDK/server bug.
- When a task spans app code and a nested `edgebase/` project, check both package manifests and lockfiles before saying versions are aligned.
- For example apps, do not stop at `build` or `tsc`. Verify the actual user flow with concurrent clients, especially cross-client sync, auth, host controls, and any button that claims to perform a server-backed action.

## Validation

- For SDK, CLI, or version-upgrade work:
  verify the latest published version first, align every relevant package and lockfile including nested `edgebase/` projects, then run the smallest meaningful compile/build/test loop before declaring success.
- For fresh package releases or conflicting version reports:
  verify npm registry dist-tags, installed `node_modules` package versions, top-level and nested manifests, and any CLI-transitive runtime packages before saying the repo is current.
- For auth changes:
  test the real sign-in path used by the app, confirm the returned shape matches the selected reference, and verify persistence/isolation when multiple clients or colocated apps are in play before wiring cookies, tokens, or redirects.
- For raw auth or function `fetch()` calls:
  prove the authenticated user context on the server with an auth-dependent read or write, not just an HTTP 200 or a local optimistic state change.
- For realtime changes:
  verify both the callback shape and the server-vs-client filtering behavior from the selected reference before optimizing or claiming scale characteristics.
- For suspected SDK/server bugs:
  build the smallest repro you can, write down which app-layer causes you already ruled out, and confirm the current published surface before calling the mismatch an upstream bug. Do not escalate a platform bug on confidence alone.
- For Room-based features:
  separate in-room state from out-of-room discovery. Test lobby occupancy, first-join behavior, and post-leave cleanup from a client that is not already inside the room.
- For optimistic realtime UI:
  test that pending rows survive snapshot reconciliation and are replaced cleanly when the server write arrives; do not assume local insert and live-subscription ordering will line up.
- For optimistic server-backed actions:
  verify four things separately: immediate local feedback, eventual server acknowledgement, state after refresh, and replication or visibility from another client. If the server write can fail, also verify the rollback or error state instead of stopping at the happy path.
- For anonymous or multi-client directory flows:
  verify read-after-write discoverability from a second client, not just from the writer that created the row.
- For app-vs-platform bug triage:
  reproduce the failure from a second client, reduce it to the smallest credible repro, and only then escalate it as an SDK/server problem.
- For schema or config changes:
  run `edgebase typegen` when the repo uses generated types, and verify any generated files that the app imports.
- For example-app QA:
  prefer fixed ports, concurrent clients, and real end-to-end interaction over mocked verification. Re-check the actual bound ports after restarts, verify the health path with real HTML plus an expected asset/manifest response, use three clients when host/presence flows depend on it, confirm every client and script is still observing the same canonical entity after route changes, and check optimistic UI, server reconciliation, honest placeholders for unimplemented features, graceful degradation, and auth isolation across simultaneous clients.
- For reusable QA coverage:
  if you had to create an ad-hoc script to prove a fix, move the durable part into repo-local regression coverage before you leave the task.
- For multi-app or nested-project work:
  verify the top-level app, the nested `edgebase/` project, and their dev ports/scripts agree before declaring the setup reproducible.
- For function-triggered internal workflows:
  verify both direct request paths and scheduler or self-call paths, and make sure origin derivation, auth headers, and fallback behavior do not depend on a stale localhost assumption.
- For runtime or toolchain validation:
  when the package declares a Node range, run at least one meaningful check on that supported runtime or clearly state that your validation was done under an unsupported version.

## Safety

- Never use admin/server references for browser, mobile, game-client, desktop-client, or other shipped client code.
- Do not invent package surfaces that are not present in the selected reference.
- Treat `llms.txt`-derived references as package contracts; when they conflict with guessed examples, trust the reference and the repository code.
