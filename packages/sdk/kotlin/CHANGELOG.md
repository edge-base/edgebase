# Changelog

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
