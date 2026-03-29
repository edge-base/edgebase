<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase Elixir Core SDK

Shared low-level Elixir primitives for EdgeBase.

`edgebase_core` is the foundation used by `edgebase_admin`. It provides the HTTP client, DB and document references, table query helpers, storage helpers, field operation markers, and the shared error type used by higher-level SDKs.

Most application code should install [`edgebase_admin`](https://hex.pm/packages/edgebase_admin) instead. Use this package directly when you are building custom wrappers, generated bindings, or internal integrations.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Documentation Map

Use this README for the fast overview, then jump into the docs when you need depth:

- [SDK Overview](https://edgebase.fun/docs/sdks)
  Install commands and the public SDK matrix
- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
  Table queries, filters, pagination, batch writes, and raw SQL
- [Storage](https://edgebase.fun/docs/storage/upload-download)
  Uploads, downloads, metadata, and signed URLs
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
  Cross-language examples that sit on top of this core package

## For AI Coding Assistants

This package includes an `llms.txt` file for AI-assisted development.

Use it when you want an agent or code assistant to:

- keep Service Keys on the server
- use the actual Elixir function names
- distinguish between non-bang functions that return `{:ok, ...}` and bang functions that raise on error
- avoid copying promise-based examples into Elixir

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/elixir/packages/core/llms.txt)
- in your environment after install, inside the `EdgeBaseCore` package directory as `llms.txt`

## Installation

```elixir
{:edgebase_core, "~> 0.2.7"}
```

If you consume the monorepo directly, use the path dependency already configured in this repository.

## Quick Start

```elixir
client =
  EdgeBaseCore.new_http_client(
    "https://your-project.edgebase.fun",
    service_key: System.fetch_env!("EDGEBASE_SERVICE_KEY")
  )

db = EdgeBaseCore.DbRef.new(client, "shared")
posts = EdgeBaseCore.DbRef.table(db, "posts")
{:ok, rows} = EdgeBaseCore.TableRef.get_list(posts)

storage = EdgeBaseCore.StorageClient.new(client)
bucket = EdgeBaseCore.StorageClient.bucket(storage, "avatars")
{:ok, _} = EdgeBaseCore.StorageBucket.upload(bucket, "user-1.jpg", "binary-data", content_type: "image/jpeg")

marker = EdgeBaseCore.FieldOps.increment(1)
```

## Included Surfaces

- `EdgeBaseCore.new_http_client/2`
- `EdgeBaseCore.HttpClient`
- `EdgeBaseCore.DbRef`, `EdgeBaseCore.DocRef`, `EdgeBaseCore.TableRef`
- `EdgeBaseCore.StorageClient`, `EdgeBaseCore.StorageBucket`
- `EdgeBaseCore.FieldOps.increment/1` and `delete_field/0`
- `EdgeBaseCore.Error`

## Choose The Right Package

| Package | Use it for |
| --- | --- |
| `edgebase_core` | Low-level Elixir primitives for custom wrappers and internal integrations |
| `edgebase_admin` | Trusted server-side Elixir code with Service Key access |

## License

MIT
