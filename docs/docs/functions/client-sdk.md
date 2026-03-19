---
sidebar_position: 5
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Client SDK

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Call App Functions from the client SDK with auth headers injected automatically.

`client.functions` is a **hand-written helper surface**. It is consistent across SDKs, but unlike the generated REST core, it is not produced directly from OpenAPI.

## Supported Client SDKs

- JavaScript (`@edge-base/web`)
- React Native (`@edge-base/react-native`)
- Dart / Flutter
- Swift
- Kotlin
- Java
- C#
- C++

## Setup

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
import { createClient } from '@edge-base/web';

const client = createClient('https://my-app.edgebase.fun');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
import 'package:edgebase_flutter/edgebase_flutter.dart';

final client = ClientEdgeBase('https://my-app.edgebase.fun');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
import EdgeBase

let client = EdgeBaseClient("https://my-app.edgebase.fun")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
import dev.edgebase.sdk.client.ClientEdgeBase

val client = ClientEdgeBase("https://my-app.edgebase.fun")
```

</TabItem>
<TabItem value="java" label="Java">

```java
import dev.edgebase.sdk.client.ClientEdgeBase;
import dev.edgebase.sdk.client.EdgeBase;

ClientEdgeBase client = EdgeBase.client("https://my-app.edgebase.fun");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
using EdgeBase;

var client = new EdgeBase("https://my-app.edgebase.fun");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
#include <edgebase/edgebase.h>

client::EdgeBase client("https://my-app.edgebase.fun");
```

</TabItem>
</Tabs>

## Basic Calls

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const result = await client.functions.post('send-email', {
  to: 'user@example.com',
  subject: 'Welcome!',
});

const users = await client.functions.get('users');
await client.functions.delete('users/abc123');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await client.functions.post('send-email', {
  'to': 'user@example.com',
  'subject': 'Welcome!',
});

final users = await client.functions.get('users');
await client.functions.delete('users/abc123');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let result = try await client.functions.post("send-email", body: [
    "to": "user@example.com",
    "subject": "Welcome!",
])

let users = try await client.functions.get("users")
try await client.functions.delete("users/abc123")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = client.functions.post("send-email", mapOf(
    "to" to "user@example.com",
    "subject" to "Welcome!"
))

val users = client.functions.get("users")
client.functions.delete("users/abc123")
```

</TabItem>
<TabItem value="java" label="Java">

```java
var result = client.functions().post("send-email", Map.of(
    "to", "user@example.com",
    "subject", "Welcome!"
));

var users = client.functions().get("users");
client.functions().delete("users/abc123");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Functions.PostAsync("send-email", new {
    to = "user@example.com",
    subject = "Welcome!"
});

var users = await client.Functions.GetAsync("users");
await client.Functions.DeleteAsync("users/abc123");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.functions().post(
    "send-email",
    R"({"to":"user@example.com","subject":"Welcome!"})"
);

auto users = client.functions().get("users");
client.functions().del("users/abc123");
```

</TabItem>
</Tabs>

## Generic Call

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const result = await client.functions.call('my-function', {
  method: 'PUT',
  body: { name: 'Updated' },
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
final result = await client.functions.call(
  'my-function',
  options: const FunctionCallOptions(
    method: 'PUT',
    body: {'name': 'Updated'},
  ),
);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let result = try await client.functions.call(
    "my-function",
    options: FunctionCallOptions(
        method: "PUT",
        body: ["name": "Updated"]
    )
)
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
val result = client.functions.call(
    "my-function",
    FunctionCallOptions(
        method = "PUT",
        body = mapOf("name" to "Updated")
    )
)
```

</TabItem>
<TabItem value="java" label="Java">

```java
var result = client.functions().call(
    "my-function",
    new FunctionsClient.FunctionCallOptions(
        "PUT",
        Map.of("name", "Updated"),
        null
    )
);
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
var result = await client.Functions.CallAsync("my-function", new FunctionCallOptions {
    Method = "PUT",
    Body = new { name = "Updated" }
});
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
auto result = client.functions().call(
    "my-function",
    "PUT",
    R"({"name":"Updated"})"
);
```

</TabItem>
</Tabs>

## Authentication

If the user is signed in, the SDK sends the auth token automatically.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await client.auth.signIn({ email: 'user@test.com', password: 'pass123' });
const profile = await client.functions.get('me/profile');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signIn(
  email: 'user@test.com',
  password: 'pass123',
);
final profile = await client.functions.get('me/profile');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
try await client.auth.signIn(
    email: "user@test.com",
    password: "pass123"
)
let profile = try await client.functions.get("me/profile")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signIn(
    email = "user@test.com",
    password = "pass123"
)
val profile = client.functions.get("me/profile")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().signIn("user@test.com", "pass123");
Object profile = client.functions().get("me/profile");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await client.Auth.SignInAsync("user@test.com", "pass123");
var profile = await client.Functions.GetAsync("me/profile");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
client.auth().signIn("user@test.com", "pass123");
auto profile = client.functions().get("me/profile");
```

</TabItem>
</Tabs>

Server function:

```typescript
export const GET = defineFunction(async ({ auth, admin }) => {
  if (!auth) throw new FunctionError('unauthenticated', 'Login required');
  return admin.db('app').table('profiles').getOne(auth.id);
});
```

## Error Handling

App Function failures are surfaced through the SDK as `EdgeBaseError`.

```typescript
import { EdgeBaseError } from '@edge-base/web';

try {
  await client.functions.post('orders', { items: [] });
} catch (err) {
  if (err instanceof EdgeBaseError) {
    if (err.status === 0) {
      // The SDK did not receive a usable HTTP response.
      retryLater();
      return;
    }

    if (err.status === 401) {
      redirectToLogin();
      return;
    }

    showError(err.message);
  }
}
```

Practical rules:

- `err.status` and `err.code` are aliases for the HTTP status code.
- `status === 0` means a transport-level failure rather than a semantic App Function error response.
- Server-side `FunctionError('permission-denied', ...)` becomes an SDK error with HTTP status `403`, `unauthenticated` becomes `401`, and so on.
- For business-rule failures, branch on HTTP status. For retries, treat `status === 0` and `503` as transient first.

## Notes

- React Native uses the same `functions` API shape as the web SDK.
- C++ uses JSON strings for request bodies instead of language-level map serialization helpers.
- Function routes are always resolved under `/api/functions/*`.
