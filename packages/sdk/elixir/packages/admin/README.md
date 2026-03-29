<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase Elixir Admin SDK

Trusted server-side Elixir SDK for EdgeBase.

Use `edgebase_admin` from Phoenix apps, Plug services, background jobs, and other trusted Elixir runtimes that hold a Service Key. It exposes admin auth, database access, raw SQL, storage, push, analytics, functions, and native edge resources.

This package uses a functional Elixir API. Most entry points return structs, and most service calls expose both non-bang and bang forms.

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
- use the actual Elixir function names
- distinguish between non-bang functions that return `{:ok, ...}` and bang functions that raise on error
- avoid copying promise-based examples into Elixir

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/elixir/packages/admin/llms.txt)
- in your environment after install, inside the `EdgeBaseAdmin` package directory as `llms.txt`

## Installation

```elixir
{:edgebase_admin, "~> 0.2.7"}
```

If you consume the monorepo directly, use the path dependency already configured in this repository.

## Quick Start

```elixir
admin = EdgeBaseAdmin.new(
  "https://your-project.edgebase.fun",
  service_key: System.fetch_env!("EDGEBASE_SERVICE_KEY")
)

auth = EdgeBaseAdmin.admin_auth(admin)
{:ok, user} = EdgeBaseAdmin.AdminAuth.get_user(auth, "user-123")

{:ok, rows} = EdgeBaseAdmin.sql(
  admin,
  "SELECT id, title FROM posts WHERE status = ?",
  namespace: "shared",
  params: ["published"]
)

push = EdgeBaseAdmin.push(admin)
{:ok, _} = EdgeBaseAdmin.Push.send(push, "user-123", %{
  "title" => "Deployment finished",
  "body" => "Your content is live."
})
```

## Core API

Once you create an admin client, these are the main surfaces you will use:

- `EdgeBaseAdmin.new/2`
  Main admin entry point
- `EdgeBaseAdmin.db/3`
  Server-side database access
- `EdgeBaseAdmin.storage/1`
  Storage client
- `EdgeBaseAdmin.admin_auth/1`
  Admin user management
- `EdgeBaseAdmin.auth/1`
  Alias for `admin_auth/1`
- `EdgeBaseAdmin.functions/1`
  Call app functions from trusted code
- `EdgeBaseAdmin.analytics/1`
  Query analytics and track server-side events
- `EdgeBaseAdmin.kv/2`, `EdgeBaseAdmin.d1/2`, `EdgeBaseAdmin.vector/2`
  Native edge resources
- `EdgeBaseAdmin.vectorize/2`
  Alias for `vector/2`
- `EdgeBaseAdmin.push/1`
  Push notifications
- `EdgeBaseAdmin.sql/3`, `EdgeBaseAdmin.sql!/3`
  Raw SQL execution
- `EdgeBaseAdmin.broadcast/4`, `EdgeBaseAdmin.broadcast!/4`
  Server-side broadcast
- `EdgeBaseAdmin.destroy/1`
  No-op cleanup hook

## Database Access

```elixir
db = EdgeBaseAdmin.db(admin, "app")
posts = EdgeBaseCore.DbRef.table(db, "posts")
```

For instance databases, pass the instance id as the third argument:

```elixir
EdgeBaseAdmin.db(admin, "workspace", "ws-123")
EdgeBaseAdmin.db(admin, "user", "user-123")
```

## Admin Users

```elixir
auth = EdgeBaseAdmin.admin_auth(admin)

{:ok, created} =
  EdgeBaseAdmin.AdminAuth.create_user(auth, %{
    "email" => "admin@example.com",
    "password" => "secure-pass-123",
    "displayName" => "June"
  })

{:ok, _} = EdgeBaseAdmin.AdminAuth.set_custom_claims(auth, created["id"], %{
  "role" => "moderator"
})

{:ok, users} = EdgeBaseAdmin.AdminAuth.list_users(auth, limit: 20)
```

## Raw SQL

```elixir
rows =
  EdgeBaseAdmin.sql!(admin, "SELECT 1 AS ok", namespace: "shared")

workspace_rows =
  EdgeBaseAdmin.sql!(admin, "SELECT * FROM documents WHERE status = ?",
    namespace: "workspace",
    instance_id: "ws-123",
    params: ["published"]
  )
```

## Push And Analytics

```elixir
push = EdgeBaseAdmin.push(admin)

{:ok, _} =
  EdgeBaseAdmin.Push.send(push, "user-123", %{
    "title" => "Hello",
    "body" => "From the admin SDK"
  })

analytics = EdgeBaseAdmin.analytics(admin)
{:ok, overview} = EdgeBaseAdmin.Analytics.overview(analytics, %{ "range" => "7d" })
```

## Choose The Right Package

| Package | Use it for |
| --- | --- |
| `edgebase_admin` | Trusted server-side Elixir code with Service Key access |
| `edgebase_core` | Lower-level primitives for custom integrations |

## License

MIT
