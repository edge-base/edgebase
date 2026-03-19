---
sidebar_position: 5
sidebar_label: Microsoft
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Microsoft

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Sign in with Microsoft accounts (personal, work, or school) using Azure AD OAuth 2.0 with OpenID Connect.

## 1. Create OAuth App

1. Go to the [Azure Portal — App registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade).
2. Click **New registration**.
3. Fill in:
   - **Name**: Your app name
   - **Supported account types**: Choose based on your needs:
     - **Personal Microsoft accounts only** — consumer apps
     - **Accounts in any organizational directory and personal accounts** — broadest reach (recommended)
   - **Redirect URI**: Select **Web** and enter your callback URL (see below). In the current portal UI this field is optional during the first registration step, so you can also leave it blank and add it later.
4. Click **Register**.

## 2. Set Redirect URI

Set the redirect URI during registration, or add it later under **Authentication** > **Add a platform** > **Web**:

```
https://your-edgebase-url/api/auth/oauth/microsoft/callback
```

For local development:

```
http://localhost:8787/api/auth/oauth/microsoft/callback
```

Microsoft allows `http://localhost/...` redirect URIs for local development on web applications.

## 3. Get Credentials

1. **Client ID** — Found on the app's **Overview** page as **Application (client) ID**.
2. **Client Secret**:
   - Go to **Certificates & secrets** > **Client secrets** > **New client secret**.
   - Set a description and expiry.
   - Copy the **Value** immediately (it won't be shown again).
   - Use the **Value** field, not the **Secret ID** field. Azure shows both in the secrets table, but EdgeBase needs the secret value.

## 4. Configure EdgeBase

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    allowedOAuthProviders: ['microsoft'],
  },
});
```

```typescript
export default defineConfig({
  auth: {
    oauth: {
      microsoft: {
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
client.auth.signInWithOAuth('microsoft');
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithOAuth('microsoft');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let url = client.auth.signInWithOAuth(provider: "microsoft")
// Open url in SFSafariViewController or ASWebAuthenticationSession
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signInWithOAuth("microsoft")
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().signInWithOAuth("microsoft");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
client.Auth.SignInWithOAuth("microsoft");
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
| **Email** | Yes |
| **Email verified** | Yes — uses `email_verified` field |
| **Avatar** | No — not available via OIDC userinfo endpoint |
| **Refresh token** | Yes |

## Notes

- EdgeBase uses the `/common` tenant endpoint, which accepts both personal Microsoft accounts and Azure AD (work/school) accounts.
- Client secrets have an expiration date — remember to rotate them before they expire.
- Azure shows both a client secret **Value** and a **Secret ID**. Only the **Value** should be used as `clientSecret` in `edgebase.config.ts`.
- Profile pictures are not available through the OIDC userinfo endpoint. The Microsoft Graph API (`/me/photo`) would be needed for avatars, but EdgeBase does not call it.
- As of March 8, 2026, the Azure portal registration screen labels the redirect URI field as optional. If you skip it on the first screen, add it immediately afterward in **Authentication** > **Add a platform** > **Web**.
- For local testing, the most practical account type is **Accounts in any organizational directory and personal Microsoft accounts**, because it covers both Outlook/Hotmail personal accounts and Entra work or school accounts.
- Some Microsoft accounts do not expose a usable email address through the OIDC userinfo payload. In that case, OAuth sign-in still works, but email/password bootstrap, email round-trip, and TOTP checks will be skipped in the browser harness until an email-backed account is used.
