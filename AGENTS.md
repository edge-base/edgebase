# AGENTS.md

This is the repository entrypoint for coding agents and AI collaborators.
Read and follow [AGENT.md](./AGENT.md) for the shared repository rules, then
apply the verification rules below.

## Fast Verification And CI Discipline

- Start with the narrowest relevant local build or test. Do not use the full
  GitHub Pipeline as the first debugging loop.
- Prove the changed surface locally before pushing. For release or packaging
  work, run targeted CLI/package tests first, then `pnpm release:preflight`;
  add local Docker and pack smoke tests when those paths changed.
- Treat local checks as the fast release-candidate gate. They should catch
  deterministic build, package, dependency, and contract failures before
  remote CI consumes multi-OS runner time.
- Do not claim that local checks replace GitHub-only evidence such as actual
  Windows/macOS runners, CodeQL, hosted Docker health, or npm OIDC/provenance.
- Keep the required remote gate proportional to the change. Use path-based
  selection so unrelated language SDK matrices do not run for focused CLI,
  docs, or workflow changes. Keep the complete multi-language, multi-OS, and
  CodeQL matrix scheduled or manually dispatchable unless the changed surface
  genuinely requires it.
- Configure remote workflows to cancel superseded commits, reuse build
  artifacts, cache package/toolchain downloads, and set explicit job/step
  timeouts. Sharded test harnesses must report the exact timed-out shard and
  files so a retry is actionable.
- If a run fails only because of a hosted-runner or service transient, finish
  diagnosing the run and rerun only failed jobs. Do not restart the entire
  matrix or push a no-op commit.
- Do not mix instruction-only or unrelated documentation changes into an
  active release-validation push; doing so restarts release CI and obscures
  which commit was actually verified.
- Before publishing, require a documented release-critical set of remote
  checks to be green. Unrelated scheduled analysis should remain visible but
  should not silently become a release blocker.

## Mandatory Local Linux Push Gate

- Every public/product push must be preceded by the complete local Linux gate
  for the exact committed `HEAD` that will be pushed:

  ```sh
  node scripts/local-ci/run.mjs
  ```

- Install and preserve the managed hook with
  `node scripts/local-ci/install-hook.mjs`. Never bypass it with
  `--no-verify`.
- The success receipt under `.edgebase/local-linux-ci/` must match the pushed
  commit SHA and tree, all public workflow digests, the local runner digest,
  `linux/amd64`, and every required job. Partial and diagnostic runs never
  authorize a push.
- Each public Linux CI job runs in a clean container and network. The scheduler
  uses bounded, resource-aware parallelism (at most three jobs) and does not
  share mutable application state, databases, containers or networks between
  jobs. Immutable image acquisition caches and per-job dependency caches may
  be used only when frozen dependency resolution still verifies the result.
- The scheduler scales from a four-point budget on a 4-CPU/8-GiB Docker engine
  to an eight-point budget on an 8-CPU/16-GiB engine. It may run two four-point
  jobs together at the larger size, but must never exceed eight total points or
  three concurrent jobs without a new measured isolation and parity review.
- When a public workflow or the local runner changes, update parity coverage
  and rerun the full gate. GitHub-hosted macOS/Swift, CodeQL/SARIF transport,
  npm OIDC/provenance and external repository syncs remain remote-only checks;
  they do not replace the local Linux gate.
- See [`scripts/local-ci/README.md`](scripts/local-ci/README.md) for the job
  inventory, isolation model and diagnostic commands.
