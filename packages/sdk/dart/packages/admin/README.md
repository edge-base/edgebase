<h1 align="center">edgebase_admin</h1>

<p align="center">
  <b>Trusted server-side SDK for EdgeBase in Dart</b><br>
  Database admin, user management, SQL, analytics, push, storage, and trusted function calls
</p>

<p align="center">
  <a href="https://pub.dev/packages/edgebase_admin"><img src="https://img.shields.io/pub/v/edgebase_admin?color=brightgreen" alt="pub.dev"></a>&nbsp;
  <a href="https://edgebase.fun/docs/database/admin-sdk"><img src="https://img.shields.io/badge/docs-admin_sdk-blue" alt="Docs"></a>&nbsp;
  <a href="https://github.com/edge-base/edgebase/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  Dart VM · Backend services · Trusted workers · Cron jobs · Secure environments
</p>

<p align="center">
  <a href="https://edgebase.fun/docs/database/admin-sdk"><b>Database Admin SDK</b></a> ·
  <a href="https://edgebase.fun/docs/authentication/admin-users"><b>Admin Users</b></a> ·
  <a href="https://edgebase.fun/docs/analytics/admin-sdk"><b>Analytics Admin SDK</b></a> ·
  <a href="https://edgebase.fun/docs/push/admin-sdk"><b>Push Admin SDK</b></a>
</p>

---

`edgebase_admin` is the trusted server-side Dart SDK for EdgeBase.

Use it when you need:

- Service Key authenticated access
- server-side database operations that bypass access rules
- admin user management
- raw SQL execution
- push and analytics from secure environments
- server-to-server function calls
- access to KV, D1, and Vectorize resources

If code runs in a Flutter app or untrusted client, use [`edgebase_flutter`](https://pub.dev/packages/edgebase_flutter) instead. If you only need low-level primitives for a custom integration, use [`edgebase_core`](https://pub.dev/packages/edgebase_core).

EdgeBase is an open-source edge-native BaaS that runs on Edge, Docker, and Node.js. If you want the full platform, CLI, docs, and the rest of the public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

> Beta: the package is already usable, but some APIs may still evolve before general availability.

## Documentation Map

- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
  Server-side database access with a Service Key
- [Admin User Management](https://edgebase.fun/docs/authentication/admin-users)
  Create, update, list, revoke, and manage users
- [Analytics Admin SDK](https://edgebase.fun/docs/analytics/admin-sdk)
  Query request analytics and track server-side events
- [Push Admin SDK](https://edgebase.fun/docs/push/admin-sdk)
  Send push notifications from secure environments
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
  Public admin SDK surface by category

## For AI Coding Assistants

If you are using an AI coding assistant, check [`llms.txt`](https://github.com/edge-base/edgebase/blob/main/packages/sdk/dart/packages/admin/llms.txt) before generating code.

It captures the trusted-server package boundary, canonical admin usage, and Dart-specific rules for `adminAuth`, SQL, analytics query options, and Service Key handling.

## Installation

```bash
dart pub add edgebase_admin
```

## Quick Start

```dart
import 'package:edgebase_admin/edgebase_admin.dart';

final admin = AdminEdgeBase(
  'https://your-project.edgebase.fun',
  serviceKey: 'YOUR_SERVICE_KEY',
);

final posts = await admin
    .db('app')
    .table('posts')
    .orderBy('createdAt', direction: 'desc')
    .limit(20)
    .getList();

print(posts.items);
```

## Core API

Once you create an admin client, these are the main surfaces you will use:

- `admin.adminAuth`
  Admin user management
- `admin.db(namespace, instanceId: ...)`
  Server-side database access
- `admin.sql(namespace, instanceId, sql, [params])`
  Raw SQL execution
- `admin.storage`
  Server-side storage access
- `admin.functions`
  Call app functions from trusted code
- `admin.push`
  Send push notifications
- `admin.analytics`
  Query analytics and track server-side events
- `admin.kv(namespace)`, `admin.d1(database)`, `admin.vector(index)`
  Access platform resources from trusted code

## Database Access

```dart
final posts = admin.db('app').table('posts');

final latest = await posts
    .where('status', '==', 'published')
    .orderBy('createdAt', direction: 'desc')
    .limit(20)
    .getList();
```

For instance databases, pass the instance id explicitly:

```dart
admin.db('workspace', instanceId: 'ws-123');
admin.db('user', instanceId: 'user-123');
```

Read more: [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)

## Admin Users

```dart
final created = await admin.adminAuth.createUser(
  email: 'admin@example.com',
  password: 'secure-pass-123',
  displayName: 'June',
  role: 'moderator',
);

await admin.adminAuth.setCustomClaims(created.id, {
  'plan': 'pro',
});

final users = await admin.adminAuth.listUsers(limit: 20);
print(users.users);
```

Read more: [Admin User Management](https://edgebase.fun/docs/authentication/admin-users)

## Raw SQL

```dart
final rows = await admin.sql(
  'workspace',
  'ws-123',
  'select * from documents where status = ?',
  ['published'],
);

print(rows.length);
```

## Push And Analytics

```dart
await admin.push.send('user-123', {
  'title': 'Deployment finished',
  'body': 'Your content is live.',
});

final overview = await admin.analytics.overview({'range': '7d'});
print(overview['summary']);
```

Read more:

- [Analytics Admin SDK](https://edgebase.fun/docs/analytics/admin-sdk)
- [Push Admin SDK](https://edgebase.fun/docs/push/admin-sdk)

## Native Resource Access

```dart
await admin.kv('cache').set('homepage', 'warm', ttl: 60);

final rows = await admin.d1('analytics').exec(
  'SELECT * FROM events WHERE type = ?',
  ['click'],
);

print(rows);
```

## Choose The Right Dart Package

| Package | Use it for |
| --- | --- |
| `edgebase_flutter` | Flutter apps and client-side code |
| `edgebase_admin` | Trusted server-side Dart code with Service Key access |
| `edgebase_core` | Low-level primitives for custom SDK or integration work |
| `edgebase` | Umbrella package when you want a broader Dart entry point |

## License

MIT
