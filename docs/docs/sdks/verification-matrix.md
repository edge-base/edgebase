---
sidebar_position: 2
title: SDK Verification Matrix
description: Checked-in certification evidence for the current EdgeBase SDK verification suites.
---

# SDK Verification Matrix

This page summarizes the certification artifacts that are currently checked into the repository. It is intentionally conservative: if a run or matrix is not present in the repo, this page does not claim it as certified.

## Current Repo State

- Verification suites are maintained in a separate internal verification workspace.
- The old `admin-sdk-platform-suite` lab referenced by earlier docs has been removed.
- The latest checked-in certification sweep in this repo is `runtime/docker/certification/certification-sweep-20260309205738514.json`, generated on March 9, 2026.
- That checked-in sweep is for the `database` suite on the `docker` target, using the `route-rotation-plan` and the `d1-multi-block` provider profile.

## What Is Checked In

The current certification system is organized by domain:

| Suite | Coverage Area |
| --- | --- |
| `database` | Database behavior and data APIs |
| `auth` | Authentication flows and account lifecycle |
| `room` | Realtime room state and collaboration behavior |
| `storage` | Object storage upload, download, and metadata flows |
| `app-functions` | Function runtime behavior and server hooks |
| `push` | Push registration, delivery plumbing, and admin flows |
| `analytics` | Event ingestion and query behavior |
| `plugin` | Plugin lifecycle and extension points |
| `cli` | CLI scaffolding, deploy flows, and environment tooling |

Checked-in runtime evidence is stored under `runtime/<target>/...`, and normalized per-slot artifacts are stored under `artifacts/<target>/wave-*/...`.

## Interpreting Artifact Status

Artifact status is reported per slot, not as a blanket repo-wide pass/fail claim.

| Status | Meaning |
| --- | --- |
| `FULL` | All checkpoints assigned to that slot passed. |
| `THIN` | The slot ran, but one or more checkpoints failed or did not reach full coverage. |
| `FAIL` | The slot failed its expected verification path. |
| `UNSUPPORTED` | The SDK or target does not support that checkpoint. |

For example, the checked-in artifact `artifacts/docker/wave-1/admin/AR4__elixir__d1-multi-block.json` currently records `status: "THIN"` with one failed checkpoint. Because of evidence like this, the repo does not currently justify an "all runtimes, all targets, all PASS" claim.

## Source Of Truth

Use these paths as the authoritative evidence:

- Internal verification playbooks and suite instructions
- Checked-in runtime sweeps: `runtime/<target>/certification/`
- Per-wave normalized artifacts: `artifacts/<target>/wave-*/`

If you need current support by language and layer, pair this page with [SDK Layer Matrix](/docs/sdks/layer-matrix). Treat certification as artifact-driven evidence, not a hand-maintained marketing matrix.
