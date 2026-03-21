<!-- Generated from packages/sdk/rust/packages/admin/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase Rust Admin SDK

Use this file as a quick-reference contract for AI coding assistants working with `edgebase-admin`.

## Package Boundary

Use `edgebase-admin` in trusted server-side environments only.

Do not ship this package to browsers or untrusted clients.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/rust/packages/admin/README.md
- Database Admin SDK: https://edgebase.fun/docs/database/admin-sdk
- Admin users: https://edgebase.fun/docs/authentication/admin-users
- Push Admin SDK: https://edgebase.fun/docs/push/admin-sdk
- Analytics Admin SDK: https://edgebase.fun/docs/analytics/admin-sdk
- Admin SDK reference: https://edgebase.fun/docs/admin-sdk/reference

## Canonical Examples

### Create an admin client

```rust
use edgebase_admin::EdgeBase;

let service_key = std::env::var("EDGEBASE_SERVICE_KEY").unwrap();
let admin = EdgeBase::server("https://your-project.edgebase.fun", &service_key)?;
```

### Query a table

```rust
let posts = admin.db("app", None).table("posts");
let rows = posts.get_list().await?;
```

### Query an instance database

```rust
let docs = admin.db("workspace", Some("ws-1")).table("documents");
let rows = docs.get_list().await?;
```

### Manage users

```rust
let created = admin.admin_auth().create_user(
    "june@example.com",
    "pass1234",
).await?;

admin.admin_auth().set_custom_claims(
    created.get("id").and_then(|v| v.as_str()).unwrap(),
    serde_json::json!({ "role": "moderator" }),
).await?;
```

### Execute SQL

```rust
let shared_rows = admin.sql("shared", None, "SELECT 1 AS ok", &[]).await?;

let rows = admin.sql(
    "workspace",
    Some("ws-1"),
    "SELECT * FROM documents WHERE status = ?",
    &["published"],
).await?;
```

### Send push and query analytics

```rust
admin.push().send(
    "user-123",
    serde_json::json!({
        "title": "Hello",
        "body": "From the admin SDK"
    }),
).await?;

let overview = admin.analytics().overview(Some(std::collections::HashMap::from([
    ("range".to_string(), "7d".to_string()),
]))).await?;
```

## Hard Rules

- keep Service Keys on trusted servers only
- use `EdgeBase::server(...)` to construct the client
- call `admin_auth()`, `db()`, `storage()`, `push()`, `functions()`, and `analytics()` as methods
- `admin.sql(namespace, id, query, params)` is the real Rust SQL signature
- Rust SQL params can be any slice of `serde::Serialize` values
- `admin.broadcast(channel, event, payload)` expects a `serde_json::Value`
- `admin.db(namespace, Some(instance_id))` takes the instance id separately from SQL

## Common Mistakes

- do not assume property-style access like `admin.admin_auth`
- do not assume SQL bind params are string-only
- do not pass raw objects where the API expects `serde_json::Value`
- do not expose the Service Key through client-side code

## Quick Reference

```text
EdgeBase::server(base_url, service_key)         -> Result<EdgeBase, Error>
admin.admin_auth()                              -> AdminAuthClient
admin.admin_auth().list_users(limit, cursor)    -> Result<Value, Error>
admin.admin_auth().create_user(email, password) -> Result<HashMap<String, Value>, Error>
admin.admin_auth().update_user(id, data)        -> Result<HashMap<String, Value>, Error>
admin.admin_auth().delete_user(id)              -> Result<(), Error>
admin.db(namespace, Some(id))                   -> DbRef
admin.sql(namespace, id, query, params)        -> Result<Value, Error>
admin.broadcast(channel, event, payload)       -> Result<Value, Error>
admin.kv(namespace)                             -> KvClient
admin.d1(database)                              -> D1Client
admin.vector(index)                             -> VectorizeClient
admin.push()                                    -> PushClient
admin.functions()                               -> FunctionsClient
admin.analytics()                               -> AnalyticsClient
```
