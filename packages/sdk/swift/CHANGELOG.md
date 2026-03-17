# Changelog

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
