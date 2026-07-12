---
sidebar_position: 2
---

# Authentication Architecture

How EdgeBase handles sign-up, sign-in, sessions, and token lifecycle — with zero per-MAU cost.

## Design Goals

Traditional BaaS platforms often charge a per-MAU product fee. EdgeBase stores
durable auth data in **D1 (AUTH_DB)** and does not add a per-MAU license fee;
normal Cloudflare or self-hosted infrastructure usage still applies.

## D1-First Auth Architecture With Atomic OAuth Coordination

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

Durable user, identity, and session records go directly to D1 through the auth
service. Short-lived OAuth state and account-link continuations use a
key-sharded `AUTH` Durable Object so callback authority can be atomically
consumed exactly once.

| Layer | Storage | Responsibility |
|---|---|---|
| **AUTH_DB (D1)** | Cloudflare D1 | All auth data: users, sessions, OAuth, email tokens, MFA, passkeys, public profiles, uniqueness indexes |
| **AUTH Durable Objects** | Durable Object storage | Five-minute OAuth state, one-minute account-link continuations, atomic consume/replay prevention |

### Why D1?

- **Transactional writes**: D1 gives EdgeBase a simple SQL transaction model for sign-up, session issuance, and token flows.
- **Atomic transactions**: `db.batch()` enables atomic multi-table operations (e.g., cascade delete user + sessions + OAuth accounts in one transaction).
- **Targeted coordination**: Normal auth and access-token verification do not
  pay a Durable Object hop; only short-lived OAuth callback authority uses the
  key-sharded coordinator.
- **Simple durable data model**: User, identity, and session records remain in
  one transactional database; OAuth coordination stores no durable user data.
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

### OAuth State Operations

OAuth sign-in state, account-link state, and one-time browser continuations are
written to a Durable Object shard selected by their random key. Callback
handling performs an atomic read-and-terminal-consume in that same shard before
provider exchange or account mutation. Expired and consumed records cannot be
replayed concurrently. Cloudflare KV is retained only as a best-effort
rolling-upgrade mirror and one-time legacy fallback; new flows never treat KV
as callback authority.

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

Access tokens are delivered to the client and used through
`Authorization: Bearer <token>`. Refresh tokens support two transports:

- **Body transport (default)** — preserves existing SDK and non-browser
  compatibility. The client stores and submits the rotating refresh token.
- **HttpOnly cookie transport (opt-in for Web)** — EdgeBase keeps the rotating
  refresh token in a host-only cookie and returns only the access token to
  JavaScript. HTTPS uses `__Host-{configuredName}; Secure; Path=/`; plain-HTTP
  development uses the unprefixed name at `/api/auth`. The Web SDK opts in
  explicitly and keeps access tokens in memory.

Cookie transport does not make access-token requests cookie-authenticated. It
only protects the durable refresh credential. EdgeBase requires the custom
transport header plus same-origin or an exact credentialed CORS origin, so an
ambient cookie alone cannot authorize refresh or sign-out requests.

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

The grace period handles retries of the previous token by returning the
already-winning current replacement. It never performs another rotation from
the previous token. The Web SDK additionally serializes refresh and all other
credential-creating auth mutations across tabs.

### Multi-Tab Coordination

When multiple browser tabs have an expired Access Token, they coordinate using **BroadcastChannel leader election** so that only one tab sends the refresh request:

1. All tabs detect Access Token expiration
2. BroadcastChannel + localStorage mutex elects a single leader
3. Leader tab sends the refresh request
4. Body transport broadcasts the winning token result; cookie transport sends
   only a non-secret signal and each follower performs its own cookie refresh
5. If the leader doesn't respond within 10 seconds, another tab takes over

For browsers without BroadcastChannel, a `window.storage` event fallback provides equivalent coordination.

### Proactive Token Refresh

All SDKs (JavaScript, Dart, Swift, Kotlin, Python) proactively refresh the Access Token **30 seconds before expiration**. This prevents API request failures due to expired tokens. The refresh is handled automatically by each SDK's internal `TokenManager`.

### Token Storage by Platform

| Platform | Access Token | Refresh Token |
|---|---|---|
| Web (JavaScript, default) | Memory | localStorage (with BroadcastChannel tab sync) |
| Web (HttpOnly cookie opt-in) | Memory | EdgeBase-managed `__Host-` HttpOnly cookie on HTTPS |
| React Native | Memory | App-provided Keychain/Keystore `secureStorage`, isolated by base URL or `authNamespace` |
| Node.js | Memory | Memory |
| Flutter (Dart) | Memory | `shared_preferences` by default, or custom `TokenStorage` |
| Swift (iOS) | Memory | Keychain Services |
| Kotlin (Android) | Memory | EncryptedSharedPreferences |
| Python | Memory | Memory (optional file storage) |

React Native's public `TokenManager.setTokens()` is asynchronous and must be
awaited. It persists the refresh credential to the configured secure storage
before exposing the access token, current user, or auth-state event. A storage
failure rejects with `auth-token-persistence-failed` and never exposes the
uncommitted session. The call is an authoritative identity transition and
invalidates older queued refresh/OAuth work through the durable auth epoch.

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
