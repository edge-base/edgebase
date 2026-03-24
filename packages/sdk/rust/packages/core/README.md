<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# edgebase-core

Shared low-level Rust primitives for EdgeBase.

`edgebase-core` is the foundation used by `edgebase-admin`. It provides the HTTP client, table query builder, storage helpers, field operation markers, error types, and the generated API layer used by higher-level SDKs.

Most application code should install `edgebase-admin` instead. Use this crate directly when you are building custom wrappers, generated bindings, or internal integrations.

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
  Cross-language examples that sit on top of this core crate

## For AI Coding Assistants

This crate includes an `llms.txt` file for AI-assisted development.

Use it when you want an agent or code assistant to:

- keep Service Keys on the server
- use the actual Rust type and method names
- avoid copying JavaScript promise-based examples into Rust
- remember which surfaces are low-level helpers versus admin-only clients

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/rust/packages/core/llms.txt)
- in the published crate contents alongside the package files

## Installation

For published applications:

```toml
[dependencies]
edgebase-core = "0.2.4"
```

Or:

```bash
cargo add edgebase-core
```

If you are working inside this repository, add the crate as a path dependency:

```toml
[dependencies]
edgebase-core = { path = "../packages/core" }
```

## Quick Start

```rust
use edgebase_core::{field_ops, HttpClient, StorageClient, TableRef};
use std::sync::Arc;

# async fn example() -> Result<(), edgebase_core::Error> {
let http = Arc::new(HttpClient::new(
    "https://your-project.edgebase.fun",
    "service-key",
)?);

let posts = TableRef::new(http.clone(), "posts")
    .where_("published", "==", true)
    .limit(20);
let rows = posts.get_list().await?;

let bucket = StorageClient::new(http.clone()).bucket("avatars");
bucket.upload("user-1.jpg", b"binary-data".to_vec(), "image/jpeg").await?;

let marker = field_ops::increment(1);
let _ = (rows, marker);
# Ok(())
# }
```

## Included Surfaces

- `HttpClient`
- `TableRef`, `ListResult`, `BatchResult`, `UpsertResult`
- `StorageClient`, `StorageBucket`
- `field_ops::increment()` and `field_ops::delete_field()`
- `Error`
- `GeneratedDbApi`

## Choose The Right Package

| Package | Use it for |
| --- | --- |
| `edgebase-core` | Low-level Rust primitives for custom wrappers and internal integrations |
| `edgebase-admin` | Trusted server-side code with Service Key access |

## License

MIT
