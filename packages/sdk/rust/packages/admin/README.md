<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# edgebase-admin

Trusted server-side Rust SDK for EdgeBase.

Use `edgebase-admin` from backend services, jobs, workers, and other trusted environments that hold a Service Key. It exposes admin auth, service-key database access, raw SQL, storage, push, functions, analytics, KV, D1, and Vectorize clients.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Documentation Map

Use this README for the fast overview, then jump into the docs when you need depth:

- [SDK Overview](https://edgebase.fun/docs/sdks)
  Install commands and language matrix for all public SDKs
- [Admin SDK](https://edgebase.fun/docs/sdks/client-vs-server)
  Service-key concepts, trust boundaries, and admin-only capabilities
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
  Cross-language auth, database, storage, functions, push, and analytics examples
- [Admin User Management](https://edgebase.fun/docs/authentication/admin-users)
  Create, update, delete, and manage users with the Service Key
- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
  Table queries, filters, pagination, batch writes, and raw SQL
- [Storage](https://edgebase.fun/docs/storage/upload-download)
  Uploads, downloads, metadata, and signed URLs
- [Push Admin SDK](https://edgebase.fun/docs/push/admin-sdk)
  Push send, topic broadcast, token inspection, and logs
- [Analytics Admin SDK](https://edgebase.fun/docs/analytics/admin-sdk)
  Request metrics, event tracking, and event queries
- [Native Resources](https://edgebase.fun/docs/server/native-resources)
  KV, D1, Vectorize, and other edge-native resources

## For AI Coding Assistants

This package includes an `llms.txt` file for AI-assisted development.

Use it when you want an agent or code assistant to:

- keep Service Key logic on the server
- use `EdgeBase::server(...)` to construct the client
- call `admin_auth()` and other methods, not property-style SDK access
- pass any `serde::Serialize` values as SQL bind params
- use `serde_json::Value` for broadcast payloads and other JSON-shaped data

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/rust/packages/admin/llms.txt)
- in the published crate contents next to the package files

## Installation

For published applications:

```toml
[dependencies]
edgebase-admin = "0.2.2"
```

Or:

```bash
cargo add edgebase-admin
```

If you are working inside this repository, add the crate as a path dependency:

```toml
[dependencies]
edgebase-admin = { path = "../packages/admin" }
```

## Quick Start

```rust
use edgebase_admin::EdgeBase;
use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), edgebase_core::Error> {
    let service_key = std::env::var("EDGEBASE_SERVICE_KEY").unwrap();
    let admin = EdgeBase::server("https://your-project.edgebase.fun", &service_key)?;

    let users = admin.admin_auth().list_users(20, None).await?;
    let rows = admin.sql("shared", None, "SELECT 1 AS ok", &[]).await?;
    admin.broadcast("chat", "message", json!({ "text": "hello" })).await?;

    println!("{users:?}");
    println!("{rows:?}");
    Ok(())
}
```

## Core API

Once you create an admin client, these are the main surfaces you will use:

- `EdgeBase::server(base_url, service_key)`
  Main server-side entry point
- `admin.admin_auth()`
  Admin user management
- `admin.db(namespace, instance_id)`
  Service-key database access
- `admin.storage()`
  Server-side storage access
- `admin.sql(namespace, id, query, params)`
  Raw SQL execution
- `admin.broadcast(channel, event, payload)`
  Server-side database-live broadcast
- `admin.kv(namespace)`, `admin.d1(database)`, `admin.vector(index)`
  Access platform resources from trusted code
- `admin.push()`
  Send push notifications
- `admin.functions()`
  Call app functions from trusted code
- `admin.analytics()`
  Query analytics and track server-side events

## Database Access

```rust
use edgebase_admin::EdgeBase;

let service_key = std::env::var("EDGEBASE_SERVICE_KEY").unwrap();
let admin = EdgeBase::server("https://your-project.edgebase.fun", &service_key)?;

let rows = admin.db("app", None).table("posts").get_list().await?;
```

For instance databases, pass the instance id explicitly:

```rust
admin.db("workspace", Some("ws-123"));
admin.db("user", Some("user-123"));
```

For raw SQL, the namespace and optional instance id are separate arguments:

```rust
let rows = admin.sql(
    "workspace",
    Some("ws-123"),
    "SELECT * FROM documents WHERE status = ?",
    &["published"],
).await?;
```

Read more: [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)

## Admin Auth

```rust
let created = admin.admin_auth().create_user(
    "june@example.com",
    "secure-pass-123",
).await?;

admin.admin_auth().set_custom_claims(
    created.get("id").and_then(|v| v.as_str()).unwrap(),
    json!({ "role": "moderator" }),
).await?;

let users = admin.admin_auth().list_users(20, None).await?;
println!("{users:?}");
```

Read more: [Admin User Management](https://edgebase.fun/docs/authentication/admin-users)

## Raw SQL

`sql()` accepts any slice of `serde::Serialize` bind values:

```rust
admin.sql("shared", None, "SELECT 1 AS ok", &[]).await?;

admin.sql(
    "workspace",
    Some("ws-123"),
    "SELECT * FROM documents WHERE status = ?",
    &[serde_json::json!("published")],
).await?;
```

## Push And Analytics

```rust
use std::collections::HashMap;

admin.push().send(
    "user-123",
    &json!({
        "title": "Deployment finished",
        "body": "Your content is live."
    }),
).await?;

let overview = admin.analytics().overview(Some(HashMap::from([
    ("range".to_string(), "7d".to_string()),
]))).await?;
println!("{overview:?}");
```

Read more:

- [Push Admin SDK](https://edgebase.fun/docs/push/admin-sdk)
- [Analytics Admin SDK](https://edgebase.fun/docs/analytics/admin-sdk)

## Native Resource Access

```rust
admin.kv("cache").set("homepage", "warm", Some(60)).await?;

let rows = admin.d1("analytics").exec(
    "SELECT * FROM events WHERE type = ?",
    &["click"],
).await?;

println!("{rows:?}");
```

## Choose The Right Package

| Package | Use it for |
| --- | --- |
| `edgebase-admin` | Trusted server-side code with Service Key access |

## License

MIT
