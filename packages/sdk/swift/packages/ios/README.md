<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase

Client-side Swift package for EdgeBase.

Use this package for iOS app code that needs auth, database access, storage,
push, analytics, functions, room support, and service-key workflows in trusted
environments.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Installation

Add the public client package repository to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/edge-base/edgebase-swift", from: "0.4.3")
]
```

Then depend on the product:

```swift
.product(name: "EdgeBase", package: "edgebase-swift")
```

`EdgeBase` pulls in `EdgeBaseCore` transitively from `edgebase-swift-core`.

The source of truth lives in the EdgeBase monorepo at `packages/sdk/swift/packages/ios`.

## Main Types

- `EdgeBaseClient`
- `EdgeBaseServerClient`
- `AuthClient`
- `DbRef`
- `StorageClient`
- `PushClient`
- `FunctionsClient`
- `AnalyticsClient`

## Quick Start

```swift
import EdgeBase

let client = EdgeBaseClient("https://your-project.edgebase.fun")
```

## Notes

- Use `EdgeBaseClient` for end-user flows.
- Use `EdgeBaseServerClient` only in trusted server-side code.
- `EdgeBaseClient` uses Keychain by default. Call
  `try await client.tryRestoreSession()` before authenticated work after launch.
- Anonymous `linkWithEmail` and `verifyLinkPhone` require a
  `DurableTokenStorage`; memory-only/custom unmarked storage fails before the
  request so a replacement session cannot be lost on process termination.
- Token/refresh persistence failures and incomplete stored pairs are thrown
  before new auth state is exposed.
- Configured CAPTCHA failures throw `CaptchaUnavailableError` rather than
  silently behaving as if CAPTCHA were disabled.
- Config fetch/malformed-response failures use stable typed reasons; only an
  explicit `captcha: null` response is treated as disabled.
