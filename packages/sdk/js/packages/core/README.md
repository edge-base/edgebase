<h1 align="center">@edge-base/core</h1>

<p align="center">
  <b>Shared building blocks for EdgeBase SDKs</b><br>
  HTTP transport, query builders, storage helpers, field ops, functions, errors, and generated API layers
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@edge-base/core"><img src="https://img.shields.io/npm/v/%40edge-base%2Fcore?color=brightgreen" alt="npm"></a>&nbsp;
  <a href="https://edgebase.fun/docs/sdks"><img src="https://img.shields.io/badge/docs-sdks-blue" alt="Docs"></a>&nbsp;
  <a href="https://github.com/edge-base/edgebase/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  Library authors · wrappers · internal tooling · custom runtimes
</p>

---

`@edge-base/core` is the low-level foundation used by the public EdgeBase SDKs.

Use it when you are:

- building a custom runtime wrapper on top of EdgeBase
- reusing the query builder, storage layer, or HTTP transport in internal tooling
- implementing environment-specific SDK surfaces that should not depend on the browser or admin entry points

If you are building an application, you usually want a higher-level package instead:

- [`@edge-base/web`](https://www.npmjs.com/package/@edge-base/web) for browser apps
- [`@edge-base/admin`](https://www.npmjs.com/package/@edge-base/admin) for trusted server-side code
- [`@edge-base/react-native`](https://www.npmjs.com/package/@edge-base/react-native) for React Native apps

## Documentation Map

Use this README for the package boundary and shared primitives, then jump into the runtime docs:

- [SDK Overview](https://edgebase.fun/docs/sdks)
  Public package matrix and install entry points
- [Client SDK](https://edgebase.fun/docs/database/client-sdk)
  Higher-level browser query patterns built on these primitives
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
  Trusted-server APIs that reuse the same transport and storage layers
- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
  Query, pagination, batch writes, and raw SQL context
- [Storage](https://edgebase.fun/docs/storage/upload-download)
  Upload, download, metadata, and signed URL flows

## For AI Coding Assistants

This package ships with an `llms.txt` file for AI-assisted development.

Use it when you want an agent or code assistant to:

- stay on the low-level `@edge-base/core` surface instead of assuming browser or admin entry points
- use the real `HttpClient`, `DbRef`, `TableRef`, and `StorageClient` APIs
- keep custom wrappers aligned with the generated EdgeBase transports

You can find it:

- in this package after install: `node_modules/@edge-base/core/llms.txt`
- in the repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/js/packages/core/llms.txt)

## Installation

```bash
npm install @edge-base/core
```

## Quick Start

```ts
import {
  ContextManager,
  DbRef,
  FunctionsClient,
  HttpClient,
  StorageClient,
} from '@edge-base/core';

const contextManager = new ContextManager();
const http = new HttpClient({
  baseUrl: 'https://your-project.edgebase.fun',
  contextManager,
});

const db = new DbRef('app', undefined, http);
const posts = await db.table('posts').limit(10).getList();

const storage = new StorageClient(http);
const bucket = storage.bucket('avatars');
const url = bucket.getUrl('user-1.jpg');

const functions = new FunctionsClient(http);
const health = await functions.get('health');

console.log(posts.items, url, health);
```

## Core API

These are the main primitives exported by `@edge-base/core`:

- `HttpClient`
  Shared authenticated transport with token refresh and service-key support
- `DbRef`, `TableRef`, `DocRef`
  Low-level database query builders and CRUD surfaces
- `StorageClient`, `StorageBucket`
  Shared storage bucket primitives
- `FunctionsClient`
  Function invocation helper
- `increment`, `deleteField`
  Field operation helpers
- `ContextManager`
  Shared request/user context container
- `EdgeBaseError`
  Common SDK error type

## Choose The Right Package

| Package | Use it for |
| --- | --- |
| `@edge-base/core` | Custom wrappers, low-level integrations, shared SDK primitives |
| `@edge-base/web` | Browser and untrusted client apps |
| `@edge-base/react-native` | React Native apps |
| `@edge-base/admin` | Trusted server-side code with admin access |

## License

MIT
