---
sidebar_position: 3
title: Client SDK
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Client SDK

:::caution Alpha
This feature is in **alpha**. APIs and behavior may change without notice. Not recommended for production use.
:::

Push notification setup varies significantly per platform. Select your platform below for the complete integration guide.

All platforms follow the same pattern: **inject a token provider** → **register** → **handle messages**. The SDK automatically unregisters when the user signs out.

<Tabs groupId="push-platform">
<TabItem value="web" label="Web (JS/TS)" default>

## Prerequisites

1. Complete the [Firebase setup](configuration.md) — register a Web app and get your VAPID key.
2. Install dependencies:

```bash
npm install firebase @edge-base/web
```

## Setup

### 1. Initialize Firebase

```typescript
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

const firebaseApp = initializeApp({
  apiKey: "...",
  authDomain: "...",
  projectId: "my-firebase-project",
  messagingSenderId: "...",
  appId: "...",
});

const messaging = getMessaging(firebaseApp);
```

### 2. Create a Service Worker

Create `firebase-messaging-sw.js` in your public root directory:

```javascript
// public/firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "...",
  authDomain: "...",
  projectId: "my-firebase-project",
  messagingSenderId: "...",
  appId: "...",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || 'New notification', {
    body: body || '',
    icon: '/icon.png',
    data: payload.data,
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      if (windowClients.length > 0) {
        windowClients[0].focus();
      } else {
        clients.openWindow('/');
      }
    })
  );
});
```

> The Service Worker must be served from your site's root path (e.g., `https://yoursite.com/firebase-messaging-sw.js`).

### 3. Set Token Provider

```typescript
import { createClient } from '@edge-base/web';

const client = createClient('https://my-app.edgebase.fun');

client.push.setTokenProvider(async () => {
  const token = await getToken(messaging, {
    vapidKey: 'YOUR_VAPID_KEY',
  });
  return token;
});
```

### 4. Register

```typescript
await client.push.register();

// With metadata
await client.push.register({ metadata: { theme: 'dark' } });
```

## Permission Handling

`register()` automatically requests permission if the user hasn't been asked yet. However, you should check and handle permission status explicitly for a better user experience.

**Check permission status:**

```typescript
const status = client.push.getPermissionStatus();
// 'granted' | 'denied' | 'notDetermined'
```

**Request permission manually (before register):**

```typescript
const result = await client.push.requestPermission();
if (result === 'granted') {
  await client.push.register();
} else {
  // Show a message explaining why notifications are useful
}
```

:::tip Best Practice
Avoid requesting permission on page load. Instead, show a pre-permission prompt (e.g., a banner or button) explaining why notifications are useful, and only call `register()` when the user opts in. Browsers may block the prompt entirely if triggered without a user gesture.
:::

:::warning Permission Denied
If the user has denied permission, `register()` returns silently without throwing an error. The browser will **not** show the permission prompt again — the user must manually re-enable notifications in browser settings. Use `getPermissionStatus()` to detect this and show appropriate UI guidance.
:::

## Handle Messages

**Foreground:**

```typescript
onMessage(messaging, (payload) => {
  console.log('Foreground message:', payload);
});

// Or listen via EdgeBase
client.push.onMessage((message) => {
  console.log('Push:', message.title, message.body);
});
```

**Notification Tap:**

```typescript
client.push.onMessageOpenedApp((message) => {
  const chatId = message.data?.chatId;
  if (chatId) {
    window.location.href = `/chat/${chatId}`;
  }
});
```

## Topic Subscription

Web topic subscriptions go through the EdgeBase server:

```typescript
await client.push.subscribeTopic('news');
await client.push.unsubscribeTopic('news');
```

## Unregister

```typescript
await client.push.unregister();
```

## Browser Support

Chrome 50+, Firefox 44+, Edge 17+, Safari 16+, Opera 42+

## API Reference

| Method | Description |
|---|---|
| `setTokenProvider(provider)` | Set FCM token acquisition function |
| `register({metadata?})` | Request permission, get token, register |
| `unregister(deviceId?)` | Unregister device |
| `subscribeTopic(topic)` | Subscribe to an FCM topic (server-side) |
| `unsubscribeTopic(topic)` | Unsubscribe from an FCM topic (server-side) |
| `onMessage(callback)` | Listen for foreground messages |
| `onMessageOpenedApp(callback)` | Listen for notification tap events |
| `getPermissionStatus()` | Returns `'granted'`, `'denied'`, or `'notDetermined'` |
| `requestPermission()` | Request notification permission |

</TabItem>
<TabItem value="flutter" label="Flutter">

## Prerequisites

1. Complete the [Firebase setup](configuration.md) (`google-services.json` for Android, `GoogleService-Info.plist` for iOS).
2. Add dependencies:

```yaml
dependencies:
  firebase_core: ^3.0.0
  firebase_messaging: ^15.0.0
  edgebase_flutter: ^0.1.4
```

3. Initialize Firebase:

```dart
import 'package:firebase_core/firebase_core.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  runApp(MyApp());
}
```

## Register

The Flutter SDK automatically acquires FCM tokens via `firebase_messaging`. Just call `register()`:

```dart
await client.push.register();

// With metadata
await client.push.register(metadata: {'userType': 'premium'});
```

## Permission Handling

`register()` automatically requests notification permission before acquiring the FCM token. If the user denies, registration exits silently.

**Check permission status:**

```dart
final status = await client.push.getPermissionStatus();
// 'granted' | 'denied' | 'notDetermined'
```

**Request permission manually:**

```dart
final result = await client.push.requestPermission();
if (result == 'granted') {
  await client.push.register();
} else {
  // Show in-app message about enabling notifications
}
```

:::info iOS Specifics
On iOS, once the user denies permission, the system will **not** show the prompt again. The user must go to **Settings > Notifications > Your App** to re-enable. Use `getPermissionStatus()` to detect `'denied'` and guide the user.
:::

## Handle Messages

**Foreground:**

```dart
client.push.onMessage((Map<String, dynamic> message) {
  final title = message['title'];
  final body = message['body'];
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text('$title: $body')),
  );
});
```

**Background Tap:**

```dart
client.push.onMessageOpenedApp((Map<String, dynamic> message) {
  final chatId = message['data']?['chatId'];
  if (chatId != null) {
    Navigator.pushNamed(context, '/chat', arguments: chatId);
  }
});
```

**Headless Background Handler:**

```dart
@pragma('vm:entry-point')
Future<void> _firebaseBackgroundHandler(RemoteMessage message) async {
  print('Background message: ${message.messageId}');
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  FirebaseMessaging.onBackgroundMessage(_firebaseBackgroundHandler);
  runApp(MyApp());
}
```

## Topic Subscription

Calls Firebase's `subscribeToTopic()` directly -- no server round-trip:

```dart
await client.push.subscribeTopic('news');
await client.push.unsubscribeTopic('news');
```

## Unregister

```dart
await client.push.unregister();
```

## iOS Notes

- **APNs Key required** -- Upload your APNs key (`.p8`) to the Firebase Console. See [Configuration](configuration.md).
- The `firebase_messaging` plugin handles APNs token swizzling automatically.

## API Reference

| Method | Description |
|---|---|
| `register({metadata?})` | Request permission, get token, register |
| `unregister([deviceId?])` | Unregister device |
| `onMessage(callback)` | Listen for foreground messages |
| `onMessageOpenedApp(callback)` | Listen for notification tap events |
| `subscribeTopic(topic)` | Subscribe to an FCM topic |
| `unsubscribeTopic(topic)` | Unsubscribe from an FCM topic |
| `getPermissionStatus()` | Returns `'granted'`, `'denied'`, or `'notDetermined'` |
| `requestPermission()` | Request notification permission |

</TabItem>
<TabItem value="rn" label="React Native">

## Prerequisites

1. Complete the [Firebase setup](configuration.md) for both iOS and Android.
2. Install Firebase Messaging:

```bash
npm install @react-native-firebase/app @react-native-firebase/messaging
```

3. Follow the [React Native Firebase setup guide](https://rnfirebase.io/) for native configuration.

## Setup

The React Native SDK uses a **provider injection** pattern.

### 1. Set Token Provider

```tsx
import messaging from '@react-native-firebase/messaging';
import { Platform } from 'react-native';

client.push.setTokenProvider(async () => ({
  token: await messaging().getToken(),
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
}));
```

### 2. Set Permission Provider (Optional)

The SDK has built-in permission handling using React Native's `PermissionsAndroid` for Android and auto-grant for iOS (where Firebase handles permission during token acquisition). For more control, you can override with a custom provider:

```tsx
// Optional — override built-in permission handling
client.push.setPermissionProvider({
  getPermissionStatus: async () => {
    const status = await messaging().hasPermission();
    if (status === messaging.AuthorizationStatus.AUTHORIZED) return 'granted';
    if (status === messaging.AuthorizationStatus.DENIED) return 'denied';
    return 'not-determined';
  },
  requestPermission: async () => {
    const status = await messaging().requestPermission();
    return status === messaging.AuthorizationStatus.AUTHORIZED ? 'granted' : 'denied';
  },
});
```

### 3. Set Topic Provider

```tsx
client.push.setTopicProvider({
  subscribeTopic: (topic) => messaging().subscribeToTopic(topic),
  unsubscribeTopic: (topic) => messaging().unsubscribeFromTopic(topic),
});
```

### 4. Register

```tsx
await client.push.register();
```

## Permission Handling

`register()` automatically requests permission before acquiring the token. On Android 13+, the SDK uses React Native's built-in `PermissionsAndroid` API. On iOS, Firebase handles permission during token acquisition. For explicit control, you can check and request manually:

**Check permission status:**

```tsx
const status = await client.push.getPermissionStatus();
// 'granted' | 'denied' | 'not-determined' | 'provisional'
```

**Request and register:**

```tsx
const status = await client.push.getPermissionStatus();

if (status === 'not-determined') {
  const result = await client.push.requestPermission();
  if (result === 'granted') {
    await client.push.register();
  } else {
    // Guide user to enable in settings
  }
} else if (status === 'granted') {
  await client.push.register();
} else {
  // 'denied' — show settings guidance
}
```

:::tip
`setPermissionProvider()` is optional. Without it, the SDK uses built-in defaults: `PermissionsAndroid` for Android 13+ and auto-grant for iOS. Use a custom provider when you need Firebase-specific status values like `'provisional'`.
:::

## Handle Messages

**Foreground:**

```tsx
useEffect(() => {
  const unsubFirebase = messaging().onMessage(async (remoteMessage) => {
    client.push._dispatchForegroundMessage({
      title: remoteMessage.notification?.title,
      body: remoteMessage.notification?.body,
      data: remoteMessage.data,
    });
  });

  const unsubEdgeBase = client.push.onMessage((message) => {
    console.log('Push received:', message.title);
  });

  return () => { unsubFirebase(); unsubEdgeBase(); };
}, []);
```

**Notification Tap:**

```tsx
useEffect(() => {
  messaging().onNotificationOpenedApp((remoteMessage) => {
    client.push._dispatchOpenedAppMessage({
      title: remoteMessage.notification?.title,
      body: remoteMessage.notification?.body,
      data: remoteMessage.data,
    });
  });

  const unsub = client.push.onMessageOpenedApp((message) => {
    const chatId = message.data?.chatId;
    if (chatId) navigation.navigate('Chat', { chatId });
  });

  // Check if app was opened from killed state
  messaging().getInitialNotification().then((remoteMessage) => {
    if (remoteMessage) {
      client.push._dispatchOpenedAppMessage({
        title: remoteMessage.notification?.title,
        body: remoteMessage.notification?.body,
        data: remoteMessage.data,
      });
    }
  });

  return unsub;
}, []);
```

**Background Handler (Headless):**

```tsx
// index.js (before AppRegistry.registerComponent)
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  console.log('Background message:', remoteMessage.messageId);
});
```

## Topic Subscription

```tsx
await client.push.subscribeTopic('news');
await client.push.unsubscribeTopic('news');
```

## Unregister

```tsx
await client.push.unregister();
```

## iOS Notes

- **APNs Key required** -- Upload your APNs key (`.p8`) to the Firebase Console. See [Configuration](configuration.md).

## API Reference

| Method | Description |
|---|---|
| `setTokenProvider(provider)` | Inject native FCM token provider |
| `setPermissionProvider(provider)` | Inject permission check/request handlers |
| `setTopicProvider(provider)` | Inject topic subscribe/unsubscribe handlers |
| `register({metadata?})` | Register device |
| `unregister(deviceId?)` | Unregister device |
| `onMessage(callback)` | Listen for foreground messages |
| `onMessageOpenedApp(callback)` | Listen for notification tap events |
| `subscribeTopic(topic)` | Subscribe to an FCM topic |
| `unsubscribeTopic(topic)` | Unsubscribe from an FCM topic |
| `_dispatchForegroundMessage(msg)` | Bridge native foreground messages to SDK |
| `_dispatchOpenedAppMessage(msg)` | Bridge native notification taps to SDK |

</TabItem>
<TabItem value="swift" label="Swift (iOS/macOS)">

## Prerequisites

1. Complete the [Firebase setup](configuration.md) (`GoogleService-Info.plist`, APNs key uploaded).
2. Add Firebase iOS SDK (select `FirebaseMessaging`):

```
https://github.com/firebase/firebase-ios-sdk
```

3. Add EdgeBase SDK:

```
https://github.com/edge-base/edgebase-swift
```

Use the current `0.1.4` release of the Swift package and import the `EdgeBase` module in your app target.

## Setup

### 1. Initialize Firebase

```swift
import UIKit
import FirebaseCore
import FirebaseMessaging
import EdgeBase

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        FirebaseApp.configure()
        UNUserNotificationCenter.current().delegate = self
        application.registerForRemoteNotifications()
        return true
    }

    // Forward APNs token to Firebase (required)
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
    }
}
```

### 2. Set FCM Token Provider

```swift
client.push.setFcmTokenProvider {
    guard let token = Messaging.messaging().fcmToken, !token.isEmpty else {
        throw NSError(domain: "Push", code: -1,
                      userInfo: [NSLocalizedDescriptionKey: "FCM token not available"])
    }
    return token
}
```

### 3. Set Topic Provider

```swift
client.push.setTopicProvider(
    subscribe: { topic in Messaging.messaging().subscribe(toTopic: topic) },
    unsubscribe: { topic in Messaging.messaging().unsubscribe(fromTopic: topic) }
)
```

### 4. Register

```swift
try await client.push.register()
try await client.push.register(metadata: ["userType": "premium"])
```

## Permission Handling

`register()` automatically requests permission via `UNUserNotificationCenter`. If denied, registration exits silently.

**Check permission status:**

```swift
let status = await client.push.getPermissionStatus()
// "granted" | "denied" | "notDetermined"
```

**Request permission manually:**

```swift
let result = await client.push.requestPermission()
if result == "granted" {
    try await client.push.register()
} else {
    // Guide user to Settings > Notifications
}
```

:::info
On iOS/macOS, the permission dialog is shown **only once**. If the user denies, subsequent calls to `requestPermission()` will return `"denied"` without showing the dialog. The user must enable notifications manually in **Settings > Notifications > Your App**.
:::

## Handle Messages

Add `UNUserNotificationCenterDelegate` to your AppDelegate:

```swift
extension AppDelegate: UNUserNotificationCenterDelegate {
    // Foreground messages
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let userInfo = notification.request.content.userInfo
        if let payload = userInfo as? [String: Any] {
            client.push.dispatchMessage(payload)
        }
        completionHandler([.banner, .sound])
    }

    // Notification tap
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let userInfo = response.notification.request.content.userInfo
        if let payload = userInfo as? [String: Any] {
            client.push.dispatchMessageOpenedApp(payload)
        }
        completionHandler()
    }
}
```

Listen for messages:

```swift
client.push.onMessage { message in
    print("Push: \(message["title"] ?? "")")
}

client.push.onMessageOpenedApp { message in
    if let chatId = (message["data"] as? [String: Any])?["chatId"] as? String {
        // Navigate to chat screen
    }
}
```

## macOS

Use `NSApplicationDelegate` instead of `UIApplicationDelegate`:

```swift
class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        FirebaseApp.configure()
        UNUserNotificationCenter.current().delegate = self
        NSApplication.shared.registerForRemoteNotifications()
    }
}
```

## Topic Subscription

```swift
try await client.push.subscribeTopic("news")
try await client.push.unsubscribeTopic("news")
```

## Unregister

```swift
try await client.push.unregister()
```

## API Reference

| Method | Description |
|---|---|
| `setFcmTokenProvider(provider)` | Set FCM token acquisition closure |
| `setTopicProvider(subscribe:unsubscribe:)` | Set topic subscription closures |
| `register(metadata:)` | Request permission, get token, register |
| `unregister(deviceId:)` | Unregister device |
| `onMessage(callback)` | Listen for foreground messages |
| `onMessageOpenedApp(callback)` | Listen for notification tap events |
| `subscribeTopic(topic)` | Subscribe to an FCM topic |
| `unsubscribeTopic(topic)` | Unsubscribe from an FCM topic |
| `dispatchMessage(payload)` | Forward OS message to SDK |
| `dispatchMessageOpenedApp(payload)` | Forward notification tap to SDK |

</TabItem>
<TabItem value="kotlin" label="Kotlin (KMP)">

## Android (Auto Token)

### Prerequisites

```kotlin
// build.gradle.kts
dependencies {
    implementation("com.google.firebase:firebase-messaging:24.0.0")
}
```

### FirebaseMessagingService

```kotlin
class MyFirebaseService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        client.push.register()
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        client.push.dispatchMessage(remoteMessage.data)
    }
}
```

Register in `AndroidManifest.xml`:

```xml
<service android:name=".MyFirebaseService" android:exported="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>
```

### Register

```kotlin
client.push.register()
```

## Permission Handling

`register()` automatically handles notification permissions on all platforms:

- **Android (API 33+):** The SDK auto-requests `POST_NOTIFICATIONS` using a headless Fragment attached to the current Activity. Pre-Android 13 devices require no runtime permission.
- **iOS (KMP):** Permission is auto-requested via `UNUserNotificationCenter` during `register()`.

**Check permission status:**

```kotlin
val status = client.push.getPermissionStatus()
// "granted" | "denied" | "notDetermined"
```

**Manual control:**

```kotlin
val status = client.push.requestPermission()
if (status == "granted") {
    client.push.register()
}
```

:::info
On Android, if no foreground Activity is available when `register()` is called (e.g., from a background Service), the SDK returns `"notDetermined"` and skips registration. Ensure `register()` is called while a user-facing Activity is active.
:::

### Listen for Messages

```kotlin
client.push.onMessage { message ->
    println("Push: ${message["title"]}")
}

client.push.onMessageOpenedApp { message ->
    val chatId = message["data"]?.get("chatId")
    // Navigate to chat screen
}
```

## iOS / macOS (KMP)

Bridge the FCM token from native Swift code:

```swift
// In Swift AppDelegate
SharedModule.client.push.setFcmTokenProvider {
    Messaging.messaging().fcmToken ?? ""
}
```

## JVM / Desktop

Push notifications are not available on JVM desktop targets. The push methods are no-ops.

## Topic Subscription

```kotlin
client.push.subscribeTopic("news")
client.push.unsubscribeTopic("news")
```

How it works:
- **Android**: `FirebaseMessaging.getInstance().subscribeToTopic()` directly
- **iOS**: Delegates to the topic provider set via native interop
- **Web**: `POST /api/push/topic/subscribe` to the EdgeBase server

## Unregister

```kotlin
client.push.unregister()
```

## API Reference

| Method | Description |
|---|---|
| `register(metadata?)` | Request permission, get token, register |
| `unregister(deviceId?)` | Unregister device |
| `onMessage(callback)` | Listen for foreground messages |
| `onMessageOpenedApp(callback)` | Listen for notification tap events |
| `subscribeTopic(topic)` | Subscribe to an FCM topic |
| `unsubscribeTopic(topic)` | Unsubscribe from an FCM topic |
| `dispatchMessage(message)` | Forward OS message to SDK |
| `dispatchMessageOpenedApp(message)` | Forward notification tap to SDK |

</TabItem>
<TabItem value="java" label="Java (Android)">

## Prerequisites

```groovy
// app/build.gradle
repositories {
    maven { url 'https://jitpack.io' }
}

dependencies {
    implementation 'com.google.firebase:firebase-messaging:24.0.0'
    implementation 'com.github.edge-base.edgebase:edgebase-android-java:v0.1.4'
}
```

## Setup

### 1. Set FCM Token Provider

```java
client.push().setFcmTokenProvider(() -> {
    return Tasks.await(FirebaseMessaging.getInstance().getToken());
});
```

### 2. Set Topic Handlers

```java
client.push().setTopicHandlers(
    topic -> FirebaseMessaging.getInstance().subscribeToTopic(topic),
    topic -> FirebaseMessaging.getInstance().unsubscribeFromTopic(topic)
);
```

### 3. Register

```java
client.push().register();
client.push().register(Map.of("userType", "premium"));
```

### 4. FirebaseMessagingService

```java
public class MyFirebaseService extends FirebaseMessagingService {
    @Override
    public void onNewToken(String token) {
        client.push().register();
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, Object> payload = new HashMap<>();
        if (message.getNotification() != null) {
            payload.put("title", message.getNotification().getTitle());
            payload.put("body", message.getNotification().getBody());
        }
        payload.put("data", message.getData());
        client.push().dispatchMessage(payload);
    }
}
```

Register in `AndroidManifest.xml`:

```xml
<service android:name=".MyFirebaseService" android:exported="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>
```

## Permission Handling

The SDK automatically handles `POST_NOTIFICATIONS` permission on Android 13+ (API 33) using a headless Fragment. No manual setup required — `register()` requests permission automatically.

For custom permission handling, you can override the defaults:

```java
// Optional — override SDK's built-in permission handling
client.push().setPermissionStatusProvider(() -> { /* custom logic */ });
client.push().setPermissionRequester(() -> { /* custom logic */ });
```

:::info
On Android 13+, the SDK uses a headless Fragment to request the `POST_NOTIFICATIONS` permission. This requires a foreground `FragmentActivity`. If called from a background context, `register()` will skip registration gracefully.
:::

## Handle Messages

```java
client.push().onMessage(message -> {
    String title = (String) message.get("title");
    System.out.println("Push: " + title);
});

client.push().onMessageOpenedApp(message -> {
    Map<String, Object> data = (Map<String, Object>) message.get("data");
    if (data != null && data.containsKey("chatId")) {
        // Navigate to chat screen
    }
});
```

## Topic Subscription

```java
client.push().subscribeTopic("news");
client.push().unsubscribeTopic("news");
```

## Unregister

```java
client.push().unregister();
```

## API Reference

| Method | Description |
|---|---|
| `setFcmTokenProvider(provider)` | Set FCM token acquisition callback |
| `setTopicHandlers(subscribe, unsubscribe)` | Set topic subscription callbacks |
| `setPermissionStatusProvider(provider)` | Set permission status check callback |
| `setPermissionRequester(requester)` | Set permission request callback |
| `register()` / `register(metadata)` | Register device |
| `unregister()` / `unregister(deviceId)` | Unregister device |
| `onMessage(callback)` | Listen for foreground messages |
| `onMessageOpenedApp(callback)` | Listen for notification tap events |
| `subscribeTopic(topic)` | Subscribe to an FCM topic |
| `unsubscribeTopic(topic)` | Unsubscribe from an FCM topic |
| `dispatchMessage(message)` | Forward OS message to SDK |

</TabItem>
<TabItem value="unity" label="Unity (C#)">

## Prerequisites

1. Complete the [Firebase setup](configuration.md).
2. Install the [Firebase Unity SDK](https://firebase.google.com/docs/unity/setup).
3. Install the EdgeBase Unity SDK.

## Setup

### 1. Set Token Provider

Use `#if` compiler directives for per-platform token acquisition:

```csharp
using UnityEngine;
using EdgeBase;

#if UNITY_ANDROID || UNITY_STANDALONE_WIN
using Firebase.Messaging;
#endif

public class PushManager : MonoBehaviour
{
    async void Start()
    {
        EdgeBaseManager.Instance.Push.TokenProvider = async () => {
#if UNITY_ANDROID || UNITY_STANDALONE_WIN
            var token = await FirebaseMessaging.GetTokenAsync();
            return token;
#elif UNITY_IOS || UNITY_STANDALONE_OSX
            return await GetFcmTokenFromNativeBridge();
#elif UNITY_WEBGL
            return await GetWebTokenFromJSBridge();
#else
            return null;
#endif
        };

        EdgeBaseManager.Instance.Push.Platform = PushPlatform.Android;
    }
}
```

### 2. Set Topic Delegates

```csharp
#if UNITY_ANDROID || UNITY_STANDALONE_WIN
EdgeBaseManager.Instance.Push.TopicSubscriber = async (topic) => {
    await FirebaseMessaging.SubscribeAsync(topic);
};

EdgeBaseManager.Instance.Push.TopicUnsubscriber = async (topic) => {
    await FirebaseMessaging.UnsubscribeAsync(topic);
};
#endif
```

### 3. Register

```csharp
await EdgeBaseManager.Instance.Push.RegisterAsync();

await EdgeBaseManager.Instance.Push.RegisterAsync(
    new Dictionary<string, object> { { "userType", "premium" } }
);
```

## Permission Handling

The SDK defaults to `"granted"` on platforms where Unity plugins handle permissions natively. For explicit control, set permission delegates:

```csharp
EdgeBaseManager.Instance.Push.PermissionStatusProvider = () => {
#if UNITY_ANDROID
    // Android 13+ requires POST_NOTIFICATIONS
    if (Permission.HasUserAuthorizedPermission("android.permission.POST_NOTIFICATIONS"))
        return "granted";
    return "notDetermined";
#elif UNITY_IOS
    // Check via Unity Mobile Notifications package
    return "notDetermined"; // Use async requestPermission for accurate check
#else
    return "granted";
#endif
};

EdgeBaseManager.Instance.Push.PermissionRequester = () => {
#if UNITY_ANDROID
    Permission.RequestUserPermission("android.permission.POST_NOTIFICATIONS");
    return Permission.HasUserAuthorizedPermission("android.permission.POST_NOTIFICATIONS")
        ? "granted" : "denied";
#elif UNITY_IOS
    // Use Unity Mobile Notifications package for iOS permission
    return "granted";
#else
    return "granted";
#endif
};
```

:::info
On **Android 13+**, you must request `POST_NOTIFICATIONS` at runtime. On **iOS**, permissions are typically handled by the Firebase Unity plugin during token registration. If you need explicit control, use the [Unity Mobile Notifications](https://docs.unity3d.com/Packages/com.unity.mobile.notifications@latest) package.
:::

### 4. Dispatch Messages

Forward OS plugin events to EdgeBase:

```csharp
#if UNITY_ANDROID || UNITY_STANDALONE_WIN
FirebaseMessaging.MessageReceived += (sender, e) => {
    var payload = new Dictionary<string, object>();
    foreach (var kvp in e.Message.Data)
        payload[kvp.Key] = kvp.Value;
    EdgeBaseManager.Instance.Push.DispatchMessage(payload);
};
#elif UNITY_IOS || UNITY_STANDALONE_OSX
AppleNativePlugin.MessageReceived += (payload) => {
    EdgeBaseManager.Instance.Push.DispatchMessage(payload);
};
#endif
```

## Handle Messages

```csharp
EdgeBaseManager.Instance.Push.OnMessage((message) => {
    Debug.Log($"Push: {message["title"]}");

    if (message.TryGetValue("data", out var data) &&
        data is Dictionary<string, object> dataDict &&
        dataDict.TryGetValue("chatId", out var chatId))
    {
        GameManager.OpenChatUI(chatId.ToString());
    }
});
```

## Topic Subscription

```csharp
await EdgeBaseManager.Instance.Push.SubscribeTopicAsync("news");
await EdgeBaseManager.Instance.Push.UnsubscribeTopicAsync("news");
```

## Unregister

```csharp
await EdgeBaseManager.Instance.Push.UnregisterAsync();
```

## API Reference

| Method | Description |
|---|---|
| `TokenProvider` | Delegate: returns FCM token string |
| `TopicSubscriber` | Delegate: subscribes to a topic |
| `TopicUnsubscriber` | Delegate: unsubscribes from a topic |
| `RegisterAsync(metadata?)` | Register device |
| `UnregisterAsync(deviceId?)` | Unregister device |
| `OnMessage(callback)` | Listen for foreground messages |
| `OnMessageOpenedApp(callback)` | Listen for notification taps |
| `SubscribeTopicAsync(topic)` | Subscribe to an FCM topic |
| `UnsubscribeTopicAsync(topic)` | Unsubscribe from an FCM topic |
| `DispatchMessage(payload)` | Forward OS message to SDK |
| `DispatchMessageOpenedApp(payload)` | Forward notification tap to SDK |

</TabItem>
<TabItem value="unreal" label="Unreal (C++)">

## Setup

### 1. Set Token Provider

```cpp
#include "edgebase/edgebase.h"

void UMyGameInstance::RegisterForPush() {
    eb::push::setTokenProvider([]() -> std::string {
#if PLATFORM_ANDROID
        return GetFCMTokenFromPlugin();
#elif PLATFORM_IOS || PLATFORM_MAC
        return GetFCMTokenFromPlugin();
#elif PLATFORM_HTML5
        return GetWebFCMTokenFromJS();
#else
        return "";
#endif
    });

    eb::push::registerPush([](const eb::error& err) {
        if (!err) {
            UE_LOG(LogTemp, Log, TEXT("EdgeBase Push Registered"));
        }
    });
}
```

### 2. Permission Handling

The SDK defaults to `"granted"` since Unreal Engine typically delegates permission handling to native plugins. For explicit control:

```cpp
eb::push::setPermissionStatusProvider([]() -> std::string {
#if PLATFORM_ANDROID
    // Check POST_NOTIFICATIONS via JNI or your plugin
    return CheckAndroidNotificationPermission() ? "granted" : "denied";
#elif PLATFORM_IOS
    return GetIOSNotificationPermissionStatus();
#else
    return "granted";
#endif
});

eb::push::setPermissionRequester([]() -> std::string {
#if PLATFORM_ANDROID
    RequestAndroidNotificationPermission(); // Android 13+
    return CheckAndroidNotificationPermission() ? "granted" : "denied";
#elif PLATFORM_IOS
    return RequestIOSNotificationPermission();
#else
    return "granted";
#endif
});
```

:::info
On **Android 13+**, you must request the `POST_NOTIFICATIONS` runtime permission via JNI or a native plugin. On **iOS**, use `UNUserNotificationCenter` through a native bridge. Without setting these providers, the SDK assumes permission is granted.
:::

### 3. Dispatch Messages

Forward OS plugin events to EdgeBase:

```cpp
void UMyGameInstance::ReceivePushFromPlugin(const FString& JsonPayload) {
    std::string StdJsonString(TCHAR_TO_UTF8(*JsonPayload));
    eb::push::dispatchMessage(StdJsonString);
}
```

### 4. Handle Messages

```cpp
eb::push::onMessage([](const std::string& messageJson) {
    UE_LOG(LogTemp, Log, TEXT("Push received: %s"),
           UTF8_TO_TCHAR(messageJson.c_str()));
});
```

## Topic Subscription

Topic subscription is **not available** in the C++ SDK. Use the Admin SDK from your server to manage topics:

<Tabs groupId="admin-sdk">
<TabItem value="js" label="JavaScript" default>

```typescript
// Server-side (Admin SDK)
await admin.push.sendToTopic('game-events', {
    title: 'New Event',
    body: 'A special event has started!',
});
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
admin.push.sendToTopic(
  "game-events",
  Map("title" -> "New Event", "body" -> "A special event has started!")
)
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
EdgeBaseAdmin.push(admin)
|> EdgeBasePush.send_to_topic("game-events", %{
  title: "New Event",
  body: "A special event has started!"
})
```

</TabItem>
</Tabs>

## Unregister

```cpp
eb::push::unregisterToken();
```

:::caution
Without calling `dispatchMessage`, your `onMessage` listeners will never fire. You must bridge OS/plugin notification events into EdgeBase.
:::

## API Reference

| Method | Description |
|---|---|
| `setTokenProvider(provider)` | Set FCM token acquisition lambda |
| `setPlatform(platform)` | Set the platform string |
| `registerPush(callback)` | Register device |
| `unregisterToken(deviceId?)` | Unregister device |
| `onMessage(callback)` | Listen for messages |
| `onMessageOpenedApp(callback)` | Listen for notification taps |
| `dispatchMessage(jsonString)` | Forward OS message to SDK |
| `dispatchMessageOpenedApp(jsonString)` | Forward notification tap to SDK |

</TabItem>
</Tabs>
