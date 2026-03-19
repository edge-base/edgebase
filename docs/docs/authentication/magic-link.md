---
sidebar_position: 2
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Magic Link

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Passwordless email login — users click a link to sign in, no password required.

:::tip Captcha Protection
When [captcha is enabled](/docs/authentication/captcha), the Magic Link endpoint is automatically protected by Cloudflare Turnstile. All client SDKs handle token acquisition transparently — no code changes needed.
:::

## How It Works

1. User enters their email address
2. Server sends an email with a one-time magic link
3. User clicks the link
4. Your app extracts the token from the URL and calls `verifyMagicLink`
5. User is signed in with full session tokens

:::info Auto-Create
When `autoCreate` is enabled (default), users who don't have an account are automatically registered when they request a magic link. The created account has no password and is marked as verified.
:::

## Configuration

Enable magic link in your `edgebase.config.ts`:

```typescript
export default {
  auth: {
    magicLink: {
      enabled: true,       // default: false
      autoCreate: true,    // auto-register unknown emails (default: true)
      tokenTTL: '15m',     // link expiration (default: '15m')
    },
  },
  email: {
    provider: 'resend',
    apiKey: 'your-api-key',
    from: 'noreply@yourapp.com',
    // Optional fallback URL template ({token} placeholder)
    // Per-request redirectUrl overrides this.
    magicLinkUrl: 'https://yourapp.com/auth/magic?token={token}',
  },
} satisfies EdgeBaseConfig;
```

## Send Magic Link

Request a magic link email for a user:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await client.auth.signInWithMagicLink({
  email: 'user@example.com',
  redirectUrl: `${window.location.origin}/auth/magic`,
  state: 'checkout',
});
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
await client.auth.signInWithMagicLink(email: 'user@example.com');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
try await client.auth.signInWithMagicLink(email: "user@example.com")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
client.auth.signInWithMagicLink(email = "user@example.com")
```

</TabItem>

<TabItem value="java" label="Java">

```java
client.auth().signInWithMagicLink("user@example.com");
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
await client.Auth.SignInWithMagicLinkAsync("user@example.com");
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
client.auth().signInWithMagicLink("user@example.com");
```

</TabItem>
</Tabs>

The server always responds `200 OK` regardless of whether the email exists. This prevents email enumeration attacks.

### Per-Request Redirects

On the Web SDK, `signInWithMagicLink()` also accepts:

- `redirectUrl`
- `state`

If you pass them, EdgeBase uses that redirect for this request instead of the static `email.magicLinkUrl` template. The clicked link includes:

- `token`
- `type=magic-link`
- `state` if provided

If your project sets `auth.allowedRedirectUrls`, the redirect must match that allowlist.

## Verify Magic Link

After the user clicks the link, extract the token from the URL and verify it:

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// Extract token from URL (e.g., https://yourapp.com/auth/magic?token=abc123)
const params = new URLSearchParams(window.location.search);
const token = params.get('token');
const state = params.get('state');

const { user, accessToken, refreshToken } = await client.auth.verifyMagicLink(token);
console.log('Signed in as:', user.email);
console.log('Resume flow:', state);
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
// Extract token from deep link
final token = Uri.parse(deepLink).queryParameters['token']!;

final result = await client.auth.verifyMagicLink(token: token);
print('Signed in as: ${result.user.email}');
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
// Extract token from URL
let token = URLComponents(url: url, resolvingAgainstBaseURL: false)?
    .queryItems?.first(where: { $0.name == "token" })?.value ?? ""

let result = try await client.auth.verifyMagicLink(token: token)
print("Signed in as: \(result.user.email)")
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
// Extract token from deep link
val token = Uri.parse(deepLink).getQueryParameter("token") ?: ""

val result = client.auth.verifyMagicLink(token = token)
println("Signed in as: ${result.user.email}")
```

</TabItem>

<TabItem value="java" label="Java">

```java
// Extract token from deep link URL
String token = Uri.parse(deepLink).getQueryParameter("token");

Map<String, Object> result = client.auth().verifyMagicLink(token);
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
// Extract token from URL
var token = HttpUtility.ParseQueryString(uri.Query)["token"];

var result = await client.Auth.VerifyMagicLinkAsync(token);
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
// Extract token from URL
auto result = client.auth().verifyMagicLink(token);
```

</TabItem>
</Tabs>

## Full Example (React)

```tsx
import { useEffect, useState } from 'react';
import { client } from './edgebase';

function MagicLinkLogin() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await client.auth.signInWithMagicLink({
      email,
      redirectUrl: `${window.location.origin}/auth/magic`,
      state: 'dashboard',
    });
    setSent(true);
  };

  if (sent) {
    return <p>Check your email for the sign-in link!</p>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
      />
      <button type="submit">Send Magic Link</button>
    </form>
  );
}

// Callback page — handles the magic link redirect
function MagicLinkCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const state = params.get('state');
    if (token) {
      client.auth.verifyMagicLink(token).then(({ user }) => {
        window.location.href = state === 'dashboard' ? '/dashboard' : '/';
      });
    }
  }, []);

  return <p>Signing you in...</p>;
}
```

## Security

- **Single-use tokens** — Each token can only be used once. After verification, the token is deleted.
- **Expiration** — Tokens expire after `tokenTTL` (default 15 minutes).
- **No email enumeration** — The server returns the same response whether or not the email exists.
- **Rate limiting** — Auth rate limits apply to prevent abuse.
- **Auth hooks** — `beforeSignIn` and `afterSignIn` hooks fire during magic link verification.
- **Redirect allowlist** — If `auth.allowedRedirectUrls` is set, only approved redirect URLs can be used for per-request links.

## Compatibility

Magic link works alongside other auth methods:

| Scenario | Behavior |
|----------|----------|
| Email/password user requests magic link | Works — signs in without password |
| Magic link auto-created user tries password sign-in | Fails — no password set (use magic link or set password via admin) |
| Magic link user links OAuth provider | Works — via [account linking](./account-linking) |

## REST API

### Send Magic Link

```
POST /api/auth/signin/magic-link
Content-Type: application/json

{ "email": "user@example.com" }
```

**Response:** `200 OK`

```json
{ "ok": true }
```

### Verify Magic Link

```
POST /api/auth/verify-magic-link
Content-Type: application/json

{ "token": "abc123..." }
```

**Response:** `200 OK`

```json
{
  "user": { "id": "...", "email": "user@example.com", "verified": true },
  "accessToken": "eyJ...",
  "refreshToken": "..."
}
```

**Error Responses:**

| Status | Condition |
|--------|-----------|
| 400 | Missing or invalid email / missing token |
| 400 | Token expired, invalid, or already used |
| 403 | `beforeSignIn` hook rejected the sign-in |
| 404 | Magic link authentication is not enabled |
