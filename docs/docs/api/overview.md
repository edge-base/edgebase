---
sidebar_position: 0
sidebar_label: Overview
slug: /api
---

# API Reference

REST API and WebSocket protocol reference for EdgeBase. Most endpoints are available at your project's base URL, with WebSocket and admin-only helpers called out below.

---

## Base URL

```
https://your-project.edgebase.fun/api/
```

## API Groups

| Group | Base Path | Description |
|-------|-----------|-------------|
| **Authentication** | `/api/auth/*` | Sign up, sign in, OAuth, token refresh, password reset |
| **Database** | `/api/db/{namespace}/tables/{table}`, `/api/db/{namespace}/{instanceId}/tables/{table}` | CRUD, batch, queries, count |
| **Storage** | `/api/storage/{bucket}/*` | Upload, download, signed URLs, multipart |
| **Database Subscriptions** | `/api/db/subscribe`, `/api/db/connect-check`, `/api/db/broadcast` | WebSocket connection, preflight diagnostics, and server-side broadcasts |
| **Room** | `/api/room`, `/api/room/connect-check`, `/api/room/metadata`, `/api/room/summary` | Room WebSocket connection plus room metadata, occupancy summaries, and diagnostics |
| **Push** | `/api/push/*` | Device registration, topic management |
| **Functions** | `/api/functions/*` | HTTP-triggered App Functions |
| **Analytics** | `/api/analytics/*` | Request metrics and custom event tracking |
| **Admin** | `/api/auth/admin/*` | User management (requires Service Key) |
| **Native Resources** | `/api/kv/*`, `/api/d1/*`, `/api/vectorize/*` | Direct KV, D1, Vectorize access |
| **Raw SQL** | `/api/sql` | Service-key-backed SQL execution for configured database namespaces |
| **System** | `/api/health`, `/api/schema`, `/api/config` | Health check, schema introspection, and public runtime config |

## Authentication

Most endpoints require a JWT access token:

```
Authorization: Bearer <access_token>
```

Admin endpoints additionally require a Service Key:

```
X-EdgeBase-Service-Key: <service_key>
```

## Next Steps

| Page | Description |
|------|-------------|
| [Authentication API](/docs/api/authentication) | Auth endpoints (signup, signin, OAuth, refresh) |
| [Database API](/docs/api/database) | CRUD, batch, query, count endpoints |
| [Storage API](/docs/api/storage) | File upload, download, signed URL endpoints |
| [Database Subscriptions API](/docs/api/database-subscriptions) | WebSocket protocol for database subscriptions |
| [Room API](/docs/api/room) | WebSocket protocol plus room metadata and diagnostics |
| [Push API](/docs/api/push) | Push notification endpoints |
| [Functions API](/docs/api/functions) | HTTP function endpoints |
| [Analytics API](/docs/api/analytics) | Metrics query and custom event endpoints |
| [Admin API](/docs/api/admin) | Admin user management endpoints |
| [Native Resources API](/docs/api/native-resources) | KV, D1, Vectorize endpoints |
| [Raw SQL](/docs/server/raw-sql) | Service-key-backed SQL execution against configured namespaces |
| [System API](/docs/api/system) | Health check, schema, and config endpoints |
