<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBaseCore

Shared Swift package for EdgeBase.

Use this package when you need the low-level HTTP, query, error, and storage
primitives that power the higher-level Swift client package.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Installation

Add the public core package repository to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/edge-base/edgebase-swift-core", from: "0.2.6")
]
```

Then depend on the product:

```swift
.product(name: "EdgeBaseCore", package: "edgebase-swift-core")
```

The source of truth lives in the EdgeBase monorepo at `packages/sdk/swift/packages/core`.

## Main Types

- `HttpClient`
- `TableRef`
- `DbRef`
- `StorageClient`
- `EdgeBaseError`
- `EdgeBaseAuthError`
- `FieldOps`
- `TokenManager`

## Notes

- This package is the shared foundation for the Swift client package.
- Prefer the higher-level `EdgeBase` package for app code.
