<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase Kotlin SDK

Kotlin SDK for EdgeBase. The source modules in this directory are Kotlin
Multiplatform, while the current public JitPack path publishes JVM-ready artifacts
for `:core`, `:client`, and `:admin`.

**Supported targets:** Android, iOS, JS (browser), JVM (desktop/server)

Built-in Room Media runtime is currently available on Android, iOS, and JS (browser).
JVM and macOS targets use the same Room client surface, but their Room Media path is
adapter-driven: pass `cloudflareRealtimeKit.clientFactory` or `p2p.transportFactory`
when you create the transport.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Modules

| Module | Artifact | Targets |
| --- | --- | --- |
| `:core` | `com.github.edge-base.edgebase:edgebase-core:v0.2.0` | current JitPack route publishes the JVM variant of the shared runtime |
| `:client` | `com.github.edge-base.edgebase:edgebase-client:v0.2.0` | current JitPack route publishes the JVM variant of the client runtime; built-in Room Media ships on Android/iOS/JS and adapter-driven Room Media is available on JVM |
| `:admin` | `com.github.edge-base.edgebase:edgebase-admin-kotlin:v0.2.0` | JVM only |

If you build from the monorepo directly, depend on the Gradle modules under
`packages/sdk/kotlin`. That path remains the way to consume the full Android, iOS,
and JS source modules until the public multiplatform publication flow is finished.

## Installation

### Gradle (Kotlin DSL)

```kotlin
repositories {
    maven("https://jitpack.io")
}

dependencies {
    implementation("com.github.edge-base.edgebase:edgebase-core:v0.2.0")
    implementation("com.github.edge-base.edgebase:edgebase-client:v0.2.0")
    implementation("com.github.edge-base.edgebase:edgebase-admin-kotlin:v0.2.0")
}
```

## Quick Start

```kotlin
import dev.edgebase.sdk.client.*

val client = ClientEdgeBase("https://your-project.edgebase.fun")

// Auth
client.auth.signUp(email = "user@example.com", password = "secure123")

// Database
val posts = client.db("shared").table("posts")
    .where("status", "==", "published")
    .orderBy("createdAt", "desc")
    .limit(20)
    .getList()

// Functions + Analytics
client.functions.post("welcome-email", mapOf("to" to "user@example.com"))
client.analytics.track("kotlin_example_opened")

// DatabaseLive (Flow)
client.db("shared").table("posts").onSnapshot().collect { change ->
    println("${change.changeType}: ${change.data}")
}

// Cleanup
client.destroy()
```

## Room Media Transport

The Kotlin client surface includes `room.media.transport(...)` everywhere. Built-in
`cloudflare_realtimekit` and `p2p` ship on Android, iOS, and JS (browser). JVM/macOS
use the same transport API through explicit adapter injection.

Important runtime note:

- the Kotlin Multiplatform room surface compiles across Android, iOS, macOS, JS, and JVM
- built-in Room Media runtime providers (`cloudflare_realtimekit` and `p2p`) ship on Android, iOS, and JS (browser)
- JVM and macOS targets use the same API through `cloudflareRealtimeKit.clientFactory` and `p2p.transportFactory`

Current verification note:

- Android, iOS simulator, macOS, JVM, and JS targets all compile from the monorepo
- Android runtime/provider selection is verified for both `cloudflare_realtimekit` and `p2p`
- iOS simulator tests now verify built-in factory availability for both `cloudflare_realtimekit` and `p2p`
- JS browser tests now verify built-in factory availability for both `cloudflare_realtimekit` and `p2p`
- JVM tests verify explicit `cloudflareRealtimeKit.clientFactory` and `p2p.transportFactory` injection paths
- the strongest runtime paths today are Android host-app builds plus iOS simulator transport coverage
- Android host-app smoke builds succeeded once the app used AGP 8.6+ and compileSdk 35+

If you are integrating the Android runtime into an app project, treat these as the current baseline:

- Android Gradle Plugin `8.6+`
- `compileSdk = 35` or newer
- `android.useAndroidX=true`
- `android.enableJetifier=true`

If you are integrating the iOS runtime from the monorepo source modules, the current build expects the matching Cloudflare iOS binary frameworks to be resolved during the Gradle build. That source-build path is now covered in the module's iOS simulator tests.

Read more:

- [Room Media Overview](https://edgebase.fun/docs/room/media)
- [Room Media Setup](https://edgebase.fun/docs/room/media-setup)

## Features

- **Auth**: signUp, signIn, signOut, OAuth, anonymous, sessions, profile
- **Database**: Immutable query builder, CRUD, batch ops, database-live subscriptions (Flow)
- **Storage**: Upload, download, signed URLs, copy, move, resumable uploads
- **Functions**: `client.functions.get/post/put/patch/delete`
- **Analytics**: `client.analytics.track(...)`
- **DatabaseLive**: WebSocket (Ktor), Presence channels, Broadcast channels
- **Admin**: Service Key-based user management (JVM only)

## Publication Notes

- JitPack versions use the repository tag, for example `v0.2.0`
- the public JitPack route validates the JVM publications of `:core` and `:client`
- the umbrella root artifact `edgebase-kotlin` is intentionally excluded from public installs

## Requirements

- Kotlin 2.1.10
- Ktor 3.x
- kotlinx-coroutines
- kotlinx-serialization-json
- Android API 26+ / iOS 15+ / JVM 17+ / JS (Browser)
