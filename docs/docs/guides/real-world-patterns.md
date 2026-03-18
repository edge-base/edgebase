---
sidebar_position: 3
---

# Real-World Patterns

Complete `edgebase.config.ts` examples for common application types.

:::info Block Names Are Examples
The block names used in these patterns (`user`, `workspace`, `app`, `vendor`, `channel`) are **not** reserved keywords — they are just descriptive names chosen for each example. Pick whatever name fits your domain. What matters is whether you use a **single-instance** block (one DB for everyone) or a **dynamic** block (`instance: true`, one DB per ID).
:::

## Personal Productivity App

A note-taking or todo app where each user has their own private data.

```typescript
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  databases: {
    // user:{id} DB block — each user gets their own isolated DO
    user: {
      access: {
        access(auth, id) { return auth?.id === id },
      },
      tables: {
        notes: {
          schema: {
            title:   { type: 'string', required: true },
            content: { type: 'text' },
            tags:    { type: 'string' },       // comma-separated
            pinned:  { type: 'boolean', default: false },
            color:   { type: 'string' },
          },
          fts: ['title', 'content'],
          access: {
            read(auth) { return auth !== null },
            insert(auth) { return auth !== null },
            update(auth) { return auth !== null },
            delete(auth) { return auth !== null },
          },
        },
        settings: {
          schema: {
            theme:    { type: 'string' },
            language: { type: 'string' },
            fontSize: { type: 'number' },
          },
          access: {
            read(auth) { return auth !== null },
            insert(auth) { return auth !== null },
            update(auth) { return auth !== null },
          },
        },
      },
    },
  },
});
```

**Why this works:**
- Each user gets their own DO → queries are instant (only searching their ~100-1000 notes)
- FTS on `title` and `content` → full-text search across personal notes
- User data deletion is trivial (delete the DO)

**Scaling characteristics:**
- 1M users = 1M independent DOs, each handling its own traffic
- Read performance: microseconds (searching a small personal database)
- Write performance: irrelevant concern (one user can't generate 500 writes/sec)

---

## B2B SaaS Platform

A project management tool where companies have workspaces with team members.

```typescript
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  databases: {
    workspace: {
      access: {
        async access(auth, id, ctx) {
          const m = await ctx.db.get('members', `${auth.id}:${id}`);
          return m !== null;
        },
      },
      tables: {
        // ── Project management (all tables in same DB block → same DO, JOINs OK) ──
        projects: {
          schema: {
            name: { type: 'string' },
            description: { type: 'string' },
            ownerId: { type: 'string' },
            status: { type: 'string' },        // active | archived
          },
          access: {
            read(auth) { return auth !== null },
            insert(auth) { return auth !== null },
            update(auth, row) { return auth?.id === row.ownerId || auth?.meta?.role === 'admin' },
            delete(auth) { return auth?.meta?.role === 'admin' },
          },
        },
        tasks: {
          schema: {
            title: { type: 'string' },
            projectId: { type: 'string' },
            assigneeId: { type: 'string' },
            status: { type: 'string' },        // todo | in_progress | done
            priority: { type: 'number' },
            dueDate: { type: 'string' },
          },
          fts: ['title'],
          access: {
            read(auth) { return auth !== null },
            insert(auth) { return auth !== null },
            update(auth) { return auth !== null },
            delete(auth, row) { return auth?.id === row.assigneeId || auth?.meta?.role === 'admin' },
          },
        },

        // ── Documents (separate DO — independent scaling) ──
        documents: {
          schema: {
            title: { type: 'string' },
            content: { type: 'string' },
            projectId: { type: 'string' },
            authorId: { type: 'string' },
          },
          fts: ['title', 'content'],
          access: {
            read(auth) { return auth !== null },
            insert(auth) { return auth !== null },
            update(auth, row) { return auth?.id === row.authorId || auth?.meta?.role === 'admin' },
            delete(auth) { return auth?.meta?.role === 'admin' },
          },
        },

        members: {
          schema: {
            userId: { type: 'string', required: true },
            role: { type: 'string', default: 'member' },
          },
        },
      },
    },
  },
});
```

**Why this structure?**
- `projects`, `tasks`, and `documents` are all in the same `workspace` DB block → they share a DO per workspace instance, so you can query "all tasks for project X" efficiently with JOINs

**Scaling characteristics:**
- 10,000 companies = 10,000 independent project management DOs
- Each company's data is physically isolated (GDPR compliance is trivial)
- Onboarding a new company = zero infrastructure change

---

## Social Platform

A social app where posts are public but personal data is private.

```typescript
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  databases: {
    // ── Public content (single-instance — everyone reads) ──
    app: {
      tables: {
        posts: {
          schema: {
            content: { type: 'string' },
            authorId: { type: 'string' },
            authorName: { type: 'string' },
            likes: { type: 'number' },
            imageUrl: { type: 'string' },
          },
          fts: ['content'],
          access: {
            read() { return true },                                    // Anyone can browse
            insert(auth) { return auth !== null },                       // Must be signed in
            update(auth, row) { return auth?.id === row.authorId },      // Only author
            delete(auth, row) { return auth?.id === row.authorId || auth?.role === 'admin' },
          },
        },
        comments: {
          schema: {
            postId: { type: 'string' },
            content: { type: 'string' },
            authorId: { type: 'string' },
            authorName: { type: 'string' },
          },
          access: {
            read() { return true },
            insert(auth) { return auth !== null },
            delete(auth, row) { return auth?.id === row.authorId || auth?.role === 'admin' },
          },
        },
      },
    },

    // ── Private data (per-user isolation) ──
    user: {
      access: { access(auth, id) { return auth?.id === id } },
      tables: {
        bookmarks: {
          schema: { postId: { type: 'string' }, savedAt: { type: 'string' } },
          access: {
            read(auth) { return auth !== null },
            insert(auth) { return auth !== null },
            delete(auth) { return auth !== null },
          },
        },
        drafts: {
          schema: { content: { type: 'string' }, imageUrl: { type: 'string' } },
          access: {
            read(auth) { return auth !== null },
            insert(auth) { return auth !== null },
            update(auth) { return auth !== null },
            delete(auth) { return auth !== null },
          },
        },
      },
    },
  },
});
```

**Design insight:**
- `posts` and `comments` are **not** isolated — they're public data that everyone reads
- `bookmarks` and `drafts` are **isolated** per user — private data that only one user accesses
- This is the right split: use access rules for authorization, DB blocks for data ownership

**Why it scales:**
- Public feeds are read-heavy → a single-instance block is a good fit
- If write volume becomes an issue on `posts`, partition by category namespace

---

## Marketplace

A platform where vendors sell products and manage orders.

```typescript
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  databases: {
    // ── Per-vendor data (physically isolated) ──
    vendor: {
      access: {
        async access(auth, id, ctx) {
          const m = await ctx.db.get('members', `${auth.id}:${id}`);
          return m !== null || auth?.meta?.isPublicBrowser === true;
        },
      },
      tables: {
        products: {
          schema: {
            name: { type: 'string' },
            description: { type: 'string' },
            price: { type: 'number' },
            currency: { type: 'string' },
            stock: { type: 'number' },
            category: { type: 'string' },
            imageUrl: { type: 'string' },
            active: { type: 'boolean' },
          },
          fts: ['name', 'description'],
          access: {
            read() { return true },                                    // Anyone can browse
            insert(auth) { return auth?.meta?.role === 'vendor' },       // Only the vendor
            update(auth) { return auth?.meta?.role === 'vendor' },
            delete(auth) { return auth?.meta?.role === 'vendor' },
          },
        },
        orders: {
          schema: {
            productId: { type: 'string' },
            buyerId: { type: 'string' },
            quantity: { type: 'number' },
            totalPrice: { type: 'number' },
            status: { type: 'string' },       // pending | confirmed | shipped | delivered
          },
          access: {
            read(auth, row) { return auth?.meta?.role === 'vendor' || auth?.id === row.buyerId },
            insert(auth) { return auth !== null },
            update(auth) { return auth?.meta?.role === 'vendor' },
          },
        },
        members: {
          schema: {
            userId: { type: 'string', required: true },
            role: { type: 'string', default: 'member' },
          },
        },
      },
    },

    // ── Buyer's private data ──
    user: {
      access: { access(auth, id) { return auth?.id === id } },
      tables: {
        cart: {
          schema: {
            productId: { type: 'string' },
            vendorId: { type: 'string' },
            quantity: { type: 'number' },
          },
          access: {
            read(auth) { return auth !== null },
            insert(auth) { return auth !== null },
            update(auth) { return auth !== null },
            delete(auth) { return auth !== null },
          },
        },
      },
    },
  },
});
```

**Why this pattern?**
- `products` and `orders` are in the same `vendor` DB block → share a DO per vendor, enabling JOINs like "products with their orders"
- Each vendor is physically isolated → vendor A's traffic spike doesn't affect vendor B
- Buyer's `cart` is per-user → instant, private

---

## Chat / Messaging App

A real-time messaging app with channels and direct messages.

```typescript
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  databases: {
    // ── Channel messages (isolated per channel) ──
    channel: {
      tables: {
        messages: {
          schema: {
            content: { type: 'string' },
            authorId: { type: 'string' },
            authorName: { type: 'string' },
            type: { type: 'string' },         // text | image | file
            attachmentUrl: { type: 'string' },
          },
          access: {
            read(auth) { return auth !== null },
            insert(auth) { return auth !== null },
            delete(auth, row) { return auth?.id === row.authorId || auth?.role === 'admin' },
          },
        },
      },
    },

    // ── Channel metadata + user prefs ──
    app: {
      tables: {
        channels: {
          schema: {
            name: { type: 'string' },
            description: { type: 'string' },
            createdBy: { type: 'string' },
            memberCount: { type: 'number' },
            isPrivate: { type: 'boolean' },
          },
          access: {
            read(auth) { return auth !== null },
            insert(auth) { return auth !== null },
            update(auth) { return auth?.role === 'admin' },
          },
        },
      },
    },

    // ── User preferences (per-user) ──
    user: {
      access: { access(auth, id) { return auth?.id === id } },
      tables: {
        userPrefs: {
          schema: {
            mutedChannels: { type: 'string' },    // JSON array
            notificationLevel: { type: 'string' },
          },
          access: {
            read(auth) { return auth !== null },
            insert(auth) { return auth !== null },
            update(auth) { return auth !== null },
          },
        },
      },
    },
  },
});
```

**Why `channel` DB block namespace?**
- Each channel's messages are in their own DO → 10,000 channels = 10,000 independent message stores
- High-volume channels (thousands of messages/sec) don't affect quiet channels
- Combined with EdgeBase Database Subscriptions, each channel gets efficient WebSocket broadcasting

---

## Summary: Choosing Your Pattern

Block names below are just examples — pick whatever fits your domain.

| Question | Block Type | Example |
|---|---|---|
| Does data belong to one user? | Dynamic (per-user) | `databases: { user: { instance: true, ... } }` |
| Does data belong to a team/org? | Dynamic (per-team) | `databases: { workspace: { instance: true, ... } }` |
| Do tables need JOINs? | Same block | Put them under the same DB block key |
| Is it public, read-heavy data? | Single-instance | `databases: { app: { ... } }` + `access` rules |
| Is it high-traffic shared data? | Dynamic (partitioned) | Find a natural partition key, e.g. `channel`, `region` |
| Is it global, low-write data? | Single-instance | `databases: { app: { ... } }` |
