# @edgebase/react-native

EdgeBase SDK for React Native — **iOS, Android, and Web (React Native Web)** support.

> Shared client model with `@edgebase/web`, with React Native-specific storage, lifecycle, and OAuth wiring.

## Installation

```bash
npm install @edgebase/react-native @react-native-async-storage/async-storage react-native-webview
```

For iOS:
```bash
cd ios && pod install
```

## Quick Start

```typescript
import { createClient } from '@edgebase/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, AppState } from 'react-native';

const client = createClient('https://your-project.edgebase.fun', {
  storage: AsyncStorage,   // Refresh Token persistence
  linking: Linking,        // OAuth deep link support
  appState: AppState,      // Auto lifecycle management
});

// Auth
await client.auth.signUp({ email: 'user@test.com', password: 'pass123' });
await client.auth.signIn({ email: 'user@test.com', password: 'pass123' });
await client.auth.signOut();

client.auth.onAuthStateChange((user) => {
  console.log('Auth state:', user);
});

// CRUD
const posts = await client.db('shared').table('posts')
  .where('status', '==', 'published')
  .getList();
await client.db('shared').table('posts').insert({ title: 'Hello' });

// Storage
const bucket = client.storage.bucket('avatars');
await bucket.upload('me.jpg', file);
const url = bucket.getUrl('me.jpg');
```

## OAuth Sign-in (Deep Link)

```typescript
// 1. Configure deep link scheme in app.json / Info.plist / AndroidManifest.xml
// 2. Sign in with provider:
client.auth.signInWithOAuth('google', { redirectUrl: 'myapp://auth/callback' });

// 3. Handle callback in your navigation setup:
Linking.addEventListener('url', async ({ url }) => {
  const result = await client.auth.handleOAuthCallback(url);
  if (result) console.log('OAuth success:', result.user);
});
```

## Captcha (Turnstile)

```tsx
import { TurnstileWebView, useTurnstile } from '@edgebase/react-native';
import { WebView } from 'react-native-webview';

function SignUpScreen() {
  const captcha = useTurnstile({ baseUrl: 'https://your-project.edgebase.fun', action: 'signup' });

  return (
    <>
      {captcha.siteKey && (
        <TurnstileWebView
          siteKey={captcha.siteKey}
          action="signup"
          appearance="always"
          testID="signup-captcha"
          WebViewComponent={WebView}
          onToken={captcha.onToken}
          onError={captcha.onError}
          onInteractive={captcha.onInteractive}
        />
      )}
      <Button title="Sign Up" onPress={() => client.auth.signUp({ email, password, captchaToken: captcha.token ?? undefined })} />
    </>
  );
}
```

## Push Notifications

```typescript
import messaging from '@react-native-firebase/messaging';

// Set token provider (once, at app startup)
client.push.setTokenProvider(async () => ({
  token: await messaging().getToken(),
  platform: 'android', // or 'ios'
}));

// Register device
await client.push.register();

// Listen for foreground messages
client.push.onMessage((msg) => {
  console.log('Foreground push:', msg.title, msg.body);
});

// Bridge FCM messages to SDK
messaging().onMessage(async (remote) => {
  client.push._dispatchForegroundMessage({
    title: remote.notification?.title,
    body: remote.notification?.body,
    data: remote.data,
  });
});
```

## Lifecycle Management

Lifecycle management starts automatically when `appState` is provided to `createClient`.

- **Background / Inactive**: WebSocket disconnected → saves battery
- **Foreground**: Token refreshed + WebSocket reconnected

## Platform Differences vs `@edgebase/web`

| Feature | Web | React Native |
|---|---|---|
| Token Storage | `localStorage` | `AsyncStorage` (async) |
| OAuth Redirect | `window.location.href` | `Linking.openURL()` |
| Multi-tab sync | `BroadcastChannel` | N/A (single process) |
| Captcha | Inline JS DOM | `react-native-webview` |
| Push | Web Push / VAPID | FCM / APNs via provider |
| Lifecycle | `visibilitychange` | `AppState` |

## Database Live

Use `db().table().onSnapshot()` for database live subscriptions:

```typescript
client
  .db('shared')
  .table('posts')
  .onSnapshot((change) => {
    console.log(change.changeType, change.data);
  });
```
