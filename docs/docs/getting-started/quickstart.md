---
sidebar_position: 1
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Quickstart

Get EdgeBase running in under 5 minutes.

## 1. Create and Start

```bash
npm create edgebase@latest my-app
```

That's it — one command. `create-edgebase` scaffolds the project, installs the local EdgeBase packages, and starts the dev server.
If you only want the files without starting a persistent session, use `npm create edgebase@latest my-app -- --no-dev`.

The scaffold also writes EdgeBase-specific AI hint files into `AGENTS.md` and `.github/copilot-instructions.md` so coding agents can recognize the project structure and pick the right SDK/package boundary more reliably.

The scaffolded project structure:

```
my-app/
├── edgebase.config.ts         ← DB blocks, access rules, auth settings
├── config/
│   └── rate-limits.ts
├── functions/                 ← App functions (DB/HTTP/schedule triggers)
│   └── health.ts
├── .env.development           ← Local dev secrets (JWT keys auto-generated, git-ignored)
├── .env.development.example   ← Template for dev env vars (committed)
├── .env.release.example       ← Template for production env vars (committed)
├── .gitignore
├── package.json
└── wrangler.toml
```

The starter includes auth, storage, and a sample `GET /api/functions/health` endpoint, but it does **not** create a default app table for you.

The Admin Dashboard is available at [http://localhost:8787/admin](http://localhost:8787/admin).

:::tip Restart Later
To restart the dev server after closing it:
```bash
cd my-app
npx edgebase dev
```
Open the dashboard manually at `http://localhost:8787/admin`, or use `npx edgebase dev --open` if you want the browser opened automatically.
:::

:::tip Using AI?
If an agent is helping with the setup, have it read [Use EdgeBase With AI](/docs/getting-started/ai) before it generates runtime-specific code.
:::

## 2. Install an SDK

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```bash
npm install @edge-base/web
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```bash
dart pub add edgebase_flutter
```

</TabItem>
<TabItem value="react-native" label="React Native">

```bash
npm install @edge-base/react-native
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
// Package.swift
dependencies: [
    .package(url: "https://github.com/edge-base/edgebase-swift", from: "0.2.8")
]
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
// build.gradle.kts
repositories {
    maven("https://jitpack.io")
}

dependencies {
    implementation("com.github.edge-base.edgebase:edgebase-client:v0.2.8")
}
```

</TabItem>

<TabItem value="java" label="Java">

```java
// build.gradle
repositories {
    maven { url 'https://jitpack.io' }
}

dependencies {
    implementation 'com.github.edge-base.edgebase:edgebase-android-java:v0.2.8'
}
```

</TabItem>
<TabItem value="csharp" label="C#">

Copy `packages/sdk/csharp/src/` to `Assets/Plugins/EdgeBase/` in your Unity project.

</TabItem>
<TabItem value="cpp" label="C++">

```bash
# Core (CMake)
cd packages/sdk/cpp/core
cmake -B build && cmake --build build
```

</TabItem>
</Tabs>

## 3. Define Your First Table

Add your first DB block to `edgebase.config.ts`:

```typescript
import { defineConfig } from '@edge-base/shared';
import { rateLimiting } from './config/rate-limits';

export default defineConfig({
  databases: {
    app: {
      tables: {
        posts: {
          schema: {
            title: { type: 'string', required: true },
            content: { type: 'text' },
          },
        },
      },
    },
  },

  auth: {
    emailAuth: true,
  },

  storage: {
    buckets: {
      uploads: {},
    },
  },

  serviceKeys: {
    keys: [
      {
        kid: 'root',
        tier: 'root',
        scopes: ['*'],
        secretSource: 'dashboard',
        secretRef: 'SERVICE_KEY',
      },
    ],
  },

  rateLimiting,

  cors: {
    origin: '*',
  },
});
```

The local dev server reloads automatically. Once the config updates, the `app.posts` table appears in the dashboard and SDK calls below will work as-is.

If you prefer, you can do the same thing from the local Admin Dashboard in dev mode: create a database block first, then add the first table from the schema editor. Both flows write back to `edgebase.config.ts`.

## 4. Connect and Use

:::tip Localhost on mobile
`http://localhost:8787` works from the browser on your dev machine. For mobile runtimes, use a device-reachable address instead:

- Android emulator: `http://10.0.2.2:8787`
- iOS simulator: `http://127.0.0.1:8787`
- Physical device: `http://<your-lan-ip>:8787`
:::

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
import { createClient } from '@edge-base/web';

const client = createClient('http://localhost:8787');

// Sign up
await client.auth.signUp({ email: 'user@example.com', password: 'password123' });

// Create a record
await client.db('app').table('posts').insert({
  title: 'Hello EdgeBase!',
  content: 'My first post.',
});

// Query records
const posts = await client.db('app').table('posts')
  .where('title', 'contains', 'Hello')
  .orderBy('createdAt', 'desc')
  .limit(10)
  .getList();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
import 'package:edgebase_flutter/edgebase_flutter.dart';

final client = ClientEdgeBase('http://localhost:8787');

// Sign up
await client.auth.signUp(SignUpOptions(email: 'user@example.com', password: 'password123'));

// Create a record
await client.db('app').table('posts').insert({
  'title': 'Hello EdgeBase!',
  'content': 'My first post.',
});

// Query records
final posts = await client.db('app').table('posts')
    .where('title', 'contains', 'Hello')
    .orderBy('createdAt', direction: 'desc')
    .limit(10)
    .getList();
```

</TabItem>
<TabItem value="react-native" label="React Native">

```typescript
import { createClient } from '@edge-base/react-native';

const client = createClient('http://localhost:8787');

// Sign up
await client.auth.signUp({ email: 'user@example.com', password: 'password123' });

// Create a record
await client.db('app').table('posts').insert({
  title: 'Hello EdgeBase!',
  content: 'My first post.',
});

// Query records
const posts = await client.db('app').table('posts')
  .where('title', 'contains', 'Hello')
  .orderBy('createdAt', 'desc')
  .limit(10)
  .getList();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
import EdgeBase

let client = EdgeBaseClient("http://localhost:8787")

// Sign up
try await client.auth.signUp(email: "user@example.com", password: "password123")

// Create a record
try await client.db("app").table("posts").insert([
    "title": "Hello EdgeBase!",
    "content": "My first post."
])

// Query records
let posts = try await client.db("app").table("posts")
    .where("title", .contains, "Hello")
    .orderBy("createdAt", .desc)
    .limit(10)
    .getList()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
import dev.edgebase.sdk.client.ClientEdgeBase

val client = ClientEdgeBase("http://localhost:8787")

// Sign up
client.auth.signUp(email = "user@example.com", password = "password123")

// Create a record
client.db("app").table("posts").insert(mapOf(
    "title" to "Hello EdgeBase!",
    "content" to "My first post."
))

// Query records
val posts = client.db("app").table("posts")
    .where("title", "contains", "Hello")
    .orderBy("createdAt", "desc")
    .limit(10)
    .getList()
```

</TabItem>

<TabItem value="java" label="Java">

```java
import dev.edgebase.sdk.client.*;

ClientEdgeBase client = EdgeBase.client("http://localhost:8787");

// Sign up
client.auth().signUp("user@example.com", "password123");

// Create a record
client.db("app").table("posts").insert(Map.of(
    "title", "Hello EdgeBase!",
    "content", "My first post."
));

// Query records
ListResult posts = client.db("app").table("posts")
    .where("title", "contains", "Hello")
    .orderBy("createdAt", "desc")
    .limit(10)
    .getList();
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
using EdgeBase;

var client = new EdgeBase("http://localhost:8787");

// Sign up
await client.Auth.SignUpAsync("user@example.com", "password123");

// Create a record
var post = await client.Db("app").Table("posts").InsertAsync(new() {
    ["title"] = "Hello EdgeBase!",
    ["content"] = "My first post.",
});

// Query records
var posts = await client.Db("app").Table("posts")
    .Where("title", "contains", "Hello")
    .OrderBy("createdAt", "desc")
    .Limit(10)
    .GetListAsync();
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
#include <edgebase/edgebase.h>

eb::EdgeBase client("http://localhost:8787");

// Sign up
auto result = client.auth().signUp("user@example.com", "password123");

// Create a record
auto post = client.db("app").table("posts").insert(R"({
    "title": "Hello EdgeBase!",
    "content": "My first post."
})");

// Query records
auto posts = client.db("app").table("posts")
    .where("title", "contains", "Hello")
    .orderBy("createdAt", "desc")
    .limit(10)
    .getList();
```

</TabItem>
</Tabs>

:::tip DB Blocks — Two Types, Any Name
EdgeBase databases are organized into **DB blocks**. There are only two types:

- **Single-instance** — one database, no instance ID needed (D1 by default). Example: `client.db('app')`
- **Dynamic** (`instance: true`) — one database per ID, physically isolated. Example: `client.db('notes', userId)`

The block name (`app`, `notes`, `team`, `store` — anything you want) is just a config key, not a reserved keyword. The quickstart uses a single-instance block; when you need per-user or per-team isolation, add a dynamic block in your config:

```typescript
// Single-instance block — one DB for everyone
const posts = await client.db('app').table('posts').getList();

// Dynamic block — one DB per instance ID (isolated)
const notes = await client.db('notes', userId).table('notes').getList();
```

See [Isolation & Multi-tenancy](/docs/why-edgebase/data-isolation) for details.
:::

## 5. Deploy Or Package

```bash
# Cloudflare Edge (global serverless)
npx edgebase deploy

# Docker self-hosting
npx edgebase docker build
npx edgebase docker run

# Direct run (any Node.js server)
npx edgebase dev

# Portable local handoff
npx edgebase pack --format portable

# Single-file archive handoff
npx edgebase pack --format archive
```

`deploy`, `docker`, and `dev` are the three runtime environments. `pack` builds a distributable local artifact from that same app bundle when you want a portable launcher or archive instead of a cloud/container rollout.

## Next Steps

- [**Configuration →**](./configuration) — Customize your `edgebase.config.ts`
- [**Static Frontend →**](./static-frontend) — Configure prebuilt frontend asset serving
- [**Packaging →**](./packaging) — Create portable or archive local handoff builds
- [**Database →**](../database/client-sdk) — Learn CRUD operations
- [**Authentication →**](../authentication/email-password) — Set up user auth
