<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase Core Java SDK

Shared Java runtime for EdgeBase.

Use this package when you need the low-level query, storage, error, and field-op
primitives that power the higher-level client and admin SDKs.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Installation

```groovy
repositories {
    maven { url 'https://jitpack.io' }
}

dependencies {
    implementation 'com.github.edge-base.edgebase:edgebase-core-java:v0.2.4'
}
```

If you are building from the monorepo directly, depend on `:packages:core`.

## Main Types

- `EdgeBaseFieldOps`
- `EdgeBaseError`
- `DbRef`
- `TableRef`
- `StorageClient`
- `RoomClient`

## Quick Start

```java
import dev.edgebase.sdk.core.EdgeBaseFieldOps;
import java.util.Map;

Map<String, Object> inc = EdgeBaseFieldOps.increment(1);
Map<String, Object> del = EdgeBaseFieldOps.deleteField();
```

## Notes

- This package is shared by the client and admin Java SDKs.
- Use the higher-level client or admin package for app-facing code.
