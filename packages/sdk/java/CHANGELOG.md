# Changelog

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
