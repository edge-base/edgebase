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
- Treat local checks as fast release-candidate evidence. They should catch
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

## On-Demand Local Linux CI

- Local Linux CI is an on-demand verification tool, not a prerequisite for
  `git push`. No managed pre-push hook or receipt check may block a push merely
  because local CI was not run.
- Before starting local CI, ask the user to choose the complete profile or the
  core npm-release profile unless the current request already states the scope.
  Name both exact commands, do not reuse a choice from an older run, and do not
  silently expand a core choice into the complete profile.
- Run the complete Linux profile when the risk or requested verification scope
  warrants it:

  ```sh
  node scripts/local-ci/run.mjs
  ```

- For stable npm release verification, the focused profile is available:

  ```sh
  node scripts/local-ci/run.mjs --profile npm-release
  ```

  This profile is limited to release/version/supply-chain contracts and Node
  22 core CI. Its receipt records the exact commit and checks that completed;
  it is evidence only and does not authorize or block a push.
- Each public Linux CI job runs sequentially in its own clean container and
  network. Jobs do not share mutable application state, databases, containers
  or networks. Immutable image acquisition caches and per-job dependency
  caches may be used only when frozen dependency resolution still verifies the
  result.
- Resource weights size each isolated job, but a local CI run must start only
  one public CI job at a time. Do not reintroduce cross-job parallelism without
  explicit user approval and a new measured isolation and parity review.
- On ARM Docker hosts, run the focused npm-release profile and its two
  diagnostic jobs in native `linux/arm64` containers. Do not send Go-based
  build tools such as esbuild through amd64 QEMU for this profile. The complete
  parity profile retains its explicit `linux/amd64` target until that broader
  architecture contract is changed separately.
- Monitor a long full-profile run from a persistent/background process with
  complete stdout/stderr in a gitignored log. Make one short startup check
  within the first 2–3 minutes, then normally wake every 15 minutes and inspect
  only whether the run is active, successful, or failed through process state
  or a concise job summary. Do not consume routine log tails while it is active.
  On failure, inspect the failed job's relevant log first, fix and run focused
  verification, restart the full profile, and repeat the same cadence. On
  success, validate the final summary and receipt, then immediately delete the
  recurring heartbeat or monitor so no later 15-minute wake occurs.
- When a public workflow or the local runner changes, update parity coverage.
  GitHub-hosted macOS/Swift, CodeQL/SARIF transport, npm publication
  credentials/provenance and external repository syncs remain remote-only
  checks; they do not replace the selected local Linux checks.
- See [`scripts/local-ci/README.md`](scripts/local-ci/README.md) for the job
  inventory, isolation model and diagnostic commands.
