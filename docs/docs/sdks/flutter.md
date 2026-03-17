---
sidebar_position: 6
---

# Flutter Integration

Build mobile apps with EdgeBase as the backend.

## Setup

```bash
dart pub add edgebase_flutter
```

The `edgebase_flutter` package includes platform-specific optimizations:

- **Secure token storage** via `flutter_secure_storage` (Keychain on iOS, EncryptedSharedPreferences on Android)
- **Automatic token refresh** on app launch and background-to-foreground transitions
- **WebSocket reconnection** with exponential backoff for realtime subscriptions

## Initialization

Create a single client instance and reuse it throughout your app. A common pattern is to initialize it in `main.dart` or a dependency injection setup:

```dart
import 'package:edgebase_flutter/edgebase.dart';

// Create once, use everywhere
final client = ClientEdgeBase('https://your-project.edgebase.fun');
```

:::tip Global Singleton
Avoid creating multiple `ClientEdgeBase` instances — each one opens its own WebSocket connection and manages its own auth state. Use a single instance and pass it via `InheritedWidget`, `Provider`, or any DI approach your app uses.
:::

## Authentication

```dart
// Sign up
await client.auth.signUp(SignUpOptions(email: 'user@example.com', password: 'password'));

// Sign in
await client.auth.signIn(email: 'user@example.com', password: 'password');

// Sign out
await client.auth.signOut();

// Get current user (null if not signed in)
final user = client.auth.currentUser;
```

### Auth State Listener

Use `onAuthStateChange` to reactively navigate between login and home screens. This fires on sign-in, sign-out, and token refresh:

```dart
client.auth.onAuthStateChange((event, user) {
  if (event == AuthEvent.signedIn) {
    // Navigate to home
  } else if (event == AuthEvent.signedOut) {
    // Navigate to login
  }
});
```

:::caution Dispose Listeners
If you set up auth state listeners in a `StatefulWidget`, **unsubscribe in `dispose()`** to avoid memory leaks and `setState()` calls on unmounted widgets:

```dart
late final Function() _unsubAuth;

@override
void initState() {
  super.initState();
  _unsubAuth = client.auth.onAuthStateChange((event, user) {
    setState(() { /* update UI */ });
  });
}

@override
void dispose() {
  _unsubAuth();
  super.dispose();
}
```
:::

## Database

The database API is the same across all SDKs. Use `client.db()` for client-side access (respects access rules):

```dart
// Create
final post = await client.db('app').table('posts').insert({
  'title': 'Hello from Flutter!',
  'content': 'My mobile post.',
});

// Query
final posts = await client.db('app').table('posts')
    .where('status', '==', 'published')
    .orderBy('createdAt', desc: true)
    .limit(20)
    .getList();

// Update
await client.db('app').table('posts').update(post['id'], {
  'title': 'Updated title',
});

// Delete
await client.db('app').table('posts').delete(post['id']);
```

## File Upload

Upload files with progress tracking — useful for showing a progress bar in the UI:

```dart
// Pick and upload an image
final picker = ImagePicker();
final image = await picker.pickImage(source: ImageSource.gallery);
final bytes = await image!.readAsBytes();

await client.storage.bucket('avatars').upload(
  '${client.auth.currentUser!.id}.jpg',
  bytes,
  contentType: 'image/jpeg',
  onProgress: (percent) => setState(() => _progress = percent),
);
```

## Subscriptions

### DB Subscriptions

Listen to table changes in real time. **Always unsubscribe in `dispose()`** to close the WebSocket listener:

```dart
class LivePostsWidget extends StatefulWidget {
  @override
  _LivePostsWidgetState createState() => _LivePostsWidgetState();
}

class _LivePostsWidgetState extends State<LivePostsWidget> {
  final List<Map<String, dynamic>> _posts = [];
  Function()? _unsub;

  @override
  void initState() {
    super.initState();
    _unsub = client.db('app').table('posts').onSnapshot((change) {
      setState(() {
        switch (change.changeType) {
          case 'added':
            _posts.add(change.data!);
            break;
          case 'modified':
            final idx = _posts.indexWhere((p) => p['id'] == change.docId);
            if (idx >= 0) _posts[idx] = change.data!;
            break;
          case 'removed':
            _posts.removeWhere((p) => p['id'] == change.docId);
            break;
        }
      });
    });
  }

  @override
  void dispose() {
    _unsub?.call();  // ← Always clean up!
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      itemCount: _posts.length,
      itemBuilder: (ctx, i) => ListTile(title: Text(_posts[i]['title'])),
    );
  }
}
```

### Room Members (Presence)

Track and display online users using Room members. Same pattern — subscribe in `initState`, clean up in `dispose`:

```dart
class OnlineUsersWidget extends StatefulWidget {
  @override
  _OnlineUsersWidgetState createState() => _OnlineUsersWidgetState();
}

class _OnlineUsersWidgetState extends State<OnlineUsersWidget> {
  List<Map<String, dynamic>> _users = [];
  late final room;

  @override
  void initState() {
    super.initState();
    room = client.room('presence', 'online-users');
    room.connect();
    room.members.setState({'name': 'Jane', 'status': 'active'});
    room.members.onJoin((member) {
      setState(() => _users = room.members.getAll());
    });
    room.members.onLeave((member) {
      setState(() => _users = room.members.getAll());
    });
  }

  @override
  void dispose() {
    room.leave();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Text('${_users.length} online');
  }
}
```

## Flutter Lifecycle Patterns

### The `dispose()` Rule

Every subscription or listener created in `initState()` **must** be cleaned up in `dispose()`. This applies to:

| Resource | Subscribe | Clean up |
|----------|-----------|----------|
| Auth state | `client.auth.onAuthStateChange(...)` | Call the returned `Function()` |
| DB snapshot | `client.db(...).table(...).onSnapshot(...)` | Call the returned `Function()` |
| Presence | `presence.track(...)` | `presence.untrack()` |

Forgetting to dispose will cause memory leaks and `setState() called after dispose()` errors.

### App Lifecycle

The SDK automatically handles:
- **Token refresh** when the app returns from background
- **WebSocket reconnection** with exponential backoff after network interruption
- **Secure token persistence** across app restarts via `flutter_secure_storage`

You don't need to manually manage reconnection or token storage.

## Offline Support

The Flutter SDK caches the auth token in secure storage (`flutter_secure_storage`). Token refresh happens automatically on app launch — users stay signed in across app restarts without re-entering credentials.

:::info Platform Notes
- **iOS**: Tokens are stored in Keychain (persists across app reinstalls unless Keychain is cleared)
- **Android**: Tokens are stored in EncryptedSharedPreferences (cleared on app uninstall)
:::
