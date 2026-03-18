## 0.1.2

- Added `edgebase_core`, `edgebase_admin`, and `edgebase_flutter` package documentation
- Added package-level `llms.txt` guidance for AI coding assistants
- Updated package metadata for public publishing

## 0.1.0

- Initial release
- Auth: signUp, signIn, signOut, OAuth, anonymous, link, sessions, profile, email verify, password reset
- Collections: immutable query builder, CRUD, upsert, count, doc ref
- Storage: bucket-based upload, download, delete, list, metadata
- DatabaseLive: WebSocket subscriptions with auto-reconnect
- Token management: abstract TokenStorage interface, MemoryTokenStorage default
- Context: isolateBy multi-tenant context injection
- Error handling: EdgeBaseError, EdgeBaseAuthError with field errors
