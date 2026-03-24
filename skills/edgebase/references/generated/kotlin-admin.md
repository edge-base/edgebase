<!-- Generated from packages/sdk/kotlin/admin/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase Kotlin Admin SDK

Use this file as a quick-reference contract for AI coding assistants working with `edgebase-admin-kotlin`.

## Package Boundary

Use `edgebase-admin-kotlin` only in trusted JVM-side code.

Do not ship this package to Android apps, browser bundles, or other untrusted clients. It is intended for backend services, jobs, and operational tools that have a Service Key.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/kotlin/admin/README.md
- SDK Overview: https://edgebase.fun/docs/sdks
- Admin SDK: https://edgebase.fun/docs/sdks/client-vs-server
- Admin Users: https://edgebase.fun/docs/authentication/admin-users
- Database Admin SDK: https://edgebase.fun/docs/database/admin-sdk
- Push Admin SDK: https://edgebase.fun/docs/push/admin-sdk
- Analytics Admin SDK: https://edgebase.fun/docs/analytics/admin-sdk
- Admin SDK Reference: https://edgebase.fun/docs/admin-sdk/reference

## Public Artifact

- `com.github.edge-base.edgebase:edgebase-admin-kotlin:v0.2.3`

## Canonical Examples

### Create an admin client

```kotlin
import dev.edgebase.sdk.admin.AdminEdgeBase

val admin = AdminEdgeBase(
    "https://your-project.edgebase.fun",
    serviceKey = System.getenv("EDGEBASE_SERVICE_KEY") ?: error("Missing EDGEBASE_SERVICE_KEY"),
)
```

### Query a table

```kotlin
val posts = admin
    .db("app")
    .table("posts")
    .where("status", "==", "published")
    .getList()
```

### Query an instance database

```kotlin
val docs = admin
    .db("workspace", instanceId = "ws-1")
    .table("documents")
    .getList()
```

### Manage users

```kotlin
val created = admin.adminAuth.createUser(
    email = "june@example.com",
    password = "pass1234",
    displayName = "June",
)

admin.adminAuth.setCustomClaims(created.id, mapOf("role" to "moderator"))
```

### Execute SQL

```kotlin
val sharedRows = admin.sql(
    namespace = "shared",
    query = "SELECT 1 AS ok",
)

val rows = admin.sql(
    namespace = "workspace",
    instanceId = "ws-1",
    query = "SELECT * FROM documents WHERE status = ?",
    params = listOf("published"),
)
```

### Send push and query analytics

```kotlin
admin.push.send(
    "user-123",
    mapOf("title" to "Hello", "body" to "From the admin SDK"),
)

val overview = admin.analytics.overview(mapOf("range" to "7d"))
```

## Hard Rules

- keep Service Keys on trusted servers only
- `admin.adminAuth` is a property, not a method
- `db(namespace, instanceId = ...)` uses a named `instanceId` parameter in Kotlin
- `sql(namespace = ..., instanceId = ..., query = ..., params = ...)` is the canonical form
- `broadcast(channel, event, payload?)` is a server-side suspend function
- `admin.kv(namespace)`, `admin.d1(database)`, and `admin.vector(index)` expose trusted infra clients

## Common Mistakes

- do not use `edgebase-admin-kotlin` in Android UI code or browser bundles
- do not copy Java-style `adminAuth()` or JS-style `admin.auth`
- do not pass instance ids positionally when the code reads better with `instanceId = ...`
- do not call `sql("select 1")`; Kotlin expects the explicit admin entrypoint signature
- do not expose the Service Key through mobile or browser clients

## Quick Reference

```text
AdminEdgeBase(url, serviceKey, projectId?)                -> AdminEdgeBase
admin.adminAuth                                           -> AdminAuthClient
admin.db(namespace, instanceId?)                          -> DbRef
admin.sql(namespace, instanceId?, query, params)          -> suspend List<Map<String, Any?>>
admin.adminAuth.listUsers(limit?, cursor?)                -> Map<String, Any?>
admin.adminAuth.createUser(...)                           -> Map<String, Any?>
admin.push.send(userId, payload)                          -> Map<String, Any?>
admin.analytics.overview(options)                         -> Map<String, Any?>
admin.broadcast(channel, event, payload?)                 -> suspend Unit
admin.kv(namespace)                                       -> KvClient
admin.d1(database)                                        -> D1Client
admin.vector(index)                                       -> VectorizeClient
admin.destroy()                                           -> Unit
```
