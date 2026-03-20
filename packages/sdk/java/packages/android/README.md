<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase Android Java SDK

Client-side Java SDK for Android and desktop JVM applications.

Use this package for app code that needs auth, database, storage, functions,
analytics, push, and room/database-live support.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Installation

```groovy
repositories {
    maven { url 'https://jitpack.io' }
}

dependencies {
    implementation 'com.github.edge-base.edgebase:edgebase-android-java:v0.1.5'
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
