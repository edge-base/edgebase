<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase.Unity

Client SDK for Unity.

`EdgeBase.Unity` brings EdgeBase auth, database, realtime, rooms, storage, functions, analytics, and push to Unity projects. It is designed for client-side app code, not trusted server or admin tasks.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Requirements

- Unity 2021.3 LTS or newer
- .NET Standard 2.1
- IL2CPP and Mono

## Documentation Map

Use this README for the fast overview, then jump into the docs when you need depth:

- [SDK Overview](https://edgebase.fun/docs/sdks)
  Install commands and the full package matrix
- [Quickstart](https://edgebase.fun/docs/getting-started/quickstart)
  Project creation and local development
- [Authentication](https://edgebase.fun/docs/authentication)
  Email/password, OAuth, MFA, sessions, and captcha
- [Database Client SDK](https://edgebase.fun/docs/database/client-sdk)
  Query and mutation patterns for client-side data access
- [Database Subscriptions](https://edgebase.fun/docs/database/subscriptions)
  Live change listeners and realtime database patterns
- [Room Client SDK](https://edgebase.fun/docs/room/client-sdk)
  Presence, room state, signals, and session flows
- [Functions Client SDK](https://edgebase.fun/docs/functions/client-sdk)
  Calling EdgeBase functions from client code
- [Analytics Client SDK](https://edgebase.fun/docs/analytics/client-sdk)
  Client-side event tracking
- [Push Client SDK](https://edgebase.fun/docs/push/client-sdk)
  Push registration and message handling

## For AI Coding Assistants

This package includes an `llms.txt` file for AI-assisted development.

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/csharp/packages/unity/llms.txt)
- in the packed NuGet artifact alongside the package contents

Use it when you want an agent or code assistant to:

- keep client-only code in Unity and server-only code in `EdgeBase.Admin`
- use `Db(namespace, instanceId?)` with positional instance ids
- remember that `Room(namespaceName, roomId, ...)` is the Unity room entry point
- avoid copying browser assumptions into Unity code

## Installation

If you are working inside this repository, reference the project directly:

```xml
<ItemGroup>
  <ProjectReference Include="..\packages\sdk\csharp\packages\unity\EdgeBase.Unity.csproj" />
</ItemGroup>
```

The NuGet package id is `dev.edgebase.unity`. The package includes the managed
assembly, `Assets/EdgeBase/Runtime/TurnstileAdapters.cs`, and the Android, iOS,
and WebGL native bridge assets under `Assets/Plugins`. Keep those content files
when importing the package; authentication can fail closed when CAPTCHA is
enabled if only the DLL is copied.

If you are importing the SDK into a Unity project directly, place the package source or compiled assembly under your `Assets/Plugins` path as appropriate.

## Quick Start

```csharp
using EdgeBase;

var client = new EdgeBase.EdgeBase("https://your-project.edgebase.fun");

var user = await client.Auth.SignInAsync("june@example.com", "pass1234");
var posts = await client.Db("app")
    .Table("posts")
    .Where("published", "==", true)
    .GetListAsync();

await client.Storage.Bucket("avatars").UploadAsync(
    "user123.png",
    System.IO.File.ReadAllBytes("avatar.png"),
    "image/png"
);

var room = client.Room("game", "lobby-1");
Console.WriteLine(user["accessToken"]);
Console.WriteLine(posts.Total);
```

## Token Persistence And Restore

The default `MemoryAuthTokenStorage` is process-only. Inject an
`IDurableAuthTokenStorage` backed by the platform's secure storage when sessions
must survive restart, then restore before authenticated work:

```csharp
var client = new EdgeBase.EdgeBase(baseUrl, secureDurableTokenStorage);
var restored = await client.TryRestoreSessionAsync();
```

The durable implementation must atomically save the complete `AuthTokenPair`,
survive process termination, and report failures. Anonymous
`LinkWithEmailAsync` and `VerifyLinkPhoneAsync` fail before the network without
that capability (unless the current JWT is known to be non-anonymous). New auth
state is exposed only after persistence succeeds; incomplete stored pairs are
rejected.

Configured native/WebGL CAPTCHA failures throw `CaptchaUnavailableException`
with code `captcha-unavailable`. Positive site keys are cached for five minutes;
missing keys are not cached. Only direct WebGL `challenge_error` receives one
fresh-key retry, and each widget/overlay is cleaned up. Config transport or
malformed-response failures are typed; only an explicit `captcha: null`
response is treated as disabled.

## Core API

Once you create a client, these are the main surfaces you will use:

- `new EdgeBase.EdgeBase(baseUrl)`
  Main Unity client entry point
- `client.Auth`
  Sign up, sign in, sign out, OAuth, MFA, and auth state
- `client.Db(namespace, instanceId?)`
  Query tables and mutate records
- `client.Storage`
  Upload files and resolve URLs
- `client.Push`
  Register device tokens and listen for push messages
- `client.Functions`
  Call app functions from client code
- `client.Analytics`
  Track client analytics
- `client.Room(namespaceName, roomId, ...)`
  Join realtime rooms for presence and state flows
- `client.SetContext(...)`, `client.GetContext()`, `client.SetLocale(...)`, `client.GetLocale()`
  Request context and locale helpers
- `client.Destroy()`
  Close network resources when the client is no longer needed
- `client.TryRestoreSessionAsync()`
  Restore a complete persisted auth pair before authenticated work

## Choose The Right Package

| Package | Use it for |
| --- | --- |
| `EdgeBase.Unity` | Unity client apps with auth, database, rooms, storage, functions, analytics, and push |
| `EdgeBase.Admin` | Trusted server-side code with Service Key access |
| `EdgeBase.Core` | Low-level primitives and custom integrations |

## License

MIT
