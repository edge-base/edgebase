---
sidebar_position: 2
---

# Authentication Architecture

How EdgeBase handles sign-up, sign-in, sessions, and token lifecycle — with zero per-MAU cost.

## Design Goals

Traditional BaaS platforms manage sessions per user in a centralized database, leading to per-MAU pricing that scales linearly. EdgeBase stores all auth data in a single **D1 database (AUTH_DB)** — Cloudflare's serverless SQL — giving transactional SQL on the primary database and zero per-MAU cost.

## D1-First Auth Architecture

```
Client → Worker → D1 (AUTH_DB)
                    │
                    ├─ _users            (credentials, profiles)
                    ├─ _sessions         (refresh tokens, metadata)
                    ├─ _oauth_accounts   (OAuth provider linking)
                    ├─ _email_tokens     (verification, password reset)
                    ├─ _mfa_factors      (TOTP, WebAuthn registration)
                    ├─ _mfa_recovery_codes
                    ├─ _webauthn_credentials
                    ├─ _users_public     (public profiles)
                    └─ _phone_index      (phone uniqueness)
```

All auth operations go directly to D1 via `auth-d1-service.ts` (~61 exported functions). No Durable Objects are involved in any auth path.

| Layer | Storage | Responsibility |
|---|---|---|
| **AUTH_DB (D1)** | Cloudflare D1 | All auth data: users, sessions, OAuth, email tokens, MFA, passkeys, public profiles, uniqueness indexes |

### Why D1?

- **Transactional writes**: D1 gives EdgeBase a simple SQL transaction model for sign-up, session issuance, and token flows.
- **Atomic transactions**: `db.batch()` enables atomic multi-table operations (e.g., cascade delete user + sessions + OAuth accounts in one transaction).
- **Zero DO overhead**: No Durable Object request costs. D1 works on both Free and Paid plans; Paid raises limits to 25B reads and 50M writes/month.
- **Simplified architecture**: No shard routing, no cross-DO coordination, no compensation transactions.
- **Seamless scale-up**: If your platform outgrows D1 limits on Workers Paid (10 GB per database, 50M writes/month), switch the auth provider to **Neon PostgreSQL** with a single config change — zero code modifications. Storage and throughput limits are effectively removed.

## Request Flow

### Sign-Up and Sign-In

```
Client → Worker → D1 (AUTH_DB)
                    │
                    ├─ Check email uniqueness (_email_index)
                    ├─ db.batch() atomic transaction:
                    │   ├─ INSERT _email_index (status: pending)
                    │   ├─ INSERT _users (credentials, profile)
                    │   └─ UPDATE _email_index (status: confirmed)
                    │
                    ├─ Issue JWT (Access + Refresh)
                    └─ Create _sessions record
```

Routes:
- `POST /auth/signup`
- `POST /auth/signin`
- `POST /auth/signin/anonymous`
- `POST /auth/request-password-reset`

### Session Operations

All session operations query D1 directly using the `userId` from the JWT:

```
Client → Worker → JWT extract userId
                    │
                    └─→ D1 (AUTH_DB) direct query
```

Routes:
- `POST /auth/refresh`
- `POST /auth/signout`
- `PATCH /auth/profile`
- `GET /auth/sessions`
- `DELETE /auth/sessions/:id`
- `POST /auth/change-password`

Since the Refresh Token is also a JWT, the server extracts `sub` from its payload to query D1 directly — no lookup table needed.

### Email Token Operations

Email verification and password reset tokens are stored in the D1 `_email_tokens` table:

```
Client → Worker → D1 query: SELECT FROM _email_tokens WHERE token = ?
                    │
                    └─→ Process verification / reset
```

Token creation inserts into `_email_tokens` with an expiration timestamp. Verification queries by token value and checks expiration. KV may additionally cache token-to-userId mappings for fast lookup.

## D1 Consistency

Auth paths run directly against D1. By default, D1 queries execute on the primary database. If you enable D1 read replication in Cloudflare and need sequential consistency across multiple reads, use the D1 Sessions API in lower-level Worker code.

## Email Normalization

All email entry points apply `trim().toLowerCase()` normalization:

- Sign-up, sign-in
- Email linking, password reset requests
- OAuth callbacks
- Admin user management

This happens at the input layer — the D1 `_email_index` table stores the normalized form. Rate limit keys (`authSignin:{email}`) also use the normalized email, preventing case-based bypass attempts.

## Token Lifecycle

### Token Types

| Token | Format | TTL | Storage |
|---|---|---|---|
| **Access Token** | JWT (`iss: 'edgebase:user'`) | 15 minutes | Client memory only |
| **Refresh Token** | JWT (`iss: 'edgebase:user'`) | 28 days | Secure platform storage |

Both tokens are JWTs signed with `HS256` using the `jose` library (Web Crypto API, fully compatible with Cloudflare Workers).

### Token Delivery

Tokens are delivered exclusively via `Authorization: Bearer <token>` headers. Cookies are intentionally not used — this simplifies CORS handling, eliminates CSRF attack surface, and aligns with the stateless Workers architecture.

### Access Token Verification

**No database call is required for verification.** Every request verifies the JWT signature locally in the Worker middleware using pure cryptography. This is why auth costs $0 regardless of user count — there is no per-request auth infrastructure call.

```
Request with JWT
  │
  ▼
Worker Middleware
  ├─ Extract JWT from Authorization header
  ├─ Verify signature (jose + Web Crypto API)
  ├─ Check expiration
  └─ Extract auth context (userId, role, custom claims)
  │
  ▼
Route Handler (no auth call needed)
```

### Refresh Token Rotation

When a client refreshes, the server issues a new Refresh Token and keeps the previous one valid for a **30-second grace period**:

```
Refresh request arrives with token T1:

1. Look up session in _sessions table (D1)
   → Not found? → 401 Unauthorized

2. Does T1 match current refreshToken?
   → Yes → Normal rotation:
     - Issue new tokens (T2)
     - Store T2 as refreshToken
     - Save T1 as previousRefreshToken + rotatedAt timestamp

3. Does T1 match previousRefreshToken?
   → Yes, within 30s → Grace period: return existing T2 tokens
   → Yes, beyond 30s → Token theft suspected:
     Revoke ALL sessions for this user

4. No match → 401 Unauthorized
```

The grace period handles race conditions when multiple browser tabs or network retries submit the same Refresh Token simultaneously.

### Multi-Tab Coordination

When multiple browser tabs have an expired Access Token, they coordinate using **BroadcastChannel leader election** so that only one tab sends the refresh request:

1. All tabs detect Access Token expiration
2. BroadcastChannel + localStorage mutex elects a single leader
3. Leader tab sends the refresh request
4. Leader broadcasts new tokens to all tabs
5. If the leader doesn't respond within 10 seconds, another tab takes over

For browsers without BroadcastChannel, a `window.storage` event fallback provides equivalent coordination.

### Proactive Token Refresh

All SDKs (JavaScript, Dart, Swift, Kotlin, Python) proactively refresh the Access Token **30 seconds before expiration**. This prevents API request failures due to expired tokens. The refresh is handled automatically by each SDK's internal `TokenManager`.

### Token Storage by Platform

| Platform | Access Token | Refresh Token |
|---|---|---|
| Web (JavaScript) | Memory | localStorage (with BroadcastChannel tab sync) |
| Node.js | Memory | Memory |
| Flutter (Dart) | Memory | `shared_preferences` by default, or custom `TokenStorage` |
| Swift (iOS) | Memory | Keychain Services |
| Kotlin (Android) | Memory | EncryptedSharedPreferences |
| Python | Memory | Memory (optional file storage) |

## Session Cleanup

Expired sessions are cleaned up through two complementary mechanisms:

1. **Lazy cleanup on refresh**: When a user refreshes their token, the server deletes that user's expired sessions from D1
2. **Cron Trigger cleanup**: A daily Cloudflare Cron Trigger (`0 3 * * *`) runs `cleanExpiredSessions()` and `cleanStaleAnonymousAccounts()` against D1 directly

The Cron Trigger prevents stale sessions from accumulating for users who never return. Together, these two mechanisms keep the session tables clean without any external scheduling infrastructure.

## Custom Claims

Developers can attach custom data to JWTs via the `customClaims` mechanism:

```typescript
// Set custom claims for a user
await adminAuth.setCustomClaims(userId, { plan: 'pro', region: 'us' });
```

Custom claims are stored in the `_users` table (D1) and injected into the JWT payload on token issuance and refresh. If an `onTokenRefresh` authentication trigger is configured, its return value is shallow-merged with `customClaims` (trigger values take precedence).

System claims (`sub`, `iss`, `exp`, `iat`, `isAnonymous`) cannot be overridden.

## Key Rotation

### JWT Secret Rotation

```bash
npx edgebase keys rotate-jwt
```

- Rotates both user and admin JWT signing keys simultaneously
- **28-day grace period**: the previous key (`JWT_USER_SECRET_OLD`, `JWT_ADMIN_SECRET_OLD`) remains valid for 28 days, matching the Refresh Token TTL
- Access Tokens (15-minute TTL) naturally expire within 15 minutes of rotation — no grace period needed
- Server verification tries the new key first, falls back to the old key within the grace period

### Service Key Rotation

```bash
npx edgebase keys rotate
```

- Replaces the current Service Key immediately
- Runtime validation only accepts keys declared in `config.serviceKeys`
- Update callers or secret consumers at the same time you rotate

## Next Steps

- [**Security Model**](./security-model.md) — 3-stage membership verification and attack prevention
- [**Rate Limiting**](./rate-limiting.md) — Auth-specific rate limiting and DDoS defense
