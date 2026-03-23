<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase Scala Core

Scala wrappers for the shared EdgeBase Java runtime.

Use this package when you want Scala-friendly collections, `Option`, and wrapper
types for the shared database, storage, and error primitives.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Installation

```scala
resolvers += "jitpack" at "https://jitpack.io"

libraryDependencies += "com.github.edge-base.edgebase" % "edgebase-core-scala" % "v0.2.1"
```

If you are building from the monorepo directly, depend on `:packages:core`.

## Main Types

- `EdgeBaseError`
- `ListResult`
- `BatchResult`
- `UpsertResult`
- `DbRef`
- `TableRef`
- `DocRef`
- `StorageClient`

## Notes

- This package wraps the Java core runtime.
- Use the Scala admin package for trusted server-side workflows.
