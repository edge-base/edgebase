# edgebase

Open-source Global Edge BaaS SDK for Dart/Flutter.

## Features

- **Auth** — signUp, signIn, OAuth, anonymous, email verify, password reset
- **Database** — namespace-aware query builder, CRUD, upsert, count
- **Storage** — bucket-based file upload/download/delete
- **Functions** — `client.functions.get/post/put/patch/delete`
- **Analytics** — `client.analytics.track(...)`
- **DatabaseLive** — WebSocket subscriptions, Flutter `StreamBuilder` compatible
- **Token Management** — pluggable `TokenStorage` interface (use `flutter_secure_storage` or custom)

## Getting Started

```dart
import 'package:edgebase_flutter/edgebase.dart';

final client = ClientEdgeBase('https://your-app.edgebase.fun');

// Sign up
await client.auth.signUp(SignUpOptions(
  email: 'user@example.com',
  password: 'securePass123',
));

// Query records
final posts = await client.db('shared').table('posts')
    .where('status', '==', 'published')
    .orderBy('createdAt', 'desc')
    .limit(20)
    .getList();

// Functions + Analytics
await client.functions.post('welcome-email', {'to': 'user@example.com'});
await client.analytics.track('dart_example_opened');

// Cleanup
client.destroy();
```

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
  tokenStorage: FlutterTokenStorage(),
);
```

## License

MIT
