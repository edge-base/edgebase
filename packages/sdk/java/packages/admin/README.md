<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# edgebase-admin-java

Trusted JVM-side admin SDK for EdgeBase in Java.

Use this package for backend services, Spring apps, batch jobs, and operational tooling that hold a Service Key. It gives you admin auth, service-key database access, raw SQL, push, analytics, functions, and trusted access to KV, D1, and Vectorize.

If you only need lower-level primitives, use the sibling `edgebase-core-java` package instead.

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
- use Java method accessors instead of property access
- avoid copying Kotlin, Scala, or JavaScript signatures into Java
- choose `edgebase-admin-java` instead of a client-side package

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/java/packages/admin/llms.txt)
- after install, alongside the package files in your Maven or Gradle cache

## Installation

```gradle
repositories {
    maven { url = uri("https://jitpack.io") }
}

dependencies {
    implementation("com.github.edge-base.edgebase:edgebase-admin-java:v0.2.4")
}
```

If you build from the monorepo directly, depend on the Java admin Gradle project from `packages/sdk/java/packages/admin`.

## Quick Start

```java
import dev.edgebase.sdk.admin.AdminEdgeBase;
import java.util.List;
import java.util.Map;

AdminEdgeBase admin = new AdminEdgeBase(
    "https://your-project.edgebase.fun",
    System.getenv("EDGEBASE_SERVICE_KEY"),
    null
);

Map<String, Object> created = admin.adminAuth().createUser(Map.of(
    "email", "admin@example.com",
    "password", "secure-pass-123"
));

List<?> posts = admin.db("app").table("posts").getList();

List<Object> rows = admin.sql(
    "shared",
    "SELECT COUNT(*) AS total FROM posts WHERE published = ?",
    List.of(1)
);

admin.push().send("user-123", Map.of(
    "title", "Deployment finished",
    "body", "Your content is live."
));
```

## Core API

- `new AdminEdgeBase(url, serviceKey, projectId)`
  Main admin entry point
- `admin.adminAuth()`
  Admin user management
- `admin.db(namespace)` and `admin.db(namespace, instanceId)`
  Service-key database access
- `admin.sql(...)`
  Raw SQL execution
- `admin.storage()`
  Server-side storage access
- `admin.functions()`
  Call app functions from trusted code
- `admin.push()`
  Send push notifications
- `admin.analytics()`
  Query analytics and track server-side events
- `admin.kv(namespace)`, `admin.d1(database)`, `admin.vector(index)`
  Trusted access to platform resources
- `admin.broadcast(channel, event, payload?)`
  Server-side broadcast helper
- `admin.setContext(...)`, `admin.getContext()`
  Legacy context access
- `admin.destroy()`
  Close the client

## Java Nuances

```java
admin.adminAuth().listUsers(20);

admin.db("workspace", "ws-123");

admin.sql("workspace", "ws-123", "SELECT * FROM documents WHERE status = ?", List.of("published"));

admin.broadcast("announcements", "system:update", Map.of("status", "deployed"));

admin.setContext(Map.of("tenant", "acme"));
Map<String, Object> context = admin.getContext();
```

Important shape notes:

- `adminAuth()`, `storage()`, `functions()`, `analytics()`, and `push()` are methods
- `db(...)` is overloaded, so the instance id can be supplied as the second argument
- `sql(...)` also has overloads, including shared-namespace and instance-id forms
- `broadcast(...)` returns `void`
- `setContext(...)` and `getContext()` are still present for compatibility

## License

MIT
