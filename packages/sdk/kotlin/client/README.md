<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase Kotlin Client

Client-side Kotlin Multiplatform SDK for EdgeBase.

Use this module for Android, iOS, JS, and JVM client applications that need auth,
database access, storage, push, analytics, functions, and database-live support.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Installation

```kotlin
repositories {
    maven("https://jitpack.io")
}

dependencies {
    implementation("com.github.edge-base.edgebase:edgebase-client:v0.4.4")
}
```

If you are building from the monorepo directly, depend on `:client`. The current
JitPack route publishes the JVM variant of this module under the canonical
`edgebase-client` artifact id.

## Main Types

- `ClientEdgeBase`
- `AuthClient`
- `DbRef`
- `StorageClient`
- `PushClient`
- `AnalyticsClient`
- `FunctionsClient`
- `RoomClient`

## Quick Start

### Android

Initialize from the current `Activity`; do not use `ClientEdgeBase(url)` on
Android. The explicit activity contract guarantees that UI-bound CAPTCHA and
permission flows work on the first interaction.

```kotlin
import dev.edgebase.sdk.client.AndroidEdgeBase

val client = AndroidEdgeBase.client(
    activity = this,
    url = "https://your-project.edgebase.fun",
    tokenStorage = appSecureDurableTokenStorage,
)
```

### iOS, browser JS, and desktop JVM

```kotlin
import dev.edgebase.sdk.client.ClientEdgeBase

val client = ClientEdgeBase("https://your-project.edgebase.fun")
```

## Notes

- This module is client-side only.
- Prefer `:admin` for trusted server code.
- Android client construction requires `AndroidEdgeBase.client(activity, url, ...)`.
- Android's default store is process memory. Anonymous email/phone upgrades
  require an injected platform-secure `DurableTokenStorage` and fail before the
  request without one.
- Call `client.tryRestoreSession()` before authenticated work after launch.
- Replacement/refresh storage failures and configured CAPTCHA failures are
  surfaced to callers; they are never converted to missing auth/CAPTCHA state.
- CAPTCHA config transport/malformed-response failures are typed failures; only
  an explicit `captcha: null` response is treated as disabled.
- For full Android, iOS, and JS source consumption, use the monorepo `:client` module directly.
