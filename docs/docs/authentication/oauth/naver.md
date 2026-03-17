---
sidebar_position: 8
sidebar_label: Naver
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Naver

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Sign in with Naver accounts using OAuth 2.0. Popular in South Korea.

## 1. Create OAuth App

1. Go to [Naver Developers](https://developers.naver.com/apps/#/register).
2. Log in with your Naver account.
3. Click **Application** > **Register Application**.
4. Fill in:
   - **Application name**: Your app name
   - **Usage API**: Select **Naver Login**
   - **Required permissions**: Check **Email Address**, **Profile Image**, **Nickname**, **Name**
5. Under **Login Open API Service Environment**, select **Web** and add your callback URL (see below).
6. Click **Register**.

## 2. Set Redirect URI

Set the **Callback URL** during registration:

```
https://your-edgebase-url/api/auth/oauth/naver/callback
```

For local development:

```
http://localhost:8787/api/auth/oauth/naver/callback
```

## 3. Get Credentials

After registration, go to your app's **Overview** page:

- **Client ID** — Displayed as the application's Client ID.
- **Client Secret** — Displayed as the application's Client Secret.

## 4. Configure EdgeBase

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    allowedOAuthProviders: ['naver'],
  },
});
```

```typescript
export default defineConfig({
  auth: {
    oauth: {
      naver: {
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
client.auth.signInWithOAuth('naver');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithOAuth('naver');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let url = client.auth.signInWithOAuth(provider: "naver")
// Open url in SFSafariViewController or ASWebAuthenticationSession
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signInWithOAuth("naver")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().signInWithOAuth("naver");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
client.Auth.SignInWithOAuth("naver");
```

</TabItem>
<TabItem value="cpp" label="C++">

> OAuth requires a browser redirect flow. For C++ (Unreal Engine), handle OAuth in a platform webview and pass the token to the SDK.

</TabItem>
</Tabs>

## Provider Details

| Property | Value |
|----------|-------|
| **Scopes** | Configured via permission settings (not URL scopes) |
| **PKCE** | No |
| **Email** | Yes |
| **Email verified** | No — Naver does not provide email verification status |
| **Avatar** | Yes — `profile_image` |
| **Refresh token** | Yes |

## Notes

- Naver does not provide email verification status, so EdgeBase sets `emailVerified: false`. Automatic account linking with existing email accounts will **not** occur.
- User data is nested under the `response` object in the API response — EdgeBase handles this automatically.
- Display name uses the `name` field if available, falling back to `nickname`.
- For production use with users outside the developer's own account, the app must be reviewed and approved by Naver.
- Because the email is not marked verified, browser-harness checks such as password bootstrap, email round-trip, and TOTP may be skipped even when Naver sign-in itself succeeds.
- Local verification was completed on March 8, 2026 against `http://localhost:8787/api/auth/oauth/naver/callback` using the js-web browser harness. The current result was `2 passed / 7 skipped`.
