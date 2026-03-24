<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# edgebase-admin-scala

Trusted JVM-side admin SDK for EdgeBase in Scala.

Use this package for backend services, jobs, and internal tools that hold a Service Key. It wraps the Java admin runtime with Scala-friendly helpers while exposing admin auth, service-key database access, raw SQL, push, analytics, functions, and trusted access to KV, D1, and Vectorize.

If you only need lower-level primitives, use the sibling `edgebase-core-scala` package instead.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Documentation Map

- [SDK Overview](https://edgebase.fun/docs/sdks)
  Install commands and the language matrix for all public SDKs
- [Admin SDK](https://edgebase.fun/docs/sdks/client-vs-server)
  Service-key concepts, trust boundaries, and admin-only capabilities
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
  Cross-language auth, database, storage, functions, and push examples
- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
  Table queries, filters, pagination, batch writes, and raw SQL
- [Admin Users](https://edgebase.fun/docs/authentication/admin-users)
  Create, update, delete, and manage users
- [Push Admin SDK](https://edgebase.fun/docs/push/admin-sdk)
  Push notification sending, topic broadcast, token lookup, and logs
- [Analytics Admin SDK](https://edgebase.fun/docs/analytics/admin-sdk)
  Metrics, event tracking, and analytics queries
- [Server Native Resources](https://edgebase.fun/docs/server/native-resources)
  KV, D1, Vectorize, and other edge-native resources

## For AI Coding Assistants

This package ships with an `llms.txt` file for AI-assisted development.

Use it when you want an agent or code assistant to:

- keep Service Key logic on the server
- use the Scala wrappers instead of Java method syntax directly
- avoid copying Kotlin, Java, or JavaScript signatures into Scala
- choose `edgebase-admin-scala` instead of a client-side package

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/scala/packages/admin/llms.txt)
- after install, alongside the package files in your build or dependency cache

## Installation

```scala
resolvers += "jitpack" at "https://jitpack.io"

libraryDependencies += "com.github.edge-base.edgebase" % "edgebase-admin-scala" % "v0.2.4"
```

This package wraps the Java admin runtime, so it stays JVM-only and publishes as a single Scala/JVM artifact.

## Quick Start

```scala
import dev.edgebase.sdk.scala.admin._

val admin = EdgeBase.admin(
  "https://your-project.edgebase.fun",
  System.getenv("EDGEBASE_SERVICE_KEY")
)

val users = admin.adminAuth.listUsers(limit = Some(20))

val posts = admin
  .db("app")
  .table("posts")
  .where("status", "==", "published")
  .getList()

val rows = admin.sql(
  "shared",
  "SELECT COUNT(*) AS total FROM posts WHERE published = ?",
  Seq(1)
)

println(users)
println(posts)
println(rows)
```

## Core API

- `AdminEdgeBase(url, serviceKey, projectId?)`
  Main admin entry point
- `EdgeBase.admin(url, serviceKey, projectId?)`
  Convenience factory
- `admin.adminAuth`
  Admin user management
- `admin.auth`
  Alias for `admin.adminAuth`
- `admin.db(namespace, instanceId?)`
  Service-key database access
- `admin.sql(...)`
  Raw SQL execution
- `admin.storage`
  Server-side storage access
- `admin.functions`
  Call app functions from trusted code
- `admin.push()`
  Send push notifications
- `admin.analytics`
  Query analytics and track server-side events
- `admin.kv(namespace)`, `admin.d1(database)`, `admin.vector(index)`
  Trusted access to platform resources
- `admin.broadcast(channel, event, payload?)`
  Server-side broadcast helper
- `admin.setContext(...)`, `admin.context`, `admin.getContext()`
  Legacy context access
- `admin.destroy()`
  Close the client

## Scala Nuances

```scala
val created = admin.adminAuth.createUser(Map(
  "email" -> "admin@example.com",
  "password" -> "secure-pass-123"
))

val docs = admin.db("workspace", "ws-123")

val rows = admin.sql(
  "workspace",
  "ws-123",
  "SELECT * FROM documents WHERE status = ?",
  Seq("published")
)

admin.broadcast("announcements", "system:update", Map("status" -> "deployed"))
```

Important shape notes:

- `admin.adminAuth` and `admin.storage` are properties
- `admin.auth` is a compatibility alias for `admin.adminAuth`
- `admin.push()` and `admin.functions()` are methods
- `db(...)` supports both default and instance-id overloads
- `sql(...)` returns a Scala-friendly `List[Any]`

## License

MIT
