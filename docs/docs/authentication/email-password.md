---
sidebar_position: 1
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Email & Password

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Built-in email/password authentication with no MAU charges.

:::tip Captcha Protection
When [captcha is enabled](/docs/authentication/captcha), the **Sign Up**, **Sign In**, and **Password Reset** endpoints are automatically protected by Cloudflare Turnstile. All client SDKs handle token acquisition transparently — no code changes needed.
:::

## Sign Up

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const { user, accessToken, refreshToken } = await client.auth.signUp({
  email: 'user@example.com',
  password: 'securePassword123',
  data: {
    displayName: 'Jane Doe',
    avatarUrl: 'https://example.com/avatar.jpg',
  },
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await client.auth.signUp(
  email: 'user@example.com',
  password: 'securePassword123',
  data: {'displayName': 'Jane Doe'},
);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let result = try await client.auth.signUp(
    email: "user@example.com",
    password: "securePassword123",
    data: ["displayName": "Jane Doe"]
)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = client.auth.signUp(
    email = "user@example.com",
    password = "securePassword123",
    data = mapOf("displayName" to "Jane Doe")
)
```

</TabItem>

<TabItem value="java" label="Java">

```java
Map<String, Object> result = client.auth().signUp("user@example.com", "securePassword123",
    Map.of("displayName", "Jane Doe"));
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Auth.SignUpAsync("user@example.com", "securePassword123",
    new() { ["displayName"] = "Jane Doe" });
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.auth().signUp("user@example.com", "securePassword123", "Jane Doe");
```

</TabItem>
</Tabs>

## Sign In

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const { user, accessToken, refreshToken } = await client.auth.signIn({
  email: 'user@example.com',
  password: 'securePassword123',
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await client.auth.signIn(
  email: 'user@example.com',
  password: 'securePassword123',
);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let result = try await client.auth.signIn(
    email: "user@example.com",
    password: "securePassword123"
)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = client.auth.signIn(
    email = "user@example.com",
    password = "securePassword123"
)
```

</TabItem>

<TabItem value="java" label="Java">

```java
Map<String, Object> result = client.auth().signIn("user@example.com", "securePassword123");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Auth.SignInAsync("user@example.com", "securePassword123");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.auth().signIn("user@example.com", "securePassword123");
```

</TabItem>
</Tabs>

## Sign Out

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await client.auth.signOut();
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signOut();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
try await client.auth.signOut()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signOut()
```

</TabItem>

<TabItem value="java" label="Java">

```java
client.auth().signOut();
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await client.Auth.SignOutAsync();
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.auth().signOut();
```

</TabItem>
</Tabs>

## Auth State Listener

React to authentication state changes:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
client.auth.onAuthStateChange((event, user) => {
  if (event === 'SIGNED_IN') {
    console.log('User signed in:', user.email);
  } else if (event === 'SIGNED_OUT') {
    console.log('User signed out');
  } else if (event === 'TOKEN_REFRESHED') {
    console.log('Token refreshed');
  }
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
client.auth.onAuthStateChange.listen((user) {
  if (user != null) {
    print('User signed in: ${user.email}');
  }
});
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
client.auth.onAuthStateChange { event, user in
    if event == .signedIn {
        print("User signed in: \(user?.email ?? "")")
    }
}
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.onAuthStateChange { event, user ->
    if (event == AuthEvent.SIGNED_IN) {
        println("User signed in: ${user?.email}")
    }
}
```

</TabItem>

<TabItem value="java" label="Java">

```java
client.auth().onAuthStateChange((event, user) -> {
    if ("SIGNED_IN".equals(event)) {
        System.out.println("User signed in: " + user.get("email"));
    }
});
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
client.Auth.OnAuthStateChange((authEvent, user) => {
    if (authEvent == "SIGNED_IN")
        Console.WriteLine($"User signed in: {user?.Email}");
});
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
client.auth().onAuthStateChange([](const std::string& event, const eb::User& user) {
    if (event == "SIGNED_IN")
        std::cout << "Signed in: " << user.email << std::endl;
});
```

</TabItem>
</Tabs>

## Current User

```typescript
const user = client.auth.currentUser;
// { id, email, displayName, avatarUrl, role, isAnonymous, ... }
```

## Update Profile

```typescript
await client.auth.updateProfile({
  displayName: 'New Name',
  avatarUrl: 'https://example.com/new-avatar.jpg',
  emailVisibility: 'public',  // 'public' | 'private'
});
```

## Change Password

Change the password for the currently signed-in user. Requires the current password for verification. All existing sessions are revoked and new tokens are issued.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const { user, accessToken, refreshToken } = await client.auth.changePassword({
  currentPassword: 'oldPassword123',
  newPassword: 'newSecurePassword456',
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await client.auth.changePassword(
  currentPassword: 'oldPassword123',
  newPassword: 'newSecurePassword456',
);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let result = try await client.auth.changePassword(
    currentPassword: "oldPassword123",
    newPassword: "newSecurePassword456"
)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = client.auth.changePassword(
    currentPassword = "oldPassword123",
    newPassword = "newSecurePassword456"
)
```

</TabItem>

<TabItem value="java" label="Java">

```java
Map<String, Object> result = client.auth().changePassword("oldPassword123", "newSecurePassword456");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Auth.ChangePasswordAsync("oldPassword123", "newSecurePassword456");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.auth().changePassword("oldPassword123", "newSecurePassword456");
```

</TabItem>
</Tabs>

:::info Session Revocation
After a successful password change, **all existing sessions are revoked** (other devices are signed out). The SDK automatically updates its stored tokens with the new ones returned in the response.
:::

**Requirements:**
- New password must meet [password policy](/docs/authentication/password-policy) requirements (default: at least **8 characters**)
- Current password must be correct
- User must be signed in with email/password (OAuth-only and anonymous accounts cannot use this method)

**Error Responses:**

| Status | Condition |
|--------|-----------|
| 400 | Missing `currentPassword` or `newPassword`, or new password shorter than 8 characters |
| 401 | Not authenticated, or current password is incorrect |
| 403 | Account is OAuth-only or anonymous (no password set) |

## Email Verification

After sign-up, a verification email is sent. The token expires in **24 hours**.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await client.auth.verifyEmail(token);
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.verifyEmail(token);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
try await client.auth.verifyEmail(token)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.verifyEmail(token)
```

</TabItem>

<TabItem value="java" label="Java">

```java
client.auth().verifyEmail(token);
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await client.Auth.VerifyEmailAsync(token);
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
client.auth().verifyEmail(token);
```

</TabItem>
</Tabs>

## Password Reset

### Request Reset Email

Send a password reset email. The token expires in **1 hour**.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await client.auth.requestPasswordReset('user@example.com', {
  redirectUrl: `${window.location.origin}/auth/reset-password`,
  state: 'billing',
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.requestPasswordReset('user@example.com');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
try await client.auth.requestPasswordReset("user@example.com")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.requestPasswordReset("user@example.com")
```

</TabItem>

<TabItem value="java" label="Java">

```java
client.auth().requestPasswordReset("user@example.com");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await client.Auth.RequestPasswordResetAsync("user@example.com");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
client.auth().requestPasswordReset("user@example.com");
```

</TabItem>
</Tabs>

On the Web SDK, `requestPasswordReset()` also accepts `redirectUrl` plus optional `state`. The clicked email link includes:

- `token`
- `type=password-reset`
- `state` if provided

If you do not pass a request-specific redirect, EdgeBase falls back to `email.resetUrl`.

If your project sets `auth.allowedRedirectUrls`, the redirect must match that allowlist.

### Reset Password with Token

```typescript
await client.auth.resetPassword(token, 'newSecurePassword456');
```

## Token Management

EdgeBase SDKs handle token refresh automatically:

- **Access Token** — Short-lived (15 min default), sent with every request
- **Refresh Token** — Long-lived (28 days default), used to get new access tokens
- **Auto-refresh** — SDK automatically refreshes expired access tokens
- **Tab sync** — Browser SDK uses BroadcastChannel to prevent multiple tabs from refreshing simultaneously
