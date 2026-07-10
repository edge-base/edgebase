# Changelog

## 0.3.6 — 2026-07-10

### Breaking changes

- The CLI, server, and root toolchain now require Node.js 22 or newer. Node 20
  cannot consume the supported Wrangler line without known high-severity
  transitive vulnerabilities; upgrade local, CI, and self-hosted runtimes before
  adopting 0.3.6.
- Wrangler support now starts at the audited 4.103 release line, matching the
  pinned Docker runtime.

### Security

- Expanded the release security gate from production dependencies to the full
  workspace dependency graph, and raised vulnerable test/build tooling to
  patched Vitest, Vite, SvelteKit, Happy DOM, devalue, flatted, tmp, and
  form-data releases.
- Moved Admin Dashboard refresh credentials into HttpOnly cookies with
  memory-only access tokens, exact-origin CORS, atomic hashed session rotation,
  authoritative logout, and timeout/cross-tab principal isolation.
- Added an opt-in Web SDK transport that keeps refresh credentials in scoped,
  host-only HttpOnly cookies while retaining short-lived in-memory access
  tokens and backward compatibility with body-token clients.
- Bound cookie-mode OAuth callbacks to browser state cookies, removed tokens
  from application callback URLs, and hardened callback recovery and URL
  scrubbing across network failures and rolling upgrades.
- Made server-side session state authoritative for refresh, sign-out, and
  current-session revocation, including session-bound access-token claims.
- Restricted credentialed cookie authentication to exact origins and made
  forwarded HTTPS trust an explicit self-hosting option.

### Fixed

- Serialized room messages per WebSocket so asynchronous access checks cannot
  reorder `join` and subsequent member-state messages.
- Preserved frontend response headers and runtime environment variables in
  portable app bundles and Docker images; the release image now pins Node 22
  and Wrangler 4.103.0.
- Corrected function route discovery and trigger handling for packaged apps.
- Fixed PHP umbrella autoload metadata so result classes declared alongside
  `TableRef` (including `BatchResult`) resolve when referenced directly.

### Release engineering

- Synchronized the 0.3.6 version across every file-backed release target,
  internal dependency range, SDK wire-version marker, and public install
  reference, including C++ and Unreal CMake project metadata. OpenAPI metadata
  and all generated SDK headers now follow the same source version. Swift and
  Composer split targets use `v0.3.6`; the Go route now mirrors the SDK into the
  repository required by its `github.com/edge-base/sdk-go` module path.
- Made publish, split-sync, and remote verification commands read-only with
  respect to source versions. A release must now be prepared with
  `release:set`, reviewed, and committed before any external action.
- Added release-contract tests, changelog gates, dry-run coverage, and working
  entrypoints for PHP/Swift/Go split synchronization, Go tag verification, and
  JitPack verification.
- Hardened split synchronization so credentials never enter git config or
  process arguments and existing release tags can never be force-overwritten.
  Every non-dry external release command also requires the matching central tag
  at HEAD, preventing source/tag provenance drift.
- Isolated npm lifecycle builds in a temporary release workspace so prepack
  cannot mutate or invalidate the source tree, and removed server test sources
  and credential-shaped fixtures from the published runtime tarball.

### Compatibility

- The HttpOnly-cookie browser transport is opt-in. Existing SDKs and clients
  using refresh tokens in response bodies keep their existing wire contract.
- Apart from the documented Node.js 22 runtime floor, SDK APIs remain backward
  compatible with the 0.3.x release line.
