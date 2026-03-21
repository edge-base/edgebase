<!-- Generated from packages/sdk/dart/packages/admin/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase Dart Admin SDK

Use this file as a quick-reference contract for AI coding assistants working with `edgebase_admin`.

## Package Boundary

Use `edgebase_admin` in trusted server-side Dart environments only.

Do not ship this package to Flutter clients, browsers, or untrusted code. It is meant for secure environments where a Service Key is available. If code runs inside a Flutter app, use `edgebase_flutter` instead.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/dart/packages/admin/README.md
- Database Admin SDK: https://edgebase.fun/docs/database/admin-sdk
- Admin users: https://edgebase.fun/docs/authentication/admin-users
- Analytics Admin SDK: https://edgebase.fun/docs/analytics/admin-sdk
- Push Admin SDK: https://edgebase.fun/docs/push/admin-sdk
- Admin SDK reference: https://edgebase.fun/docs/admin-sdk/reference

If docs, examples, and assumptions disagree, prefer the current package API and official docs over guessed patterns.

## Canonical Examples

### Create an admin client

```dart
import 'package:edgebase_admin/edgebase_admin.dart';

final admin = AdminEdgeBase(
  'https://your-project.edgebase.fun',
  serviceKey: 'YOUR_SERVICE_KEY',
);
```

### Query a table

```dart
final posts = await admin
    .db('app')
    .table('posts')
    .where('status', '==', 'published')
    .getList();
```

### Query an instance database

```dart
final docs = await admin
    .db('workspace', instanceId: 'ws-1')
    .table('documents')
    .getList();
```

### Manage users

```dart
final created = await admin.adminAuth.createUser(
  email: 'june@example.com',
  password: 'pass1234',
  displayName: 'June',
);

await admin.adminAuth.updateUser(
  created.id,
  AdminUpdateUserOptions(
    displayName: 'June Kim',
    role: 'moderator',
  ),
);

await admin.adminAuth.setCustomClaims(created.id, {
  'role': 'moderator',
});
```

### Execute SQL

```dart
final rows = await admin.sql(
  'workspace',
  'ws-1',
  'select * from documents where status = ?',
  ['published'],
);
```

### Send push and query analytics

```dart
await admin.push.send('user-123', {
  'title': 'Hello',
  'body': 'From the admin SDK',
});

final overview = await admin.analytics.overview({
  'range': '7d',
});
```

### Broadcast a realtime event

```dart
await admin.broadcast('announcements', 'system:update', {
  'version': '0.1.2',
});
```

## Hard Rules

- keep Service Keys on trusted servers only
- the admin auth surface is `admin.adminAuth`, not `admin.auth`
- `admin.db(namespace, instanceId: ...)` uses a named `instanceId` parameter in Dart
- `admin.sql(namespace, instanceId, sql, [params])` requires the namespace first; pass `null` as `instanceId` for single-instance blocks if needed
- `admin.adminAuth.updateUser(...)` expects an `AdminUpdateUserOptions` instance, not loose named arguments
- analytics queries like `overview`, `timeSeries`, `breakdown`, and `topEndpoints` take an optional `Map<String, String>` options object, not named arguments
- `admin.kv(namespace)`, `admin.d1(database)`, and `admin.vector(index)` expose trusted infra clients
- `admin.broadcast(channel, event, [payload])` is a server-side broadcast helper

## Common Mistakes

- do not use `edgebase_admin` in Flutter UI code or other client-side environments
- do not copy JS examples that use `admin.auth`; in Dart it is `admin.adminAuth`
- do not pass instance ids positionally to `db(...)`; use `instanceId: 'ws-1'`
- do not assume `admin.sql('select 1')` exists in Dart; this SDK currently uses the explicit namespace and instance-id form
- do not call `updateUser('id', displayName: '...')`; construct `AdminUpdateUserOptions(...)`
- do not call `admin.analytics.overview(range: '7d')`; pass a `Map<String, String>` like `{'range': '7d'}`
- do not expose the Service Key through mobile apps or browser bundles

## Quick Reference

```text
AdminEdgeBase(url, { serviceKey?, projectId? })                  -> AdminEdgeBase
admin.db(namespace, { instanceId? })                             -> DbRef
admin.sql(namespace, instanceId, sql, [params])                  -> Future<List<Map<String, dynamic>>>
admin.adminAuth.listUsers({ limit?, cursor? })                   -> Future<AdminListUsersResult>
admin.adminAuth.getUser(userId)                                  -> Future<AdminUser>
admin.adminAuth.createUser(...)                                  -> Future<AdminUser>
admin.adminAuth.updateUser(userId, AdminUpdateUserOptions(...))  -> Future<AdminUser>
admin.adminAuth.deleteUser(userId)                               -> Future<void>
admin.adminAuth.setCustomClaims(userId, claims)                  -> Future<void>
admin.push.send(userId, payload)                                 -> Future<Map<String, dynamic>>
admin.push.sendMany(userIds, payload)                            -> Future<Map<String, dynamic>>
admin.push.sendToTopic(topic, payload)                           -> Future<Map<String, dynamic>>
admin.analytics.overview([options])                              -> Future<Map<String, dynamic>>
admin.analytics.timeSeries([options])                            -> Future<List<Map<String, dynamic>>>
admin.analytics.queryEvents([options])                           -> Future<dynamic>
admin.kv(namespace)                                              -> KvClient
admin.d1(database)                                               -> D1Client
admin.vector(index)                                              -> VectorizeClient
admin.broadcast(channel, event, [payload])                       -> Future<void>
```
