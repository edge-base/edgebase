<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase Scala SDK

Scala-facing SDK modules that wrap the Java core/admin runtime with Scala-native
collections and result models. Public consumption is intended through JitPack.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Modules

| Module | Artifact | Notes |
| --- | --- | --- |
| `:packages:core` | `com.github.edge-base.edgebase:edgebase-core-scala:v0.2.1` | Scala wrappers for DB, storage, and shared result types |
| `:packages:admin` | `com.github.edge-base.edgebase:edgebase-admin-scala:v0.2.1` | Server-side admin SDK built on top of the Java admin SDK |

If you build from the monorepo directly, depend on the Scala projects under
`packages/sdk/scala`.

## Installation

```scala
resolvers += "jitpack" at "https://jitpack.io"

libraryDependencies ++= Seq(
  "com.github.edge-base.edgebase" % "edgebase-core-scala" % "v0.2.1",
  "com.github.edge-base.edgebase" % "edgebase-admin-scala" % "v0.2.1"
)
```

The public API favors Scala collections and `Option` while delegating protocol
behavior to the existing Java SDK so the admin feature surface stays aligned.

The root umbrella artifact `edgebase-scala` is intentionally excluded from the
public JitPack install path.

## Quick Start

```scala
import dev.edgebase.sdk.scala.admin._

val admin = EdgeBase.admin(
  "https://your-project.edgebase.fun",
  System.getenv("EDGEBASE_SERVICE_KEY")
)

val users = admin.adminAuth.listUsers(limit = Some(20))
val rows = admin.sql("shared", "SELECT 1 AS ok")
```
