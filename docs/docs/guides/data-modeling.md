---
sidebar_position: 2
---

# Data Modeling Guide

How to design your DB blocks, choose isolation namespaces, and structure your data for optimal performance.

## The Core Question: Who Owns This Data?

Before creating a table, ask one question:

```
"Who does this data belong to?"
```

The answer determines which **type** of DB block to use (the name is up to you):

```
                    Who owns this data?
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         One user      One team     Everyone
              │            │            │
              ▼            ▼            ▼
         Dynamic       Dynamic     Single-instance
        block with    block with      block
      instance: true  instance: true
      (any name)      (any name)     (any name)
```

## Decision Flowchart

Use this flowchart when designing each table. Remember: the block **name** is just a config key you choose — what matters is the **type** (single-instance vs dynamic):

```
┌─────────────────────────────────────────┐
│  Does each record belong to one user?   │
└──────────────┬──────────────────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
       YES            NO
        │             │
        ▼             │
  Dynamic block       │
  (instance: true)    ▼
  name: your choice   ┌─────────────────────────────────┐
                      │  Does it belong to a team/org?   │
                      └──────────────┬──────────────────┘
                              ┌──────┴──────┐
                              ▼             ▼
                             YES            NO
                              │             │
                              ▼             ▼
                        Dynamic block    Single-instance
                        (instance: true)  block is fine
                        name: your choice  name: your choice
                              │             │
                              ▼             ▼
                        Tables in same  Need tenant or
                        DB block share  hotspot isolation?
                        one backing DB       │
                        (JOIN OK)      ┌─────┴─────┐
                                       ▼           ▼
                                      YES          NO
                                       │           │
                                       ▼           ▼
                                 Use a dynamic   Single-instance
                                 block            block is fine
```

## Pattern Examples

The names used below (`user`, `workspace`, `app`, `channel`) are just examples — pick whatever describes your data. What matters is whether you use a single-instance block or a dynamic block.

### ✅ Per-User Data (dynamic block example)

Data that belongs exclusively to one user. Most common pattern.

```typescript
databases: {
  user: {
    access: { access(auth, id) { return auth?.id === id } },
    tables: {
      // Personal notes — each user's notes are private
      notes: {
        schema: { title: 'string', content: 'string', pinned: 'boolean' },
        access: { read(auth) { return auth !== null }, insert(auth) { return auth !== null } },
      },
      // User settings — one record per user
      settings: {
        schema: { theme: 'string', language: 'string', notifications: 'boolean' },
        access: { read(auth) { return auth !== null }, insert(auth) { return auth !== null } },
      },
    },
  },
}
```

**Why isolate?** Each user gets their own SQLite database. User A's queries never compete with User B's queries. Deleting a user account = just delete the DO.

### ✅ Per-Workspace Data (dynamic block example — B2B SaaS)

Data that belongs to an organization, team, or workspace.

```typescript
databases: {
  workspace: {
    access: {
      async access(auth, id, ctx) {
        const m = await ctx.db.get('members', `${auth.id}:${id}`);
        return m !== null;
      },
    },
    tables: {
      // All tables in this DB block share the same backing DB per workspace — JOIN-capable
      crm: {
        schema: { name: 'string', email: 'string', status: 'string' },
      },
      invoices: {
        schema: { amount: 'number', customerId: 'string', paid: 'boolean' },
      },
      tasks: {
        schema: { title: 'string', assignee: 'string', done: 'boolean' },
      },
    },
  },
}
```

**Why this works?** All tables in the `workspace` DB block share the same backing database per workspace instance, so you can JOIN `crm` and `invoices`: "show all invoices for customer X". But each workspace's data is physically separate.

### ✅ Global Data (single-instance block example)

Data that everyone reads and few people write. No isolation needed.

```typescript
databases: {
  app: {
    tables: {
      // Global announcements — admin writes, everyone reads
      announcements: {
        schema: { title: 'string', content: 'string', priority: 'string' },
        access: {
          read() { return true },                        // Anyone can read
          insert(auth) { return auth?.role === 'admin' },  // Only admins write
        },
      },
      // App configuration — rarely changes
      appConfig: {
        schema: { key: 'string', value: 'string' },
        access: { read() { return true }, insert(auth) { return auth?.role === 'admin' } },
      },
    },
  },
}
```

**Why no isolation?** Write volume is low (admins only), and everyone needs to read the same data. A single-instance block is the simplest fit. By default that routes to D1 unless you explicitly choose `provider: 'do'`.

### ⚠️ High-Traffic Shared Data — Use Isolation Creatively

If shared data has high write volume, find a natural partition key:

```typescript
databases: {
  // ❌ Bad: all chat messages in one global single-instance block
  // app: { tables: { messages: { schema: { ... } } } }

  // ✅ Good: messages partitioned by channel namespace
  channel: {
    tables: {
      messages: {
        schema: { content: 'string', authorId: 'string' },
        access: { read(auth) { return auth !== null }, insert(auth) { return auth !== null } },
      },
    },
  },

  // ✅ Good: leaderboard partitioned by game mode
  gameMode: {
    tables: {
      leaderboard: {
        schema: { userId: 'string', score: 'number' },
        access: { read() { return true }, insert(auth) { return auth !== null } },
      },
    },
  },
}
```

## Read vs Write Performance

For DO-backed isolated blocks (`instance: true` or `provider: 'do'`), the rough performance profile looks like this:

| Operation | Speed | Concurrency | Limit |
|---|---|---|---|
| **Read** (SELECT) | Microseconds (μs) | Effectively unlimited — SQLite reads are fast and non-blocking | Tens of thousands/sec per DO |
| **Write** (INSERT/UPDATE/DELETE) | 1-5ms | Single writer — SQLite write lock | ~200-1,000 writes/sec per DO |

**Key insight**: isolated DO-backed blocks keep SQLite **inside the DO process**, so reads avoid a network hop to a separate database. Single-instance shared blocks default to D1 instead, which is still a good fit for globally shared data but has a different latency/throughput profile.

```
Traditional BaaS:
  App → Network → DB Server → Disk → Response
  Latency: 5-50ms per query

EdgeBase (DO-embedded SQLite):
  App → DO → In-process SQLite → Response
  Latency: ~0.01ms per query (indexed read)
```

Writes are the bottleneck, not reads. If your app is read-heavy (most are), a single-instance block may be sufficient. Use dynamic blocks when:

1. **Write volume is high** — distribute writes across DOs
2. **Data ownership is clear** — users/teams should only see their own data
3. **Privacy/compliance** — physical isolation simplifies GDPR

## Anti-Patterns

### ❌ Over-Isolating

```typescript
// Bad: isolating read-heavy, write-light global data in a dynamic block
databases: { user: { tables: { announcements: { ... } } } }
// Each user gets their own copy of announcements? That doesn't make sense.
// Put it in a single-instance block instead.
```

Only isolate when data **naturally belongs** to the namespace key.

### ❌ Splitting Related Tables Across Namespaces

```typescript
// Bad: related tables in separate namespaces — no JOINs possible
databases: {
  vendorOrders: {
    tables: {
      orders: { schema: { /* ... */ } },
    },
  },
  vendorCatalog: {
    tables: {
      products: { schema: { /* ... */ } },
    },
  },
}

// Good: group them together
databases: {
  vendor: {
    tables: {
      orders:   { schema: { /* ... */ } },
      products: { schema: { /* ... */ } },
    },
  },
}
```

### ❌ Using DB Block Namespace for Access Control

```typescript
// Bad: DB block namespace is not an access rule
databases: { user: { tables: { posts: { ... } } } }
// This means each user has their OWN posts table.
// Other users cannot see these posts at all.

// If you want shared posts with per-user access control, use rules instead:
databases: {
  app: {
    tables: {
      posts: {
        schema: { title: 'string', authorId: 'string', public: 'boolean' },
        access: {
          read(auth, row) { return row.public === true || auth?.id === row.authorId },
          update(auth, row) { return auth?.id === row.authorId },
          delete(auth, row) { return auth?.id === row.authorId },
        },
      },
    },
  },
}
```

DB block namespace = physical separation (different databases).
`access` = logical access control (same database, different permissions).

## Quick Reference

Block names below are just examples — pick whatever fits your domain.

| Your App Type | Block Type | Example Config |
|---|---|---|
| Personal productivity (notes, todo) | Dynamic (per-user) | `databases: { user: { instance: true, ... } }` |
| B2B SaaS (CRM, project management) | Dynamic (per-team) | `databases: { workspace: { instance: true, tables: { ... } } }` — related tables in the same block |
| Marketplace | Dynamic (per-vendor) | `databases: { vendor: { instance: true, tables: { products: {}, orders: {} } } }` |
| Social media | Single-instance + Dynamic | Single-instance block for public posts with `access` rules, dynamic block for private data |
| Chat / messaging | Dynamic (per-channel) | `databases: { channel: { instance: true, ... } }` |
| IoT / device data | Dynamic (per-device) | `databases: { device: { instance: true, ... } }` |
| Content platform (blog, wiki) | Single-instance + Dynamic | Single-instance for public content, dynamic for multi-tenant |
