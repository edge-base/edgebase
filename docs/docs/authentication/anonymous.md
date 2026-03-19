---
sidebar_position: 7
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Anonymous Auth

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Let users explore your app without registration. Anonymous accounts can be converted to permanent accounts later.

:::tip Captcha Protection
When [captcha is enabled](/docs/authentication/captcha), anonymous sign-in is automatically protected by Cloudflare Turnstile. All client SDKs handle token acquisition transparently — no code changes needed.
:::

## Enable

```typescript
// edgebase.config.ts
auth: {
  anonymousAuth: true,
}
```

## Sign In Anonymously

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const { user } = await client.auth.signInAnonymously();
// user.isAnonymous → true
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await client.auth.signInAnonymously();
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let result = try await client.auth.signInAnonymously()
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = client.auth.signInAnonymously()
```

</TabItem>

<TabItem value="java" label="Java">

```java
Map<String, Object> result = client.auth().signInAnonymously();
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Auth.SignInAnonymouslyAsync();
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.auth().signInAnonymously();
```

</TabItem>
</Tabs>

## Convert to Email Account

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await client.auth.linkWithEmail({
  email: 'user@example.com',
  password: 'securePassword',
});
// user.isAnonymous → false  (data preserved)
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.linkWithEmail(email: 'user@example.com', password: 'securePassword');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
try await client.auth.linkWithEmail(email: "user@example.com", password: "securePassword")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.linkWithEmail(email = "user@example.com", password = "securePassword")
```

</TabItem>

<TabItem value="java" label="Java">

```java
client.auth().linkWithEmail("user@example.com", "securePassword");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await client.Auth.LinkWithEmailAsync("user@example.com", "securePassword");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
client.auth().linkWithEmail("user@example.com", "securePassword");
```

</TabItem>
</Tabs>

## Convert to OAuth Account

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await client.auth.linkWithOAuth('google');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final url = await client.auth.linkWithOAuth('google');
await launchUrl(Uri.parse(url));
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let url = try await client.auth.linkWithOAuth(provider: "google")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val url = client.auth.linkWithOAuth("google")
```

</TabItem>
<TabItem value="java" label="Java">

```java
String url = client.auth().linkWithOAuth("google");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var url = client.Auth.LinkWithOAuth("google");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto url = client.auth().linkWithOAuth("google");
```

</TabItem>
</Tabs>

## Access Rules

Use `auth.isAnonymous` in access rules to differentiate anonymous users:

```typescript
access: {
  insert(auth) { return auth !== null && !auth.isAnonymous },  // Only registered users
  read(auth) { return auth !== null },  // Any authenticated user (including anonymous)
}
```

## Auto-Cleanup

Stale anonymous accounts are automatically deleted after `auth.anonymousRetentionDays` (default: 30 days).
