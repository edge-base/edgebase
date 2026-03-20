<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase Kotlin Client

Client-side Kotlin Multiplatform SDK for EdgeBase.

Use this module for Android, iOS, JS, and JVM client applications that need auth,
database access, storage, push, analytics, functions, and database-live support.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Installation

```kotlin
repositories {
    maven("https://jitpack.io")
}

dependencies {
    implementation("com.github.edge-base.edgebase:edgebase-client:v0.1.5")
}
```

If you are building from the monorepo directly, depend on `:client`. The current
JitPack route publishes the JVM variant of this module under the canonical
`edgebase-client` artifact id.

## Main Types

- `ClientEdgeBase`
- `AuthClient`
- `DbRef`
- `StorageClient`
- `PushClient`
- `AnalyticsClient`
- `FunctionsClient`
- `RoomClient`

## Quick Start

```kotlin
import dev.edgebase.sdk.client.ClientEdgeBase

val client = ClientEdgeBase("https://your-project.edgebase.fun")
```

## Notes

- This module is client-side only.
- Prefer `:admin` for trusted server code.
- For full Android, iOS, and JS source consumption, use the monorepo `:client` module directly.
