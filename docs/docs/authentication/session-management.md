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
        sameSite: 'strict',        // Default: 'strict'
      },
    },
  },
});
```

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
set by EdgeBase as a host-only `HttpOnly` cookie scoped to `/api/auth`; it is
`Secure` on HTTPS and uses `SameSite=Strict` by default.

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

`Secure` is derived from the request URL. A self-hosted TLS-terminating reverse
proxy may forward `X-Forwarded-Proto: https` only when
`trustSelfHostedProxy: true` is configured; EdgeBase intentionally ignores that
client-spoofable header otherwise.

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
tabs. A live refresh lock is heartbeated so sign-out waits for any already
applied refresh response before performing the final cookie clear/revocation.
Cookie-auth POSTs, including the raw refresh path used by Room and Database
Live recovery, are aborted after a bounded wait so a stalled connection cannot
hold that lock forever. If a nonstandard refresh callback outlives the absolute
sign-out wait, the SDK keeps the non-secret tombstone and revokes again after
the callback settles, preventing a late cookie response from reopening a
signed-out session.

Cookie OAuth callbacks are scrubbed from browser history before refresh. A
short-lived, non-secret recovery marker lets the callback page retry after a
network or server failure without leaving URL tokens or probing cookies from an
unrelated page. The marker is removed on successful or definitive refresh.

### Refresh Token Rotation

EdgeBase implements **automatic refresh token rotation** with a 30-second grace period:

1. On refresh, the old token is stored as `previousRefreshToken`
2. The new token replaces `refreshToken`
3. The database changes those fields only if the supplied token is still the
   current token; concurrent refreshes therefore converge on one winning token
   instead of creating divergent sessions
4. During the 30-second grace period, both tokens are valid
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

In browser environments, EdgeBase uses **BroadcastChannel** leader election to prevent multiple tabs from simultaneously refreshing tokens. Only one tab performs the refresh, and the new tokens are shared with all tabs via BroadcastChannel.

Fallback: `window.storage` event for browsers without BroadcastChannel support.

## Related

- [Sessions](./sessions) — SDK examples for listing and revoking sessions across all languages
- [Limits](./limits) — Token TTL defaults, rate limits, and session cleanup intervals
- [Email & Password](./email-password) — Token management and auto-refresh behavior
