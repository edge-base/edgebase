---
title: Troubleshooting
description: Solutions for common EdgeBase issues during development and deployment.
sidebar_position: 9
---

# Troubleshooting

Common issues and how to fix them.

## Dev Server

### Server won't start -- port already in use

**Symptom:** `npx edgebase dev` fails with `Error: address already in use :8787`.

**Fix:** Kill the process holding the port, then restart:

```bash
# Find the process
lsof -i :8787

# Kill it
kill -9 <PID>

# Restart
npx edgebase dev
```

Or use a different port:

```bash
npx edgebase dev --port 8788
```

### Server won't start -- missing or invalid config

**Symptom:** Startup crashes with `Cannot find module './edgebase.config.ts'` or a config validation error.

**Fix:**

1. Make sure `edgebase.config.ts` exists at the project root.
2. Check that you are running `npx edgebase dev` from the project directory (the one containing `edgebase.config.ts`).
3. Validate your config structure -- every table must live inside a `databases.{namespace}.tables` object. A bare `tables` key at the top level is invalid.

### Server won't start -- esbuild errors

**Symptom:** Errors mentioning `esbuild` during `npx edgebase dev` or `npx edgebase deploy`.

**Fix:**

1. Delete `node_modules` and reinstall:
   ```bash
   rm -rf node_modules
   npm install
   ```
2. If you are on a new architecture (e.g., Apple Silicon) and installed Node through Rosetta, reinstall Node natively for your platform.
3. Check that your `functions/` files have valid TypeScript syntax. A syntax error in any function file causes the build to fail.

### Function hot-reload not working

**Symptom:** You edit a file in `functions/` but the dev server keeps running the old version.

**Fix:**

1. Check for syntax errors in the file you changed. The watcher silently skips files that fail to compile.
2. Make sure the file is inside the `functions/` directory at the project root.
3. Restart the dev server: `npx edgebase dev`. The watcher occasionally misses events after OS sleep or large `git checkout` operations.

---

## Authentication

### JWT errors after dev server restart

**Symptom:** Existing tokens return `401 Unauthorized` or `invalid signature` after restarting `npx edgebase dev`.

**Why:** The dev server auto-generates JWT signing keys on first run and stores them in `.env.development`. If that file is deleted or regenerated, old tokens become invalid.

**Fix:** Clear your client-side tokens and sign in again. If you need stable keys across restarts, keep `.env.development` intact and do not delete it.

### Tokens expire immediately

**Symptom:** After sign-in, requests fail with `401` almost instantly.

**Fix:** Check your `auth.session` config. If `accessTokenTTL` is set very low, tokens expire quickly:

```typescript
auth: {
  session: {
    accessTokenTTL: '15m',  // default -- should be fine
    refreshTokenTTL: '7d',
  },
}
```

Also check that your server clock and client clock are not significantly out of sync. A clock difference of more than a few seconds can cause JWT time-based validation to fail.

### OAuth callback fails with "redirect_uri mismatch"

**Symptom:** OAuth login redirects to the provider, but the callback returns an error about mismatched redirect URIs.

**Fix:**

1. Set `baseUrl` in your config to the exact origin where your EdgeBase server is reachable:
   ```typescript
   export default defineConfig({
     baseUrl: 'https://api.example.com',
     // ...
   });
   ```
2. In your OAuth provider's console, add `{baseUrl}/api/auth/callback/{provider}` as an authorized redirect URI.
3. If using `allowedRedirectUrls`, make sure your app's callback URL matches one of the patterns.

---

## Database

### DB Live Query not receiving updates

**Symptom:** `onSnapshot` is registered but never fires on changes.

**Cause 1 -- Authentication required:** Database subscriptions require an authenticated WebSocket connection. Make sure the user is signed in before calling `onSnapshot`.

**Cause 2 -- Same-client writes:** The `onSnapshot` callback fires for changes made by **other clients** as well as the same client. If your callback is not firing, check that the write actually succeeded (check the network tab or server logs).

**Cause 3 -- Access rule blocks the read:** The subscription uses the table's `read` access rule at subscribe time. If the rule returns `false`, the subscription is silently rejected. Verify your access rules.

**Cause 4 -- Wrong namespace:** Make sure the `db()` namespace and optional ID match on both the write and subscribe sides:

```typescript
// These must match
client.db('app').table('posts').onSnapshot(/* ... */);
client.db('app').table('posts').insert(/* ... */);
```

### Access rules blocking requests unexpectedly

**Symptom:** A client request returns `403 Forbidden` even though you think the user should have access.

**Debugging steps:**

1. **Check `release` mode.** With `release: true`, any table without explicit access rules denies all requests. During development, set `release: false` (the default) to allow unconfigured tables.
2. **Inspect the `auth` object.** Log `auth` inside your access rule to see what the server receives:
   ```typescript
   access: {
     read(auth, row) {
       console.log('auth:', JSON.stringify(auth));
       console.log('row:', JSON.stringify(row));
       return auth !== null && auth.id === row.userId;
     },
   }
   ```
   Check the dev server terminal for the output.
3. **Check field names.** A common mistake is comparing `auth.id` to a field that does not exist on the row (e.g., `row.ownerId` when the schema field is `userId`).
4. **Check DB block access.** For dynamic namespaces (`user`, `workspace`), the DB-block-level `access` rule is evaluated before table-level rules. Make sure both pass.

### DB trigger not firing

**Symptom:** You defined a function in `functions/` with a DB trigger name, but it never executes.

**Fix:**

1. The function filename must match the pattern. For a table trigger on `app.posts`, the file should be named using the convention documented in [Triggers](/docs/database/triggers).
2. Check the dev server logs for errors in your function. A runtime error (e.g., accessing `undefined`) causes the trigger to fail silently from the client's perspective.
3. Verify you are using the correct `context.data` shape. For `afterInsert` and `afterUpdate`, the new record is in `context.data.after`. For `afterDelete`, the deleted record is in `context.data.before`:
   ```typescript
   export default async function onTodoCreated(doc, context) {
     const newRecord = context.data.after;   // after insert/update
     const oldRecord = context.data.before;  // before update, or the deleted record
   }
   ```

---

## Storage

### Upload fails with 403

**Symptom:** `client.storage.bucket('photos').upload(file)` returns 403.

**Fix:** Check your storage access rules. With `release: true`, a bucket without a `write` rule denies all uploads:

```typescript
storage: {
  buckets: {
    photos: {
      access: {
        write(auth) { return auth !== null; },
      },
    },
  },
},
```

Also verify the user is authenticated before uploading.

---

## Plugins

### Plugin table not found -- "table not found" or empty results

**Symptom:** You installed a plugin but queries to its tables return errors.

**Fix:** Plugin tables are namespaced. When accessing them via the Admin SDK or Admin Dashboard, use the plugin prefix:

```typescript
// Wrong
admin.db('app').table('subscriptions');

// Correct -- include the plugin namespace prefix
admin.db('app').table('stripe_subscriptions');
```

Check the plugin's documentation for its exact table names.

---

## Deployment

### `npx edgebase deploy` fails with Cloudflare API errors

**Symptom:** Deploy fails with `Authentication error` or `10000: Unknown error`.

**Fix:**

1. Make sure you are logged into Wrangler:
   ```bash
   npx wrangler login
   ```
2. Verify your Cloudflare account has Workers and D1 access.
3. If using a CI pipeline, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as environment variables.
4. Check your `wrangler.toml` for syntax errors. Redeploy after fixing.

### R2 Storage provisioning fails

**Symptom:** `R2 'STORAGE': provisioning failed` with `Please enable R2` or `code: 10042`.

**Fix:** R2 must be enabled in the Cloudflare Dashboard before first deploy:
<div className="docs-badge-row">
  <span className="docs-badge docs-badge--free">Free Plan</span>
  <span className="docs-badge docs-badge--setup">Billing Setup</span>
</div>

1. Go to **Cloudflare Dashboard → R2 Object Storage → Get Started**.
2. Complete the one-time R2 subscription / billing activation (free tier includes 10 GB).
3. Redeploy with `npx edgebase deploy`.

If your app doesn't use file storage, remove `storage` from `edgebase.config.ts` instead.

### Durable Objects migration error (Free plan)

**Symptom:** Deploy fails with `code: 10097` — "you must create a namespace using a `new_sqlite_classes` migration."

**Fix:** The Cloudflare Free plan requires all DO classes to use `new_sqlite_classes` in `wrangler.toml`. Update your `[[migrations]]` section:

```toml
# Before (fails on Free plan)
[[migrations]]
tag = "v1"
new_sqlite_classes = ["DatabaseDO", "AuthDO"]
new_classes = ["DatabaseLiveDO", "RoomsDO"]

# After (works on Free plan)
[[migrations]]
tag = "v1"
new_sqlite_classes = ["DatabaseDO", "AuthDO", "DatabaseLiveDO", "RoomsDO"]
```

:::tip
EdgeBase CLI v0.1.3+ generates the correct migration format automatically. If you see this error on an older project, update `wrangler.toml` manually as shown above.
:::

### Vectorize provisioning fails

**Symptom:** `Vectorize 'name': provisioning failed`.

**Fix:** Vectorize includes usage on both Workers Free and Workers Paid plans. If provisioning fails, check your Cloudflare account/product availability and current Vectorize limits. If your app doesn't need vector search, remove `vectorize` from `edgebase.config.ts`.

### Realtime/Calls provisioning fails

**Symptom:** Realtime app or TURN key creation fails during deploy.

**Fix:**
1. Cloudflare Calls may need to be enabled: **Dashboard → Calls → Get Started**.
2. If using wrangler OAuth, create a dedicated API token with Calls Write permissions and export as `CLOUDFLARE_API_TOKEN`.
3. If your app doesn't use realtime features, remove `realtime` from `edgebase.config.ts`.

### Deploy succeeds but the app returns 500 errors

**Symptom:** `npx edgebase deploy` completes, but requests to the deployed URL return 500.

**Fix:**

1. Check if your production environment variables are set. The deploy does not copy `.env.development` to production. Set secrets via the Cloudflare dashboard or Wrangler:
   ```bash
   npx wrangler secret put JWT_SECRET
   ```
2. If using OAuth, set provider credentials as secrets as well.
3. Check Cloudflare Worker logs for the actual error:
   ```bash
   npx wrangler tail
   ```

---

## CORS

### CORS errors in the browser console

**Symptom:** Browser console shows `Access-Control-Allow-Origin` errors.

**Fix:**

1. Add your frontend origin to the `cors.origin` list:
   ```typescript
   cors: {
     origin: ['https://my-app.com', 'http://localhost:3000'],
     credentials: true,
   },
   ```
2. If your frontend uses cookies or auth headers, `credentials: true` is required. When `credentials` is `true`, `origin` cannot be `'*'` -- you must list specific origins.
3. After changing the config, restart the dev server or redeploy.
4. Make sure you are not sending requests to `http://` from an `https://` frontend (mixed content).

---

## Rate Limiting

### 429 Too Many Requests during development

**Symptom:** Rapid development or testing triggers `429` responses.

**Fix:** Increase the rate limits in your config for the affected group:

```typescript
rateLimiting: {
  db: { requests: 500, window: '60s' },
  auth: { requests: 100, window: '60s' },
  authSignin: { requests: 50, window: '1m' },
},
```

The defaults are intentionally conservative. Increase them during development, but keep them reasonable for production to protect against abuse.

### Rate limiting hits too early for specific users

**Symptom:** Legitimate users get rate limited while traffic is low.

**Fix:** The default rate limiting keys on client IP. If your users are behind a shared IP (corporate VPN, mobile carrier NAT), many users share the same rate limit bucket. Consider increasing the limits or adjusting the window.

---

## WebSocket / Real-Time

### WebSocket connection drops and does not reconnect

**Symptom:** Real-time subscriptions stop working after a period of inactivity.

**Fix:** The SDK auto-reconnects with exponential backoff by default. If you are seeing persistent disconnects:

1. Check your network -- VPNs and corporate firewalls sometimes kill idle WebSocket connections.
2. On Cloudflare, idle connections are hibernated (not terminated). On wake-up, the SDK automatically re-registers subscriptions. No action needed.
3. If using a reverse proxy in front of EdgeBase, make sure it supports WebSocket upgrades and has a reasonable idle timeout.

### Subscription revoked after token refresh

**Symptom:** `onSnapshot` stops receiving events and you see a `SUBSCRIPTION_REVOKED` error.

**Why:** When a client's auth token is refreshed, the server re-evaluates all active subscriptions against the `read` access rule. If the user's permissions changed (e.g., role was removed), subscriptions that are no longer authorized are revoked.

**Fix:** Listen for revocation errors and re-subscribe or redirect the user:

```typescript
client.databaseLive.onError((error) => {
  if (error.code === 'SUBSCRIPTION_REVOKED') {
    // Handle the revocation (e.g., redirect to login, show a message)
  }
});
```

---

## Still Stuck?

- Check the dev server terminal for detailed error messages.
- Open the Admin Dashboard at `http://localhost:8787/admin` to inspect tables, users, and logs.
- Review the [Configuration](/docs/getting-started/configuration) page for config structure.
- See the [FAQ](/docs/faq) for additional common questions.
