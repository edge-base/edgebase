<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# edgebase-core

Shared low-level Python primitives for EdgeBase.

`edgebase-core` is the foundation used by `edgebase` and `edgebase-admin`. It contains the HTTP client, table/query builder, storage helpers, push primitives, field operations, and common error types.

Most application code should install `edgebase-admin` instead:

- `pip install edgebase-admin`

If you are working inside this repository or publishing an internal umbrella package, `edgebase` is the broader package that layers on top of `edgebase-core`.

Install `edgebase-core` directly only if you are building custom wrappers, generated bindings, or internal integrations on top of the EdgeBase APIs.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Docs

- SDK overview: https://edgebase.fun/docs/sdks
- Database admin SDK: https://edgebase.fun/docs/database/admin-sdk
- Storage docs: https://edgebase.fun/docs/storage/upload-download

## Quick Start

```python
from edgebase_core import HttpClient, StorageClient, TableRef

http = HttpClient(
    "https://your-project.edgebase.fun",
    service_key="service-key",
)

posts = (
    TableRef(http, "shared", None, "posts")
    .where("published", "==", True)
    .order_by("createdAt", "desc")
    .limit(20)
    .get_list()
)

bucket = StorageClient(http).bucket("avatars")
```

## Included Surfaces

- `HttpClient`
- `TableRef`, `DocRef`, `ListResult`
- `StorageClient`, `StorageBucket`
- `PushClient`
- `FieldOps`, `increment`, `delete_field`
- `ContextManager`
- `EdgeBaseError`

## AI Assistant

- Package guide: `packages/sdk/python/packages/core/README.md`
- Assistant reference: `packages/sdk/python/packages/core/llms.txt`

## Requirements

- Python `3.10+`
- `httpx>=0.27`
