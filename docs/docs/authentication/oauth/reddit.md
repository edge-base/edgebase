---
sidebar_position: 10
sidebar_label: Reddit
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Reddit

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Sign in with Reddit accounts using OAuth 2.0.

:::caution API access approval may be required first
As of March 2026, Reddit's current policy says API access requires explicit approval. In practice, the old `/prefs/apps` form may appear to submit but still refuse to create the app until your account/use case is approved.

Start here if app creation keeps failing:

- Policy: https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy
- Request form: https://support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=14868593862164
:::

## 1. Create OAuth App

1. Go to [Reddit Apps](https://www.reddit.com/prefs/apps).
2. Scroll to the bottom and click **create another app...**.
3. Fill in:
   - **name**: Your app name
   - **app type**: Choose **web app**
   - **redirect uri**: Your EdgeBase callback URL (see below)
4. Click **create app**.

:::caution Use web app
For EdgeBase's built-in `reddit` provider, choose **web app**. Do not use the installed app or script app types for this flow.
:::

## 2. Set Redirect URI

Set the **redirect uri** to:

```
https://your-edgebase-url/api/auth/oauth/reddit/callback
```

For local development:

```
http://localhost:8787/api/auth/oauth/reddit/callback
```

## 3. Get Credentials

On the Reddit app page:

- **Client ID** — The short string shown directly under the app name
- **Client Secret** — The value labeled `secret`

:::tip Client ID label
Reddit's UI does not label the client ID as `client_id` in an obvious way. It is the short string under the app name, not the app name itself.
:::

## 4. Configure EdgeBase

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    allowedOAuthProviders: ['reddit'],
  },
});
```

```typescript
export default defineConfig({
  auth: {
    oauth: {
      reddit: {
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
client.auth.signInWithOAuth('reddit');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithOAuth('reddit');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let url = client.auth.signInWithOAuth(provider: "reddit")
// Open url in SFSafariViewController or ASWebAuthenticationSession
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signInWithOAuth("reddit")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().signInWithOAuth("reddit");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
client.Auth.SignInWithOAuth("reddit");
```

</TabItem>
<TabItem value="cpp" label="C++">

> OAuth requires a browser redirect flow. For C++ (Unreal Engine), handle OAuth in a platform webview and pass the token to the SDK.

</TabItem>
</Tabs>

## Provider Details

| Property | Value |
|----------|-------|
| **Scopes** | `identity` |
| **PKCE** | No |
| **Email** | No |
| **Email verified** | No |
| **Avatar** | Yes — `snoovatar_img` or `icon_img` |
| **Refresh token** | Yes — EdgeBase requests `duration=permanent` |

## Notes

- Reddit sign-in uses the `identity` scope only. Reddit does not expose email in this built-in provider flow.
- Because no verified email is available, automatic account linking does not occur.
- Token exchange uses HTTP Basic auth with the Reddit client ID and secret.
- EdgeBase requests `duration=permanent` so Reddit can return a refresh token for the provider-side session.
- Reddit's older `/prefs/apps` UI still exists, but API approval policy has become stricter. If the form silently fails after CAPTCHA, request API access first and describe the use case as a small OAuth login integration using the `identity` scope only.
