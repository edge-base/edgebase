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
    |<-- Redirect to app -------|                           |
    |   one-time ticket only    |                           |
    |-- POST /oauth/exchange -->|                           |
    |<-- Session response ------|                           |
```

1. Your app calls `signInWithOAuth()` — the browser redirects to the provider's authorization page.
2. The user authorizes your app. The provider redirects back to EdgeBase's callback URL with an authorization code.
3. EdgeBase exchanges the provider code and verifies provider identity, but does
   not create an EdgeBase session before an app redirect. It stores a
   short-lived, one-time completion ticket.
4. EdgeBase redirects to the app with only `oauth_exchange_ticket`, transport,
   and SDK binding fields in the URL fragment. No bearer credential is put in
   the app URL.
5. The SDK scrubs the fragment, consumes its local binding, and posts the ticket
   to `POST /api/auth/oauth/exchange`. That atomic exchange creates the session;
   body transport receives tokens in the JSON response, while cookie transport
   receives the access token and an EdgeBase-managed refresh cookie.
6. If you did not pass `redirectUrl`, EdgeBase intentionally terminates on its
   own callback route and returns the auth JSON directly.

## Security Features

### State Parameter

- A random 32-byte hex value is generated for each OAuth request
- Stored for five minutes in a key-sharded `AUTH` Durable Object
- Atomically consumed on callback to prevent CSRF and concurrent replay
- Bound to a short-lived `HttpOnly` browser cookie. Normal GET callbacks use
  `SameSite=Lax`; Apple's cross-site `form_post` callback uses
  `SameSite=None; Secure` and therefore requires HTTPS.
- On HTTPS the state and browser-generation cookies use the `__Host-` prefix
  and `Path=/`. A callback copied from another browser is rejected before the
  provider code is exchanged.

Cloudflare KV is only a best-effort rolling-upgrade mirror for states created
by an earlier release. It is not authoritative for new OAuth flows.

### App Callback Binding (Web and React Native SDKs)

- Each supported SDK sign-in or account-link start creates a separate 32-byte
  CSPRNG nonce before opening the provider. Web stores a bounded, namespaced
  browser registry; React Native stores its registry in the required
  Keychain/Keystore-backed `secureStorage`. Both keep at most eight live flows.
- EdgeBase carries that nonce inside the server-side OAuth state record and
  returns it beside a five-minute completion ticket only after the provider flow
  completes.
- `handleOAuthCallback()` consumes only the matching flow before it exchanges
  credentials. A missing, malformed, or mismatched callback cannot cancel
  another pending flow; a provider error consumes only the named flow.
- The flow records the auth epoch at start. The start epoch, callback epoch,
  and current persisted epoch must match, so sign-out always supersedes an old
  callback. Web serializes credential-creating requests across tabs and React
  Native serializes secure-storage mutation. The server then atomically
  consumes the completion ticket and creates exactly one session; bearer
  credentials never transit the callback URL.
- A copied callback, or an attacker callback carrying another valid refresh
  token while a legitimate flow is pending, therefore cannot switch the local
  session or cancel the legitimate flow.
- OAuth start fails before navigation if persistent storage or secure
  randomness is unavailable. React Native additionally requires
  Keychain/Keystore-backed `secureStorage` unless the app explicitly enables
  the development-only insecure-storage escape hatch.

For a rolling upgrade, deploy the EdgeBase server before the current Web SDK.
The server keeps the nonce optional so older and native SDK starts continue to
work, while the current Web SDK intentionally rejects an explicit app callback
that an older server returns without the binding. Deploy the server first. The
pending flows use nonce-specific keys, separate from the released
cookie-recovery key, so an older tab cannot delete new pending flows. After a
verified cookie callback, the SDK writes the released v1 recovery shape so a
rollback or reload can still complete a parameterless retry.

### PKCE (Proof Key for Code Exchange)

- Currently used for Google OAuth, X OAuth, and custom OIDC providers
- A `codeVerifier` is generated at initiation and the corresponding `codeChallenge` (SHA-256) is sent to the provider
- On callback, the `codeVerifier` is sent during the token exchange to prove possession
- Prevents authorization code interception attacks

## Provider Callback vs App Callback

Two different callback URLs are involved in a normal EdgeBase OAuth flow:

- **Provider callback** — the URL registered in the provider console, such as `http://localhost:8787/api/auth/oauth/google/callback`
- **App callback** — the URL you pass from the SDK, such as
  `http://localhost:4173/auth/callback` during local Web development or
  `https://app.example.com/auth/callback` in release.

The provider must redirect back to the EdgeBase server callback first. EdgeBase then redirects to your app callback. Release mode accepts only HTTPS app callbacks that match an explicitly configured `auth.allowedRedirectUrls` URL, origin, or path-prefix entry. Native apps must own the HTTPS callback through iOS Universal Links or Android App Links; custom URL schemes are not a release-safe callback channel.

The CLI's explicit `local-development` runtime may use an HTTP loopback
`baseUrl` for the EdgeBase **provider callback**, including when testing a
release config. That exception does not relax app `redirectUrl` validation:
release app callbacks remain HTTPS-only, and deployed/self-hosted release
provider callbacks fail closed without HTTPS.

## SPA (Single Page Application)

Every current app callback is ticket-only. A React SPA can additionally keep
the durable refresh credential out of JavaScript storage and exchange responses
by enabling server cookie sessions and creating the client with
`refreshTokenTransport: 'httpOnlyCookie'`:

```typescript
const client = createClient(edgeBaseUrl, {
  refreshTokenTransport: 'httpOnlyCookie',
});
```

Pass an app callback route and let the Web SDK finish the exchange:

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

      // The SDK has already removed callback ticket and error fields from
      // browser history before it returns.
      console.error('OAuth failed or the callback could not be validated.');
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

In cookie mode, `handleOAuthCallback()` first verifies and consumes the Web
SDK's flow nonce, then exchanges the one-time ticket. The exchange sets the
HttpOnly refresh cookie and returns an access token, updates
`currentUser`, fires `onAuthStateChange`, and removes every auth field from the
browser URL. Completion tickets expire after five minutes. Before exchange, the
SDK persists the exact ticket and binding; if a response is lost or local token
persistence fails, it retries that same ticket. The server returns the cached,
byte-for-byte-equivalent completion result instead of creating another session.
After a confirmed success the SDK clears every sibling callback so an older flow
cannot switch the account after reload. If the five-minute window expires,
restart OAuth.
Body mode validates the same one-shot nonce and atomically exchanges the callback
ticket before adopting the JSON session response. A persisted auth epoch makes a local or peer-tab sign-out
authoritative over a slow ticket exchange, so the late response cannot
restore the session. React Native applies the same nonce, ticket exchange, and
auth-epoch rules to deep links; see the support matrix before using another
native SDK.

If you see a provider-side `redirect_uri_mismatch` error, compare the provider callback registered in the provider console with the server callback EdgeBase is actually sending. Do not compare it against your SPA callback route.

## Next.js (App Router)

OAuth app-callback authority is returned as a one-time ticket in the URL
fragment. Browsers do
not send fragments to a Next.js route handler, so a server route cannot extract
these values. Use a Client Component callback route and the Web SDK flow shown
above. For an HttpOnly refresh credential, create the Web client with
`refreshTokenTransport: 'httpOnlyCookie'`; EdgeBase sets and rotates that cookie
only during the ticket exchange. The app callback receives no bearer token.

## Native Callback Support

| SDK | Start OAuth | Secure callback completion |
| --- | --- | --- |
| Web (`@edge-base/web`) | Supported | Supported with `handleOAuthCallback()` |
| React Native (`@edge-base/react-native`) | Supported | Supported with `handleOAuthCallback()` |
| Flutter/Dart | URL construction only | Not currently supported |
| Swift/iOS | URL construction only | Not currently supported |
| Kotlin/Android and Java/Android | URL construction only | Not currently supported |
| C# / Unity | URL construction only | Not currently supported |
| C++ / Unreal | URL construction only | Not currently supported |

Do not ship a production native OAuth flow on a row marked unsupported. Those
SDKs can construct a provider URL, but they do not yet bind, validate, rotate,
and persist an app deep-link callback.

## React Native / Mobile

React Native uses a claimed HTTPS Universal Link or Android App Link to receive
the OAuth callback. Its async start
persists a one-shot CSPRNG nonce before opening the browser. The callback
handler accepts the server fragment (and query fallback for deep-link bridges),
consumes that nonce, and atomically exchanges the short-lived completion ticket
before storing the returned session.

```typescript
import { Linking } from 'react-native';

// 1. Configure https://app.example.com as an iOS Associated Domain and an
// Android verified App Link. Add the exact callback to allowedRedirectUrls.
const oauthCallbackUrl = 'https://app.example.com/auth/callback';

// 2. Initiate OAuth
const handleLogin = async () => {
  await client.auth.signInWithOAuth('google', {
    redirectUrl: oauthCallbackUrl,
  });
  // Opens system browser via Linking.openURL()
};

// 3. Handle callbacks while the app is already running.
useEffect(() => {
  const handleDeepLink = ({ url }: { url: string }) => {
    if (url.includes('auth/callback')) {
      void client.auth.handleOAuthCallback(url);
      // onAuthStateChange fires automatically
    }
  };

  const subscription = Linking.addEventListener('url', handleDeepLink);
  return () => subscription.remove();
}, []);

// 4. Also handle a callback that launched a terminated app. Call this once
// after client initialization; it reads Linking.getInitialURL().
void client.auth.handleInitialOAuthCallback();
```

## Error Handling

EdgeBase returns app-callback errors in the URL fragment, not the query string.
Let a supported SDK handler consume and scrub the callback. If you inspect a
raw redirect for diagnostics before handing it to the SDK, parse the fragment:

```typescript
// Raw diagnostic inspection only; then call handleOAuthCallback().
const params = new URLSearchParams(window.location.hash.slice(1));

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

Use this only when you intentionally want the callback to terminate on the server route. For browser and mobile apps, prefer passing an allowlisted callback URL so the app can resume on its own route or claimed HTTPS link.

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
