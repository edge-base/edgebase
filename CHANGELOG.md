# Changelog

## 0.4.4 — 2026-07-13

### Added

- The Docker CLI can prepare its portable bundle and synthetic build context
  without invoking Docker through `edgebase docker build --context-only`.
  Projects can add bounded support files from `docker-context/` while generated
  `Dockerfile`, `.dockerignore`, and `.edgebase/` inputs remain protected.
- Release cookie authentication has an explicit self-hosted-only
  `auth.session.cookie.allowInsecureLocalhost` option for Docker Desktop access
  through plain-HTTP `localhost`/loopback. Non-loopback HTTP remains rejected.

### Fixed

- The runtime Docker image now includes the public CA bundle required by
  workerd for outbound HTTPS APIs and declares `/data` as a Docker volume, so a
  first run gets persistent storage even when the operator does not map one.

## 0.4.3 — 2026-07-13

### Fixed

- **C++ SDK:** `updateProfile` no longer fails on the server's access-token-only
  response. Changing a `displayName` re-issues just the access token (the name
  is embedded in the JWT) and keeps the existing refresh token, but the C++
  `adoptAuthTokens` treated that as an "incomplete replacement token pair" and
  returned `ok = false`. It now adopts the new access token and retains the
  current refresh token for access-only responses (matching the JS, Kotlin,
  Swift, and Dart SDKs), while still rejecting a refresh-only response. This is
  the only shipped-code change in this release.

### Internal

- CI/test hardening only, no runtime impact: fixed cross-platform and stale
  SDK end-to-end tests (JS/React Native web e2e, Dart core/admin/flutter, Swift
  ios unit compile, Kotlin auth e2e, CLI Windows permission/path assertions),
  a flaky in-flight-refresh unit test, and secret-scan false positives; added
  `auth.allowedRedirectUrls` to the E2E server config; and documented the
  per-language SDK E2E reproduction workflow in `dev/testing/sdk-e2e.md`.

## 0.4.2 — 2026-07-12

### Security

- Password sign-in no longer leaks whether an account exists. Absent,
  passwordless, and wrong-password users now spend the same PBKDF2 work
  (against a fixed dummy hash) and return one identical generic `401`, closing
  a timing- and response-based account-enumeration channel.
- Password-reset requests always return the same generic
  `If the email exists, a reset link has been sent.` response. Absent,
  delivered, and failed-delivery cases are now byte-for-byte identical, the
  response is produced before the account lookup and persistence settle, and
  delivery is moved behind `waitUntil` so timing cannot reveal existence.
- Config backup/export routes redact credential-bearing values before
  returning them. Nested credential keys (normalized) and credential-bearing
  URLs are replaced with `[REDACTED]` while schema definitions are preserved,
  covering both the Service-Key and admin-session backup config routes.
- Release builds refuse dev/test runtime bindings that could override bundled
  production authority. URL overrides, the dev sidecar port, and
  `EDGEBASE_CONFIG`/`EDGEBASE_TEST` request bindings can no longer redirect
  auth tokens or email/SMS bodies in a released Worker; response-only test
  credentials unlock only under the dedicated compile-time test build, never
  from a request env binding.
- The PostgreSQL sidecar executor activates only when the runtime is in
  `local-development` mode, so a stale or attacker-controlled sidecar port can
  never receive arbitrary SQL plus `JWT_ADMIN_SECRET` outside CLI-owned local
  development.
- JWT rotation grace now requires a non-negative elapsed time, so a
  future-dated token can no longer slip through the previous-secret grace
  window.
- Auth session-cookie clearing retires predecessor cookie variants
  (`__Host-`/`__Secure-`/bare and configured legacy names) so stale
  authentication cookies are not left behind.

### Added

- HTTP functions enforce a configurable request body size limit
  (`httpFunctionBodyLimit`), rejecting oversized bodies (by declared
  `Content-Length` and while streaming) with a clear error before they are
  buffered.

## 0.4.1 — 2026-07-12

### Fixed

- Realtime rooms no longer rewrite Durable Object storage on every socket
  heartbeat. The per-room ephemeral-timer blob (`roomEphemeralTimers`) was
  persisted unconditionally several times per alarm pass, and the socket
  liveness check re-armed itself every ~5s while persisting an ever-advancing
  `socketHeartbeatCheckAt`. Together these made an active room write its DO
  SQLite every few seconds even when nothing changed — a large sustained WAL
  write amplification (dominant disk-I/O source under `wrangler dev`). The
  heartbeat timer is no longer persisted (it is reconstructed from the live
  socket set on recovery), redundant ephemeral-timer writes are collapsed with
  a content check, and the heartbeat poll interval is relaxed from 5s to 15s
  (still clamped to half the socket stale timeout, so shorter per-app timeouts
  keep polling proportionally more often). Steady-state per-room storage writes
  drop from every ~5s to only when durable room state actually changes; a dead
  socket is still reaped within roughly one stale window.

## 0.4.0 — 2026-07-11

### Security

- Serialized managed Turnstile hostname changes with an expiring, atomic D1
  deploy lease. Deploy now keeps the live widget's site key and secret, stages
  the bounded `old∪new` hostname set, binds code/public config/secrets to one
  Worker version, and finalizes only when that exact version serves 100% of
  traffic. Lease ownership is revalidated after Wrangler and immediately before
  finalization; staging is guarded by pre/post Worker snapshots, and a detected
  out-of-band race restores hostnames from the replacement live version's
  runtime binding before aborting. Transitions above ten hostnames abort before
  mutation, stale finalizers leave a live-safe set intact, and API/subprocess waits are bounded.
  Browser auth invalidates stale CAPTCHA config and retries an automatically
  acquired token once; browser challenge failures now retain a typed reason
  and only `challenge_error` retries acquisition with a freshly fetched key.
  React Native invalidates for the next WebView reset but never replays a
  caller-owned single-use token. Its public `TokenManager.setTokens()` is now
  awaitable and persists before exposing a session, including partial-write
  failure rollback protection.
- Isolated auto-provisioned KV, D1, default R2, Vectorize, and Hyperdrive
  resources with deterministic, length-bounded Worker-scoped names. Legacy
  account-global or truncation-only resources are reused only when the previous
  deploy manifest proves the exact binding and recorded ID. Cloudflare
  inventory, create, and ID parsing errors
  now abort before Worker publication; required PostgreSQL connection strings
  can no longer degrade into missing bindings. Secret-bearing Hyperdrive API
  requests also reject redirects and enforce a ten-second request deadline plus
  a bounded JSON response.
- Hardened Kotlin, Java Android, Swift, Flutter, Unity, and C++ auth authority
  transitions. Replacement access/refresh pairs persist before exposure,
  restart restoration validates complete pairs, authenticated HTTP no longer
  hides persistence failures, and anonymous email/phone upgrades fail before
  network unless durable pair storage is available. Native/browser CAPTCHA
  loaders now surface typed failures, bound shared loads and cleanup, cache only
  positive site keys for five minutes, and restrict fresh-key replay to one
  direct `challenge_error`. Config transport and malformed responses fail
  closed instead of being mistaken for disabled CAPTCHA. C++ auth callbacks are invoked outside their
  subscription mutex, eliminating reentrant self-deadlock.
- Made signed upload grants purpose-bound and single-use with an atomic R2
  consumption marker. Replayed single or multipart uploads can no longer
  recreate an object after application deletion. Single-upload grants are now
  consumed before body parsing, so malformed or oversized attempts cannot
  replay their ingress cost. Requests must start while the grant is valid; an
  in-flight commit may finish after expiry without a racy delete that could
  remove a newer trusted write.
- Enforced signed multipart `maxFileSize` as one aggregate, concurrency-safe
  byte budget. Each positive part length is atomically reserved before its R2
  write; over-budget attempts terminally close and abort the bound session, and
  retries cannot multiply one grant into thousands of full-size part writes.
- Bound signed downloads to the size, MIME type, and ETag captured at URL
  creation. Full and range reads now fail with `412 failed-precondition` if a
  trusted writer overwrites the key instead of serving the replacement body.
- Authorized signed download URL creation against each stored object's actual
  metadata. Batch generation now checks every existing key independently, so a
  list-level empty-resource allowance cannot mint public URLs for another
  user's object.
- Made client-IP trust an explicit runtime contract: Cloudflare ingress keeps
  `CF-Connecting-IP`, configured self-hosted proxies keep their trusted
  forwarding path, and raw Docker/portable ingress ignores forged forwarding
  headers by default.
- Hardened every R2-backed storage download path against stored active content.
  Passive media keeps a normalized MIME type, while HTML, XHTML, SVG, XML,
  JavaScript, CSS, PDF, malformed, and unknown content is returned as an opaque
  attachment with `nosniff` and a restrictive sandbox policy. The same policy
  now covers authenticated, public, signed, range, admin, and backup responses.
- Bound Web and React Native OAuth callbacks to per-flow 32-byte CSPRNG nonces
  that the server carries through OAuth state and returns to the app callback.
  Web uses a bounded namespaced browser registry plus a cross-tab mutation
  lock; React Native serializes an eight-entry registry in required
  Keychain/Keystore-backed `secureStorage`. Both require
  start/callback/current auth-epoch equality and consume only the matching flow.
  Provider callbacks now put only one-minute `oauth_exchange_ticket` or
  `oauth_link_ticket` authority in the app fragment—never bearer credentials.
  The SDK atomically exchanges sign-in tickets at `/api/auth/oauth/exchange`;
  account-link tickets complete only at authenticated
  `/api/auth/oauth/complete/link` after exact initiating user, session, and
  anonymous/permanent-mode checks.
- Moved new OAuth state, link state, continuations, and completion tickets to a
  key-sharded `AUTH` Durable Object with atomic terminal consume. KV is now only
  a best-effort rolling-upgrade mirror/legacy fallback, not authority for new
  flows. Browser proof is verified before consuming state so an attacker who
  learns a state value cannot burn the legitimate callback.
- Required release app redirects to use HTTPS and match a non-empty explicit
  `auth.allowedRedirectUrls` URL/origin/path scope. React Native accepts only
  claimed HTTPS Universal Links or Android App Links. The CLI's explicit
  local-development runtime retains an HTTP loopback exception for the
  EdgeBase provider-callback base origin; deployed and self-hosted release
  runtimes fail closed.
- Cryptographically verified Apple and generic OIDC ID tokens against pinned
  issuer/audience/expiry/nonce/authorized-party claims and remote JWKS. Generic
  OIDC now requires matching discovery issuer, HTTPS endpoints outside allowed
  loopback development, a verified ID token, authenticated userinfo, and exact
  subject binding. Email auto-linking accepts only literal verified booleans.
- Migrated secure user and admin refresh cookies to `__Host-` names with
  `Secure; Path=/`, while expiring and never reading predecessor `__Secure-` or
  unprefixed path-scoped cookies. Existing secure browser sessions must sign in
  again. Release cookie auth requires HTTPS except for CLI-owned local loopback;
  `SameSite=None` remains HTTPS-only.
- Serialized every Web credential/cookie-creating auth response across tabs and
  made sign-out take the final mutation slot after advancing a persisted auth
  epoch. React Native applies the same late-response fence through serialized
  secure-storage mutations. A stale sign-in, refresh, OAuth, MFA, profile, or
  password response can no longer restore a signed-out session.
  Provider-error callbacks consume their exact sign-in/link state before
  provider, redirect, cookie, or payload branching, so terminal errors cannot
  be replayed through a non-redirect or mismatched-provider path.
  Recognized Web callback fields are scrubbed before storage or network access,
  with a clean-location fallback when the History API is unavailable.
- Validated Cloudflare account IDs, Hyperdrive names, JitPack artifact names,
  and release versions before constructing privileged outbound URLs, while
  documenting narrowly audited CodeQL sinks and test-only regex findings.
- Added a checksum-pinned Gitleaks workflow that scans complete Git history and
  uses fingerprint-specific exceptions for known documentation/test fixtures.
- Limited portable-launcher Worker bindings to explicit env files, standard
  EdgeBase runtime keys, and named custom process keys. The transient binding
  file is atomically written with owner-only permissions and removed after
  normal exit or launch failure. Pack and Docker configs now expose their
  intentional Worker bindings to runtime config consistently.
- Rejected absolute, escaping, and root-name-dependent symbolic links before
  creating portable archives. A link that happens to resolve inside the build
  directory can no longer point outside after the artifact is moved or renamed.
- Raised the optional `@edge-base/web` Yjs peer and development floor to
  `^13.6.31`.

### Fixed

- Restricted year-long immutable caching for static frontend assets to
  conservative fingerprint-like suffixes. Mutable PWA metadata such as
  `sw-precache.json` now revalidates, while ordinary configuration-style file
  names use the short cache policy instead of being mistaken for content hashes.
- Exempted only genuine frontend, admin, and harness `GET`/`HEAD` assets from
  software and Cloudflare global API rate limits, so ordinary page loads cannot
  starve authentication or API traffic. API and control routes remain limited.
- Propagated safe config-time development environment values such as
  `NODE_ENV` and `*_RATE_LIMIT_PROFILE`, plus explicitly allowlisted keys, into
  the generated local runtime without copying arbitrary shell secrets.
- Initialized the auth schema before first-boot `admin.auth.listUsers()` calls
  and stopped same-principal cookie refresh broadcasts from causing cross-tab
  refresh loops.
- Added stable cookie-auth origin error slugs for missing, unverifiable, and
  untrusted browser origins.

### Release engineering

- Bounded project `edgebase-post-scaffold.mjs` deploy hooks to five minutes and
  report an actionable timeout instead of allowing a release deploy to hang.

- Pinned the Docker base and Semgrep container by immutable digest, removed
  unused runtime package-manager tooling, added Dependabot coverage across the
  monorepo SDK ecosystems, and made CI emit a CycloneDX SBOM while blocking
  fixable high/critical image vulnerabilities.
- Replaced integration-test process-name killing with owner-validated process
  groups. Shards and retries now reap only their own Vitest/Miniflare trees on
  normal completion, timeout, and shell signals without terminating unrelated
  local EdgeBase runtimes.
- Preserved signal exit codes, fresh-retry config cleanup, and Bash 3.2 support
  in the sharded integration harness, with regression coverage for unrelated
  matching processes and uncooperative descendants.
- Synchronized package metadata, generated SDK headers, realtime wire-version
  constants, public install examples, and release references to 0.4.0.

### Compatibility

- No high-level SDK method is removed or renamed. The generated low-level Core
  methods now expose the previously undocumented OAuth redirect query and link
  JSON body while preserving the exact released inputless call shape (including
  JVM/.NET/C++ overloads and Go/Rust `WithQuery`/`WithBody` helpers). React
  Native `signInWithOAuth()` is now async so the callback nonce is durably
  stored before `Linking.openURL()`; callers that use its returned `{ url }`
  must await it. React Native production clients must provide `secureStorage`;
  ordinary storage is accepted for auth only through the explicit
  `allowInsecureAuthStorageForDevelopment` escape hatch. Pre-namespace global
  refresh-token keys are deliberately not imported. Custom-scheme native OAuth
  callbacks and non-allowlisted/non-HTTPS release redirects are rejected.
  Active or unknown storage documents now download instead of
  rendering in the application origin, browser OAuth callbacks not preceded by
  `signInWithOAuth()` are intentionally rejected, and signed upload URLs are
  intentionally one-time grants. Create a new signed upload URL for each retry
  after finalization has begun.

## 0.3.8 — 2026-07-10

### Fixed

- Replaced the development runtime's single `node_modules` link with an exact
  package link farm so npm nested dependencies, pnpm virtual stores, and
  workspace installs resolve the server dependency graph consistently.
- Prevented copied pnpm/workspace package shims from being rewritten as
  self-referential links such as `src -> src` in portable and Docker bundles.
- Kept runtime source, admin assets, and dependencies on the CLI's exact
  `@edge-base/server` graph even when a consumer installs conflicting top-level
  package versions.

### Release engineering

- Made the isolated npm release workspace install its own frozen dependency
  graph from the local pnpm store instead of depending on source-tree build
  leftovers.
- Prebuilt the complete npm target graph before registry skip checks so a
  partially completed publish can be resumed without missing prerequisite
  artifacts.
- Made release staging and token-auth temporary directories clean up on copy,
  install, or setup failures.
- Expanded clean packed-tarball contracts across npm and pnpm consumers,
  including nested-version conflicts and development-runtime dependency links.
- Made npm/pnpm release subprocesses resolve Windows command shims safely and
  replaced the Auth UI package's POSIX-only stylesheet copy command.

### Compatibility

- No SDK or HTTP API compatibility break is introduced. CLI users on 0.3.7,
  especially pnpm and source-workspace users, should upgrade to 0.3.8 or later.

## 0.3.7 — 2026-07-10

### Fixed

- Fixed Docker and portable runtime bundles created by a clean npm-installed
  CLI so they materialize the consumer project's server dependency graph
  instead of silently omitting `node_modules`.
- Made copied runtime scaffolds fail closed when no dependency source can be
  found, while preserving install-before-dev scaffolding behavior.

### Release engineering

- Added a clean-consumer contract that packs the npm CLI and its first-party
  runtime packages, installs the tarballs without workspace links, and checks
  both portable and Docker dependency profiles.
- Kept the OpenAPI health response example synchronized with the root release
  version alongside the existing runtime and schema version references.

### Compatibility

- No SDK or HTTP API compatibility break is introduced. Consumers using
  Docker or portable packaging must upgrade from 0.3.6 to 0.3.7 or later.

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
