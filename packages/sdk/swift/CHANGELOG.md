# Changelog

## 0.4.6

- Synchronized the Swift package with the EdgeBase 0.4.6 patch release.
- No public Swift API compatibility break is introduced.

## 0.4.5

- Synchronized the Swift package with the EdgeBase 0.4.5 patch release.
- No public Swift API compatibility break is introduced.

## 0.4.4

- Synchronized the Swift package with the EdgeBase 0.4.4 patch release.
- No public Swift API compatibility break is introduced.

## 0.4.3

- Synchronized the Swift package with the EdgeBase 0.4.3 patch release.
- No public Swift API compatibility break is introduced.

## 0.4.2

- Synchronized the Swift package with the EdgeBase 0.4.2 security patch release.
- No public Swift API compatibility break is introduced.

## 0.4.1

- Defaulted client tokens to Keychain and made every Keychain/storage failure
  visible before in-memory adoption.
- Added `tryRestoreSession()`, complete-pair validation, and
  `DurableTokenStorage` preflight for anonymous email/phone upgrades.
- Authenticated HTTP and `HEAD` calls now propagate refresh persistence errors;
  storage existence APIs are correspondingly `async throws`.
- Added typed CAPTCHA availability errors and a five-minute positive site-key
  cache without negative caching.
- CAPTCHA config fetch/malformed-response failures now fail closed; the public
  `fetchSiteKey` API is correspondingly `async throws`.

## 0.4.0

- Synchronized Swift split-package install guidance and realtime wire-version
  reporting with EdgeBase 0.3.9
- No public Swift API compatibility break is introduced

## 0.3.8

- Synchronized Swift split-package install guidance and realtime wire-version
  reporting with EdgeBase 0.3.8
- No public Swift API compatibility break is introduced

## 0.3.7

- Synchronized Swift split-package install guidance and realtime wire-version
  reporting with EdgeBase 0.3.7
- No public Swift API compatibility break is introduced

## 0.3.6

- Synchronized Swift split-package install guidance and realtime wire-version
  reporting with EdgeBase 0.3.6
- No public Swift API compatibility break is introduced

## 0.1.0

Initial release — feature parity with Dart SDK (M20).

### Features
- **Core**: EdgeBase client with URLSession, Keychain token storage, auto-refresh
- **Auth**: signUp/signIn/signOut/signInAnonymously/OAuth/link/sessions/profile
- **Admin Auth**: Service Key based user management (getUser/createUser/updateUser/deleteUser/listUsers)
- **Collections**: Immutable query builder, CRUD, batch ops (createMany/upsertMany/updateMany/deleteMany)
- **Storage**: Upload/download/delete/list, signed URLs, copy/move, resumable uploads
- **DatabaseLive**: WebSocket subscriptions, Presence channels, Broadcast channels
- **Field Ops**: increment/deleteField atomic helpers
