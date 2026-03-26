<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# edgebase-admin-kotlin

Trusted JVM-side admin SDK for EdgeBase in Kotlin.

Use this package for backend services, batch jobs, internal tools, and other trusted JVM code that needs Service Key access. It gives you admin auth, service-key database access, raw SQL, push, analytics, functions, and trusted access to KV, D1, and Vectorize.

If you only need lower-level primitives, use the sibling `:core` module instead.

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
- use the real Kotlin property and method shapes
- avoid copying JS, Java, or Python signatures into Kotlin
- choose `edgebase-admin-kotlin` instead of a client-side package

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/kotlin/admin/llms.txt)
- after install, alongside the package files in your build output or dependency cache

## Installation

```kotlin
repositories {
    maven("https://jitpack.io")
}

dependencies {
    implementation("com.github.edge-base.edgebase:edgebase-admin-kotlin:v0.2.5")
}
```

If you consume the monorepo directly, depend on the `:admin` Gradle module from `packages/sdk/kotlin`.

## Quick Start

```kotlin
import dev.edgebase.sdk.admin.AdminEdgeBase

val admin = AdminEdgeBase(
    "https://your-project.edgebase.fun",
    serviceKey = System.getenv("EDGEBASE_SERVICE_KEY") ?: error("Missing EDGEBASE_SERVICE_KEY"),
)

val users = admin.adminAuth.listUsers(limit = 20)

val posts = admin
    .db("app")
    .table("posts")
    .where("status", "==", "published")
    .orderBy("createdAt", "desc")
    .limit(10)
    .getList()

val rows = admin.sql(
    namespace = "shared",
    query = "SELECT COUNT(*) AS total FROM posts WHERE published = ?",
    params = listOf(1),
)

println(users)
println(posts.items)
println(rows)
```

## Core API

- `AdminEdgeBase(url, serviceKey, projectId?)`
  Main admin entry point
- `admin.adminAuth`
  Admin user management
- `admin.db(namespace, instanceId?)`
  Service-key database access
- `admin.sql(namespace, instanceId?, query, params)`
  Raw SQL execution
- `admin.storage`
  Server-side storage access
- `admin.functions`
  Call app functions from trusted code
- `admin.push`
  Send push notifications
- `admin.analytics`
  Query analytics and track server-side events
- `admin.kv(namespace)`, `admin.d1(database)`, `admin.vector(index)`
  Trusted access to platform resources
- `admin.broadcast(channel, event, payload?)`
  Server-side broadcast helper
- `admin.destroy()`
  Close the client

## Kotlin Nuances

```kotlin
admin.adminAuth.createUser(
    email = "admin@example.com",
    password = "secure-pass-123",
)

admin.db("workspace", instanceId = "ws-123")

admin.sql(
    namespace = "workspace",
    instanceId = "ws-123",
    query = "SELECT * FROM documents WHERE status = ?",
    params = listOf("published"),
)

admin.broadcast(
    channel = "announcements",
    event = "system:update",
    payload = mapOf("status" to "deployed"),
)
```

Important shape notes:

- `admin.adminAuth` is a property, not a method
- `db(...)` uses a named `instanceId` parameter
- `sql(...)` uses named arguments well because `query` is required after the optional namespace and instance id
- `broadcast(...)` is a `suspend` function

## License

MIT
