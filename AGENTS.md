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
