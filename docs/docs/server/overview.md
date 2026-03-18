---
sidebar_position: 0
sidebar_label: Overview
slug: /server
---

# Server Configuration

Everything about configuring and managing your EdgeBase server — from access rules to rate limiting to custom email templates.

All service-key-backed server features described in this section are available across all Admin SDKs.

---

## Configuration File

All server behavior is defined in `edgebase.config.ts`:

```typescript
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  release: false,           // Set true for production (deny-by-default)
  databases: {
    app: {
      tables: { /* schema + access + handlers */ },
    },
  },
  auth: { /* providers, hooks */ },
  storage: { /* buckets + access + handlers */ },
  rooms: { /* multiplayer rooms */ },
});
```

## Key Topics

| Topic | Description |
|-------|-------------|
| **Config Reference** | Full `defineConfig()` options and defaults |
| **Access Rules** | Declarative access control for tables and storage |
| **Service Keys** | Server-side auth that bypasses rules (with optional scoping) |
| **Rate Limiting** | 2-tier defense: software counters + Cloudflare Binding ceilings |
| **Email** | Transactional email for verification, password reset, invitations |
| **[Plugins](/docs/plugins)** | Extend EdgeBase with community or custom plugins (see dedicated section) |
| **Raw SQL** | Direct SQLite access via Admin SDK |
| **Native Resources** | Access Cloudflare KV, D1, Vectorize bindings directly |

## Next Steps

| Page | Description |
|------|-------------|
| [Config Reference](/docs/server/config-reference) | Complete configuration options |
| [Access Rules](/docs/server/access-rules) | Table and storage access control |
| [Service Keys](/docs/server/service-keys) | Server-side rule bypass with scoping |
| [Rate Limiting](/docs/server/rate-limiting) | DDoS protection and abuse prevention |
| [Email](/docs/server/email) | Email providers and templates |
| [Plugins](/docs/plugins) | Build-time plugin system |
| [Raw SQL](/docs/server/raw-sql) | Direct SQL queries from Admin SDK |
| [Native Resources](/docs/server/native-resources) | KV, D1, R2, Vectorize bindings |
