---
sidebar_position: 3
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Admin SDK

Admin SDKs run on your **backend server** and authenticate with a **Service Key**. They bypass access rules and unlock server-only features like Admin Auth, Raw SQL, Broadcast, Functions, Analytics, and Cloudflare native resources.

Admin SDKs are available in **12 languages**: JavaScript, Dart, Kotlin, Java, Scala, Python, Go, PHP, Rust, C#, Ruby, and Elixir.

For the latest cross-runtime certification status across `dev`, `docker`, and `deployed`, see [SDK Verification Matrix](/docs/sdks/verification-matrix).

## At a Glance

| | Client SDK | Admin SDK |
|--|-----------|------------|
| **Runs on** | Browser, Mobile, Game Engine | Backend server, Cloud function, CLI |
| **Auth method** | User token (JWT) | Service Key |
| **Access Rules** | Applied | **Bypassed** |
| **User auth (signUp/signIn)** | ✅ | — |
| **Admin auth (createUser/deleteUser)** | — | ✅ |
| **Database subscriptions** | ✅ | — |
| **Database broadcast (server send only)** | — | ✅ |
| **Raw SQL** | — | ✅ |
| **Push send / logs** | — | ✅ |
| **Functions / webhooks invoke** | — | ✅ |
| **Analytics / event queries** | — | ✅ |
| **KV / D1 / Vectorize** | — | ✅ |

:::warning
**Never expose the Service Key in client-side code.** It has full admin access to your backend, including user management and raw SQL execution.
:::

For installation instructions, see [SDK Overview](/docs/sdks) — select the "Admin SDK" tab for each language.

Admin SDKs do **not** expose client WebSocket subscriptions. They can, however, publish server-side database broadcasts into subscription channels with Service Key authority.

---

## Admin-Only Features

These features require a **Service Key** and are only available in admin mode.

### Admin Auth

Manage users programmatically — create, update, delete, set custom claims.

<Tabs groupId="admin-sdk">
<TabItem value="js" label="JavaScript" default>

```typescript
const user = await admin.auth.createUser({
  email: 'admin@example.com',
  password: 'securePassword',
  displayName: 'Admin',
  role: 'admin',
});

await admin.auth.setCustomClaims('user-id', { plan: 'pro' });
await admin.auth.revokeAllSessions('user-id');
```

</TabItem>
<TabItem value="go" label="Go">

```go
user, err := admin.AdminAuth.CreateUser(edgebase.CreateUserInput{
    Email:       "admin@example.com",
    Password:    "securePassword",
    DisplayName: "Admin",
    Role:        "admin",
})

err = admin.AdminAuth.SetCustomClaims("user-id", map[string]any{"plan": "pro"})
err = admin.AdminAuth.RevokeAllSessions("user-id")
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$user = $client->adminAuth->createUser([
    'email' => 'admin@example.com',
    'password' => 'securePassword',
    'displayName' => 'Admin',
    'role' => 'admin',
]);

$client->adminAuth->setCustomClaims('user-id', ['plan' => 'pro']);
$client->adminAuth->revokeAllSessions('user-id');
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let user = admin.admin_auth().create_user("admin@example.com", "securePassword").await?;

admin.admin_auth().set_custom_claims("user-id", json!({"plan": "pro"})).await?;
admin.admin_auth().revoke_all_sessions("user-id").await?;
```

</TabItem>
<TabItem value="python" label="Python">

```python
user = admin.admin_auth.create_user(
    email='admin@example.com',
    password='securePassword',
    display_name='Admin',
    role='admin',
)

admin.admin_auth.set_custom_claims('user-id', {'plan': 'pro'})
admin.admin_auth.revoke_all_sessions('user-id')
```

</TabItem>
<TabItem value="dart" label="Dart">

```dart
final user = await admin.adminAuth.createUser(
  email: 'admin@example.com',
  password: 'securePassword',
  displayName: 'Admin',
  role: 'admin',
);

await admin.adminAuth.setCustomClaims('user-id', {'plan': 'pro'});
await admin.adminAuth.revokeAllSessions('user-id');
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val user = admin.adminAuth.createUser(
    email = "admin@example.com",
    password = "securePassword",
    displayName = "Admin",
    role = "admin"
)

admin.adminAuth.setCustomClaims("user-id", mapOf("plan" to "pro"))
admin.adminAuth.revokeAllSessions("user-id")
```

</TabItem>
<TabItem value="java" label="Java">

```java
Map<String, Object> user = admin.adminAuth().createUser(
    "admin@example.com", "securePassword", "Admin", "admin"
);

admin.adminAuth().setCustomClaims("user-id", Map.of("plan", "pro"));
admin.adminAuth().revokeAllSessions("user-id");
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val user = admin.adminAuth.createUser(Map(
  "email" -> "admin@example.com",
  "password" -> "securePassword",
  "displayName" -> "Admin",
  "role" -> "admin",
))

admin.adminAuth.setCustomClaims("user-id", Map("plan" -> "pro"))
admin.adminAuth.revokeAllSessions("user-id")
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
user = admin.admin_auth.create_user("admin@example.com", "securePassword")

admin.admin_auth.set_custom_claims("user-id", { "plan" => "pro" })
admin.admin_auth.revoke_all_sessions("user-id")
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseAdmin.AdminAuth

auth = EdgeBaseAdmin.admin_auth(admin)

user =
  AdminAuth.create_user!(auth, %{
    "email" => "admin@example.com",
    "password" => "securePassword",
    "displayName" => "Admin",
    "role" => "admin"
  })

AdminAuth.set_custom_claims!(auth, "user-id", %{"plan" => "pro"})
AdminAuth.revoke_all_sessions!(auth, "user-id")
```

</TabItem>
</Tabs>

### Raw SQL

Execute raw SQL queries against your database.

<Tabs groupId="admin-sdk">
<TabItem value="js" label="JavaScript" default>

```typescript
const rows = await admin.sql('posts',
  'SELECT authorId, COUNT(*) as cnt FROM posts GROUP BY authorId ORDER BY cnt DESC LIMIT ?',
  [10]
);
```

</TabItem>
<TabItem value="go" label="Go">

```go
rows, err := admin.Sql("posts",
    "SELECT authorId, COUNT(*) as cnt FROM posts GROUP BY authorId ORDER BY cnt DESC LIMIT ?",
    10,
)
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$rows = $client->sql('posts',
    'SELECT authorId, COUNT(*) as cnt FROM posts GROUP BY authorId ORDER BY cnt DESC LIMIT ?',
    [10],
);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
let rows = admin.sql("posts",
    "SELECT authorId, COUNT(*) as cnt FROM posts GROUP BY authorId ORDER BY cnt DESC LIMIT ?",
    &[json!(10)],
).await?;
```

</TabItem>
<TabItem value="python" label="Python">

```python
rows = admin.sql('posts',
    'SELECT authorId, COUNT(*) as cnt FROM posts GROUP BY authorId ORDER BY cnt DESC LIMIT ?',
    [10],
)
```

</TabItem>
<TabItem value="dart" label="Dart">

```dart
final rows = await admin.sql('posts',
  'SELECT authorId, COUNT(*) as cnt FROM posts GROUP BY authorId ORDER BY cnt DESC LIMIT ?',
  [10],
);
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val rows = admin.sql("posts",
    "SELECT authorId, COUNT(*) as cnt FROM posts GROUP BY authorId ORDER BY cnt DESC LIMIT ?",
    listOf(10)
)
```

</TabItem>
<TabItem value="java" label="Java">

```java
List<Map<String, Object>> rows = admin.sql("posts",
    "SELECT authorId, COUNT(*) as cnt FROM posts GROUP BY authorId ORDER BY cnt DESC LIMIT ?",
    List.of(10)
);
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
val rows = admin.sql(
  "posts",
  "SELECT authorId, COUNT(*) as cnt FROM posts GROUP BY authorId ORDER BY cnt DESC LIMIT ?",
  Seq(10)
)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
rows = admin.sql("posts",
  "SELECT authorId, COUNT(*) as cnt FROM posts GROUP BY authorId ORDER BY cnt DESC LIMIT ?",
  [10])
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
rows =
  EdgeBaseAdmin.sql!(admin,
    "SELECT authorId, COUNT(*) as cnt FROM posts GROUP BY authorId ORDER BY cnt DESC LIMIT ?",
    namespace: "posts",
    params: [10]
  )
```

</TabItem>
</Tabs>

### Server-Side Broadcast

Send broadcast messages from your server to all connected clients.

<Tabs groupId="admin-sdk">
<TabItem value="js" label="JavaScript" default>

```typescript
await admin.broadcast('notifications', 'alert', {
  message: 'System maintenance in 5 minutes',
});
```

</TabItem>
<TabItem value="go" label="Go">

```go
err := admin.Broadcast("notifications", "alert", map[string]any{
    "message": "System maintenance in 5 minutes",
})
```

</TabItem>
<TabItem value="php" label="PHP">

```php
$client->broadcast('notifications', 'alert', [
    'message' => 'System maintenance in 5 minutes',
]);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
admin.broadcast("notifications", "alert", json!({
    "message": "System maintenance in 5 minutes",
})).await?;
```

</TabItem>
<TabItem value="python" label="Python">

```python
admin.broadcast('notifications', 'alert', {
    'message': 'System maintenance in 5 minutes',
})
```

</TabItem>
<TabItem value="dart" label="Dart">

```dart
await admin.broadcast('notifications', 'alert', {
  'message': 'System maintenance in 5 minutes',
});
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
admin.broadcast("notifications", "alert", mapOf(
    "message" to "System maintenance in 5 minutes"
))
```

</TabItem>
<TabItem value="java" label="Java">

```java
admin.broadcast("notifications", "alert", Map.of(
    "message", "System maintenance in 5 minutes"
));
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
admin.broadcast("notifications", "alert", Map(
  "message" -> "System maintenance in 5 minutes"
))
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
admin.broadcast("notifications", "alert", {
  "message" => "System maintenance in 5 minutes"
})
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
EdgeBaseAdmin.broadcast!(admin, "notifications", "alert", %{
  "message" => "System maintenance in 5 minutes"
})
```

</TabItem>
</Tabs>

### Cloudflare Native Resources (KV / D1 / Vectorize)

Access user-defined Cloudflare KV, D1 databases, and Vectorize indexes directly from your server code. Resources must be declared in `edgebase.config.ts` — only allowlisted bindings are accessible.

<Tabs groupId="admin-sdk">
<TabItem value="js" label="JavaScript" default>

```typescript
// KV — cache, session store, feature flags
await admin.kv('cache').set('key', 'value', { ttl: 300 });
const val = await admin.kv('cache').get('key');
await admin.kv('cache').delete('key');
const list = await admin.kv('cache').list({ prefix: 'user:' });

// D1 — analytics, logs, relational queries
const rows = await admin.d1('analytics').exec(
  'SELECT * FROM events WHERE type = ?',
  ['pageview']
);

// Vectorize — semantic search, RAG, recommendations
await admin.vector('embeddings').upsert([
  { id: 'doc-1', values: [0.1, 0.2, ...], metadata: { title: 'Hello' } },
]);
const results = await admin.vector('embeddings').search(
  [0.1, 0.2, ...],
  { topK: 10, filter: { type: 'article' } }
);
```

</TabItem>
<TabItem value="python" label="Python">

```python
# KV
await admin.kv("cache").set("key", "value", ttl=300)
val = await admin.kv("cache").get("key")
await admin.kv("cache").delete("key")
keys = await admin.kv("cache").list(prefix="user:")

# D1
rows = await admin.d1("analytics").exec(
    "SELECT * FROM events WHERE type = ?", ["pageview"]
)

# Vectorize
await admin.vector("embeddings").upsert([
    {"id": "doc-1", "values": [0.1, 0.2], "metadata": {"title": "Hello"}}
])
results = await admin.vector("embeddings").search([0.1, 0.2], top_k=10)
```

</TabItem>
<TabItem value="go" label="Go">

```go
// KV
err := admin.KV("cache").Set("key", "value", 300)
val, err := admin.KV("cache").Get("key")
err = admin.KV("cache").Delete("key")
keys, err := admin.KV("cache").List(&edgebase.KvListOptions{Prefix: "user:", Limit: 100})

// D1
rows, err := admin.D1("analytics").Exec(
    "SELECT * FROM events WHERE type = ?", "pageview",
)

// Vectorize
err = admin.Vector("embeddings").Upsert([]map[string]any{
    {"id": "doc-1", "values": []float64{0.1, 0.2}},
})
results, err := admin.Vector("embeddings").Search([]float64{0.1, 0.2}, 10, nil)
```

</TabItem>
<TabItem value="dart" label="Dart">

```dart
// KV
await admin.kv('cache').set('key', 'value', ttl: 300);
final val = await admin.kv('cache').get('key');
await admin.kv('cache').delete('key');
final keys = await admin.kv('cache').list(prefix: 'user:');

// D1
final rows = await admin.d1('analytics').exec(
  'SELECT * FROM events WHERE type = ?', ['pageview'],
);

// Vectorize
await admin.vector('embeddings').upsert([
  {'id': 'doc-1', 'values': [0.1, 0.2], 'metadata': {'title': 'Hello'}},
]);
final results = await admin.vector('embeddings').search([0.1, 0.2], topK: 10);
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
// KV
admin.kv("cache").set("key", "value", ttl = 300)
val value = admin.kv("cache").get("key")
admin.kv("cache").delete("key")
val keys = admin.kv("cache").list(prefix = "user:")

// D1
val rows = admin.d1("analytics").exec(
    "SELECT * FROM events WHERE type = ?", listOf("pageview")
)

// Vectorize
admin.vector("embeddings").upsert(listOf(
    mapOf("id" to "doc-1", "values" to listOf(0.1, 0.2))
))
val results = admin.vector("embeddings").search(listOf(0.1, 0.2), topK = 10)
```

</TabItem>
<TabItem value="java" label="Java">

```java
// KV
admin.kv("cache").set("key", "value", 300);
String val = admin.kv("cache").get("key");
admin.kv("cache").delete("key");
Map<String, Object> keys = admin.kv("cache").list("user:", 100, null);

// D1
List<Map<String, Object>> rows = admin.d1("analytics").exec(
    "SELECT * FROM events WHERE type = ?", List.of("pageview")
);

// Vectorize
admin.vector("embeddings").upsert(List.of(
    Map.of("id", "doc-1", "values", List.of(0.1, 0.2))
));
List<Map<String, Object>> results = admin.vector("embeddings")
    .search(List.of(0.1, 0.2), 10, null);
```

</TabItem>
<TabItem value="php" label="PHP">

```php
// KV
$client->kv('cache')->set('key', 'value', 300);
$val = $client->kv('cache')->get('key');
$client->kv('cache')->delete('key');
$keys = $client->kv('cache')->list('user:', 100);

// D1
$rows = $client->d1('analytics')->exec(
    'SELECT * FROM events WHERE type = ?', ['pageview']
);

// Vectorize
$client->vector('embeddings')->upsert([
    ['id' => 'doc-1', 'values' => [0.1, 0.2], 'metadata' => ['title' => 'Hello']],
]);
$results = $client->vector('embeddings')->search([0.1, 0.2], 10);
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
// KV
admin.kv("cache").set("key", "value", Some(300)).await?;
let val = admin.kv("cache").get("key").await?;
admin.kv("cache").delete("key").await?;
let keys = admin.kv("cache").list(Some("user:"), Some(100), None).await?;

// D1
let rows = admin.d1("analytics").exec(
    "SELECT * FROM events WHERE type = ?", &[json!("pageview")]
).await?;

// Vectorize
admin.vector("embeddings").upsert(vec![json!({
    "id": "doc-1", "values": [0.1, 0.2]
})]).await?;
let results = admin.vector("embeddings").search(
    vec![0.1, 0.2], 10, None
).await?;
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
// KV
admin.kv("cache").set("key", "value", Some(300))
val value = admin.kv("cache").get("key")
val keys = admin.kv("cache").list(prefix = "user:")

// D1
val rows = admin.d1("analytics").exec(
  "SELECT * FROM events WHERE type = ?",
  Seq("pageview")
)

// Vectorize
admin.vector("embeddings").upsert(Seq(
  Map("id" -> "doc-1", "values" -> Seq(0.1, 0.2))
))
val results = admin.vector("embeddings").search(Seq(0.1, 0.2), topK = 10)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
# KV
admin.kv("cache").set("key", "value", ttl: 300)
val = admin.kv("cache").get("key")
admin.kv("cache").delete("key")
keys = admin.kv("cache").list(prefix: "user:", limit: 100)

# D1
rows = admin.d1("analytics").exec(
  "SELECT * FROM events WHERE type = ?", ["pageview"])

# Vectorize
admin.vector("embeddings").upsert([
  { "id" => "doc-1", "values" => [0.1, 0.2], "metadata" => { "title" => "Hello" } }
])
results = admin.vector("embeddings").search([0.1, 0.2], top_k: 10)
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
# KV
EdgeBaseAdmin.kv(admin, "cache") |> EdgeBaseAdmin.KV.set!("key", "value", ttl: 300)
value = EdgeBaseAdmin.kv(admin, "cache") |> EdgeBaseAdmin.KV.get!("key")
keys = EdgeBaseAdmin.kv(admin, "cache") |> EdgeBaseAdmin.KV.list!(prefix: "user:")

# D1
rows = EdgeBaseAdmin.d1(admin, "analytics") |> EdgeBaseAdmin.D1.exec!("SELECT * FROM events WHERE type = ?", ["pageview"])

# Vectorize
EdgeBaseAdmin.vector(admin, "embeddings")
|> EdgeBaseAdmin.Vector.upsert!([
  %{"id" => "doc-1", "values" => [0.1, 0.2], "metadata" => %{"title" => "Hello"}}
])

results =
  EdgeBaseAdmin.vector(admin, "embeddings")
  |> EdgeBaseAdmin.Vector.search!([0.1, 0.2], top_k: 10)
```

</TabItem>
</Tabs>

:::info Local Development
KV and D1 work fully in local/Docker environments via Miniflare emulation. **Vectorize is Edge-only** — local calls return stub responses with a console warning.
:::

---

## Choosing the Right SDK

### Web App (React, Vue, Svelte)

Use the **JavaScript SDK** in client mode for the frontend. If you need server-side rendering (SSR) or API routes, use server mode in your backend.

### Mobile App (Flutter)

Use the **Dart SDK** in client mode. For background processing or admin tasks, use server mode in your Dart backend.

### Mobile App (React Native)

Use the **React Native SDK** in client mode.

### Mobile App (iOS native)

Use the **Swift SDK** in client mode.

### Mobile App (Android native)

Use the **Kotlin SDK** in client mode.

### Game (Unity)

Use the **C# SDK** — client mode for Unity, admin mode for ASP.NET Core / .NET backend servers.

### Game (Unreal Engine)

Use the **C++ SDK** *(alpha)* — client only. For admin operations, use a separate backend.

### Backend API / Microservice

Use **Go**, **PHP**, **Rust**, **Ruby**, **Scala**, or **Elixir** SDK. These are server-only and authenticate with a Service Key.

### Scripts / Automation / ML

Use the **Python**, **Ruby**, or **Elixir** SDK with a service key. These are all strong fits for scripts, automation, and data tasks.

---

## Next Steps

- [**SDK Overview →**](/docs/sdks) — All SDKs with installation & feature matrix
- [**Admin Auth →**](../authentication/admin-users) — Server-side user management
- [**Access Rules →**](../server/access-rules) — How rules apply to client vs admin
