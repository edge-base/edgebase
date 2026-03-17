# Changelog

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
