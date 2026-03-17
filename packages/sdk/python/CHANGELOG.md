# Changelog

## 0.1.0 (2026-02-13)

### Features (Dart/Swift/Kotlin SDK 완전 패리티)
- **Core**: EdgeBase 클라이언트, httpx 비동기 HTTP, TokenManager (asyncio.Lock, 30s 버퍼)
- **Auth**: sign_up/sign_in/sign_out/sign_in_anonymously/OAuth/link, on_auth_state_change (콜백)
- **AdminAuth**: Service Key 기반 유저 관리
- **Collection**: 불변 쿼리 빌더, CRUD, batch (create_many/upsert_many/update_many/delete_many)
- **DocRef**: get/update/delete/on_snapshot (async generator)
- **Storage**: upload/download/delete/list/get_url/get_metadata/update_metadata/signed_url/copy/move/resumable
- **DatabaseLive**: websockets + auto-reconnect, Presence/Broadcast 채널
- **FieldOps**: increment/delete_field 원자적 연산
- **TokenStorage**: MemoryTokenStorage + KeyringTokenStorage (macOS/Linux/Windows + 환경변수 폴백)
