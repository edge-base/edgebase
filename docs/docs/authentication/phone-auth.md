---
sidebar_position: 6
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Phone / SMS

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Phone number authentication via one-time SMS codes — users verify their identity with a 6-digit OTP sent to their phone.

:::tip Captcha Protection
When [captcha is enabled](/docs/authentication/captcha), the Phone signin endpoint is automatically protected by Cloudflare Turnstile. All client SDKs handle token acquisition transparently — no code changes needed.
:::

## How It Works

1. User enters their phone number (E.164 format, e.g. `+15551234567`)
2. Server sends a 6-digit OTP via SMS
3. User enters the code in your app
4. Your app calls `verifyPhone` with the phone number and code
5. User is signed in with full session tokens

:::info Auto-Create
New phone numbers automatically create a user account. The created account has no password, no email, and is marked as verified. Users can later link an email or OAuth provider.
:::

## Configuration

Enable phone auth in your `edgebase.config.ts`:

```typescript
export default {
  auth: {
    phoneAuth: true,    // default: false
  },
  sms: {
    provider: 'twilio',
    accountSid: 'your-account-sid',
    authToken: 'your-auth-token',
    from: '+15551234567',   // your Twilio phone number
  },
} satisfies EdgeBaseConfig;
```

### Supported SMS Providers

| Provider | Config Fields |
|----------|--------------|
| **Twilio** | `accountSid`, `authToken`, `from` |
| **MessageBird** | `apiKey`, `from` |
| **Vonage** | `apiKey`, `apiSecret`, `from` |

## Send OTP

Request an OTP code sent via SMS:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await client.auth.signInWithPhone({
  phone: '+15551234567',
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithPhone(phone: '+15551234567');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
try await client.auth.signInWithPhone(phone: "+15551234567")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signInWithPhone(phone = "+15551234567")
```

</TabItem>

<TabItem value="java" label="Java">

```java
client.auth().signInWithPhone("+15551234567");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await client.Auth.SignInWithPhoneAsync("+15551234567");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
client.auth().signInWithPhone("+15551234567");
```

</TabItem>
</Tabs>

The server always responds `200 OK` regardless of whether the phone number is already registered. This prevents phone enumeration attacks.

## Verify OTP

After the user receives the SMS, verify the code:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const { user, accessToken, refreshToken } = await client.auth.verifyPhone({
  phone: '+15551234567',
  code: '123456',
});
console.log('Signed in as:', user.phone);
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await client.auth.verifyPhone(
  phone: '+15551234567',
  code: '123456',
);
print('Signed in as: ${result.user.phone}');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let result = try await client.auth.verifyPhone(
    phone: "+15551234567",
    code: "123456"
)
print("Signed in as: \(result.user.phone)")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = client.auth.verifyPhone(
    phone = "+15551234567",
    code = "123456",
)
println("Signed in as: ${result.user.phone}")
```

</TabItem>

<TabItem value="java" label="Java">

```java
Map<String, Object> result = client.auth().verifyPhone("+15551234567", "123456");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Auth.VerifyPhoneAsync("+15551234567", "123456");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.auth().verifyPhone("+15551234567", "123456");
```

</TabItem>
</Tabs>

## Link Phone to Account

Add a phone number to an existing account (email, OAuth, or anonymous):

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// Step 1: Request OTP for linking
await client.auth.linkWithPhone({ phone: '+15551234567' });

// Step 2: Verify the OTP
await client.auth.verifyLinkPhone({
  phone: '+15551234567',
  code: '123456',
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
// Step 1: Request OTP for linking
await client.auth.linkWithPhone(phone: '+15551234567');

// Step 2: Verify the OTP
await client.auth.verifyLinkPhone(phone: '+15551234567', code: '123456');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
// Step 1: Request OTP for linking
try await client.auth.linkWithPhone(phone: "+15551234567")

// Step 2: Verify the OTP
try await client.auth.verifyLinkPhone(phone: "+15551234567", code: "123456")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
// Step 1: Request OTP for linking
client.auth.linkWithPhone(phone = "+15551234567")

// Step 2: Verify the OTP
client.auth.verifyLinkPhone(phone = "+15551234567", code = "123456")
```

</TabItem>

<TabItem value="java" label="Java">

```java
// Step 1: Request OTP for linking
client.auth().linkWithPhone("+15551234567");

// Step 2: Verify the OTP
client.auth().verifyLinkPhone("+15551234567", "123456");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
// Step 1: Request OTP for linking
await client.Auth.LinkWithPhoneAsync("+15551234567");

// Step 2: Verify the OTP
await client.Auth.VerifyLinkPhoneAsync("+15551234567", "123456");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
// Step 1: Request OTP for linking
client.auth().linkWithPhone("+15551234567");

// Step 2: Verify the OTP
client.auth().verifyLinkPhone("+15551234567", "123456");
```

</TabItem>
</Tabs>

## Full Example (React)

```tsx
import { useState } from 'react';
import { client } from './edgebase';

function PhoneLogin() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    await client.auth.signInWithPhone({ phone });
    setStep('code');
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const { user } = await client.auth.verifyPhone({ phone, code });
    console.log('Signed in:', user.phone);
  };

  if (step === 'code') {
    return (
      <form onSubmit={handleVerify}>
        <p>Enter the 6-digit code sent to {phone}</p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
        />
        <button type="submit">Verify</button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSendOTP}>
      <input
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="+15551234567"
      />
      <button type="submit">Send Code</button>
    </form>
  );
}
```

## Phone Number Format

All phone numbers must be in **E.164 format**:

- Starts with `+` followed by country code
- No spaces, dashes, or parentheses
- 7 to 15 digits after the `+`

| Format | Valid |
|--------|-------|
| `+15551234567` | Yes |
| `+447700900000` | Yes |
| `+821012345678` | Yes |
| `(555) 123-4567` | No |
| `555-123-4567` | No |
| `15551234567` | No |

## Security

### OTP Limits
- **6-digit code** — expires after 5 minutes
- **Single-use** — each code can only be used once
- **5 attempts max** — after 5 wrong codes, the OTP is invalidated
- **Rate limit** — max 5 OTPs per phone number per hour

### Phone Enumeration Protection
The `signInWithPhone` endpoint always returns `200 OK`, regardless of whether the phone number exists. This prevents attackers from discovering which numbers are registered.

## Phone + MFA

If a user has [MFA enabled](./mfa), phone sign-in triggers the MFA challenge just like email/password sign-in:

```typescript
const result = await client.auth.verifyPhone({
  phone: '+15551234567',
  code: '123456',
});

if (result.mfaRequired) {
  // User needs to complete MFA
  const session = await client.auth.mfa.verify(
    result.mfaTicket,
    totpCode,
  );
}
```

## REST API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/signin/phone` | No | Send OTP SMS |
| POST | `/api/auth/verify-phone` | No | Verify OTP, create session |
| POST | `/api/auth/link/phone` | Yes | Send OTP for phone linking |
| POST | `/api/auth/verify-link-phone` | Yes | Verify OTP, link phone |
