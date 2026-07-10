# EdgeBase release workflow

Release commands are intentionally split into a preparation phase and an
external-action phase. Publishers, split-repository synchronizers, and remote
verifiers never change the source version.

## 1. Prepare and review

EdgeBase 0.3.6 and later require Node.js 22 or newer. From a fresh branch:

```bash
pnpm install --frozen-lockfile
pnpm release:set 0.3.6
# Write/review CHANGELOG.md and each gated SDK changelog.
pnpm release:preflight
pnpm build
pnpm test
```

`release:set` is the only release command that rewrites versions. It updates
file-backed package manifests, internal dependency bounds, SDK wire-version
markers, install examples, OpenAPI metadata, all generated SDK surfaces, and
generated skill references. Review those changes, commit them, and create the
matching `v0.3.6` tag before any external release action.

The root pnpm lockfile does not encode first-party workspace package versions.
An unchanged lockfile after a release-only bump is therefore expected; run the
frozen install above to prove it remains valid. Never replace unrelated
third-party `0.3.5` dependency versions merely because they resemble the
EdgeBase release number.

## 2. Dry-run every intended route

Dry runs require the requested version to match the prepared source, but they
allow an uncommitted tree so the release candidate can be validated before the
release commit. They do not rewrite source versions.

```bash
pnpm release:npm 0.3.6 --dry-run
pnpm release:pub 0.3.6 --dry-run
pnpm release:pypi 0.3.6 --dry-run
pnpm release:crates 0.3.6 --dry-run
pnpm release:nuget 0.3.6 --dry-run
pnpm release:rubygems 0.3.6 --dry-run
pnpm release:hex 0.3.6 --dry-run
pnpm release:php-sync 0.3.6 --dry-run
pnpm release:swift-sync 0.3.6 --dry-run
pnpm release:go-sync 0.3.6 --dry-run
pnpm release:go-verify 0.3.6 --dry-run
pnpm release:jitpack 0.3.6 --dry-run
```

## 3. Perform external actions only from the committed release

Non-dry-run commands fail unless the source version matches, every release
target/reference/changelog is aligned, the git working tree is clean, and the
matching central `v<source-version>` tag points to HEAD.
`EDGEBASE_ALLOW_DIRTY=1` is an emergency override and must not be part of the
normal release workflow.

Registry credentials belong only in environment variables or ignored
`dev/release/.env.*` files. The repository allowlists release `.mjs` drivers
and this README while continuing to ignore all credential files.
Explicit shell/CI environment variables always override values from an optional
local env file, so stale developer credentials cannot replace a deliberate
release credential.

The npm release driver copies the required workspace sources into a temporary
staging tree and runs every package lifecycle there. Package builds therefore
cannot rewrite ignored artifacts such as the Admin bundle in the reviewed
source tree or invalidate a running local Worker. The stage is removed in a
`finally` block on success or failure; release-contract tests also pack the
server in isolation and reject shipped test sources and credential fixtures.

Split-repository authentication uses a token-free HTTPS remote plus a
non-secret `GIT_ASKPASS` helper that reads `EDGEBASE_SPLIT_PUSH_TOKEN` from the
process environment. The token is never written to argv, logs, or `.git/config`.

Publishing and split synchronization change external systems and must be run
only with explicit release authorization. PHP, Swift, and Go tag synchronization
default to the exact `v<source-version>` tag and reject a mismatched tag.
The central tag must already point to HEAD. A missing split tag is created
without force, the same commit is an idempotent no-op, and a conflicting tag
fails closed. JitPack verification is read-only and checks all artifact POMs
for that tag.

The Go module path is `github.com/edge-base/sdk-go`; therefore the
`edge-base/sdk-go` split repository must exist before the first Go release.
`release:go-sync` mirrors `packages/sdk/go` without embedding credentials in a
remote URL, and `release:go-verify` compares the remote immutable tag with the
deterministic subtree commit. Repository creation and the first external push
remain explicit release-owner actions.
