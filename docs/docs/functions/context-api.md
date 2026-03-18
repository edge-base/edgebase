---
sidebar_position: 4
---

# Context API

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Every App Function receives a `context` object that provides access to all EdgeBase services: database, authentication, storage, database subscriptions, and more.

## Which API Should I Use?

| I want to... | API | Section |
|---|---|---|
| Read/write table records (CRUD) | `admin.db(namespace).table(name)` | [admin.db()](#contextadmindbnamespace-id) |
| Run raw SQL (JOINs, aggregations, CTEs) | `admin.sql(namespace, id, query, params)` | [admin.sql()](#contextadminsqlnamespace-id-sql-params) |
| Send a message to WebSocket clients | `admin.broadcast(channel, event, data)` | [admin.broadcast()](#contextadminbroadcastchannel-event-data) |
| Manage users (create, delete, set claims) | `admin.auth` | [admin.auth](#contextadminauth) |
| Cache data with KV | `admin.kv(namespace)` | [admin.kv()](#contextadminkvnamespace) |
| Run relational SQL on D1 | `admin.d1(database)` | [admin.d1()](#contextadmind1database) |
| Search by vector similarity | `admin.vector(index)` | [admin.vector()](#contextadminvectorindex) |
| Send push notifications | `admin.push` | [admin.push](#contextadminpush) |
| Upload/download files directly | `storage` | [context.storage](#contextstorage) |
| Check who made this request | `auth` | [context.auth](#contextauth) |
| Get URL path parameters | `params` | [context.params](#contextparams) |
| Know what triggered this function | `trigger` / `data` | [context.trigger](#contexttrigger) |

---

## Context Overview

```typescript
interface FunctionContext {
  admin: FunctionAdminContext;   // Server SDK — full access to all services
  auth: AuthContext | null;      // Current user (if request is authenticated)
  params: Record<string, string>; // Dynamic route params from [param] segments
  trigger?: {                    // Trigger metadata (DB triggers: namespace, table, event)
    namespace: string;
    id?: string;
    table?: string;
    event?: 'insert' | 'update' | 'delete';
  };
  request: Request;              // The original HTTP Request object
  storage?: StorageClient;       // R2 storage (if binding exists)
  analytics?: AnalyticsClient;   // Analytics Engine (if binding exists)
  data?: {                       // DB trigger data (trigger functions only)
    before?: Record<string, any>;
    after?: Record<string, any>;
  };
}
```

:::info Admin SDK Coverage
The `context.admin` methods documented here are the same server-side surfaces exposed by all Admin SDKs.
:::

## context.admin.db(namespace, id?)

Access any database block, bypassing access rules. This is the primary way to read and write data in App Functions.

```typescript
// Access a single-instance block (name is your config key, e.g. "app")
const posts = await context.admin.db('app').table('posts').list();

// Access a dynamic block by namespace and instance ID
const docs = await context.admin.db('workspace', 'ws-123').table('documents').list();

// Create a record
await context.admin.db('app').table('notifications').insert({
  userId: context.auth?.id,
  message: 'Your report is ready',
  read: false,
});

// Update a record
await context.admin.db('app').table('posts').update('post-id', {
  status: 'published',
});

// Delete a record
await context.admin.db('app').table('posts').delete('post-id');

// Query with filters
const published = await context.admin.db('app').table('posts').list({
  limit: 10,
  filter: [
    ['status', '==', 'published'],
    ['authorId', '==', context.auth?.id],
  ],
});
```

:::note
`context.admin.db()` bypasses all access rules. App Functions are treated as trusted server-side code. Use this for operations that the client should not perform directly.
:::

## context.admin.sql(namespace, id?, sql, params)

Execute raw SQL against a specific database block. Useful for complex queries that the table API does not support (JOINs, aggregations, CTEs, etc.).

```typescript
// Simple query
const topAuthors = await context.admin.sql(
  'app',
  undefined,
  'SELECT authorId, COUNT(*) as count FROM posts GROUP BY authorId ORDER BY count DESC LIMIT ?',
  [10]
);

// Query on an isolated DO
const userStats = await context.admin.sql(
  'workspace',
  'ws-123',
  'SELECT COUNT(*) as total FROM documents WHERE createdAt > ?',
  ['2025-01-01']
);

// JOIN across tables in the same group
const results = await context.admin.sql(
  'app',
  undefined,
  `SELECT p.title, u.displayName
   FROM posts p
   JOIN profiles u ON p.authorId = u.userId
   WHERE p.status = ?`,
  ['published']
);
```

## context.admin.broadcast(channel, event, data)

Broadcast a message to database-live subscribers on a specific channel. This enables server-initiated push to DB live WebSocket subscribers.

```typescript
// Notify database-live subscribers of the "updates" channel
await context.admin.broadcast('updates', 'new-post', {
  id: 'post-123',
  title: 'Breaking News',
});

// Broadcast a system notification to database-live subscribers
await context.admin.broadcast('system', 'maintenance', {
  message: 'Scheduled maintenance in 30 minutes',
  scheduledAt: '2025-03-01T06:00:00Z',
});
```

## context.admin.auth

Server-side user management API. Provides full control over user accounts, custom claims, and sessions.

```typescript
// Get a user by ID
const user = await context.admin.auth.getUser('user-id');

// List users with pagination
const { users, cursor } = await context.admin.auth.listUsers({
  limit: 50,
  cursor: 'previous-cursor',
});

// Create a new user
const newUser = await context.admin.auth.createUser({
  email: 'admin@example.com',
  password: 'securePassword',
  displayName: 'Admin User',
  role: 'admin',
});

// Update a user
await context.admin.auth.updateUser('user-id', {
  displayName: 'Updated Name',
  role: 'moderator',
});

// Delete a user
await context.admin.auth.deleteUser('user-id');

// Set custom JWT claims
await context.admin.auth.setCustomClaims('user-id', {
  plan: 'pro',
  features: ['export', 'analytics'],
});

// Revoke all sessions (force re-login)
await context.admin.auth.revokeAllSessions('user-id');
```

### admin.auth Methods

| Method | Description |
|--------|-------------|
| `getUser(userId)` | Retrieve a user record by ID |
| `listUsers(options?)` | List users with cursor-based pagination |
| `createUser(data)` | Create a new user (email, password, displayName, role) |
| `updateUser(userId, data)` | Update user fields |
| `deleteUser(userId)` | Delete a user and clean up related records |
| `setCustomClaims(userId, claims)` | Set custom claims that are injected into JWT on refresh |
| `revokeAllSessions(userId)` | Invalidate all sessions, forcing re-authentication |

## context.admin.kv(namespace)

Access user-defined KV namespaces declared in `config.kv`. This is separate from EdgeBase's internal KV (which handles OAuth state, WebSocket pending tokens, etc.).

```typescript
// edgebase.config.ts
export default defineConfig({
  kv: {
    cache: {},  // Declares a KV namespace named "cache"
  },
});

// In your App Function
const kv = context.admin.kv('cache');

// Set a value
await kv.set('page:home', JSON.stringify({ html: '<h1>Hello</h1>' }), {
  ttl: 3600,  // 1 hour TTL
});

// Get a value
const cached = await kv.get('page:home');

// Delete a value
await kv.delete('page:home');

// List keys
const keys = await kv.list({ prefix: 'page:' });
```

## context.admin.d1(database)

Access user-defined D1 databases declared in `config.d1`. Useful for relational data that needs global consistency or cross-region reads.

```typescript
// edgebase.config.ts
export default defineConfig({
  d1: {
    analytics: {},  // Declares a D1 database named "analytics"
  },
});

// In your App Function
const d1 = context.admin.d1('analytics');

// Execute SQL
const results = await d1.exec(
  'SELECT page, COUNT(*) as views FROM page_views WHERE date > ? GROUP BY page ORDER BY views DESC LIMIT ?',
  ['2025-01-01', 10]
);

```

## context.admin.vector(index)

Access Vectorize indexes declared in `config.vectorize`. Enables vector similarity search for semantic retrieval and ranking workflows.

```typescript
// edgebase.config.ts
export default defineConfig({
  vectorize: {
    embeddings: {
      dimensions: 1536,
      metric: 'cosine',
    },
  },
});

// In your App Function
const vector = context.admin.vector('embeddings');

// Insert vectors
await vector.upsert([
  { id: 'doc-1', values: [0.1, 0.2, ...], metadata: { title: 'Guide' } },
  { id: 'doc-2', values: [0.3, 0.4, ...], metadata: { title: 'Tutorial' } },
]);

// Search similar vectors
const results = await vector.search([0.15, 0.25, ...], {
  topK: 5,
  returnMetadata: true,
});
```

## context.admin.push

Push notification management for sending notifications to user devices via FCM.

```typescript
// Send a notification to all of a user's registered devices
const result = await context.admin.push.send('user-id', {
  title: 'New Message',
  body: 'You have a new message from Jane',
});
// result: { sent: 2, failed: 0, removed: 0 }

// Send to multiple users at once (server chunks internally at 500)
const result = await context.admin.push.sendMany(
  ['user-1', 'user-2', 'user-3'],
  { title: 'System Update', body: 'New features available!' }
);

// Get registered device tokens for a user (token values are NOT exposed)
const tokens = await context.admin.push.getTokens('user-id');
// [{ deviceId, platform, updatedAt, deviceInfo?, metadata? }]

// Get push send logs for a user (last 24 hours)
const logs = await context.admin.push.getLogs('user-id', 50);
// [{ sentAt, userId, platform, status, collapseId?, error? }]

// Send directly to an FCM token (bypasses KV storage, Service Key only)
await context.admin.push.sendToToken('fcm-token-string', {
  title: 'Direct Push',
  body: 'Sent to a specific device token',
}, 'android');

// Send to an FCM topic
await context.admin.push.sendToTopic('news', {
  title: 'Breaking News',
  body: 'New article published',
});

// Broadcast to all devices via /topics/all
await context.admin.push.broadcast({
  title: 'Maintenance Notice',
  body: 'Scheduled maintenance in 30 minutes',
});
```

### admin.push Methods

| Method | Description |
|--------|-------------|
| `send(userId, payload)` | Send a notification to all of a user's registered devices |
| `sendMany(userIds, payload)` | Send to multiple users (no limit -- server chunks at 500) |
| `getTokens(userId)` | List registered device tokens for a user (token values not exposed) |
| `getLogs(userId, limit?)` | Get push send logs for a user (last 24 hours) |
| `sendToToken(token, payload, platform?)` | Send directly using an FCM token (Service Key only) |
| `sendToTopic(topic, payload)` | Send to an FCM topic (Service Key only) |
| `broadcast(payload)` | Broadcast to all devices via `/topics/all` (Service Key only) |

## context.storage

R2 storage adapter for file operations. Only available if the R2 binding exists in your Cloudflare environment.

```typescript
// Upload a file
await context.storage.put('avatars/user-123.jpg', fileBuffer, {
  contentType: 'image/jpeg',
});

// Get a file
const file = await context.storage.get('avatars/user-123.jpg');

// Delete a file
await context.storage.delete('avatars/user-123.jpg');

// Generate a signed URL
const url = await context.storage.getSignedUrl('reports/q1.pdf', {
  expiresIn: 3600,  // 1 hour
});
```

## context.analytics

Analytics Engine adapter for recording custom business events. Available if the `ANALYTICS` binding exists.

```typescript
// Record a custom event
context.analytics.writeDataPoint({
  indexes: [context.auth?.id || 'anonymous'],
  blobs: ['purchase', 'pro-plan', 'monthly'],
  doubles: [29.99, Date.now()],
});
```

In self-hosted environments, analytics data falls back to a local SQLite file (`analytics.db`).

## context.auth

The current user's authentication information, extracted from the JWT. `null` if the request is unauthenticated.

```typescript
if (context.auth) {
  console.log(context.auth.id);           // User ID
  console.log(context.auth.email);        // Email address
  console.log(context.auth.role);         // User role
  console.log(context.auth.isAnonymous);  // Whether the user is anonymous
  console.log(context.auth.custom);       // Custom claims from JWT
}
```

## context.params

Dynamic route parameters captured from `[param]` segments in the file path. Only populated for HTTP functions with dynamic routes.

```typescript
// functions/users/[userId]/posts/[postId].ts
// URL: /api/functions/users/abc123/posts/post-456

export const GET = defineFunction(async ({ params, admin }) => {
  // params.userId = 'abc123'
  // params.postId = 'post-456'
  const post = await admin.db('app').table('posts').get(params.postId);
  if (post.authorId !== params.userId) {
    return Response.json({ code: 404, message: 'Post not found.' }, { status: 404 });
  }

  return Response.json(post);
});
```

For trigger functions (DB, schedule, auth), `params` is an empty object.

## context.trigger

Metadata about what triggered the current function execution. Present for DB trigger functions; `undefined` for HTTP functions.

```typescript
interface TriggerContext {
  namespace: string;            // DB block namespace (e.g., 'app', 'workspace')
  id?: string;                  // DO instance ID (e.g., 'ws-123') — undefined for static DBs
  table?: string;               // Table name that fired the trigger
  event?: 'insert' | 'update' | 'delete';  // The mutation event type
}
```

```typescript
// functions/onPostChange.ts
import { defineFunction } from '@edgebase-fun/shared';

export default defineFunction({
  trigger: { type: 'db', table: 'posts', event: 'update' },
  handler: async (context) => {
    console.log(context.trigger.namespace);  // 'app'
    console.log(context.trigger.id);         // undefined (static DB)
    console.log(context.trigger.table);      // 'posts'
    console.log(context.trigger.event);      // 'update'

    // Use trigger metadata for conditional logic
    if (context.trigger.namespace === 'workspace') {
      console.log(`Workspace DO: ${context.trigger.id}`);
    }
  },
});
```

For schedule and auth triggers, `namespace` reflects the trigger source, while `id`, `table`, and `event` are `undefined`.

## context.request

The original HTTP `Request` object. Available for all trigger types, though most useful for HTTP triggers.

```typescript
// functions/webhook.ts
import { defineFunction } from '@edgebase-fun/shared';

export const POST = defineFunction(async (context) => {
  const body = await context.request.json();
  const ip = context.request.headers.get('cf-connecting-ip');
  const userAgent = context.request.headers.get('user-agent');

  await context.admin.db('app').table('webhooks').insert({
    payload: body,
    sourceIp: ip,
  });

  return Response.json({ received: true });
});
```

## Internal Headers

### `X-EdgeBase-Call-Depth`

EdgeBase uses the `X-EdgeBase-Call-Depth` header internally to track the depth of function-to-function calls. This prevents infinite loops when Durable Objects call back to the Worker (e.g., a DB trigger function that writes to a table, which fires another trigger).

- The header is automatically incremented on each cross-boundary call.
- If the call depth exceeds the internal limit, the request is rejected to prevent runaway recursion.
- This is handled transparently by the runtime — application code typically does not need to read or set this header.

:::note Internal use only
`X-EdgeBase-Call-Depth` is managed by the EdgeBase runtime. You do not need to set it manually. It is documented here for awareness when debugging unexpected `500` errors in deeply nested trigger chains.
:::

---

## Full Example

A complete function using multiple context APIs:

```typescript
// functions/processOrder.ts
import { defineFunction } from '@edgebase-fun/shared';

export default defineFunction({
  trigger: { type: 'db', table: 'orders', event: 'insert' },
  handler: async (context) => {
    const order = context.data.after;

    // Update inventory (same DB)
    await context.admin.sql('app', undefined,
      'UPDATE products SET stock = stock - ? WHERE id = ?',
      [order.quantity, order.productId]
    );

    // Create activity record
    await context.admin.db('app').table('activity').insert({
      type: 'order_placed',
      userId: order.userId,
      orderId: order.id,
    });

    // Notify connected clients
    await context.admin.broadcast('orders', 'new-order', {
      orderId: order.id,
      total: order.total,
    });

    // Log analytics event
    context.analytics?.writeDataPoint({
      indexes: [order.userId],
      blobs: ['order', order.productId],
      doubles: [order.total, Date.now()],
    });
  },
});
```
