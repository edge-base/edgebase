---
sidebar_position: 13
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Sessions

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Manage user sessions across multiple devices.

## List Sessions

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const { sessions } = await client.auth.listSessions();
// sessions: [{ id, createdAt, expiresAt, ip, userAgent, lastActiveAt }, ...]
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final sessions = await client.auth.listSessions();
// sessions[0].id, sessions[0].ip, sessions[0].createdAt
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let sessions = try await client.auth.listSessions()
// sessions[0].id, sessions[0].ip, sessions[0].createdAt
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val sessions = client.auth.listSessions()
// sessions[0].id, sessions[0].ip, sessions[0].createdAt
```

</TabItem>
<TabItem value="java" label="Java">

```java
List<Session> sessions = client.auth().listSessions();
// sessions.get(0).getId(), sessions.get(0).getIp()
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var sessions = await client.Auth.ListSessionsAsync();
// sessions[0].Id, sessions[0].Ip, sessions[0].CreatedAt
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto sessions = client.auth().listSessions();
// sessions[0].id, sessions[0].ip, sessions[0].createdAt
```

</TabItem>
</Tabs>

## Revoke a Session

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await client.auth.revokeSession('session-id');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.revokeSession('session-id');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
try await client.auth.revokeSession("session-id")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.revokeSession("session-id")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().revokeSession("session-id");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await client.Auth.RevokeSessionAsync("session-id");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
client.auth().revokeSession("session-id");
```

</TabItem>
</Tabs>

## Multi-Device Support

EdgeBase supports multiple simultaneous sessions per user. Each sign-in creates a new session with:

- **IP address** — Client IP at sign-in time
- **User-Agent** — Browser/device info
- **Last activity** — Updated on token refresh

## Refresh Token Rotation

Each token refresh issues a new refresh token and invalidates the old one:

```
Client → POST /auth/refresh (old refreshToken)
Server → { accessToken: "new...", refreshToken: "new..." }
         (old refreshToken invalidated)
```

A 30-second grace period allows in-flight requests using the previous refresh token to succeed.

### Grace Period Details

When a refresh token is rotated, the **previous token remains valid for 30 seconds**. This prevents race conditions when multiple browser tabs or concurrent requests attempt to refresh the token simultaneously.

- During the 30-second window, both the old and new refresh tokens are accepted
- After the 30-second window expires, using the old token triggers **token theft detection** -- the session is revoked
- This protects against stolen refresh tokens while being tolerant of normal concurrent usage patterns

## Session Limits (maxActiveSessions)

Control the maximum number of concurrent sessions per user. When the limit is reached, the **oldest session is evicted** (FIFO) to make room for the new sign-in.

```typescript
auth: {
  session: {
    maxActiveSessions: 5  // 0 = unlimited (default)
  }
}
```

| Config Value | Behavior |
|-------------|----------|
| `0` (default) | Unlimited sessions |
| `1` | Single session only -- new sign-in evicts the previous session |
| `5` | Up to 5 concurrent sessions; oldest evicted when limit is reached |

The oldest session (by `createdAt`) is deleted to make room for the new session. See [Session Management](/docs/authentication/session-management) for detailed eviction logic and examples.

## Token Lifetimes

| Token | Default TTL | Storage |
|---|---|---|
| **Access Token** | 15 minutes | Memory only |
| **Refresh Token** | 28 days | `localStorage` / secure storage |

Configure in `edgebase.config.ts`:

```typescript
auth: {
  session: {
    accessTokenTTL: '15m',
    refreshTokenTTL: '28d',
  }
}
```

## JWT Key Rotation

Use `npx edgebase keys rotate-jwt` to rotate `JWT_USER_SECRET` and `JWT_ADMIN_SECRET` simultaneously without logging users out:

```bash
npx edgebase keys rotate-jwt
npx edgebase deploy  # Required: activate new secrets
```

- Old secrets are preserved as `JWT_USER_SECRET_OLD` / `JWT_ADMIN_SECRET_OLD`
- **28-day grace period** — matches Refresh Token TTL, so no active user loses their session during rotation
- Access Tokens (15m TTL) expire naturally — no grace period needed
- After 28 days the old secrets are automatically ignored

:::note
The grace period only covers **signature mismatch** errors. Expired tokens are rejected regardless.
:::

## Next Steps

- [Session Management](/docs/authentication/session-management) — Configure session limits (`maxActiveSessions`), eviction logic, and cleanup behavior
- [Password Policy](/docs/authentication/password-policy) — Configure password strength requirements and leaked password detection
