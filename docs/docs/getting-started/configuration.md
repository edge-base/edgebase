---
sidebar_position: 2
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Configuration

EdgeBase is configured through a single `edgebase.config.ts` file at your project root. This file defines your databases, authentication, storage, rooms, push notifications, native resources, access rules, handlers, service keys, rate limiting, and CORS settings.

:::note Config Ownership
`edgebase.config.ts` is the source of truth for **EdgeBase-managed topology**: DB blocks, provider selection, native resource declarations, and managed cron definitions.

`edgebase dev` and `edgebase deploy` evaluate this config and generate the temporary Wrangler bindings they need from it.

`wrangler.toml` still exists, but it is the **Cloudflare runtime base template** for worker-level settings such as the Worker name, compatibility flags, assets, and advanced Wrangler-only options.
:::

## The Big Picture

Before diving in, here's how the main pieces of `edgebase.config.ts` fit together:

```
edgebase.config.ts
├── baseUrl            ← Canonical server URL (OAuth callbacks, email links)
├── release            ← Dev (false) vs production (true) — deny-by-default toggle
├── databases          ← DB blocks — each key is a separate namespace (name is up to you)
│   ├── app            ← Example: single-instance block (one DB for all users)
│   ├── team           ← Example: dynamic block (one DB per team ID)
│   └── ...            ← Add as many blocks as you need, with any name
├── auth               ← Login methods: email, OAuth, phone, passkeys, MFA
├── email              ← Email provider for verification, password reset, magic link
├── sms                ← SMS provider for phone OTP authentication
├── storage            ← File buckets with upload/download rules
├── rooms              ← Server-authoritative real-time rooms (game state, etc.)
├── push               ← Push notification (FCM) configuration
├── kv / d1 / vectorize← Native Cloudflare resources
├── functions          ← Timeout settings (functions live in functions/ dir)
├── plugins            ← First-party and community plugin extensions
├── serviceKeys        ← Server-side API keys for Admin SDKs and backend ops
├── captcha            ← Cloudflare Turnstile bot protection
├── cors               ← Cross-origin settings
├── rateLimiting       ← Per-group rate limits
└── cloudflare         ← Extra Cloudflare config (cron triggers, etc.)
```

The most important concept to understand is **DB blocks** — each key under `databases` creates a separate namespace. There are only **two types**; the block name itself is just a config key you choose freely:

| Type | Config | Backend | Use Case |
| --- | --- | --- | --- |
| **Single-instance** | No `instance` flag | D1 by default, or PostgreSQL / DO when `provider` is set | One database shared by all users — global data like posts, products, announcements |
| **Dynamic** | `instance: true` | Durable Objects + SQLite | One database per instance ID — isolated data like per-user notes, per-team projects, per-tenant CRM |

Block names like `app`, `workspace`, `user`, `store`, `guild` are just examples — pick whatever describes your data. Tables in the **same** DB block can `JOIN` each other because they share one backing database. Tables in **different** DB blocks cannot — use [App Functions](/docs/functions) to combine data across blocks.

## Basic Structure

All table definitions live inside the `databases` object. Each key in `databases` defines a **DB block** -- an isolated namespace that routes either to D1 (single-instance) or to Durable Objects + SQLite (dynamic / explicitly isolated).

```typescript
import { defineConfig } from '@edgebase/shared';

export default defineConfig({
  databases: {
    app: {
      tables: {
        posts: {
          schema: {
            title: { type: 'string', required: true, min: 1, max: 200 },
            content: { type: 'text' },
            status: { type: 'string', enum: ['draft', 'published'], default: 'draft' },
            views: { type: 'number', default: 0 },
            authorId: { type: 'string' },
          },
          indexes: [{ fields: ['status'] }, { fields: ['authorId', 'createdAt'] }],
          fts: ['title', 'content'],
          access: {
            read(auth, row) {
              return true;
            },
            insert(auth) {
              return auth !== null;
            },
            update(auth, row) {
              return auth !== null && auth.id === row.authorId;
            },
            delete(auth, row) {
              return auth !== null && auth.id === row.authorId;
            },
          },
        },
      },
    },
    workspace: {
      instance: true,
      tables: {
        documents: {
          schema: {
            title: { type: 'string', required: true },
            content: { type: 'text' },
          },
        },
      },
    },
    user: {
      instance: true,
      tables: {
        notes: {
          schema: {
            title: { type: 'string', required: true },
            body: { type: 'text' },
          },
        },
      },
    },
  },

  auth: {
    allowedOAuthProviders: ['google', 'github'],
    anonymousAuth: true,
  },

  storage: {
    buckets: {
      avatars: {
        access: {
          read(auth, file) {
            return true;
          },
          write(auth, file) {
            return auth !== null;
          },
          delete(auth, file) {
            return auth !== null;
          },
        },
      },
    },
  },

  cors: {
    origin: ['https://my-app.com', 'http://localhost:3000'],
    credentials: true,
  },
});
```

## Preferred Config Grammar

For runtime product surfaces, EdgeBase now prefers `access + handlers`.

- `access` decides whether an operation is allowed.
- `handlers.hooks` is for interception-style logic such as `before*`, `after*`, `enrich`, and delivery hooks.
- Plugin tables are merged into their target DB block before config materialization, so the same grammar applies there too.

:::tip Release Mode
By default, `release` is `false` -- **access rules are not required** during development. All configured tables and storage buckets are accessible without explicit rules, letting you prototype freely.

Set `release: true` before production deployment to enforce **deny-by-default** -- any table or bucket without explicit access rules will reject all requests:

```typescript
export default defineConfig({
  release: true,
  databases: {
    /* ... */
  },
});
```

Schema is also optional -- `tables: { posts: {} }` is valid for schemaless CRUD.

For rooms, release mode is also fail-closed: `metadata`, `join`, and `action` require either an explicit `access` rule or a `public.*` opt-in.
:::

## Schema Field Types

| Type       | SQLite Type | Description                             |
| ---------- | ----------- | --------------------------------------- |
| `string`   | `TEXT`      | Short text (max 500 chars default)      |
| `text`     | `TEXT`      | Long text (no length limit)             |
| `number`   | `REAL`      | Number (integer or float)               |
| `boolean`  | `INTEGER`   | Boolean (stored as 0 or 1)              |
| `datetime` | `TEXT`      | ISO 8601 datetime string                |
| `json`     | `TEXT`      | JSON object (stored as serialized text) |

## Field Options

| Option       | Type       | Description                                                         |
| ------------ | ---------- | ------------------------------------------------------------------- |
| `required`   | `boolean`  | Field must be present on create                                     |
| `default`    | `any`      | Default value if not provided                                       |
| `unique`     | `boolean`  | Unique constraint                                                   |
| `references` | `string`   | Foreign key reference to another table                              |
| `min`        | `number`   | Minimum value (number) or minimum length (string)                   |
| `max`        | `number`   | Maximum value (number) or maximum length (string)                   |
| `pattern`    | `string`   | Regex validation pattern                                            |
| `enum`       | `string[]` | Restrict to a set of allowed values                                 |
| `check`      | `string`   | Raw SQLite CHECK expression                                         |
| `onUpdate`   | `'now'`    | Automatically set to the current ISO 8601 timestamp on every update |

```typescript
schema: {
  email: { type: 'string', required: true, unique: true, pattern: '^[^@]+@[^@]+$' },
  role: { type: 'string', enum: ['admin', 'editor', 'viewer'], default: 'viewer' },
  score: { type: 'number', min: 0, max: 100 },
  profileId: { type: 'string', references: 'profiles' },
  lastActiveAt: { type: 'datetime', onUpdate: 'now' },
}
```

## Auto-Generated Fields

Every record automatically includes three server-managed fields:

| Field       | Type     | Behavior                                                                                                                                     |
| ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | `string` | UUID v7 (monotonic, sortable by creation time). Auto-generated if not provided; client can supply its own value for offline-first scenarios. |
| `createdAt` | `string` | ISO 8601 timestamp. Set once on creation. Server-enforced -- client-supplied values are ignored.                                             |
| `updatedAt` | `string` | ISO 8601 timestamp. Automatically updated on every write. Server-enforced.                                                                   |

These fields are injected automatically if not defined in the schema. You cannot override their types, but you can disable any of them by setting the field to `false`:

```typescript
tables: {
  events: {
    schema: {
      id: false,          // Disable auto-generated UUID
      createdAt: false,   // Disable auto-generated creation timestamp
      name: { type: 'string', required: true },
    },
  },
}
```

## Tables in the Same DB Block

All tables within the same DB block share a single backing database, which means they can use SQL `JOIN` queries:

```typescript
databases: {
  app: {
    tables: {
      orders: {
        schema: {
          customerId: { type: 'string', required: true },
          total: { type: 'number', required: true },
          status: { type: 'string', enum: ['pending', 'shipped', 'delivered'], default: 'pending' },
        },
      },
      orderItems: {
        schema: {
          orderId: { type: 'string', references: 'orders', required: true },
          productName: { type: 'string', required: true },
          quantity: { type: 'number', required: true },
          price: { type: 'number', required: true },
        },
      },
    },
  },
}
```

Both `orders` and `orderItems` are in the same backing database, enabling JOINs between them.

## Data Isolation (DB Block Namespace)

Each key in `databases` defines a **DB block namespace** that controls how storage is routed. Remember: the name is a config key you choose — there are no reserved names.

### Single-Instance Block (example: `app`)

All tables in a single-instance block live in one backing database. By default, EdgeBase routes these to D1. If you need PostgreSQL, set `provider: 'postgres'` and point `connectionString` at an env key such as `DB_POSTGRES_APP_URL`. If you need SQLite inside a Durable Object instead, set `provider: 'do'`. You can name it anything — `app`, `catalog`, `public`, etc.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// SDK usage
const posts = await client.db('app').table('posts').getList();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final posts = await client.db('app').table('posts').getList();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let posts = try await client.db("app").table("posts").getList()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val posts = client.db("app").table("posts").getList()
```

</TabItem>
<TabItem value="java" label="Java">

```java
ListResult posts = client.db("app").table("posts").getList();
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var posts = await client.Db("app").Table("posts").GetListAsync();
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto posts = client.db("app").table("posts").getList();
```

</TabItem>
</Tabs>

### Dynamic Block — Per-ID Isolation (example: `workspace`)

Each instance ID creates a separate Durable Object. The client provides the ID explicitly. The name `workspace` here is just an example — you could call it `team`, `org`, `guild`, or anything else:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// SDK usage -- client provides the workspace ID
const docs = await client.db('workspace', 'ws-456').table('documents').getList();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final docs = await client.db('workspace', 'ws-456').table('documents').getList();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let docs = try await client.db("workspace", "ws-456").table("documents").getList()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val docs = client.db("workspace", "ws-456").table("documents").getList()
```

</TabItem>
<TabItem value="java" label="Java">

```java
ListResult docs = client.db("workspace", "ws-456").table("documents").getList();
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var docs = await client.Db("workspace", "ws-456").Table("documents").GetListAsync();
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto docs = client.db("workspace", "ws-456").table("documents").getList();
```

</TabItem>
</Tabs>

#### Admin Dashboard Instance Discovery

Dynamic namespaces can teach the Admin Dashboard how to suggest instance IDs instead of forcing manual entry every time. Configure that on the DB block with `admin.instances`.

```typescript
databases: {
  shared: {
    tables: {
      workspaces: {
        schema: {
          name: { type: 'string', required: true },
          slug: { type: 'string' },
        },
      },
    },
  },
  workspace: {
    instance: true,
    admin: {
      instances: {
        source: 'table',
        targetLabel: 'Workspace',
        namespace: 'shared',
        table: 'workspaces',
        idField: 'id',
        labelField: 'name',
        searchFields: ['name', 'slug'],
        helperText: 'Pick a workspace before browsing tenant data.',
      },
    },
    tables: {
      documents: {
        schema: {
          title: { type: 'string', required: true },
        },
      },
    },
  },
}
```

Available strategies:

- `source: 'manual'`: keep a plain instance ID input
- `source: 'table'`: read IDs and labels from a single-instance source table
- `source: 'function'`: return custom suggestions from code, with access to `admin.sql(...)`
- `targetLabel`: controls the noun shown in the Admin UI, such as `Workspace`, `User`, or `Store`

### Dynamic Block — Per-User Isolation (example: `user`)

Same mechanism as above, but scoped to individual users. The client passes the user ID explicitly, and your DB-level `access` rule verifies that it matches the authenticated user:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// SDK usage -- pass the user ID, then verify it in access(auth, id)
const notes = await client.db('user', userId).table('notes').getList();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final notes = await client.db('user', userId).table('notes').getList();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let notes = try await client.db("user", userId).table("notes").getList()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val notes = client.db("user", userId).table("notes").getList()
```

</TabItem>
<TabItem value="java" label="Java">

```java
ListResult notes = client.db("user", userId).table("notes").getList();
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var notes = await client.Db("user", userId).Table("notes").GetListAsync();
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto notes = client.db("user", userId).table("notes").getList();
```

</TabItem>
</Tabs>
This makes per-user data deletion straightforward (GDPR compliance).

### DB Block Access Rules

For any dynamic block (`instance: true`), you can control who is allowed to access or create Durable Objects using DB-level `access` rules:

```typescript
databases: {
  user: {
    access: {
      access(auth, id) { return auth !== null && auth.id === id },
    },
    tables: {
      notes: { schema: { /* ... */ } },
    },
  },
  workspace: {
    access: {
      access(auth, id) { return auth !== null },
      canCreate(auth, id) { return auth !== null },
    },
    tables: {
      documents: { schema: { /* ... */ } },
    },
  },
}
```

- **`access`** -- Evaluated when a client tries to read or write to an existing Durable Object. Receives `auth` (the authenticated user) and `id` (the instance ID).
- **`canCreate`** -- Evaluated when a request would create a new Durable Object (first request to a new namespace + ID combination).

:::note Cross-DB Queries
Direct SQL queries across different DB blocks are not supported -- each Durable Object has its own independent SQLite database. If you need to aggregate data across namespaces, use App Functions to query multiple DB blocks and combine the results.
:::

## Auth

Configure authentication providers and options:

```typescript
export default defineConfig({
  baseUrl: 'https://api.example.com',
  auth: {
    allowedOAuthProviders: ['google', 'github', 'apple', 'discord'],
    anonymousAuth: true,
    allowedRedirectUrls: [
      'https://app.example.com/auth/*',
      'http://localhost:3000/auth/*',
    ],
  },
  captcha: true, // Auto-provisions Cloudflare Turnstile on deploy
  // ...
});
```

Set `baseUrl` to the public origin where your EdgeBase server is reachable. OAuth callbacks, email-action links, and runtime metadata use this as the canonical server URL.

OAuth provider credentials live in `edgebase.config.ts` under `auth.oauth`. In practice, most projects map environment variables into that config object at build time.

### Supported OAuth Providers

Google, GitHub, Apple, Discord, Microsoft, Facebook, Kakao, Naver, X (Twitter), Reddit, Line, Slack, Spotify, and Twitch -- 14 providers total. List only the ones you need in `auth.allowedOAuthProviders`.

### Options

| Option                   | Type       | Default | Description                                                                     |
| ------------------------ | ---------- | ------- | ------------------------------------------------------------------------------- |
| `emailAuth`              | `boolean`  | --      | Enable email/password authentication                                            |
| `anonymousAuth`          | `boolean`  | `false` | Enable anonymous authentication                                                 |
| `phoneAuth`              | `boolean`  | `false` | Enable phone/SMS OTP authentication                                             |
| `allowedOAuthProviders`  | `string[]` | `[]`    | List of enabled OAuth provider names                                             |
| `oauth`                  | `object`   | `--`    | Provider credentials keyed by provider name, plus `auth.oauth.oidc.{name}`       |
| `allowedRedirectUrls`    | `string[]` | `[]`    | Allowlist for OAuth and email-action `redirectUrl` overrides                     |
| `anonymousRetentionDays` | `number`   | `30`    | Days before inactive anonymous accounts are cleaned up                          |
| `cleanupOrphanData`      | `boolean`  | --      | Delete user DB (`user:{id}`) when a user is deleted                             |
| `captcha`                | `boolean`  | --      | Enable Cloudflare Turnstile CAPTCHA on auth endpoints (top-level config option) |

Use `allowedRedirectUrls` if your app passes request-specific redirect targets for OAuth, magic link, password reset, or email change flows.

### Session

```typescript
auth: {
  session: {
    accessTokenTTL: '15m',
    refreshTokenTTL: '7d',
    maxActiveSessions: 5,  // 0 or omit = unlimited
  },
}
```

### Magic Link

Passwordless email login via one-time link:

```typescript
auth: {
  magicLink: {
    enabled: true,
    autoCreate: true,   // Create account if email is not registered (default: true)
    tokenTTL: '15m',    // Token time-to-live (default: '15m')
  },
}
```

### Email OTP

Passwordless email code authentication:

```typescript
auth: {
  emailOtp: {
    enabled: true,
    autoCreate: true,   // Create account if email is not registered (default: true)
  },
}
```

### MFA (TOTP)

```typescript
auth: {
  mfa: { totp: true },
}
```

### Passkeys (WebAuthn)

```typescript
auth: {
  passkeys: {
    enabled: true,
    rpName: 'My App',
    rpID: 'example.com',
    origin: 'https://example.com',
  },
}
```

### Password Policy

Configure password strength requirements. The policy is enforced on sign-up, password change, and password reset.

```typescript
auth: {
  passwordPolicy: {
    minLength: 8,            // default: 8
    requireUppercase: false,  // require at least one uppercase letter
    requireLowercase: false,  // require at least one lowercase letter
    requireNumber: false,     // require at least one digit
    requireSpecial: false,    // require at least one special character
    checkLeaked: false,       // check against Have I Been Pwned (fail-open)
  }
}
```

| Option             | Type      | Default | Description                                                                                                                 |
| ------------------ | --------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `minLength`        | `number`  | `8`     | Minimum password length                                                                                                     |
| `requireUppercase` | `boolean` | `false` | Require at least one uppercase letter (A-Z)                                                                                 |
| `requireLowercase` | `boolean` | `false` | Require at least one lowercase letter (a-z)                                                                                 |
| `requireNumber`    | `boolean` | `false` | Require at least one digit (0-9)                                                                                            |
| `requireSpecial`   | `boolean` | `false` | Require at least one special character                                                                                      |
| `checkLeaked`      | `boolean` | `false` | Check against [Have I Been Pwned](https://haveibeenpwned.com/Passwords) using k-anonymity (fail-open with 3-second timeout) |

See [Password Policy](/docs/authentication/password-policy) for detailed documentation including HIBP privacy model and hash format support.

## Storage

Configure R2-backed file storage buckets with per-bucket access rules:

```typescript
export default defineConfig({
  storage: {
    buckets: {
      avatars: {
        access: {
          read(auth, file) {
            return true;
          },
          write(auth, file) {
            return auth !== null;
          },
          delete(auth, file) {
            return auth !== null;
          },
        },
      },
      documents: {
        access: {
          read(auth, file) {
            return auth !== null;
          },
          write(auth, file) {
            return auth !== null;
          },
          delete(auth, file) {
            return auth !== null && auth.role === 'admin';
          },
        },
      },
    },
  },
  // ...
});
```

Storage access rules support `read`, `write`, and `delete` operations. Each rule is a function that receives `auth` (the authenticated user, or `null`) and `file` (file metadata). With `release: false`, buckets without access rules are accessible to everyone; with `release: true`, buckets without access rules deny all access.

Storage features include signed URLs (download and upload), multipart upload with resume support, and `$0` egress via R2.

## Room

Define server-authoritative real-time rooms with lifecycle hooks and state management:

```typescript
export default defineConfig({
  rooms: {
    game: {
      maxPlayers: 10,
      access: {
        metadata: (auth) => !!auth,
        join: (auth) => !!auth,
        action: (auth) => !!auth,
      },
      handlers: {
        lifecycle: {
          onCreate(room) {
            room.setSharedState(() => ({ turn: 0, score: 0 }));
          },
          onJoin(sender, room) {
            if (sender.role === 'banned') {
              throw new Error('You are banned'); // Rejects the join
            }
            room.setPlayerState(sender.userId, () => ({ hp: 100 }));
          },
        },
        actions: {
          MOVE: (payload, room) => {
            room.setSharedState((s) => ({ ...s, position: payload }));
          },
        },
      },
    },
  },
});
```

| Option              | Type                  | Default           | Description                                               |
| ------------------- | --------------------- | ----------------- | --------------------------------------------------------- |
| `maxPlayers`        | `number`              | `100`             | Max concurrent connections per room                       |
| `reconnectTimeout`  | `number` (ms)         | `30000`           | Grace period before `handlers.lifecycle.onLeave` fires. `0` = immediate |
| `maxStateSize`      | `number` (bytes)      | `1048576`         | Max combined state size (shared + all player states)      |
| `stateSaveInterval` | `number` (ms)         | `60000`           | Auto-save interval to DO Storage                          |
| `stateTTL`          | `number` (ms)         | `86400000`        | Time before persisted state is auto-deleted (24h default) |
| `rateLimit`         | `{ actions: number }` | `{ actions: 10 }` | Rate limit for `send()` calls (per second, token bucket)  |

**Lifecycle hooks:** `handlers.lifecycle.onCreate` → `handlers.lifecycle.onJoin` (throw to reject) → `handlers.actions[type]` → `handlers.lifecycle.onLeave` (reason: `'leave'` \| `'disconnect'` \| `'kicked'`) → `handlers.lifecycle.onDestroy`. Timer handlers live in `handlers.timers`.

In `release: true`, room `metadata`, `join`, and `action` are fail-closed unless you define `access.*` or explicitly opt in with `public.metadata`, `public.join`, or `public.action`.

See [Room Server Guide](/docs/room/server) for lifecycle hooks, state management, and [Room Access Rules](/docs/room/access-rules) for `handlers.lifecycle.onJoin` rejection patterns.

## Push Notifications

Configure Firebase Cloud Messaging for push notifications:

```typescript
export default defineConfig({
  push: {
    fcm: {
      projectId: 'my-firebase-project',
    },
    access: {
      send(auth, target) {
        return auth !== null;
      },
    },
    handlers: {
      hooks: {
        beforeSend: async (_auth, input) => input,
        afterSend: async (_auth, input, output) => {
          console.log(input.kind, output.sent);
        },
      },
    },
  },
});
```

The FCM service account JSON is set via the `PUSH_FCM_SERVICE_ACCOUNT` environment variable, not in the config file.

Push dispatch is server-only — Client SDKs can only register/unregister device tokens. Use `push.access.send` to gate delivery calls and `push.handlers.hooks.beforeSend/afterSend` to transform or observe outbound sends.

See [Push Configuration](/docs/push/configuration) for FCM setup, [Push Access Rules](/docs/push/access-rules) for the delivery gate, and [Push Hooks](/docs/push/hooks) for before/after send interception.

## Native Resources (KV, D1, Vectorize)

Declare Cloudflare-native storage resources for use cases beyond built-in collections:

```typescript
export default defineConfig({
  kv: {
    cache: {
      binding: 'CACHE_KV',
      rules: {
        read(auth) {
          return auth !== null;
        },
        write(auth) {
          return auth !== null && auth.role === 'admin';
        },
      },
    },
  },
  d1: {
    analytics: { binding: 'ANALYTICS_D1' },
  },
  vectorize: {
    embeddings: { dimensions: 1536, metric: 'cosine' },
  },
});
```

All native resource APIs require a [Service Key](/docs/server/service-keys). See [Native Resources](/docs/server/native-resources) for full documentation.

## Email

Configure an email provider for verification emails, password resets, and magic links:

```typescript
export default defineConfig({
  email: {
    provider: 'resend', // 'resend' | 'sendgrid' | 'mailgun' | 'ses'
    apiKey: 'RESEND_API_KEY',
    from: 'noreply@example.com',
    appName: 'My App',
    verifyUrl: 'https://app.com/auth/verify?token={token}',
    resetUrl: 'https://app.com/auth/reset?token={token}',
    magicLinkUrl: 'https://app.com/auth/magic-link?token={token}',
    emailChangeUrl: 'https://app.com/auth/verify-email-change?token={token}',
  },
});
```

These are default templates. The Web SDK and REST API can override them per request with `redirectUrl`.

## SMS

Configure an SMS provider for phone OTP authentication:

```typescript
export default defineConfig({
  sms: {
    provider: 'twilio', // 'twilio' | 'messagebird' | 'vonage'
    accountSid: 'TWILIO_ACCOUNT_SID',
    authToken: 'TWILIO_AUTH_TOKEN',
    from: '+15551234567',
  },
});
```

Authentication delivery hooks live under `auth.handlers.email.onSend` and `auth.handlers.sms.onSend`.

## Authentication Context Hook

Inject request-scoped data into `auth.meta` before access rules are evaluated — useful for workspace roles, org memberships, and feature flags:

```typescript
export default defineConfig({
  auth: {
    handlers: {
      hooks: {
        enrich: async (auth) => ({
          workspaceRole: await lookupRole(auth.id),
        }),
      },
    },
  },
  databases: {
    workspace: {
      access: {
        access(auth) {
          return auth?.meta?.workspaceRole === 'member';
        },
      },
      tables: {
        /* ... */
      },
    },
  },
});
```

The hook runs after JWT verification with a 50ms timeout. On error/timeout, `auth.meta` is set to `{}` (fail-safe). Configure it with `auth.handlers.hooks.enrich`. See [Authentication Context Hook](/docs/server/enrich-auth) for details.

## Service Keys

Server-side API keys that bypass access rules for backend operations:

These same Service Keys are consumed by all Admin SDKs.

```typescript
export default defineConfig({
  serviceKeys: {
    keys: [
      {
        kid: 'backend',
        tier: 'root',
        scopes: ['*'],
        secretSource: 'dashboard',
        secretRef: 'SERVICE_KEY_BACKEND',
      },
    ],
  },
});
```

For admin recovery and other internal root-tier operations, keep one unconstrained root key that points at the canonical `SERVICE_KEY` secret:

```typescript
{
  kid: 'root',
  tier: 'root',
  scopes: ['*'],
  secretSource: 'dashboard',
  secretRef: 'SERVICE_KEY',
}
```

| Tier     | Description                                                      |
| -------- | ---------------------------------------------------------------- |
| `root`   | Full access — bypasses all rules and scopes                      |
| `scoped` | Restricted to listed scopes only (e.g., `db:table:events:write`) |

See [Service Keys](/docs/server/service-keys) for scoped keys, constraints, and key rotation.

## Rate Limiting

Control request rates per group. Each group has a default that you can override:

```typescript
export default defineConfig({
  rateLimiting: {
    db: {
      requests: 200,
      window: '60s',
      binding: { limit: 250, period: 60, namespaceId: '2002' },
    },
    storage: { requests: 50, window: '60s' },
    functions: { requests: 50, window: '60s' },
    auth: { requests: 30, window: '60s' },
    authSignin: { requests: 10, window: '1m' },
    authSignup: { requests: 10, window: '60s' },
    events: { requests: 100, window: '60s' },
  },
  // ...
});
```

`binding` is optional. Use it when you also want `edgebase dev` and `edgebase deploy` to generate matching Cloudflare Rate Limiting Bindings for a built-in group.

Treat these values as **abuse-protection knobs**, not billing or hard quota settings.

### Default Limits

| Group        | Default          | Key   | Description                    |
| ------------ | ---------------- | ----- | ------------------------------ |
| `global`     | 10,000,000 / 60s | IP    | Overall safety net             |
| `db`         | 100 / 60s        | IP    | Database operations            |
| `storage`    | 50 / 60s         | IP    | File uploads/downloads         |
| `functions`  | 50 / 60s         | IP    | Function invocations           |
| `auth`       | 30 / 60s         | IP    | All auth endpoints             |
| `authSignin` | 10 / 1m          | email | Sign-in brute force protection |
| `authSignup` | 10 / 60s         | IP    | Sign-up spam protection        |
| `events`     | 100 / 60s        | IP    | Analytics/event ingestion      |

Exceeding a limit returns `429 Too Many Requests` with a `Retry-After` header.

## CORS

Configure Cross-Origin Resource Sharing:

```typescript
export default defineConfig({
  cors: {
    origin: ['https://my-app.com', 'https://*.my-app.com'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true,
  },
  // ...
});
```

| Option        | Type                 | Default                              | Description                                                            |
| ------------- | -------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| `origin`      | `string \| string[]` | `'*'`                                | Allowed origins. Supports wildcard subdomains (e.g., `*.example.com`). |
| `methods`     | `string[]`           | `['GET', 'POST', 'PATCH', 'DELETE']` | Allowed HTTP methods.                                                  |
| `credentials` | `boolean`            | `false`                              | Whether to include credentials. Cannot be `true` when origin is `'*'`. |

When `origin` is not set, the default is `'*'` (all origins) for development convenience. For production, always specify explicit origins.

## App Functions

Configure scheduled function timeouts:

```typescript
export default defineConfig({
  functions: {
    scheduleFunctionTimeout: '30s',
  },
  cloudflare: {
    extraCrons: ['15 * * * *'],
  },
});
```

Blocking auth and storage hooks use a fixed 5-second timeout and are not configurable.

`cloudflare.extraCrons` adds raw Wrangler cron triggers on top of EdgeBase-managed schedule function crons and the built-in cleanup cron. Use it only when you need additional `scheduled()` wake-ups that are not tied to a specific App Function.

EdgeBase treats the managed cron set as the source of truth during `deploy`. In practice, that means `wrangler.toml`'s `[triggers]` section is replaced from config at deploy time rather than merged manually.

`cloudflare.extraCrons` does not bind a cron to a specific App Function. It only causes Cloudflare to invoke the Worker's `scheduled()` handler at those times, so any extra behavior must be handled inside your scheduled runtime logic.

App Functions are defined in the `functions/` directory, not in the config file. See [App Functions](/docs/functions) for details.

## Plugins

Add first-party or community plugins:

```typescript
import { stripePlugin } from '@edgebase/plugin-stripe';

export default defineConfig({
  plugins: [stripePlugin({ secretKey: process.env.STRIPE_SECRET_KEY! })],
});
```

Each plugin can register its own tables, functions, and authentication hooks under a namespaced prefix. Plugin tables are merged into their target DB block before config materialization, so they can use the same `access + handlers` grammar as first-party tables.

`definePlugin()` also injects the current public `pluginApiVersion` automatically, so deploy can reject plugins built against an incompatible plugin contract.

Plugins can also expose serializable `manifest` metadata from `definePlugin()` for CLI/docs tooling:

- `description`
- `docsUrl`
- `configTemplate`

## Next Steps

- [**Deployment**](./deployment) -- Deploy your project
- [**Access Rules**](../server/access-rules) -- Overview of all access rules across features
- [**Database Client SDK**](../database/client-sdk) -- Start building with the database API
- [**Config Reference**](../server/config-reference) -- Full config option reference
