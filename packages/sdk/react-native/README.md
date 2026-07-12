<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

<h1 align="center">@edge-base/react-native</h1>

<p align="center">
  <b>React Native SDK for EdgeBase</b><br>
  Auth, database, realtime, rooms, storage, analytics, and push for iOS, Android, and React Native Web
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@edge-base/react-native"><img src="https://img.shields.io/npm/v/%40edge-base%2Freact-native?color=brightgreen" alt="npm"></a>&nbsp;
  <a href="https://edgebase.fun/docs/getting-started/quickstart"><img src="https://img.shields.io/badge/docs-mobile-blue" alt="Docs"></a>&nbsp;
  <a href="https://github.com/edge-base/edgebase/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  iOS · Android · React Native Web · Deep links · AppState lifecycle
</p>

<p align="center">
  <a href="https://edgebase.fun/docs/getting-started/quickstart"><b>Quickstart</b></a> ·
  <a href="https://edgebase.fun/docs/authentication"><b>Authentication</b></a> ·
  <a href="https://edgebase.fun/docs/database/client-sdk"><b>Database Client SDK</b></a> ·
  <a href="https://edgebase.fun/docs/room/client-sdk"><b>Room Client SDK</b></a> ·
  <a href="https://edgebase.fun/docs/push/client-sdk"><b>Push Client SDK</b></a>
</p>

---

`@edge-base/react-native` brings the EdgeBase client model to React Native environments.

It keeps the familiar browser SDK shape while adding the pieces mobile apps need:

- `AsyncStorage` for non-secret app caches plus required Keychain/Keystore auth storage
- claimed HTTPS Universal Link / Android App Link OAuth callbacks
- `AppState` lifecycle handling
- React Native friendly push registration
- Turnstile support through `react-native-webview`

If you are building a browser-only app, use [`@edge-base/web`](https://www.npmjs.com/package/@edge-base/web) instead.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

> Beta: the package is already usable, but some APIs may still evolve before general availability.

## Documentation Map

- [Quickstart](https://edgebase.fun/docs/getting-started/quickstart)
  Project creation and local development
- [Authentication](https://edgebase.fun/docs/authentication)
  Email/password, OAuth, MFA, sessions, captcha
- [Database Client SDK](https://edgebase.fun/docs/database/client-sdk)
  Query and mutation patterns that also apply on React Native
- [Room Client SDK](https://edgebase.fun/docs/room/client-sdk)
  Presence, signals, state, and room session flows
- [Push Client SDK](https://edgebase.fun/docs/push/client-sdk)
  General client push concepts

## For AI Coding Assistants

This package ships with an `llms.txt` file for AI-assisted React Native integration.

You can find it:

- after install: `node_modules/@edge-base/react-native/llms.txt`
- in the repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/react-native/llms.txt)

Use it when you want an agent to:

- set up `createClient()` with the right React Native adapters
- handle deep-link OAuth callbacks correctly
- wire push registration without guessing native token APIs
- avoid accidentally using browser-only assumptions like `localStorage`

## Installation

```bash
npm install @edge-base/react-native @react-native-async-storage/async-storage react-native-keychain react-native-get-random-values
```

`react-native-keychain` is one compatible secure-storage implementation; you
may supply a different Keychain/Keystore-backed adapter with the same async
`getItem`/`setItem`/`removeItem` shape. The random-values polyfill is needed on
Hermes versions that do not provide `crypto.getRandomValues`; alternatively
pass a `secureRandom(length)` provider.

If you want Turnstile-based captcha, also install:

```bash
npm install react-native-webview
```

For iOS, remember to install pods:

```bash
cd ios && pod install
```

## Quick Start

```ts
import 'react-native-get-random-values';
import { createClient } from '@edge-base/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { AppState, Linking } from 'react-native';

const secureStorage = {
  async getItem(key: string) {
    const credentials = await Keychain.getGenericPassword({ service: key });
    return credentials ? credentials.password : null;
  },
  async setItem(key: string, value: string) {
    await Keychain.setGenericPassword('edgebase', value, { service: key });
  },
  async removeItem(key: string) {
    await Keychain.resetGenericPassword({ service: key });
  },
};

const client = createClient('https://your-project.edgebase.fun', {
  storage: AsyncStorage,       // non-secret push/device caches
  secureStorage,               // refresh token, auth epoch, OAuth state
  linking: Linking,
  appState: AppState,
});

await client.auth.signIn({
  email: 'june@example.com',
  password: 'pass1234',
});

const posts = await client
  .db('app')
  .table('posts')
  .where('published', '==', true)
  .getList();

console.log(posts.items);
```

## Core API

Once you create a client, these are the main surfaces you will use:

- `client.auth`
  Mobile-friendly auth with deep-link OAuth support
- `client.db(namespace, id?)`
  Query and mutate data
- `client.storage`
  Upload files and resolve URLs
- `client.functions`
  Call app functions
- `client.room(namespace, roomId, options?)`
  Join realtime rooms
- `client.push`
  Register device tokens and listen for app messages
- `client.analytics`
  Track client analytics

`secureStorage` is required. For local development only, you may omit it and
set `allowInsecureAuthStorageForDevelopment: true`; that deliberately stores
auth credentials in the ordinary `storage` adapter and must not ship in a
production build.

## OAuth With Claimed HTTPS Links

```ts
await client.auth.signInWithOAuth('google', {
  redirectUrl: 'https://app.example.com/auth/callback',
});

Linking.addEventListener('url', async ({ url }) => {
  const result = await client.auth.handleOAuthCallback(url);
  if (result) {
    console.log('OAuth success:', result.user);
  }
});

// A callback can launch an app that was not already running.
await client.auth.handleInitialOAuthCallback();
```

OAuth start persists a CSPRNG one-shot nonce in `secureStorage` before opening
the browser. `handleOAuthCallback()` accepts the server fragment, consumes that
nonce, and atomically exchanges the five-minute callback ticket with EdgeBase
before it stores the session. Bearer credentials never transit the claimed HTTPS
callback URL. Account linking uses the authenticated
`/api/auth/oauth/complete/link` endpoint and must still match the initiating
user and session. Unsolicited, mismatched, replayed, or sign-out-superseded
callbacks resolve to `null`.

Configure the callback host as an iOS Associated Domain and Android verified
App Link, and add the callback to the server's `auth.allowedRedirectUrls`.
Release mode accepts only HTTPS app callbacks. Do not use a custom URL scheme:
another installed app can claim it and steal the callback.

Credential keys, OAuth state, auth epochs, pending sign-out records, and push
caches are namespaced by `authNamespace` (or the normalized base URL by
default), so clients for different EdgeBase projects cannot restore one
another's session. If one app intentionally keeps multiple profiles for the
same server, give each client a distinct `authNamespace`. Pre-namespace global
refresh-token keys are not imported.

## Turnstile Captcha

```tsx
import { Button } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTurnstile } from '@edge-base/react-native';

function SignUpScreen() {
  // Binds this client's backend and secureRandom provider. The hook returns
  // the ready-to-mount hosted challenge after config and channel resolution.
  const captcha = useTurnstile(client.turnstileOptions({
    action: 'signup',
    WebViewComponent: WebView,
  }));

  return (
    <>
      {captcha.webView}
      <Button
        title="Sign Up"
        onPress={() =>
          void client.auth.signUp({
            email: 'june@example.com',
            password: 'pass1234',
            captchaToken: captcha.token ?? undefined,
          })
        }
      />
    </>
  );
}
```

## Push Notifications

```ts
import messaging from '@react-native-firebase/messaging';

client.push.setTokenProvider(async () => ({
  token: await messaging().getToken(),
  platform: 'android',
}));

await client.push.register();

const unsubscribe = client.push.onMessage((message) => {
  console.log(message.title, message.body);
});
```

You bridge native push providers into the SDK. The SDK does not hard-depend on Firebase Messaging.

## Lifecycle Management

When you pass `appState` to `createClient()`, the SDK automatically coordinates mobile lifecycle behavior:

- background/inactive: disconnect realtime transports to reduce battery and network use
- foreground: refresh auth state and reconnect realtime transports

## Platform Differences vs `@edge-base/web`

| Feature | Web | React Native |
| --- | --- | --- |
| Token storage | Body mode: `localStorage`; recommended cookie mode: EdgeBase HttpOnly cookie | Keychain/Keystore `secureStorage` (AsyncStorage only for non-secret caches) |
| OAuth redirect | browser redirect + bound fragment handler | `Linking.openURL()` + claimed HTTPS Universal/App Link callback |
| Lifecycle | document visibility | `AppState` |
| Captcha | DOM-based widget | `react-native-webview` |
| Push | web push | native token provider integration |

## License

MIT
