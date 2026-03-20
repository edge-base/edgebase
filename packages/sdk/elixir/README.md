<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase Elixir SDK

Public Elixir support for EdgeBase is split into two Hex packages:

- `edgebase_core`
  Low-level shared primitives such as the HTTP client, DB references, storage helpers, and field-operation markers
- `edgebase_admin`
  Trusted server-side Elixir SDK for admin auth, service-key database access, raw SQL, storage, push, analytics, functions, and native edge resources

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Installation

Add the package that matches your use case to `deps/0`:

```elixir
{:edgebase_core, "~> 0.1.4"}
{:edgebase_admin, "~> 0.1.4"}
```

Then fetch dependencies:

```bash
mix deps.get
```

## Package Map

| Package | Use it for |
| --- | --- |
| `edgebase_admin` | Trusted server-side Elixir code with a Service Key |
| `edgebase_core` | Low-level Elixir primitives for custom wrappers and internal integrations |

## Quick Start

### Admin

```elixir
admin = EdgeBaseAdmin.new(
  "https://your-project.edgebase.fun",
  service_key: System.fetch_env!("EDGEBASE_SERVICE_KEY")
)

auth = EdgeBaseAdmin.admin_auth(admin)
{:ok, users} = EdgeBaseAdmin.AdminAuth.list_users(auth, limit: 20)
{:ok, rows} = EdgeBaseAdmin.sql(admin, "SELECT 1 AS ok", namespace: "shared")

IO.inspect(length(users["users"] || []))
IO.inspect(rows)
```

### Core

```elixir
client =
  EdgeBaseCore.new_http_client(
    "https://your-project.edgebase.fun",
    service_key: System.fetch_env!("EDGEBASE_SERVICE_KEY")
  )

storage = EdgeBaseCore.StorageClient.new(client)
bucket = EdgeBaseCore.StorageClient.bucket(storage, "avatars")

{:ok, url} = EdgeBaseCore.StorageBucket.get_url(bucket, "user-1.jpg")
IO.inspect(url)
```

## Package READMEs

- [edgebase_admin README](https://github.com/edge-base/edgebase/blob/main/packages/sdk/elixir/packages/admin/README.md)
- [edgebase_core README](https://github.com/edge-base/edgebase/blob/main/packages/sdk/elixir/packages/core/README.md)

## AI Assistant Notes

Each public Hex package ships with its own `llms.txt` file:

- [edgebase_admin llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/elixir/packages/admin/llms.txt)
- [edgebase_core llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/elixir/packages/core/llms.txt)

Use the package-specific file that matches the code you are writing instead of assuming one shared Elixir surface.

## Documentation

- [SDK Overview](https://edgebase.fun/docs/sdks)
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
- [Authentication / Admin Users](https://edgebase.fun/docs/authentication/admin-users)
- [Storage](https://edgebase.fun/docs/storage/upload-download)
- [Push Admin SDK](https://edgebase.fun/docs/push/admin-sdk)
- [Analytics Admin SDK](https://edgebase.fun/docs/analytics/admin-sdk)
- [Native Resources](https://edgebase.fun/docs/server/native-resources)

## License

MIT
