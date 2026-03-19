# EdgeBase PHP Admin SDK

Trusted server-side PHP SDK for EdgeBase.

Use `edgebase/admin` from backend APIs, jobs, workers, and other trusted PHP runtimes that hold a Service Key. It exposes admin auth, database access, raw SQL, storage, push, analytics, functions, and native edge resources.

If you are working inside this repository, `AdminEdgeBase` exists as a backwards-compatible alias for `AdminClient`. Prefer `AdminClient` in new code.

## Documentation Map

Use this README for a fast overview, then jump into the docs when you need depth:

- [SDK Overview](https://edgebase.fun/docs/sdks)
  Install commands and the public SDK matrix
- [Admin SDK](https://edgebase.fun/docs/sdks/client-vs-server)
  Trusted-server boundaries and admin-only capabilities
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
  Cross-language examples for auth, database, storage, functions, push, and analytics
- [Admin User Management](https://edgebase.fun/docs/authentication/admin-users)
  Create, update, delete, and manage users with a Service Key
- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
  Table queries, filters, pagination, batch writes, and raw SQL
- [Storage](https://edgebase.fun/docs/storage/upload-download)
  Uploads, downloads, metadata, and signed URLs
- [Analytics Admin SDK](https://edgebase.fun/docs/analytics/admin-sdk)
  Request metrics, event tracking, and event queries
- [Push Admin SDK](https://edgebase.fun/docs/push/admin-sdk)
  Push send, topic broadcast, token inspection, and logs
- [Native Resources](https://edgebase.fun/docs/server/native-resources)
  KV, D1, Vectorize, and other trusted edge-native resources

## For AI Coding Assistants

This package includes an `llms.txt` file for AI-assisted development.

Use it when you want an agent or code assistant to:

- keep Service Keys on trusted servers
- use the actual PHP property and method names
- avoid copying JavaScript promise-based examples into PHP
- know when to use `adminAuth` and `storage` properties versus `push()`, `functions()`, and `analytics()` methods

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/php/packages/admin/llms.txt)
- in your environment after install, inside the `EdgeBase\Admin` package directory as `llms.txt`

## Installation

Planned public package name:

```bash
composer require edgebase/admin
```

Current monorepo usage:

- consume the package through Composer path repositories, or
- publish split PHP package repos before treating `composer require edgebase/admin` as a public Packagist install

## Quick Start

```php
<?php

use EdgeBase\Admin\AdminClient;

$admin = new AdminClient(
    'https://your-project.edgebase.fun',
    getenv('EDGEBASE_SERVICE_KEY') ?: ''
);

$users = $admin->adminAuth->listUsers(limit: 20);

$postRows = $admin->sql(
    'shared',
    null,
    'SELECT id, title FROM posts WHERE status = ?',
    ['published']
);

$bucket = $admin->storage->bucket('avatars');
$bucket->upload('user-1.jpg', 'binary-data', contentType: 'image/jpeg');

$admin->push()->send('user-1', [
    'title' => 'Deployment finished',
    'body' => 'Your content is live.',
]);
```

## Core API

- `$admin->adminAuth`
  Admin user management client
- `$admin->storage`
  Storage client
- `$admin->db(namespace, instanceId = null)`
  Service-key database access
- `$admin->sql(namespace, id, query, params = [])`
  Raw SQL execution
- `$admin->broadcast(channel, event, payload = [])`
  Server-side database-live broadcast
- `$admin->push()`
  Push notifications
- `$admin->functions()`
  Call app functions from trusted code
- `$admin->analytics()`
  Query analytics and track server-side events
- `$admin->kv(namespace)`, `$admin->d1(database)`, `$admin->vector(index)`
  Native edge resources
- `$admin->destroy()`
  No-op cleanup hook

## Database Access

```php
$posts = $admin->db('app')->table('posts');
$rows = $posts->where('status', '==', 'published')->get();
```

For instance databases, pass the instance ID positionally:

```php
$admin->db('workspace', 'ws-123');
$admin->db('user', 'user-123');
```

## Admin Users

```php
$created = $admin->adminAuth->createUser([
    'email' => 'admin@example.com',
    'password' => 'secure-pass-123',
    'displayName' => 'June',
]);

$admin->adminAuth->setCustomClaims($created['id'], [
    'role' => 'moderator',
]);

$users = $admin->adminAuth->listUsers(limit: 20);
```

## Raw SQL

`sql()` always takes an explicit namespace and optional instance ID:

```php
$sharedRows = $admin->sql('shared', null, 'SELECT 1 AS ok');

$workspaceRows = $admin->sql(
    'workspace',
    'ws-123',
    'SELECT * FROM documents WHERE status = ?',
    ['published']
);
```

## Push And Analytics

```php
$admin->push()->send('user-123', [
    'title' => 'Hello',
    'body' => 'From the admin SDK',
]);

$overview = $admin->analytics()->overview(['range' => '7d']);
```

## Choose The Right Package

| Package | Use it for |
| --- | --- |
| `edgebase/admin` | Trusted server-side PHP code with Service Key access |
| `edgebase/core` | Lower-level primitives for custom integrations |

## License

MIT
