# EdgeBase Kotlin Core

Shared Kotlin Multiplatform runtime for EdgeBase.

Use this module when you need the cross-platform HTTP, query, storage, and error
primitives that power the client and admin modules.

## Installation

```kotlin
repositories {
    maven("https://jitpack.io")
}

dependencies {
    implementation("com.github.edge-base.edgebase:edgebase-core:v0.1.4")
}
```

If you are building from the monorepo directly, depend on `:core`. The JitPack route
currently publishes the JVM variant of this shared runtime under the canonical
`edgebase-core` artifact id.

## Main Types

- `HttpClient`
- `TableRef`
- `DbRef`
- `StorageClient`
- `EdgeBaseError`
- `FieldOps`
- `TokenManager`
- `DatabaseLiveClient`

## Notes

- This module is shared by both the `:client` and `:admin` modules.
- Prefer the higher-level client module for end-user code.
