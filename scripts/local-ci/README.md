# EdgeBase Local Linux CI

Local CI executes the repository's public Linux GitHub Actions jobs on demand.
It is optional and does not install a hook or block `git push`. It uses the
pinned `act` binary and a digest-pinned Ubuntu 24.04 runner image. Each expanded
job receives a fresh Linux container, filesystem and Docker network. The full
profile targets `linux/amd64`; the focused npm-release profile uses the Docker
server's native `linux/amd64` or `linux/arm64` architecture.

## On-demand use

Before an agent starts local CI, it asks the user to choose one of these scopes
unless the current request already states the choice:

- **Full:** `node scripts/local-ci/run.mjs` for every repository-owned Linux
  job.
- **Core/npm:** `node scripts/local-ci/run.mjs --profile npm-release` for the
  release/version/supply-chain contracts and Node 22 core CI.

Do not reuse a choice from an older run or silently expand a core choice into
the full profile. Local CI remains optional and neither choice blocks Git
operations.

```sh
# First prove a focused change with the narrow test for that surface.

# Run the complete profile when broader Linux verification is useful.
node scripts/local-ci/run.mjs
```

For stable npm release verification, use the focused profile:

```sh
node scripts/local-ci/run.mjs --profile npm-release
```

The focused profile runs `release-version-check` and `ci-node-22`. Together
they cover frozen installation, release/version and supply-chain contracts,
the isolated npm package graph, dependency security audit, builds, lint, docs,
and core CLI/server/admin tests. Node 24 is exercised by the release check via
the repository `.nvmrc`; npm publication repeats `pnpm release:preflight` on
GitHub before publishing.

Recorded profiles refuse a dirty working tree. A successful receipt is
written to `.edgebase/local-linux-ci/receipt.json`; this path is ignored by
git. The receipt binds the successful run to the exact commit and tree, every
public workflow digest, the local-runner digest, `linux/amd64`, the pinned
execution engine and every completed job. For npm-release runs, the receipt
records the native Linux platform actually used instead. The receipt is an
informational run record only; its absence or age does not affect Git
operations.

## Commands

```sh
node scripts/local-ci/run.mjs --doctor
node scripts/local-ci/run.mjs --list
node scripts/local-ci/run.mjs --job release-version-check
node scripts/local-ci/run.mjs --profile npm-release
node scripts/local-ci/run.mjs --dry-run
node scripts/local-ci/run.mjs --diagnostic
```

`--job`, `--dry-run`, and `--diagnostic` are investigation tools. They do not
write a completed-run receipt. A selected job automatically includes its
declared prerequisites.

## Agent monitoring discipline

Run a long full profile in a persistent/background process and redirect its
complete stdout/stderr to a gitignored local log. Make one short startup check
within the first 2–3 minutes for an immediate setup failure. After that,
normally wake every 15 minutes and inspect only whether the run is active,
successful, or failed through process state or a concise job summary. Do not
consume routine log tails while the run is still active.

On success, inspect the final summary and validate the exact receipt, then
immediately delete the recurring heartbeat or monitor so no later 15-minute
wake occurs. On failure, identify the failed job first and inspect only its
relevant tail or exported log, widening the diagnostic window only as needed.
After a fix and focused verification, restart the full profile and repeat the
startup check and 15-minute cadence.

## Scheduling and isolation

The scheduler derives each job's resource capacity from Docker's CPU and memory
allocation, but starts public CI jobs sequentially. Heavy server, Docker,
release, mutation and C++ jobs therefore never overlap with another job, and
lighter matrix jobs also wait for the active job to finish.

The recommended Apple Silicon Colima allocation is:

```sh
colima start --cpu 8 --memory 16
```

Larger engines may give the active job more headroom, but do not increase the
one-job scheduling limit.

Jobs never reuse a container, application state, database or network. Pinned
runner images are shared as immutable Docker acquisition cache. Package and
action caches are separated by workflow digest and local job ID; the pnpm
content-addressed store is mounted only into that same job's fresh containers.
The workflows still use frozen or ecosystem-equivalent dependency resolution.

The runner explicitly ignores local `.env`, `.secrets`, `.vars`, `.input` and
home-directory act configuration so developer credentials cannot leak into a
job.

## Parity boundary

The full profile runs every repository-owned Linux build, test, packaging, E2E,
Semgrep, Gitleaks, mutation and benchmark job. Test-summary and SDK contract
jobs are represented by the local dependency graph: the full run record is
written only when every underlying Linux job succeeds.

The mutation job receives the intersection of its configured Stryker targets
and the host's exact committed diff against `origin/main`. Generated act
checkouts do not contain Git metadata, so the local workflow fails closed if
that input is absent instead of incorrectly treating the change set as empty.

GitHub remains authoritative for the parts a Linux desktop cannot reproduce:

- macOS and Swift/Xcode jobs;
- CodeQL initialization, analysis and SARIF upload;
- hosted artifact/SARIF transport;
- npm trusted publishing/OIDC provenance and external split-repository syncs.

Those jobs stay in the public workflows and still run after push.

On an ARM Docker host, the npm-release profile and its two diagnostic jobs use
the paired digest-pinned native `linux/arm64` runner image. This avoids QEMU
heap corruption in Go-based tools such as esbuild while preserving the same
workflow commands, assertions and frozen dependency resolution; GitHub's
amd64 job remains the second-architecture confirmation after push. The full
profile still targets `linux/amd64` and applies `GOMAXPROCS=1` plus extended
subprocess deadlines when emulated. Native amd64 Linux retains the hosted
workflow's concurrency and timeouts.
