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

- `AsyncStorage` token persistence
- deep-link based OAuth callbacks
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
  Presence, signals, state, and media-ready room flows
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
npm install @edge-base/react-native @react-native-async-storage/async-storage
```

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
import { createClient } from '@edge-base/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Linking } from 'react-native';

const client = createClient('https://your-project.edgebase.fun', {
  storage: AsyncStorage,
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

## OAuth With Deep Links

```ts
client.auth.signInWithOAuth('google', {
  redirectUrl: 'myapp://auth/callback',
});

Linking.addEventListener('url', async ({ url }) => {
  const result = await client.auth.handleOAuthCallback(url);
  if (result) {
    console.log('OAuth success:', result.user);
  }
});
```

In React Native, the app is responsible for registering the deep link scheme in the platform configuration.

## Turnstile Captcha

```tsx
import { Button } from 'react-native';
import { WebView } from 'react-native-webview';
import { TurnstileWebView, useTurnstile } from '@edge-base/react-native';

function SignUpScreen() {
  const captcha = useTurnstile({
    baseUrl: 'https://your-project.edgebase.fun',
    action: 'signup',
  });

  return (
    <>
      {captcha.siteKey && (
        <TurnstileWebView
          siteKey={captcha.siteKey}
          action="signup"
          WebViewComponent={WebView}
          onToken={captcha.onToken}
          onError={captcha.onError}
          onInteractive={captcha.onInteractive}
        />
      )}
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

## Room Media Transports

React Native now exposes the same room media surface as the web SDK. Prefer `room.media.connect(...)` for app code and drop down to `room.media.transport(...)` only when you need manual transport control.

```ts
const room = client.room('calls', 'demo');
await room.join();

const media = await room.media.connect({
  candidates: [
    {
      label: 'cloudflare_realtimekit',
      options: { provider: 'cloudflare_realtimekit' },
    },
  ],
  connectPayload: {
    name: 'June',
    customParticipantId: 'mobile-june',
  },
});

await media.transport.enableAudio();
await media.transport.enableVideo();
```

Available providers:

- `cloudflare_realtimekit`
  Uses Cloudflare RealtimeKit for managed media sessions
- `p2p`
  Uses direct peer-to-peer media with signaling through `room.signals`

Install the matching optional peer dependencies for the transport you use:

```bash
npm install @cloudflare/realtimekit-react-native
npm install @cloudflare/react-native-webrtc
```

Practical integration notes from the current host-app smoke matrix:

- `cloudflare_realtimekit` currently expects React Native `0.77+`
- iOS needs the usual `cd ios && pod install`
- Android apps using `@cloudflare/realtimekit-react-native` need a `blob_provider_authority` string resource
- current host-app smoke builds succeeded on both iOS simulator and Android debug

```xml
<string name="blob_provider_authority">${applicationId}.blobs</string>
```

For setup details and provider tradeoffs, see the room media docs:

- [Room Media Overview](https://edgebase.fun/docs/room/media)
- [Room Media Setup](https://edgebase.fun/docs/room/media-setup)

## Platform Differences vs `@edge-base/web`

| Feature | Web | React Native |
| --- | --- | --- |
| Token storage | `localStorage` | `AsyncStorage` |
| OAuth redirect | browser redirect | `Linking.openURL()` + deep-link callback |
| Lifecycle | document visibility | `AppState` |
| Captcha | DOM-based widget | `react-native-webview` |
| Push | web push | native token provider integration |

## License

MIT
