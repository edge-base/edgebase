---
sidebar_position: 2
---

# Creating Plugins

This tutorial walks you through building an EdgeBase plugin **from zero**. We'll start with the simplest possible plugin (one table, three lines) and add features one at a time until you have a full-featured plugin with functions, authentication hooks, storage hooks, and migrations.

:::tip TL;DR
A plugin is just a function that returns tables, functions, and hooks. EdgeBase merges them into the project at build time. The server never knows plugins exist.
:::

---

## The Big Picture

Before diving into code, here's what a plugin does:

```
You write this:                    EdgeBase does this at build time:
┌─────────────────────┐            ┌─────────────────────────────────┐
│ definePlugin({      │            │ 1. Namespace all resources       │
│   name: 'my-plugin',│  ──────►  │    my-plugin/customers (table)   │
│   tables: {...},    │            │    my-plugin/sync     (function) │
│   functions: {...}, │            │ 2. Merge into the project        │
│   hooks: {...},     │            │ 3. Bundle into Worker            │
│ })                  │            │ 4. Deploy                        │
└─────────────────────┘            └─────────────────────────────────┘
```

The server sees regular tables and functions — it has no concept of "plugins." Your plugin code runs as part of the same Worker, with zero overhead.

---

## Step 0: Scaffold (optional)

```bash
npx edgebase create-plugin my-plugin
```

This creates a starter project. But you don't _need_ the CLI — any npm package that exports a `definePlugin()` result works. Let's build one by hand to understand how it works.

---

## Step 1: The Simplest Plugin

Create a new directory and init:

```bash
mkdir my-plugin && cd my-plugin
npm init -y
npm install @edge-base/plugin-core
```

Now create `src/index.ts`:

```typescript title="src/index.ts"
import { definePlugin } from '@edge-base/plugin-core';

export const myPlugin = definePlugin({
  name: 'my-plugin',

  tables: {
    items: {
      schema: {
        title: { type: 'string', required: true },
        done: { type: 'boolean', default: false },
      },
    },
  },
});
```

**That's it.** This is a valid plugin. When someone installs it and adds it to their config, they get a `my-plugin/items` table in their database.

`definePlugin()` automatically writes the current public `pluginApiVersion` into the resolved plugin instance. That means normal plugin authors do not need to manually keep a compatibility field in sync.

### How Users Install Your Plugin

```typescript title="edgebase.config.ts (user's project)"
import { defineConfig } from '@edge-base/shared';
import { myPlugin } from 'my-plugin';

export default defineConfig({
  plugins: [
    myPlugin({}), // ← factory call with config (empty here)
  ],
});
```

After `npx edgebase deploy`, the table is live. Users can query it:

```typescript
// Client-side
const items = await client.db('app').table('my-plugin/items').getList();
```

---

## Step 2: Add User Config

Most plugins need configuration from the user (API keys, feature flags, etc.). Use a TypeScript generic to get type safety:

```typescript title="src/index.ts"
import { definePlugin } from '@edge-base/plugin-core';

// highlight-start
// 1. Define what config your plugin needs
interface MyPluginConfig {
  apiKey: string;
  enableNotifications?: boolean; // optional with default
}
// highlight-end

// highlight-start
// 2. Pass it as a generic — now every handler gets typed pluginConfig
export const myPlugin = definePlugin<MyPluginConfig>({
  // highlight-end
  name: 'my-plugin',
  version: '0.1.0',
  manifest: {
    description: 'Status checks and item management',
    configTemplate: {
      apiKey: 'CHANGE_ME',
      enableNotifications: true,
    },
  },

  tables: {
    items: {
      schema: {
        title: { type: 'string', required: true },
        done: { type: 'boolean', default: false },
      },
    },
  },

  functions: {
    'check-status': {
      trigger: { type: 'http', method: 'GET' },
      handler: async (ctx) => {
        // highlight-next-line
        const key = ctx.pluginConfig.apiKey; // ← fully typed as string
        return Response.json({ configured: !!key });
      },
    },
  },
});
```

Now the user **must** provide `apiKey`:

```typescript title="edgebase.config.ts (user's project)"
plugins: [
  myPlugin({
    apiKey: process.env.MY_API_KEY!,     // ← required (TypeScript enforces this)
    enableNotifications: true,            // ← optional
  }),
],
```

### How Config Injection Works

```
myPlugin({ apiKey: 'sk_...' })
  │
  ├─ Factory closure captures the config object
  ├─ Every handler/hook is wrapped: ctx.pluginConfig = capturedConfig
  └─ Server has zero knowledge of this — it's pure JavaScript closures
```

No global state, no side effects. Each plugin instance is independent.

If you ever bypass `definePlugin()` and construct a raw `PluginInstance` yourself, you must also set the current plugin API version. Using the factory is the supported path.

---

## Step 3: Add Tables with Access + Handlers

Tables support the full EdgeBase schema system — types, required fields, defaults, access rules, indexes, full-text search, and hooks:

```typescript
tables: {
  customers: {
    schema: {
      email:    { type: 'string', required: true },
      plan:     { type: 'string', default: 'free' },
      metadata: { type: 'json' },
    },

    // Access rules — who can do what
    access: {
      read:   (auth, doc) => auth?.id === doc.userId, // only own data
      insert: () => false,  // server-only (no client writes)
      update: () => false,
      delete: () => false,
    },

    handlers: {
      hooks: {
        beforeInsert: async (_auth, data) => ({
          ...data,
          metadata: {
            source: 'plugin',
            ...(typeof data.metadata === 'object' && data.metadata
              ? data.metadata as Record<string, unknown>
              : {}),
          },
        }),
      },
    },

    // Optional: database indexes
    indexes: [
      { fields: ['email'], unique: true },
    ],

    // Optional: full-text search
    fts: ['email', 'plan'],
  },
},
```

:::info Automatic Namespacing
You write `customers` in your plugin definition, but it becomes `my-plugin/customers` in the database. This prevents name collisions with the user's tables or other plugins. You never need to worry about it — EdgeBase handles this transparently.
:::

---

## Step 4: Add Functions

Plugins can register three types of functions:

### HTTP Functions — API Endpoints

```typescript
functions: {
  'create-checkout': {
    trigger: { type: 'http', method: 'POST', path: '/checkout/create' },
    handler: async (ctx) => {
      // ctx.auth — current user (null if not logged in)
      if (!ctx.auth) return new Response('Unauthorized', { status: 401 });

      // ctx.request — the incoming HTTP request
      const { priceId } = await ctx.request.json() as { priceId: string };

      // ctx.pluginConfig — your typed config
      const apiKey = ctx.pluginConfig.apiKey;

      // ctx.admin — server-side admin access (bypasses rules)
      await ctx.admin.table('my-plugin/orders').insert({
        userId: ctx.auth.id,
        priceId,
        status: 'pending',
      });

      return Response.json({ orderId: 'order_123' });
    },
  },
},
```

Users call this at: `POST /api/functions/checkout/create`

If you omit `trigger.path`, the default route is `/api/functions/my-plugin/create-checkout`.

### Cron Functions — Scheduled Jobs

```typescript
functions: {
  'daily-cleanup': {
    trigger: { type: 'schedule', cron: '0 3 * * *' },  // 3 AM daily
    handler: async (ctx) => {
      // No request or auth — this runs on a schedule
      const oldItems = await ctx.admin.table('my-plugin/items').list({
        filter: [['status', '==', 'expired']],
      });
      for (const item of oldItems.items) {
        await ctx.admin.table('my-plugin/items').delete(item.id as string);
      }
    },
  },
},
```

### DB Trigger Functions — React to Data Changes

```typescript
functions: {
  'on-order-created': {
    trigger: { type: 'db', event: 'insert', table: 'my-plugin/orders' },
    handler: async (ctx) => {
      const newOrder = ctx.data?.after;
      // Send notification, update analytics, etc.
    },
  },
},
```

---

## Step 5: Add Authentication Hooks

Authentication hooks let your plugin react to user authentication events. There are **11 hooks** available, split into two categories:

### Blocking Hooks (can reject the operation)

These run **before** the operation completes. If your hook throws an error, the operation is cancelled. They have a **5-second timeout**.

| Hook                  | When It Runs                    | What You Can Do                                         |
| --------------------- | ------------------------------- | ------------------------------------------------------- |
| `beforeSignUp`        | Before user account is created  | Reject signups (e.g., only allow `@company.com` emails) |
| `beforeSignIn`        | Before login session is created | Block suspended accounts                                |
| `onTokenRefresh`      | When JWT is refreshed           | Inject custom claims into the token                     |
| `beforePasswordReset` | Before password reset           | Enforce password policy                                 |
| `beforeSignOut`       | Before sign out                 | Require active session                                  |

### Non-Blocking Hooks (fire-and-forget)

These run **after** the operation via `waitUntil()`. They don't affect the response — if they fail, the user doesn't notice.

| Hook                 | When It Runs            | What You Can Do                            |
| -------------------- | ----------------------- | ------------------------------------------ |
| `afterSignUp`        | After user is created   | Send welcome email, create default records |
| `afterSignIn`        | After login succeeds    | Log analytics, update last-login           |
| `afterPasswordReset` | After password changes  | Notify user via email                      |
| `afterSignOut`       | After sign out          | Clean up temporary data                    |
| `onDeleteAccount`    | When account is deleted | Clean up user data, external services      |
| `onEmailVerified`    | When email is verified  | Enable premium features                    |

### Example: Full Authentication Hook Setup

```typescript
hooks: {
  // ── Blocking: reject signups from non-company emails ──
  beforeSignUp: async (ctx) => {
    const email = ctx.data.after.email as string;
    if (!email.endsWith('@mycompany.com')) {
      throw new Error('Only @mycompany.com emails are allowed');
    }
  },

  // ── Non-blocking: create a profile record for new users ──
  afterSignUp: async (ctx) => {
    const userId = ctx.data.after.id as string;
    await ctx.admin.table('my-plugin/profiles').insert({
      userId,
      plan: 'free',
      createdAt: new Date().toISOString(),
    });
  },

  // ── Blocking: inject subscription plan into JWT ──
  onTokenRefresh: async (ctx) => {
    const userId = ctx.data.after.id as string;
    const profile = await ctx.admin.table('my-plugin/profiles').list({
      filter: [['userId', '==', userId]],
      limit: 1,
    });
    const plan = profile.items[0]?.plan ?? 'free';

    // Return claims overrides — they appear in the next JWT as auth.custom.plan
    return { plan };
  },

  // ── Non-blocking: clean up when a user deletes their account ──
  onDeleteAccount: async (ctx) => {
    const userId = ctx.data.after.id as string;
    const profiles = await ctx.admin.table('my-plugin/profiles').list({
      filter: [['userId', '==', userId]],
    });
    for (const profile of profiles.items) {
      await ctx.admin.table('my-plugin/profiles').delete(profile.id as string);
    }
  },
},
```

### What's in the Hook Context?

Every authentication hook receives `ctx` with:

| Property           | Type                      | Description                                    |
| ------------------ | ------------------------- | ---------------------------------------------- |
| `ctx.data.after`   | `Record<string, unknown>` | The user object (id, email, role, etc.)        |
| `ctx.admin`        | `PluginAdminContext`      | Full admin access (tables, auth, KV, D1, etc.) |
| `ctx.pluginConfig` | `TConfig`                 | Your typed plugin config                       |
| `ctx.request`      | `Request`                 | The original HTTP request                      |

---

## Step 6: Add Storage Hooks

Storage hooks intercept file operations on R2 storage. There are **6 hooks**:

### Blocking Storage Hooks (can reject, 5s timeout)

| Hook             | When                     | Return Value                                               |
| ---------------- | ------------------------ | ---------------------------------------------------------- |
| `beforeUpload`   | Before a file is saved   | `Record<string, string>` to add custom metadata, or `void` |
| `beforeDelete`   | Before a file is deleted | `void` (throw to reject)                                   |
| `beforeDownload` | Before a file is served  | `void` (throw to reject)                                   |

### Non-Blocking Storage Hooks (fire-and-forget)

| Hook               | When                       |
| ------------------ | -------------------------- |
| `afterUpload`      | After upload completes     |
| `afterDelete`      | After file is deleted      |
| `onMetadataUpdate` | When file metadata changes |

### Example: File Validation + Processing

```typescript
hooks: {
  // ── Blocking: reject files over 10 MB and tag uploads ──
  beforeUpload: async (ctx) => {
    if (ctx.file.size > 10 * 1024 * 1024) {
      throw new Error('File too large — 10 MB limit');
    }

    // Return custom metadata to attach to the file
    return {
      'x-scan-status': 'pending',
      'x-uploaded-by': ctx.auth?.id ?? 'anonymous',
    };
  },

  // ── Blocking: only allow owners to delete their files ──
  beforeDelete: async (ctx) => {
    if (ctx.file.customMetadata?.['x-uploaded-by'] !== ctx.auth?.id) {
      throw new Error('You can only delete your own files');
    }
  },

  // ── Non-blocking: trigger a virus scan after upload ──
  afterUpload: async (ctx) => {
    await ctx.admin.functions.call('my-plugin/scan-file', {
      bucket: ctx.file.bucket,
      key: ctx.file.key,
    });
  },
},
```

### What's in the Storage Hook Context?

| Property                  | Type                      | Description                        |
| ------------------------- | ------------------------- | ---------------------------------- |
| `ctx.file.key`            | `string`                  | File path (e.g., `photos/cat.jpg`) |
| `ctx.file.bucket`         | `string`                  | R2 bucket name                     |
| `ctx.file.size`           | `number`                  | File size in bytes                 |
| `ctx.file.contentType`    | `string`                  | MIME type (e.g., `image/jpeg`)     |
| `ctx.file.etag`           | `string?`                 | File hash                          |
| `ctx.file.uploadedAt`     | `string?`                 | ISO timestamp                      |
| `ctx.file.uploadedBy`     | `string \| null?`         | User ID of uploader                |
| `ctx.file.customMetadata` | `Record<string, string>?` | Custom metadata                    |
| `ctx.auth`                | `{ id, email } \| null`   | Current user                       |
| `ctx.admin`               | `PluginAdminContext`      | Full admin access                  |
| `ctx.pluginConfig`        | `TConfig`                 | Your typed config                  |

:::caution
Storage hooks receive file **metadata** only — not the file content itself. This is a Worker memory limit constraint (128 MB).
:::

:::note
Presigned URL direct uploads bypass the server, so `beforeUpload` and `afterUpload` do **not** fire for those.
:::

---

## Step 7: Add Migrations

When you release a new version of your plugin, you may need to transform existing data. The migration system handles this automatically.

### How It Works

```
Plugin v1.0.0 deployed  →  v1.1.0 deployed  →  v2.0.0 deployed
                              │                     │
                              ▼                     ▼
                         migrations['1.1.0']   migrations['2.0.0']
                         runs automatically     runs automatically
```

EdgeBase stores the last deployed version per plugin. On deploy, it compares versions and runs all pending migrations **in semver order**.

### Three Things You Can Define

```typescript
export const myPlugin = definePlugin<MyConfig>({
  name: 'my-plugin',
  version: '2.0.0', // ← current version (enables migration tracking)

  // 1. onInstall — runs once on the very first deploy
  onInstall: async (ctx) => {
    await ctx.admin.table('my-plugin/settings').insert({
      key: 'initialized',
      value: 'true',
    });
    console.log('Plugin installed!');
  },

  // 2. migrations — version-keyed upgrade scripts
  migrations: {
    '1.1.0': async (ctx) => {
      // Ran when upgrading from any version < 1.1.0
      const items = await ctx.admin.table('my-plugin/items').list();
      for (const item of items.items) {
        await ctx.admin.table('my-plugin/items').update(item.id as string, {
          migratedAt: new Date().toISOString(),
        });
      }
    },
    '2.0.0': async (ctx) => {
      // Ran when upgrading from any version < 2.0.0
      await ctx.admin.sql(
        'app',
        undefined,
        'ALTER TABLE "my-plugin/items" ADD COLUMN "category" TEXT DEFAULT \'general\'',
      );
    },
  },

  // 3. tables, functions, hooks... (as before)
  tables: {
    /* ... */
  },
});
```

### Migration Context

The `ctx` in `onInstall` and `migrations` provides:

| Property              | Description                                                       |
| --------------------- | ----------------------------------------------------------------- |
| `ctx.admin`           | Full `PluginAdminContext` — tables, SQL, KV, D1, auth, push, etc. |
| `ctx.previousVersion` | The version that was deployed before (`null` for first install)   |
| `ctx.pluginConfig`    | Your typed plugin config                                          |

:::caution Idempotency Required
Multiple Worker instances may start simultaneously during a deploy, so the same migration could run more than once. Write migrations that are safe to repeat — use `INSERT OR IGNORE`, conditional checks, etc.
:::

:::tip onInstall vs migrations['1.0.0']
Use one or the other for first-deploy logic, not both. If both are defined, `onInstall` runs first, then migrations.
:::

---

## The Admin Context (`ctx.admin`)

Every plugin context (functions, authentication hooks, storage hooks, migrations) gives you `ctx.admin` — a powerful server-side client that **bypasses all access rules**. Here's what you can do with it:

```typescript
// ── Tables ──
await ctx.admin.table('my-plugin/items').insert({ title: 'New item' });
await ctx.admin.table('my-plugin/items').getOne('item-id');
await ctx.admin.table('my-plugin/items').update('item-id', { done: true });
await ctx.admin.table('my-plugin/items').delete('item-id');
await ctx.admin.table('my-plugin/items').list({ limit: 10, filter: [...] });

// Access tables in a specific DB namespace
await ctx.admin.db('app').table('my-plugin/items').list();

// ── Auth (user management) ──
await ctx.admin.auth.getUser('user-id');
await ctx.admin.auth.listUsers({ limit: 50 });
await ctx.admin.auth.createUser({ email: 'new@test.com', password: '...' });
await ctx.admin.auth.updateUser('user-id', { role: 'admin' });
await ctx.admin.auth.deleteUser('user-id');
await ctx.admin.auth.setCustomClaims('user-id', { plan: 'pro' });
await ctx.admin.auth.revokeAllSessions('user-id');

// ── Raw SQL ──
await ctx.admin.sql('app', undefined, 'SELECT count(*) FROM "my-plugin/items"');

// ── KV (key-value store) ──
await ctx.admin.kv('MY_KV').set('key', 'value', { ttl: 3600 });
await ctx.admin.kv('MY_KV').get('key');
await ctx.admin.kv('MY_KV').delete('key');
await ctx.admin.kv('MY_KV').list({ prefix: 'user:' });

// ── D1 (Cloudflare SQL database) ──
await ctx.admin.d1('MY_DB').exec('SELECT * FROM logs WHERE level = ?', ['error']);

// ── Vectorize (vector search) ──
await ctx.admin.vector('MY_INDEX').upsert([{ id: '1', values: [0.1, 0.2, ...] }]);
await ctx.admin.vector('MY_INDEX').search([0.1, 0.2, ...], { topK: 10 });
await ctx.admin.vector('MY_INDEX').delete(['id-1', 'id-2']);

// ── Database Subscriptions (broadcast to channels) ──
await ctx.admin.broadcast('my-channel', 'update', { message: 'Hello!' });

// ── Functions (call other functions) ──
await ctx.admin.functions.call('my-plugin/process-data', { id: '123' });

// ── Push Notifications ──
await ctx.admin.push.send('user-id', { title: 'Hey!', body: 'New item' });
await ctx.admin.push.sendMany(['user-1', 'user-2'], { title: 'Update' });
await ctx.admin.push.broadcast({ title: 'Announcement' });
```

---

## Testing Your Plugin

`@edge-base/plugin-core` provides `createMockContext()` for unit testing — no server needed:

```typescript
import { createMockContext } from '@edge-base/plugin-core';
import { myPlugin } from '../src/index.js';

describe('my-plugin', () => {
  // Create a plugin instance with test config
  const plugin = myPlugin({ apiKey: 'test-key' });

  it('check-status returns configured: true', async () => {
    const ctx = createMockContext({
      pluginConfig: { apiKey: 'test-key' },
      method: 'GET',
    });

    const handler = plugin.functions!['check-status'].handler;
    const response = (await handler(ctx)) as Response;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.configured).toBe(true);
  });

  it('afterSignUp creates a profile', async () => {
    const ctx = createMockContext({
      pluginConfig: { apiKey: 'test-key' },
    });

    // Set up authentication hook data
    (ctx as any).data = { after: { id: 'user-123', email: 'test@test.com' } };

    // Run the hook
    await plugin.hooks!.afterSignUp!(ctx as any);

    // Verify — createMockContext provides in-memory table storage
    const profiles = await ctx.admin.db('app').table('my-plugin/profiles').list();
    expect(profiles.items.length).toBe(1);
    expect(profiles.items[0].userId).toBe('user-123');
  });
});
```

`createMockContext()` gives you in-memory implementations of all admin APIs (tables, auth, KV, D1, push, etc.), so your tests run instantly without a real server.

---

## Creating a Client SDK (Optional)

If your plugin has HTTP functions, you can provide a typed client wrapper:

```typescript title="client/js/src/index.ts"
import type { PluginClientFactory } from '@edge-base/plugin-core';

// Define the client interface
interface MyPluginClient {
  createCheckout(params: { priceId: string }): Promise<{ orderId: string }>;
  getStatus(): Promise<{ configured: boolean }>;
}

// Create the factory — it wraps function calls with types
export const createMyPlugin: PluginClientFactory<MyPluginClient> = (client) => ({
  async createCheckout(params) {
    return client.functions.call('my-plugin/create-checkout', params) as any;
  },
  async getStatus() {
    return client.functions.call('my-plugin/check-status') as any;
  },
});
```

Users get a clean, typed API:

```typescript
import { createClient } from '@edge-base/web';
import { createMyPlugin } from 'my-plugin/client';

const client = createClient({ baseUrl: '...' });
const plugin = createMyPlugin(client);

// Typed! IDE autocomplete works.
const result = await plugin.createCheckout({ priceId: 'price_xxx' });
```

---

## Advanced: DB Block & Provider

### DB Block Targeting

By default, plugin tables go into the `app` DB block. Override with `dbBlock`:

```typescript
export const myPlugin = definePlugin<MyConfig>({
  name: 'my-plugin',
  dbBlock: 'workspace', // tables go into 'workspace' block instead of 'app'
  tables: {
    /* ... */
  },
});
```

### Provider Requirements

If your plugin needs a specific database backend:

```typescript
export const myPlugin = definePlugin<MyConfig>({
  name: 'my-plugin',
  provider: 'postgres', // requires PostgreSQL — optionally run `npx edgebase neon setup` in the host project
  tables: {
    /* ... */
  },
});
```

Valid values: `'do'` (default — Durable Object + SQLite), `'d1'`, `'postgres'`. Legacy `'neon'` remains accepted for backward compatibility.

---

## Publishing

### package.json

CLI-facing metadata now lives in `definePlugin({ manifest: ... })`, not in `package.json`.

```json title="server/package.json"
{
  "name": "my-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "dependencies": {
    "@edge-base/plugin-core": "^0.1.0"
  },
  "peerDependencies": {
    "@edge-base/shared": "^0.1.0"
  }
}
```

### Publish to npm

```bash
cd server
npm run build
npm publish
```

That's it — official and community plugins use the same workflow. No special registry.

---

## Complete Example: Payment Plugin

Here's everything together — a real-world payment plugin with tables, functions, authentication hooks, storage hooks, and migrations:

```typescript title="server/src/index.ts"
import { definePlugin } from '@edge-base/plugin-core';

interface PaymentConfig {
  secretKey: string;
  webhookSecret: string;
  currency?: string;
}

export const paymentPlugin = definePlugin<PaymentConfig>({
  name: 'plugin-payment',
  version: '1.1.0',
  manifest: {
    description: 'Payments, invoices, and billing webhooks',
    configTemplate: {
      secretKey: 'CHANGE_ME',
      webhookSecret: 'CHANGE_ME',
      currency: 'usd',
    },
  },

  // ── Tables ──
  tables: {
    customers: {
      schema: {
        userId: { type: 'string', required: true },
        externalId: { type: 'string' },
        plan: { type: 'string', default: 'free' },
      },
      access: {
        read: (auth, doc) => auth?.id === doc.userId,
        insert: () => false, // server-only
        update: () => false,
        delete: () => false,
      },
      indexes: [{ fields: ['userId'], unique: true }],
    },
    invoices: {
      schema: {
        customerId: { type: 'string', required: true },
        amount: { type: 'number', required: true },
        currency: { type: 'string', default: 'usd' },
        status: { type: 'string', default: 'pending' },
        paidAt: { type: 'datetime' },
      },
      access: {
        read: (auth) => auth !== null,
        insert: () => false,
        update: () => false,
        delete: () => false,
      },
    },
  },

  // ── Functions ──
  functions: {
    'create-checkout': {
      trigger: { type: 'http', method: 'POST', path: '/billing/checkout' },
      handler: async (ctx) => {
        if (!ctx.auth) return new Response('Unauthorized', { status: 401 });
        const { priceId } = (await ctx.request.json()) as { priceId: string };
        const currency = ctx.pluginConfig.currency ?? 'usd';
        // Call external payment API...
        return Response.json({ sessionId: 'sess_xxx', currency });
      },
    },
    'handle-webhook': {
      trigger: { type: 'http', method: 'POST', path: '/billing/webhook' },
      handler: async (ctx) => {
        const signature = ctx.request.headers.get('x-webhook-signature');
        // Verify signature with ctx.pluginConfig.webhookSecret...
        const event = (await ctx.request.json()) as { type: string; data: any };

        if (event.type === 'payment.completed') {
          await ctx.admin
            .table('plugin-payment/invoices')
            .update(event.data.invoiceId, { status: 'paid', paidAt: new Date().toISOString() });
        }

        return Response.json({ received: true });
      },
    },
  },

  // ── Authentication Hooks ──
  hooks: {
    afterSignUp: async (ctx) => {
      await ctx.admin.table('plugin-payment/customers').insert({
        userId: ctx.data.after.id as string,
        plan: 'free',
      });
    },
    onTokenRefresh: async (ctx) => {
      const userId = ctx.data.after.id as string;
      const result = await ctx.admin.table('plugin-payment/customers').list({
        filter: [['userId', '==', userId]],
        limit: 1,
      });
      return { plan: result.items[0]?.plan ?? 'free' };
    },
    // Storage hook: track receipt uploads
    afterUpload: async (ctx) => {
      if (ctx.file.key.startsWith('receipts/')) {
        await ctx.admin
          .table('plugin-payment/invoices')
          .update(ctx.file.customMetadata?.['invoiceId'] ?? '', { receiptKey: ctx.file.key });
      }
    },
  },

  // ── Migrations ──
  onInstall: async (ctx) => {
    console.log('Payment plugin installed!');
  },
  migrations: {
    '1.1.0': async (ctx) => {
      // Backfill currency field for existing invoices
      const invoices = await ctx.admin.table('plugin-payment/invoices').list();
      for (const inv of invoices.items) {
        if (!inv.currency) {
          await ctx.admin
            .table('plugin-payment/invoices')
            .update(inv.id as string, { currency: ctx.pluginConfig.currency ?? 'usd' });
        }
      }
    },
  },
});
```
