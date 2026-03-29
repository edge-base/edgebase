<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase Swift SDK

Swift SDK for EdgeBase.

The public Swift packages are split across two SwiftPM repositories:

- `edgebase-swift-core` exposes `EdgeBaseCore` for shared HTTP, error, and query primitives
- `edgebase-swift` exposes `EdgeBase` for client apps and trusted service-key workflows via `EdgeBaseServerClient`

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Installation

### Swift Package Manager

Use the higher-level client package for most app and trusted-service workflows:

```swift
dependencies: [
    .package(url: "https://github.com/edge-base/edgebase-swift", from: "0.2.7")
]
```

If you only need the low-level shared primitives, install `EdgeBaseCore` directly:

```swift
dependencies: [
    .package(url: "https://github.com/edge-base/edgebase-swift-core", from: "0.2.7")
]
```

In Xcode, use File > Add Package Dependencies and point it at the same repository URL.

If you are working inside this monorepo, the source packages live under:

- `packages/sdk/swift/packages/core`
- `packages/sdk/swift/packages/ios`

The public mirror repositories are generated from those monorepo paths.

## Quick Start

```swift
import EdgeBase

let client = EdgeBaseClient("https://your-project.edgebase.fun")
let admin = EdgeBaseServerClient("https://your-project.edgebase.fun", serviceKey: "sk-...")

try await client.auth.signUp(email: "user@example.com", password: "password")

let post = try await client.db("shared").table("posts").insert([
    "title": "Hello EdgeBase",
    "content": "First post from Swift!",
])

let published = try await client.db("shared").table("posts")
    .where("status", "==", "published")
    .orderBy("createdAt", "desc")
    .limit(20)
    .getList()

try await admin.adminAuth.createUser(
    email: "admin@example.com",
    password: "pass123!",
)

let bucket = client.storage.bucket("avatars")
try await bucket.upload("profile.png", data: imageData)
let url = await bucket.getUrl("profile.png")
```

## Token Storage

By default, tokens are stored in Keychain. For testing, use `MemoryTokenStorage`:

```swift
let client = EdgeBaseClient("https://...", tokenStorage: MemoryTokenStorage())
```

## Features

- Auth, including sessions, profile updates, and anonymous sign-in
- Database namespaces and table query builder
- Storage upload/download/signed URL support
- Functions, analytics, and database-live subscriptions
- Field operations for atomic increment and delete
- Service-key admin workflows via `EdgeBaseServerClient`
- Token auto-refresh with a 30s buffer
- HTTP 401 auto-retry

## Requirements

- iOS 15.0+ / macOS 12.0+
- Swift 5.9+
- No external dependencies

## License

MIT
