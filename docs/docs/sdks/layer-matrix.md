---
sidebar_position: 1
---

# SDK Layer Matrix

EdgeBase SDKs are not packaged the same way in every language.

Some ecosystems expose a clean three-way split:

- `core`: low-level shared/generated layer
- `client`: user-token, app-facing SDK
- `admin`: service-key, server-side SDK

Other ecosystems only expose a subset, or combine some layers into a single package.

This page reflects what exists in the repository today.

Today that means **14 SDK languages** total, with **12 languages** exposing an admin/server-side surface.

For the latest certified behavior across `dev`, `docker`, and `deployed`, see [SDK Verification Matrix](/docs/sdks/verification-matrix).

## Summary

<div className="docs-table-scroll" role="region" aria-label="SDK layer summary table">

| Language | Core | Client | Admin | Notes |
| --- | --- | --- | --- | --- |
| JavaScript / TypeScript | `@edgebase/core` | `@edgebase/web`, `@edgebase/react-native` | `@edgebase/admin` | `@edgebase/ssr` is a separate server-side user-context package |
| Dart / Flutter | `edgebase_core` | `edgebase_flutter` | `edgebase_admin` | Full split |
| Kotlin | `:core` | `:client` | `:admin` | KMP core/client, JVM admin |
| Java | `edgebase-core-java` | `edgebase-android-java` | `edgebase-admin-java` | Split by package |
| Scala | `edgebase-core-scala` | No dedicated package | `edgebase-admin-scala` | Scala-facing wrappers over the Java runtime |
| Swift | `EdgeBaseCore` | `EdgeBase` | No dedicated package | `EdgeBaseServerClient` exists in `packages/ios`, but is not documented as a standalone admin SDK |
| C# | `EdgeBase.Core` | `EdgeBase.Unity` | `EdgeBase.Admin` | Full split in repo |
| C++ *(alpha)* | `packages/core` | `packages/unreal` | No dedicated package | Unreal wrapper over shared C++ core |
| Python | `edgebase-core` | No dedicated package | `edgebase-admin` | Root `edgebase` package is a combined entrypoint, but there is no separate client-only package |
| Go | Embedded | No dedicated package | `github.com/edgebase/sdk-go` | Single server-only SDK |
| PHP | `edgebase/core` | No dedicated package | `edgebase/admin` | Server-only split |
| Rust | `edgebase-core` | No dedicated package | `edgebase-admin` | Server-only split |
| Ruby | `edgebase_core` | No dedicated package | `edgebase_admin` | Server-only split |
| Elixir | `edgebase_core` | No dedicated package | `edgebase_admin` | Server-only split |

</div>

## Captcha Runtime Support

Layer packaging and captcha runtime support are related but different questions. For the full Turnstile behavior guide and platform notes, see [Captcha (Bot Protection)](/docs/authentication/captcha).

Legend:
- `✅`: supported and validated in a current example/runtime flow
- `◐`: supported by the SDK or target host, but still depends on a specific host/plugin or has not been fully re-validated in every runtime
- `—`: no client-side captcha path

<div className="runtime-support-table" role="region" aria-label="Captcha runtime support matrix">
  <table>
    <thead>
      <tr>
        <th>Client SDK</th>
        <th>Android</th>
        <th>iOS</th>
        <th>macOS</th>
        <th>Windows</th>
        <th>Linux</th>
        <th>Web</th>
      </tr>
    </thead>
    <tbody>
      <tr><td><code>@edgebase/web</code></td><td>—</td><td>—</td><td>✅</td><td>◐</td><td>◐</td><td>✅</td></tr>
      <tr><td><code>@edgebase/react-native</code></td><td>✅</td><td>✅</td><td>—</td><td>—</td><td>—</td><td>✅</td></tr>
      <tr><td><code>edgebase_flutter</code></td><td>✅</td><td>✅</td><td>✅</td><td>◐</td><td>◐</td><td>✅</td></tr>
      <tr><td><code>EdgeBase</code> (Swift)</td><td>—</td><td>✅</td><td>✅</td><td>—</td><td>—</td><td>—</td></tr>
      <tr><td><code>:client</code> (Kotlin KMP)</td><td>✅</td><td>✅</td><td>✅</td><td>—</td><td>—</td><td>✅</td></tr>
      <tr><td><code>edgebase-android-java</code></td><td>✅</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
      <tr><td><code>EdgeBase.Unity</code></td><td>✅</td><td>✅</td><td>✅</td><td>◐</td><td>◐</td><td>✅</td></tr>
      <tr><td><code>packages/unreal</code></td><td>✅</td><td>✅</td><td>✅</td><td>◐</td><td>◐</td><td>—</td></tr>
    </tbody>
  </table>
</div>

Notes:
- `@edgebase/web` desktop columns mean browser-hosted runtimes such as Electron renderer processes, not a native desktop-only SDK.
- `:client` (Kotlin KMP) uses a no-op JVM captcha provider, so Windows/Linux desktop JVM targets are intentionally not marked supported here.
- `EdgeBase.Unity` desktop support depends on a supported WebView host. The current macOS path is validated through an embedded `gree/unity-webview` window. Other desktop targets still require a supported host integration or a custom `TurnstileProvider.SetWebViewFactory(...)`.
- `packages/unreal` uses the built-in browser runtime on supported targets; macOS, Android, and iOS are validated in the current example app flow.
- Admin/server SDKs are not listed here because Service Key requests bypass captcha by design.

## Push Client Support

Push support is also runtime-sensitive, but the important question is slightly different from captcha. The client-side push surface is a combination of **token registration**, **permission handling**, **foreground/opened-app callbacks**, and **topic helpers**. For the full product split between Client SDK and Admin SDK, see [Push SDK Support](/docs/push/sdk-support).

Legend:
- `✅`: first-class client surface documented in the current SDK guide
- `◐`: supported, but depends on the target host, plugin wiring, or excludes part of the package's runtime set
- `—`: not exposed on that client SDK surface

<div className="docs-table-scroll" role="region" aria-label="Push client support matrix">

| Client SDK | Token Registration | Permission Helpers | Foreground / Opened-App Callbacks | Topic Subscribe | Notes |
| --- | --- | --- | --- | --- | --- |
| `@edgebase/web` | ✅ | ✅ | ✅ | ✅ | Browser + service worker flow through FCM on the web client surface |
| `@edgebase/react-native` | ✅ | ✅ | ✅ | ✅ | Requires Firebase and React Native host integration |
| `edgebase_flutter` | ✅ | ✅ | ✅ | ✅ | Flutter client surface documents registration, callbacks, and topic helpers |
| `EdgeBase` (Swift) | ✅ | ✅ | ✅ | ✅ | iOS/macOS Apple client surface |
| `:client` (Kotlin KMP) | ◐ | ◐ | ◐ | ◐ | Native mobile targets are supported; JVM desktop push methods are explicitly no-ops |
| `edgebase-android-java` | ✅ | ✅ | ✅ | ✅ | Android-only Java client surface |
| `EdgeBase.Unity` | ✅ | ◐ | ✅ | ✅ | Permission handling depends on native plugins or Unity Mobile Notifications integration |
| `packages/unreal` | ✅ | ◐ | ✅ | — | Topic subscription is not available in the C++ / Unreal SDK |

</div>

Notes:
- All **12 Admin SDKs** support the backend push surface: send, topic operations, broadcast, logs, and token inspection.
- The push matrix is intentionally SDK-surface oriented. Firebase project setup and OS-native notification provisioning are still required separately.
- `packages/unreal` supports token registration and message callbacks, but topic subscription is intentionally absent from the client SDK.
- `:client` (Kotlin KMP) documents push for native mobile targets, while JVM desktop targets intentionally no-op the push surface.

## Core Layer

The core layer is the shared low-level surface: HTTP transport, generated API methods, shared table/storage primitives, and other reusable building blocks.

<div className="docs-table-scroll" role="region" aria-label="SDK core layer table">

| Language | Package / Module | Repo Path | Notes |
| --- | --- | --- | --- |
| JavaScript / TypeScript | `@edgebase/core` | `packages/sdk/js/packages/core` | Public low-level package used by web/admin/ssr |
| Dart / Flutter | `edgebase_core` | `packages/sdk/dart/packages/core` | Shared package used by Flutter and admin |
| Kotlin | `:core` | `packages/sdk/kotlin/core` | KMP core module |
| Java | `edgebase-core-java` | `packages/sdk/java/packages/core` | Shared Java core |
| Scala | `edgebase-core-scala` | `packages/sdk/scala/packages/core` | Scala wrapper layer over the Java core |
| Swift | `EdgeBaseCore` | `packages/sdk/swift/packages/core` | Shared SwiftPM core package |
| C# | `EdgeBase.Core` | `packages/sdk/csharp/packages/core` | Shared .NET core package |
| C++ | `packages/core` | `packages/sdk/cpp/packages/core` | Shared C++ core library |
| Python | `edgebase-core` | `packages/sdk/python/packages/core` | Split core package exists alongside root package |
| Go | Embedded | `packages/sdk/go` | No separate core package; low-level API lives inside the single Go SDK |
| PHP | `edgebase/core` | `packages/sdk/php/packages/core` | Shared Composer package |
| Rust | `edgebase-core` | `packages/sdk/rust/packages/core` | Shared crate |
| Ruby | `edgebase_core` | `packages/sdk/ruby/packages/core` | Shared gem |
| Elixir | `edgebase_core` | `packages/sdk/elixir/packages/core` | Shared Mix package for HTTP/runtime, DB, and storage helpers |

</div>

## Client Layer

The client layer is the app-facing SDK intended for browser, mobile, desktop, or game clients using user auth tokens and access rules.

<div className="docs-table-scroll" role="region" aria-label="SDK client layer table">

| Language | Package / Module | Repo Path | Notes |
| --- | --- | --- | --- |
| JavaScript / TypeScript | `@edgebase/web` | `packages/sdk/js/packages/web` | Browser/client package |
| JavaScript / TypeScript | `@edgebase/react-native` | `packages/sdk/react-native` | React Native client variant |
| JavaScript / TypeScript | `@edgebase/ssr` | `packages/sdk/js/packages/ssr` | Server-side user-context package; not an admin SDK |
| Dart / Flutter | `edgebase_flutter` | `packages/sdk/dart/packages/flutter` | Flutter client package |
| Kotlin | `:client` | `packages/sdk/kotlin/client` | KMP client module |
| Java | `edgebase-android-java` | `packages/sdk/java/packages/android` | Android/JVM client package |
| Scala | No dedicated package | `packages/sdk/scala` | No client SDK; Scala currently targets the server/admin surface |
| Swift | `EdgeBase` | `packages/sdk/swift/packages/ios` | Client-facing Swift package |
| C# | `EdgeBase.Unity` | `packages/sdk/csharp/packages/unity` | Unity client package |
| C++ | `packages/unreal` | `packages/sdk/cpp/packages/unreal` | Unreal Engine client wrapper |
| Python | No dedicated package | `packages/sdk/python` | Root `edgebase` package is combined, but there is no separate client-only package |
| Go | No dedicated package | `packages/sdk/go` | No client SDK |
| PHP | No dedicated package | `packages/sdk/php` | No client SDK |
| Rust | No dedicated package | `packages/sdk/rust` | No client SDK |
| Ruby | No dedicated package | `packages/sdk/ruby` | No client SDK |
| Elixir | No dedicated package | `packages/sdk/elixir` | No client SDK; Elixir currently targets the server/admin surface |

</div>

## Admin Layer

The admin layer is the service-key surface for server-side code, bypassing access rules and exposing admin-only features such as admin auth, SQL, KV, D1, Vectorize, and other native resources.

<div className="docs-table-scroll" role="region" aria-label="SDK admin layer table">

| Language | Package / Module | Repo Path | Notes |
| --- | --- | --- | --- |
| JavaScript / TypeScript | `@edgebase/admin` | `packages/sdk/js/packages/admin` | Dedicated admin package |
| Dart / Flutter | `edgebase_admin` | `packages/sdk/dart/packages/admin` | Dedicated admin package |
| Kotlin | `:admin` | `packages/sdk/kotlin/admin` | JVM admin module |
| Java | `edgebase-admin-java` | `packages/sdk/java/packages/admin` | Dedicated admin package |
| Scala | `edgebase-admin-scala` | `packages/sdk/scala/packages/admin` | Scala-native facade over the Java admin runtime |
| Swift | No dedicated package | `packages/sdk/swift/packages/ios` | `EdgeBaseServerClient` exists in the iOS package, but there is no separate documented admin package |
| C# | `EdgeBase.Admin` | `packages/sdk/csharp/packages/admin` | Dedicated admin package in repo |
| C++ | No dedicated package | `packages/sdk/cpp` | No admin SDK |
| Python | `edgebase-admin` | `packages/sdk/python/packages/admin` | Split admin package exists; root `edgebase` package is combined |
| Go | `github.com/edgebase/sdk-go` | `packages/sdk/go` | Single server-only SDK |
| PHP | `edgebase/admin` | `packages/sdk/php/packages/admin` | Dedicated admin package |
| Rust | `edgebase-admin` | `packages/sdk/rust/packages/admin` | Dedicated admin crate |
| Ruby | `edgebase_admin` | `packages/sdk/ruby/packages/admin` | Dedicated admin gem |
| Elixir | `edgebase_admin` | `packages/sdk/elixir/packages/admin` | Dedicated Mix package for service-key/server-side usage |

</div>

## Reading This Matrix

- If a language shows `No dedicated package`, that means the layer is either absent or only present as an internal/helper surface, not as a clean public package boundary.
- If a language shows `Embedded`, the low-level API exists, but it is packaged inside a single SDK rather than split into its own module.
- This page is intentionally repo-based. It is meant to clarify what modules actually exist today, not just the simplified marketing overview.
