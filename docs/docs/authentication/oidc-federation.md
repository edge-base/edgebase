---
sidebar_position: 9
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# OIDC Federation

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Connect any OpenID Connect-compliant identity provider to EdgeBase. Beyond the 14 built-in OAuth providers, OIDC Federation lets you integrate with corporate identity systems (Okta, Auth0, Azure AD, Keycloak, etc.) or any provider that supports the OIDC discovery protocol.

:::info Standard OAuth Flow
OIDC Federation providers use the same OAuth sign-in flow as built-in providers. From the client SDK perspective, the only difference is the provider name format: `oidc:{name}` instead of a built-in name like `google`.
:::

## How It Works

1. EdgeBase fetches the provider's **OpenID Connect Discovery document** from `{issuer}/.well-known/openid-configuration`
2. The discovery document provides the `authorization_endpoint`, `token_endpoint`, and `userinfo_endpoint`
3. The standard OAuth authorization code flow runs using these discovered endpoints
4. User info is extracted from the **ID token** (JWT claims) when available, with fallback to the userinfo endpoint
5. PKCE is automatically enabled for all OIDC providers

## Configuration

### 1. Register in `allowedOAuthProviders`

Add your OIDC provider with the `oidc:` prefix:

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    allowedOAuthProviders: [
      'google',                // Built-in provider
      'oidc:okta',             // Custom OIDC provider
      'oidc:azure-ad',         // Another custom OIDC provider
      'oidc:keycloak',         // Any name you choose after oidc:
    ],
  },
});
```

### 2. Set Credentials and Issuer

OIDC provider credentials are configured in `edgebase.config.ts` under `auth.oauth.oidc.{name}`:

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

Each OIDC provider requires three fields:

| Field | Required | Description |
|-------|----------|-------------|
| `clientId` | Yes | OAuth client ID from your identity provider |
| `clientSecret` | Yes | OAuth client secret |
| `issuer` | Yes | The OIDC issuer URL (must serve `/.well-known/openid-configuration`) |
| `scopes` | No | Custom scopes array (default: `['openid', 'email', 'profile']`) |

### 3. Register Redirect URI

In your identity provider's admin console, register the callback URL:

```
https://your-edgebase-url/api/auth/oauth/oidc:{name}/callback
```

For example, if your OIDC provider is named `okta`:

```
https://your-edgebase-url/api/auth/oauth/oidc:okta/callback
```

For local development:

```
http://localhost:8787/api/auth/oauth/oidc:okta/callback
```

## Provider Setup Examples

### Okta

```json
{
  "auth": {
    "oauth": {
      "oidc": {
        "okta": {
          "clientId": "0oaxxxxxxxxxxxxxxxx",
          "clientSecret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
          "issuer": "https://your-org.okta.com"
        }
      }
    }
  }
}
```

Okta issuer URL format: `https://{your-org}.okta.com` or `https://{your-org}.okta.com/oauth2/default` for the default authorization server.

### Auth0

```json
{
  "auth": {
    "oauth": {
      "oidc": {
        "auth0": {
          "clientId": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
          "clientSecret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
          "issuer": "https://your-tenant.auth0.com"
        }
      }
    }
  }
}
```

### Azure AD (Entra ID)

```json
{
  "auth": {
    "oauth": {
      "oidc": {
        "azure-ad": {
          "clientId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
          "clientSecret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
          "issuer": "https://login.microsoftonline.com/{tenant-id}/v2.0"
        }
      }
    }
  }
}
```

Replace `{tenant-id}` with your Azure AD tenant ID. Use `common` for multi-tenant apps.

### Keycloak

```json
{
  "auth": {
    "oauth": {
      "oidc": {
        "keycloak": {
          "clientId": "my-client",
          "clientSecret": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
          "issuer": "https://keycloak.example.com/realms/my-realm"
        }
      }
    }
  }
}
```

### Custom Scopes

Override the default scopes if your provider requires specific ones:

```json
{
  "auth": {
    "oauth": {
      "oidc": {
        "custom-provider": {
          "clientId": "...",
          "clientSecret": "...",
          "issuer": "https://idp.example.com",
          "scopes": ["openid", "email", "profile", "groups"]
        }
      }
    }
  }
}
```

## Usage

OIDC providers use the same SDK methods as built-in OAuth providers. Use the `oidc:{name}` format for the provider parameter.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// Sign in with an OIDC provider
client.auth.signInWithOAuth('oidc:okta');

// With redirect URL
client.auth.signInWithOAuth('oidc:azure-ad', {
  redirectUrl: 'https://my-app.com/auth/callback',
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithOAuth('oidc:okta');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
let url = client.auth.signInWithOAuth(provider: "oidc:okta")
// Open url in SFSafariViewController or ASWebAuthenticationSession
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth().signInWithOAuth("oidc:okta");
```

</TabItem>
<TabItem value="java" label="Java">

```java
client.auth().signInWithOAuth("oidc:okta");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
client.Auth.SignInWithOAuth("oidc:okta");
```

</TabItem>
</Tabs>

## REST API

OIDC federation uses the same OAuth endpoints with the `oidc:{name}` provider parameter:

| Endpoint | Description |
|----------|-------------|
| `GET /auth/oauth/oidc:{name}` | Start OIDC OAuth flow (redirects to provider) |
| `GET /auth/oauth/oidc:{name}/callback` | Handle OIDC OAuth callback |
| `POST /auth/oauth/link/oidc:{name}` | Link the current account to an OIDC provider (anonymous upgrade or signed-in attach) |
| `GET /auth/oauth/link/oidc:{name}/callback` | OIDC link callback |

## Technical Details

### Discovery Document Caching

EdgeBase caches the OIDC discovery document in memory for 1 hour per Worker instance. This avoids refetching the discovery document on every authentication request while still picking up provider configuration changes reasonably quickly.

### ID Token Parsing

When the OIDC provider returns an `id_token` in the token response, EdgeBase extracts user information directly from the JWT claims:

| JWT Claim | Mapped Field |
|-----------|-------------|
| `sub` | `providerUserId` |
| `email` | `email` |
| `email_verified` | `emailVerified` |
| `name` | `displayName` |
| `picture` | `avatarUrl` |

If no `id_token` is returned, EdgeBase falls back to the provider's `userinfo_endpoint`.

### PKCE Support

PKCE (Proof Key for Code Exchange) is automatically enabled for all OIDC providers, providing an additional layer of security for the authorization code exchange.

### Account Linking

If a user signs in with an OIDC provider using an email that already exists in your EdgeBase project, accounts are automatically linked when the email is verified by the provider. See [Account Linking](./account-linking) for details.

## Verifying Your Setup

To verify that your OIDC provider is correctly configured:

1. Confirm the discovery endpoint is accessible: `curl https://your-issuer/.well-known/openid-configuration`
2. Verify the response includes `authorization_endpoint` and `token_endpoint`
3. Confirm the redirect URI is registered in your provider's admin console
4. Start the dev server and attempt a sign-in via `GET /api/auth/oauth/oidc:{name}`
