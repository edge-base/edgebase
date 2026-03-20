<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# edgebase_core

Shared low-level Ruby primitives for EdgeBase.

`edgebase_core` is the foundation used by `edgebase_admin`. It provides the HTTP client, table query builder, storage helpers, field operation markers, error types, DB references, and document references used by higher-level SDKs.

Most application code should install [`edgebase_admin`](https://rubygems.org/gems/edgebase_admin) instead. Use this package directly when you are building custom wrappers, generated bindings, or internal integrations.

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
- use the actual Ruby class and method names
- avoid copying JavaScript promise-based examples into Ruby
- remember which surfaces are low-level helpers versus admin-only clients

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/ruby/packages/core/llms.txt)
- in your environment after install, inside the `edgebase_core` package directory as `llms.txt`

## Installation

If you are working inside this repository, reference the package directly through Bundler path dependencies.

## Quick Start

```ruby
require "edgebase_core"

client = EdgebaseCore::HttpClient.new(
  "https://your-project.edgebase.fun",
  service_key: ENV.fetch("EDGEBASE_SERVICE_KEY")
)

storage = EdgebaseCore::StorageClient.new(client)
bucket = storage.bucket("avatars")
bucket.upload("user-1.jpg", "binary-data", content_type: "image/jpeg")

marker = EdgebaseCore::FieldOps.increment(1)
```

## Included Surfaces

- `EdgebaseCore::HttpClient`
- `EdgebaseCore::DbRef`, `EdgebaseCore::DocRef`, `EdgebaseCore::TableRef`
- `EdgebaseCore::StorageClient`, `EdgebaseCore::StorageBucket`
- `EdgebaseCore::FieldOps.increment()` and `EdgebaseCore::FieldOps.delete_field`
- `EdgebaseCore::ListResult`, `EdgebaseCore::BatchResult`, `EdgebaseCore::UpsertResult`
- `EdgebaseCore::EdgeBaseError`

## Choose The Right Package

| Package | Use it for |
| --- | --- |
| `edgebase_core` | Low-level Ruby primitives for custom wrappers and internal integrations |
| `edgebase_admin` | Trusted server-side code with Service Key access |

## License

MIT
