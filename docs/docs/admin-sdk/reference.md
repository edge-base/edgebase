---
sidebar_position: 1
title: Admin SDK Reference
description: Unified reference for Admin SDK operations across all supported languages.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Admin SDK Reference

Admin SDKs run on your backend server and authenticate with a **Service Key**. They bypass all access rules and provide server-only capabilities.

Admin SDKs are available in 12 languages. This page documents the common operations with examples in JavaScript, Python, and Go. The API surface is consistent across all languages -- see [SDK Overview](/docs/sdks) for installation instructions and the full language list.

:::warning
Never expose the Service Key in client-side code. It grants full admin access to your backend.
:::

---

## Initialization

<Tabs groupId="admin-sdk">
<TabItem value="js" label="JavaScript" default>

```typescript
import { createAdminClient } from '@edgebase-fun/admin';

const admin = createAdminClient('https://your-project.edgebase.fun', {
  serviceKey: process.env.EDGEBASE_SERVICE_KEY,
});
```

</TabItem>
<TabItem value="python" label="Python">

```python
from edgebase_admin import create_admin_client

admin = create_admin_client(
    'https://your-project.edgebase.fun',
    service_key=os.environ['EDGEBASE_SERVICE_KEY'],
)
```

</TabItem>
<TabItem value="go" label="Go">

```go
import edgebase "github.com/edge-base/sdk-go"

admin, err := edgebase.NewAdminClient(
    "https://your-project.edgebase.fun",
    os.Getenv("EDGEBASE_SERVICE_KEY"),
)
```

</TabItem>
</Tabs>

---

## Auth Management

### List Users

Paginated user listing with cursor-based pagination.

<Tabs groupId="admin-sdk">
<TabItem value="js" label="JavaScript" default>

```typescript
const { users, cursor } = await admin.auth.listUsers({ limit: 20 });

// Paginate
let nextCursor = cursor;
while (nextCursor) {
  const page = await admin.auth.listUsers({ limit: 20, cursor: nextCursor });
  users.push(...page.users);
  nextCursor = page.cursor;
}
```

</TabItem>
<TabItem value="python" label="Python">

```python
result = admin.admin_auth.list_users(limit=20)
users = result['users']

# Paginate
cursor = result.get('cursor')
while cursor:
    page = admin.admin_auth.list_users(limit=20, cursor=cursor)
    users.extend(page['users'])
    cursor = page.get('cursor')
```

</TabItem>
<TabItem value="go" label="Go">

```go
result, err := admin.AdminAuth.ListUsers(edgebase.ListUsersInput{Limit: 20})

// Paginate
cursor := result.Cursor
for cursor != "" {
    page, err := admin.AdminAuth.ListUsers(edgebase.ListUsersInput{
        Limit:  20,
        Cursor: cursor,
    })
    users = append(users, page.Users...)
    cursor = page.Cursor
}
```

</TabItem>
</Tabs>

### Get User

```typescript
const user = await admin.auth.getUser('user-id');
// { id, email, displayName, role, customClaims, createdAt, ... }
```

### Create User

<Tabs groupId="admin-sdk">
<TabItem value="js" label="JavaScript" default>

```typescript
const user = await admin.auth.createUser({
  email: 'jane@example.com',
  password: 'securePassword',
  displayName: 'Jane Doe',
  role: 'editor',
});
```

</TabItem>
<TabItem value="python" label="Python">

```python
user = admin.admin_auth.create_user(
    email='jane@example.com',
    password='securePassword',
    display_name='Jane Doe',
    role='editor',
)
```

</TabItem>
<TabItem value="go" label="Go">

```go
user, err := admin.AdminAuth.CreateUser(edgebase.CreateUserInput{
    Email:       "jane@example.com",
    Password:    "securePassword",
    DisplayName: "Jane Doe",
    Role:        "editor",
})
```

</TabItem>
</Tabs>

### Update User

```typescript
const updated = await admin.auth.updateUser('user-id', {
  displayName: 'Jane Smith',
  role: 'admin',
});
```

### Disable / Enable User

Disabling a user revokes all sessions immediately and blocks new sign-ins.

```typescript
// Ban
await admin.auth.updateUser('user-id', { disabled: true });

// Unban
await admin.auth.updateUser('user-id', { disabled: false });
```

### Delete User

Permanently deletes the user and cleans up all associated records.

```typescript
await admin.auth.deleteUser('user-id');
```

### Set Custom Claims

Custom claims are included in the user's JWT on the next token refresh. Use them in access rules via `auth.custom`.

<Tabs groupId="admin-sdk">
<TabItem value="js" label="JavaScript" default>

```typescript
await admin.auth.setCustomClaims('user-id', {
  plan: 'pro',
  orgId: 'org_123',
  tier: 2,
});
```

</TabItem>
<TabItem value="python" label="Python">

```python
admin.admin_auth.set_custom_claims('user-id', {
    'plan': 'pro',
    'orgId': 'org_123',
    'tier': 2,
})
```

</TabItem>
<TabItem value="go" label="Go">

```go
err := admin.AdminAuth.SetCustomClaims("user-id", map[string]any{
    "plan":  "pro",
    "orgId": "org_123",
    "tier":  2,
})
```

</TabItem>
</Tabs>

### Revoke All Sessions

Forces the user to re-authenticate on all devices.

```typescript
await admin.auth.revokeAllSessions('user-id');
```

---

## Database Operations

### Table Reference

Access database tables through namespace and optional instance ID.

<Tabs groupId="admin-sdk">
<TabItem value="js" label="JavaScript" default>

```typescript
// Static app database
const posts = admin.db('app').table('posts');

// Dynamic per-workspace database
const docs = admin.db('workspace', 'ws-456').table('documents');

// Per-user database
const notes = admin.db('user', 'user-123').table('notes');
```

</TabItem>
<TabItem value="python" label="Python">

```python
posts = admin.db('app').table('posts')
docs = admin.db('workspace', 'ws-456').table('documents')
notes = admin.db('user', 'user-123').table('notes')
```

</TabItem>
<TabItem value="go" label="Go">

```go
posts := admin.DB("app").Table("posts")
docs := admin.DB("workspace", "ws-456").Table("documents")
notes := admin.DB("user", "user-123").Table("notes")
```

</TabItem>
</Tabs>

### CRUD Operations

<Tabs groupId="admin-sdk">
<TabItem value="js" label="JavaScript" default>

```typescript
const table = admin.db('app').table('posts');

// Create
const post = await table.insert({ title: 'Hello', body: 'World' });

// Read by ID
const found = await table.get('post-id');

// List with filters
const recent = await table.list({
  where: { published: true },
  orderBy: { createdAt: 'desc' },
  limit: 10,
});

// Update
const updated = await table.update('post-id', { title: 'Updated Title' });

// Delete
await table.delete('post-id');
```

</TabItem>
<TabItem value="python" label="Python">

```python
table = admin.db('app').table('posts')

# Create
post = table.insert({'title': 'Hello', 'body': 'World'})

# Read by ID
found = table.get('post-id')

# List with filters
recent = table.list(
    where={'published': True},
    order_by={'createdAt': 'desc'},
    limit=10,
)

# Update
updated = table.update('post-id', {'title': 'Updated Title'})

# Delete
table.delete('post-id')
```

</TabItem>
<TabItem value="go" label="Go">

```go
table := admin.DB("app").Table("posts")

// Create
post, err := table.Insert(map[string]any{"title": "Hello", "body": "World"})

// Read by ID
found, err := table.Get("post-id")

// List with filters
recent, err := table.List(edgebase.ListOptions{
    Where:   map[string]any{"published": true},
    OrderBy: map[string]string{"createdAt": "desc"},
    Limit:   10,
})

// Update
updated, err := table.Update("post-id", map[string]any{"title": "Updated Title"})

// Delete
err = table.Delete("post-id")
```

</TabItem>
</Tabs>

### Raw SQL

Execute arbitrary SQL queries against a database namespace.

<Tabs groupId="admin-sdk">
<TabItem value="js" label="JavaScript" default>

```typescript
const rows = await admin.sql(
  'app', undefined,
  'SELECT authorId, COUNT(*) as cnt FROM posts GROUP BY authorId ORDER BY cnt DESC LIMIT ?',
  [10],
);
```

</TabItem>
<TabItem value="python" label="Python">

```python
rows = admin.sql(
    'app', None,
    'SELECT authorId, COUNT(*) as cnt FROM posts GROUP BY authorId ORDER BY cnt DESC LIMIT ?',
    [10],
)
```

</TabItem>
<TabItem value="go" label="Go">

```go
rows, err := admin.Sql("app", "",
    "SELECT authorId, COUNT(*) as cnt FROM posts GROUP BY authorId ORDER BY cnt DESC LIMIT ?",
    10,
)
```

</TabItem>
</Tabs>

### Broadcast

Send server-side events to database subscription channels.

```typescript
await admin.broadcast('posts', 'new_post', { id: 'post-123', title: 'Hello' });
```

---

## Storage Management

The admin storage client provides file upload, download, and management with service-key authority.

<Tabs groupId="admin-sdk">
<TabItem value="js" label="JavaScript" default>

```typescript
// Upload a file
await admin.storage.upload('avatars/user-123.png', fileBuffer, {
  contentType: 'image/png',
});

// Get a signed download URL
const url = await admin.storage.getSignedUrl('avatars/user-123.png', {
  expiresIn: 3600,
});

// List files in a path
const files = await admin.storage.list('avatars/');

// Delete a file
await admin.storage.delete('avatars/user-123.png');
```

</TabItem>
<TabItem value="python" label="Python">

```python
# Upload a file
admin.storage.upload('avatars/user-123.png', file_bytes,
    content_type='image/png')

# Get a signed download URL
url = admin.storage.get_signed_url('avatars/user-123.png', expires_in=3600)

# List files
files = admin.storage.list('avatars/')

# Delete a file
admin.storage.delete('avatars/user-123.png')
```

</TabItem>
<TabItem value="go" label="Go">

```go
// Upload a file
err := admin.Storage.Upload("avatars/user-123.png", fileBytes, edgebase.UploadOptions{
    ContentType: "image/png",
})

// Get a signed download URL
url, err := admin.Storage.GetSignedURL("avatars/user-123.png", 3600)

// List files
files, err := admin.Storage.List("avatars/")

// Delete a file
err = admin.Storage.Delete("avatars/user-123.png")
```

</TabItem>
</Tabs>

---

## Function Invocation

Invoke App Functions from your backend with service-key authority.

<Tabs groupId="admin-sdk">
<TabItem value="js" label="JavaScript" default>

```typescript
const result = await admin.functions.invoke('send-welcome-email', {
  userId: 'user-123',
  template: 'onboarding',
});
```

</TabItem>
<TabItem value="python" label="Python">

```python
result = admin.functions.invoke('send-welcome-email', {
    'userId': 'user-123',
    'template': 'onboarding',
})
```

</TabItem>
<TabItem value="go" label="Go">

```go
result, err := admin.Functions.Invoke("send-welcome-email", map[string]any{
    "userId":   "user-123",
    "template": "onboarding",
})
```

</TabItem>
</Tabs>

---

## Push Notifications

### Send to a User

```typescript
const result = await admin.push.send('user-123', {
  title: 'New message',
  body: 'You have a new message from Jane',
  data: { threadId: 'thread-456' },
});
// { sent: 2, failed: 0, removed: 0 }
```

### Send to Multiple Users

```typescript
const result = await admin.push.sendMany(
  ['user-1', 'user-2', 'user-3'],
  {
    title: 'System update',
    body: 'New features are available',
  },
);
```

### Broadcast to All Devices

```typescript
const result = await admin.push.broadcast({
  title: 'Maintenance notice',
  body: 'Scheduled maintenance at 2am UTC',
  silent: true,
});
```

### Send to FCM Topic

```typescript
const result = await admin.push.sendToTopic('news', {
  title: 'Breaking news',
  body: 'Something happened',
});
```

### Device Tokens and Logs

```typescript
// Get registered devices for a user (token values are NOT exposed)
const devices = await admin.push.getTokens('user-123');
// [{ deviceId, platform, updatedAt, deviceInfo }]

// Get send logs for debugging
const logs = await admin.push.getLogs('user-123', 50);
// [{ sentAt, userId, platform, status, error? }]
```

---

## Analytics

### Request Log Metrics

Query aggregate metrics about your API usage (same data powering the admin dashboard).

```typescript
// Full overview: time series + summary + breakdown + top endpoints
const overview = await admin.analytics.overview({ range: '7d' });
console.log(overview.summary.totalRequests);
console.log(overview.summary.avgLatency);

// Time series only
const ts = await admin.analytics.timeSeries({
  range: '24h',
  category: 'db',
  groupBy: 'hour',
});

// Breakdown by category
const breakdown = await admin.analytics.breakdown({ range: '30d' });

// Top endpoints
const top = await admin.analytics.topEndpoints({ range: '7d' });
```

### Custom Events

Track and query custom business events.

```typescript
// Track a single event
await admin.analytics.track('user_upgraded', {
  plan: 'pro',
  amount: 29.99,
}, 'user-123');

// Track a batch of events
await admin.analytics.trackBatch([
  { name: 'page_view', properties: { path: '/pricing' } },
  { name: 'page_view', properties: { path: '/docs' } },
]);

// Query events
const list = await admin.analytics.queryEvents({
  event: 'user_upgraded',
  metric: 'list',
  limit: 20,
});

const count = await admin.analytics.queryEvents({
  event: 'user_upgraded',
  metric: 'count',
  range: '30d',
});

const topEvents = await admin.analytics.queryEvents({
  metric: 'topEvents',
  range: '7d',
});
```

---

## Cloudflare Native Resources

Admin SDKs provide direct access to Cloudflare primitives when deployed on Cloudflare Workers.

### KV

```typescript
const kv = admin.kv('MY_NAMESPACE');
await kv.put('key', 'value', { expirationTtl: 3600 });
const value = await kv.get('key');
await kv.delete('key');
const keys = await kv.list({ prefix: 'user:' });
```

### D1

```typescript
const d1 = admin.d1('MY_DATABASE');
const results = await d1.execute('SELECT * FROM users WHERE active = ?', [true]);
```

### Vectorize

```typescript
const vec = admin.vector('MY_INDEX');
await vec.upsert([{ id: 'doc-1', values: [0.1, 0.2, 0.3], metadata: { title: 'Hello' } }]);
const matches = await vec.query([0.1, 0.2, 0.3], { topK: 5 });
```

---

## Method Reference

### `admin.auth`

| Method | Description |
| --- | --- |
| `listUsers(options?)` | List users with cursor-based pagination |
| `getUser(userId)` | Get a user by ID |
| `createUser(data)` | Create a new user |
| `updateUser(userId, data)` | Update a user's profile, role, or disabled status |
| `deleteUser(userId)` | Permanently delete a user |
| `setCustomClaims(userId, claims)` | Set custom JWT claims |
| `revokeAllSessions(userId)` | Force re-authentication on all devices |

### `admin.db(namespace, id?).table(name)`

| Method | Description |
| --- | --- |
| `get(id)` | Get a record by ID |
| `list(options?)` | List records with filters, ordering, and pagination |
| `insert(data)` | Insert a new record |
| `update(id, data)` | Update an existing record |
| `delete(id)` | Delete a record |

### `admin.storage`

| Method | Description |
| --- | --- |
| `upload(path, data, options?)` | Upload a file |
| `getSignedUrl(path, options?)` | Generate a signed download URL |
| `list(prefix?)` | List files under a path |
| `delete(path)` | Delete a file |

### `admin.push`

| Method | Description |
| --- | --- |
| `send(userId, payload)` | Send to a single user's devices |
| `sendMany(userIds, payload)` | Send to multiple users |
| `sendToToken(token, payload)` | Send directly to an FCM token |
| `sendToTopic(topic, payload)` | Send to an FCM topic |
| `broadcast(payload)` | Send to all registered devices |
| `getTokens(userId)` | List registered device tokens (values not exposed) |
| `getLogs(userId, limit?)` | Get recent send logs |

### `admin.analytics`

| Method | Description |
| --- | --- |
| `overview(options?)` | Full analytics overview |
| `timeSeries(options?)` | Time series data only |
| `breakdown(options?)` | Category breakdown |
| `topEndpoints(options?)` | Top endpoints by request count |
| `track(name, properties?, userId?)` | Track a custom event |
| `trackBatch(events)` | Track multiple events in one request |
| `queryEvents(options?)` | Query custom events |

### `admin.functions`

| Method | Description |
| --- | --- |
| `invoke(name, payload?)` | Invoke an App Function |

### Other

| Method | Description |
| --- | --- |
| `admin.sql(namespace, id, query, params?)` | Execute raw SQL |
| `admin.broadcast(channel, event, payload?)` | Broadcast to a database subscription channel |
| `admin.kv(namespace)` | Access Cloudflare KV |
| `admin.d1(database)` | Access Cloudflare D1 |
| `admin.vector(index)` | Access Cloudflare Vectorize |

---

## Related Docs

- [Admin SDK Overview](/docs/sdks/client-vs-server) -- client vs admin comparison
- [SDK Overview](/docs/sdks) -- installation for all 14 languages
- [Admin API Reference](/docs/api/admin) -- raw HTTP endpoints
- [App Functions Context API](/docs/functions/context-api) -- using admin inside functions
