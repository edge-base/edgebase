<!-- Generated from packages/sdk/csharp/packages/unity/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase Unity SDK

Use this file as a quick-reference contract for AI coding assistants working with `EdgeBase.Unity`.

## Package Boundary

Use `EdgeBase.Unity` for Unity apps on client-side runtimes.

Do not use this package for trusted server-side work that needs Service Key access, raw SQL admin flows, or backend-only privileges. Use `EdgeBase.Admin` for that.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/csharp/packages/unity/README.md
- SDK overview: https://edgebase.fun/docs/sdks
- Quickstart: https://edgebase.fun/docs/getting-started/quickstart
- Authentication: https://edgebase.fun/docs/authentication
- Database client SDK: https://edgebase.fun/docs/database/client-sdk
- Database subscriptions: https://edgebase.fun/docs/database/subscriptions
- Room client SDK: https://edgebase.fun/docs/room/client-sdk
- Functions client SDK: https://edgebase.fun/docs/functions/client-sdk
- Push client SDK: https://edgebase.fun/docs/push/client-sdk
- Analytics client SDK: https://edgebase.fun/docs/analytics/client-sdk

If docs, snippets, and assumptions disagree, prefer the current package API over guessed patterns from another runtime.

## Canonical Examples

### Create a client

```csharp
using EdgeBase;

var client = new EdgeBase.EdgeBase("https://your-project.edgebase.fun");
```

### Sign in and query data

```csharp
var user = await client.Auth.SignInAsync("june@example.com", "pass1234");

var posts = await client.Db("app")
    .Table("posts")
    .Where("published", "==", true)
    .GetListAsync();
```

### Join a room

```csharp
var room = client.Room("game", "lobby-1");
```

### Upload a file

```csharp
await client.Storage.Bucket("avatars").UploadAsync(
    "user123.png",
    System.IO.File.ReadAllBytes("avatar.png"),
    "image/png"
);
```

## Hard Rules

- keep client-only code in Unity and server-only code in `EdgeBase.Admin`
- `client.Db(namespace, instanceId?)` takes the instance id positionally
- `client.Room(namespaceName, roomId, ...)` is the Unity room entry point
- `client.Auth`, `client.Storage`, `client.Push`, `client.Functions`, and `client.Analytics` are the main surfaces
- `client.Destroy()` should be called when the client is no longer needed
- avoid copying browser-only assumptions like DOM access or `localStorage` into Unity code

## Common Mistakes

- do not use Service Key or admin-only APIs in this package
- do not pass instance ids as named objects; use `Db(namespace, instanceId?)`
- do not assume browser redirect behavior for Unity auth flows
- do not forget to dispose the client in long-lived scenes or teardown paths

## Quick Reference

```text
new EdgeBase.EdgeBase(baseUrl)              -> Unity client entry point
client.Auth                                 -> AuthClient
client.Db(namespace, instanceId?)           -> DbRef
client.Storage                              -> StorageClient
client.Push                                 -> PushClient
client.Functions                            -> FunctionsClient
client.Analytics                            -> AnalyticsClient
client.Room(namespaceName, roomId, ...)     -> RoomClient
client.SetContext(context)                  -> void
client.SetLocale(locale)                   -> void
client.Destroy()                           -> void
```
