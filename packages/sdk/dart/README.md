# edgebase

Umbrella Dart package for EdgeBase.

`edgebase` re-exports the Flutter client SDK so app code can start from a single import while still keeping `edgebase_flutter`, `edgebase_core`, and `edgebase_admin` available as dedicated packages when you want a narrower boundary.

## Documentation Map

Use this README for the fast overview, then jump into the package-specific docs when you need more depth:

- [Flutter SDK](https://edgebase.fun/docs/sdks/flutter)
  Main client SDK for Flutter apps
- [Database Client SDK](https://edgebase.fun/docs/database/client-sdk)
  Query and mutation patterns
- [Authentication](https://edgebase.fun/docs/authentication)
  Sign in, sessions, MFA, OAuth, and auth state handling
- [Room Client SDK](https://edgebase.fun/docs/room/client-sdk)
  Presence, state sync, members, and signals
- [Functions Client SDK](https://edgebase.fun/docs/functions/client-sdk)
  Call EdgeBase functions from client code
- [Analytics Client SDK](https://edgebase.fun/docs/analytics/client-sdk)
  Track client-side events
- [Push Client SDK](https://edgebase.fun/docs/push/client-sdk)
  Device registration and foreground push flows

## For AI Coding Assistants

This package includes an `llms.txt` file for AI-assisted development.

Use it when you want an assistant to:

- stay within the umbrella package boundary
- prefer `edgebase_flutter` semantics for client code
- know when to switch to `edgebase_core` or `edgebase_admin`
- handle `instanceId`, signed URLs, and realtime APIs in Dart correctly

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/dart/llms.txt)
- in the published package contents next to the README

## Installation

```bash
dart pub add edgebase
```

For Flutter-first apps, `edgebase_flutter` is the more explicit package name. `edgebase` exists as the broad Dart entry point and currently re-exports that client surface.

## Quick Start

```dart
import 'package:edgebase/edgebase.dart';

final client = ClientEdgeBase('https://your-app.edgebase.fun');

await client.auth.signUp(
  SignUpOptions(
    email: 'user@example.com',
    password: 'securePass123',
  ),
);

final posts = await client
    .db('shared')
    .table('posts')
    .where('status', '==', 'published')
    .orderBy('createdAt', direction: 'desc')
    .limit(20)
    .getList();

await client.functions.post('welcome-email', {'to': 'user@example.com'});
await client.analytics.track('dart_example_opened');

client.destroy();
```

## Package Map

| Package | Use it for |
| --- | --- |
| `edgebase` | Broad Dart entry point for client-side app code |
| `edgebase_flutter` | Flutter apps and the main client SDK surface |
| `edgebase_core` | Low-level HTTP, table, storage, and shared primitives |
| `edgebase_admin` | Trusted server-side Dart code with a Service Key |

## Custom Token Storage

```dart
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class FlutterTokenStorage implements TokenStorage {
  final _storage = FlutterSecureStorage();

  @override
  Future<String?> getRefreshToken() => _storage.read(key: 'refresh_token');

  @override
  Future<void> setRefreshToken(String token) =>
      _storage.write(key: 'refresh_token', value: token);

  @override
  Future<void> clearRefreshToken() => _storage.delete(key: 'refresh_token');
}

final client = ClientEdgeBase(
  'https://your-app.edgebase.fun',
  options: EdgeBaseClientOptions(
    tokenStorage: FlutterTokenStorage(),
  ),
);
```

## License

MIT
