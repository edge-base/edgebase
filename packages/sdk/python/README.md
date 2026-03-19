# EdgeBase Python SDK

Unified Python SDK for trusted EdgeBase server environments.

`edgebase` is the all-in-one Python package for backend EdgeBase workloads. It combines the lower-level primitives from `edgebase-core` with the main trusted-server surfaces from `edgebase-admin`, and exposes them through `EdgeBaseServer` (aliased as `EdgeBase`).

Today, the public PyPI release line focuses on `edgebase-core` and `edgebase-admin`. This umbrella package is still useful in-repo and for local/private installs, but it is not yet the default public install target on PyPI.

Use it when you want one install that covers:

- admin auth and service-key database access
- storage uploads, downloads, and signed URLs
- push send helpers for trusted server workflows
- raw SQL plus KV, D1, and Vectorize helpers
- room helpers via `RoomClient`

If you only need the lean public install path today, install [`edgebase-admin`](https://pypi.org/project/edgebase-admin/) instead. If you need the low-level building blocks separately, install [`edgebase-core`](https://pypi.org/project/edgebase-core/).

## Documentation Map

Use this README for the fast overview, then jump into the docs when you need depth:

- [SDK Overview](https://edgebase.fun/docs/sdks)
  Install commands and language matrix for all public SDKs
- [Admin SDK](https://edgebase.fun/docs/sdks/client-vs-server)
  Service-key concepts, trust boundaries, and admin-only capabilities
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
  Cross-language auth, database, storage, functions, and push examples
- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
  Table queries, filters, pagination, batch writes, and raw SQL
- [Storage](https://edgebase.fun/docs/storage/upload-download)
  Uploads, downloads, metadata, and signed URLs
- [Room Client SDK](https://edgebase.fun/docs/room/client-sdk)
  Realtime rooms and multiplayer-style room flows
- [Native Resources](https://edgebase.fun/docs/server/native-resources)
  KV, D1, Vectorize, and other edge-native resources

## For AI Coding Assistants

This package includes an `llms.txt` file for AI-assisted development.

Use it when you want an agent or code assistant to:

- avoid guessing browser-style APIs that do not exist in this package
- use the correct Python method names and return shapes
- know when to use `edgebase` vs `edgebase-admin`
- stay inside the real server-side package boundary

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/python/llms.txt)
- in your environment after install, inside the `edgebase` package directory as `llms.txt`

## Installation

Public packages available today:

```bash
pip install edgebase-admin
pip install edgebase-core
```

If you are working in this repository or distributing the umbrella package internally, `edgebase` remains the broader Python package and exposes the `EdgeBaseServer` entry point shown below.

## Quick Start

```python
import os

from edgebase import EdgeBaseServer

admin = EdgeBaseServer(
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

bucket = admin.storage.bucket("avatars")
signed = bucket.create_signed_url("user-1.jpg", expires_in="1h")

admin.kv("cache").set("health", "ok", ttl=300)

print(len(users.get("users", [])), len(posts.items), signed.url)
```

`EdgeBase` is a backwards-compatible alias for `EdgeBaseServer`.

## Core API

- `EdgeBaseServer(url, service_key=...)`
  Main unified server entry point
- `EdgeBase(...)`
  Alias for `EdgeBaseServer`
- `admin.admin_auth`
  Admin user management
- `admin.db(namespace, instance_id=None).table(name)`
  Service-key database access
- `admin.storage.bucket(name)`
  Storage bucket access
- `admin.push`
  Push notification management
- `admin.sql(namespace="shared", instance_id=None, query="", params=None)`
  Raw SQL
- `admin.kv(namespace)`, `admin.d1(database)`, `admin.vectorize(index)`
  Native Cloudflare resources
- `admin.broadcast(channel, event, payload)`
  Server-side database-live broadcast
- `RoomClient(base_url, namespace, room_id, token_getter=...)`
  Realtime room client for server-side tools and bots

## Realtime Note

`RoomClient` is available in this package, but `TableRef.on_snapshot()` is not automatically wired when you create table refs from `EdgeBaseServer`. Use `RoomClient` for realtime room flows, or the lower-level core/database-live wiring if you are building custom integrations.

## Requirements

- Python `3.10+`
- `httpx>=0.27`
- `websockets>=12.0`
- A valid EdgeBase Service Key for admin operations
