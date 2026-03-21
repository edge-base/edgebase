<!-- Generated from packages/sdk/csharp/packages/admin/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase C# Admin SDK

Use this file as a quick-reference contract for AI coding assistants working with `EdgeBase.Admin`.

## Package Boundary

Use `EdgeBase.Admin` in trusted server-side environments only.

Do not ship this package to browsers or untrusted clients. If code runs in a browser, use the client SDK instead.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/csharp/packages/admin/README.md
- Database Admin SDK: https://edgebase.fun/docs/database/admin-sdk
- Admin users: https://edgebase.fun/docs/authentication/admin-users
- Push Admin SDK: https://edgebase.fun/docs/push/admin-sdk
- Analytics Admin SDK: https://edgebase.fun/docs/analytics/admin-sdk
- Admin SDK reference: https://edgebase.fun/docs/admin-sdk/reference

## Canonical Examples

### Create an admin client

```csharp
using EdgeBase.Admin;

var admin = new AdminClient(
    "https://your-project.edgebase.fun",
    Environment.GetEnvironmentVariable("EDGEBASE_SERVICE_KEY")!
);
```

### Query a table

```csharp
var posts = admin.Db("app").Table("posts");
var rows = await posts.GetListAsync();
```

### Query an instance database

```csharp
var docs = admin.Db("workspace", "ws-1").Table("documents");
var rows = await docs.GetListAsync();
```

### Manage users

```csharp
var created = await admin.AdminAuth.CreateUserAsync(
    "june@example.com",
    "pass1234",
    displayName: "June"
);

await admin.AdminAuth.SetCustomClaimsAsync(
    created["id"]!.ToString()!,
    new Dictionary<string, object?> { ["role"] = "moderator" }
);
```

### Execute SQL

```csharp
var sharedRows = await admin.SqlAsync("shared", "SELECT 1 AS ok");

var rows = await admin.SqlAsync(
    "workspace:ws-1",
    "SELECT * FROM documents WHERE status = ?",
    new object[] { "published" }
);
```

### Send push and query analytics

```csharp
await admin.BroadcastAsync("chat", "message", new { text = "hello" });

var overview = await admin.Analytics.OverviewAsync(new Dictionary<string, string> { ["range"] = "7d" });
```

## Hard Rules

- keep Service Keys on trusted servers only
- use `AdminAuth`, not `adminAuth`
- `SqlAsync(namespaceName, query, parameters?)` is the real C# SQL signature
- `namespaceName` may encode an instance id as `namespace:id`
- `admin.Db(namespace, instanceId?)` takes the instance id separately from SQL
- `admin.AdminAuth.UpdateUserAsync(userId, data)` expects a dictionary of updates
- `admin.BroadcastAsync(channel, eventName, payload?)` is server-side broadcast
- `admin.Kv(namespace)`, `admin.D1(database)`, and `admin.Vector(index)` expose trusted infra clients

## Common Mistakes

- do not use `adminAuth` as if it were the C# API surface; use `AdminAuth`
- do not copy JavaScript or Dart SQL examples into C# without changing the signature
- do not pass instance ids as anonymous objects; use `Db(namespace, instanceId)` or `namespace:id` for SQL
- do not expose the Service Key through client-side code

## Quick Reference

```text
new AdminClient(url, serviceKey)                      -> AdminClient
admin.AdminAuth                                       -> AdminAuthClient
admin.AdminAuth.ListUsersAsync(limit?, cursor?)       -> Task<ListUsersResult>
admin.AdminAuth.CreateUserAsync(email, password, ...) -> Task<Dictionary<string, object?>>
admin.AdminAuth.UpdateUserAsync(userId, data)         -> Task<Dictionary<string, object?>>
admin.AdminAuth.DeleteUserAsync(userId)               -> Task<Dictionary<string, object?>>
admin.AdminAuth.SetCustomClaimsAsync(userId, claims)  -> Task<Dictionary<string, object?>>
admin.AdminAuth.RevokeAllSessionsAsync(userId)        -> Task<Dictionary<string, object?>>
admin.Db(namespace, instanceId?)                      -> DbRef
admin.SqlAsync(namespaceName, query, parameters?)     -> Task<List<Dictionary<string, object?>>>
admin.BroadcastAsync(channel, eventName, payload?)    -> Task<Dictionary<string, object?>>
admin.Kv(namespace)                                   -> KvClient
admin.D1(database)                                    -> D1Client
admin.Vector(index)                                   -> VectorizeClient
```
