# EdgeBase.Admin

Trusted server-side .NET SDK for EdgeBase.

Use `EdgeBase.Admin` from backend APIs, jobs, workers, and other trusted environments that hold a Service Key. It exposes admin auth, service-key database access, raw SQL, storage, push, functions, analytics, KV, D1, and Vectorize clients.

## Documentation Map

Use this README for the fast overview, then jump into the docs when you need depth:

- [SDK Overview](https://edgebase.fun/docs/sdks)
  Install commands and language matrix for all public SDKs
- [Admin SDK](https://edgebase.fun/docs/sdks/client-vs-server)
  Service-key concepts, trust boundaries, and admin-only capabilities
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
  Cross-language auth, database, storage, functions, push, and analytics examples
- [Admin User Management](https://edgebase.fun/docs/authentication/admin-users)
  Create, update, delete, and manage users with the Service Key
- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
  Table queries, filters, pagination, batch writes, and raw SQL
- [Storage](https://edgebase.fun/docs/storage/upload-download)
  Uploads, downloads, metadata, and signed URLs
- [Push Admin SDK](https://edgebase.fun/docs/push/admin-sdk)
  Push send, topic broadcast, token inspection, and logs
- [Analytics Admin SDK](https://edgebase.fun/docs/analytics/admin-sdk)
  Request metrics, event tracking, and event queries
- [Native Resources](https://edgebase.fun/docs/server/native-resources)
  KV, D1, Vectorize, and other edge-native resources

## For AI Coding Assistants

This package includes an `llms.txt` file for AI-assisted development.

Use it when you want an agent or code assistant to:

- keep Service Key logic on the server
- use `AdminAuth`, not `adminAuth`
- use the real C# `SqlAsync(namespaceName, query, parameters?)` signature
- remember that `namespaceName` may encode an instance id as `namespace:id`
- avoid copying JavaScript or Dart admin API shapes into C#

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/csharp/packages/admin/llms.txt)
- in the packed NuGet artifact alongside the package contents

## Installation

If you are working inside this repository, reference the project directly:

```xml
<ItemGroup>
  <ProjectReference Include="..\packages\sdk\csharp\packages\admin\EdgeBase.Admin.csproj" />
</ItemGroup>
```

The NuGet package id declared by the project is `dev.edgebase.admin`.

## Quick Start

```csharp
using EdgeBase.Admin;

var serviceKey = Environment.GetEnvironmentVariable("EDGEBASE_SERVICE_KEY")!;
using var admin = new AdminClient("https://your-project.edgebase.fun", serviceKey);

var users = await admin.AdminAuth.ListUsersAsync(limit: 20);
var created = await admin.AdminAuth.CreateUserAsync(
    "admin@example.com",
    "secure-pass-123",
    displayName: "June",
    role: "moderator"
);

var rows = await admin.SqlAsync("shared", "SELECT 1 AS ok");
await admin.BroadcastAsync("chat", "message", new { text = "hello" });

Console.WriteLine(users.Users.Count);
Console.WriteLine(created["id"]);
Console.WriteLine(rows.Count);
```

## Core API

Once you create an admin client, these are the main surfaces you will use:

- `new AdminClient(url, serviceKey)`
  Main server-side entry point
- `admin.AdminAuth`
  Admin user management
- `admin.Storage`
  Server-side storage access
- `admin.Push`
  Send push notifications
- `admin.Functions`
  Call app functions from trusted code
- `admin.Analytics`
  Query analytics and track server-side events
- `admin.Db(namespace, instanceId?)`
  Service-key database access
- `admin.SqlAsync(namespaceName, query, parameters?)`
  Raw SQL execution
- `admin.BroadcastAsync(channel, eventName, payload?)`
  Server-side database-live broadcast
- `admin.Kv(namespace)`, `admin.D1(database)`, `admin.Vector(index)`
  Access platform resources from trusted code

## Database Access

```csharp
using EdgeBase.Admin;

using var admin = new AdminClient(baseUrl, serviceKey);

var posts = admin.Db("app").Table("posts");
var result = await posts.GetListAsync();
```

For instance databases, pass the instance id explicitly:

```csharp
admin.Db("workspace", "ws-123");
admin.Db("user", "user-123");
```

For raw SQL, the namespace name can also encode an instance id:

```csharp
var rows = await admin.SqlAsync("workspace:ws-123", "SELECT * FROM documents");
```

Read more: [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)

## Admin Auth

```csharp
var created = await admin.AdminAuth.CreateUserAsync(
    "june@example.com",
    "secure-pass-123",
    displayName: "June"
);

await admin.AdminAuth.SetCustomClaimsAsync(
    created["id"]!.ToString()!,
    new Dictionary<string, object?> { ["role"] = "moderator" }
);

var usersPage = await admin.AdminAuth.ListUsersAsync(limit: 20);
Console.WriteLine(usersPage.Users.Count);
```

Read more: [Admin User Management](https://edgebase.fun/docs/authentication/admin-users)

## Raw SQL

`SqlAsync` supports the C# signature that ships in the package:

```csharp
await admin.SqlAsync("shared", "SELECT 1 AS ok");

await admin.SqlAsync(
    "workspace:ws-123",
    "SELECT * FROM documents WHERE status = ?",
    new object[] { "published" }
);
```

## Push And Analytics

```csharp
await admin.BroadcastAsync("announcements", "system:update", new { status = "deployed" });

var overview = await admin.Analytics.OverviewAsync(new Dictionary<string, string> { ["range"] = "7d" });
Console.WriteLine(overview);
```

Read more:

- [Push Admin SDK](https://edgebase.fun/docs/push/admin-sdk)
- [Analytics Admin SDK](https://edgebase.fun/docs/analytics/admin-sdk)

## Native Resource Access

```csharp
await admin.Kv("cache").SetAsync("homepage", "warm", ttl: 60);

var rows = await admin.D1("analytics").ExecAsync(
    "SELECT * FROM events WHERE type = ?",
    new object[] { "click" }
);

Console.WriteLine(rows.Count);
```

## Choose The Right Package

| Package | Use it for |
| --- | --- |
| `EdgeBase.Admin` | Trusted server-side code with Service Key access |

## License

MIT
