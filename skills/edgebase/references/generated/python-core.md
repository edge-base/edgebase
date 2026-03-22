<!-- Generated from packages/sdk/python/packages/core/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# edgebase-core

Use this file as a quick-reference contract for AI coding assistants working with the `edgebase-core` Python package.

## Package Boundary

Use `edgebase-core` for low-level EdgeBase building blocks.

This package is shared infrastructure for `edgebase` and `edgebase-admin`. Most app code should install one of those higher-level packages instead of using `edgebase-core` directly.

`edgebase-core` does not provide a top-level server client, auth convenience helpers, or package-level factories like `create_admin_client(...)`.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/python/packages/core/README.md
- SDK overview: https://edgebase.fun/docs/sdks
- Database admin SDK: https://edgebase.fun/docs/database/admin-sdk
- Storage docs: https://edgebase.fun/docs/storage/upload-download

If docs, snippets, and assumptions disagree, prefer the current package API over guessed patterns from another runtime.

## Canonical Examples

### Build a table reference from a custom HTTP client

```python
from edgebase_core import HttpClient, TableRef

http = HttpClient(
    "https://your-project.edgebase.fun",
    service_key="service-key",
)

posts = TableRef(http, "shared", None, "posts").where("published", "==", True).get_list()
```

### Use document helpers

```python
table = TableRef(http, "shared", None, "posts")
post = table.doc("post-1").get()
```

### Work with storage directly

```python
from edgebase_core import StorageClient

storage = StorageClient(http)
bucket = storage.bucket("avatars")
bucket.upload("user-1.jpg", file_bytes, content_type="image/jpeg")
```

## Common Mistakes

- do not expect a top-level `EdgeBaseServer` or `AdminClient` here; those live in higher-level packages
- `TableRef(http, namespace, instance_id, table_name)` requires the low-level HTTP client as its first argument
- `table.get()` does not exist; use `table.get_list()` for multiple records or `table.get_one(id)` / `table.doc(id).get()` for a single record
- `StorageClient` requires an initialized `HttpClient`
- `PushClient` exists in this package, but most applications should access push through `edgebase-admin` or `edgebase`
- `increment` and `delete_field` are aliases from `FieldOps`

## Quick Reference

```python
http = HttpClient(base_url, service_key=service_key)

table = TableRef(http, "shared", None, "posts")
table.where("published", "==", True).order_by("createdAt", "desc").limit(20).get_list()
table.get_one("id-1")
table.insert({"title": "Hello"})
table.update("id-1", {"title": "Updated"})
table.delete("id-1")

doc = DocRef(http, "shared", None, "posts", "id-1")
doc.get()

storage = StorageClient(http)
bucket = storage.bucket("avatars")
bucket.upload("user-1.jpg", file_bytes, content_type="image/jpeg")
bucket.create_signed_upload_url("large.zip", expires_in=600)

increment(1)
delete_field()
```
