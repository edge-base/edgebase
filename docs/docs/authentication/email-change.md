---
sidebar_position: 5
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Email Change

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Authenticated users can change their email address through a secure two-step verification flow.

## How It Works

1. User requests an email change with their new email and current password
2. Server verifies the password and sends a verification link to the **new** email address
3. User clicks the verification link (or submits the token)
4. Server atomically updates the email across all indexes

## Rate Limits

- **3 requests per user per hour**

## Request from Client SDK

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await client.auth.changeEmail({
  newEmail: 'new@example.com',
  password: 'current-password',
  redirectUrl: `${window.location.origin}/auth/verify-email-change`,
  state: 'settings-profile',
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.changeEmail(
  'new@example.com',
  password: 'current-password',
  redirectUrl: 'myapp://auth/verify-email-change',
);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
try await client.auth.changeEmail(
    newEmail: "new@example.com",
    password: "current-password",
    redirectUrl: "myapp://auth/verify-email-change"
)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.changeEmail(
    newEmail = "new@example.com",
    password = "current-password",
    redirectUrl = "myapp://auth/verify-email-change"
)
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().changeEmail(
    "new@example.com",
    "current-password",
    "myapp://auth/verify-email-change"
);
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await client.Auth.ChangeEmailAsync(
    "new@example.com",
    "current-password",
    "myapp://auth/verify-email-change"
);
```

</TabItem>
</Tabs>

## Complete Verification

On the Web SDK, you can finish the flow directly with the callback token:

```typescript
await client.auth.verifyEmailChange('verification-token');
```

If you pass `redirectUrl`, EdgeBase appends `token`, `type=email-change`, and your optional `state` to that URL.

## REST API

### Request Email Change

```
POST /api/auth/change-email
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json

{
  "newEmail": "new@example.com",
  "password": "current-password",
  "redirectUrl": "https://app.example.com/auth/verify-email-change",
  "state": "settings-profile"
}
```

**Response**: `{ "ok": true, "token": "...", "actionUrl": "..." }`

### Verify Email Change

```
POST /api/auth/verify-email-change
Content-Type: application/json

{ "token": "verification-token" }
```

**Response**: `{ "user": { ... } }` (updated user object)

## Security

- **Password re-confirmation**: The current password must be provided to initiate the change
- **New email verification**: The verification email is sent to the new address (not the old one)
- **Token TTL**: Verification tokens expire after **24 hours** (KV `email-change:{token}`)
- **Single-use**: Tokens are deleted after use
- **Race condition protection**: The new email is re-checked for uniqueness at verification time
- **Disabled accounts**: Returns `403` if the account is disabled
- **Redirect allowlist**: If `auth.allowedRedirectUrls` is configured, request-specific redirects must match that allowlist

## Data Flow

```
1. POST /change-email + { newEmail, password, redirectUrl?, state? }
   → Verify password via D1 (AUTH_DB)
   → Check new email not registered in D1
   → Store token in KV (TTL 24h)
   → Build action URL from request redirect or emailChangeUrl fallback
   → Send verification email to new address

2. POST /verify-email-change + { token }
   → Read & delete token from KV
   → Re-check new email availability in D1
   → Register new email as pending in D1
   → Update email in D1 (AUTH_DB)
   → Confirm new email in D1, delete old email
```
