<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase Android Java SDK

Client-side Java SDK for Android and desktop JVM applications.

Use this package for app code that needs auth, database, storage, functions,
analytics, push, and room/database-live support.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Installation

```groovy
repositories {
    maven { url 'https://jitpack.io' }
}

dependencies {
    implementation 'com.github.edge-base.edgebase:edgebase-android-java:v0.4.1'
}
```

If you are building from the monorepo directly, depend on `:packages:android`.

## Main Types

- `dev.edgebase.sdk.client.EdgeBase`
- `dev.edgebase.sdk.client.AndroidEdgeBase`
- `ClientEdgeBase`
- `AuthClient`
- `DatabaseLiveClient`
- `PushClient`
- `AnalyticsClient`
- `FunctionsClient`

## Quick Start

```java
import dev.edgebase.sdk.client.AndroidEdgeBase;
import dev.edgebase.sdk.client.ClientEdgeBase;

ClientEdgeBase client = AndroidEdgeBase.client(
    this,
    "https://your-project.edgebase.fun",
    appSecureDurableTokenStorage
);
```

## Notes

- Pass the current `Activity` to `AndroidEdgeBase.client(...)`. Calling
  `EdgeBase.client(...)` on Android fails fast by design.
- Android's no-storage overload is process memory. Anonymous `linkWithEmail`
  and `verifyLinkPhone` require an app-provided `DurableTokenStorage` backed by
  platform-secure, process-persistent, full-pair storage; otherwise they fail
  before the request.
- Call `client.tryRestoreSession()` before authenticated work after launch.
- Replacement/refresh persistence and configured CAPTCHA failures are thrown,
  not converted to missing authority.
- CAPTCHA config fetch/malformed-response failures are typed; only an explicit
  `captcha: null` response is treated as disabled.
- This is the client package. Prefer `edgebase-admin-java` for trusted server code.
- The `EdgeBase` facade also exposes an admin factory for JVM-only workflows.
