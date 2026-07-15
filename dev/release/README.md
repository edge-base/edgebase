# EdgeBase release workflow

Release commands are intentionally split into a preparation phase and an
external-action phase. Publishers, split-repository synchronizers, and remote
verifiers never change the source version.

## 1. Prepare and review

Current EdgeBase releases require Node.js 22 or newer. Choose the intended
stable release version explicitly, then work from a fresh branch:

```bash
export VERSION="<next-version>" # Replace with a stable MAJOR.MINOR.PATCH value.
pnpm install --frozen-lockfile
pnpm release:set "$VERSION"
# Write/review CHANGELOG.md and each gated SDK changelog.
pnpm release:preflight
pnpm build
pnpm test
```

`release:set` is the only release command that rewrites versions. It updates
file-backed package manifests, internal dependency bounds, SDK wire-version
markers, install examples, OpenAPI metadata, all generated SDK surfaces, and
generated skill references. Review those changes, commit them, and create the
matching `v$VERSION` tag before any external release action.

The root pnpm lockfile does not encode first-party workspace package versions.
An unchanged lockfile after a release-only bump is therefore expected; run the
frozen install above to prove it remains valid. Never replace unrelated
third-party dependency versions merely because they resemble the EdgeBase
release number.

## 2. Dry-run every intended route

Dry runs require the requested version to match the prepared source, but they
allow an uncommitted tree so the release candidate can be validated before the
release commit. They do not rewrite source versions.

```bash
pnpm release:npm "$VERSION" --dry-run
pnpm release:pub "$VERSION" --dry-run
pnpm release:pypi "$VERSION" --dry-run
pnpm release:crates "$VERSION" --dry-run
pnpm release:nuget "$VERSION" --dry-run
pnpm release:rubygems "$VERSION" --dry-run
pnpm release:hex "$VERSION" --dry-run
pnpm release:php-sync "$VERSION" --dry-run
pnpm release:swift-sync "$VERSION" --dry-run
pnpm release:go-sync "$VERSION" --dry-run
pnpm release:go-verify "$VERSION" --dry-run
pnpm release:jitpack "$VERSION" --dry-run
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

Publishing a stable GitHub Release is the explicit authorization for automated
npm publication. `.github/workflows/npm-publish.yml` accepts only a published
`vMAJOR.MINOR.PATCH` release whose tag matches the source version and is
contained in `main`. It installs the frozen workspace, runs
`release:preflight`, and then invokes the same resumable `release:npm` driver
used locally. A failed run should be rerun from GitHub Actions; already-published
packages are detected and skipped by the driver.

The workflow requires the repository Actions secret `NPM_TOKEN`. It must be a
granular npm token limited to read/write access for the npm release targets,
with Bypass 2FA enabled for noninteractive publication. The token is exposed
only to the credential check and publish steps. GitHub OIDC permission is used
separately to generate npm provenance attestations. Record the token expiration
outside the repository and rotate the secret before it expires.

Token-authenticated direct publication is transitional. npm has announced that
2FA-bypass granular tokens will stop publishing directly around January 2027:
https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/
Keep the `npm-publish.yml` workflow filename stable when migrating its publish
authentication to npm Trusted Publishing (OIDC), because npm binds that trust
configuration to the workflow filename.

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
