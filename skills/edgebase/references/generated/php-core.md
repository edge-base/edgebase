<!-- Generated from packages/sdk/php/packages/core/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase PHP Core SDK

Use this file as a quick-reference contract for AI coding assistants working with `edgebase/core`.

## Package Boundary

Use `edgebase/core` for low-level EdgeBase building blocks.

This package is shared infrastructure for `edgebase/admin`. Most app code should install `edgebase/admin` instead of using `edgebase/core` directly.

`edgebase/core` is the intended public Composer package name, but the current monorepo still needs a Packagist-compatible publish path before that install works from Packagist.

`edgebase/core` does not provide admin auth, push, analytics, KV, D1, or Vectorize helpers.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/php/packages/core/README.md
- SDK Overview: https://edgebase.fun/docs/sdks
- Database Admin SDK: https://edgebase.fun/docs/database/admin-sdk
- Storage docs: https://edgebase.fun/docs/storage/upload-download

If docs, snippets, and assumptions disagree, prefer the current package API over guessed patterns from another runtime.

## Canonical Examples

### Build an HTTP client

```php
use EdgeBase\Core\HttpClient;

$http = new HttpClient(
    'https://your-project.edgebase.fun',
    getenv('EDGEBASE_SERVICE_KEY') ?: ''
);
```

### Work with storage

```php
use EdgeBase\Core\StorageClient;

$storage = new StorageClient($http);
$bucket = $storage->bucket('avatars');
$bucket->upload('user-1.jpg', 'binary-data', 'image/jpeg');
```

### Use field operations

```php
use EdgeBase\Core\FieldOps;

$payload = [
    'views' => FieldOps::increment(1),
    'legacyField' => FieldOps::deleteField(),
];
```

## Hard Rules

- keep Service Keys on trusted servers only
- `HttpClient` is synchronous and server-side only
- `FieldOps::increment()` and `FieldOps::deleteField()` return marker arrays for update payloads
- `DbRef::table()` returns a `TableRef`
- `TableRef::getList()`, `getOne()`, and `getFirst()` are the main read helpers
- `StorageClient::bucket()` returns a `StorageBucket`
- `StorageBucket::createSignedUploadUrl($path, $expiresIn = 3600)` expects an integer TTL in seconds
- `StorageBucket::uploadString()` accepts raw, base64, base64url, and data URL inputs

## Common Mistakes

- do not use `edgebase/core` when you actually need admin auth or other higher-level server features
- do not copy JavaScript promise-based examples into PHP
- do not assume `TableRef` or `DbRef` are top-level app entry points; they are building blocks
- do not expose the Service Key through browser code

## Quick Reference

```text
new HttpClient(url, serviceKey = "")              -> HttpClient
new StorageClient(http)                           -> StorageClient
$storage->bucket(name)                            -> StorageBucket
FieldOps::increment(value = 1)                    -> array
FieldOps::deleteField()                           -> array
$db->table(name)                                  -> TableRef
$table->where(field, op, value)                   -> TableRef
$table->getList()                                 -> ListResult
$table->getOne(id)                                -> array
$table->getFirst()                                -> ?array
$table->doc(id)                                   -> DocRef
$bucket->upload(path, data, contentType = ...)    -> array
$bucket->download(path)                           -> string
$bucket->createSignedUrl(path, expiresIn = '1h')  -> array
$bucket->createSignedUploadUrl(path, expiresIn)   -> array
```
