# EdgeBase Swift SDK

Swift SDK for [EdgeBase](https://edgebase.fun) — a Global Edge Native BaaS.

## Installation

### Swift Package Manager

Add to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/edge-base/edgebase-swift", from: "1.0.0")
]
```

Or in Xcode: File → Add Package Dependencies → Enter the repository URL.

## Quick Start

```swift
import EdgeBase

let client = EdgeBaseClient("https://your-project.edgebase.fun")

// Sign up
try await client.auth.signUp(email: "user@example.com", password: "password")

// Insert a record
let post = try await client.db("shared").table("posts").insert([
    "title": "Hello EdgeBase",
    "content": "First post from Swift!",
])

// Query records
let published = try await client.db("shared").table("posts")
    .where("status", "==", "published")
    .orderBy("createdAt", "desc")
    .limit(20)
    .getList()

// Functions + Analytics
let summary = try await client.functions.get("feed-summary")
try await client.analytics.track("swift_example_opened")

// Storage
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

- ✅ Auth (signUp/signIn/signOut/OAuth/anonymous/sessions/profile)
- ✅ Database namespaces + table query builder
- ✅ Storage (upload/download/signed URLs/copy/move/resumable)
- ✅ Functions (`client.functions`)
- ✅ Analytics (`client.analytics.track`)
- ✅ DatabaseLive (WebSocket + Presence + Broadcast channels)
- ✅ Field Operations (increment/deleteField)
- ✅ Token auto-refresh with 30s buffer
- ✅ HTTP 401 auto-retry

## Requirements

- iOS 15.0+ / macOS 12.0+
- Swift 5.9+
- No external dependencies

## License

MIT
