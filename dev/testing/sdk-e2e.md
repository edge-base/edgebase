# Running SDK E2E tests locally

The SDK end-to-end suites drive each language SDK against a real EdgeBase test
server. In CI they live in `.github/workflows/test.yml`; locally they are driven
by `scripts/run-with-services.mjs`, which boots the test server (and a mock FCM
server with `--mock-fcm`) on `http://localhost:8688`, runs your command, and
tears the services down afterward.

> The exact server config the suites run against is
> `packages/server/edgebase.test.config.ts` (note: it runs in `release: true`
> mode, so auth redirect flows require `auth.allowedRedirectUrls`).

## Toolchain matrix

| SDK | Needs | Reproducible on macOS/Linux? |
| --- | --- | --- |
| JS / React Native | Node + pnpm | ✅ |
| Python | `python3` + `uv` | ✅ |
| Dart (core, admin) | `dart` | ✅ |
| Dart (flutter) | `flutter` | ✅ (once Flutter is installed) |
| Kotlin / Java | JDK + `./gradlew` (bundled) | ✅ |
| Swift | `swift` + `xcodebuild` (Xcode) | ✅ |
| C++ | `cmake` + a C++ toolchain | ✅ |

## Skip / fail behavior (important)

Every SDK E2E suite first checks that the backend is reachable
(`GET /api/health`). If it is not, the suite **skips** — unless
`EDGEBASE_E2E_REQUIRED=1` is set, in which case it **fails** instead. CI sets
`EDGEBASE_E2E_REQUIRED=1`; locally you usually want it too so a missing/slow
server surfaces loudly instead of silently skipping.

## Commands

Run these from the repo root.

### JS / React Native (verified)

```bash
node ./scripts/run-with-services.mjs --server --mock-fcm --cwd packages/sdk/js -- pnpm run test:e2e
node ./scripts/run-with-services.mjs --server --mock-fcm --cwd packages/sdk/react-native -- pnpm test:e2e
```

### Dart core + admin (verified)

```bash
node ./scripts/run-with-services.mjs --server --mock-fcm -- bash -lc '
  cd packages/sdk/dart/packages/core  && dart pub get && dart test test/core_e2e_test.dart -r expanded
  cd ../admin                         && dart pub get && dart test test/admin_e2e_test.dart -r expanded'
```

### Kotlin

Uses the bundled `./gradlew`. Local reproduction on macOS is fiddly: the forked
Gradle test JVM did not pick up `BASE_URL`/`EDGEBASE_E2E_REQUIRED`, so
`isServerAvailable()` (GET /api/health) skipped every test. `--no-daemon` plus
`BASE_URL=http://127.0.0.1:8688` is the right direction but was not fully working
in this pass — prefer CI, or teach the Gradle test task to `environment(...)`-pass
those vars.

```bash
node ./scripts/run-with-services.mjs --server --mock-fcm --cwd packages/sdk/kotlin -- \
  bash -lc 'BASE_URL=http://127.0.0.1:8688 EDGEBASE_E2E_REQUIRED=1 ./gradlew --no-daemon \
    :client:jvmTest --tests "dev.edgebase.sdk.client.ClientEdgeBaseJvmAuthE2ETest" --console=plain'
```

### Swift

<!-- filled in during the toolchain reproduction pass -->
_TBD (custom `scripts/start-test-server.sh` + `swift test --filter`)._

### C++ (verified)

Needs `cmake` + `ninja` (`brew install cmake ninja`). Sync third-party deps first,
then build and run the core unit + e2e binaries against the local server:

```bash
packages/sdk/cpp/scripts/sync-thirdparty.sh
node ./scripts/run-with-services.mjs --server --mock-fcm -- bash -lc '
  BD=/tmp/edgebase-cpp-core-build
  cmake -S packages/sdk/cpp/packages/core/tests -B "$BD" -G Ninja
  cmake --build "$BD" --parallel
  "$BD/unit_test"
  BASE_URL=http://127.0.0.1:8688 EDGEBASE_E2E_REQUIRED=1 "$BD/e2e_test"'
```

## Gotchas

- **Gradle daemon caches the environment.** A running Gradle daemon does not pick
  up newly-exported env vars (`EDGEBASE_E2E_REQUIRED`, `BASE_URL`), so the test
  JVM can silently `assumeTrue`-skip. Use `./gradlew --no-daemon …` for a clean
  local reproduction.
- **`localhost` vs `127.0.0.1`.** JVM HTTP clients may resolve `localhost` to
  IPv6 `::1` while the test server binds IPv4; pass `BASE_URL=http://127.0.0.1:8688`
  if the reachability check fails despite a running server.
- **One server at a time.** `run-with-services.mjs` binds `:8688`; do not run two
  language suites concurrently.

## Jobs that need a real Windows runner (not locally reproducible)

These stay red on a macOS/Linux dev box and must be reproduced on Windows:

- `CI / Node Compatibility (windows-latest)`
- `CI / Pack Smoke (windows-latest)` — non-portable pnpm symlink in the pack
- `Test Suite … / JS SDK E2E (windows-latest)`
- `Test Suite … / Python SDK E2E (windows-latest)`
- `Test Suite … / C++ Unreal Win64 ThirdParty package`
