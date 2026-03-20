<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase Ruby SDK

Public Ruby support for EdgeBase is split into two gems:

- `edgebase_core`
  Low-level shared primitives such as the HTTP client, database references, storage helpers, and field-operation markers
- `edgebase_admin`
  Trusted server-side Ruby SDK for admin auth, service-key database access, raw SQL, storage, push, analytics, functions, and native edge resources

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Installation

Install the gem that matches your use case:

```bash
gem install edgebase_core
gem install edgebase_admin
```

If you use Bundler:

```ruby
gem "edgebase_core"
gem "edgebase_admin"
```

## Package Map

| Gem | Use it for |
| --- | --- |
| `edgebase_admin` | Trusted server-side Ruby code with a Service Key |
| `edgebase_core` | Low-level Ruby primitives for custom wrappers and internal integrations |

## Quick Start

### Admin

```ruby
require "edgebase_admin"

admin = EdgebaseAdmin::AdminClient.new(
  "https://your-project.edgebase.fun",
  service_key: ENV.fetch("EDGEBASE_SERVICE_KEY")
)

users = admin.admin_auth.list_users(limit: 20)
rows = admin.sql("shared", "SELECT 1 AS ok")

puts users.fetch("users", []).length
puts rows.length
```

### Core

```ruby
require "edgebase_core"

client = EdgebaseCore::HttpClient.new(
  "https://your-project.edgebase.fun",
  service_key: ENV.fetch("EDGEBASE_SERVICE_KEY")
)

storage = EdgebaseCore::StorageClient.new(client)
bucket = storage.bucket("avatars")

puts bucket.get_url("user-1.jpg")
```

## Package READMEs

- [edgebase_admin README](https://github.com/edge-base/edgebase/blob/main/packages/sdk/ruby/packages/admin/README.md)
- [edgebase_core README](https://github.com/edge-base/edgebase/blob/main/packages/sdk/ruby/packages/core/README.md)

## AI Assistant Notes

Each public gem ships with its own `llms.txt` file:

- [edgebase_admin llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/ruby/packages/admin/llms.txt)
- [edgebase_core llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/ruby/packages/core/llms.txt)

Use the package-specific file that matches the code you are writing instead of assuming one shared Ruby surface.

## Documentation

- [SDK Overview](https://edgebase.fun/docs/sdks)
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
- [Authentication / Admin Users](https://edgebase.fun/docs/authentication/admin-users)
- [Storage](https://edgebase.fun/docs/storage/upload-download)
- [Push Admin SDK](https://edgebase.fun/docs/push/admin-sdk)
- [Analytics Admin SDK](https://edgebase.fun/docs/analytics/admin-sdk)

## License

MIT
