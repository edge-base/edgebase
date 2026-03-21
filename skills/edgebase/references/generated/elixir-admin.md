<!-- Generated from packages/sdk/elixir/packages/admin/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase Elixir Admin SDK

Use this file as a quick-reference contract for AI coding assistants working with `edgebase_admin`.

## Package Boundary

Use `edgebase_admin` only in trusted server-side Elixir environments.

Do not ship this package to browser code or untrusted clients. It is meant for backend apps, workers, cron jobs, and other places where a Service Key can stay private.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/elixir/packages/admin/README.md
- Database Admin SDK: https://edgebase.fun/docs/database/admin-sdk
- Admin users: https://edgebase.fun/docs/authentication/admin-users
- Storage: https://edgebase.fun/docs/storage/upload-download
- Push Admin SDK: https://edgebase.fun/docs/push/admin-sdk
- Analytics Admin SDK: https://edgebase.fun/docs/analytics/admin-sdk
- Admin SDK reference: https://edgebase.fun/docs/admin-sdk/reference

If docs, examples, and assumptions disagree, prefer the current package API and the official docs over guessed patterns.

## Canonical Examples

### Create an admin client

```elixir
admin = EdgeBaseAdmin.new(
  "https://your-project.edgebase.fun",
  service_key: System.fetch_env!("EDGEBASE_SERVICE_KEY")
)
```

### Query a table

```elixir
auth = EdgeBaseAdmin.admin_auth(admin)
{:ok, rows} = EdgeBaseAdmin.sql!(admin, "SELECT 1 AS ok", namespace: "shared")
```

### Manage users

```elixir
auth = EdgeBaseAdmin.admin_auth(admin)

{:ok, created} =
  EdgeBaseAdmin.AdminAuth.create_user(auth, %{
    "email" => "june@example.com",
    "password" => "pass1234",
    "displayName" => "June"
  })

{:ok, user} = EdgeBaseAdmin.AdminAuth.get_user(auth, created["id"])
```

### Execute SQL

```elixir
{:ok, rows} =
  EdgeBaseAdmin.sql(
    admin,
    "SELECT * FROM documents WHERE status = ?",
    namespace: "workspace",
    instance_id: "ws-1",
    params: ["published"]
  )
```

### Send push and query analytics

```elixir
push = EdgeBaseAdmin.push(admin)
{:ok, _} = EdgeBaseAdmin.Push.send(push, "user-123", %{
  "title" => "Hello",
  "body" => "From the admin SDK"
})

analytics = EdgeBaseAdmin.analytics(admin)
{:ok, overview} = EdgeBaseAdmin.Analytics.overview(analytics, %{"range" => "7d"})
```

## Hard Rules

- keep Service Keys on trusted servers only
- `EdgeBaseAdmin.new/2` requires `service_key:` in the options keyword list
- `EdgeBaseAdmin.admin_auth/1` is the canonical admin auth accessor; `auth/1` is an alias
- `EdgeBaseAdmin.sql/3` and `sql!/3` take a `query` string plus an options keyword list with `:namespace`, `:instance_id`, and `:params`
- `EdgeBaseAdmin.sql!` and other bang functions unwrap `{:ok, ...}` results and raise on errors
- `EdgeBaseAdmin.AdminAuth`, `EdgeBaseAdmin.Functions`, `EdgeBaseAdmin.Analytics`, `EdgeBaseAdmin.KV`, `EdgeBaseAdmin.D1`, `EdgeBaseAdmin.Vector`, and `EdgeBaseAdmin.Push` are the service modules
- `EdgeBaseAdmin.Push.send/3`, `send_many/3`, `send_to_token/4`, `get_tokens/2`, `get_logs/3`, `send_to_topic/3`, and `broadcast/2` are synchronous functions returning `{:ok, ...}` or raw results
- `EdgeBaseAdmin.broadcast/4` is server-side broadcast
- `EdgeBaseAdmin.destroy/1` is a no-op cleanup hook

## Common Mistakes

- do not use `edgebase_admin` in client-side Elixir code
- do not copy promise-based examples into Elixir
- do not assume bang and non-bang functions return the same shape
- do not pass the instance id positionally to `sql`; use `instance_id:`
- do not call `admin_auth` methods on the client struct itself; call them on the service module struct returned by `admin_auth/1`

## Quick Reference

```text
EdgeBaseAdmin.new(url, service_key:)          -> %EdgeBaseAdmin.Client{}
EdgeBaseAdmin.db(client, ns = "shared", id)   -> %EdgeBaseCore.DbRef{}
EdgeBaseAdmin.storage(client)                -> EdgeBaseCore.StorageClient
EdgeBaseAdmin.admin_auth(client)             -> EdgeBaseAdmin.AdminAuth
EdgeBaseAdmin.auth(client)                   -> EdgeBaseAdmin.AdminAuth
EdgeBaseAdmin.functions(client)              -> EdgeBaseAdmin.Functions
EdgeBaseAdmin.analytics(client)               -> EdgeBaseAdmin.Analytics
EdgeBaseAdmin.kv(client, namespace)           -> EdgeBaseAdmin.KV
EdgeBaseAdmin.d1(client, database)            -> EdgeBaseAdmin.D1
EdgeBaseAdmin.vector(client, index)           -> EdgeBaseAdmin.Vector
EdgeBaseAdmin.vectorize(client, index)        -> EdgeBaseAdmin.Vector
EdgeBaseAdmin.push(client)                    -> EdgeBaseAdmin.Push
EdgeBaseAdmin.sql(client, query, opts \\ [])  -> {:ok, result} | {:error, reason}
EdgeBaseAdmin.sql!(client, query, opts \\ []) -> result
EdgeBaseAdmin.broadcast(client, ch, evt, p)   -> {:ok, result} | {:error, reason}
EdgeBaseAdmin.broadcast!(client, ch, evt, p)  -> result
EdgeBaseAdmin.destroy(client)                 -> :ok
```
