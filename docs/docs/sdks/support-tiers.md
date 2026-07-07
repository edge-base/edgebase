---
sidebar_position: 7
title: SDK Support Tiers
description: Which EdgeBase SDKs are production-supported, which are maintained best-effort, and which are experimental.
---

# SDK Support Tiers

EdgeBase ships SDK packages for 14 languages, but they are not all at the same level of maturity. This page states the current support tier for every SDK so you know what to expect before you build on one.

Like the [SDK Layer Matrix](/docs/sdks/layer-matrix), this page reflects what exists in the repository today, not a marketing claim. Tier assignments are based on the depth of the hand-written wrapper layer on top of the generated API core, the size of the unit and E2E test suites, and how closely the SDK tracks platform releases.

## Tier Definitions

| Tier | Meaning |
| --- | --- |
| **Tier 1 — Fully supported** | Kept in lockstep with platform releases. Full hand-written wrapper layer over the generated core, comprehensive unit and E2E test suites, and first in line for new platform features. Recommended for production. |
| **Tier 2 — Maintained (best-effort)** | Complete hand-written wrapper layer and a real test suite, but maintained best-effort: new platform features may land here after Tier 1, and release cadence can lag. Suitable for production if you accept the lag. |
| **Experimental** | Thin or mostly generated surface with minimal test coverage. APIs may change without notice. Use for evaluation and feedback, not production. |

## Current Tiers

<div className="docs-table-scroll" role="region" aria-label="SDK support tier table">

| SDK | Tier | Notes |
| --- | --- | --- |
| JavaScript / TypeScript | Tier 1 | Reference SDK. Full `core` / `web` / `admin` / `ssr` split plus `auth-ui-react`; largest test suite in the repo. |
| Dart / Flutter | Tier 1 | Full `core` / `flutter` / `admin` split with extensive tests and a maintained changelog. |
| Kotlin | Tier 1 | KMP `core` / `client` plus JVM `admin`, extensive tests, maintained changelog. |
| Java | Tier 1 | Full `core` / `android` / `admin` split, extensive tests, maintained changelog. |
| Python | Tier 1 | Full hand-written `core` / `admin` wrappers plus a combined `edgebase` entrypoint; extensive tests. |
| Rust | Tier 1 | Full hand-written `core` / `admin` wrappers with unit and E2E coverage. |
| C# / Unity | Tier 2 | Full `core` / `unity` / `admin` wrapper layer with a substantial test suite. |
| PHP | Tier 2 | Full `core` / `admin` wrapper layer; one of the larger test suites among server SDKs. |
| Swift | Tier 2 | Hand-written `core` / `ios` layers with unit, E2E, and HTTP-contract tests. |
| React Native | Tier 2 | Hand-written client layer over `@edge-base/core` with unit and E2E suites; smaller surface than the web SDK. |
| Ruby | Tier 2 | Hand-written `core` / `admin` wrappers with a moderate test suite. |
| Go | Tier 2 | Server-only single-package SDK: hand-written facade over generated cores, with a substantial unit and E2E suite. |
| C++ (Unreal) | Experimental | Labeled *alpha* in the [SDK Overview](/docs/sdks). Core and Unreal wrappers exist, but the surface and packaging are still settling. |
| Scala | Experimental | Thin Scala-facing wrapper over the Java runtime; minimal test coverage of its own. |
| Elixir | Experimental | Small hand-written `core` / `admin` surface with minimal test coverage. |

</div>

:::info Tiers describe the language wrapper, not the server
Every SDK talks to the same HTTP contract, so a lower tier does not mean the underlying platform behavior is unstable — it means the language-specific wrapper gets less hand-written surface, less test coverage, or a slower release cadence. For per-checkpoint certification evidence, see the [SDK Verification Matrix](/docs/sdks/verification-matrix).
:::

## How Tiers Will Evolve

Tiers are a snapshot, not a promise of permanence. On the road to 1.0, the goal is to promote Tier 2 SDKs to Tier 1 as their wrapper layers and test suites reach parity, and to either promote or clearly re-scope the experimental SDKs. Expect this page to change as that happens; check it again before committing a new project to a non-Tier-1 SDK.
