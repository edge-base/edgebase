---
sidebar_position: 4
sidebar_label: Discord
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Discord

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Sign in with Discord accounts using OAuth 2.0.

## 1. Create OAuth App

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** and give it a name.
3. Go to the **OAuth2** section in the left sidebar.
4. Under **Redirects**, add your EdgeBase callback URL (see below).

:::tip OAuth2 only
For EdgeBase sign-in, use the **OAuth2** section. You do not need bot settings, interaction endpoints, webhooks, or slash-command setup for basic Discord login.
:::

## 2. Set Redirect URI

Add your EdgeBase callback URL under **OAuth2** > **Redirects**:

```
https://your-edgebase-url/api/auth/oauth/discord/callback
```

For local development:

```
http://localhost:8787/api/auth/oauth/discord/callback
```

## 3. Get Credentials

In the **OAuth2** section:

- **Client ID** — Displayed at the top of the OAuth2 page.
- **Client Secret** — Click **Reset Secret** to generate one (copy it immediately).

## 4. Configure EdgeBase

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    allowedOAuthProviders: ['discord'],
  },
});
```

```typescript
export default defineConfig({
  auth: {
    oauth: {
      discord: {
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
client.auth.signInWithOAuth('discord');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithOAuth('discord');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let url = client.auth.signInWithOAuth(provider: "discord")
// Open url in SFSafariViewController or ASWebAuthenticationSession
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signInWithOAuth("discord")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().signInWithOAuth("discord");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
client.Auth.SignInWithOAuth("discord");
```

</TabItem>
<TabItem value="cpp" label="C++">

> OAuth requires a browser redirect flow. For C++ (Unreal Engine), handle OAuth in a platform webview and pass the token to the SDK.

</TabItem>
</Tabs>

## Provider Details

| Property | Value |
|----------|-------|
| **Scopes** | `identify email` |
| **PKCE** | No |
| **Email** | Yes |
| **Email verified** | Yes — uses `verified` field |
| **Avatar** | Yes — constructed from avatar hash |
| **Refresh token** | No |

## Notes

- Discord avatar URLs are constructed from the user's ID and avatar hash: `https://cdn.discordapp.com/avatars/{user_id}/{avatar_hash}.png`.
- Users without a verified email on Discord will have `emailVerified: false`, which means automatic account linking with existing email accounts won't occur.
- Local verification was completed on March 8, 2026 against `http://localhost:8787/api/auth/oauth/discord/callback` using the js-web browser harness. The current result was `8 passed / 1 skipped`.
