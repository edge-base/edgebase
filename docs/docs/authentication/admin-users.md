---
sidebar_position: 17
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Admin User Management

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Server-side user management via the Service Key. These operations bypass access rules.

:::info
Admin Auth is available in all Admin SDKs. See [Admin SDK](../sdks/client-vs-server) for details.
:::

## Setup

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
import { createAdminClient } from '@edge-base/admin';

const admin = createAdminClient('https://my-app.edgebase.fun', {
  serviceKey: process.env.EDGEBASE_SERVICE_KEY,
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
import 'package:edgebase_admin/edgebase_admin.dart';

final admin = AdminEdgeBase(
  'https://my-app.edgebase.fun',
  serviceKey: Platform.environment['EDGEBASE_SERVICE_KEY']!,
);
```

</TabItem>
<TabItem value="go" label="Go">

```go
import edgebase "github.com/edge-base/sdk-go"

admin := edgebase.NewAdminClient("https://my-app.edgebase.fun", os.Getenv("EDGEBASE_SERVICE_KEY"))
```

</TabItem>
<TabItem value="php" label="PHP">

```php
use EdgeBase\Admin\AdminClient;

$admin = new AdminClient('https://my-app.edgebase.fun', getenv('EDGEBASE_SERVICE_KEY'));
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
use edgebase_admin::EdgeBase;

let admin = EdgeBase::server("https://my-app.edgebase.fun", &std::env::var("EDGEBASE_SERVICE_KEY")?)?;
```

</TabItem>
<TabItem value="python" label="Python">

```python
from edgebase_admin import create_admin_client
import os

admin = create_admin_client(
    'https://my-app.edgebase.fun',
    service_key=os.environ['EDGEBASE_SERVICE_KEY'],
)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
import dev.edgebase.sdk.admin.AdminEdgeBase

val admin = AdminEdgeBase(
    "https://my-app.edgebase.fun",
    serviceKey = System.getenv("EDGEBASE_SERVICE_KEY") ?: ""
)
```

</TabItem>

<TabItem value="java" label="Java">

```java
AdminEdgeBase admin = EdgeBase.admin(
    "https://my-app.edgebase.fun",
    System.getenv("EDGEBASE_SERVICE_KEY")
);
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
import dev.edgebase.sdk.scala.admin.AdminEdgeBase

val admin = AdminEdgeBase(
  "https://my-app.edgebase.fun",
  sys.env("EDGEBASE_SERVICE_KEY")
)
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
using var admin = new EdgeBase.Admin.AdminClient(url, serviceKey);
// Use admin.AdminAuth for user management operations
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
require "edgebase_admin"

admin = EdgebaseAdmin::AdminClient.new(
  "https://my-app.edgebase.fun",
  service_key: ENV.fetch("EDGEBASE_SERVICE_KEY")
)
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseAdmin

admin =
  EdgeBaseAdmin.new("https://my-app.edgebase.fun",
    service_key: System.fetch_env!("EDGEBASE_SERVICE_KEY")
  )
```

</TabItem>
</Tabs>

:::warning
Never use the Service Key in client-side code. It has full admin access to your backend.
:::

## Operations

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// List users
const users = await admin.auth.listUsers({ limit: 50 });

// Get user
const user = await admin.auth.getUser('user-id');

// Create user (server-side)
const newUser = await admin.auth.createUser({
  email: 'admin@example.com',
  password: 'securePassword',
  displayName: 'Admin User',
  role: 'admin',
});

// Update user
await admin.auth.updateUser('user-id', {
  displayName: 'New Name',
  role: 'moderator',
});

// Delete user
await admin.auth.deleteUser('user-id');

// Set custom claims (included in JWT)
await admin.auth.setCustomClaims('user-id', {
  plan: 'pro',
  features: ['analytics', 'export'],
});

// Revoke all sessions (force re-login)
await admin.auth.revokeAllSessions('user-id');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
// List users
final users = await admin.adminAuth.listUsers(limit: 50);

// Get user
final user = await admin.adminAuth.getUser('user-id');

// Create user
final newUser = await admin.adminAuth.createUser(
  email: 'admin@example.com',
  password: 'securePassword',
  displayName: 'Admin User',
  role: 'admin',
);

// Update user
await admin.adminAuth.updateUser('user-id', displayName: 'New Name', role: 'moderator');

// Delete user
await admin.adminAuth.deleteUser('user-id');

// Set custom claims
await admin.adminAuth.setCustomClaims('user-id', {'plan': 'pro', 'features': ['analytics', 'export']});

// Revoke all sessions
await admin.adminAuth.revokeAllSessions('user-id');
```

</TabItem>
<TabItem value="go" label="Go">

```go
import "context"

ctx := context.Background()

// List users
users, err := admin.AdminAuth.ListUsers(ctx, 50)

// Get user
user, err := admin.AdminAuth.GetUser(ctx, "user-id")

// Create user
newUser, err := admin.AdminAuth.CreateUser(ctx, "admin@example.com", "securePassword")

// Update user
_, err = admin.AdminAuth.UpdateUser(ctx, "user-id", map[string]interface{}{
    "displayName": "New Name",
    "role": "moderator",
})

// Delete user
err = admin.AdminAuth.DeleteUser(ctx, "user-id")

// Set custom claims
err = admin.AdminAuth.SetCustomClaims(ctx, "user-id", map[string]interface{}{
    "plan": "pro", "features": []string{"analytics", "export"},
})

// Revoke all sessions
err = admin.AdminAuth.RevokeAllSessions(ctx, "user-id")
```

</TabItem>
<TabItem value="php" label="PHP">

```php
// List users
$users = $client->adminAuth->listUsers(limit: 50);

// Get user
$user = $client->adminAuth->getUser('user-id');

// Create user
$newUser = $client->adminAuth->createUser([
    'email' => 'admin@example.com',
    'password' => 'securePassword',
    'displayName' => 'Admin User',
    'role' => 'admin',
]);

// Update user
$client->adminAuth->updateUser('user-id', [
    'displayName' => 'New Name',
    'role' => 'moderator',
]);

// Delete user
$client->adminAuth->deleteUser('user-id');

// Set custom claims
$client->adminAuth->setCustomClaims('user-id', [
    'plan' => 'pro',
    'features' => ['analytics', 'export'],
]);

// Revoke all sessions
$client->adminAuth->revokeAllSessions('user-id');
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
// List users
let users = admin.admin_auth().list_users(50, None).await?;

// Get user
let user = admin.admin_auth().get_user("user-id").await?;

// Create user
let new_user = admin.admin_auth().create_user("admin@example.com", "securePassword").await?;

// Update user
admin.admin_auth().update_user("user-id", &json!({
    "displayName": "New Name", "role": "moderator"
})).await?;

// Delete user
admin.admin_auth().delete_user("user-id").await?;

// Set custom claims
admin.admin_auth().set_custom_claims("user-id", json!({
    "plan": "pro", "features": ["analytics", "export"]
})).await?;

// Revoke all sessions
admin.admin_auth().revoke_all_sessions("user-id").await?;
```

</TabItem>
<TabItem value="python" label="Python">

```python
# List users
users = admin.admin_auth.list_users(limit=50)

# Get user
user = admin.admin_auth.get_user('user-id')

# Create user
new_user = admin.admin_auth.create_user(
    email='admin@example.com',
    password='securePassword',
    data={'displayName': 'Admin User', 'role': 'admin'},
)

# Update user
admin.admin_auth.update_user('user-id', {
    'displayName': 'New Name',
    'role': 'moderator',
})

# Delete user
admin.admin_auth.delete_user('user-id')

# Set custom claims
admin.admin_auth.set_custom_claims('user-id', {'plan': 'pro', 'features': ['analytics', 'export']})

# Revoke all sessions
admin.admin_auth.revoke_all_sessions('user-id')
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
// List users
val users = admin.adminAuth.listUsers(limit = 50)

// Get user
val user = admin.adminAuth.getUser("user-id")

// Create user
val newUser = admin.adminAuth.createUser(mapOf(
    "email" to "admin@example.com",
    "password" to "securePassword",
    "displayName" to "Admin User",
    "role" to "admin",
))

// Update user
admin.adminAuth.updateUser("user-id", mapOf("displayName" to "New Name", "role" to "moderator"))

// Delete user
admin.adminAuth.deleteUser("user-id")

// Set custom claims
admin.adminAuth.setCustomClaims("user-id", mapOf("plan" to "pro"))

// Revoke all sessions
admin.adminAuth.revokeAllSessions("user-id")
```

</TabItem>

<TabItem value="java" label="Java">

```java
// List users
Map<String, Object> users = admin.adminAuth().listUsers(50, null);

// Get user
Map<String, Object> user = admin.adminAuth().getUser("user-id");

// Create user
Map<String, Object> newUser = admin.adminAuth().createUser(Map.of(
    "email", "admin@example.com",
    "password", "securePassword",
    "displayName", "Admin User",
    "role", "admin"
));

// Update user
admin.adminAuth().updateUser("user-id", Map.of("displayName", "New Name", "role", "moderator"));

// Delete user
admin.adminAuth().deleteUser("user-id");

// Set custom claims
admin.adminAuth().setCustomClaims("user-id", Map.of("plan", "pro"));

// Revoke all sessions
admin.adminAuth().revokeAllSessions("user-id");
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
// List users
val users = admin.adminAuth.listUsers(limit = Some(50))

// Get user
val user = admin.adminAuth.getUser("user-id")

// Create user
val newUser = admin.adminAuth.createUser(Map(
  "email" -> "admin@example.com",
  "password" -> "securePassword",
  "displayName" -> "Admin User",
  "role" -> "admin",
))

// Update user
admin.adminAuth.updateUser("user-id", Map("displayName" -> "New Name", "role" -> "moderator"))

// Delete user
admin.adminAuth.deleteUser("user-id")

// Set custom claims
admin.adminAuth.setCustomClaims("user-id", Map("plan" -> "pro", "features" -> List("analytics", "export")))

// Revoke all sessions
admin.adminAuth.revokeAllSessions("user-id")
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
using var admin = new EdgeBase.Admin.AdminClient(url, serviceKey);
// Use admin.AdminAuth for user management operations
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
# List users
users = admin.admin_auth.list_users(limit: 50)

# Get user
user = admin.admin_auth.get_user("user-id")

# Create user
new_user = admin.admin_auth.create_user(
  "admin@example.com",
  "securePassword"
)

# Update user
admin.admin_auth.update_user("user-id", {
  "displayName" => "New Name",
  "role" => "moderator"
})

# Delete user
admin.admin_auth.delete_user("user-id")

# Set custom claims
admin.admin_auth.set_custom_claims("user-id", {
  "plan" => "pro",
  "features" => ["analytics", "export"]
})

# Revoke all sessions
admin.admin_auth.revoke_all_sessions("user-id")
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
alias EdgeBaseAdmin.AdminAuth

auth = EdgeBaseAdmin.admin_auth(admin)

# List users
users = AdminAuth.list_users!(auth, limit: 50)

# Get user
user = AdminAuth.get_user!(auth, "user-id")

# Create user
new_user =
  AdminAuth.create_user!(auth, %{
    "email" => "admin@example.com",
    "password" => "securePassword",
    "displayName" => "Admin User",
    "role" => "admin"
  })

# Update user
AdminAuth.update_user!(auth, "user-id", %{"displayName" => "New Name", "role" => "moderator"})

# Delete user
AdminAuth.delete_user!(auth, "user-id")

# Set custom claims
AdminAuth.set_custom_claims!(auth, "user-id", %{"plan" => "pro", "features" => ["analytics", "export"]})

# Revoke all sessions
AdminAuth.revoke_all_sessions!(auth, "user-id")
```

</TabItem>
</Tabs>

## Custom Claims

Claims set via `setCustomClaims()` are included in the user's JWT under the `custom` namespace:

```json
{
  "sub": "user-id",
  "iss": "edgebase:user",
  "exp": 1234567890,
  "custom": {
    "plan": "pro",
    "features": ["analytics", "export"]
  }
}
```

Access in access rules: `read(auth) { return auth?.custom?.plan === 'pro' }`

## REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/admin/users` | `GET` | List users |
| `/api/auth/admin/users/:id` | `GET` | Get user |
| `/api/auth/admin/users` | `POST` | Create user |
| `/api/auth/admin/users/:id` | `PATCH` | Update user |
| `/api/auth/admin/users/:id` | `DELETE` | Delete user |
| `/api/auth/admin/users/:id/claims` | `PUT` | Set custom claims |
| `/api/auth/admin/users/:id/revoke` | `POST` | Revoke sessions |

All endpoints require the `X-EdgeBase-Service-Key` header.
