<!-- Generated from packages/sdk/rust/packages/core/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase Rust Core SDK

Use this file as a quick-reference contract for AI coding assistants working with `edgebase-core`.

## Package Boundary

Use `edgebase-core` for low-level EdgeBase building blocks.

This crate is shared infrastructure for `edgebase-admin`. Most app code should install `edgebase-admin` instead of using `edgebase-core` directly.

`edgebase-core` does not provide admin auth, push, analytics, KV, D1, or Vectorize helpers.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/rust/packages/core/README.md
- SDK Overview: https://edgebase.fun/docs/sdks
- Database Admin SDK: https://edgebase.fun/docs/database/admin-sdk
- Storage docs: https://edgebase.fun/docs/storage/upload-download

If docs, snippets, and assumptions disagree, prefer the current package API over guessed patterns from another runtime.

## Canonical Examples

### Build an HTTP client

```rust
use edgebase_core::HttpClient;
use std::sync::Arc;

let http = Arc::new(HttpClient::new(
    "https://your-project.edgebase.fun",
    "service-key",
)?);
```

### Work with storage

```rust
use edgebase_core::StorageClient;

let bucket = StorageClient::new(http.clone()).bucket("avatars");
bucket.upload("user-1.jpg", b"binary-data".to_vec(), "image/jpeg").await?;
```

### Use field operations

```rust
use edgebase_core::field_ops;

let payload = serde_json::json!({
    "views": field_ops::increment(1),
    "legacyField": field_ops::delete_field()
});
```

## Hard Rules

- keep Service Keys on trusted servers only
- `HttpClient::new` returns `Result<HttpClient, Error>`
- `TableRef::new(http, name)` uses the shared namespace by default
- `TableRef::with_db(http, name, namespace, instance_id)` is the namespace-aware constructor
- `TableRef::where_`, `or_`, `order_by`, `limit`, `offset`, `page`, `search`, `after`, and `before` are immutable builders
- `TableRef::get_list()`, `get_one()`, and `get_first()` are the main read helpers
- `StorageClient::bucket()` returns a `StorageBucket`
- `StorageBucket::create_signed_upload_url()` takes an expiration string
- `field_ops::increment()` and `field_ops::delete_field()` return `serde_json::Value` markers

## Common Mistakes

- do not use `edgebase-core` when you actually need admin auth or other higher-level server features
- do not copy JavaScript promise-based examples into Rust
- do not assume `TableRef` is the only query entry point; `with_db` is available for namespace-aware cases
- do not expose the Service Key through browser code

## Quick Reference

```text
HttpClient::new(base_url, service_key)             -> Result<HttpClient, Error>
TableRef::new(http, name)                          -> TableRef
TableRef::with_db(http, name, namespace, id)       -> TableRef
TableRef::where_(field, op, value)                 -> TableRef
TableRef::get_list().await                         -> Result<Value, Error>
TableRef::get_one(id).await                        -> Result<Value, Error>
TableRef::get_first().await                        -> Result<Option<Value>, Error>
StorageClient::new(http)                           -> StorageClient
StorageClient::bucket(name)                        -> StorageBucket
StorageBucket::upload(key, bytes, content_type).await -> Result<Value, Error>
StorageBucket::download(key).await                 -> Result<Vec<u8>, Error>
StorageBucket::create_signed_url(key, expires_in).await -> Result<Value, Error>
StorageBucket::create_signed_upload_url(key, expires_in).await -> Result<Value, Error>
field_ops::increment(value)                        -> Value
field_ops::delete_field()                          -> Value
```
