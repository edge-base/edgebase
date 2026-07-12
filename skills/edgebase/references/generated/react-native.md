<!-- Generated from packages/sdk/react-native/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase React Native SDK

Use this file as a quick-reference contract for AI coding assistants working with `@edge-base/react-native`.

## Package Boundary

Use `@edge-base/react-native` for React Native apps on iOS, Android, and React Native Web.

Do not assume browser-only APIs like `localStorage`, `window.location`, or DOM-based captcha widgets. For browser apps use `@edge-base/web`.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/react-native/README.md
- Quickstart: https://edgebase.fun/docs/getting-started/quickstart
- Authentication: https://edgebase.fun/docs/authentication
- Database client SDK: https://edgebase.fun/docs/database/client-sdk
- Room client SDK: https://edgebase.fun/docs/room/client-sdk
- Push client SDK: https://edgebase.fun/docs/push/client-sdk

## Canonical Examples

### Create a client

```ts
import 'react-native-get-random-values';
import { createClient } from '@edge-base/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { AppState, Linking } from 'react-native';

const secureStorage = {
  async getItem(key: string) {
    const value = await Keychain.getGenericPassword({ service: key });
    return value ? value.password : null;
  },
  async setItem(key: string, value: string) {
    await Keychain.setGenericPassword('edgebase', value, { service: key });
  },
  async removeItem(key: string) {
    await Keychain.resetGenericPassword({ service: key });
  },
};

const client = createClient('https://your-project.edgebase.fun', {
  storage: AsyncStorage,
  secureStorage,
  linking: Linking,
  appState: AppState,
});
```

### Sign in and query data

```ts
await client.auth.signIn({
  email: 'june@example.com',
  password: 'pass1234',
});

const posts = await client
  .db('app')
  .table('posts')
  .where('published', '==', true)
  .getList();
```

### OAuth with claimed HTTPS links

```ts
await client.auth.signInWithOAuth('google', {
  redirectUrl: 'https://app.example.com/auth/callback',
});

Linking.addEventListener('url', async ({ url }) => {
  await client.auth.handleOAuthCallback(url);
});

await client.auth.handleInitialOAuthCallback();
```

### Register push notifications

```ts
client.push.setTokenProvider(async () => ({
  token: await messaging().getToken(),
  platform: 'ios',
}));

await client.push.register();
```

### Turnstile

```tsx
import { WebView } from 'react-native-webview';
import { useTurnstile } from '@edge-base/react-native';

const captcha = useTurnstile(client.turnstileOptions({
  action: 'signup',
  WebViewComponent: WebView,
}));

{captcha.webView}
```

## Hard Rules

- `createClient(url, options)` requires `options.storage` and, by default,
  Keychain/Keystore-backed `options.secureStorage`
- `allowInsecureAuthStorageForDevelopment: true` is an explicit local-dev-only
  escape hatch and must never ship
- `options.linking` is needed for OAuth callback flows
- `options.appState` is optional, but recommended for lifecycle handling
- auth and push persistence is isolated by `authNamespace`, or by normalized
  base URL when no namespace is supplied; legacy global refresh keys are not imported
- `client.db(namespace, instanceId?)` takes the instance id positionally
- `await client.auth.signInWithOAuth()` persists a one-shot nonce, returns `{ url }`, and can open the URL through the provided Linking adapter
- `client.auth.handleOAuthCallback(url)` consumes that nonce and atomically
  exchanges the five-minute callback ticket at `/api/auth/oauth/exchange`, or
  completes account linking at authenticated `/api/auth/oauth/complete/link`;
  bearer credentials never transit the callback URL
- `client.auth.handleInitialOAuthCallback()` handles `Linking.getInitialURL()`
  when OAuth launches a terminated app
- release OAuth `redirectUrl` must be a claimed HTTPS Universal Link / Android
  App Link listed in `auth.allowedRedirectUrls`; custom schemes are forbidden
- `client.push.setTokenProvider()` must be called before `client.push.register()`
- `client.push.onMessage()` and `client.push.onMessageOpenedApp()` return unsubscribe functions
- `TurnstileWebView` requires an injected `WebViewComponent`

## Common Mistakes

- do not omit `storage` or production `secureStorage`
- do not use AsyncStorage for refresh tokens or OAuth callback authority
- do not use a custom-scheme OAuth callback; use a claimed HTTPS link
- do not call `push.register()` before configuring a token provider
- do not assume `react-native-webview` is available unless you install it
- do not assume `app` or `shared` are reserved namespace names; they are examples from project config
- if you need browser-only code, use `@edge-base/web` instead

## Quick Reference

```text
createClient(url, { storage, secureStorage, allowInsecureAuthStorageForDevelopment?, authNamespace?, secureRandom?, linking?, appState?, databaseLive?, schema? }) -> ClientEdgeBase
client.db(namespace, id?)                                                    -> DbRef
client.room(namespace, roomId, options?)                                     -> RoomClient
client.setLocale(locale)                                                     -> void
client.getLocale()                                                           -> string | undefined
client.push.setTokenProvider(provider)                                       -> void
client.push.register(options?)                                               -> Promise<void>
client.turnstileOptions({ action?, secureCrypto?, getRandomValues?, WebViewComponent? }) -> UseTurnstileOptions
client.destroy()                                                             -> void

client.auth.currentUser                                                      -> TokenUser | null (property)
client.auth.signInWithOAuth({ provider, redirectUrl, captchaToken? })         -> Promise<{url}>
client.auth.signInWithOAuth(provider, { redirectUrl, captchaToken? })         -> Promise<{url}>
client.auth.handleOAuthCallback(url)                                          -> Promise<AuthResult | null>
client.auth.handleInitialOAuthCallback()                                      -> Promise<AuthResult | null>
client.auth.linkWithOAuth({ provider, redirectUrl })                          -> Promise<{redirectUrl}>
client.auth.linkWithOAuth(provider, { redirectUrl })                          -> Promise<{redirectUrl}>
client.auth.linkWithPhone({ phone })                                          -> Promise<void>
client.auth.verifyLinkPhone({ phone, code })                                  -> Promise<AuthResult | void>
client.auth.signOut()                                                         -> Promise<void>
```
