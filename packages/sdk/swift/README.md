# EdgeBase Swift SDK

Swift SDK for EdgeBase.

The public Swift packages are:

- `EdgeBaseCore` for shared HTTP, error, and query primitives
- `EdgeBase` for client apps and trusted service-key workflows via `EdgeBaseServerClient`

## Installation

### Swift Package Manager

Add to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/edge-base/edgebase-swift", from: "0.1.4")
]
```

In Xcode, use File > Add Package Dependencies and point it at the same repository URL.

If you are working inside this monorepo, the source packages live under:

- `packages/sdk/swift/packages/core`
- `packages/sdk/swift/packages/ios`

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
