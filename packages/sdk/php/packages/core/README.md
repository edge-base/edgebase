<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase PHP Core SDK

Shared low-level PHP primitives for EdgeBase.

`edgebase/core` is the foundation used by `edgebase/admin`. It provides the HTTP client, database references, table query builder, storage helpers, field operations, error types, and the server-side room client.

Most application code should install `edgebase/admin` instead. Use this package directly when you are building custom wrappers, generated bindings, or internal integrations.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Documentation Map

Use this README for the fast overview, then jump into the docs when you need depth:

- [SDK Overview](https://edgebase.fun/docs/sdks)
  Install commands and the public SDK matrix
- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
  Table queries, filters, pagination, batch writes, and raw SQL
- [Storage](https://edgebase.fun/docs/storage/upload-download)
  Uploads, downloads, metadata, and signed URLs
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
  Cross-language examples that sit on top of this core package

## For AI Coding Assistants

This package includes an `llms.txt` file for AI-assisted development.

Use it when you want an agent or code assistant to:

- keep Service Key logic on the server
- use the actual PHP class and method names
- avoid copying JavaScript promise-based examples into PHP
- remember which surfaces are low-level helpers versus admin-only clients

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/php/packages/core/llms.txt)
- in your environment after install, inside the `EdgeBase\Core` package directory as `llms.txt`

## Installation

Planned public package name:

```bash
composer require edgebase/core
```

Current monorepo usage:

- reference the package through Composer path repositories, or
- publish split PHP package repos before treating `composer require edgebase/core` as a public Packagist install

## Quick Start

```php
<?php

use EdgeBase\Core\FieldOps;
use EdgeBase\Core\HttpClient;
use EdgeBase\Core\StorageClient;

$http = new HttpClient(
    'https://your-project.edgebase.fun',
    getenv('EDGEBASE_SERVICE_KEY') ?: ''
);

$storage = new StorageClient($http);
$bucket = $storage->bucket('avatars');
$bucket->upload('user-1.jpg', 'binary-data', 'image/jpeg');

$marker = FieldOps::increment(1);
```

## Included Surfaces

- `HttpClient`
- `DbRef`, `DocRef`, `TableRef`
- `StorageClient`, `StorageBucket`
- `FieldOps::increment()` and `FieldOps::deleteField()`
- `ListResult`, `UpsertResult`, `BatchResult`
- `EdgeBaseException`
- `RoomClient`

## Choose The Right Package

| Package | Use it for |
| --- | --- |
| `edgebase/core` | Low-level PHP primitives for custom wrappers and internal integrations |
| `edgebase/admin` | Trusted server-side code with Service Key access |

## License

MIT
