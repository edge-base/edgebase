<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

<h1 align="center">edgebase_flutter</h1>

<p align="center">
  <b>Flutter SDK for EdgeBase</b><br>
  Auth, database, realtime, rooms, storage, functions, analytics, and push for Flutter apps
</p>

<p align="center">
  <a href="https://pub.dev/packages/edgebase_flutter"><img src="https://img.shields.io/pub/v/edgebase_flutter?color=brightgreen" alt="pub.dev"></a>&nbsp;
  <a href="https://edgebase.fun/docs/sdks/flutter"><img src="https://img.shields.io/badge/docs-flutter_sdk-blue" alt="Docs"></a>&nbsp;
  <a href="https://github.com/edge-base/edgebase/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  Flutter · iOS · Android · Web · macOS · Realtime · Firebase Push
</p>

<p align="center">
  <a href="https://edgebase.fun/docs/getting-started/quickstart"><b>Quickstart</b></a> ·
  <a href="https://edgebase.fun/docs/sdks/flutter"><b>Flutter Docs</b></a> ·
  <a href="https://edgebase.fun/docs/authentication"><b>Authentication</b></a> ·
  <a href="https://edgebase.fun/docs/database/client-sdk"><b>Database Client SDK</b></a> ·
  <a href="https://edgebase.fun/docs/room/client-sdk"><b>Room Client SDK</b></a>
</p>

---

`edgebase_flutter` is the main client SDK for Flutter applications.

Use it when your app needs:

- email/password, OAuth, magic link, MFA, and anonymous auth
- direct client-side database access through EdgeBase access rules
- live updates with `onSnapshot()`
- presence, signals, and shared state with rooms
- storage uploads and file URLs
- client-side function calls and analytics
- push registration for Android and iOS with Firebase Messaging

If you need trusted server-side access with a Service Key, use [`edgebase_admin`](https://pub.dev/packages/edgebase_admin) instead. If you only want lower-level table, storage, and HTTP primitives, use [`edgebase_core`](https://pub.dev/packages/edgebase_core).

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

> Beta: the package is already usable, but some APIs may still evolve before general availability.

## Documentation Map

Use this README for the fast overview, then jump into the docs when you need more depth:

- [Quickstart](https://edgebase.fun/docs/getting-started/quickstart)
  Create a local EdgeBase project and connect your app
- [Flutter SDK](https://edgebase.fun/docs/sdks/flutter)
  Flutter-specific setup and usage patterns
- [Authentication](https://edgebase.fun/docs/authentication)
  Email/password, OAuth, MFA, sessions, and captcha
- [Database Client SDK](https://edgebase.fun/docs/database/client-sdk)
  Query and mutation patterns
- [Database Subscriptions](https://edgebase.fun/docs/database/subscriptions)
  Live queries with `onSnapshot()`
- [Room Client SDK](https://edgebase.fun/docs/room/client-sdk)
  Presence, room state, members, signals, and media-ready flows
- [Functions Client SDK](https://edgebase.fun/docs/functions/client-sdk)
  Calling EdgeBase functions from Flutter clients
- [Analytics Client SDK](https://edgebase.fun/docs/analytics/client-sdk)
  Track client-side events
- [Push Client SDK](https://edgebase.fun/docs/push/client-sdk)
  Client push concepts and message flows

## For AI Coding Assistants

If you are using an AI coding assistant, check [`llms.txt`](https://github.com/edge-base/edgebase/blob/main/packages/sdk/dart/packages/flutter/llms.txt) before generating code.

It captures the package boundaries, canonical examples, and Dart-specific API differences that are easy to get wrong, especially around auth streams, `instanceId`, storage signed URLs, and room APIs.

## Installation

```bash
flutter pub add edgebase_flutter
```

Starting a brand new EdgeBase project?

```bash
npm create edgebase@latest my-app
```

That scaffold creates a local EdgeBase app you can connect to from Flutter during development.

Read more: [Quickstart](https://edgebase.fun/docs/getting-started/quickstart)

## Local Development Tip

`http://localhost:8787` works in the browser on your dev machine, but mobile runtimes usually need a device-reachable address:

- Android emulator: `http://10.0.2.2:8787`
- iOS simulator: `http://127.0.0.1:8787`
- Physical device: `http://<your-lan-ip>:8787`

If you are running Flutter Web in the browser on the same machine, `http://localhost:8787` is fine.

## Quick Start

```dart
import 'package:edgebase_flutter/edgebase_flutter.dart';

final client = ClientEdgeBase('http://10.0.2.2:8787');

await client.auth.signIn(
  SignInOptions(
    email: 'june@example.com',
    password: 'pass1234',
  ),
);

final posts = await client
    .db('app')
    .table('posts')
    .where('published', '==', true)
    .orderBy('createdAt', direction: 'desc')
    .limit(10)
    .getList();

final health = await client.functions.get('health');

print(posts.items);
print(health);
```

Read more: [Flutter SDK Docs](https://edgebase.fun/docs/sdks/flutter)

## Core API

Once you create a client, these are the main surfaces you will use:

- `client.auth`
  Sign up, sign in, sign out, OAuth, MFA, and auth state handling
- `client.db(namespace, instanceId: ...)`
  Query tables, create records, update documents, and subscribe to live changes
- `client.storage`
  Upload files and resolve bucket URLs
- `client.functions`
  Call EdgeBase functions from the client
- `client.room(namespace, roomId)`
  Join realtime rooms for presence, state sync, and signals
- `client.analytics`
  Send analytics events from the client
- `client.push`
  Register device tokens and listen for foreground push messages

## Room Media Transport

Flutter now exposes the same top-level room media transport entrypoint as the web and React Native SDKs:

```dart
final room = client.room('calls', 'demo-room');
await room.join();

final transport = room.media.transport(
  const RoomMediaTransportOptions(
    provider: 'cloudflare_realtimekit',
  ),
);

await transport.connect({
  'name': 'June',
  'customParticipantId': 'flutter-june',
});

await transport.enableAudio();
final localVideoView = await transport.enableVideo();
```

`cloudflare_realtimekit` is the currently supported Flutter runtime provider.

To use it, add the RealtimeKit dependency alongside `edgebase_flutter`:

```bash
flutter pub add realtimekit_core
```

Read more:

- [Room Media Overview](https://edgebase.fun/docs/room/media)
- [Room Media Setup](https://edgebase.fun/docs/room/media-setup)

## Authentication

### Email and password

```dart
await client.auth.signUp(
  SignUpOptions(
    email: 'june@example.com',
    password: 'pass1234',
    data: {'displayName': 'June'},
  ),
);

await client.auth.signIn(
  SignInOptions(
    email: 'june@example.com',
    password: 'pass1234',
  ),
);

client.auth.onAuthStateChange.listen((user) {
  print('auth changed: ${user?.id}');
});
```

### Current user

```dart
final user = client.auth.currentUser;
if (user != null) {
  print(user.email);
}
```

Read more: [Authentication Docs](https://edgebase.fun/docs/authentication)

## Database Queries

```dart
final posts = client.db('app').table('posts');

final latest = await posts
    .where('published', '==', true)
    .orderBy('createdAt', direction: 'desc')
    .limit(20)
    .getList();

final created = await posts.insert({
  'title': 'Hello EdgeBase',
  'published': true,
});

await posts.doc(created['id'] as String).update({
  'title': 'Updated title',
});
```

For instance databases, pass the instance id explicitly:

```dart
client.db('workspace', instanceId: 'ws-123');
client.db('user', instanceId: 'user-123');
```

Read more: [Database Client SDK](https://edgebase.fun/docs/database/client-sdk)

## Database Live

`onSnapshot()` returns a stream, so it fits naturally into Flutter state and `StreamBuilder` flows.

```dart
final stream = client
    .db('app')
    .table('posts')
    .where('published', '==', true)
    .onSnapshot();

final sub = stream.listen((change) {
  print(change.changeType);
  print(change.data);
});

// Later:
await sub.cancel();
```

Read more: [Database Subscriptions](https://edgebase.fun/docs/database/subscriptions)

## Rooms And Presence

```dart
final room = client.room('presence', 'lobby-1');
await room.join();

room.members.onSync((members) {
  print('online members: ${members.length}');
});

room.signals.on('wave', (payload, meta) {
  print('signal: $payload');
});

await room.members.setState({'status': 'active'});
await room.signals.send('wave', {'emoji': 'hi'}, {'includeSelf': true});
```

Remember to leave the room when the screen or feature is disposed:

```dart
room.leave();
```

Read more: [Room Client SDK](https://edgebase.fun/docs/room/client-sdk)

## Storage

```dart
final bytes = [1, 2, 3, 4];

await client.storage.bucket('uploads').upload(
  'hello.bin',
  bytes,
  contentType: 'application/octet-stream',
);

final url = client.storage.bucket('uploads').getUrl('hello.bin');
print(url);
```

Read more: [Storage Docs](https://edgebase.fun/docs/storage)

## Push Notifications

`edgebase_flutter` integrates with Firebase Messaging for native push flows.

```dart
import 'package:firebase_core/firebase_core.dart';

await Firebase.initializeApp();

await client.push.register(metadata: {
  'topic': 'news',
});

client.push.onMessage((message) {
  print(message['title']);
  print(message['body']);
});
```

Read more: [Push Client SDK](https://edgebase.fun/docs/push/client-sdk)

## Choose The Right Dart Package

| Package | Use it for |
| --- | --- |
| `edgebase_flutter` | Flutter apps running on device or web |
| `edgebase_admin` | Trusted server-side Dart code with Service Key access |
| `edgebase_core` | Low-level table, storage, and HTTP primitives |
| `edgebase` | Umbrella package when you want a broader Dart entry point |

## License

MIT
