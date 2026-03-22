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
import { createClient } from '@edge-base/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Linking } from 'react-native';

const client = createClient('https://your-project.edgebase.fun', {
  storage: AsyncStorage,
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

### OAuth with deep links

```ts
client.auth.signInWithOAuth('google', {
  redirectUrl: 'myapp://auth/callback',
});

Linking.addEventListener('url', async ({ url }) => {
  await client.auth.handleOAuthCallback(url);
});
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
import { TurnstileWebView, useTurnstile } from '@edge-base/react-native';

const captcha = useTurnstile({
  baseUrl: 'https://your-project.edgebase.fun',
  action: 'signup',
});

<TurnstileWebView
  siteKey={captcha.siteKey!}
  WebViewComponent={WebView}
  onToken={captcha.onToken}
/>;
```

## Hard Rules

- `createClient(url, options)` requires `options.storage`
- `options.linking` is needed for OAuth deep-link flows
- `options.appState` is optional, but recommended for lifecycle handling
- `client.db(namespace, instanceId?)` takes the instance id positionally
- `client.auth.signInWithOAuth()` returns `{ url }` and can open the URL through the provided Linking adapter
- `client.auth.handleOAuthCallback(url)` resolves the auth result from the callback URL
- `client.push.setTokenProvider()` must be called before `client.push.register()`
- `client.push.onMessage()` and `client.push.onMessageOpenedApp()` return unsubscribe functions
- `TurnstileWebView` requires an injected `WebViewComponent`

## Common Mistakes

- do not omit `storage`; it is required
- do not assume browser redirects for OAuth; React Native uses deep links
- do not call `push.register()` before configuring a token provider
- do not assume `react-native-webview` is available unless you install it
- do not assume `app` or `shared` are reserved namespace names; they are examples from project config
- if you need browser-only code, use `@edge-base/web` instead

## Quick Reference

```text
createClient(url, { storage, linking?, appState?, databaseLive?, schema? }) -> ClientEdgeBase
client.db(namespace, id?)                                                    -> DbRef
client.room(namespace, roomId, options?)                                     -> RoomClient
client.setLocale(locale)                                                     -> void
client.getLocale()                                                           -> string | undefined
client.push.setTokenProvider(provider)                                       -> void
client.push.register(options?)                                               -> Promise<void>
client.destroy()                                                             -> void
```
