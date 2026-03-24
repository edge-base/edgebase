<!-- Generated from packages/sdk/scala/packages/admin/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase Scala Admin SDK

Use this file as a quick-reference contract for AI coding assistants working with `edgebase-admin-scala`.

## Package Boundary

Use `edgebase-admin-scala` only in trusted JVM-side code.

Do not ship this package to browser bundles or untrusted clients. It is intended for backend services, jobs, and operational tools that have a Service Key.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/scala/packages/admin/README.md
- SDK Overview: https://edgebase.fun/docs/sdks
- Admin SDK: https://edgebase.fun/docs/sdks/client-vs-server
- Admin Users: https://edgebase.fun/docs/authentication/admin-users
- Database Admin SDK: https://edgebase.fun/docs/database/admin-sdk
- Push Admin SDK: https://edgebase.fun/docs/push/admin-sdk
- Analytics Admin SDK: https://edgebase.fun/docs/analytics/admin-sdk
- Admin SDK Reference: https://edgebase.fun/docs/admin-sdk/reference

## Public Artifact

- `com.github.edge-base.edgebase:edgebase-admin-scala:v0.2.4`

## Canonical Examples

### Create an admin client

```scala
import dev.edgebase.sdk.scala.admin._

val admin = EdgeBase.admin(
  "https://your-project.edgebase.fun",
  System.getenv("EDGEBASE_SERVICE_KEY")
)
```

### Query a table

```scala
val posts = admin
  .db("app")
  .table("posts")
  .where("status", "==", "published")
  .getList()
```

### Query an instance database

```scala
val docs = admin
  .db("workspace", "ws-1")
  .table("documents")
  .getList()
```

### Manage users

```scala
val created = admin.adminAuth.createUser(Map(
  "email" -> "june@example.com",
  "password" -> "pass1234",
  "displayName" -> "June"
))

admin.adminAuth.setCustomClaims(created("id").toString, Map("role" -> "moderator"))
```

### Execute SQL

```scala
val sharedRows = admin.sql("SELECT 1 AS ok")

val rows = admin.sql(
  "workspace",
  "ws-1",
  "SELECT * FROM documents WHERE status = ?",
  Seq("published")
)
```

### Send push and query analytics

```scala
admin.push().send("user-123", Map(
  "title" -> "Hello",
  "body" -> "From the admin SDK"
))

val overview = admin.analytics.overview(Map("range" -> "7d"))
```

## Hard Rules

- keep Service Keys on trusted servers only
- use `admin.adminAuth` for auth, with `admin.auth` as a compatibility alias
- `db(namespace, instanceId)` is the canonical instance-id form
- `sql(query)` defaults to the shared namespace, while the overloaded forms support namespace and instance id
- `broadcast(channel, event, payload?)` is server-side only
- `admin.kv(namespace)`, `admin.d1(database)`, and `admin.vector(index)` expose trusted infra clients

## Common Mistakes

- do not use `edgebase-admin-scala` in browser bundles
- do not write Java-style method chains when Scala property access is available
- do not ignore the `admin.auth` alias if existing Scala code already uses it
- do not expose the Service Key through untrusted clients

## Quick Reference

```text
EdgeBase.admin(url, serviceKey, projectId?)          -> AdminEdgeBase
AdminEdgeBase(url, serviceKey, projectId?)           -> AdminEdgeBase
admin.adminAuth                                      -> AdminAuthClient
admin.auth                                           -> AdminAuthClient
admin.storage                                        -> StorageClient
admin.functions()                                    -> FunctionsClient
admin.analytics                                      -> AnalyticsClient
admin.push()                                         -> PushClient
admin.db(namespace, instanceId?)                     -> DbRef
admin.sql(query)                                     -> List[Any]
admin.sql(namespace, query)                         -> List[Any]
admin.sql(namespace, instanceId, query)             -> List[Any]
admin.sql(namespace, instanceId, query, params)     -> List[Any]
admin.broadcast(channel, event, payload?)           -> Unit
admin.setContext(context)                           -> Unit
admin.context                                       -> Map[String, Any]
admin.getContext()                                  -> Map[String, Any]
admin.destroy()                                     -> Unit
```
