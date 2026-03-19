# EdgeBase.Core

Low-level .NET primitives for EdgeBase.

`EdgeBase.Core` is the shared foundation used by `EdgeBase.Admin` and `EdgeBase.Unity`. It gives you the transport, table/query, storage, push, and field-operation building blocks without the higher-level package surface.

Most application code should install one of the higher-level packages instead:

- `EdgeBase.Admin` for trusted server-side code
- `EdgeBase.Unity` for Unity client apps

## Documentation Map

Use this README for the fast overview, then jump into the docs when you need depth:

- [SDK Overview](https://edgebase.fun/docs/sdks)
  Install commands and the full package matrix
- [Client SDK](https://edgebase.fun/docs/database/client-sdk)
  Query patterns and low-level database usage from client-facing SDKs
- [Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
  Trusted server-side database access and raw SQL
- [Storage Docs](https://edgebase.fun/docs/storage/upload-download)
  Uploads, downloads, metadata, and signed URLs
- [Push Client SDK](https://edgebase.fun/docs/push/client-sdk)
  Client-side push registration patterns and payload handling

## For AI Coding Assistants

This package includes an `llms.txt` file for AI-assisted development.

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/csharp/packages/core/llms.txt)
- in the packed NuGet artifact alongside the package contents

Use it when you want an agent or code assistant to:

- keep low-level code inside the core package
- use `JbHttpClient` as the shared transport
- prefer `TableRef`, `StorageClient`, and `FieldOps` over made-up wrappers
- avoid copying JavaScript or Dart SDK shapes into C#

## Installation

If you are working inside this repository, reference the project directly:

```xml
<ItemGroup>
  <ProjectReference Include="..\packages\sdk\csharp\packages\core\EdgeBase.Core.csproj" />
</ItemGroup>
```

The NuGet package id declared by the project is `dev.edgebase.core`.

## Quick Start

```csharp
using EdgeBase;
using EdgeBase.Generated;

var http = new JbHttpClient("https://your-project.edgebase.fun");

var storage = new StorageClient(http);
var bucket = storage.Bucket("avatars");
var publicUrl = bucket.GetUrl("user-1.jpg");

var api = new GeneratedDbApi(http);
var posts = new TableRef(api, "posts");
var result = await posts.Where("published", "==", true).GetListAsync();

var patch = FieldOps.Increment(1);
Console.WriteLine(publicUrl);
Console.WriteLine(result.Total);
```

## Included Surfaces

- `JbHttpClient`
- `TableRef`, `ListResult`, and `DbChange`
- `StorageClient`, `StorageBucket`, `FileListResult`, and `SignedUrlResult`
- `PushClient`
- `FieldOps`
- `EdgeBaseException`
- `GeneratedDbApi`

## Building On Top Of Core

This package is useful when you want to:

- write custom wrappers on top of the EdgeBase transport
- reuse the shared storage and table primitives in your own SDKs
- keep generated code separate from higher-level app entry points
- work with low-level helpers in trusted server or client code

## Choose The Right Package

| Package | Use it for |
| --- | --- |
| `EdgeBase.Admin` | Trusted server-side code with Service Key access |
| `EdgeBase.Unity` | Unity client apps with auth, database, rooms, storage, and push |
| `EdgeBase.Core` | Low-level primitives and custom integrations |

## License

MIT
