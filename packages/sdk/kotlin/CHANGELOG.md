# Changelog

## 0.5.0

### Changed

- Synchronized the Kotlin SDK packages and generated API surfaces with
  EdgeBase 0.5.0.
- No Kotlin-specific API compatibility break is introduced.

## 0.4.9

### Changed

- Synchronized the Kotlin SDK packages with the EdgeBase 0.4.9 patch release.
- No public Kotlin API compatibility break is introduced.

## 0.4.8

### Changed

- Synchronized the Kotlin SDK packages with the EdgeBase 0.4.8 patch release.
- Corrected database subscription and error-handling examples to match the
  current Kotlin client API.
- No public Kotlin API compatibility break is introduced.

## 0.4.7

### Changed

- Synchronized the Kotlin SDK packages with the EdgeBase 0.4.7 patch release.
- No public Kotlin API compatibility break is introduced.

## 0.4.6

### Changed

- Synchronized the Kotlin SDK packages with the EdgeBase 0.4.6 patch release.
- No public Kotlin API compatibility break is introduced.

## 0.4.5

### Changed

- Synchronized the Kotlin SDK packages with the EdgeBase 0.4.5 patch release.
- No public Kotlin API compatibility break is introduced.

## 0.4.4

### Changed

- Synchronized the Kotlin SDK packages with the EdgeBase 0.4.4 patch release.
- No public Kotlin API compatibility break is introduced.

## 0.4.3

### Changed

- Synchronized the Kotlin SDK packages with the EdgeBase 0.4.3 patch release.
- No public Kotlin API compatibility break is introduced.

## 0.4.2

### Changed

- Synchronized the Kotlin SDK packages with the EdgeBase 0.4.2 security patch
  release.
- No public Kotlin API compatibility break is introduced.

## 0.4.1

### Added

- Added `AndroidEdgeBase.client(activity, url, ...)` as the required Android
  construction path and `CaptchaUnavailableException` with the stable
  `captcha-unavailable` diagnostic code.

### Changed

- Android client construction now fails fast without a current `Activity`, so
  the first CAPTCHA or permission interaction cannot race lifecycle tracking.
- CAPTCHA config fetch and malformed-response failures now fail closed with
  stable typed reasons instead of being interpreted as disabled protection.
- Apple token storage now defaults to Security.framework Keychain and removes
  legacy plaintext `NSUserDefaults` token keys.
- Token replacement and refresh persist storage before changing the in-memory
  session; `TokenPersistenceException` and invalid-pair failures remain visible
  through authenticated HTTP instead of falling back to stale/anonymous calls.
- Anonymous email/phone upgrades now require `DurableTokenStorage` unless the
  current JWT is known to be non-anonymous. JVM and browser defaults store each
  access/refresh pair in one value and migrate legacy split keys.
- CAPTCHA script, WebView, origin, renderer, timeout, and secure-random failures
  now surface typed diagnostics instead of degrading to a missing token.
- Browser CAPTCHA loading has a bounded shared deadline, never removes
  host-owned scripts, resets failed attempts, caches only positive site keys for
  five minutes, and retries a direct `challenge_error` exactly once.

## 0.4.0 (2026-07-11)

### Changed

- Synchronized Kotlin/JitPack artifact guidance and realtime wire-version
  reporting with EdgeBase 0.3.9.
- Release verification now rejects malformed JitPack artifact names and
  versions before probing the canonical POM URL.
- No public Kotlin API compatibility break is introduced.

## 0.3.8 (2026-07-10)

### Changed

- Synchronized Kotlin/JitPack artifact guidance and realtime wire-version
  reporting with EdgeBase 0.3.8.
- No public Kotlin API compatibility break is introduced.

## 0.3.7 (2026-07-10)

### Changed

- Synchronized Kotlin/JitPack artifact guidance and realtime wire-version
  reporting with EdgeBase 0.3.7.
- No public Kotlin API compatibility break is introduced.

## 0.3.6 (2026-07-10)

### Changed

- Synchronized Kotlin/JitPack artifact guidance and realtime wire-version
  reporting with EdgeBase 0.3.6.
- No public Kotlin API compatibility break is introduced.

## 0.2.0 (2026-02-21)

### KMP Migration
- **Core + Client**: Migrated to Kotlin Multiplatform (Android, iOS, JS Browser, JVM Desktop)
- **HTTP**: OkHttp replaced with Ktor (`HttpClient` + engine per platform)
- **WebSocket**: OkHttp WebSocket replaced with Ktor WebSocket (`wss` via `DefaultClientWebSocketSession`)
- **Platform abstractions**: `expect`/`actual` for storage, crypto, and platform-specific APIs
- **Admin**: Stays JVM-only, zero code changes

## 0.1.0 (2026-02-13)

### Features (Dart SDK 완전 패리티)
- **Core**: EdgeBase 클라이언트, OkHttp HTTP 클라이언트, TokenManager (Mutex, 30s 버퍼)
- **Auth**: signUp/signIn/signOut/signInAnonymously/OAuth/link, onAuthStateChange (SharedFlow)
- **AdminAuth**: Service Key 기반 유저 관리
- **Collection**: 불변 쿼리 빌더, CRUD, batch (createMany/upsertMany/updateMany/deleteMany)
- **DocRef**: get/update/delete/onSnapshot (Flow)
- **Storage**: upload/download/delete/list/getUrl/getMetadata/updateMetadata/signedUrl/copy/move/resumable
- **DatabaseLive**: OkHttp WebSocket + auto-reconnect, Presence/Broadcast 채널
- **FieldOps**: increment/deleteField 원자적 연산
