---
sidebar_position: 9
sidebar_label: X (Twitter)
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# X (Twitter)

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Sign in with X (formerly Twitter) accounts using OAuth 2.0 with PKCE.

## 1. Create OAuth App

1. Go to the [X Developer Portal](https://developer.x.com/en/portal/dashboard).
2. Sign up for a developer account if you don't have one (Free tier available).
3. Create a new **Project** and an **App** within it.
4. Go to your app's **Settings** > **User authentication settings** > **Set up**.
5. Configure:
   - **App permissions**: Select **Read** (minimum required)
   - **Type of App**: Choose **Web App, Automated App or Bot**
   - **Callback URI / Redirect URL**: Your EdgeBase callback URL (see below)
   - **Website URL**: Your app's URL

:::tip Existing App Is Fine
If the portal blocks creating another client app, reuse the existing app in your project and enable **User authentication settings** there. You do not need a separate app just for EdgeBase.
:::

## 2. Set Redirect URI

Set the **Callback URI / Redirect URL** to:

```
https://your-edgebase-url/api/auth/oauth/x/callback
```

For local development:

```
http://localhost:8787/api/auth/oauth/x/callback
```

As of March 8, 2026, the X developer portal accepts a localhost callback URI here, but the general app metadata fields such as Website URL, Organization URL, Terms of Service, and Privacy Policy may still require public-looking `https://` URLs in the current UI.

If the portal shows `Not a valid URL format`, keep the callback URI on `http://localhost:8787/...` but use public `https://...` URLs for the other app metadata fields.

## 3. Get Credentials

In your app's **Keys and tokens** tab:

- **Client ID** — Found under **OAuth 2.0 Client ID and Client Secret**.
- **Client Secret** — Generated alongside the Client ID.

These OAuth 2.0 credentials only appear after **User authentication settings** has been enabled for the app.

:::caution OAuth 2.0, Not 1.0a
EdgeBase uses OAuth 2.0 with PKCE. Make sure you copy the **OAuth 2.0** credentials (not the OAuth 1.0a API Key and Secret).
:::

## 4. Configure EdgeBase

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    allowedOAuthProviders: ['x'],
  },
});
```

```typescript
export default defineConfig({
  auth: {
    oauth: {
      x: {
        clientId: 'YOUR_CLIENT_ID',
        clientSecret: 'YOUR_CLIENT_SECRET',
      },
    },
  },
});
```

## 5. Usage

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
client.auth.signInWithOAuth('x');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithOAuth('x');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let url = client.auth.signInWithOAuth(provider: "x")
// Open url in SFSafariViewController or ASWebAuthenticationSession
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signInWithOAuth("x")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().signInWithOAuth("x");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
client.Auth.SignInWithOAuth("x");
```

</TabItem>
<TabItem value="cpp" label="C++">

> OAuth requires a browser redirect flow. For C++ (Unreal Engine), handle OAuth in a platform webview and pass the token to the SDK.

</TabItem>
</Tabs>

## Provider Details

| Property | Value |
|----------|-------|
| **Scopes** | `tweet.read users.read` |
| **PKCE** | Required (S256) — mandatory for X OAuth 2.0 |
| **Email** | No — X does not provide email with these scopes |
| **Email verified** | No |
| **Avatar** | Yes — `profile_image_url` |
| **Refresh token** | Yes |

## Notes

- **X does not provide email addresses** with the current scopes (`tweet.read users.read`). Users signing in with X will not have an email on their EdgeBase account unless they link another provider or set one manually.
- Since no email is available, automatic account linking will not occur. Users must explicitly link accounts if they also have an email-based account.
- PKCE (Proof Key for Code Exchange) is **mandatory** for X OAuth 2.0 — EdgeBase handles this automatically.
- Token exchange uses Basic Auth credentials.
- The Free tier of X developer access is sufficient for Sign In with X.
- When copying credentials, use the **OAuth 2.0 Client ID / Client Secret** pair. Do not use the OAuth 1.0a API key, API secret, access token, or bearer token values.
- Local verification was completed on March 8, 2026 against `http://localhost:8787/api/auth/oauth/x/callback` using the js-web browser harness. The current result was `3 passed / 6 skipped`, which is expected when the signed-in X account does not unlock password/email/TOTP checks.
