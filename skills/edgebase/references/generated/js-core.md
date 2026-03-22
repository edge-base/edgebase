<!-- Generated from packages/sdk/js/packages/core/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase JS Core SDK

Use this file as a quick-reference contract for AI coding assistants working with `@edge-base/core`.

## Package Boundary

Use `@edge-base/core` for low-level EdgeBase primitives.

This package is shared infrastructure for higher-level SDKs. Application code usually should not start here unless it is building a custom wrapper, runtime adapter, or internal integration layer.

Prefer:

- `@edge-base/web` for browser apps
- `@edge-base/react-native` for React Native apps
- `@edge-base/admin` for trusted server-side work

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/js/packages/core/README.md
- SDK overview: https://edgebase.fun/docs/sdks
- Client SDK docs: https://edgebase.fun/docs/database/client-sdk
- Admin SDK reference: https://edgebase.fun/docs/admin-sdk/reference
- Storage docs: https://edgebase.fun/docs/storage/upload-download

## Canonical Examples

### Create a low-level HTTP client

```ts
import { ContextManager, HttpClient } from '@edge-base/core';

const http = new HttpClient({
  baseUrl: 'https://your-project.edgebase.fun',
  contextManager: new ContextManager(),
});
```

### Query data through DbRef and TableRef

```ts
import { ContextManager, DbRef, HttpClient } from '@edge-base/core';

const http = new HttpClient({
  baseUrl: 'https://your-project.edgebase.fun',
  contextManager: new ContextManager(),
});

const db = new DbRef('app', undefined, http);
const rows = await db
  .table('posts')
  .where('published', '==', true)
  .limit(20)
  .getList();
```

### Use storage directly

```ts
import { ContextManager, HttpClient, StorageClient } from '@edge-base/core';

const http = new HttpClient({
  baseUrl: 'https://your-project.edgebase.fun',
  contextManager: new ContextManager(),
});

const storage = new StorageClient(http);
const bucket = storage.bucket('avatars');
const url = bucket.getUrl('me.jpg');
```

### Call a function

```ts
import { ContextManager, FunctionsClient, HttpClient } from '@edge-base/core';

const http = new HttpClient({
  baseUrl: 'https://your-project.edgebase.fun',
  contextManager: new ContextManager(),
});

const functions = new FunctionsClient(http);
const result = await functions.get('health');
```

### Use special field operations

```ts
import { deleteField, increment } from '@edge-base/core';

const patch = {
  views: increment(1),
  temp: deleteField(),
};
```

## Hard Rules

- do not assume `@edge-base/core` exposes `createClient()` or `createAdminClient()`
- use `HttpClient` plus `DbRef` or `TableRef` when working directly at the low level
- `DbRef` takes `(namespace, instanceId, httpClient)` with positional instance id
- `TableRef.getList()` returns list results, not a single document
- use `DocRef` or `getOne(id)` for single-record access
- `StorageClient` is a shared primitive, not a browser-specific wrapper
- keep Service Keys out of client-side apps even though `HttpClient` technically accepts `serviceKey`

## Common Mistakes

- do not import browser-only auth helpers from this package
- do not import admin-only SQL helpers from this package
- do not guess method names from `@edge-base/web` or `@edge-base/admin` when the low-level primitive already exists
- do not assume `ContextManager` is optional when constructing `HttpClient`
- do not pass named objects for database instance selection when the API expects positional args

## Quick Reference

```text
new HttpClient({ baseUrl, contextManager, tokenManager?, serviceKey? }) -> HttpClient
new DbRef(namespace, instanceId, httpClient)                            -> DbRef
db.table(name)                                                          -> TableRef
table.getList()                                                          -> Promise<ListResult<T>>
table.getOne(id) / table.doc(id).get()                                  -> Promise<T>
new StorageClient(httpClient)                                           -> StorageClient
storage.bucket(name)                                                    -> StorageBucket
new FunctionsClient(httpClient)                                         -> FunctionsClient
increment(amount)                                                       -> field-op marker
deleteField()                                                           -> field-op marker
```
