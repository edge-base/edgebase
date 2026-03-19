---
sidebar_position: 2
sidebar_label: GitHub
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# GitHub

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Sign in with GitHub accounts using OAuth 2.0.

## 1. Create OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers).
2. Click **OAuth Apps** > **New OAuth App**.
3. Fill in the fields:
   - **Application name**: Your app name
   - **Homepage URL**: Your app's URL (e.g., `https://my-app.com`)
   - **Authorization callback URL**: Your EdgeBase callback URL (see below)
4. Click **Register application**.

:::caution OAuth App, not GitHub App
EdgeBase's built-in `github` provider expects the standard **OAuth App** credentials from **OAuth Apps**. A **GitHub App** uses a different auth model and is not interchangeable with this provider setup.
:::

## 2. Set Redirect URI

Set the **Authorization callback URL** to:

```
https://your-edgebase-url/api/auth/oauth/github/callback
```

For local development:

```
http://localhost:8787/api/auth/oauth/github/callback
```

## 3. Get Credentials

After creating the app:

1. Copy the **Client ID** from the app page.
2. Click **Generate a new client secret** and copy the **Client Secret** immediately (it won't be shown again).

## 4. Configure EdgeBase

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    allowedOAuthProviders: ['github'],
  },
});
```

```typescript
export default defineConfig({
  auth: {
    oauth: {
      github: {
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
client.auth.signInWithOAuth('github');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithOAuth('github');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let url = client.auth.signInWithOAuth(provider: "github")
// Open url in SFSafariViewController or ASWebAuthenticationSession
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signInWithOAuth("github")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().signInWithOAuth("github");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
client.Auth.SignInWithOAuth("github");
```

</TabItem>
<TabItem value="cpp" label="C++">

> OAuth requires a browser redirect flow. For C++ (Unreal Engine), handle OAuth in a platform webview and pass the token to the SDK.

</TabItem>
</Tabs>

## Provider Details

| Property | Value |
|----------|-------|
| **Scopes** | `read:user user:email` |
| **PKCE** | No |
| **Email** | Yes — from separate `/user/emails` endpoint |
| **Email verified** | Yes — only the primary verified email is used |
| **Avatar** | Yes — `avatar_url` |
| **Refresh token** | No |

## Notes

- GitHub fetches the user's email from a separate API endpoint (`/user/emails`). Only the **primary** and **verified** email is used.
- If the user has no verified primary email on GitHub, the email field will be empty.
- GitHub does not issue refresh tokens — sessions rely on EdgeBase's own token management.
- If the verified primary GitHub email matches an existing EdgeBase user, GitHub sign-in may auto-link to that existing account instead of creating a new user. This is expected behavior.
