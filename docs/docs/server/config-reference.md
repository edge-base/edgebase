---
sidebar_position: 1
---

# Config Reference

Complete reference for `edgebase.config.ts`.

## Preferred Grammar

EdgeBase now prefers a shared `access + handlers` config grammar for product surfaces such as DB, storage, push, auth, and rooms.

- Use `access` for allow/deny decisions.
- Use `handlers.hooks` for interception points such as `before*`, `after*`, `enrich`, or delivery hooks.
- Plugin-defined tables are merged into their target DB block before materialization, so they inherit the same grammar as first-party tables.

```typescript
export default defineConfig({
  databases: {
    app: {
      tables: {
        posts: {
          access: {
            read: () => true,
            insert: (auth) => auth !== null,
          },
          handlers: {
            hooks: {
              beforeInsert: async (_auth, data) => ({ ...data, status: 'draft' }),
            },
          },
        },
      },
    },
  },
  push: {
    access: {
      send: (auth) => auth !== null,
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
  auth: {
    access: {
      signIn: (_input, ctx) => !!ctx.auth,
    },
    handlers: {
      hooks: {
        enrich: async () => ({ tenantRole: 'member' }),
      },
      email: {
        onSend: async () => undefined,
      },
      sms: {
        onSend: async () => undefined,
      },
    },
  },
  rooms: {
    game: {
      access: {
        metadata: (auth) => !!auth,
        join: (auth) => !!auth,
        action: (auth) => !!auth,
      },
      handlers: {
        lifecycle: {
          onJoin: (sender, room) => {
            room.setPlayerState(sender.userId, () => ({ hp: 100 }));
          },
        },
        actions: {
          MOVE: (payload, room) => {
            room.setSharedState((state) => ({ ...state, position: payload }));
          },
        },
      },
    },
  },
});
```

## Full Example

```typescript
import { defineConfig } from '@edgebase/shared';

export default defineConfig({
  // ─── Release Mode ──────────────────────────────────────
  release: false,  // Set to true before production deployment
  baseUrl: 'https://api.example.com',
  trustSelfHostedProxy: true, // Self-hosted only: trust X-Forwarded-For from your reverse proxy

  // ─── Databases ──────────────────────────────────────────
  databases: {
    app: {
      tables: {
        posts: {
          schema: {
            title:     { type: 'string', required: true, min: 1, max: 200 },
            content:   { type: 'text' },
            status:    { type: 'string', enum: ['draft', 'published'], default: 'draft' },
            views:     { type: 'number', default: 0 },
            authorId:  { type: 'string', references: 'users' }, // logical auth-user reference
            tags:      { type: 'json' },
            published: { type: 'datetime' },
            featured:  { type: 'boolean', default: false },
          },
          indexes: [
            { fields: ['status'] },
            { fields: ['authorId', 'createdAt'] },
            { fields: ['status', 'views'], unique: false },
          ],
          fts: ['title', 'content'],
          access: {
            read(auth, row) { return true },
            insert(auth) { return auth !== null },
            update(auth, row) { return auth !== null && auth.id === row.authorId },
            delete(auth, row) { return auth !== null && auth.id === row.authorId },
          },
        },
      },
    },
  },

  // ─── Authentication ───────────────────────────────────
  auth: {
    allowedOAuthProviders: ['google', 'github', 'apple', 'discord'],
    oauth: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    },
    anonymousAuth: true,
    allowedRedirectUrls: [
      'https://app.example.com/auth/*',
      'http://localhost:3000/auth/*',
    ],
    anonymousRetentionDays: 30,
    // Delete Isolated DO data when a user is deleted (DECISIONS #118)
    cleanupOrphanData: false,
  },

  // ─── Storage ──────────────────────────────────────────
  storage: {
    buckets: {
      default: {
        access: {
          read(auth, file) { return true },
          // maxFileSize/allowedMimeTypes removed — enforce in write rule instead:
          write(auth, file) { return auth !== null && file.size < 50 * 1024 * 1024 && /^image\//.test(file.contentType) },
          delete(auth, file) { return auth !== null && auth.id === file.uploadedBy },
        },
      },
    },
  },

  // ─── Captcha (Bot Protection) ────────────────────────
  // captcha: true,                     // Auto-provision via Cloudflare deploy
  captcha: {                            // Manual keys (self-hosting / Docker)
    siteKey: '0x4AAAAAAA...',           // Turnstile dashboard → siteKey
    secretKey: '0x4AAAAAAA...',         // Turnstile dashboard → secretKey
    failMode: 'open',                   // 'open' (default) | 'closed'
    siteverifyTimeout: 3000,            // ms (default: 3000)
  },

  // ─── Rate Limiting ────────────────────────────────────
  rateLimiting: {
    global:      { requests: 10000000, window: '60s' },
    db: {
      requests: 100,
      window: '60s',
      binding: { limit: 250, period: 60, namespaceId: '2002' },
    },
    storage:     { requests: 50,     window: '60s' },
    functions:   { requests: 50,     window: '60s' },
    auth:        { requests: 30,     window: '60s' },
    authSignin:  { requests: 10,     window: '1m' },
    authSignup:  { requests: 10,     window: '60s' },
    events:      { requests: 100,    window: '60s' },
  },

  // ─── CORS ─────────────────────────────────────────────
  cors: {
    origin: ['https://my-app.com', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true,
  },

  // ─── Database Live ──────────────────────────────────────
  databaseLive: {
    authTimeoutMs: 5000,
    batchThreshold: 10,
  },

  // ─── Service Keys ─────────────────────────────────────
  // Consumed by all Admin SDKs.
  serviceKeys: {
    keys: [
      {
        kid: 'backend',
        tier: 'root',
        scopes: ['*'],
        secretSource: 'dashboard',
        secretRef: 'SERVICE_KEY_BACKEND',
        constraints: { env: ['prod'], ipCidr: ['10.0.0.0/8'] },
      },
    ],
  },

  // ─── Functions ────────────────────────────────────────
  functions: {
    scheduleFunctionTimeout: '30s',
  },

  // ─── Cloudflare Deploy Escape Hatches ────────────────
  cloudflare: {
    extraCrons: ['15 * * * *'],  // Additional Wrangler cron triggers
  },

  // Note:
  // - blocking auth/storage hook timeouts are fixed at 5 seconds
  // - deploy replaces the managed [triggers] set from config
  // - extraCrons wakes scheduled() but does not target a specific App Function

  // ─── API ──────────────────────────────────────────────
  api: {
    schemaEndpoint: 'authenticated',  // true | false | 'authenticated'
  },

  // ─── Email ────────────────────────────────────────────
  email: {
    provider: 'resend',
    apiKey: '...',
    from: 'noreply@my-app.com',
  },

  // ─── KV (User-defined namespaces) ──────────────────── 
  kv: {
    cache: {
      binding: 'CACHE_KV',
      rules: { read(auth) { return true }, write(auth) { return auth !== null } },
    },
  },

  // ─── D1 (User-defined databases) ──────────────────── 
  d1: {
    analytics: { binding: 'ANALYTICS_DB' },
  },

  // ─── Vectorize (Vector search indexes) ─────────────── 
  vectorize: {
    embeddings: { binding: 'EMBEDDINGS_INDEX', dimensions: 1536, metric: 'cosine' },
  },
});
```

## Canonical Base URL

Set `baseUrl` to the public origin where your EdgeBase server is reachable.

- OAuth callback URLs are built from `baseUrl`.
- Email-action links and runtime metadata use the same canonical origin.
- In local development, this is typically `http://127.0.0.1:8787` or `http://localhost:8787`, whichever your provider callback configuration expects.

## Trusted Proxy Headers

Set `trustSelfHostedProxy: true` only when EdgeBase is running behind a reverse proxy that overwrites `X-Forwarded-For` with the real client IP.

- Default: `false`
- Always trusted: `CF-Connecting-IP` on Cloudflare Edge
- Trusted only when `trustSelfHostedProxy: true`: `X-Forwarded-For` in self-hosted deployments

This setting affects IP-based features such as:
- [Rate limiting](/docs/server/rate-limiting)
- Service Key `ipCidr` constraints
- Auth/session IP tracking
- Pending WebSocket connection limits

```typescript
export default defineConfig({
  baseUrl: 'https://api.example.com',
  trustSelfHostedProxy: true,
});
```

If you self-host EdgeBase behind Nginx or Caddy and want per-client IP behavior, enable `trustSelfHostedProxy: true`. If you expose EdgeBase directly to the internet, leave it `false`.

`rateLimiting` is an **abuse-protection configuration**, not a strict global quota system.

| Field | Meaning |
|------|---------|
| `requests` | Soft-limit request count |
| `window` | Soft-limit window (`60s`, `5m`, `1h`, ...) |
| `binding` | Optional Cloudflare binding override for built-in groups only |

Notes:
- Built-in groups are `global`, `db`, `storage`, `functions`, `auth`, `authSignin`, `authSignup`, `events`
- `binding` is applied by `edgebase dev` / `edgebase deploy` when the CLI generates the temporary `wrangler.toml`
- Custom groups do not get generated Cloudflare bindings automatically

## Section Reference

| Section | Description |
|---------|-------------|
| `baseUrl` | Canonical public server origin used for OAuth callbacks and auth/email redirects |
| `trustSelfHostedProxy` | Trust `X-Forwarded-For` from a self-hosted reverse proxy; Cloudflare `CF-Connecting-IP` stays trusted regardless |
| `release` | Release mode — `true` enables deny-by-default, `false` (default) bypasses access checks |
| `databases` | DB blocks (app, namespace:\{id\}...) with tables, schemas, and access policies |
| `auth` | OAuth providers, anonymous auth settings |
| `captcha` | [Captcha (bot protection) settings](/docs/authentication/captcha) — `true` for auto-provision, or `{ siteKey, secretKey }` for manual |
| `storage` | Bucket definitions, size/type limits, rules |
| `serviceKeys` | [Service Key definitions, scopes, constraints](/docs/server/service-keys) |
| `rateLimiting` | Request limits per time window |
| `cors` | Cross-origin request settings |
| `databaseLive` | Database subscription transport tuning such as `authTimeoutMs` and `batchThreshold` |
| `rooms` | Room namespaces with `access`, lifecycle/action/timer handlers, and `public.*` release opt-ins |
| `push` | FCM config plus server-side delivery access and hooks |
| `functions` | Function settings (`scheduleFunctionTimeout`; blocking auth/storage hook timeout stays fixed at 5 seconds) |
| `cloudflare` | Deploy-time Cloudflare escape hatches such as additional managed cron triggers |
| `api` | API endpoint configuration |
| `email` | [Email provider settings](/docs/server/email) |
| `plugins` | Build-time plugin instances; plugin tables inherit DB config grammar after merge |
| `kv` | User-defined KV namespace bindings (server-only, #121) |
| `d1` | User-defined D1 database bindings (server-only, #121) |
| `vectorize` | Vectorize index settings — binding (optional), dimensions, metric (server-only, #121) |
