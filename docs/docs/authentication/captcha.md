---
sidebar_position: 20
---

# CAPTCHA (bot protection)

EdgeBase can protect signup, sign-in, password recovery, magic-link, phone,
OAuth-start, and selected HTTP Function requests with Cloudflare Turnstile.
The server always validates the token with Cloudflare; a client-side success
callback is never treated as proof by itself.

## Production quick start

For a Cloudflare deployment, declare the public server origin and enable
managed provisioning:

```typescript
export default defineConfig({
  release: true,
  baseUrl: 'https://api.example.com',
  cors: { origin: ['https://app.example.com'] },
  captcha: true,
});
```

Then deploy with `npx edgebase deploy`. Managed CAPTCHA deploys take an atomic,
expiring lease in the project's remote `CONTROL_DB`, so two terminals or CI
runs cannot mutate the same widget concurrently. On a hostname change, the CLI
keeps the live widget's existing site key and secret, stages the exact
`old∪new` hostname set, publishes the Worker with the desired exact hostname
policy, verifies that its reported Worker version alone serves 100% of traffic,
and only then reduces the widget to the desired set. The CLI renews the lease
after Wrangler returns and again immediately before that exact update. It also
checks the active Worker version and latest widget immediately before and after
every staging update. If an out-of-band deploy won the race, the CLI reads the
replacement version's immutable `CAPTCHA_HOSTNAMES` binding, restores every
hostname required by the live versions, and aborts its own deploy. Cached clients therefore
continue using the same key throughout the transition. A failed publish or
stale finalizer leaves the safe union in place for the next deploy to finish.
The first live deploy creates one stable `<worker-name>-captcha` widget; later
deploys never create a per-change widget. A live version-named widget left by a
pre-lease CLI is renamed in place without changing its site key/secret, and old
unreferenced widgets are removed only after recent-version, age-grace, and
rollback checks.

The Cloudflare token used for managed CAPTCHA needs Turnstile Edit, D1 Write,
and Worker read/write access. Lease and Management API requests are
time/response bounded. A crashed lease expires after 20 minutes; a competing
deploy fails with an actionable retry message instead of waiting indefinitely.
The lease coordinates `edgebase deploy` processes; do not edit the managed
widget or publish the same Worker manually while a managed deploy is running.
Cloudflare's widget API has no conditional-update primitive, so arbitrary
non-cooperating writers cannot be made fully atomic. The pre/post checks above
protect the currently live Worker when such a race is observed, but concurrent
manual operation remains outside the managed zero-downtime contract.

Turnstile supports at most ten configured hostnames. EdgeBase resolves them
from:

- `captcha.hostnames`
- `baseUrl`
- explicit CORS origins
- authentication redirect allowlists
- passkey origins

Wildcards and Turnstile's “Any Hostname” mode are not used. Keep the resolved
set at ten hostnames or fewer. During a change, `old∪new` must also fit within
Turnstile's ten-hostname limit. If it does not, the CLI aborts before mutation;
deploy an intermediate set of at most ten, then finish the transition.

## Manual and self-hosted configuration

For Docker or another self-hosted runtime, keep the public key and exact
hostnames in config, but inject the secret at runtime:

```typescript
export default defineConfig({
  release: true,
  baseUrl: 'https://api.example.com',
  captcha: {
    siteKey: '0x4AAAAAAA...',
    hostnames: ['api.example.com', 'app.example.com'],
    failMode: 'closed',
    siteverifyTimeout: 3000,
  },
});
```

```bash
TURNSTILE_SECRET='0x4AAAAAAA...' edgebase start
```

The runtime also accepts `CAPTCHA_SITE_KEY` and a comma-separated
`CAPTCHA_HOSTNAMES` value. Runtime environment values take precedence over
config. For manual operation, make hostname changes on the same Turnstile
widget so the site key/secret pair remains stable, or coordinate the client and
server cutover yourself. EdgeBase does not retry one single-use token against
multiple widget secrets because Cloudflare does not document that a failed
wrong-secret validation leaves the token unconsumed.

`captcha.secretKey` exists only as a local-development convenience. A release
config containing it is rejected, and release app bundles refuse to include
it. Never commit the Turnstile secret or place it in client code.

### Release invariants

When `release: true` and CAPTCHA is enabled, EdgeBase requires:

- a non-empty site key and runtime `TURNSTILE_SECRET`;
- at least one exact hostname and at most ten resolved hostnames;
- `failMode: 'closed'` (the default in release mode);
- an integer `siteverifyTimeout` from 250 through 30,000 milliseconds.

An incomplete deployed runtime returns an explicit configuration error. It does
not silently disable CAPTCHA. `failMode: 'open'` is accepted only when the
runtime is explicitly the CLI-owned `local-development` runtime; Cloudflare and
self-hosted deployments reject it even when `release` is false.

## Request flow and validation

```text
request → CORS → rate limit → CAPTCHA verification → handler
```

The server enforces all of the following:

- token length is at most 2,048 characters;
- Turnstile `success` must be the boolean `true`;
- the returned `action` must exactly match the protected operation;
- the returned hostname must be in the exact configured allowlist;
- the client IP sent to Siteverify comes only from a trusted runtime source;
- Siteverify redirects are not followed, responses are size-bounded, and
  requests use the configured timeout;
- tokens retain Cloudflare's single-use and expiry semantics.

Only OAuth browser navigation accepts `captcha_token` in the query string.
Other auth operations use their bounded JSON field, and protected Functions use
`X-EdgeBase-Captcha-Token`; arbitrary query tokens are rejected to keep them out
of URLs, access logs, browser history, and referrers.

A valid scoped Service Key bypasses CAPTCHA for server-to-server automation.
An arbitrary header does not bypass it.

## Protected operations

| Operation | Turnstile action |
| --- | --- |
| `POST /auth/signup` | `signup` |
| `POST /auth/signin` | `signin` |
| `POST /auth/signin/anonymous` | `anonymous` |
| `POST /auth/request-password-reset` | `password-reset` |
| `POST /auth/signin/magic-link` | `magic-link` |
| `POST /auth/signin/phone` | `phone` |
| `GET /auth/oauth/:provider` | `oauth` |
| HTTP Function with `captcha: true` | `function` |

Refresh, sign-out, and already-authenticated account-management operations do
not mint a new CAPTCHA token.

## Client integration

Browser SDKs render Turnstile on the application's actual browser origin.
Native SDKs load the app-owned HTTPS endpoint
`/api/captcha/challenge` in the same persistent WebView used for the challenge.
The native bridge uses a cryptographically random per-request channel and a
versioned, size-bounded JSON message. A native SDK must not render an inline
HTML template with a fabricated `challenges.cloudflare.com` base URL.

Supported high-level auth methods fetch the public site key and acquire a token
when their platform adapter is available. You can always provide a manually
acquired token:

```typescript
await client.auth.signUp({
  email: 'user@example.com',
  password: 'correct-horse-battery-staple',
  captchaToken,
});
```

The Web SDK caches positive and explicit-disabled CAPTCHA config for at most
five minutes. If an automatically acquired token receives the server's
CAPTCHA-specific `403`, it invalidates the cache, fetches the current site key,
acquires a fresh token, and retries that auth request exactly once. It never
replays a token supplied by the caller. A browser-side Turnstile
`challenge_error` also refreshes the site key and retries token acquisition
once. Script loading, rendering, timeout, and cancellation failures throw a
`TurnstileError` with a stable `reason`; they are never converted into a
missing token. React Native applies the same bounded
config cache and invalidates it on a CAPTCHA-specific failure, but the token is
owned by the WebView/UI flow: reset the hook to fetch the new key and submit the
new token. React Native does not replay the failed request automatically.

OAuth start URLs are a special case: acquire a token first and pass it to the
SDK's OAuth-start method. Do not append an unbounded token to a URL yourself.
The SDK encodes it as the dedicated `captcha_token` query parameter. Because
the response occurs through browser/app navigation, OAuth start is not an
automatically replayed HTTP mutation; restart it with a fresh token if the
navigation reports a CAPTCHA failure.

### Runtime requirements

| Runtime | CAPTCHA host |
| --- | --- |
| `@edge-base/web`, Kotlin JS, Flutter Web | browser DOM |
| `@edge-base/react-native` | `react-native-webview` and an app-owned HTTPS challenge URL |
| Swift / Kotlin Apple | `WKWebView` on the main UI dispatcher |
| Kotlin Android / Java Android | system `WebView` and a current Activity for an interactive challenge |
| Flutter native | `flutter_inappwebview` |
| Unity | built-in Android/iOS bridge, WebGL browser bridge, or a supported desktop WebView adapter |
| Unreal | `SWebBrowser` on supported Unreal targets |

Headless/server JVM targets do not provide an interactive CAPTCHA UI. Supply a
token from a client or use a properly scoped Service Key for trusted backend
work. Device and engine builds must include their documented WebView module or
plugin; missing UI integration fails closed at the protected endpoint.

### Custom Unity WebView

Native and desktop Unity factories receive a hosted challenge URL and its
expected channel:

```csharp
TurnstileProvider.SetWebViewFactory(async (challengeUrl, channel) => {
    // Load challengeUrl in one persistent WebView.
    // Accept only JSON v1 messages bound to channel.
    return token;
});
```

WebGL uses the browser-origin adapter and receives the public site key and
action internally.

## CAPTCHA-protected Functions

Enable protection on a function:

```typescript
export default defineFunction({
  trigger: { type: 'http' },
  captcha: true,
  handler: async (context) => ({ ok: true }),
});
```

With the JavaScript core SDK, pass the token as an invocation option:

```typescript
await client.functions.call('submit-form', {
  method: 'POST',
  body: payload,
  captchaToken,
});
```

The SDK sends it only in `X-EdgeBase-Captcha-Token`. It deliberately disables
automatic network, 429, and 401 replay for this request: after bytes leave the
client, it is impossible to know whether the single-use token and Function side
effect were already consumed. On failure, reconcile any idempotency key or
operation status, acquire a new token, and retry explicitly. Do not place
Function CAPTCHA tokens in arbitrary query parameters or the function body.

## Errors and retry behavior

| Status | Meaning | Client action |
| --- | --- | --- |
| `403` | token missing, invalid, expired, already used, wrong action, or wrong hostname | reset the widget and acquire a new token |
| `500` | release CAPTCHA runtime is incomplete or invalid | fix deployment configuration; do not retry as an end user |
| `503` | Siteverify is temporarily unavailable in fail-closed mode | keep the user input and retry later with a newly acquired token |

Turnstile tokens are single-use. Never persist them as session credentials.

## Local development and tests

For ordinary unit tests, omit CAPTCHA or set `captcha: false`. For integration
tests, use Cloudflare's published test keys with synthetic users and configure
the exact local hostname. `edgebase dev` permits an HTTP loopback challenge
only when the direct peer is loopback and the runtime is explicitly in local
development mode; deployed and release runtimes require HTTPS.

`GET /api/config` exposes only `{ captcha: { siteKey } }`. The secret and
hostname policy are never returned to clients. If the response contains
`captcha: null`, either CAPTCHA is disabled or a non-release local runtime has
no complete CAPTCHA configuration.
