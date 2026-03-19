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

### Refresh Token Rotation

EdgeBase implements **automatic refresh token rotation** with a 30-second grace period:

1. On refresh, the old token is stored as `previousRefreshToken`
2. The new token replaces `refreshToken`
3. During the 30-second grace period, both tokens are valid
4. After 30 seconds, using the old token triggers **the session is revoked** (token theft detection)

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
