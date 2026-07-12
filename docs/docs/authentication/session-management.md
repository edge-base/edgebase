---
sidebar_position: 14
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Session Management

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Configure and manage user sessions including token lifetimes, session limits, and multi-device support.

## Configuration

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    session: {
      accessTokenTTL: '15m',       // Default: '15m'
      refreshTokenTTL: '28d',      // Default: '28d'
      maxActiveSessions: 5,        // Default: 0 (unlimited)
      cookie: {
        enabled: true,             // Opt in; legacy token-body SDKs still work
        name: 'my-app-refresh',    // Base name; useful on localhost
        legacyNames: [],           // Optional deletion-only names after a rename
        sameSite: 'strict',        // Default: 'strict'
      },
    },
  },
});
```

When renaming a refresh cookie, list its former base names in `legacyNames` for
one release window. EdgeBase never authenticates with those names; it only
expires their host-only, secure, and local-development variants whenever the
current refresh cookie is issued or cleared.

## Session Limit (maxActiveSessions)

Control the maximum number of concurrent sessions per user. When the limit is reached, the **oldest sessions are automatically evicted** to make room for new ones.

### Behavior

| Config Value | Behavior |
|-------------|----------|
| `0` (default) | Unlimited sessions |
| `1` | Single session only (new sign-in evicts previous) |
| `5` | Up to 5 concurrent sessions |

### Eviction Logic

When a user signs in and `currentSessions >= maxActiveSessions`:

1. Calculate `excess = currentSessions - maxActiveSessions + 1`
2. Delete the oldest sessions by `createdAt` (ascending)
3. Create the new session

This ensures the user always has room for exactly one new session, even when at the limit.

### Example

With `maxActiveSessions: 3`:

```
Sessions: [Phone (oldest), Tablet, Laptop]
New sign-in from Desktop:
  -> excess = 3 - 3 + 1 = 1
  -> Delete Phone session (oldest)
  -> Create Desktop session
Result: [Tablet, Laptop, Desktop]
```

## Token Lifetimes

| Token | Default TTL | Storage |
|-------|------------|---------|
| Access Token (JWT) | 15 minutes | Memory (stateless) |
| Refresh Token (JWT) | 28 days | `_sessions` table |

## HttpOnly Refresh Cookies (Web)

Browser apps can keep the refresh credential out of JavaScript-accessible
storage while continuing to use short-lived Bearer access tokens:

```ts
const client = createClient(edgeBaseUrl, {
  refreshTokenTransport: 'httpOnlyCookie',
});
```

The server must also enable `auth.session.cookie`. The Web SDK then negotiates
the transport with `X-EdgeBase-Auth-Transport: cookie`, sends auth requests with
credentials, and stores only the access token in memory. The refresh token is
set by EdgeBase as a host-only `HttpOnly` cookie. HTTPS requests use the
`__Host-{configuredName}` form with `Secure` and `Path=/`; plain-HTTP local
development uses the configured base name with `Path=/api/auth`.
`SameSite=Strict` is the default.

An HTTP loopback request is allowed only when the CLI marks the process as
`EDGEBASE_RUNTIME_MODE=local-development`, even if the loaded config sets
`release: true`. Deployed Cloudflare and self-hosted release runtimes remain
HTTPS-only. The exception does not make `SameSite=None` valid over HTTP.

Cookie auth requests require a verifiable `Origin`. Cross-origin browser apps
must use an exact `cors.origin` entry with `credentials: true`; wildcard origins
and opaque `Origin: null` requests are deliberately rejected. Prefer serving
the app and EdgeBase from the same origin. An unavoidable cross-site deployment
must explicitly set `sameSite: 'none'`; EdgeBase fails fast rather than issuing
a Strict/Lax cookie that the browser would silently omit. `SameSite=None`
requires HTTPS (or `trustSelfHostedProxy: true` with a verified
`X-Forwarded-Proto: https` request). EdgeBase rejects cookie auth over plain
HTTP when `SameSite=None` is configured instead of returning a successful
response with a cookie the browser would drop. Third-party-cookie blocking can
still prevent that topology from working.

Origin failures use stable error slugs so browser apps can show an actionable
configuration message without exposing raw server details:

- `cookie-auth-origin-required`: the negotiated cookie request omitted Origin.
- `cookie-auth-origin-unverifiable`: Origin was opaque, malformed, or used an
  unsupported scheme.
- `cookie-auth-origin-untrusted`: Origin was not the request origin or an exact
  credentialed CORS origin.

These remain HTTP 403 responses. `incompatible-cookie-config` remains the
separate error for a trusted cross-site request whose SameSite mode cannot
carry the cookie.

`Secure` is derived from the request URL. A self-hosted TLS-terminating reverse
proxy may forward `X-Forwarded-Proto: https` only when
`trustSelfHostedProxy: true` is configured; EdgeBase intentionally ignores that
client-spoofable header otherwise.

The `__Host-` migration is fail closed. Secure deployments do not read or
migrate predecessor `__Secure-` cookies or the old unprefixed `/api/auth`
cookie; they expire those variants and require the user to sign in again. This
prevents an older, less strictly scoped cookie from being silently promoted.

Existing body-token SDKs remain the default. A cookie-mode Web SDK can exchange
one existing localStorage refresh token when no refresh cookie exists, then
removes that legacy credential after a successful exchange. If the user signs
out before migration, the SDK removes the persisted token immediately and holds
it only in the current `AuthClient` instance long enough to request server
revocation; it is never retained in localStorage behind a sign-out tombstone.

The cookie-mode SDK persists only a non-secret `{ version: 1, userId }` session
marker for local-first cache selection; it never stores access tokens, refresh
tokens, email addresses, roles, or custom claims. On an online reload it first
validates the HttpOnly session with the server. A network or server outage may
restore only the marker's user ID so offline data remains addressable, while a
definitive `401`/`403` removes the stale marker. Offline sign-out similarly
keeps only a non-secret pending-revocation tombstone until the server can clear
the cookie. Transient sign-out failures use bounded background retry, and a new
sign-in is serialized behind that revocation so a later retry cannot revoke the
new session. If an access rule or blocking `beforeSignOut` trigger returns
`403`, the SDK clears private in-memory/UI state immediately but preserves the
tombstone and surfaces the denial; the server cookie and session remain valid
because the configured policy explicitly rejected revocation.

When another tab changes the shared cookie to a different account, the Web SDK
first emits signed-out state and closes room/database-live sockets belonging to
the old principal. It then performs its own cookie-authenticated refresh and
emits the newly verified account; bearer tokens are never transferred between
tabs. Every credential- or cookie-creating auth request is serialized across
tabs with a heartbeated auth-mutation lock. Sign-out first advances a persisted
auth epoch and hides the local session, waits for earlier mutations, then takes
the final mutation slot to clear/revoke the cookie. Late responses fail their
epoch check and cannot become visible. Cookie-auth POSTs, including the raw
refresh path used by Room and Database Live recovery, use bounded waits so a
stalled connection cannot hold that lock forever. If a request outlives the
absolute sign-out wait, the SDK keeps the non-secret tombstone and performs a
final revocation after it settles, preventing its late `Set-Cookie` response
from reopening a signed-out session on reload.

OAuth app callbacks contain only a five-minute completion ticket, transport, and
SDK binding fields—never bearer credentials. The Web SDK scrubs those fields,
consumes the matching CSPRNG flow nonce, then atomically posts the ticket to
`/api/auth/oauth/exchange`; cookie transport sets the refresh cookie only in
that exchange response. Pending nonces live in a separate bounded registry:
matching success or provider-error callbacks consume only their own flow, while
missing, malformed, and nonce-mismatched callbacks leave other flows intact.
Sign-out clears the registry and advances a persisted auth epoch, preventing a
slow ticket exchange in this tab or another tab from restoring the session.

### Refresh Token Rotation

EdgeBase implements **automatic refresh token rotation** with a 30-second grace period:

1. On refresh, the old token is stored as `previousRefreshToken`
2. The new token replaces `refreshToken`
3. The database changes those fields only if the supplied token is still the
   current token; concurrent refreshes therefore converge on one winning token
   instead of creating divergent sessions
4. During the 30-second grace period, the previous token resolves to the one
   already-issued current replacement; it does not rotate again or create a
   divergent token branch
5. After 30 seconds, using the old token triggers **the session is revoked** (token theft detection)

Sign-out revokes the stable session ID that was verified before any blocking
`beforeSignOut` hook. Token rotations that finish while the hook is awaiting
cannot make that session escape revocation.

## Listing Sessions

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// List all active sessions for the current user
const { sessions } = await client.auth.listSessions();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final sessions = await client.auth.listSessions();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let sessions = try await client.auth.listSessions()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val sessions = client.auth.listSessions()
```

</TabItem>
<TabItem value="java" label="Java">

```java
List<Map<String, Object>> sessions = client.auth().listSessions();
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var sessions = await client.Auth.ListSessionsAsync();
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto sessions = client.auth().listSessions();
```

</TabItem>
</Tabs>

## Revoking Sessions

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// Revoke a specific session
await client.auth.revokeSession(sessionId);
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.revokeSession(sessionId);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
try await client.auth.revokeSession(sessionId)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.revokeSession(sessionId)
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().revokeSession(sessionId);
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await client.Auth.RevokeSessionAsync(sessionId);
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
client.auth().revokeSession(sessionId);
```

</TabItem>
</Tabs>

```typescript
// Admin: Revoke all sessions for a user
await admin.auth.revokeAllSessions(userId);
```

## Session Cleanup

Expired sessions are cleaned up automatically:

- **Lazy cleanup**: On `POST /auth/refresh`, expired sessions for the user are deleted
- **Cron cleanup**: A daily Cloudflare Cron Trigger (`0 3 * * *`) runs `cleanExpiredSessions()` and `cleanStaleAnonymousAccounts()` against D1 (AUTH_DB) directly

## Multi-Tab Support

In browser environments, EdgeBase uses a localStorage mutex plus
**BroadcastChannel** notifications to prevent simultaneous refreshes. Body
transport shares the winning token result with peer tabs. Cookie transport
never broadcasts bearer tokens: a peer receives only a refresh signal and
performs its own cookie-authenticated refresh for an access token. All auth
storage keys, locks, channels, and push caches are isolated by `authNamespace`
or the normalized EdgeBase base URL.

Fallback: `window.storage` event for browsers without BroadcastChannel support.

## Related

- [Sessions](./sessions) — SDK examples for listing and revoking sessions across all languages
- [Limits](./limits) — Token TTL defaults, rate limits, and session cleanup intervals
- [Email & Password](./email-password) — Token management and auto-refresh behavior
