# EdgeBase Kotlin Client

Client-side Kotlin Multiplatform SDK for EdgeBase.

Use this module for Android, iOS, JS, and JVM client applications that need auth,
database access, storage, push, analytics, functions, and database-live support.

## Installation

```kotlin
repositories {
    maven("https://jitpack.io")
}

dependencies {
    implementation("com.github.edge-base.edgebase:edgebase-client:v0.1.4")
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
