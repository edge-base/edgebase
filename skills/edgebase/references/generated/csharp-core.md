<!-- Generated from packages/sdk/csharp/packages/core/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase C# Core SDK

Use this file as a quick-reference contract for AI coding assistants working with `EdgeBase.Core`.

## Package Boundary

Use `EdgeBase.Core` for low-level EdgeBase building blocks.

This package is shared infrastructure for `EdgeBase.Admin` and `EdgeBase.Unity`. Most app code should install one of those higher-level packages instead of using `EdgeBase.Core` directly.

`EdgeBase.Core` does not provide the full admin or Unity entry points.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/csharp/packages/core/README.md
- SDK overview: https://edgebase.fun/docs/sdks
- Client SDK: https://edgebase.fun/docs/database/client-sdk
- Admin SDK: https://edgebase.fun/docs/database/admin-sdk
- Storage docs: https://edgebase.fun/docs/storage/upload-download
- Push client SDK: https://edgebase.fun/docs/push/client-sdk

If docs, snippets, and assumptions disagree, prefer the current package API over guessed patterns from another runtime.

## Canonical Examples

### Build a shared HTTP client

```csharp
using EdgeBase;

var http = new JbHttpClient("https://your-project.edgebase.fun");
```

### Work with storage directly

```csharp
var storage = new StorageClient(http);
var bucket = storage.Bucket("avatars");
var url = bucket.GetUrl("user-1.jpg");
```

### Query a table with generated APIs

```csharp
using EdgeBase.Generated;

var api = new GeneratedDbApi(http);
var posts = new TableRef(api, "posts");
var rows = await posts.Where("published", "==", true).GetListAsync();
```

### Use atomic field operations

```csharp
await posts.UpdateAsync("post-1", new Dictionary<string, object?>
{
    ["views"] = FieldOps.Increment(1),
    ["legacyField"] = FieldOps.DeleteField(),
});
```

## Hard Rules

- do not expect `EdgeBase.Admin` or `EdgeBase.Unity` entry points here
- use `JbHttpClient` as the shared transport
- `TableRef` is built on top of `GeneratedDbApi`
- prefer `FieldOps.Increment()` and `FieldOps.DeleteField()` for atomic field updates
- avoid copying JavaScript, Dart, or Unity-only SDK shapes into C#

## Common Mistakes

- do not invent a top-level `AdminClient` or `EdgeBase` wrapper in this package
- do not assume browser-only APIs or Unity-only lifecycle hooks live here
- do not treat the generated API wrappers as stable hand-written abstractions
- do not pass instance ids as named objects when the package expects positional arguments in higher-level SDKs

## Quick Reference

```text
JbHttpClient(baseUrl)                        -> shared HTTP transport
GeneratedDbApi(http)                         -> generated database API wrapper
TableRef(api, tableName)                     -> query and mutation builder
StorageClient(http)                          -> storage client
FieldOps.Increment(value)                    -> atomic increment marker
FieldOps.DeleteField()                       -> atomic delete marker
PushClient(http)                             -> push helper
EdgeBaseException(statusCode, body, ex?)      -> package exception type
```
