---
sidebar_position: 12
sidebar_label: Slack
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Slack

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Sign in with Slack accounts using OpenID Connect.

## 1. Create OAuth App

1. Go to [Slack API — Your Apps](https://api.slack.com/apps).
2. Click **Create New App** > **From scratch**.
3. Enter your app name and select a workspace, then click **Create App**.
4. Go to **OAuth & Permissions** in the left sidebar.
5. Under **Redirect URLs**, add your EdgeBase callback URL (see below), click **Add**, then click **Save URLs**.
6. Under **Scopes** > **User Token Scopes**, add:
   - `openid`
   - `email`
   - `profile`
7. Click **Install to Workspace** (or reinstall if you changed redirect URLs or scopes).

## 2. Set Redirect URI

Add your EdgeBase callback URL under **OAuth & Permissions** > **Redirect URLs**:

```
https://your-edgebase-url/api/auth/oauth/slack/callback
```

For local development:

Use an HTTPS tunnel that forwards to your local EdgeBase auth server, for example:

```text
https://your-tunnel.example/api/auth/oauth/slack/callback
```

As of March 8, 2026, Slack's app console requires redirect URLs to begin with `https://`, so plain `http://localhost:8787/...` is rejected in the UI. A local tunnel such as `cloudflared` or `ngrok` is the practical approach for browser-based local testing.

## 3. Get Credentials

In **Basic Information**:

- **Client ID** — Listed as your app's Client ID.
- **Client Secret** — Listed as your app's Client Secret.

:::caution Do Not Use the User OAuth Token
Slack also shows a **User OAuth Token** on the **OAuth & Permissions** page after installation. That token is not the `clientSecret` for EdgeBase. Use the **Client ID** and **Client Secret** from **Basic Information**.
:::

## 4. Configure EdgeBase

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    allowedOAuthProviders: ['slack'],
  },
});
```

```typescript
export default defineConfig({
  auth: {
    oauth: {
      slack: {
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
client.auth.signInWithOAuth('slack');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithOAuth('slack');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let url = client.auth.signInWithOAuth(provider: "slack")
// Open url in SFSafariViewController or ASWebAuthenticationSession
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signInWithOAuth("slack")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().signInWithOAuth("slack");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
client.Auth.SignInWithOAuth("slack");
```

</TabItem>
<TabItem value="cpp" label="C++">

> OAuth requires a browser redirect flow. For C++ (Unreal Engine), handle OAuth in a platform webview and pass the token to the SDK.

</TabItem>
</Tabs>

## Provider Details

| Property | Value |
|----------|-------|
| **Scopes** | `openid email profile` |
| **PKCE** | No |
| **Email** | Yes |
| **Email verified** | Always `true` (Slack policy) |
| **Avatar** | Yes — `picture` URL |
| **Refresh token** | No |

## Notes

- Slack uses OpenID Connect (not standard OAuth2), so the endpoints are `openid.connect.authorize` and `openid.connect.token`.
- Slack emails are always considered verified (`email_verified` is always `true`), so automatic account linking with existing email accounts will work.
- The user ID comes from the `sub` claim in the OpenID Connect response.
- Your app must be installed to a workspace, but users from any workspace can sign in if your app is distributed.
- Use **User Token Scopes**, not **Bot Token Scopes**, for Slack sign-in.
- If Slack says the redirect URL must start with `https://`, that is expected in the current console UI. Use an HTTPS tunnel for local browser testing.
- Local verification was completed on March 8, 2026 using an HTTPS tunnel callback and the js-web browser harness. The current result was `7 passed / 2 skipped`, where the skipped items were the intentional passkey reuse / no-auto-delete checks.
