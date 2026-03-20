<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase C# SDK

Public C# support for EdgeBase is split into three packages:

- `dev.edgebase.unity`
  Unity client SDK for auth, database, rooms, storage, functions, analytics, and push
- `dev.edgebase.admin`
  Trusted server-side .NET SDK for admin auth, service-key database access, raw SQL, storage, push, functions, analytics, KV, D1, and Vectorize
- `dev.edgebase.core`
  Low-level shared primitives used by the Unity and admin packages

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Package Map

| Package | Use it for |
| --- | --- |
| `EdgeBase.Unity` | Unity client apps |
| `EdgeBase.Admin` | Trusted server-side .NET code |
| `EdgeBase.Core` | Low-level primitives and custom integrations |

## Installation

Install the package that matches your runtime:

```bash
dotnet add package dev.edgebase.unity
dotnet add package dev.edgebase.admin
dotnet add package dev.edgebase.core
```

If you are working inside this repository, you can reference the projects directly instead:

```xml
<ItemGroup>
  <ProjectReference Include="..\packages\sdk\csharp\packages\unity\EdgeBase.Unity.csproj" />
  <ProjectReference Include="..\packages\sdk\csharp\packages\admin\EdgeBase.Admin.csproj" />
  <ProjectReference Include="..\packages\sdk\csharp\packages\core\EdgeBase.Core.csproj" />
</ItemGroup>
```

For Unity projects, you can also copy the C# source or compiled assemblies under `Assets/Plugins`.

## Quick Start

### Unity Client

```csharp
using EdgeBase;

using var client = new EdgeBase("https://your-project.edgebase.fun");

var user = await client.Auth.SignInAsync("june@example.com", "pass1234");
var posts = await client.Db("app")
    .Table("posts")
    .Where("published", "==", true)
    .GetListAsync();

var room = client.Room("game", "lobby-1");

Console.WriteLine(user["accessToken"]);
Console.WriteLine(posts.Total);
```

### Admin

```csharp
using EdgeBase.Admin;

using var admin = new AdminClient(
    "https://your-project.edgebase.fun",
    Environment.GetEnvironmentVariable("EDGEBASE_SERVICE_KEY")!
);

var users = await admin.AdminAuth.ListUsersAsync(limit: 20);
var rows = await admin.SqlAsync("shared", "SELECT 1 AS ok");

Console.WriteLine(users.Users.Count);
Console.WriteLine(rows.Count);
```

### Core

```csharp
using EdgeBase;
using EdgeBase.Generated;

var http = new JbHttpClient("https://your-project.edgebase.fun");
var storage = new StorageClient(http);
var posts = new TableRef(new GeneratedDbApi(http), "posts");

Console.WriteLine(storage.Bucket("avatars").GetUrl("user-1.jpg"));
Console.WriteLine(posts.Name);
```

## Package READMEs

- [EdgeBase.Unity](https://github.com/edge-base/edgebase/blob/main/packages/sdk/csharp/packages/unity/README.md)
- [EdgeBase.Admin](https://github.com/edge-base/edgebase/blob/main/packages/sdk/csharp/packages/admin/README.md)
- [EdgeBase.Core](https://github.com/edge-base/edgebase/blob/main/packages/sdk/csharp/packages/core/README.md)

## AI Assistant Notes

Each public package ships with its own `llms.txt` file:

- [EdgeBase.Unity llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/csharp/packages/unity/llms.txt)
- [EdgeBase.Admin llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/csharp/packages/admin/llms.txt)
- [EdgeBase.Core llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/csharp/packages/core/llms.txt)

Use the package-specific file that matches the code you are writing instead of assuming one shared C# surface.

## Documentation

- [SDK Overview](https://edgebase.fun/docs/sdks)
- [Database Client SDK](https://edgebase.fun/docs/database/client-sdk)
- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
- [Authentication](https://edgebase.fun/docs/authentication)
- [Storage](https://edgebase.fun/docs/storage/upload-download)
- [Room Client SDK](https://edgebase.fun/docs/room/client-sdk)
- [Functions Client SDK](https://edgebase.fun/docs/functions/client-sdk)
- [Push Admin SDK](https://edgebase.fun/docs/push/admin-sdk)
- [Analytics Admin SDK](https://edgebase.fun/docs/analytics/admin-sdk)

## License

MIT
