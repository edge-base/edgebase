<!-- Generated from packages/sdk/dart/packages/flutter/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase Flutter SDK

Use this file as a quick-reference contract for AI coding assistants working with `edgebase_flutter`.

## Package Boundary

Use `edgebase_flutter` for Flutter client applications.

This package is for untrusted client code running in Flutter apps. Do not use it for Service Key operations, privileged admin access, raw SQL, or backend-only workflows. Use `edgebase_admin` for trusted server-side access. Use `edgebase_core` only when you intentionally want low-level primitives.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/dart/packages/flutter/README.md
- Quickstart: https://edgebase.fun/docs/getting-started/quickstart
- Flutter SDK docs: https://edgebase.fun/docs/sdks/flutter
- Authentication: https://edgebase.fun/docs/authentication
- OAuth callback handling: https://edgebase.fun/docs/authentication/oauth-callback
- Database client SDK: https://edgebase.fun/docs/database/client-sdk
- Database subscriptions: https://edgebase.fun/docs/database/subscriptions
- Room client SDK: https://edgebase.fun/docs/room/client-sdk
- Functions client SDK: https://edgebase.fun/docs/functions/client-sdk
- Push client SDK: https://edgebase.fun/docs/push/client-sdk
- Storage docs: https://edgebase.fun/docs/storage

If docs, examples, and assumptions disagree, prefer the current package API and official docs over guessed patterns.

## Recommended Project Layout

If you are adding EdgeBase to an existing Flutter app, a good default is:

```text
your_flutter_app/
  pubspec.yaml
  lib/
  android/
  ios/
  edgebase/
    edgebase.config.ts
    functions/
    package.json
```

Typical setup:

```bash
cd your_flutter_app
npm create edgebase@latest edgebase
```

This is a recommendation, not a requirement. A separate repo or a different subdirectory name is also valid.

## Canonical Examples

### Create a client

```dart
import 'package:edgebase_flutter/edgebase_flutter.dart';

final client = ClientEdgeBase('https://your-project.edgebase.fun');
```

### Sign in and react to auth changes

```dart
await client.auth.signIn(
  SignInOptions(
    email: 'june@example.com',
    password: 'pass1234',
  ),
);

final user = client.auth.currentUser;

final sub = client.auth.onAuthStateChange.listen((nextUser) {
  print(nextUser?.id);
});
```

### Start OAuth

```dart
final redirectUrl = client.auth.signInWithOAuth(
  'google',
  redirectUrl: 'myapp://auth/callback',
);

// Open redirectUrl with url_launcher or your platform navigation layer.
```

### Query a single-instance block

```dart
final posts = await client
    .db('app')
    .table('posts')
    .where('published', '==', true)
    .orderBy('createdAt', direction: 'desc')
    .limit(20)
    .getList();
```

### Query an instance database

```dart
final docs = await client
    .db('workspace', instanceId: 'ws-1')
    .table('documents')
    .getList();
```

### Subscribe to live updates

```dart
final stream = client.db('app').table('posts').onSnapshot();

final sub = stream.listen((change) {
  print(change.changeType);
  print(change.data);
});
```

### Upload a file and create a signed URL

```dart
await client.storage.upload(
  'avatars',
  'me.jpg',
  [1, 2, 3, 4],
  contentType: 'image/jpeg',
);

final signed = await client
    .storage
    .bucket('avatars')
    .createSignedUrl('me.jpg', expiresIn: 3600);
```

### Call a function

```dart
final result = await client.functions.post('contact/send', {
  'email': 'june@example.com',
  'message': 'Hello from Flutter',
});
```

### Join a room

```dart
final room = client.room('game', 'lobby-1');

await room.join();

final syncSub = room.members.onSync((members) {
  print(members.length);
});

await room.members.setState({'status': 'active'});
await room.signals.send('wave', {'emoji': 'hi'});

room.leave();
```

### Register push notifications

```dart
await client.push.register(metadata: {
  'segment': 'beta-testers',
});
```

## Hard Rules

- `client.db(namespace, instanceId: ...)` uses a named `instanceId` parameter in Dart, not a positional second argument
- `client.auth.onAuthStateChange` is a `Stream<TokenUser?>`, not a callback registration function
- `client.auth.currentUser` is a property, not a method
- `client.auth.signInWithOAuth(...)` returns a redirect URL string immediately, not an object like `{ url }` and not a `Future`
- there is no `handleOAuthCallback()` method in this package
- `client.functions.get/post/put/patch/delete` return `Future<dynamic>`
- `room.join()` is async, but `room.leave()` is synchronous
- `room.members.onSync(...)`, `room.members.onJoin(...)`, `room.members.onLeave(...)`, `room.signals.on(...)`, and `room.signals.onAny(...)` return `RoomSubscription`
- `room.signals.send(...)` and `room.members.setState(...)` return `Future<void>`
- `table.getOne(id)` or `table.doc(id).get()` returns a single document
- storage signed URLs use `expiresIn` as an integer number of seconds like `3600`, not a JS string like `'1h'`
- `client.push.register()` auto-uses `FirebaseMessaging`; a custom token provider is only for headless or custom-platform integrations

## Common Mistakes

- do not use JS or React Native signatures like `db('workspace', 'ws-1')`; in Dart use `db('workspace', instanceId: 'ws-1')`
- do not call `client.auth.onAuthStateChange((user) {})`; use `.listen(...)` on the stream
- do not assume `signInWithOAuth()` completes the full OAuth flow; it only returns the URL to open
- do not assume browser-only APIs like `localStorage`, `window.location`, or DOM-based widgets
- do not treat `get()` as a single-record fetch
- do not use `'1h'` for `createSignedUrl(..., expiresIn: ...)`; Dart storage APIs expect integer seconds
- do not call `client.push.register()` before Firebase is configured for the target app
- do not assume block names like `app`, `shared`, or `workspace` are reserved keywords; they are examples
- write operations require an authenticated user
- `requestPasswordReset()` takes the email as the first positional argument
- `changePassword()` expects `currentPassword`, not `oldPassword`

## Quick Reference

```text
ClientEdgeBase(url, { options? })                               -> ClientEdgeBase
EdgeBase.client(url, { options? })                              -> ClientEdgeBase
client.auth.currentUser                                         -> TokenUser | null
client.auth.onAuthStateChange                                   -> Stream<TokenUser?>
client.auth.signUp(SignUpOptions(...))                          -> Future<AuthResult>
client.auth.signIn(SignInOptions(...))                          -> Future<SignInResult>
client.auth.signInWithOAuth(provider, {redirectUrl?, captchaToken?}) -> String
client.auth.signInWithMagicLink({ email, captchaToken? })       -> Future<void>
client.auth.verifyMagicLink(token)                              -> Future<AuthResult>
client.auth.signInWithPhone({ phone, captchaToken? })           -> Future<void>
client.auth.verifyPhone({ phone, code })                        -> Future<AuthResult>
client.auth.requestPasswordReset(email, { captchaToken? })      -> Future<void>
client.auth.changePassword({ currentPassword, newPassword })    -> Future<AuthResult>
client.db(namespace, { instanceId? })                           -> DbRef
client.room(namespace, roomId)                                  -> RoomClient
client.storage.bucket(name)                                     -> StorageBucket
client.storage.upload(bucketName, key, data, ...)               -> Future<FileInfo>
client.analytics.track(name, [properties])                      -> Future<void>
client.functions.post(path, [body])                             -> Future<dynamic>
client.push.register({ metadata? })                             -> Future<void>
client.destroy()                                                -> void
```
