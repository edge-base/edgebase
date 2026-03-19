---
sidebar_position: 1
sidebar_label: Google
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Google

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Sign in with Google accounts using OAuth 2.0 with OpenID Connect.

## 1. Create OAuth App

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.
3. Open **Google Auth Platform**.
4. In the new UI, consent-screen related settings are split across **Branding**, **Audience**, **Clients**, and **Data Access**.
5. Go to **Clients** and click **Create client** > **OAuth client ID**.
6. If prompted, configure the **OAuth consent screen** first:
   - Choose **External** user type (for public apps) or **Internal** (for Google Workspace only).
   - Fill in the app name, user support email, and developer contact email.
   - Add scopes: `openid`, `email`, `profile`.
   - Add test users if the app is in **Testing** status.
7. In **Clients**, select **Web application** as the application type.
8. Set the **Authorized redirect URIs** (see below).

:::tip Authorized JavaScript origins
For the standard EdgeBase OAuth redirect flow, the critical setting is **Authorized redirect URIs**. You can usually leave **Authorized JavaScript origins** empty unless you are separately using Google's own browser JavaScript SDK.
:::

:::tip New Google Console Layout
Older guides refer to **OAuth consent screen** and **Credentials** under **APIs & Services**. In the current Google console, the same flow often appears under **Google Auth Platform** with separate sections for **Branding**, **Audience**, **Clients**, and **Data Access**.
:::

## 2. Set Redirect URI

Add your EdgeBase callback URL to **Authorized redirect URIs**:

```
https://your-edgebase-url/api/auth/oauth/google/callback
```

For local development:

```
http://localhost:8787/api/auth/oauth/google/callback
```

:::warning redirect_uri_mismatch
If Google shows `400: redirect_uri_mismatch`, compare the exact callback Google has registered with the exact callback EdgeBase is sending. For the built-in server route, the provider callback must be the EdgeBase server callback above, not your browser app callback such as `http://127.0.0.1:4173/auth/callback`.
:::

## 3. Get Credentials

After creating the OAuth client, copy:

- **Client ID** — looks like `123456789-abcdef.apps.googleusercontent.com`
- **Client Secret** — looks like `GOCSPX-xxxxx`

## 3A. Audience / Test Users

- If your app is in **Testing** status and uses **External** audience, add your own Google account under **Audience** > **Test users**.
- If your app is already in **Production** status, test users are not required for basic sign-in testing.
- For a clean setup, Google recommends using separate projects for development/testing and production.

## 4. Configure EdgeBase

Add `google` to your allowed providers:

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    allowedOAuthProviders: ['google'],
  },
});
```

Set credentials in `edgebase.config.ts`:

```typescript
export default defineConfig({
  auth: {
    oauth: {
      google: {
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
client.auth.signInWithOAuth('google');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithOAuth('google');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let url = client.auth.signInWithOAuth(provider: "google")
// Open url in SFSafariViewController or ASWebAuthenticationSession
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signInWithOAuth("google")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().signInWithOAuth("google");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
client.Auth.SignInWithOAuth("google");
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
| **PKCE** | Supported (S256) |
| **Email** | Always provided |
| **Email verified** | Yes — uses `verified_email` field |
| **Avatar** | Yes — `picture` URL |
| **Refresh token** | Yes |

## Notes

- Google uses `access_type=offline` and `prompt=consent` to ensure a refresh token is returned.
- The OAuth consent screen must be published (moved out of "Testing" mode) for production use. In testing mode, only explicitly added test users can sign in.
- Google accounts always provide a verified email address.

## Field-Validated Local Flow

Validated on March 8, 2026 with the local browser harness:

- Provider callback registered in Google: `http://localhost:8787/api/auth/oauth/google/callback`
- App callback used by the browser app: `http://127.0.0.1:4173/auth/callback`
- Result: Google sign-in completed, EdgeBase redirected back to the app callback, the web SDK stored the session, and callback query params were cleared from the URL.
