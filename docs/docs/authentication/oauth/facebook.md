---
sidebar_position: 6
sidebar_label: Facebook
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Facebook

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Sign in with Facebook (Meta) accounts using OAuth 2.0.

## 1. Create OAuth App

1. Go to [Meta for Developers](https://developers.facebook.com/).
2. Click **My Apps** > **Create App**.
3. Choose an app type (e.g., **Consumer** or **Business**).
4. Enter your app name and contact email, then click **Create App**.
5. In the app dashboard, find **Facebook Login** and click **Set Up**.
6. Choose **Web** as the platform.
7. Go to **Facebook Login** > **Settings** in the left sidebar.
8. Add your callback URL to **Valid OAuth Redirect URIs** (see below).

## 2. Set Redirect URI

Add your EdgeBase callback URL to **Valid OAuth Redirect URIs**:

```
https://your-edgebase-url/api/auth/oauth/facebook/callback
```

:::caution HTTPS Required
Facebook requires HTTPS for redirect URIs in production. For local development, `http://localhost` is allowed.
:::

## 3. Get Credentials

1. Go to **Settings** > **Basic** in your app dashboard.
2. Copy:
   - **App ID** — This is your Client ID.
   - **App Secret** — Click **Show** to reveal it.

## 4. Configure EdgeBase

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    allowedOAuthProviders: ['facebook'],
  },
});
```

```typescript
export default defineConfig({
  auth: {
    oauth: {
      facebook: {
        clientId: 'YOUR_APP_ID',
        clientSecret: 'YOUR_APP_SECRET',
      },
    },
  },
});
```

## 5. Usage

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
client.auth.signInWithOAuth('facebook');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithOAuth('facebook');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let url = client.auth.signInWithOAuth(provider: "facebook")
// Open url in SFSafariViewController or ASWebAuthenticationSession
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signInWithOAuth("facebook")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().signInWithOAuth("facebook");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
client.Auth.SignInWithOAuth("facebook");
```

</TabItem>
<TabItem value="cpp" label="C++">

> OAuth requires a browser redirect flow. For C++ (Unreal Engine), handle OAuth in a platform webview and pass the token to the SDK.

</TabItem>
</Tabs>

## Provider Details

| Property | Value |
|----------|-------|
| **Scopes** | `email,public_profile` |
| **PKCE** | No |
| **Email** | Yes |
| **Email verified** | No — Facebook does not provide email verification status |
| **Avatar** | Yes — from `picture.data.url` |
| **Refresh token** | No (returns `expires_in` instead) |

## Notes

- Facebook does not expose whether an email is verified, so EdgeBase sets `emailVerified: false`. This means automatic account linking with existing email/password accounts will **not** occur. Users must manually link accounts if needed.
- Your app must be in **Live** mode (not Development mode) for non-test users to sign in. Go to the app dashboard and toggle the mode at the top.
- In Development mode, only users listed as app admins, developers, or testers can sign in.
