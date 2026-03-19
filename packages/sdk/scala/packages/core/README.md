# EdgeBase Scala Core

Scala wrappers for the shared EdgeBase Java runtime.

Use this package when you want Scala-friendly collections, `Option`, and wrapper
types for the shared database, storage, and error primitives.

## Installation

```scala
resolvers += "jitpack" at "https://jitpack.io"

libraryDependencies += "com.github.edge-base.edgebase" % "edgebase-core-scala" % "v0.1.4"
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
