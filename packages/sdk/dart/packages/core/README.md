<h1 align="center">edgebase_core</h1>

<p align="center">
  <b>Low-level Dart primitives for EdgeBase</b><br>
  HTTP client, query builder, storage, field ops, generated API bindings, and shared error types
</p>

<p align="center">
  <a href="https://pub.dev/packages/edgebase_core"><img src="https://img.shields.io/pub/v/edgebase_core?color=brightgreen" alt="pub.dev"></a>&nbsp;
  <a href="https://edgebase.fun/docs/database/client-sdk"><img src="https://img.shields.io/badge/docs-core_sdk-blue" alt="Docs"></a>&nbsp;
  <a href="https://github.com/edge-base/edgebase/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  Dart VM · Package authors · Custom integrations · SDK internals
</p>

<p align="center">
  <a href="https://edgebase.fun/docs/database/client-sdk"><b>Client SDK Docs</b></a> ·
  <a href="https://edgebase.fun/docs/database/admin-sdk"><b>Admin SDK Docs</b></a> ·
  <a href="https://edgebase.fun/docs/storage"><b>Storage Docs</b></a> ·
  <a href="https://edgebase.fun/docs/getting-started/quickstart"><b>Quickstart</b></a>
</p>

---

`edgebase_core` is the low-level Dart foundation for EdgeBase SDKs.

It powers packages like [`edgebase_flutter`](https://pub.dev/packages/edgebase_flutter) and [`edgebase_admin`](https://pub.dev/packages/edgebase_admin), and it is useful when you want:

- direct access to the low-level `HttpClient`
- generated API wrappers without the higher-level SDK layers
- table and document references for custom integrations
- storage primitives
- field operations like `increment()` and `deleteField()`
- shared EdgeBase error types

If you are building a normal Flutter app, start with [`edgebase_flutter`](https://pub.dev/packages/edgebase_flutter). If you need trusted Service Key access on the server, start with [`edgebase_admin`](https://pub.dev/packages/edgebase_admin).

## Documentation Map

- [Database Client SDK](https://edgebase.fun/docs/database/client-sdk)
  Higher-level query patterns built on top of this package
- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
  Trusted server-side usage patterns
- [Storage Docs](https://edgebase.fun/docs/storage)
  Bucket operations, URLs, signed URLs, and uploads
- [Quickstart](https://edgebase.fun/docs/getting-started/quickstart)
  Full project setup with EdgeBase

## For AI Coding Assistants

If you are using an AI coding assistant, check [`llms.txt`](https://github.com/edge-base/edgebase/blob/main/packages/sdk/dart/packages/core/llms.txt) before generating code.

It captures the low-level package boundary, canonical examples, and Dart-specific rules for `DbRef`, `TableRef`, batch operations, and storage signed URL semantics.

## Installation

```bash
dart pub add edgebase_core
```

## Why This Package Exists

Most apps should not start with `edgebase_core`.

This package exists so you can build on the same low-level pieces the higher-level SDKs use:

| Capability | Included |
| --- | --- |
| HTTP client | `HttpClient` |
| Generated API wrappers | `GeneratedDbApi` |
| Database references | `DbRef`, `TableRef`, `DocRef` |
| Storage | `StorageClient` |
| Field operations | `increment()`, `deleteField()` |
| Context handling | `ContextManager` |
| Error types | `EdgeBaseError`, `FieldError` |
| Token contracts | `TokenManager`, `TokenPair` |

## Quick Start

```dart
import 'package:edgebase_core/edgebase_core.dart';

final httpClient = HttpClient(
  baseUrl: 'https://your-project.edgebase.fun',
  contextManager: ContextManager(),
);

final api = GeneratedDbApi(httpClient);
final posts = DbRef(api, 'app').table('posts');

final result = await posts
    .where('published', '==', true)
    .limit(10)
    .getList();

print(result.items);
```

## Working With Tables

```dart
final posts = DbRef(api, 'app').table('posts');

final created = await posts.insert({
  'title': 'Hello EdgeBase',
  'published': true,
});

final updated = await posts.doc(created['id'] as String).update({
  'title': 'Updated title',
});

print(updated);
```

For instance databases, pass the instance id to `DbRef`:

```dart
final workspacePosts = DbRef(api, 'workspace', instanceId: 'ws-123')
    .table('posts');
```

## Storage

```dart
final storage = StorageClient(httpClient);

await storage.upload(
  'uploads',
  'hello.bin',
  [1, 2, 3, 4],
  contentType: 'application/octet-stream',
);

final url = storage.getUrl('uploads', 'hello.bin');
print(url);
```

Read more: [Storage Docs](https://edgebase.fun/docs/storage)

## Field Operations

Use the helper operations when you need atomic updates:

```dart
await posts.doc('post-123').update({
  'viewCount': increment(1),
  'legacyField': deleteField(),
});
```

## Error Handling

```dart
try {
  await posts.getOne('missing-id');
} on EdgeBaseError catch (error) {
  print(error.message);
  print(error.statusCode);
}
```

## Building On Top Of `edgebase_core`

`HttpClient` accepts:

- `baseUrl`
- `contextManager`
- optional `tokenManager`
- optional `serviceKey`

That makes it flexible enough for:

- custom SDK wrappers
- internal tooling
- server-side scripts
- partial integrations where you do not want the full Flutter or admin surface

## Choose The Right Dart Package

| Package | Use it for |
| --- | --- |
| `edgebase_flutter` | Flutter apps and client-side flows |
| `edgebase_admin` | Trusted server-side Dart code with Service Key access |
| `edgebase_core` | Low-level building blocks and custom integrations |
| `edgebase` | Umbrella package when you want a broader Dart entry point |

## License

MIT
