---
sidebar_position: 0
sidebar_label: Overview
slug: /sdks
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# SDK Overview

EdgeBase provides official SDKs for **14 languages**, covering web, mobile, game engines, and server-side backends.

If you need the exact repository split for `core`, `client`, and `admin` by language, see [SDK Layer Matrix](/docs/sdks/layer-matrix).
If you need the current checked-in certification evidence and how to read it, see [SDK Verification Matrix](/docs/sdks/verification-matrix).

## SDK List

| SDK | Type | Platform | Client Package | Admin Package |
|-----|------|----------|:--------------:|:-------------:|
| [JavaScript/TypeScript](#javascripttypescript) | Client + Admin | Web, Node.js, Deno, Bun, React Native | `@edge-base/web` · `@edge-base/react-native` | `@edge-base/admin` |
| [Dart/Flutter](#dartflutter) | Client + Admin | iOS, Android, Web | `edgebase_flutter` | `edgebase_admin` |
| [Swift](#swift) | Client only | iOS, macOS | Swift PM | — |
| [Kotlin](#kotlin) | Client + Admin | Android, iOS, JVM | KMP module | `edgebase-admin-kotlin` |
| [Java](#java) | Client + Admin | Android, JVM | `edgebase-android-java` | `edgebase-admin-java` |
| [Scala](#scala) | Admin only | JVM, Play, Akka, Pekko | — | `edgebase-admin-scala` |
| [Python](#python) | Admin only | Server, Scripts, ML | — | `edgebase-admin` |
| [Go](#go) | Admin only | Server, Microservices | — | `github.com/edge-base/sdk-go` |
| [PHP](#php) | Admin only | Server, WordPress, Laravel | — | `edgebase/admin` |
| [Rust](#rust) | Admin only | Server, CLI, Systems | — | `edgebase-admin` |
| [C#](#c-unity--net) | Client + Admin | Unity, .NET | Source copy / Unity plugin | NuGet |
| [C++](#c-unreal) *(alpha)* | Client only | Unreal Engine 5 | CMake / UE Plugin | — |
| [Ruby](#ruby) | Admin only | Server, Scripts | — | `edgebase_admin` |
| [Elixir](#elixir) | Admin only | Phoenix, Plug, BEAM | — | `edgebase_admin` |

:::info Client vs Admin
**Client SDKs** run in browsers, mobile apps, and game engines — authenticated with user tokens.
**Admin SDKs** run on your backend server — authenticated with a Service Key, bypassing access rules.
See [Admin SDK](/docs/sdks/client-vs-server) for admin-only features and a detailed comparison.
:::

The public docs separate "what exists" from "what is continuously certified." Package layout lives on this page; verified cross-runtime behavior lives in [SDK Verification Matrix](/docs/sdks/verification-matrix).

---

## Installation & Setup

### JavaScript/TypeScript

<Tabs groupId="js-sdk-type">
<TabItem value="client" label="Client SDK" default>

```bash
npm install @edge-base/web
```

```typescript
import { createClient } from '@edge-base/web';

const client = createClient('https://your-project.edgebase.fun');
```

</TabItem>
<TabItem value="admin" label="Admin SDK">

```bash
npm install @edge-base/admin
```

```typescript
import { createAdminClient } from '@edge-base/admin';

const admin = createAdminClient('https://your-project.edgebase.fun', {
  serviceKey: process.env.EDGEBASE_SERVICE_KEY,
});
```

</TabItem>
</Tabs>

### Dart/Flutter

<Tabs groupId="dart-sdk-type">
<TabItem value="client" label="Client SDK (Flutter)" default>

```bash
dart pub add edgebase_flutter
```

```dart
import 'package:edgebase_flutter/edgebase_flutter.dart';

final client = ClientEdgeBase('https://your-project.edgebase.fun');
```

</TabItem>
<TabItem value="admin" label="Admin SDK (Dart)">

```bash
dart pub add edgebase_admin
```

```dart
import 'dart:io';
import 'package:edgebase_admin/edgebase_admin.dart';

final admin = AdminEdgeBase(
  'https://your-project.edgebase.fun',
  serviceKey: Platform.environment['EDGEBASE_SERVICE_KEY']!,
);
```

</TabItem>
</Tabs>

### Swift

> Client SDK only. For admin operations, use a server-side SDK.

```swift
// Package.swift
dependencies: [
    .package(url: "https://github.com/edge-base/edgebase-swift", from: "0.2.6")
]
```

```swift
import EdgeBase

let client = EdgeBaseClient("https://your-project.edgebase.fun")
```

### Kotlin

<Tabs groupId="kotlin-sdk-type">
<TabItem value="client" label="Client SDK (KMP)" default>

Kotlin Client SDK is a **Kotlin Multiplatform** module targeting Android, iOS, macOS, JS, and JVM.

```kotlin
// build.gradle.kts — add the JitPack repository and dependency
repositories {
    maven("https://jitpack.io")
}

dependencies {
    implementation("com.github.edge-base.edgebase:edgebase-client:v0.2.6")
}
```

```kotlin
import dev.edgebase.sdk.client.ClientEdgeBase

val client = ClientEdgeBase("https://your-project.edgebase.fun")
```

</TabItem>
<TabItem value="admin" label="Admin SDK (JVM)">

```kotlin
// build.gradle.kts
repositories {
    maven("https://jitpack.io")
}

dependencies {
    implementation("com.github.edge-base.edgebase:edgebase-admin-kotlin:v0.2.6")
}
```

```kotlin
import dev.edgebase.sdk.admin.AdminEdgeBase

val admin = AdminEdgeBase(
    "https://your-project.edgebase.fun",
    serviceKey = System.getenv("EDGEBASE_SERVICE_KEY") ?: ""
)
```

</TabItem>
</Tabs>

### Java

<Tabs groupId="java-sdk-type">
<TabItem value="client" label="Client SDK (Android)" default>

```groovy
// build.gradle
repositories {
    maven { url 'https://jitpack.io' }
}

dependencies {
    implementation 'com.github.edge-base.edgebase:edgebase-android-java:v0.2.6'
}
```

```java
import dev.edgebase.sdk.client.*;

ClientEdgeBase client = EdgeBase.client("https://your-project.edgebase.fun");
```

</TabItem>
<TabItem value="admin" label="Admin SDK (JVM)">

```groovy
// build.gradle
repositories {
    maven { url 'https://jitpack.io' }
}

dependencies {
    implementation 'com.github.edge-base.edgebase:edgebase-admin-java:v0.2.6'
}
```

```java
import dev.edgebase.sdk.admin.*;

AdminEdgeBase admin = EdgeBase.admin(
    "https://your-project.edgebase.fun",
    System.getenv("EDGEBASE_SERVICE_KEY")
);
```

</TabItem>
</Tabs>

### Scala

> Admin SDK only. Requires a Service Key.

```scala
// build.sbt
resolvers += "jitpack" at "https://jitpack.io"

libraryDependencies += "com.github.edge-base.edgebase" % "edgebase-admin-scala" % "v0.2.6"
```

```scala
import dev.edgebase.sdk.scala.admin.AdminEdgeBase

val admin = AdminEdgeBase(
  "https://your-project.edgebase.fun",
  sys.env("EDGEBASE_SERVICE_KEY")
)
```

### JavaScript — React Native

> For React Native apps, use the dedicated `@edge-base/react-native` package instead of `@edge-base/web`. It keeps the same mental model, but requires explicit async storage wiring and uses React Native lifecycle integrations.

```bash
npm install @edge-base/react-native @react-native-async-storage/async-storage
```

```typescript
import { createClient } from '@edge-base/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const client = createClient('https://your-project.edgebase.fun', {
  storage: AsyncStorage,
});
```

### Python

> Admin SDK only. Requires a Service Key.

```bash
pip install edgebase-admin
```

```python
import os
from edgebase_admin import create_admin_client

admin = create_admin_client(
    'https://your-project.edgebase.fun',
    service_key=os.environ['EDGEBASE_SERVICE_KEY'],
)
```

### Go

> Admin SDK only. Requires a Service Key.

```bash
go get github.com/edge-base/sdk-go
```

```go
import (
    "os"
    edgebase "github.com/edge-base/sdk-go"
)

admin := edgebase.NewAdminClient("https://your-project.edgebase.fun", os.Getenv("EDGEBASE_SERVICE_KEY"))
```

### PHP

> Admin SDK only. Requires a Service Key.

```bash
composer require edgebase/sdk
```

```php
use EdgeBase\Admin\AdminClient;

$admin = new AdminClient('https://your-project.edgebase.fun', getenv('EDGEBASE_SERVICE_KEY'));
```

### Rust

> Admin SDK only. Requires a Service Key.

```toml
# Cargo.toml
[dependencies]
edgebase-admin = "0.2.6"
tokio = "1"
serde_json = "1"
```

```rust
use edgebase_admin::EdgeBase;

let admin = EdgeBase::server(
    "https://your-project.edgebase.fun",
    &std::env::var("EDGEBASE_SERVICE_KEY").unwrap(),
)?;
```

### C# (Unity + .NET)

<Tabs groupId="csharp-sdk-type">
<TabItem value="client" label="Client SDK (Unity)" default>

Copy `packages/sdk/csharp/src/` into your Unity project at `Assets/Plugins/EdgeBase/`.

```csharp
using EdgeBase;

var client = new EdgeBase("https://your-project.edgebase.fun");
```

</TabItem>
<TabItem value="admin" label="Admin SDK (.NET)">

Install via NuGet or reference the project directly.

```csharp
using var admin = new EdgeBase.Admin.AdminClient(
    "https://your-project.edgebase.fun", serviceKey);
var users = await admin.AdminAuth.ListUsersAsync(limit: 50);
var rows = await admin.SqlAsync("shared", "SELECT * FROM posts LIMIT ?", new object[] { 10 });
await admin.BroadcastAsync("chat", "message", new { text = "hello" });
```

</TabItem>
</Tabs>

### C++ (Unreal)

:::caution Alpha
The C++ (Unreal) SDK is in **alpha**. APIs and behavior may change without notice. Not recommended for production use.
:::

> Client SDK only. For admin operations, use a server-side SDK.

**Core (CMake):**

```bash
cd packages/sdk/cpp/core
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

**Unreal Plugin:** Copy `packages/sdk/cpp/unreal/` into your UE project's `Plugins/` directory.

```cpp
#include <edgebase/edgebase.h>

eb::EdgeBase client("https://your-project.edgebase.fun");
```

### Ruby

> Admin SDK only. Requires a Service Key.

```bash
gem install edgebase_admin
```

```ruby
require "edgebase_admin"

admin = EdgebaseAdmin::AdminClient.new(
  "https://your-project.edgebase.fun",
  service_key: ENV.fetch("EDGEBASE_SERVICE_KEY")
)
```

### Elixir

> Admin SDK only. Requires a Service Key.

```elixir
# mix.exs
defp deps do
  [
    {:edgebase_admin, "~> 0.2.6"}
  ]
end
```

```elixir
alias EdgeBaseAdmin

admin =
  EdgeBaseAdmin.new("https://your-project.edgebase.fun",
    service_key: System.fetch_env!("EDGEBASE_SERVICE_KEY")
  )
```

---

## Feature Matrix

> ✅ = Supported &nbsp;&nbsp; — = Not available

| Feature | JS/RN | Dart | Swift | Kotlin | Java | Scala | Python | Go | PHP | Rust | C# | C++ *(alpha)* | Ruby | Elixir |
|---------|:-----:|:----:|:-----:|:------:|:----:|:-----:|:------:|:--:|:---:|:----:|:--:|:---:|:----:|:------:|
| **Auth (signUp/signIn)** | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — | ✅ | ✅ | — | — |
| **OAuth** | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — | ✅ | ✅ | — | — |
| **Collection CRUD** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Batch Operations** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Queries & Filters** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Database Subscriptions (onSnapshot)** | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — | ✅ | ✅ | — | — |
| **Presence** | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — | ✅ | ✅ | — | — |
| **Broadcast** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Room** | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | — |
| **Push (client)** | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — | ✅ | ✅ | — | — |
| **Storage** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Admin Auth** | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| **Raw SQL** | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| **Field Ops (increment/deleteField)** | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Multi-tenancy (db namespace)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Captcha (auto)** | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — | — | ✅ | ✅ | — | — |
| **KV / D1 / Vectorize** | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |

---

## Next Steps

- [**Admin SDK →**](/docs/sdks/client-vs-server) — Admin-only features and detailed comparison
- [**Quickstart →**](/docs/getting-started/quickstart) — Build your first app
- [**Database →**](/docs/database/client-sdk) — Learn database basics
- [**Authentication →**](/docs/authentication/email-password) — Set up user auth
