---
sidebar_position: 11
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Account Linking

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Link multiple sign-in methods to the same EdgeBase user. This covers both anonymous account upgrades and attaching additional OAuth providers to an already signed-in account. In every case, the `userId` stays the same, so existing app data does not move.

## Supported Flows

### Anonymous upgrade

Start with an anonymous session, then attach a permanent credential:

- Email/password
- OAuth
- Phone OTP

The account keeps the same `userId`, flips `isAnonymous` from `true` to `false`, and gets a fresh JWT.

### Existing account linking

If a user is already signed in, they can attach additional OAuth identities to the same account. This is the usual "Connect Google" or "Connect GitHub" settings-page flow.

Today, explicit signed-in linking is available for OAuth identities. Email/password and phone linking remain anonymous-upgrade flows.

## What Changes After Linking

### Anonymous upgrade

| Property | Before | After |
|----------|--------|-------|
| `userId` | `abc-123` | `abc-123` (unchanged) |
| `isAnonymous` | `true` | `false` |
| JWT | Anonymous claims | Fresh JWT with permanent-account claims |
| Data | All records preserved | All records preserved |
| Auto-cleanup | Subject to `anonymousRetentionDays` | No longer auto-cleaned |

### Existing signed-in account

| Property | Before | After |
|----------|--------|-------|
| `userId` | `abc-123` | `abc-123` (unchanged) |
| Linked OAuth providers | `['google']` | `['google', 'github']` |
| JWT | Existing session | Fresh JWT reflecting the latest account state |
| Data | All records preserved | All records preserved |

## Anonymous Upgrade

### Link Email/Password

**Endpoint:** `POST /api/auth/link/email`

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const result = await client.auth.linkWithEmail({
  email: 'user@example.com',
  password: 'securePassword123',
});
// result.user.isAnonymous === false
// result.user.id is unchanged
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await client.auth.linkWithEmail(
  email: 'user@example.com',
  password: 'securePassword123',
);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let result = try await client.auth.linkWithEmail(
    email: "user@example.com",
    password: "securePassword123"
)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = client.auth.linkWithEmail(
    email = "user@example.com",
    password = "securePassword123"
)
```

</TabItem>
<TabItem value="java" label="Java">

```java
Map<String, Object> result = client.auth().linkWithEmail(
    "user@example.com",
    "securePassword123"
);
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Auth.LinkWithEmailAsync(
    "user@example.com",
    "securePassword123"
);
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.auth().linkWithEmail(
    "user@example.com",
    "securePassword123"
);
```

</TabItem>
</Tabs>

Email/password conversion is one atomic security-boundary transition. EdgeBase
confirms the email identity, removes the anonymous index, revokes every
provisional session, inserts the sole replacement session, and stores a
five-minute encrypted completion checkpoint in the same transaction. The
checkpoint contains only a server-keyed password proof plus encrypted response
data; it does not store the submitted password or a plaintext refresh token.

If the request was sent but the response was lost (including a local token
storage failure), retry `linkWithEmail` promptly with the same normalized email
and exact password. The now-revoked initiating access token is accepted only
for that exact completed upgrade, and the server returns the original session
and token pair rather than creating another one. A different user, email, or
password cannot replay the checkpoint, and another anonymous session belonging
to the same user cannot substitute for the initiating session. Do not start a
different link operation with the stale anonymous session.

### Link OAuth

**Endpoint:** `POST /api/auth/oauth/link/:provider`

<Tabs groupId="sdk-language">
<TabItem value="js" label="Web" default>

```typescript
await client.auth.linkWithOAuth('google', {
  redirectUrl: `${window.location.origin}/auth/callback`,
});
// The browser navigates to a one-time EdgeBase continuation. On the callback
// route, complete the bound flow with:
await client.auth.handleOAuthCallback();
```

</TabItem>
<TabItem value="react-native" label="React Native">

```typescript
await client.auth.linkWithOAuth('google', {
  redirectUrl: 'https://app.example.com/auth/callback',
});
// Linking.openURL() is used when the Linking adapter was configured.
// Complete live and cold-start callbacks with handleOAuthCallback(url) and
// handleInitialOAuthCallback(), respectively.
```

</TabItem>
</Tabs>

Only the Web and React Native SDKs currently implement the complete bound
account-link callback. Other native SDKs may expose URL-construction methods,
but they do not yet bind, validate, rotate, and persist the app callback; do not
use those methods for a production OAuth link flow.

### Link Phone

**Endpoints**

- `POST /api/auth/link/phone`
- `POST /api/auth/verify-link-phone`

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await client.auth.linkWithPhone({ phone: '+1234567890' });

await client.auth.verifyLinkPhone({
  phone: '+1234567890',
  code: '123456',
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.linkWithPhone(phone: '+1234567890');
await client.auth.verifyLinkPhone(
  phone: '+1234567890',
  code: '123456',
);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
try await client.auth.linkWithPhone(phone: "+1234567890")
try await client.auth.verifyLinkPhone(phone: "+1234567890", code: "123456")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.linkWithPhone(phone = "+1234567890")
client.auth.verifyLinkPhone(phone = "+1234567890", code = "123456")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().linkWithPhone("+1234567890");
client.auth().verifyLinkPhone("+1234567890", "123456");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await client.Auth.LinkWithPhoneAsync("+1234567890");
await client.Auth.VerifyLinkPhoneAsync("+1234567890", "123456");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
client.auth().linkWithPhone("+1234567890");
client.auth().verifyLinkPhone("+1234567890", "123456");
```

</TabItem>
</Tabs>

For an anonymous account, verification is a security-boundary transition: the
server revokes every provisional session and returns one new permanent-account
session atomically. Current high-level SDKs persist that replacement token pair
before `verifyLinkPhone` resolves. Any other device still holding the anonymous
session is rejected on its next HTTP or realtime operation.

## Attach Another OAuth Provider To An Existing Account

Use `linkWithOAuth()` while already signed in:

<Tabs groupId="sdk-language">
<TabItem value="js" label="Web" default>

```typescript
await client.auth.linkWithOAuth('github', {
  redirectUrl: `${window.location.origin}/settings/connections/callback`,
  state: 'settings-connections',
});

// In the callback route:
await client.auth.handleOAuthCallback();
```

</TabItem>
<TabItem value="react-native" label="React Native">

```typescript
await client.auth.linkWithOAuth('github', {
  redirectUrl: 'https://app.example.com/settings/connections/callback',
});
```

</TabItem>
</Tabs>

EdgeBase returns a short-lived one-time continuation URL, redirects from that
URL to the provider, then returns to your allowlisted app callback. The provider
callback does not mutate the account and places no bearer credential in the app
URL. It stores a five-minute completion record and returns only
`oauth_link_ticket`, transport, optional `state`, and the SDK binding nonce in
the fragment.

The supported SDK scrubs and consumes that callback, then sends the current
Bearer session to `POST /api/auth/oauth/complete/link`. Completion must match
the exact initiating `userId`, session ID, and anonymous/permanent account mode
captured at link start. A sign-out, account switch, session rotation to a
different session, disabled/deleted account, or changed account mode fails
closed before linking. Only that authenticated completion endpoint mutates the
account and returns the refreshed session (or sets the HttpOnly refresh cookie).
The SDK persists the exact link ticket before completion. An ambiguous network
failure may safely retry that same ticket: EdgeBase returns the cached exact
result and does not attach the identity or create a session twice.

If the OAuth identity already belongs to another user, the request fails with `409 Conflict`.

## Manage Linked Identities

The convenience helpers below are available on the Web and React Native SDKs
for account-settings UIs.

```typescript
const { identities, methods } = await client.auth.listIdentities();

console.log(identities);
// [
//   { id: 'oauthacc_x', kind: 'oauth', provider: 'google', providerUserId: '123' },
//   { id: 'oauthacc_y', kind: 'oauth', provider: 'github', providerUserId: '456' },
// ]

console.log(methods);
// { hasPassword, hasMagicLink, hasEmailOtp, hasPhone, passkeyCount, oauthCount, total }

await client.auth.unlinkIdentity(identities[1].id);
```

**REST endpoints**

- `GET /api/auth/identities`
- `DELETE /api/auth/identities/:identityId`

### Last Sign-In Method Protection

EdgeBase refuses to unlink the final remaining sign-in method for a user. That protection counts:

- Password
- Email-based passwordless sign-in
- Phone OTP
- Passkeys
- Linked OAuth providers

## Auto-Linking vs Explicit Linking

- **Auto-linking** happens during normal OAuth sign-in when the provider supplies a verified email that already belongs to an existing EdgeBase user.
- **Explicit linking** happens when a signed-in user calls `linkWithOAuth(...)` from an account settings screen.

Explicit linking never merges into a different account. If the OAuth identity is already attached elsewhere, the request fails.

:::note Redirects And State
Web `linkWithOAuth()` accepts `redirectUrl` plus an optional `state` string. The
callback appends `state` beside the one-time completion ticket so you can resume
the exact UI flow; `state` is application routing data, not account authority.
:::

## Access Rules After Linking

Before upgrading, anonymous users are still subject to rules that check `auth.isAnonymous`:

```typescript
access: {
  insert(auth) { return auth !== null && !auth.isAnonymous },
  read(auth) { return auth !== null },
}
```

After an anonymous upgrade, `auth.isAnonymous` becomes `false`, so the user can pass rules that require a permanent account.

For existing permanent accounts, linking an additional OAuth identity does not change `auth.isAnonymous`; it only expands the available sign-in methods for the same user.

## Error Handling

| Error | Cause |
|-------|-------|
| `409 Conflict` | The email, phone number, or OAuth identity is already registered to another account |
| `400 Bad Request` | Invalid provider, bad redirect URL, malformed request, or attempt to unlink the last remaining sign-in method |
| `401 Unauthorized` | No valid JWT provided |
