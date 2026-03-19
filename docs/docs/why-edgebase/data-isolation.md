---
sidebar_position: 2
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Scaling & Data Isolation

How EdgeBase scales infinitely with zero configuration — and why physical data isolation is a natural consequence.

## The Single Database Bottleneck

Every traditional BaaS funnels all traffic through a single database:

```
┌─────────────────────────────────────┐
│         Traditional BaaS            │
│                                     │
│   User A ───┐                       │
│   User B ───┤── Single Database     │
│   User C ───┘   (bottleneck)        │
│                                     │
│   Scale up: replicas, pooling,      │
│   sharding, capacity planning...    │
└─────────────────────────────────────┘
```

This creates compounding problems as you grow:

- **Scaling requires manual intervention** — read replicas, connection pooling, database sharding
- **One tenant's heavy query slows down everyone else** (noisy neighbor)
- **A single SQL injection can expose all tenants' data**
- **Deleting a tenant means `DELETE FROM ... WHERE tenant_id = ?` across every table**

## Serverless DB Blocks — Scale and Isolation by Default

EdgeBase eliminates the single database bottleneck entirely. Each user, workspace, or tenant gets its own **Durable Object with embedded SQLite** — a natural consequence of building on serverless edge infrastructure:

```
┌──────────────────────────────────────────┐
│              EdgeBase                    │
│                                          │
│   Tenant A → DO (SQLite) ─── isolated    │
│   Tenant B → DO (SQLite) ─── isolated    │
│   Tenant C → DO (SQLite) ─── isolated    │
│                                          │
│   Separate processes.                    │
│   No shared memory or storage.           │
│   Data leakage is structurally           │
│   impossible.                            │
└──────────────────────────────────────────┘
```

In EdgeBase, you declare **database blocks** in your config. Each block defines a namespace (the name is up to you), and optionally an instance ID that the client supplies at runtime. There are only two types — single-instance and dynamic:

```typescript
export default defineConfig({
  databases: {
    // Single-instance block — one DB for all users (D1 by default)
    // Name is up to you: "app", "shared", "catalog", etc.
    app: {
      tables: {
        posts: {
          schema: { title: 'string', body: 'text', authorId: 'string' },
          access: {
            read(auth, row) {
              return row.status === 'published' || auth?.id === row.authorId;
            },
            insert(auth) {
              return auth !== null;
            },
            update(auth, row) {
              return auth?.id === row.authorId;
            },
            delete(auth, row) {
              return auth?.role === 'admin';
            },
          },
        },
      },
    },

    // Dynamic block — one DO per (namespace, id) pair
    // Name is up to you: "user", "team", "tenant", "device", etc.
    user: {
      instance: true,
      access: {
        canCreate(auth, id) {
          return auth?.id === id;
        }, // only create your own DB
        access(auth, id) {
          return auth?.id === id;
        }, // only access your own DB
      },
      tables: {
        notes: { schema: { title: 'string', body: 'text' } },
        settings: { schema: { theme: 'string', lang: 'string' } },
      },
    },
  },
});
```

## DB Block Types

There are only **two types** of DB blocks. The block name is a config key you choose — there are no reserved or built-in names.

### Single-Instance Block

One logical database for all users. By default it routes to D1 unless you explicitly set `provider: 'do'`. Best for global data with low write volume or data that doesn't belong to a single owner. Name it anything: `app`, `catalog`, `public`, etc.

```typescript
app: {    // ← name is your choice
  tables: {
    announcements: { schema: { ... } },
    leaderboard:   { schema: { ... } },
  },
}
```

**Client usage:**
<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
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

**Default backend**: D1

### Dynamic Block — Example: Per-User Isolation

Each user gets their own isolated DO. 10 million users → 10 million independent SQLite databases. The name `user` here is just an example — you could call it `profile`, `account`, or anything else.

```typescript
'user:{id}': {
  access: {
    canCreate(auth, id) { return auth?.id === id },
    access(auth, id) { return auth?.id === id },
  },
  tables: {
    notes:    { schema: { title: 'string', body: 'text' } },
    settings: { schema: { theme: 'string', lang: 'string' } },
  },
}
```

**Client usage:**
<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
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

**DO name**: `user:{userId}`

The user ID comes from the JWT `sub` claim, verified by the `access` rule. There is no implicit header injection — the client explicitly passes the ID.

### Dynamic Block — Example: Per-Workspace Isolation (B2B SaaS)

Each workspace is a physically isolated silo. Again, `workspace` is just an example name — use `org`, `team`, `company`, or whatever fits your domain.

```typescript
'workspace:{id}': {
  access: {
    canCreate(auth) { return auth?.custom?.plan === 'pro' },
    async access(auth, id, ctx) {
      const row = await ctx.db.get('workspace_members', `${auth.id}:${id}`);
      return row?.active === true;
    },
    delete(auth, id) { return auth?.role === 'admin' },
  },
  tables: {
    documents: { schema: { title: 'string', authorId: 'string' } },
    invoices:  { schema: { amount: 'number', status: 'string' } },
  },
}
```

**Client usage:**
<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
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

**DO name**: `workspace:ws-456`

The `access` rule queries a membership table on every request — no implicit caching, no token-level claims that can lag. Revoke membership in the DB and the next request is blocked instantly.

### Dynamic Block — Example: Per-Tenant Isolation (Multi-tenant SaaS)

```typescript
'tenant:{id}': {
  access: {
    async access(auth, id, ctx) {
      const member = await ctx.db.get('tenant_members', `${auth.id}:${id}`);
      return member?.active === true;
    },
  },
  tables: {
    crm:      { schema: { ... } },
    invoices: { schema: { ... } },
  },
}
```

**Client usage:**
<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const crm = await client.db('tenant', tenantId).table('crm').getList();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final crm = await client.db('tenant', tenantId).table('crm').getList();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let crm = try await client.db("tenant", tenantId).table("crm").getList()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val crm = client.db("tenant", tenantId).table("crm").getList()
```

</TabItem>
<TabItem value="java" label="Java">

```java
ListResult crm = client.db("tenant", tenantId).table("crm").getList();
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var crm = await client.Db("tenant", tenantId).Table("crm").GetListAsync();
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto crm = client.db("tenant", tenantId).table("crm").getList();
```

</TabItem>
</Tabs>

## Namespace Naming

The namespace name in a DB block (the part before `:{id}`) is **fully customizable** — you can use any string, not just the four examples shown above. Use whatever name makes sense for your domain:

```typescript
// Game with per-guild databases
'guild:{id}': { tables: { members: { ... }, events: { ... } } }

// IoT with per-device databases
'device:{id}': { tables: { readings: { ... }, config: { ... } } }

// Education with per-classroom databases
'classroom:{id}': { tables: { students: { ... }, assignments: { ... } } }

// E-commerce with per-store databases
'store:{id}': { tables: { products: { ... }, orders: { ... } } }
```

The only requirements are:

- **Static DBs** use a plain name (e.g., `shared`, `global`, `public`)
- **Dynamic DBs** use the `name:{id}` pattern where `{id}` is supplied by the client at runtime
- The instance ID must not contain the `:` character (used as a delimiter internally)

## DB-Level Rules

Every dynamic DB block supports three access callbacks:

| Rule        | When called                         | Signature                                         |
| ----------- | ----------------------------------- | ------------------------------------------------- |
| `canCreate` | First access (DO doesn't exist yet) | `(auth, id) => boolean`                           |
| `access`    | Every request to an existing DO     | `(auth, id, ctx?) => boolean \| Promise<boolean>` |
| `delete`    | Admin DO deletion                   | `(auth, id) => boolean`                           |

`canCreate` defaults to **deny** when undefined — you must explicitly opt in to allow new DB creation. This prevents unbounded DO creation by malicious clients.

## Infinite Horizontal Scaling — Zero Configuration

Horizontal scaling is the primary architectural advantage of DB blocks. Traditional BaaS platforms require manual intervention to scale — read replicas, connection pooling, database sharding. With DB blocks, scaling is automatic: every new user, workspace, or tenant creates a new independent instance. There is no configuration change, no migration, and no downtime. 10 users and 10 million users run on the same architecture — the only difference is the number of DO instances.

Since each DB instance is a separate Durable Object:

| Active Instances | Writes/sec per DO | Total Writes/sec |
| ---------------- | ----------------- | ---------------- |
| 1,000            | 500               | 500,000          |
| 100,000          | 500               | 50,000,000       |

No shared locks, no connection pooling, no contention. Each instance handles only its own data.

Each DO has a 10 GB SQLite storage limit:

- **Per-user**: 10 GB per user (more than enough for most apps)
- **Per-workspace**: 10 GB per workspace
- **Per-tenant**: 10 GB per tenant

Total platform storage = 10 GB × number of instances = practically unlimited.

## GDPR and Data Deletion

Deleting a tenant's data is trivial with physical isolation:

```
Traditional BaaS:
  DELETE FROM posts    WHERE tenant_id = 'acme'
  DELETE FROM comments WHERE tenant_id = 'acme'
  DELETE FROM files    WHERE tenant_id = 'acme'
  ... (every table, hope you didn't miss one)

EdgeBase:
  Delete DO "tenant:acme"
  → All data gone. Nothing to miss.
```

## Design Decisions

### Why Not Just RLS?

| Aspect             | RLS (Logical)                  | DB Block (Physical)          |
| ------------------ | ------------------------------ | ---------------------------- |
| Isolation level    | Query filter                   | Separate process + storage   |
| SQL injection risk | Exposes all tenants            | Only one tenant accessible   |
| Noisy neighbor     | Shared DB = shared performance | Independent performance      |
| Data deletion      | Multi-table DELETE             | Delete the DO                |
| GDPR proof         | Must audit query paths         | Structural guarantee         |
| Complexity         | Developer must write RLS rules | Explicit `access()` function |

### When to Use Single-Instance vs Dynamic Blocks

| Data type                                | Recommended type                                                                      | Example name                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------- |
| Global data (announcements, leaderboard) | Single-instance                                                                       | `app`, `catalog`, `public`    |
| Personal data (notes, settings, feeds)   | Dynamic (per-user)                                                                    | `user`, `profile`, `account`  |
| Team/workspace data                      | Dynamic (per-team)                                                                    | `workspace`, `team`, `org`    |
| Enterprise tenant data                   | Dynamic (per-tenant)                                                                  | `tenant`, `company`, `client` |
| Cross-tenant analytics                   | Single-instance with `provider: 'postgres'`, or App Functions to aggregate across DOs | `analytics`                   |

Remember: the names in the "Example name" column are just suggestions — pick whatever describes your data best.

## Next Steps

- [**Data Modeling Guide**](../guides/data-modeling.md) — Decision flowchart for choosing DB block types, anti-patterns, and a quick reference table
- [**Real-World Patterns**](../guides/real-world-patterns.md) — Complete config examples for SaaS, social, marketplace, and chat apps
