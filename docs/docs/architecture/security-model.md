---
sidebar_position: 1
---

# Security Model

How EdgeBase prevents unauthorized access to isolated data — even when clients choose the DB instance ID in the URL path.

## The Challenge

With the `workspace:{id}` DB block, the client explicitly passes the workspace ID:

```typescript
const docs = await client.db('workspace', 'ws_abc123').table('documents').getList();
```

The ID is passed as a URL path parameter (`/api/db/workspace/ws_abc123/tables/documents`). A natural question arises: **what stops a malicious client from using any workspace ID?**

The answer is the **Rules Middleware**, which evaluates a developer-defined `access()` rule on every request.

## Membership Verification

Every request to an isolated table passes through the **Rules Middleware**, which sits between Auth and the Handler in the middleware chain:

```
Auth Middleware ── verifies JWT, extracts user identity
       │
       ▼
Rules Middleware ── Step 1: Service Key bypass
                   Step 2: Resolve DB block from namespace
                   Step 3: DB-level access() rule evaluation
                   Step 4+: Table-level access rules
       │
       ▼
Handler (DO proxy) ── row-level rules for read/update/delete
```

### Two Isolation Modes

The Rules Middleware handles `auth.id` and external keys differently:

#### `auth.id` — Zero-Trust from JWT

For the `user:{id}` DB block, the server **never trusts the client**:

- The user ID is extracted exclusively from the JWT `sub` claim (cryptographically signed)
- `auth.id` in the URL path is always verified against the JWT `sub` claim
- Even if a modified client sends `auth.id` in the header, the server discards it

**No verification needed** — the JWT signature is the proof of identity.

#### External Keys — `access()` Rule Evaluation

For the `workspace:{id}` DB block (or any dynamic block), the server evaluates the DB-level `access()` rule directly:

```
Request: GET /api/db/workspace/ws_abc123/tables/documents
JWT: user_42

       │
       ▼
Step 1: Service Key Check
  └─ Valid Service Key? → ✅ Bypass all access checks (early return)
       │ (no Service Key)
       ▼
Step 2: Resolve DB Block
  └─ Look up 'workspace' namespace in config.databases
       │
       ▼
Step 3: DB-level access() Rule
  └─ Evaluate: dbRules.access(auth, 'ws_abc123', dbRuleCtx)
     The access() function is a developer-defined TypeScript function
     in edgebase.config.ts. It receives the authenticated user context,
     the instance ID, and a dbRuleCtx helper for internal DB reads.
     → returns true  → ✅ Proceed to table-level rules
     → returns false → 403 "You do not have access to workspace:ws_abc123"
```

The `dbRuleCtx` parameter provides `db.get()` and `db.exists()` helpers that allow the `access()` rule to perform internal database reads — for example, querying a membership table to verify whether the user belongs to the requested workspace.

## Attack Scenarios

### Unauthorized Workspace Access

```typescript
// Attacker tries to access a workspace they don't belong to
client.db('workspace', 'ws_not_mine').table('documents').getList(); // → 403
```

**Result**: The `access()` rule evaluates at the Worker level and returns `false` for this user + workspace combination. The request is rejected with `403 Access denied`.

Note: depending on how the `access()` rule is implemented, it may perform internal DB reads (via `dbRuleCtx`) to verify membership. In that case, a DO or database may be contacted as part of the rule evaluation — but the request itself is still blocked before reaching the target endpoint handler.

### Unlimited Tenant Creation

**Concern**: Can an attacker create unlimited DOs by sending arbitrary workspace IDs?

**Answer**: No. Specifying an ID in the URL path is a request to **access an existing DO**, it does not create one. The `access()` rule is evaluated before any DO routing occurs — it returns `false` and the request is rejected with 403. A DO is only created when `canCreate` returns `true`.

### Impersonation via Header Manipulation

**Concern**: Can an attacker use another user's `auth.id` as the DB instance ID?

**Answer**: No. For the `user:{id}` block, the server **substitutes** `auth.id` (extracted from the JWT `sub` claim) as the DB instance ID — the client-supplied ID in the URL is ignored entirely. There is no comparison; the authenticated user's ID *is* the instance ID, so a user can only ever access their own instance.

### Delayed Membership Revocation

**Concern**: If a user is removed from a workspace, can they still access it with their existing JWT?

**Answer**: No, as long as the `access()` rule checks current membership. Since the `access()` rule is evaluated on every request and can query the database in real time (via `dbRuleCtx.db.exists()` or `dbRuleCtx.db.get()`), revoking a membership record is immediately reflected. The next request will fail the `access()` check and receive a 403.

If an `access()` rule relies solely on JWT claims without checking the database, the exposure window is bounded by the **Access Token TTL** (typically 15 minutes).

## Captcha (Bot Protection)

Auth endpoints are protected by [Cloudflare Turnstile](/docs/authentication/captcha) when `captcha: true` is set in the config. Captcha runs **after rate limiting** and **before the auth handler**:

```
Request → CORS → Rate Limit → Captcha → Auth Handler
```

- Captcha is **not a global middleware** — it's applied internally within auth routes (signup, signin, anonymous, magic-link, phone, password-reset, OAuth) and optionally on HTTP functions
- **Service Keys bypass** captcha — server-to-server calls are trusted
- **failMode: open** (default) allows requests through if the Turnstile API is unreachable
- **Action verification** prevents token reuse across endpoints (a signup token can't be used for signin)

See [Captcha Guide](/docs/authentication/captcha) for full configuration and SDK details.

## Declarative Access Rules

Beyond membership verification, every data operation passes through a **deny-by-default rules engine**:

```typescript
databases: {
  app: {
    tables: {
      posts: {
        access: {
          read(auth, row) { return auth !== null },
          insert(auth) { return auth !== null },
          update(auth, row) { return auth?.id === row.authorId },
          delete(auth, row) { return auth?.id === row.authorId || auth?.role === 'admin' },
        },
        schema: { /* ... */ },
      },
    },
  },
}
```

### TypeScript Functions — Not `eval()`

Cloudflare Workers block `eval()` and `new Function()` for security reasons. EdgeBase uses **native TypeScript functions** for access rules — bundled at build time via esbuild:

```
edgebase.config.ts
  └─ access: { read(auth, row) { ... } }
         ↓
bundled into the Worker / DO runtime
```

There is no runtime `eval()` step for normal configs. If tooling ever strips function bodies and falls back to a serialized form, unsupported expressions fail closed rather than widening access.

### Fail-Closed by Default

If no rules are defined for an operation, **access is denied** (when `release: true`):

```typescript
// No 'delete' rule defined → delete is blocked
posts: {
  access: {
    read(auth) { return auth !== null },
    insert(auth) { return auth !== null },
    // update: not defined → 403
    // delete: not defined → 403
  },
}
```

This eliminates an entire class of security bugs — forgetting to add a rule never accidentally grants access.

:::tip Development Mode
During development (`release: false`, the default), operations are allowed without rules on configured resources. Set `release: true` before production deployment.
:::

## Service Key Behavior

A valid Service Key bypasses **all access checks** — both DB-level `access()` rules and table-level access rules:

```
Service Key + dynamic DB block:

  Auth Middleware:    ✅ Service Key recognized
  Rules Middleware:   ✅ Service Key validated → early return (all rules bypassed)
```

This means a server-side SDK with a valid Service Key can access any DB instance and any table without membership verification or row-level rule checks. Service Keys are intended for trusted server-to-server communication where the calling service is responsible for its own authorization logic.

## Summary

| Layer | What It Protects | Bypass Possible? |
|---|---|---|
| **JWT Verification** | User identity | No — cryptographic signature |
| **DB-level `access()` Rule** | Tenant boundary | Only with Service Key (by design) |
| **Captcha (Turnstile)** | Bot protection on auth endpoints | Only with Service Key (by design) |
| **Table-level Rules Engine** | Per-record authorization | Only with Service Key (by design) |
| **Fail-Closed Default** | Undefined operations | No — undefined = denied (when `release: true`) |
