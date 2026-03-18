<h1 align="center">@edge-base/admin</h1>

<p align="center">
  <b>Trusted server-side SDK for EdgeBase</b><br>
  Database admin, user management, SQL, analytics, push, storage, and function calls from secure environments
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@edge-base/admin"><img src="https://img.shields.io/npm/v/%40edge-base%2Fadmin?color=brightgreen" alt="npm"></a>&nbsp;
  <a href="https://edgebase.fun/docs/database/admin-sdk"><img src="https://img.shields.io/badge/docs-admin_sdk-blue" alt="Docs"></a>&nbsp;
  <a href="https://github.com/edge-base/edgebase/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  Node.js · Edge runtimes · Server actions · Background jobs · Trusted workers
</p>

<p align="center">
  <a href="https://edgebase.fun/docs/database/admin-sdk"><b>Database Admin SDK</b></a> ·
  <a href="https://edgebase.fun/docs/authentication/admin-users"><b>Admin Users</b></a> ·
  <a href="https://edgebase.fun/docs/push/admin-sdk"><b>Push Admin SDK</b></a> ·
  <a href="https://edgebase.fun/docs/analytics/admin-sdk"><b>Analytics Admin SDK</b></a>
</p>

---

`@edge-base/admin` is the trusted server-side SDK for EdgeBase.

Use it when you need:

- Service Key authenticated access
- server-side database operations that bypass access rules
- admin user management
- raw SQL
- push and analytics from secure environments
- server-to-server function calls

If code runs in a browser, use [`@edge-base/web`](https://www.npmjs.com/package/@edge-base/web) instead. If code runs on the server but should act as the current signed-in user through cookies, use [`@edge-base/ssr`](https://www.npmjs.com/package/@edge-base/ssr).

> Beta: the package is already usable, but some APIs may still evolve before general availability.

## Documentation Map

- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
  Server-side database access with a Service Key
- [Admin Users](https://edgebase.fun/docs/authentication/admin-users)
  Create, update, list, revoke, and manage users
- [Push Admin SDK](https://edgebase.fun/docs/push/admin-sdk)
  Send push notifications from secure environments
- [Analytics Admin SDK](https://edgebase.fun/docs/analytics/admin-sdk)
  Query request analytics and track server-side events
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
  Public admin SDK surface by category

## For AI Coding Assistants

This package ships with an `llms.txt` file for AI-assisted server SDK usage.

You can find it:

- after install: `node_modules/@edge-base/admin/llms.txt`
- in the repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/js/packages/admin/llms.txt)

Use it when you want an agent to:

- keep Service Key logic on the server
- choose between `web`, `ssr`, and `admin`
- use the correct `db(namespace, id?)` and `sql(...)` signatures
- avoid shipping privileged SDK code to the browser

## Installation

```bash
npm install @edge-base/admin
```

## Quick Start

```ts
import { createAdminClient } from '@edge-base/admin';

const admin = createAdminClient(process.env.EDGEBASE_URL!, {
  serviceKey: process.env.EDGEBASE_SERVICE_KEY,
});

const { items: posts } = await admin
  .db('app')
  .table('posts')
  .orderBy('createdAt', 'desc')
  .limit(20)
  .getList();

console.log(posts);
```

Inside EdgeBase App Functions, you can also rely on environment detection:

```ts
import { createAdminClient } from '@edge-base/admin';

const admin = createAdminClient();
```

## Core API

Once you create an admin client, these are the main surfaces you will use:

- `admin.db(namespace, id?)`
  Server-side database access
- `admin.auth`
  Admin user management
- `admin.sql(...)`
  Raw SQL execution
- `admin.storage`
  Server-side storage access
- `admin.functions`
  Call app functions from trusted code
- `admin.push`
  Send push notifications
- `admin.analytics`
  Query analytics and track server-side events
- `admin.kv(namespace)`, `admin.d1(database)`, `admin.vector(index)`
  Access platform resources from trusted code

## Database Access

```ts
type Post = {
  id: string;
  title: string;
  status: 'draft' | 'published';
};

const posts = admin.db('app').table<Post>('posts');

const result = await posts
  .where('status', '==', 'published')
  .orderBy('title', 'asc')
  .limit(50)
  .getList();
```

For instance databases, pass the instance id positionally:

```ts
admin.db('workspace', 'ws-123');
admin.db('user', 'user-123');
```

Read more: [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)

## Admin Auth

```ts
const created = await admin.auth.createUser({
  email: 'june@example.com',
  password: 'secure-pass-123',
  displayName: 'June',
});

await admin.auth.setCustomClaims(created.id, {
  role: 'moderator',
});

const users = await admin.auth.listUsers({ limit: 20 });
console.log(users.users);
```

Read more: [Admin Users](https://edgebase.fun/docs/authentication/admin-users)

## Raw SQL

`sql()` supports two forms:

```ts
const health = await admin.sql('select 1 as ok');

const docs = await admin.sql(
  'workspace',
  'ws-123',
  'select * from documents where status = ?',
  ['published'],
);
```

## Push And Analytics

```ts
await admin.push.send('user-123', {
  title: 'Deployment finished',
  body: 'Your content is live.',
});

const overview = await admin.analytics.overview({ range: '7d' });
console.log(overview.summary.totalRequests);
```

Read more:

- [Push Admin SDK](https://edgebase.fun/docs/push/admin-sdk)
- [Analytics Admin SDK](https://edgebase.fun/docs/analytics/admin-sdk)

## Choose The Right Package

| Package | Use it for |
| --- | --- |
| `@edge-base/web` | Browser and untrusted client code |
| `@edge-base/ssr` | Server-side code acting as the current cookie-authenticated user |
| `@edge-base/admin` | Trusted server-side code with Service Key access |

## License

MIT
