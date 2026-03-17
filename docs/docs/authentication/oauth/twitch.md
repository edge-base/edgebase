---
sidebar_position: 14
sidebar_label: Twitch
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Twitch

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Sign in with Twitch accounts using OAuth 2.0.

## 1. Create OAuth App

1. Go to the [Twitch Developer Console](https://dev.twitch.tv/console/apps).
2. Log in with your Twitch account.
3. Click **Register Your Application**.
4. Fill in:
   - **Name**: Your app name
   - **OAuth Redirect URLs**: Your EdgeBase callback URL (see below)
   - **Category**: Choose the most appropriate category
   - **Client Type**: Choose **Confidential**
5. Click **Create**.

## 2. Set Redirect URI

Set the **OAuth Redirect URL** during registration:

```
https://your-edgebase-url/api/auth/oauth/twitch/callback
```

For local development:

```
http://localhost:8787/api/auth/oauth/twitch/callback
```

## 3. Get Credentials

After registration, click **Manage** on your app:

- **Client ID** — Displayed on the app management page.
- **Client Secret** — Click **New Secret** to generate one (copy it immediately).

## 4. Configure EdgeBase

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    allowedOAuthProviders: ['twitch'],
  },
});
```

```typescript
export default defineConfig({
  auth: {
    oauth: {
      twitch: {
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
client.auth.signInWithOAuth('twitch');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithOAuth('twitch');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let url = client.auth.signInWithOAuth(provider: "twitch")
// Open url in SFSafariViewController or ASWebAuthenticationSession
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signInWithOAuth("twitch")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().signInWithOAuth("twitch");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
client.Auth.SignInWithOAuth("twitch");
```

</TabItem>
<TabItem value="cpp" label="C++">

> OAuth requires a browser redirect flow. For C++ (Unreal Engine), handle OAuth in a platform webview and pass the token to the SDK.

</TabItem>
</Tabs>

## Provider Details

| Property | Value |
|----------|-------|
| **Scopes** | `user:read:email` |
| **PKCE** | No |
| **Email** | Yes |
| **Email verified** | Yes — uses `email_verified` field |
| **Avatar** | Yes — `profile_image_url` |
| **Refresh token** | Yes |

## Notes

- Twitch may require **Two-Factor Authentication (2FA)** on the Twitch account before app registration or sensitive app actions are allowed in the current console.
- Twitch's user info API requires a `Client-Id` header in addition to the Bearer token — EdgeBase handles this automatically.
- The Twitch API returns users in an array format (`data[0]`), and EdgeBase extracts the first user.
- Display name uses `display_name` if available, falling back to `login` (username).
- Twitch provides verified emails, so automatic account linking with existing email accounts will work.
- Local verification was completed on March 8, 2026 against `http://localhost:8787/api/auth/oauth/twitch/callback` using the js-web browser harness. The current result was `3 passed / 6 skipped`, which is expected when the signed-in Twitch account does not unlock the password/email/TOTP checks in the harness.
