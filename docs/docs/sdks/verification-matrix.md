---
sidebar_position: 2
title: SDK Verification Matrix
description: Verification surfaces available in the public EdgeBase repository.
---

# SDK Verification Matrix

This page describes verification evidence that is actually present in the
public EdgeBase repository. It does not treat private certification workspaces
or uncommitted local artifacts as public proof.

## Current Repo State

- SDK unit and E2E test sources are checked in with their language packages.
- Public CI definitions select and run those suites from
  `.github/workflows/ci.yml` and `.github/workflows/test.yml`.
- Release metadata and generated HTTP cores are checked against the versioned
  OpenAPI contract by the repository release checks.
- Historical `runtime/<target>/...` sweeps and
  `artifacts/<target>/wave-*/...` certification files are **not** checked into
  this repository. Do not cite those paths as public evidence.

## Evidence That Is Checked In

| Evidence | Representative paths | What it proves |
| --- | --- | --- |
| Public CI definitions | `.github/workflows/ci.yml`, `.github/workflows/test.yml` | Which repository-owned suites and platform matrices are configured to run |
| SDK unit and E2E suites | `packages/sdk/*/test*`, `packages/sdk/*/tests*` | The assertions maintained for each language package |
| Generated contract tests | `tools/sdk-codegen`, generated SDK tests | Generated HTTP paths, methods, and parameters remain tied to OpenAPI |
| Release alignment checks | `scripts/release-version.test.mjs`, `scripts/check-release-versions.mjs` | Package, documentation, generated surface, and changelog versions stay aligned |

Checked-in test source shows what the repository intends to verify. A passing
result belongs to the exact commit and CI or local run that produced it; the
presence of a test file alone is not a blanket certification claim.

## What Is Not Publicly Certified Here

The public repository does not preserve a current all-SDK, all-runtime
certification sweep for `dev`, Docker, and deployed targets. If a separate
internal verification workspace produces such a sweep, its status must be
reported from that workspace and must not be described as checked into this
repository.

Use the [SDK Layer Matrix](/docs/sdks/layer-matrix) for package availability and
the [SDK Support Tiers](/docs/sdks/support-tiers) for the project's maintained
support policy. For pass/fail evidence, inspect the CI run or local receipt for
the exact commit being evaluated.
