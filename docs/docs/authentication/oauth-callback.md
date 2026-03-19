---
sidebar_position: 10
---

# OAuth Callback Handling

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

When a user signs in with OAuth, EdgeBase redirects them to the provider (Google, GitHub, etc.), and after authorization, the provider redirects back to your EdgeBase server's callback URL. The server exchanges the authorization code for tokens and either redirects back to your app callback URL or returns JSON when no app redirect URL was provided. This guide explains how to handle this flow in different application architectures.

## How OAuth Works in EdgeBase

```
Client App                EdgeBase Server              OAuth Provider
    |                           |                           |
    |-- signInWithOAuth() ----->|                           |
    |                           |-- Redirect (302) -------->|
    |                           |   + state + PKCE          |
    |                           |                           |
    |                           |<-- Callback (code) -------|
    |                           |   GET /callback?code=...  |
    |                           |                           |
    |                           |-- Exchange code ---------->|
    |                           |   + client_secret          |
    |                           |   + code_verifier (PKCE)   |
    |                           |                           |
    |                           |<-- Access Token -----------|
    |                           |                           |
    |<-- Redirect with tokens --|                           |
    |   ?access_token=...       |                           |
    |   &refresh_token=...      |                           |
    |   (or JSON fallback)      |                           |
```

1. Your app calls `signInWithOAuth()` — the browser redirects to the provider's authorization page.
2. The user authorizes your app. The provider redirects back to EdgeBase's callback URL with an authorization code.
3. EdgeBase exchanges the code for an access token (server-to-server), creates or links the user, and issues EdgeBase session tokens.
4. If you passed `redirectUrl`, EdgeBase redirects the user back to your app with `access_token` and `refresh_token` as URL parameters.
5. If you did not pass `redirectUrl`, EdgeBase finishes on its own callback route and returns JSON instead.

## Security Features

### State Parameter

- A random 32-byte hex value is generated for each OAuth request
- Stored in Cloudflare KV with a 5-minute TTL
- Validated on callback to prevent CSRF attacks
- Single-use — deleted immediately after validation

### PKCE (Proof Key for Code Exchange)

- Currently used for Google OAuth, X OAuth, and custom OIDC providers
- A `codeVerifier` is generated at initiation and the corresponding `codeChallenge` (SHA-256) is sent to the provider
- On callback, the `codeVerifier` is sent during the token exchange to prove possession
- Prevents authorization code interception attacks

## Provider Callback vs App Callback

Two different callback URLs are involved in a normal EdgeBase OAuth flow:

- **Provider callback** — the URL registered in the provider console, such as `http://localhost:8787/api/auth/oauth/google/callback`
- **App callback** — the URL or deep link you pass from the SDK, such as `http://localhost:4173/auth/callback` or `myapp://auth/callback`

The provider must redirect back to the EdgeBase server callback first. EdgeBase then redirects to your app callback with EdgeBase session tokens.

## SPA (Single Page Application)

A typical React SPA should pass an app callback route and then let the web SDK persist the callback tokens:

```typescript
// 1. Initiate OAuth
const handleGoogleLogin = () => {
  client.auth.signInWithOAuth('google', {
    redirectUrl: `${window.location.origin}/auth/callback`,
  });
  // Browser redirects to Google...
};

// 2. Handle callback (in your /auth/callback route component)
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function completeOAuth() {
      const result = await client.auth.handleOAuthCallback();
      if (cancelled) return;

      if (result) {
        navigate('/dashboard');
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const error = params.get('error');
      console.error('OAuth failed:', error);
      navigate('/login?error=oauth_failed');
    }

    void completeOAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  return <div>Signing in...</div>;
}
```

`handleOAuthCallback()` stores the tokens, updates `currentUser`, fires `onAuthStateChange`, and removes `access_token` / `refresh_token` from the browser URL.

If you see a provider-side `redirect_uri_mismatch` error, compare the provider callback registered in the provider console with the server callback EdgeBase is actually sending. Do not compare it against your SPA callback route.

## Next.js (App Router)

For server-rendered apps, keep `redirectUrl` pointed at a server route, extract tokens from the callback URL there, and store them as httpOnly cookies:

```typescript
// app/auth/callback/route.ts
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accessToken = searchParams.get('access_token');
  const refreshToken = searchParams.get('refresh_token');
  const error = searchParams.get('error');

  if (error || !accessToken) {
    return NextResponse.redirect(new URL('/login?error=oauth_failed', request.url));
  }

  // Set tokens as httpOnly cookies for SSR
  const response = NextResponse.redirect(new URL('/dashboard', request.url));
  response.cookies.set('edgebase-access-token', accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 15, // 15 minutes
  });
  response.cookies.set('edgebase-refresh-token', refreshToken!, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 28, // 28 days
  });

  return response;
}
```

## React Native / Mobile

React Native uses deep links to receive the OAuth callback. The SDK provides `handleOAuthCallback()` to extract and store tokens from the deep link URL.

```typescript
import { Linking } from 'react-native';

// 1. Configure deep link scheme in your app (e.g., myapp://)
// iOS: Info.plist → URL Types → myapp
// Android: AndroidManifest.xml → intent-filter

// 2. Initiate OAuth
const handleLogin = () => {
  client.auth.signInWithOAuth('google', {
    redirectUrl: 'myapp://auth/callback',
  });
  // Opens system browser via Linking.openURL()
};

// 3. Handle deep link callback
useEffect(() => {
  const handleDeepLink = ({ url }: { url: string }) => {
    if (url.includes('auth/callback')) {
      client.auth.handleOAuthCallback(url);
      // onAuthStateChange fires automatically
    }
  };

  const subscription = Linking.addEventListener('url', handleDeepLink);
  return () => subscription.remove();
}, []);
```

## Flutter

```dart
// 1. Get OAuth URL
final url = client.auth.signInWithOAuth('google');

// 2. Open in browser
await launchUrl(Uri.parse(url));

// 3. Handle deep link callback (configured in AndroidManifest.xml / Info.plist)
// Use uni_links or app_links package
linkStream.listen((String? link) {
  if (link != null && link.contains('auth/callback')) {
    client.auth.handleOAuthCallback(link);
  }
});
```

## Error Handling

EdgeBase returns errors as URL query parameters on the callback redirect. Common errors and how to handle them:

```typescript
// Check URL params on callback
const params = new URLSearchParams(window.location.search);

const error = params.get('error');
if (error) {
  switch (error) {
    case 'access_denied':
      // User cancelled the OAuth flow
      break;
    case 'invalid_state':
      // State expired (>5 min) or CSRF attempt — retry login
      break;
    case 'provider_error':
      // OAuth provider returned an error
      break;
    case 'email_conflict':
      // Email already registered with a different auth method
      break;
  }
}
```

## JSON Fallback

If you start OAuth without `redirectUrl`, EdgeBase completes the flow on `/api/auth/oauth/:provider/callback` and returns JSON:

```json
{
  "user": { "id": "user_123" },
  "accessToken": "...",
  "refreshToken": "..."
}
```

Use this only when you intentionally want the callback to terminate on the server route. For browser and mobile apps, prefer passing `redirectUrl` so the app can resume on its own route or deep link.

## Provider Configuration

Each OAuth provider requires three things:

1. **Client ID and Client Secret** — Configure them in `edgebase.config.ts`:

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

2. **Redirect URI** — Register in the provider's developer console:

   ```
   https://your-project.edgebase.app/api/auth/oauth/{provider}/callback
   ```

3. **Provider-specific setup** — See the [individual provider guides](/docs/authentication/oauth) for detailed instructions.

## Email Verification by Provider

Whether EdgeBase can auto-link an OAuth account to an existing email account depends on whether the provider confirms that the email is verified. If the email is not verified, auto-linking is disabled and a new account is created instead.

| Provider | Verified Email | Notes |
|----------|---------------|-------|
| Google | Yes | `verified_email` field |
| GitHub | Conditional | Primary email from `/user/emails` API (only when a verified primary email exists) |
| Apple | Always | `email_verified` is always true |
| Discord | Yes | `verified` field |
| Microsoft | Yes | `email_verified` field |
| Facebook | No | No verification field returned |
| Kakao | Conditional | `is_email_verified` field |
| Naver | No | No verification field returned |
| X (Twitter) | No | Email not returned by default |
| Reddit | No | Email not returned (`email: null`) |
| Line | No | No verification field returned |
| Slack | Always | Workspace emails are always verified |
| Spotify | No | No verification field returned |
| Twitch | Conditional | `email_verified` field |

See [Account Linking](/docs/authentication/account-linking) for details on how auto-linking works.
