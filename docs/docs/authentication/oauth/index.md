---
sidebar_position: 0
sidebar_label: Overview
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import DocCardList from '@theme/DocCardList';

# OAuth

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Sign in with third-party providers. EdgeBase supports 14 OAuth providers out of the box.

:::info Provider Setup Required
Before using any OAuth provider, you must register an OAuth application in the provider's developer console and configure the credentials. See the [individual provider guides](#supported-providers) below.
:::

:::tip Captcha Protection
When [captcha is enabled](/docs/authentication/captcha), OAuth initiation (`GET /auth/oauth/:provider`) is automatically protected by Cloudflare Turnstile. Client SDKs attach the captcha token as a query parameter — no code changes needed.
:::

## Configuration

### 1. Enable Providers

Add the providers you want to use in your config:

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    allowedOAuthProviders: ['google', 'github', 'apple', 'discord'],
  },
});
```

### 2. Set Credentials

Provider credentials live in `edgebase.config.ts` under `auth.oauth`.

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    oauth: {
      google: {
        clientId: 'YOUR_CLIENT_ID',
        clientSecret: 'YOUR_CLIENT_SECRET',
      },
      github: {
        clientId: 'YOUR_CLIENT_ID',
        clientSecret: 'YOUR_CLIENT_SECRET',
      },
    },
  },
});
```

If you do not want literals in source, import the values from your own local secret-loading module when building the config.

### 3. Register Redirect URI

In each provider's developer console, register this redirect URI:

```
https://your-edgebase-url/api/auth/oauth/{provider}/callback
```

Replace `{provider}` with the provider name (e.g., `google`, `github`). For local development:

```
http://localhost:8787/api/auth/oauth/google/callback
```

:::caution Provider callback vs app callback
The URI you register in the provider console is the **EdgeBase server callback** such as `http://localhost:8787/api/auth/oauth/google/callback`.

That is different from your browser or mobile app callback such as `http://localhost:4173/auth/callback` or `myapp://auth/callback`, which is passed from the SDK as `redirectUrl`.
:::

## Common Setup Pitfalls

- Some provider consoles allow `http://localhost/...` for local callbacks, while others require an HTTPS callback even in development. Slack currently needs an HTTPS tunnel.
- Providers often show multiple credential types. EdgeBase needs the OAuth client credentials for the provider flow, not unrelated API keys, bearer tokens, user tokens, or installation tokens.
- Some providers do not return a verified email, or do not return email at all. That affects automatic account linking and also explains why local validation harnesses may show `skipped` checks for password, email, or TOTP paths.
- In the JavaScript web SDK, use `redirectUrl` for the app callback.

## Supported Providers

| Provider | Email | Email Verified | PKCE | Setup Guide |
|----------|-------|----------------|------|-------------|
| Google | Yes | Yes | Supported | [Guide](./google) |
| GitHub | Yes | Yes (primary only) | No | [Guide](./github) |
| Apple | Yes | Always | No | [Guide](./apple) |
| Discord | Yes | Yes | No | [Guide](./discord) |
| Microsoft | Yes | Yes | Supported | [Guide](./microsoft) |
| Facebook | Yes | No | No | [Guide](./facebook) |
| Kakao | Yes | Conditional | No | [Guide](./kakao) |
| Naver | Yes | No | No | [Guide](./naver) |
| X (Twitter) | No | No | Required | [Guide](./x) |
| Reddit | No | No | No | [Guide](./reddit) |
| Line | Conditional | No | No | [Guide](./line) |
| Slack | Yes | Always | No | [Guide](./slack) |
| Spotify | Yes | No | No | [Guide](./spotify) |
| Twitch | Yes | Yes | No | [Guide](./twitch) |

### Provider Setup Guides

<DocCardList />

## Usage

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// Browser: opens OAuth popup/redirect
client.auth.signInWithOAuth('google');

// With redirect URL
client.auth.signInWithOAuth('github', {
  redirectUrl: 'https://my-app.com/auth/callback',
});
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
client.auth().signInWithOAuth("google");
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

## Custom OIDC Providers

Beyond the 14 built-in providers, EdgeBase supports any OpenID Connect-compliant identity provider (Okta, Auth0, Azure AD, Keycloak, etc.) via OIDC Federation.

Custom OIDC providers use the `oidc:` prefix (e.g., `oidc:my-provider`) and automatically discover endpoints via `.well-known/openid-configuration`. PKCE is enabled by default for enhanced security.

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    allowedOAuthProviders: [
      'google',           // Built-in provider
      'oidc:okta',        // Custom OIDC provider
      'oidc:azure-ad',    // Another custom OIDC provider
    ],
  },
});
```

Credentials are configured in `edgebase.config.ts`:

```typescript
export default defineConfig({
  auth: {
    oauth: {
      oidc: {
        okta: {
          clientId: 'YOUR_CLIENT_ID',
          clientSecret: 'YOUR_CLIENT_SECRET',
          issuer: 'https://your-org.okta.com',
        },
      },
    },
  },
});
```

| Field | Required | Description |
|-------|----------|-------------|
| `clientId` | Yes | OAuth client ID |
| `clientSecret` | Yes | OAuth client secret |
| `issuer` | Yes | OIDC issuer URL (must serve `/.well-known/openid-configuration`) |
| `scopes` | No | Custom scopes array (default: `['openid', 'email', 'profile']`) |

SDK usage is identical to built-in providers -- use the `oidc:{name}` format for the provider parameter:

```typescript
client.auth.signInWithOAuth('oidc:okta');
```

See [OIDC Federation](../oidc-federation) for full setup guides with Okta, Auth0, Azure AD, and Keycloak.

## Account Linking

If a user signs up with email and later uses OAuth with the same verified email, the accounts are automatically linked. This only happens when the OAuth provider confirms the email is verified.

Signed-in users can also explicitly attach additional OAuth providers to the same account with `client.auth.linkWithOAuth(...)`.

See [Account Linking](../account-linking) for details.

## Field Notes from Local Validation

The built-in js-web browser harness was used to validate provider flows on March 8, 2026. A result such as `passed + skipped` can still be healthy:

- `passed` means the provider login, callback, session creation, and applicable post-login checks completed.
- `skipped` usually means the signed-in provider account did not expose an email-backed or password-capable path, so checks like password bootstrap, email round-trip, or TOTP were intentionally not attempted.
- This is common for providers like X, Kakao, Naver, and some Microsoft account shapes.

## REST API

| Endpoint | Description |
|----------|-------------|
| `GET /auth/oauth/:provider` | Start OAuth flow (redirects to provider) |
| `GET /auth/oauth/:provider/callback` | Handle OAuth callback |
| `POST /auth/oauth/link/:provider` | Link the current account to an OAuth provider (anonymous upgrade or signed-in attach) |
| `GET /auth/oauth/link/:provider/callback` | OAuth link callback |
