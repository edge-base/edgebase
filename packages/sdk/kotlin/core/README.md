<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase Kotlin Core

Shared Kotlin Multiplatform runtime for EdgeBase.

Use this module when you need the cross-platform HTTP, query, storage, and error
primitives that power the client and admin modules.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Installation

```kotlin
repositories {
    maven("https://jitpack.io")
}

dependencies {
    implementation("com.github.edge-base.edgebase:edgebase-core:v0.2.8")
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
