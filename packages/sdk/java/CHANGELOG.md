# Changelog

## 0.5.0

### Changed

- Synchronized the Java SDK packages and generated API surfaces with EdgeBase
  0.5.0.
- No Java-specific API compatibility break is introduced.

## 0.4.9

### Changed

- Synchronized the Java SDK packages with the EdgeBase 0.4.9 patch release.
- No public Java API compatibility break is introduced.

## 0.4.8

### Changed

- Synchronized the Java SDK packages with the EdgeBase 0.4.8 patch release.
- Corrected database subscription and error-handling examples to match the
  current Java client API.
- No public Java API compatibility break is introduced.

## 0.4.7

### Changed

- Synchronized the Java SDK packages with the EdgeBase 0.4.7 patch release.
- No public Java API compatibility break is introduced.

## 0.4.6

### Changed

- Synchronized the Java SDK packages with the EdgeBase 0.4.6 patch release.
- No public Java API compatibility break is introduced.

## 0.4.5

### Changed

- Synchronized the Java SDK packages with the EdgeBase 0.4.5 patch release.
- No public Java API compatibility break is introduced.

## 0.4.4

### Changed

- Synchronized the Java SDK packages with the EdgeBase 0.4.4 patch release.
- No public Java API compatibility break is introduced.

## 0.4.3

### Changed

- Synchronized the Java SDK packages with the EdgeBase 0.4.3 patch release.
- No public Java API compatibility break is introduced.

## 0.4.2

### Changed

- Synchronized the Java SDK packages with the EdgeBase 0.4.2 security patch
  release.
- No public Java API compatibility break is introduced.

## 0.4.1

### Added

- Added `AndroidEdgeBase.client(activity, url, ...)` as the required Android
  construction path and `CaptchaUnavailableException` with the stable
  `captcha-unavailable` diagnostic code.

### Changed

- Android client construction now fails fast without a current `Activity`, so
  first-interaction CAPTCHA and permission UI cannot race lifecycle tracking.
- CAPTCHA config fetch and malformed-response failures now fail closed with
  stable typed reasons instead of being interpreted as disabled protection.
- Token replacement and refresh persist storage before changing the in-memory
  session; persistence and invalid-pair failures remain visible through
  authenticated HTTP.
- Anonymous email/phone upgrades now fail before the request unless a
  `DurableTokenStorage` is supplied or the JWT is known to be non-anonymous;
  `tryRestoreSession()` exposes explicit persisted-session restoration.
- CAPTCHA script, WebView, origin, renderer, timeout, and secure-random failures
  now surface typed diagnostics instead of degrading to a missing token.
- Positive CAPTCHA site keys expire after five minutes and missing keys are not
  cached, so newly enabled protection is observed promptly.

## 0.4.0 — 2026-07-11

### Changed

- Synchronized Java/JitPack artifact guidance and realtime wire-version
  reporting with EdgeBase 0.3.9.
- Release verification now rejects malformed JitPack artifact names and
  versions before probing the canonical POM URL.
- No public Java API compatibility break is introduced.

## 0.3.8 — 2026-07-10

### Changed

- Synchronized Java/JitPack artifact guidance and realtime wire-version
  reporting with EdgeBase 0.3.8.
- No public Java API compatibility break is introduced.

## 0.3.7 — 2026-07-10

### Changed

- Synchronized Java/JitPack artifact guidance and realtime wire-version
  reporting with EdgeBase 0.3.7.
- No public Java API compatibility break is introduced.

## 0.3.6 — 2026-07-10

### Changed

- Synchronized Java/JitPack artifact guidance and realtime wire-version
  reporting with EdgeBase 0.3.6.
- No public Java API compatibility break is introduced.

## 0.1.0 — 2026-02-20

### Added
- Initial release of EdgeBase Java SDK.
- Client SDK (`EdgeBase.client()`) with Auth, Collection, Storage, DatabaseLive.
- Server SDK (`EdgeBase.admin()`) with AdminAuth, SQL, Broadcast.
- Full query builder with immutable chaining.
- Batch operations: `createMany`, `upsertMany`, `updateMany`, `deleteMany`.
- Field operations: `EdgeBaseFieldOps.increment()`, `EdgeBaseFieldOps.deleteField()`.
- OkHttp WebSocket-based DatabaseLive with auto-reconnect.
- Presence and Broadcast channels.
- Signed URL generation for storage.
- 53 E2E test scenarios mirroring Kotlin SDK coverage.
