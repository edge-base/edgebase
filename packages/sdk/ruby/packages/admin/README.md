<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase Ruby Admin SDK

Trusted server-side Ruby SDK for EdgeBase.

Use `edgebase_admin` from backend apps, scripts, cron jobs, and other trusted Ruby runtimes that hold a Service Key. It exposes admin auth, database access, raw SQL, storage, push, analytics, functions, and native edge resources.

Ruby uses a synchronous, object-oriented API. Most methods return values directly rather than promises or futures.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Documentation Map

Use this README for a fast overview, then jump into the docs when you need depth:

- [SDK Overview](https://edgebase.fun/docs/sdks)
  Install commands and the public SDK matrix
- [Admin SDK](https://edgebase.fun/docs/sdks/client-vs-server)
  Trusted-server boundaries and admin-only capabilities
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
  Cross-language examples for auth, database, storage, functions, push, and analytics
- [Admin User Management](https://edgebase.fun/docs/authentication/admin-users)
  Create, update, delete, and manage users with a Service Key
- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
  Table queries, filters, pagination, batch writes, and raw SQL
- [Storage](https://edgebase.fun/docs/storage/upload-download)
  Uploads, downloads, metadata, and signed URLs
- [Analytics Admin SDK](https://edgebase.fun/docs/analytics/admin-sdk)
  Request metrics, event tracking, and event queries
- [Push Admin SDK](https://edgebase.fun/docs/push/admin-sdk)
  Push send, topic broadcast, token inspection, and logs
- [Native Resources](https://edgebase.fun/docs/server/native-resources)
  KV, D1, Vectorize, and other trusted edge-native resources

## For AI Coding Assistants

This package includes an `llms.txt` file for AI-assisted development.

Use it when you want an agent or code assistant to:

- keep Service Keys on trusted servers
- use the real Ruby method names and keyword arguments
- avoid copying JS promise-based examples into Ruby
- know when to use `admin_auth` versus the `auth` alias

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/ruby/packages/admin/llms.txt)
- in your environment after install, inside the `edgebase_admin` package directory as `llms.txt`

## Installation

```bash
gem install edgebase_admin
```

If you use Bundler, add `edgebase_admin` to your Gemfile and run `bundle install`.

## Quick Start

```ruby
require "edgebase_admin"

admin = EdgebaseAdmin::AdminClient.new(
  "https://your-project.edgebase.fun",
  service_key: ENV.fetch("EDGEBASE_SERVICE_KEY")
)

users = admin.admin_auth.list_users(limit: 20)

rows = admin.sql(
  "shared",
  "SELECT id, title FROM posts WHERE status = ?",
  ["published"]
)

bucket = admin.storage.bucket("avatars")
bucket.upload("user-1.jpg", "binary-data", content_type: "image/jpeg")

admin.push.send("user-1", {
  "title" => "Deployment finished",
  "body" => "Your content is live."
})
```

## Core API

Once you create an admin client, these are the main surfaces you will use:

- `admin.db(namespace = "shared", instance_id = nil)`
  Server-side database access
- `admin.admin_auth`
  Admin user management
- `admin.auth`
  Alias for `admin.admin_auth`
- `admin.sql(namespace = "shared", query, params = nil, instance_id: nil)`
  Raw SQL execution
- `admin.storage`
  Server-side storage access
- `admin.functions`
  Call app functions from trusted code
- `admin.push`
  Send push notifications
- `admin.analytics`
  Query analytics and track server-side events
- `admin.kv(namespace)`, `admin.d1(database)`, `admin.vector(index)`
  Access platform resources from trusted code
- `admin.broadcast(channel, event, payload = {})`
  Server-side database-live broadcast
- `admin.destroy`
  No-op cleanup hook

## Database Access

```ruby
posts = admin.db("app").table("posts")
rows = posts.where("status", "==", "published").get
```

For instance databases, pass the instance id as the second argument:

```ruby
admin.db("workspace", "ws-123")
admin.db("user", "user-123")
```

## Admin Users

```ruby
created = admin.admin_auth.create_user(
  email: "admin@example.com",
  password: "secure-pass-123",
  data: { "displayName" => "June" }
)

admin.admin_auth.set_custom_claims(created["id"], {
  "role" => "moderator"
})

users = admin.admin_auth.list_users(limit: 20)
```

## Raw SQL

```ruby
shared_rows = admin.sql(
  "shared",
  "SELECT 1 AS ok"
)

workspace_rows = admin.sql(
  "workspace",
  "SELECT * FROM documents WHERE status = ?",
  ["published"],
  instance_id: "ws-123"
)
```

## Push And Analytics

```ruby
admin.push.send("user-123", {
  "title" => "Hello",
  "body" => "From the admin SDK"
})

overview = admin.analytics.overview("range" => "7d")
```

## Choose The Right Package

| Package | Use it for |
| --- | --- |
| `edgebase_admin` | Trusted server-side Ruby code with Service Key access |
| `edgebase_core` | Lower-level primitives for custom integrations |

## License

MIT
