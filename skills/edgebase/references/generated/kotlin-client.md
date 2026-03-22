<!-- Generated from packages/sdk/kotlin/client/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase Kotlin Client

Use this file as a quick-reference contract for AI coding assistants working with the
Kotlin client module.

## Package Boundary

Use the client module only in app-facing Kotlin code.

Do not expose Service Keys from this module. For trusted server workflows, use the
Kotlin admin module instead.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/kotlin/client/README.md
- Root README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/kotlin/README.md
- SDK Overview: https://edgebase.fun/docs/sdks
- Admin SDK: https://edgebase.fun/docs/sdks/client-vs-server

## Public Artifact

- `com.github.edge-base.edgebase:edgebase-client:v0.2.0`
- this is the current JitPack JVM publication for the shared `:client` module

## Canonical Examples

### Create a client

```kotlin
val client = ClientEdgeBase("https://your-project.edgebase.fun")
```

### Query a table

```kotlin
val posts = client.db("shared").table("posts").getList()
```

### Track analytics

```kotlin
client.analytics.track("kotlin_example_opened")
```

## Hard Rules

- use `ClientEdgeBase` for app-side code
- do not expose Service Keys through this module
- prefer `:admin` for trusted server-side operations

## Quick Reference

```text
ClientEdgeBase(url)     -> ClientEdgeBase
client.auth             -> AuthClient
client.db(namespace)    -> DbRef
client.storage          -> StorageClient
client.push             -> PushClient
client.functions        -> FunctionsClient
client.analytics        -> AnalyticsClient
client.destroy()        -> Unit
```
