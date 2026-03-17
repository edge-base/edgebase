---
sidebar_position: 11
sidebar_label: Line
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Line

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Sign in with LINE accounts using OAuth 2.0 with OpenID Connect. Popular in Japan, Taiwan, and Thailand.

## 1. Create OAuth App

1. Go to the [LINE Developers Console](https://developers.line.biz/console/).
2. Log in with your LINE account.
3. Create a new **Provider** (or select an existing one).
4. Click **Create a new channel** > **LINE Login**.
5. Fill in the required fields:
   - **Channel name**: Your app name
   - **Channel description**: Brief description
   - **App types**: Check **Web app**
6. After creation, go to the **LINE Login** tab.
7. Add your callback URL (see below).

## 2. Set Redirect URI

Add your EdgeBase callback URL under the **LINE Login** tab > **Callback URL**:

```
https://your-edgebase-url/api/auth/oauth/line/callback
```

For local development:

```
http://localhost:8787/api/auth/oauth/line/callback
```

## 3. Get Credentials

In your channel's **Basic settings** tab:

- **Client ID** — Listed as **Channel ID**.
- **Client Secret** — Listed as **Channel secret**.

## 4. Configure EdgeBase

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    allowedOAuthProviders: ['line'],
  },
});
```

```typescript
export default defineConfig({
  auth: {
    oauth: {
      line: {
        clientId: 'YOUR_CHANNEL_ID',
        clientSecret: 'YOUR_CHANNEL_SECRET',
      },
    },
  },
});
```

## 5. Usage

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
client.auth.signInWithOAuth('line');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithOAuth('line');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let url = client.auth.signInWithOAuth(provider: "line")
// Open url in SFSafariViewController or ASWebAuthenticationSession
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signInWithOAuth("line")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().signInWithOAuth("line");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
client.Auth.SignInWithOAuth("line");
```

</TabItem>
<TabItem value="cpp" label="C++">

> OAuth requires a browser redirect flow. For C++ (Unreal Engine), handle OAuth in a platform webview and pass the token to the SDK.

</TabItem>
</Tabs>

## Provider Details

| Property | Value |
|----------|-------|
| **Scopes** | `profile openid email` |
| **PKCE** | No |
| **Email** | Conditional — only from `id_token`, not profile API |
| **Email verified** | No — LINE does not provide verification status |
| **Avatar** | Yes — `pictureUrl` |
| **Refresh token** | Yes |

## Notes

- Email is extracted from the `id_token` JWT, not from the profile endpoint. The email may not be available if the user hasn't granted email permission.
- EdgeBase sets `emailVerified: false` for LINE accounts, so automatic account linking will not occur.
- The LINE user ID field is named `userId` (not `id`), which EdgeBase handles automatically.
- To request email access, you must apply for email permission in the LINE Developers Console under your channel's **OpenID Connect** settings.
- The channel must be **Published** (not in Development) for non-developer users to sign in.
