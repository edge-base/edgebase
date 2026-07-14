# EdgeBase Local Linux CI Gate

The local gate executes the repository's public Linux GitHub Actions jobs before
a product commit can be pushed. It uses the pinned `act` binary and a
digest-pinned Ubuntu 24.04 runner image. Each expanded job receives a fresh
`linux/amd64` container, filesystem and Docker network.

## Required flow

```sh
# First prove a focused change with the narrow test for that surface.

# Commit the exact tree that will be pushed, then run the full gate.
node scripts/local-ci/run.mjs

# Push only after the receipt is written.
git push
```

The full gate refuses a dirty working tree. A successful receipt is written to
`.edgebase/local-linux-ci/receipt.json`; this path is ignored by git. The
receipt binds the successful run to the exact commit and tree, every public
workflow digest, the local-runner digest, `linux/amd64`, the pinned execution
engine and every required job.

Install the managed pre-push hook once per clone:

```sh
node scripts/local-ci/install-hook.mjs
```

The hook never uses `--no-verify` or a remote GitHub check as a substitute. It
peels branch and tag refs to commits and rejects a push when the receipt is
missing, stale, partial or from a different commit.

## Commands

```sh
node scripts/local-ci/run.mjs --doctor
node scripts/local-ci/run.mjs --list
node scripts/local-ci/run.mjs --job release-version-check
node scripts/local-ci/run.mjs --dry-run
node scripts/local-ci/run.mjs --diagnostic
```

`--job`, `--dry-run`, and `--diagnostic` are investigation tools. They never
write a push-authorizing receipt. A selected job automatically includes its
declared prerequisites.

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

The gate runs every repository-owned Linux build, test, packaging, E2E,
Semgrep, Gitleaks, mutation and benchmark job. Test-summary and SDK contract
jobs are represented by the local dependency graph: a receipt is impossible
unless every underlying Linux job succeeds.

GitHub remains authoritative for the parts a Linux desktop cannot reproduce:

- macOS and Swift/Xcode jobs;
- CodeQL initialization, analysis and SARIF upload;
- hosted artifact/SARIF transport;
- npm trusted publishing/OIDC provenance and external split-repository syncs.

Those jobs stay in the public workflows and still run after push. They confirm
the already locally tested SHA instead of serving as the first discovery loop
for repository-owned Linux failures.

On an ARM Docker host, the gate still executes the exact `linux/amd64` target.
It sets `GOMAXPROCS=1` inside those emulated containers to avoid a known QEMU
race in Go-based build tools such as esbuild, and triples subprocess deadlines
whose native 120-second budget is not meaningful under emulation. Assertions,
commands and dependency resolution remain unchanged. Native amd64 Linux does
not set either adaptation and retains the hosted workflow's concurrency and
timeouts.
