---
sidebar_position: 7
sidebar_label: Kakao
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Kakao

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Sign in with Kakao accounts using OAuth 2.0. Popular in South Korea.

## 1. Create OAuth App

1. Go to [Kakao Developers](https://developers.kakao.com/).
2. Log in with your Kakao account.
3. Click **My Application** > **Add Application**.
4. Enter the app name and company name, then create it.
5. Go to **App** > **Platform key** > **REST API key** to find your credentials.
6. Go to **Kakao Login** > **General** and enable Kakao Login.
7. Go to **App** > **Platform key** > **REST API key** > **Redirect URI** and add your callback URL (see below).
8. Go to **Kakao Login** > **Consent Items** and enable:
   - **Profile Info** (nickname, profile image)
   - **Account Email** — set to **Required** or **Optional**

## 2. Set Redirect URI

Add your EdgeBase callback URL under **App** > **Platform key** > **REST API key** > **Redirect URI**:

```
https://your-edgebase-url/api/auth/oauth/kakao/callback
```

For local development:

```
http://localhost:8787/api/auth/oauth/kakao/callback
```

Use the **Kakao Login Redirect URI** field for this. Do not register it under **Business Authentication Redirect URI**.

## 3. Get Credentials

In **App** > **Platform key** > **REST API key**:

- **Client ID** — Use the **REST API Key**.
- **Client Secret** — Open **Client Secret**, generate it, and set the activation status to **Enable**.

Do not use the separate **Business Authentication** code for EdgeBase's built-in `kakao` provider.

## 4. Configure EdgeBase

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    allowedOAuthProviders: ['kakao'],
  },
});
```

```typescript
export default defineConfig({
  auth: {
    oauth: {
      kakao: {
        clientId: 'YOUR_REST_API_KEY',
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
client.auth.signInWithOAuth('kakao');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithOAuth('kakao');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let url = client.auth.signInWithOAuth(provider: "kakao")
// Open url in SFSafariViewController or ASWebAuthenticationSession
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signInWithOAuth("kakao")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().signInWithOAuth("kakao");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
client.Auth.SignInWithOAuth("kakao");
```

</TabItem>
<TabItem value="cpp" label="C++">

> OAuth requires a browser redirect flow. For C++ (Unreal Engine), handle OAuth in a platform webview and pass the token to the SDK.

</TabItem>
</Tabs>

## Provider Details

| Property | Value |
|----------|-------|
| **Scopes** | Configured via consent items (not URL scopes) |
| **PKCE** | No |
| **Email** | Yes (if consent granted) |
| **Email verified** | Conditional — uses `is_email_verified` field |
| **Avatar** | Yes — `profile_image_url` |
| **Refresh token** | Yes |

## Notes

- Kakao uses a consent-based scope system. Scopes are configured in the developer console under **Consent Items**, not in the OAuth URL.
- Email verification status depends on the user's Kakao account settings. If `is_email_verified` is `true`, automatic account linking with existing email accounts will work.
- User data is nested under `kakao_account.profile` in the API response — EdgeBase handles this automatically.
- For production, your app must pass Kakao's review process for certain consent items (like email).
- As of March 8, 2026, Kakao's console places REST API redirect URI and client secret under **App** > **Platform key** > **REST API key**.
- OpenID Connect in Kakao is optional. EdgeBase's built-in `kakao` provider uses the standard OAuth authorize/token flow plus `https://kapi.kakao.com/v2/user/me`, so you do not need to enable OpenID Connect unless you specifically want Kakao ID tokens.
- Local verification was completed on March 8, 2026 against `http://localhost:8787/api/auth/oauth/kakao/callback` using the js-web browser harness. The current result was `2 passed / 7 skipped`, which is expected when the signed-in Kakao account does not expose an email-backed/password-capable path in the harness.
