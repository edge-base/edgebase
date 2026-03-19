# EdgeBase PHP SDK

Server-side PHP SDK bundle for EdgeBase.

`edgebase/sdk` is the broad Composer entry point in this repository. It bundles the trusted admin surface and the lower-level core primitives under one install, while `edgebase/admin` and `edgebase/core` remain available as narrower package docs and package boundaries.

The intended public Composer package names are `edgebase/sdk`, `edgebase/admin`, and `edgebase/core`. In the current monorepo layout, these PHP packages still need a Packagist-compatible publish path such as split repositories or another Composer repository strategy before the install commands below work as public Packagist installs.

## Documentation Map

Use this README for the fast overview, then jump into the package-specific docs when you need depth:

- [SDK Overview](https://edgebase.fun/docs/sdks)
  Install commands and the public SDK matrix
- [Admin SDK](https://edgebase.fun/docs/sdks/client-vs-server)
  Trusted-server concepts and admin-only capabilities
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
  Cross-language examples for auth, database, storage, functions, push, and analytics
- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
  Table queries, filters, pagination, batch writes, and raw SQL
- [Storage](https://edgebase.fun/docs/storage/upload-download)
  Uploads, downloads, metadata, and signed URLs
- [Native Resources](https://edgebase.fun/docs/server/native-resources)
  KV, D1, Vectorize, and other trusted edge-native resources

## For AI Coding Assistants

This package includes an `llms.txt` file for AI-assisted development.

Use it when you want an assistant to:

- stay inside the PHP server-side boundary
- choose between the bundled `edgebase/sdk` install and narrower `edgebase/admin` or `edgebase/core` docs
- use PHP property and method names instead of copying JavaScript examples literally
- keep Service Keys on trusted servers only

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/php/llms.txt)
- in the installed package contents next to the README

## Installation

Planned public package name:

```bash
composer require edgebase/sdk
```

Current monorepo usage:

- use Composer path repositories in local development, or
- publish split PHP package repos before treating `composer require edgebase/sdk` as a public Packagist install

If you only want the narrower trusted package docs, see `edgebase/admin`. For low-level primitives, see `edgebase/core`.

## Quick Start

```php
<?php

use EdgeBase\Admin\AdminClient;

$admin = new AdminClient(
    'https://your-project.edgebase.fun',
    getenv('EDGEBASE_SERVICE_KEY') ?: ''
);

$users = $admin->adminAuth->listUsers(limit: 20);
$rows = $admin->sql('shared', null, 'SELECT 1 AS ok');

print_r($users);
print_r($rows);
```

## Package Map

| Package | Use it for |
| --- | --- |
| `edgebase/sdk` | Broad Composer install that bundles PHP SDK surfaces |
| `edgebase/admin` | Trusted server-side PHP code with Service Key access |
| `edgebase/core` | Lower-level HTTP, database, storage, and room primitives |

## Development

Run tests from the package root:

```bash
composer test
```

For E2E:

```bash
BASE_URL=http://localhost:8688 EDGEBASE_SERVICE_KEY=sk_test composer test
```

## License

MIT
