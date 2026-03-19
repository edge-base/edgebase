# EdgeBase Android Java SDK

Client-side Java SDK for Android and desktop JVM applications.

Use this package for app code that needs auth, database, storage, functions,
analytics, push, and room/database-live support.

## Installation

```groovy
repositories {
    maven { url 'https://jitpack.io' }
}

dependencies {
    implementation 'com.github.edge-base.edgebase:edgebase-android-java:v0.1.4'
}
```

If you are building from the monorepo directly, depend on `:packages:android`.

## Main Types

- `dev.edgebase.sdk.client.EdgeBase`
- `ClientEdgeBase`
- `AuthClient`
- `DatabaseLiveClient`
- `PushClient`
- `AnalyticsClient`
- `FunctionsClient`

## Quick Start

```java
import dev.edgebase.sdk.client.ClientEdgeBase;
import dev.edgebase.sdk.client.EdgeBase;

ClientEdgeBase client = EdgeBase.client("https://your-project.edgebase.fun");
```

## Notes

- This is the client package. Prefer `edgebase-admin-java` for trusted server code.
- The `EdgeBase` facade also exposes an admin factory for JVM-only workflows.
