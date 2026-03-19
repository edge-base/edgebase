# EdgeBase

Client-side Swift package for EdgeBase.

Use this package for iOS and macOS app code that needs auth, database access,
storage, push, analytics, functions, room support, and service-key workflows in
trusted environments.

## Installation

This package is part of the monorepo at `packages/sdk/swift/packages/ios`.
For SPM distribution, depend on the root Swift package described in the top-level
README.

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
