---
id: configuration
title: Configuration
sidebar_label: Configuration
sidebar_position: 1
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Configuring Push Notifications

:::caution Alpha
This feature is in **alpha**. APIs and behavior may change without notice. Not recommended for production use.
:::

EdgeBase uses **Firebase Cloud Messaging (FCM)** as its unified push delivery provider for all platforms (iOS, Android, Web, macOS). Before your server can dispatch push notifications, you must set up Firebase and provide EdgeBase with your FCM credentials.

## Prerequisites

- A [Firebase project](https://console.firebase.google.com/). If you don't have one yet, create a free project in the Firebase Console.
- Your Firebase project must have the **Firebase Cloud Messaging API (V1)** enabled (it's enabled by default for new projects).

## Step 1: Get a Service Account Key

EdgeBase communicates with FCM using a Google Cloud Service Account. This is a JSON file that contains authentication credentials for server-to-server calls.

1. Go to the [Firebase Console](https://console.firebase.google.com/) and select your project.
2. Click the **gear icon** (top-left) → **Project settings**.
3. Go to the **Service accounts** tab.
4. Click **"Generate new private key"** → **"Generate key"**.
5. A `.json` file will download to your computer. Keep it safe.

Open the downloaded file — you'll see something like:

```json
{
  "type": "service_account",
  "project_id": "my-firebase-project",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxxx@my-firebase-project.iam.gserviceaccount.com",
  ...
}
```

The `project_id` field is what you'll use in your EdgeBase config. The entire JSON file goes into an environment variable.

## Step 2: Register Firebase Apps (Per Platform)

For each platform you want to support, register an app in the Firebase Console.

### Android

1. In the Firebase Console, go to **Project settings** → **General** → **Your apps**.
2. Click **"Add app"** → **Android**.
3. Enter your Android package name (e.g., `com.example.myapp`) and register.
4. Download **`google-services.json`** and place it in your app's `android/app/` directory.
5. Follow the Firebase setup instructions to add the `google-services` Gradle plugin.

### iOS / macOS

1. In the Firebase Console, click **"Add app"** → **Apple**.
2. Enter your Bundle ID (e.g., `com.example.myapp`) and register.
3. Download **`GoogleService-Info.plist`** and add it to your Xcode project.
4. **Upload your APNs Key** (see [Step 5](#step-5-ios-apns-key-required) below) — this is required for iOS push to work.

### Web

1. In the Firebase Console, click **"Add app"** → **Web**.
2. Enter an app nickname and register.
3. Copy the `firebaseConfig` object — you'll use this to initialize the Firebase JS SDK in your web app.

## Step 3: EdgeBase Config

In your `edgebase.config.ts`, add the `push` block with your Firebase project ID:

```typescript
// edgebase.config.ts
export default defineConfig({
  // ... other config ...
  push: {
    fcm: {
      projectId: 'my-firebase-project', // from your Service Account JSON
    },
  },
})
```

## Step 4: Set Environment Variables

The Service Account JSON must be set as an environment variable. **Never commit it to your codebase.**

### Local Development

In your `.env.development` file:

```env
PUSH_FCM_SERVICE_ACCOUNT='{"type":"service_account","project_id":"my-firebase-project","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"firebase-adminsdk-xxxxx@my-firebase-project.iam.gserviceaccount.com"}'
```

> [!TIP]
> Paste the entire JSON file contents as a single-line string. Make sure all inner quotes are preserved.

### Production

Add the same variable to your `.env.release` file. It will be uploaded automatically when you run `npx edgebase deploy`.

## Step 5: iOS APNs Key (Required)

Firebase delivers push notifications to iOS devices through Apple's APNs service. For this to work, you **must** upload an APNs authentication key to Firebase.

Without this step, iOS devices will not receive any push notifications.

### Create an APNs Key

1. Go to the [Apple Developer Console](https://developer.apple.com/account) → **Certificates, Identifiers & Profiles**.
2. Select **Keys** in the left sidebar → click the **(+)** button.
3. Name it (e.g., "Firebase Push Key"), check **Apple Push Notifications service (APNs)**, then click **Continue** → **Register**.
4. **Download** the `.p8` file (you can only download it once).
5. Note the **Key ID** (10-character string shown on the key page).
6. Note your **Team ID** (shown in the top-right corner of the Developer Console).

### Upload to Firebase

1. In the Firebase Console → **Project settings** → **Cloud Messaging** tab.
2. Under **Apple app configuration**, click **Upload** next to "APNs Authentication Key".
3. Upload your `.p8` file, enter the **Key ID** and **Team ID**.

Once uploaded, Firebase handles all APNs communication automatically. You do not need to set any APNs credentials in EdgeBase directly.

## Step 6: Web Push Certificate (Optional)

For web push notifications via Firebase, you need a VAPID key pair (Firebase calls this "Web Push certificate").

1. In the Firebase Console → **Project settings** → **Cloud Messaging** tab.
2. Under **Web configuration**, find **Web Push certificates**.
3. If no key pair exists, click **Generate key pair**.
4. Copy the **Key pair** value — you'll pass this as `vapidKey` when calling `getToken()` in the Firebase JS SDK.

> [!NOTE]
> This VAPID key is managed by Firebase, not by EdgeBase. You use it only in your client-side code when initializing Firebase Messaging for web.

## Verify Your Setup

After completing the steps above, test with a quick Admin SDK call:

<Tabs groupId="admin-sdk">
<TabItem value="js" label="JavaScript" default>

```typescript
import { createAdminClient } from '@edgebase-fun/admin';

const admin = createAdminClient('https://my-edgebase-server.com', {
  serviceKey: process.env.EDGEBASE_SERVICE_KEY,
});

// Send a test push (requires a registered user with a device token)
const result = await admin.push.send('user_123', {
  title: 'Test',
  body: 'Push notifications are working!',
});
console.log(result); // { sent: 1, failed: 0, removed: 0 }
```

</TabItem>
<TabItem value="scala" label="Scala">

```scala
import dev.edgebase.sdk.scala.admin.AdminEdgeBase

val admin = AdminEdgeBase(
  "https://my-edgebase-server.com",
  sys.env("EDGEBASE_SERVICE_KEY")
)

val result = admin.push.send(
  "user_123",
  Map("title" -> "Test", "body" -> "Push notifications are working!")
)
println(result)
```

</TabItem>
<TabItem value="elixir" label="Elixir">

```elixir
admin =
  EdgeBaseAdmin.new("https://my-edgebase-server.com",
    service_key: System.fetch_env!("EDGEBASE_SERVICE_KEY")
  )

{:ok, result} =
  EdgeBaseAdmin.push(admin)
  |> EdgeBasePush.send("user_123", %{
    title: "Test",
    body: "Push notifications are working!"
  })

IO.inspect(result)
```

</TabItem>
</Tabs>

## Summary

| Item | Where | Required? |
|---|---|---|
| `projectId` | `edgebase.config.ts` → `push.fcm.projectId` | Yes |
| Service Account JSON | `PUSH_FCM_SERVICE_ACCOUNT` env variable | Yes |
| `google-services.json` | Android app project | For Android |
| `GoogleService-Info.plist` | iOS/macOS Xcode project | For iOS/macOS |
| APNs Key (`.p8`) | Firebase Console → Cloud Messaging | For iOS/macOS |
| Firebase Web Config | Client JS code | For Web |
| VAPID Key | Firebase Console → Cloud Messaging | For Web |
