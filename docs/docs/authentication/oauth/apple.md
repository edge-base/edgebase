---
sidebar_position: 3
sidebar_label: Apple
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Apple

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Sign in with Apple using OAuth 2.0 with OpenID Connect.

## 1. Create OAuth App

:::caution Apple Developer Program Required
Sign in with Apple requires an active [Apple Developer Program](https://developer.apple.com/programs/) membership ($99/year).
:::

1. Go to [Apple Developer — Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list).
2. Register an **App ID** if you don't have one:
   - Click **+** > **App IDs** > **App**.
   - Enter a description and Bundle ID.
   - Enable **Sign in with Apple** under Capabilities.
3. Register a **Services ID** (this is your OAuth client):
   - Click **+** > **Services IDs**.
   - Enter a description and identifier (e.g., `com.yourapp.auth`).
   - Enable **Sign in with Apple**.
   - Click **Configure** next to Sign in with Apple:
     - Select your primary App ID.
     - Add your **Domains** (e.g., `your-edgebase-url`).
     - Add your **Return URLs** (see below).
4. Create a **Key** for Sign in with Apple:
   - Go to **Keys** > **+**.
   - Name the key and enable **Sign in with Apple**.
   - Download the `.p8` key file (save it — you can only download it once).
   - Note the **Key ID**.

## 2. Set Redirect URI

Add your EdgeBase callback URL as a **Return URL** in the Services ID configuration:

```
https://your-edgebase-url/api/auth/oauth/apple/callback
```

:::caution HTTPS Required
Apple requires HTTPS for redirect URIs — `localhost` with HTTP is not supported. For local development, use a tunneling service (e.g., ngrok) or test on a staging server.
:::

## 3. Get Credentials

You need:

- **Client ID** — Your Services ID identifier (e.g., `com.yourapp.auth`)
- **Client Secret** — A JWT generated from your `.p8` key, Team ID, and Key ID

:::info Generating the Client Secret
Apple's client secret is a signed JWT, not a static string. You need to generate it using your Team ID, Key ID, and the `.p8` private key. Many tools and libraries can help with this — search for "Apple Sign In client secret generator".
:::

## 4. Configure EdgeBase

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    allowedOAuthProviders: ['apple'],
  },
});
```

```typescript
export default defineConfig({
  auth: {
    oauth: {
      apple: {
        clientId: 'YOUR_SERVICES_ID',
        clientSecret: 'YOUR_GENERATED_JWT',
      },
    },
  },
});
```

## 5. Usage

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
client.auth.signInWithOAuth('apple');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithOAuth('apple');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let url = client.auth.signInWithOAuth(provider: "apple")
// Open url in ASWebAuthenticationSession
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signInWithOAuth("apple")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().signInWithOAuth("apple");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
client.Auth.SignInWithOAuth("apple");
```

</TabItem>
<TabItem value="cpp" label="C++">

> OAuth requires a browser redirect flow. For C++ (Unreal Engine), handle OAuth in a platform webview and pass the token to the SDK.

</TabItem>
</Tabs>

## Provider Details

| Property | Value |
|----------|-------|
| **Scopes** | `name email` |
| **PKCE** | No |
| **Email** | Yes |
| **Email verified** | Always `true` (Apple policy) |
| **Avatar** | No — Apple does not provide profile pictures |
| **Refresh token** | No |

## Notes

- Apple uses `response_mode=form_post` — the callback receives data via POST, not query parameters.
- User info (name, email) is extracted from the `id_token` JWT, not from a separate API call.
- **The user's name is only provided on the first sign-in.** If you miss capturing it, the user must revoke your app in their Apple ID settings and sign in again.
- Apple emails are always considered verified.
- Users can choose to hide their email, in which case Apple provides a private relay address (e.g., `abc@privaterelay.appleid.com`).
