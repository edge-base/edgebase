# EdgeBase Python SDK

Python SDK for EdgeBase — Backend as a Service.

## Installation

```bash
pip install edgebase
```

With keyring support (for persistent token storage):
```bash
pip install edgebase[keyring]
```

## Quick Start

```python
from edgebase import EdgeBase

client = EdgeBase("https://your-project.edgebase.fun")

# Auth
client.auth.sign_up(email="user@example.com", password="secure123")

# Database
result = client.collection("posts") \
    .where("status", "==", "published") \
    .order_by("createdAt", "desc") \
    .limit(20) \
    .get()
print(f"Found {result.total} posts")

# Storage
url = admin.storage.bucket("avatars").get_url("profile.png")

# DatabaseLive (callback-based)
def on_change(change):
    print(f"{change.event}: {change.record}")

unsubscribe = client.collection("posts").on_snapshot(on_change)

# Cleanup
client.destroy()
```

## Features

- **Auth**: sign_up, sign_in, sign_out, OAuth, anonymous, sessions, profile
- **Database**: Immutable query builder, CRUD, batch ops, database-live subscriptions
- **Storage**: Upload, download, signed URLs, copy, move, resumable uploads
- **DatabaseLive**: WebSocket (websockets lib), Presence, Broadcast channels
- **Admin**: Service Key-based user management
- **Thread-safe**: Token management with threading.Lock

## Requirements

- Python 3.10+
- httpx >= 0.27
- websockets >= 12.0 (for database-live features)
- keyring >= 25.0 (optional, for persistent token storage)
