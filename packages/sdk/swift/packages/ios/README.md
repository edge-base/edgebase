<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase

Client-side Swift package for EdgeBase.

Use this package for iOS and macOS app code that needs auth, database access,
storage, push, analytics, functions, room support, and service-key workflows in
trusted environments.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Installation

Add the public client package repository to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/edge-base/edgebase-swift", from: "0.1.5")
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

## Room Media Transport

The Swift Room surface includes `room.media.transport(...)` with
`cloudflare_realtimekit` as the currently available provider on iOS.

Important runtime note:

- the package itself builds for iOS and macOS
- the bundled RealtimeKit transport is currently wired for iOS
- macOS keeps the same API surface, but `room.media.transport(...)` currently reports unavailable at runtime
- `p2p` is still in progress on Swift

Read more:

- [Room Media Overview](https://edgebase.fun/docs/room/media)
- [Room Media Setup](https://edgebase.fun/docs/room/media-setup)

## Notes

- Use `EdgeBaseClient` for end-user flows.
- Use `EdgeBaseServerClient` only in trusted server-side code.
