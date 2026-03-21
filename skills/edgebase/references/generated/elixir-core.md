<!-- Generated from packages/sdk/elixir/packages/core/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase Elixir Core SDK

Use this file as a quick-reference contract for AI coding assistants working with `edgebase_core`.

## Package Boundary

Use `edgebase_core` for low-level EdgeBase building blocks.

This package is shared infrastructure for `edgebase_admin`. Most app code should install `edgebase_admin` instead of using `edgebase_core` directly.

`edgebase_core` does not provide admin auth, push, analytics, KV, D1, or Vectorize helpers.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/elixir/packages/core/README.md
- SDK Overview: https://edgebase.fun/docs/sdks
- Database Admin SDK: https://edgebase.fun/docs/database/admin-sdk
- Storage docs: https://edgebase.fun/docs/storage/upload-download

If docs, snippets, and assumptions disagree, prefer the current package API over guessed patterns from another runtime.

## Canonical Examples

### Build an HTTP client

```elixir
client =
  EdgeBaseCore.new_http_client(
    "https://your-project.edgebase.fun",
    service_key: System.fetch_env!("EDGEBASE_SERVICE_KEY")
  )
```

### Work with storage

```elixir
storage = EdgeBaseCore.StorageClient.new(client)
bucket = EdgeBaseCore.StorageClient.bucket(storage, "avatars")
{:ok, _} = EdgeBaseCore.StorageBucket.upload(bucket, "user-1.jpg", "binary-data", content_type: "image/jpeg")
```

### Use field operations

```elixir
payload = %{
  "views" => EdgeBaseCore.FieldOps.increment(1),
  "legacyField" => EdgeBaseCore.FieldOps.delete_field()
}
```

## Hard Rules

- keep Service Keys on trusted servers only
- `EdgeBaseCore.HttpClient` is synchronous and server-side only
- non-bang functions return `{:ok, ...}` or `{:error, %EdgeBaseCore.Error{}}`
- bang functions such as `get_list!/1` and `upload!/4` unwrap `{:ok, ...}` and raise on error
- `EdgeBaseCore.DbRef.table/2` returns a `TableRef`
- `EdgeBaseCore.StorageClient.bucket/2` returns a `StorageBucket`
- `EdgeBaseCore.StorageBucket.create_signed_upload_url/3` expects `expires_in` as an integer number of seconds
- `EdgeBaseCore.StorageBucket.upload_string/4` accepts raw, base64, base64url, and data URL inputs

## Common Mistakes

- do not use `edgebase_core` when you actually need admin auth or other higher-level server features
- do not copy JavaScript promise-based examples into Elixir
- do not assume `DbRef` or `TableRef` are top-level app entry points; they are building blocks
- do not expose the Service Key through browser code

## Quick Reference

```text
EdgeBaseCore.new_http_client(url, opts)           -> %EdgeBaseCore.HttpClient{}
EdgeBaseCore.DbRef.new(client, ns, id \\ nil)     -> %EdgeBaseCore.DbRef{}
EdgeBaseCore.DbRef.table(db, name)                -> %EdgeBaseCore.TableRef{}
EdgeBaseCore.TableRef.get_list(table)             -> {:ok, result} | {:error, reason}
EdgeBaseCore.TableRef.get_one(table, id)          -> {:ok, result} | {:error, reason}
EdgeBaseCore.TableRef.doc(table, id)              -> %EdgeBaseCore.DocRef{}
EdgeBaseCore.StorageClient.new(client)            -> %EdgeBaseCore.StorageClient{}
EdgeBaseCore.StorageClient.bucket(storage, name)  -> %EdgeBaseCore.StorageBucket{}
EdgeBaseCore.StorageBucket.upload(bucket, key, data, opts \\ []) -> {:ok, result} | {:error, reason}
EdgeBaseCore.StorageBucket.download(bucket, key)  -> {:ok, binary} | {:error, reason}
EdgeBaseCore.FieldOps.increment(value)            -> map
EdgeBaseCore.FieldOps.delete_field()              -> map
```
