---
sidebar_position: 13
sidebar_label: Spotify
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Spotify

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Sign in with Spotify accounts using OAuth 2.0.

## 1. Create OAuth App

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Log in with your Spotify account.
3. Click **Create app**.
4. Fill in:
   - **App name**: Your app name
   - **App description**: Brief description
   - **Website**: Your app URL
   - **Redirect URI**: Your EdgeBase callback URL (see below)
5. Check the **Web API** checkbox under **Which API/SDKs are you planning to use?**
6. Accept the terms and click **Save**.

For local testing, use these values in the create-app screen:

```text
Website: http://127.0.0.1:4173/
Redirect URI: http://127.0.0.1:8787/api/auth/oauth/spotify/callback
```

:::caution Premium required for new Development Mode apps
As of March 8, 2026, Spotify's official Web API quota documentation says newly created apps start in **Development mode**, and the app owner must have an active **Spotify Premium** account for development mode apps to function. In the current dashboard this can appear as a blue banner prompting you to upgrade to Premium, and the **Web API** checkbox may be unavailable until that requirement is satisfied.
:::

## 2. Set Redirect URI

Set the **Redirect URI** during app creation (or add it later under **Settings** > **Redirect URIs**):

```
https://your-edgebase-url/api/auth/oauth/spotify/callback
```

For local development:

```
http://127.0.0.1:8787/api/auth/oauth/spotify/callback
```

:::caution localhost is not allowed
Spotify's current redirect URI validation rejects `localhost` aliases. For local testing, use an explicit loopback IP literal such as `http://127.0.0.1:8787/...` or `http://[::1]:8787/...`.

If you enter `http://localhost:8787/...` in the create-app screen, Spotify will show the redirect as insecure and refuse it. This is expected behavior under Spotify's current redirect URI rules.
:::

For a local browser harness, it is safest to keep your non-provider URLs consistent too:

```
http://127.0.0.1:4173/
```

## 3. Get Credentials

In your app's **Settings**:

- **Client ID** — Displayed on the app overview page.
- **Client Secret** — Click **View client secret** to reveal it.

## 4. Configure EdgeBase

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    allowedOAuthProviders: ['spotify'],
  },
});
```

```typescript
export default defineConfig({
  auth: {
    oauth: {
      spotify: {
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
client.auth.signInWithOAuth('spotify');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithOAuth('spotify');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let url = client.auth.signInWithOAuth(provider: "spotify")
// Open url in SFSafariViewController or ASWebAuthenticationSession
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signInWithOAuth("spotify")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().signInWithOAuth("spotify");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
client.Auth.SignInWithOAuth("spotify");
```

</TabItem>
<TabItem value="cpp" label="C++">

> OAuth requires a browser redirect flow. For C++ (Unreal Engine), handle OAuth in a platform webview and pass the token to the SDK.

</TabItem>
</Tabs>

## Provider Details

| Property | Value |
|----------|-------|
| **Scopes** | `user-read-email user-read-private` |
| **PKCE** | No |
| **Email** | Yes |
| **Email verified** | No — Spotify does not provide email verification status |
| **Avatar** | Yes — first image from `images` array |
| **Refresh token** | Yes |

## Notes

- Spotify does not provide email verification status, so EdgeBase sets `emailVerified: false`. Automatic account linking with existing email accounts will **not** occur.
- Token exchange uses Basic Auth credentials (client ID and secret encoded in the Authorization header).
- The avatar is taken from the first image in the user's `images` array, which may be a different resolution depending on the user's profile.
- By default, new Spotify apps are in **Development mode**. Spotify's quota documentation says Development mode apps require Spotify Premium on the owner account and are limited to 5 authenticated users on the allowlist.
- In the current dashboard, this often appears as:
  - a blue banner asking you to upgrade to Premium
  - a disabled or unavailable **Web API** checkbox during app creation
  - an insecure redirect warning if you used `localhost` instead of `127.0.0.1`
- If you test locally, make sure the callback registered in Spotify uses `127.0.0.1` (or another explicit loopback IP) and make sure EdgeBase sends the same callback URL during the OAuth flow.
- If you temporarily switch Spotify testing to `127.0.0.1`, make sure your local EdgeBase `baseUrl` also matches `http://127.0.0.1:8787` during that run. The provider callback must match exactly.
