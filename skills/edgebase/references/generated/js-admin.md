<!-- Generated from packages/sdk/js/packages/admin/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase JS Admin SDK

Use this file as a quick-reference contract for AI coding assistants working with `@edge-base/admin`.

## Package Boundary

Use `@edge-base/admin` in trusted server-side environments only.

Do not ship this package to browsers or untrusted clients. If code runs in the browser, use `@edge-base/web`. If code runs on the server but should act as the current cookie-authenticated user, use `@edge-base/ssr`.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/js/packages/admin/README.md
- Database Admin SDK: https://edgebase.fun/docs/database/admin-sdk
- Admin users: https://edgebase.fun/docs/authentication/admin-users
- Push Admin SDK: https://edgebase.fun/docs/push/admin-sdk
- Analytics Admin SDK: https://edgebase.fun/docs/analytics/admin-sdk
- Admin SDK reference: https://edgebase.fun/docs/admin-sdk/reference

## Canonical Examples

### Create an admin client

```ts
import { createAdminClient } from '@edge-base/admin';

const admin = createAdminClient(process.env.EDGEBASE_URL!, {
  serviceKey: process.env.EDGEBASE_SERVICE_KEY,
});
```

### Query a table

```ts
const posts = await admin
  .db('app')
  .table('posts')
  .where('status', '==', 'published')
  .getList();
```

### Query an instance database

```ts
const docs = await admin
  .db('workspace', 'ws-1')
  .table('documents')
  .getList();
```

### Manage users

```ts
const created = await admin.auth.createUser({
  email: 'june@example.com',
  password: 'pass1234',
  displayName: 'June',
});

await admin.auth.setCustomClaims(created.id, { role: 'moderator' });
```

### Execute SQL

```ts
const sharedRows = await admin.sql('select 1 as ok');

const rows = await admin.sql(
  'workspace',
  'ws-1',
  'select * from documents where status = ?',
  ['published'],
);
```

### Send push and query analytics

```ts
await admin.push.send('user-123', {
  title: 'Hello',
  body: 'From the admin SDK',
});

const overview = await admin.analytics.overview({ range: '7d' });
```

## Hard Rules

- keep Service Keys on trusted servers only
- `createAdminClient(url?, options?)` falls back to `EDGEBASE_URL` and `EDGEBASE_SERVICE_KEY` when omitted
- `admin.db(namespace, id?)` takes the instance id positionally
- `admin.sql()` has two supported forms:
  - `admin.sql(query)`
  - `admin.sql(namespace, id, query, params?)`
- `admin.auth` methods require a Service Key
- `admin.broadcast(channel, event, payload?)` is server-side broadcast
- `admin.kv(namespace)`, `admin.d1(database)`, and `admin.vector(index)` expose trusted infra clients

## Common Mistakes

- do not use `@edge-base/admin` in client-side React or browser bundles
- do not use `@edge-base/admin` when you want access rules to run as the current signed-in user; use `@edge-base/ssr` instead
- do not pass instance ids as named objects; use `db(namespace, id?)`
- `createAdminClient()` without explicit args is mainly for server environments where `EDGEBASE_URL` and `EDGEBASE_SERVICE_KEY` are already available
- `admin.sql(query)` defaults to the shared single-instance database block

## Quick Reference

```text
createAdminClient(url?, { serviceKey?, schema? }) -> AdminEdgeBase
admin.db(namespace, id?)                           -> DbRef
admin.sql(query)                                   -> Promise<unknown[]>
admin.sql(namespace, id, query, params?)           -> Promise<unknown[]>
admin.auth.listUsers({ limit?, cursor? })          -> Promise<{ users, cursor? }>
admin.auth.createUser(data)                        -> Promise<UserRecord>
admin.push.send(userId, payload)                   -> Promise<{ sent, failed, removed }>
admin.analytics.overview({ range? })               -> Promise<AnalyticsOverview>
```
