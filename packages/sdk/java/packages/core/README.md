# EdgeBase Core Java SDK

Shared Java runtime for EdgeBase.

Use this package when you need the low-level query, storage, error, and field-op
primitives that power the higher-level client and admin SDKs.

## Installation

```groovy
repositories {
    maven { url 'https://jitpack.io' }
}

dependencies {
    implementation 'com.github.edge-base.edgebase:edgebase-core-java:v0.1.4'
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
