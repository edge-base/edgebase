<!-- Generated from packages/sdk/java/packages/admin/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase Java Admin SDK

Use this file as a quick-reference contract for AI coding assistants working with `edgebase-admin-java`.

## Package Boundary

Use `edgebase-admin-java` only in trusted JVM-side code.

Do not ship this package to Android apps, browser bundles, or untrusted clients. It is intended for backend services, jobs, and operational tools that have a Service Key.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/java/packages/admin/README.md
- SDK Overview: https://edgebase.fun/docs/sdks
- Admin SDK: https://edgebase.fun/docs/sdks/client-vs-server
- Admin Users: https://edgebase.fun/docs/authentication/admin-users
- Database Admin SDK: https://edgebase.fun/docs/database/admin-sdk
- Push Admin SDK: https://edgebase.fun/docs/push/admin-sdk
- Analytics Admin SDK: https://edgebase.fun/docs/analytics/admin-sdk
- Admin SDK Reference: https://edgebase.fun/docs/admin-sdk/reference

## Public Artifact

- `com.github.edge-base.edgebase:edgebase-admin-java:v0.2.3`

## Canonical Examples

### Create an admin client

```java
import dev.edgebase.sdk.admin.AdminEdgeBase;

AdminEdgeBase admin = new AdminEdgeBase(
    "https://your-project.edgebase.fun",
    System.getenv("EDGEBASE_SERVICE_KEY"),
    null
);
```

### Query a table

```java
List<?> posts = admin.db("app")
    .table("posts")
    .getList();
```

### Query an instance database

```java
List<?> docs = admin.db("workspace", "ws-1")
    .table("documents")
    .getList();
```

### Manage users

```java
Map<String, Object> created = admin.adminAuth().createUser(Map.of(
    "email", "june@example.com",
    "password", "pass1234",
    "displayName", "June"
));

admin.adminAuth().setCustomClaims(created.get("id").toString(), Map.of("role", "moderator"));
```

### Execute SQL

```java
List<Object> sharedRows = admin.sql("shared", "SELECT 1 AS ok");

List<Object> rows = admin.sql(
    "workspace",
    "ws-1",
    "SELECT * FROM documents WHERE status = ?",
    List.of("published")
);
```

### Send push and query analytics

```java
admin.push().send("user-123", Map.of(
    "title", "Hello",
    "body", "From the admin SDK"
));

Map<String, Object> overview = admin.analytics().overview(Map.of("range", "7d"));
```

## Hard Rules

- keep Service Keys on trusted servers only
- use method accessors such as `admin.adminAuth()` and `admin.storage()`
- `db(namespace, instanceId)` is the canonical instance-id form
- `sql(namespace, query)`, `sql(namespace, query, params)`, `sql(namespace, id, query)`, and `sql(namespace, id, query, params)` are supported overloads
- `broadcast(channel, event, payload?)` is server-side only
- `setContext(...)` and `getContext()` remain available for compatibility
- `admin.kv(namespace)`, `admin.d1(database)`, and `admin.vector(index)` expose trusted infra clients

## Common Mistakes

- do not use `edgebase-admin-java` in client-side Android or browser code
- do not write Kotlin-style property access such as `admin.adminAuth`
- do not use a made-up `createAdminClient(...)` helper in Java
- do not pass an instance id in a named object; use the overloaded `db(...)` and `sql(...)` signatures
- do not expose the Service Key through mobile or browser clients

## Quick Reference

```text
new AdminEdgeBase(url, serviceKey, projectId)          -> AdminEdgeBase
admin.adminAuth()                                      -> AdminAuthClient
admin.storage()                                        -> StorageClient
admin.functions()                                      -> FunctionsClient
admin.analytics()                                      -> AnalyticsClient
admin.push()                                           -> PushClient
admin.db(namespace)                                    -> DbRef
admin.db(namespace, instanceId)                        -> DbRef
admin.sql(namespace, query)                            -> List<Object>
admin.sql(namespace, query, params)                    -> List<Object>
admin.sql(namespace, id, query)                        -> List<Object>
admin.sql(namespace, id, query, params)                -> List<Object>
admin.adminAuth().listUsers(limit)                     -> Map<String, Object>
admin.adminAuth().createUser(data)                     -> Map<String, Object>
admin.push().send(userId, payload)                     -> Map<String, Object>
admin.analytics().overview(options)                    -> Map<String, Object>
admin.broadcast(channel, event, payload?)              -> void
admin.setContext(context)                              -> void
admin.getContext()                                     -> Map<String, Object>
admin.destroy()                                        -> void
```
