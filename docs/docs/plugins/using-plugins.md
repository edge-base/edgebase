---
sidebar_position: 1
---

# Using Plugins

## Installation

Plugins are standard npm packages. Install them like any other dependency:

```bash
npm install @edge-base/plugin-stripe
```

## Configuration

Import the plugin's factory function and add it to the `plugins` array in `edgebase.config.ts`:

```typescript title="edgebase.config.ts"
import { defineConfig } from '@edge-base/shared';
import { stripePlugin } from '@edge-base/plugin-stripe';

export default defineConfig({
  plugins: [
    stripePlugin({
      secretKey: process.env.STRIPE_SECRET_KEY!,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
      currency: 'usd',
    }),
  ],
});
```

Each plugin factory accepts a typed config object. The types come from the plugin package itself — your IDE will autocomplete available options.

Plugin authors can also expose a serializable `manifest` from `definePlugin()`. The CLI reads it for descriptions, docs links, and `configTemplate` output.

`definePlugin()` also stamps the current public `pluginApiVersion` onto the resolved plugin instance. If the plugin was built against a different contract, deploy fails fast instead of loading a partially incompatible plugin.

:::tip
Store sensitive values (API keys, secrets) in `.env.development` / `.env.release` and reference them via `process.env` when building `edgebase.config.ts`, just like the rest of your server configuration.
:::

## Multiple Plugins

Add multiple plugins to the array. They are processed in order:

```typescript title="edgebase.config.ts"
import { defineConfig } from '@edge-base/shared';
import { stripePlugin } from '@edge-base/plugin-stripe';
import { analyticsPlugin } from '@edge-base/plugin-analytics';
import { emailPlugin } from '@edge-base/plugin-email';

export default defineConfig({
  plugins: [
    stripePlugin({ secretKey: process.env.STRIPE_SECRET_KEY! }),
    analyticsPlugin({ trackPageViews: true }),
    emailPlugin({ provider: 'resend', apiKey: process.env.RESEND_API_KEY! }),
  ],
});
```

When multiple plugins register the same authentication hook (e.g. `afterSignUp`), they all execute in the order they appear in the `plugins` array.

## Deploying

Plugins are bundled at build time — no special deployment steps:

```bash
npx edgebase deploy
```

The CLI automatically:

1. Evaluates `edgebase.config.ts` (resolves plugin factories)
2. Merges plugin tables into your DB blocks (namespaced)
3. Registers plugin functions and authentication hooks
4. Bundles everything into a single Worker
5. Lets the runtime reconcile pending plugin migrations lazily on the first relevant request or scheduled execution

## Managing Plugins

### List Installed Plugins

```bash
npx edgebase plugins list
```

Shows all configured plugins with their manifest metadata, injected tables, functions, hooks, and config template:

```
📦 2 plugin(s) configured:

  • plugin-stripe v0.1.0 api v1
    Stripe billing for EdgeBase
    Tables: customers, invoices, subscriptions
    Functions: create-checkout, handle-webhook, sync-charges
    Hooks: onTokenRefresh
    Config Template:
      {
        "stripeSecretKey": "sk_test_CHANGE_ME"
      }

  • plugin-analytics
    Functions: track-event
    Hooks: afterSignIn
```

### Removing a Plugin

1. Remove it from `edgebase.config.ts`
2. Uninstall the package: `npm uninstall @edge-base/plugin-stripe`
3. Redeploy: `npx edgebase deploy`
4. Remove plugin-owned data: `npx edgebase plugins cleanup @edge-base/plugin-stripe`

`plugins cleanup` deletes namespaced plugin tables plus plugin migration metadata stored in the internal control-plane D1 (`CONTROL_DB`). On Cloudflare Edge, pass `--account-id` and `--api-token` if the plugin ever wrote to dynamic Durable Object instances; otherwise the CLI can only clean currently known namespaces.

The command refuses to run while the plugin is still configured in `edgebase.config.ts`, which prevents accidentally wiping active plugin data.

## Using Plugin Client SDKs

Some plugins provide optional client SDK wrappers for typed frontend access:

```typescript
// Client-side (e.g. in a React app)
import { createClient } from '@edge-base/web';
import { createStripePlugin } from '@edge-base/plugin-stripe/client';

const client = createClient({ baseUrl: 'https://your-project.edgebase.app' });
const stripe = createStripePlugin(client);

// Typed method — calls plugin-stripe/create-checkout under the hood
const session = await stripe.createCheckout({ priceId: 'price_xxx' });
```

Client SDK extensions use `client.functions.call()` internally, so they work with any EdgeBase client SDK that supports function calls.

## How Plugin Tables Work

Plugin tables behave exactly like your own tables. They:

- Follow the same schema system (types, required fields, defaults)
- Support the same preferred `access + handlers` grammar as first-party tables
- Support full-text search and custom indexes
- Are queryable via the Admin SDK
- Are queryable from all Admin SDKs

At build time, EdgeBase merges plugin tables into their target DB block and runs them through the same config materialization path as the rest of the app. That means plugin tables use the same `access + handlers` grammar without any plugin-specific branching.

Plugins are still trusted server-side code. There is no plugin sandbox or per-plugin binding allowlist today; `npm install` is treated as an explicit trust decision.

```typescript title="plugin table example"
tables: {
  customers: {
    access: {
      read: (auth, row) => auth?.id === row.userId,
      insert: (auth) => auth !== null,
    },
    handlers: {
      hooks: {
        beforeInsert: async (_auth, data) => ({
          ...data,
          source: 'plugin',
        }),
      },
    },
  },
}
```

The only difference is the namespace prefix:

```typescript
// In your own code — access plugin tables via admin SDK
const customers = await admin.db('app').table('plugin-stripe/customers').list();
```

Plugin handlers access their own tables the same way:

```typescript
// Inside a plugin function handler
const custs = await ctx.admin.table('plugin-stripe/customers').list({
  filter: [['userId', '==', ctx.auth!.id]],
  limit: 1,
});
```

## DB Block Targeting

By default, plugin tables go into the `shared` DB block. Plugins can override this:

```typescript
export const myPlugin = definePlugin({
  name: 'my-plugin',
  dbBlock: 'workspace',  // Tables go into the 'workspace' DB block
  tables: { ... },
});
```

## HTTP Paths

Plugin HTTP functions default to `/api/functions/{plugin-name}/{function-name}`.

If you want a cleaner public URL, set `trigger.path`:

```typescript
functions: {
  resolve: {
    trigger: { type: 'http', method: 'GET', path: '/s/[code]' },
    handler: async (ctx) => {
      return Response.redirect('https://example.com', 302);
    },
  },
}
```

That function is now available at `GET /api/functions/s/:code`.

## Storage Hooks

Plugins can also hook into storage lifecycle events. These hooks fire for ALL buckets — the plugin receives the bucket name in `ctx.file.bucket` and can decide whether to act.

**Blocking hooks** (5s timeout):

- `beforeUpload` — Can reject uploads or inject custom metadata
- `beforeDelete` — Can reject file deletion
- `beforeDownload` — Can reject file download

**Non-blocking hooks** (via `waitUntil`):

- `afterUpload` — Process uploaded files (e.g., virus scan, thumbnail generation)
- `afterDelete` — Cleanup related data
- `onMetadataUpdate` — React to metadata changes

:::note
Presigned URL direct uploads bypass the server entirely and do NOT trigger `afterUpload` hooks.
:::
