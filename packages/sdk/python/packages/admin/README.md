<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# edgebase-admin

Server-only Python admin SDK for EdgeBase.

Use `edgebase-admin` from trusted environments that hold a Service Key, such as backend APIs, cron jobs, workers, and operational tooling. It exposes admin auth, service-key database access, storage management, raw SQL, functions, analytics, push, and native Cloudflare resources.

If you want the broader umbrella package that also includes the higher-level `EdgeBaseServer` entry point and room helpers, use `edgebase` from this repository or your internal build flow. The current public PyPI install path is `edgebase-admin`.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Documentation Map

Use this README for the fast overview, then jump into the docs when you need depth:

- [SDK Overview](https://edgebase.fun/docs/sdks)
  Install commands and language matrix for all public SDKs
- [Admin SDK](https://edgebase.fun/docs/sdks/client-vs-server)
  Service-key concepts, trust boundaries, and admin-only capabilities
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
  Cross-language auth, database, storage, functions, and push examples
- [Admin User Management](https://edgebase.fun/docs/authentication/admin-users)
  Create, update, delete, and manage users with the Service Key
- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
  Table queries, filters, pagination, batch writes, and raw SQL
- [Storage](https://edgebase.fun/docs/storage/upload-download)
  Uploads, downloads, metadata, and signed URLs
- [Analytics Admin SDK](https://edgebase.fun/docs/analytics/admin-sdk)
  Request metrics, event tracking, and event queries
- [Push Admin SDK](https://edgebase.fun/docs/push/admin-sdk)
  Push send, topic broadcast, token inspection, and logs
- [Native Resources](https://edgebase.fun/docs/server/native-resources)
  KV, D1, Vectorize, and other edge-native resources

## For AI Coding Assistants

This package includes an `llms.txt` file for AI-assisted development.

Use it when you want an agent or code assistant to:

- use the right Python admin method signatures
- remember which surfaces are properties vs methods
- avoid copying JavaScript or Go API shapes into Python
- choose `edgebase-admin` instead of the broader `edgebase` package when only admin features are needed

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/python/packages/admin/llms.txt)
- in your environment after install, inside the `edgebase_admin` package directory as `llms.txt`

## Installation

```bash
pip install edgebase-admin
```

## Quick Start

```python
import os

from edgebase_admin import create_admin_client

admin = create_admin_client(
    "https://your-project.edgebase.fun",
    service_key=os.environ["EDGEBASE_SERVICE_KEY"],
)

users = admin.admin_auth.list_users(limit=20)

posts = (
    admin.db("shared")
    .table("posts")
    .where("published", "==", True)
    .order_by("createdAt", "desc")
    .limit(10)
    .get_list()
)

rows = admin.sql(
    "shared",
    None,
    "SELECT COUNT(*) AS total FROM posts WHERE published = ?",
    [1],
)

bucket = admin.storage().bucket("avatars")
signed = bucket.create_signed_url("user-1.jpg", expires_in="1h")

print(len(users.get("users", [])), len(posts.items), rows, signed.url)
```

## Core API

- `AdminClient(base_url, service_key=...)`
  Main admin entry point
- `create_admin_client(base_url, service_key=...)`
  Convenience helper matching the public docs
- `admin.admin_auth`
  Admin user management
- `admin.db(namespace="shared", instance_id=None).table(name)`
  Service-key database access
- `admin.storage()`
  Storage bucket access
- `admin.sql(namespace="shared", instance_id=None, query="", params=None)`
  Raw SQL
- `admin.functions()`
  Call app functions from trusted code
- `admin.analytics()`
  Query request metrics and track custom events
- `admin.push()`
  Send push notifications and inspect logs
- `admin.kv(namespace)`, `admin.d1(database)`, `admin.vector(index)` / `admin.vectorize(index)`
  Native Cloudflare resources

## Requirements

- Python `3.10+`
- `edgebase-core>=0.2.0,<0.3.0`
- A valid EdgeBase Service Key
