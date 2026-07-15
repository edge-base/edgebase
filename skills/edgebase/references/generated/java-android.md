<!-- Generated from packages/sdk/java/packages/android/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase Android Java SDK

Use this file as a quick-reference contract for AI coding assistants working with the
Java client package.

## Package Boundary

Use `edgebase-android-java` only in client applications or trusted desktop JVM code.

Do not ship admin-only workflows in browser bundles or expose the Service Key in app
code. For backend code, prefer `edgebase-admin-java`.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/java/packages/android/README.md
- Root README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/java/README.md
- SDK Overview: https://edgebase.fun/docs/sdks
- Admin SDK: https://edgebase.fun/docs/sdks/client-vs-server

## Public Artifact

- `com.github.edge-base.edgebase:edgebase-android-java:v0.4.7`

## Canonical Examples

### Create a client

```java
import java.util.List;
import java.util.Map;

import dev.edgebase.sdk.core.EdgeBaseFieldOps;
import dev.edgebase.sdk.client.AndroidEdgeBase;
import dev.edgebase.sdk.client.ClientEdgeBase;

ClientEdgeBase client = AndroidEdgeBase.client(
    activity,
    "https://your-project.edgebase.fun"
);
```

### Query a table

```java
List<?> posts = client.db("shared")
    .table("posts")
    .getList();
```

### Use field operations

```java
client.db("shared").table("posts").update("id", java.util.Map.of(
    "views", EdgeBaseFieldOps.increment(1)
));
```

## Hard Rules

- use `AndroidEdgeBase.client(currentActivity, url, ...)` for Android app-side work
- do not call `EdgeBase.client(...)` on Android; it fails fast without the Activity contract
- inject platform-secure `DurableTokenStorage` before anonymous email/phone upgrades; the memory default is rejected before network
- call `client.tryRestoreSession()` before authenticated work after launch
- token persistence and configured CAPTCHA failures are thrown
- do not expose Service Keys through this package
- prefer the admin package for trusted server-side operations
- use `dev.edgebase.sdk.core.EdgeBaseFieldOps` for atomic field updates

## Quick Reference

```text
AndroidEdgeBase.client(activity, url) -> ClientEdgeBase
client.auth()                      -> AuthClient
client.db(namespace)               -> DbRef
client.storage()                   -> StorageClient
client.functions()                 -> FunctionsClient
client.analytics()                 -> AnalyticsClient
client.push()                      -> PushClient
client.tryRestoreSession()         -> boolean
client.destroy()                   -> void
```
