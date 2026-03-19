---
sidebar_position: 3
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Email OTP (Passwordless)

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Email OTP provides passwordless authentication using one-time codes sent via email. Users sign in by entering a 6-digit code instead of a password.

## Configuration

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    emailOtp: {
      enabled: true,
      autoCreate: true, // Auto-create user on first OTP request (default: true)
    },
  },
});
```

## How It Works

1. User requests OTP with their email address
2. Server generates a 6-digit code and sends it via the configured email provider
3. Code is stored in KV with a 5-minute TTL
4. User submits the code for verification
5. On success, a session is created (same as email/password sign-in)

### New Users

When `autoCreate` is `true` (default), requesting an OTP for an unregistered email automatically creates a new user account. The account is created with `verified: true` and no password.

### Rate Limits

- **OTP requests**: 5 per email per hour
- **Verification attempts**: 5 per code (after 5 failed attempts, the code is invalidated)

## Request OTP

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await client.auth.signInWithEmailOtp({ email: 'user@example.com' });
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithEmailOtp('user@example.com');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
try await client.auth.signInWithEmailOtp(email: "user@example.com")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signInWithEmailOtp("user@example.com")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().signInWithEmailOtp("user@example.com");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await client.Auth.SignInWithEmailOtpAsync("user@example.com");
```

</TabItem>
</Tabs>

## Verify OTP

The Web SDK and Unity SDK expose a direct verification helper today:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const { user, accessToken } = await client.auth.verifyEmailOtp({
  email: 'user@example.com',
  code: '123456',
});
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Auth.VerifyEmailOtpAsync(
    "user@example.com",
    "123456"
);
```

</TabItem>
</Tabs>

## REST API

### Request OTP

```
POST /api/auth/signin/email-otp
Content-Type: application/json

{ "email": "user@example.com" }
```

**Response**: `{ "ok": true }`

### Verify OTP

```
POST /api/auth/verify-email-otp
Content-Type: application/json

{ "email": "user@example.com", "code": "123456" }
```

**Response**: `{ "user": {...}, "accessToken": "...", "refreshToken": "..." }`

## MFA Support

If the user has TOTP-based MFA enabled, verifying the OTP code returns an MFA challenge instead of a session:

```json
{ "mfaRequired": true, "mfaTicket": "...", "factors": [...] }
```

Complete the MFA flow as documented in the [MFA guide](/docs/authentication/mfa).

## Dev Mode

When no email provider is configured, the OTP code is logged to the server console and included in the response for development convenience:

```json
{ "ok": true, "code": "123456" }
```

## Disabled Accounts

If the user's account has been [disabled](/docs/authentication/ban-disable), the verification step returns `403 Forbidden`.
