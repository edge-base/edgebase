# EdgeBase Kotlin Multiplatform SDK

Kotlin Multiplatform (KMP) SDK for EdgeBase — Backend as a Service.

**Supported targets:** Android, iOS, JS (Browser), JVM (Desktop)

## Modules

| Module | Artifact | Targets |
|--------|----------|---------|
| `:core` | `dev.edgebase:edgebase-core` | All (shared types, Ktor HTTP/WebSocket) |
| `:client` | `dev.edgebase:edgebase-client` | Android, iOS, JS, JVM |
| `:admin` | `dev.edgebase:edgebase-admin` | JVM only |

## Installation

### Gradle (Kotlin DSL)

```kotlin
// Client SDK (Android, iOS, JS, JVM)
dependencies {
    implementation("dev.edgebase:edgebase-client:0.2.0")
}

// Admin SDK (JVM only)
dependencies {
    implementation("dev.edgebase:edgebase-admin:0.2.0")
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

## Features

- **Auth**: signUp, signIn, signOut, OAuth, anonymous, sessions, profile
- **Database**: Immutable query builder, CRUD, batch ops, database-live subscriptions (Flow)
- **Storage**: Upload, download, signed URLs, copy, move, resumable uploads
- **Functions**: `client.functions.get/post/put/patch/delete`
- **Analytics**: `client.analytics.track(...)`
- **DatabaseLive**: WebSocket (Ktor), Presence channels, Broadcast channels
- **Admin**: Service Key-based user management (JVM only)

## Requirements

- Kotlin 2.1.10
- Ktor 3.x
- kotlinx-coroutines
- kotlinx-serialization-json
- Android API 26+ / iOS 15+ / JVM 17+ / JS (Browser)
