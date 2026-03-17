---
sidebar_position: 12
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Multi-Factor Authentication (MFA)

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Add an extra layer of security with TOTP-based multi-factor authentication. Users enroll using any authenticator app (Google Authenticator, Authy, 1Password, etc.).

:::info Client vs Admin
`Enroll TOTP`, `Verify Enrollment`, `Login with MFA`, `Recovery Codes`, `Disable MFA`, and `List MFA Factors` are end-user client flows. The admin-only capability on this page is `Admin: Force-Disable MFA`.
:::

## How It Works

1. **Enrollment**: User enrolls TOTP → gets a secret (QR code) + 8 recovery codes
2. **Verification**: User enters a 6-digit code from their authenticator app to confirm enrollment
3. **Login**: After password verification, user must provide a TOTP code to complete sign-in
4. **Recovery**: If the authenticator is lost, a one-time recovery code can be used instead

## Configuration

Enable TOTP MFA in your `edgebase.config.ts`:

```typescript
export default {
  auth: {
    mfa: {
      totp: true,   // Enable TOTP-based MFA
    },
  },
} satisfies EdgeBaseConfig;
```

## Enrollment Flow

### Step 1: Enroll TOTP

The authenticated user starts enrollment. The server returns a secret, QR code URI, and recovery codes.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const { factorId, secret, qrCodeUri, recoveryCodes } = await client.auth.mfa.enrollTotp();

// Display QR code (use a QR library like 'qrcode')
// Save recoveryCodes — shown to user ONLY ONCE
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await client.auth.mfa.enrollTotp();
print(result.qrCodeUri);       // Display as QR code
print(result.recoveryCodes);   // Show once to user
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let result = try await client.auth.mfa.enrollTotp()
// result.qrCodeUri — display as QR code
// result.recoveryCodes — show once to user
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = client.auth.mfa.enrollTotp()
// result.qrCodeUri — display as QR code
// result.recoveryCodes — show once to user
```

</TabItem>
<TabItem value="java" label="Java">

```java
Map<String, Object> result = client.auth().enrollTotp();
System.out.println(result.get("qrCodeUri"));      // Display as QR code
System.out.println(result.get("recoveryCodes"));  // Show once to user
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Auth.EnrollTotpAsync();
Console.WriteLine(result["qrCodeUri"]);      // Display as QR code
Console.WriteLine(result["recoveryCodes"]);  // Show once to user
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.auth().enrollTotp();
auto data = nlohmann::json::parse(result.body);
// data["qrCodeUri"] — display as QR code
// data["recoveryCodes"] — show once to user
```

</TabItem>
</Tabs>

### Step 2: Verify Enrollment

After the user scans the QR code and enters a 6-digit code from their authenticator app:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await client.auth.mfa.verifyTotpEnrollment(factorId, code);
// MFA is now active for this user
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.mfa.verifyTotpEnrollment(factorId, code);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
try await client.auth.mfa.verifyTotpEnrollment(factorId: factorId, code: code)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.mfa.verifyTotpEnrollment(factorId, code)
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().verifyTotpEnrollment(factorId, code);
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await client.Auth.VerifyTotpEnrollmentAsync(factorId, code);
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
client.auth().verifyTotpEnrollment(factorId, code);
```

</TabItem>
</Tabs>

## Login with MFA

When MFA is enabled, `signIn` returns a challenge instead of session tokens:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const result = await client.auth.signIn({ email, password });

if (result.mfaRequired) {
  // MFA challenge — prompt user for TOTP code
  const session = await client.auth.mfa.verifyTotp(result.mfaTicket, totpCode);
  // session.user, session.accessToken, session.refreshToken
} else {
  // Normal login — no MFA
  // result.user, result.accessToken, result.refreshToken
}
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await client.auth.signIn(email: email, password: password);

if (result.mfaRequired) {
  final session = await client.auth.mfa.verifyTotp(result.mfaTicket!, code);
  // session.user, session.accessToken
} else {
  // Normal login
}
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let result = try await client.auth.signIn(email: email, password: password)

if result.mfaRequired {
    let session = try await client.auth.mfa.verifyTotp(
        mfaTicket: result.mfaTicket!,
        code: totpCode
    )
} else {
    // Normal login
}
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = client.auth.signIn(email, password)

if (result.mfaRequired) {
    val session = client.auth.mfa.verifyTotp(result.mfaTicket!!, code)
} else {
    // Normal login
}
```

</TabItem>
<TabItem value="java" label="Java">

```java
Map<String, Object> result = client.auth().signIn(email, password);

if (Boolean.TRUE.equals(result.get("mfaRequired"))) {
    Map<String, Object> session = client.auth().verifyTotp(
        result.get("mfaTicket").toString(),
        totpCode
    );
} else {
    // Normal login
}
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Auth.SignInAsync(email, password);

if (result.TryGetValue("mfaRequired", out var mfa) && mfa is true) {
    var session = await client.Auth.VerifyTotpAsync(
        result["mfaTicket"]!.ToString()!,
        totpCode
    );
} else {
    // Normal login
}
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.auth().signIn(email, password);
auto data = nlohmann::json::parse(result.body);

if (data.value("mfaRequired", false)) {
  auto session = client.auth().verifyTotp(
      data["mfaTicket"].get<std::string>(),
      totpCode
  );
} else {
  // Normal login
}
```

</TabItem>
</Tabs>

## Recovery Codes

If a user loses access to their authenticator app, they can use a one-time recovery code:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const result = await client.auth.signIn({ email, password });

if (result.mfaRequired) {
  // Use recovery code instead of TOTP
  const session = await client.auth.mfa.useRecoveryCode(
    result.mfaTicket,
    recoveryCode,
  );
}
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
if (result.mfaRequired) {
  final session = await client.auth.mfa.useRecoveryCode(
    result.mfaTicket!,
    recoveryCode,
  );
}
```

</TabItem>
<TabItem value="java" label="Java">

```java
Map<String, Object> result = client.auth().signIn(email, password);

if (Boolean.TRUE.equals(result.get("mfaRequired"))) {
    Map<String, Object> session = client.auth().useRecoveryCode(
        result.get("mfaTicket").toString(),
        recoveryCode
    );
}
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Auth.SignInAsync(email, password);

if (result.TryGetValue("mfaRequired", out var mfa) && mfa is true) {
    var session = await client.Auth.UseRecoveryCodeAsync(
        result["mfaTicket"]!.ToString()!,
        recoveryCode
    );
}
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.auth().signIn(email, password);
auto data = nlohmann::json::parse(result.body);

if (data.value("mfaRequired", false)) {
  auto session = client.auth().useRecoveryCode(
      data["mfaTicket"].get<std::string>(),
      recoveryCode
  );
}
```

</TabItem>
</Tabs>

:::warning Recovery codes are single-use
Each recovery code can only be used once. After all 8 codes are used, only the TOTP authenticator app can be used for MFA. Users should re-enroll to get new recovery codes if they're running low.
:::

## Disable MFA

Users can disable MFA by providing their password or a valid TOTP code:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// Disable with password
await client.auth.mfa.disableTotp({ password: 'currentPassword' });

// Or disable with TOTP code
await client.auth.mfa.disableTotp({ code: '123456' });
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.mfa.disableTotp(password: 'currentPassword');
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().disableTotp("currentPassword", null);
// or: client.auth().disableTotp(null, "123456");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await client.Auth.DisableTotpAsync(password: "currentPassword");
// or: await client.Auth.DisableTotpAsync(code: "123456");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
client.auth().disableTotp("currentPassword", "");
// or: client.auth().disableTotp("", "123456");
```

</TabItem>
</Tabs>

## List MFA Factors

Check which MFA methods are enrolled:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const { factors } = await client.auth.mfa.listFactors();
// [{ id: '...', type: 'totp', verified: true, createdAt: '...' }]
```

</TabItem>
<TabItem value="java" label="Java">

```java
List<Map<String, Object>> factors = client.auth().listFactors();
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Auth.ListFactorsAsync();
var factors = result["factors"];
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.auth().listFactors();
auto factors = nlohmann::json::parse(result.body)["factors"];
```

</TabItem>
</Tabs>

## Admin: Force-Disable MFA

Admins can disable MFA for any user (e.g., when a user is locked out):

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await adminClient.auth.disableMfa(userId);
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
admin.auth.disableMfa(userId)
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
EdgeBaseAdmin.disable_mfa(admin, user_id)
```

</TabItem>
<TabItem value="python" label="Python">

```python
admin.auth.disable_mfa(user_id)
```

</TabItem>
</Tabs>

## Full React Example

```tsx
import { useState } from 'react';
import { useEdgeBase } from './edgebase';

function MfaEnrollment() {
  const { client } = useEdgeBase();
  const [step, setStep] = useState<'idle' | 'enrolled' | 'done'>('idle');
  const [enrollData, setEnrollData] = useState<any>(null);
  const [code, setCode] = useState('');

  const handleEnroll = async () => {
    const result = await client.auth.mfa.enrollTotp();
    setEnrollData(result);
    setStep('enrolled');
  };

  const handleVerify = async () => {
    await client.auth.mfa.verifyTotpEnrollment(enrollData.factorId, code);
    setStep('done');
  };

  if (step === 'idle') {
    return <button onClick={handleEnroll}>Enable 2FA</button>;
  }

  if (step === 'enrolled') {
    return (
      <div>
        <h3>Scan this QR code</h3>
        {/* Use a QR code library to render enrollData.qrCodeUri */}
        <p>Or enter manually: <code>{enrollData.secret}</code></p>

        <h3>Save your recovery codes</h3>
        <ul>
          {enrollData.recoveryCodes.map((code: string) => (
            <li key={code}><code>{code}</code></li>
          ))}
        </ul>

        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter 6-digit code"
          maxLength={6}
        />
        <button onClick={handleVerify}>Verify</button>
      </div>
    );
  }

  return <p>2FA enabled successfully!</p>;
}

function MfaLogin() {
  const { client } = useEdgeBase();
  const [mfaTicket, setMfaTicket] = useState('');
  const [code, setCode] = useState('');

  const handleSignIn = async (email: string, password: string) => {
    const result = await client.auth.signIn({ email, password });

    if (result.mfaRequired) {
      setMfaTicket(result.mfaTicket);
      // Show MFA code input
    }
  };

  const handleMfaVerify = async () => {
    await client.auth.mfa.verifyTotp(mfaTicket, code);
    // User is now signed in
  };

  // ... render login form + MFA code input
}
```

## Security Notes

- **TOTP Standard**: RFC 6238, SHA-1 HMAC, 6-digit codes, 30-second step
- **Clock Tolerance**: Codes are accepted within a ±1 step window (90 seconds total)
- **Secret Storage**: TOTP secrets are encrypted at rest with AES-256-GCM
- **Recovery Codes**: SHA-256 hashed before storage, 8 codes per enrollment
- **MFA Ticket**: Expires after 5 minutes (300 seconds), stored in KV
- **Rate Limiting**: Standard auth rate limits apply to all MFA endpoints

## REST API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/auth/mfa/totp/enroll` | Access Token | Start TOTP enrollment |
| `POST` | `/api/auth/mfa/totp/verify` | Access Token | Confirm enrollment with code |
| `POST` | `/api/auth/mfa/verify` | None (mfaTicket) | Complete MFA challenge with TOTP |
| `POST` | `/api/auth/mfa/recovery` | None (mfaTicket) | Complete MFA with recovery code |
| `DELETE` | `/api/auth/mfa/totp` | Access Token | Disable TOTP MFA |
| `GET` | `/api/auth/mfa/factors` | Access Token | List enrolled factors |
| `DELETE` | `/api/auth/admin/users/:id/mfa` | Service Key | Admin: force-disable MFA |

### Error Responses

| Status | Code | When |
|--------|------|------|
| `400` | Invalid TOTP code | Wrong 6-digit code during enrollment verification |
| `400` | mfaTicket/code required | Missing required fields |
| `400` | Invalid or expired MFA ticket | Ticket not found or expired (5 min TTL) |
| `401` | Invalid TOTP code | Wrong code during sign-in MFA challenge |
| `401` | Invalid recovery code | Wrong or already-used recovery code |
| `401` | Invalid password | Wrong password when disabling MFA |
| `404` | TOTP MFA is not enabled | `auth.mfa.totp` not set in config |
| `409` | TOTP factor already enrolled | User already has active TOTP |
