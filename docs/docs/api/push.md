---
sidebar_position: 6
---

# Push Notifications API

Device push notification management and delivery.

EdgeBase provides a unified push notification system built on Firebase Cloud Messaging (FCM). Client endpoints handle device token registration, while admin endpoints handle notification delivery and log queries.

---

## Client Endpoints

**Auth**: Bearer Token required (`Authorization: Bearer <accessToken>`)

### Register Device Token

`POST /api/push/register`

Register a device's push notification token with EdgeBase. The token is associated with the authenticated user and stored in KV for fast edge-cached lookups.

| Request Body | Type | Required | Description |
|---|---|---|---|
| `deviceId` | string | Yes | Unique device identifier |
| `token` | string | Yes | Device push token obtained from the Firebase SDK |
| `platform` | string | Yes | Device platform: `"android"`, `"ios"`, or `"web"` |

```json
{
  "deviceId": "device_01J...",
  "token": "dGVzdC10b2tlbi1hYmMxMjM...",
  "platform": "android"
}
```

**Response** `200`

```json
{
  "id": "device_01J...",
  "token": "dGVzdC10b2tlbi1hYmMxMjM...",
  "platform": "android",
  "userId": "user_123",
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

| Error | Status | Description |
|---|---|---|
| Missing fields | `400` | Required fields not provided |
| Unauthorized | `401` | Invalid or missing token |

---

### Unregister Device Token

`POST /api/push/unregister`

Remove a device's push notification token. This prevents further push notifications from being sent to this device. Called automatically by client SDKs on sign-out.

| Request Body | Type | Required | Description |
|---|---|---|---|
| `token` | string | Yes | The device push token to remove |

```json
{
  "token": "dGVzdC10b2tlbi1hYmMxMjM..."
}
```

**Response** `200`

```json
{ "ok": true }
```

---

### Subscribe to Topic

`POST /api/push/topic/subscribe`

Subscribe all of the authenticated user's registered devices to an FCM topic. Useful for group-based or category-based notifications.

| Request Body | Type | Required | Description |
|---|---|---|---|
| `topic` | string | Yes | Topic name to subscribe to |

```json
{
  "topic": "news"
}
```

**Response** `200`

```json
{
  "ok": true,
  "subscribed": 2,
  "failed": 0
}
```

| Error | Status | Description |
|---|---|---|
| Missing topic | `400` | `topic` field not provided |
| Unauthorized | `401` | Invalid or missing token |
| No devices | `404` | No registered devices found for the user |

---

### Unsubscribe from Topic

`POST /api/push/topic/unsubscribe`

Unsubscribe all of the authenticated user's registered devices from an FCM topic.

| Request Body | Type | Required | Description |
|---|---|---|---|
| `topic` | string | Yes | Topic name to unsubscribe from |

```json
{
  "topic": "news"
}
```

**Response** `200`

```json
{
  "ok": true,
  "unsubscribed": 2,
  "failed": 0
}
```

| Error | Status | Description |
|---|---|---|
| Missing topic | `400` | `topic` field not provided |
| Unauthorized | `401` | Invalid or missing token |
| No devices | `404` | No registered devices found for the user |

---

## Admin Endpoints

**Auth**: Service Key required (`X-EdgeBase-Service-Key` header)

### Send Push to Single User

`POST /api/push/send`

Send a push notification to all registered devices of a single user.

| Request Body | Type | Required | Description |
|---|---|---|---|
| `userId` | string | Yes | Target user ID |
| `title` | string | Yes | Notification title |
| `body` | string | Yes | Notification body text |
| `image` | string | No | Image URL for the notification |
| `sound` | string | No | Notification sound |
| `badge` | number | No | Badge count (iOS) |
| `data` | object | No | Custom data payload (e.g., deep link routing) |
| `silent` | boolean | No | Send as silent/data-only notification |
| `collapseId` | string | No | Collapse key for replacing notifications |
| `ttl` | number | No | Time-to-live in seconds |
| `fcm` | object | No | Raw FCM overrides |

```json
{
  "userId": "user_123",
  "title": "New message",
  "body": "You have a new message from Jane",
  "data": {
    "route": "chat",
    "chatId": "chat_456"
  }
}
```

**Response** `200`

```json
{
  "ok": true,
  "sent": 2,
  "failed": 0
}
```

| Error | Status | Description |
|---|---|---|
| Missing Service Key | `403` | `X-EdgeBase-Service-Key` header not provided |
| Invalid Service Key | `401` | Service Key does not match |
| User not found | `404` | No registered tokens for the specified user |

---

### Send Push to Multiple Users

`POST /api/push/send-many`

Send the same push notification to multiple users at once. Each user's registered devices will all receive the notification.

| Request Body | Type | Required | Description |
|---|---|---|---|
| `userIds` | string[] | Yes | Array of target user IDs |
| `title` | string | Yes | Notification title |
| `body` | string | Yes | Notification body text |
| `image` | string | No | Image URL for the notification |
| `sound` | string | No | Notification sound |
| `badge` | number | No | Badge count (iOS) |
| `data` | object | No | Custom data payload |
| `silent` | boolean | No | Send as silent/data-only notification |
| `collapseId` | string | No | Collapse key for replacing notifications |
| `ttl` | number | No | Time-to-live in seconds |
| `fcm` | object | No | Raw FCM overrides |

```json
{
  "userIds": ["user_1", "user_2", "user_3"],
  "title": "System update",
  "body": "A new version is available",
  "data": {
    "route": "settings"
  }
}
```

**Response** `200`

```json
{
  "ok": true,
  "sent": 5,
  "failed": 1
}
```

---

### Send Push to Raw FCM Token

`POST /api/push/send-to-token`

Send a push notification directly to any FCM token, bypassing user-based routing. Useful for testing, external integrations, or when you manage tokens outside EdgeBase.

| Request Body | Type | Required | Description |
|---|---|---|---|
| `token` | string | Yes | FCM device push token |
| `payload` | object | Yes | Push payload (see [Push Payload](../push/admin-sdk#push-payload)) |
| `platform` | string | No | Device platform: `"android"`, `"ios"`, or `"web"` (default: `"web"`) |

```json
{
  "token": "dGVzdC10b2tlbi1hYmMxMjM...",
  "payload": {
    "title": "Direct notification",
    "body": "This goes to one specific device"
  },
  "platform": "android"
}
```

**Response** `200`

```json
{
  "sent": 1,
  "failed": 0
}
```

---

### Send Push to Topic

`POST /api/push/send-to-topic`

Send a push notification to all devices subscribed to an FCM topic.

**Auth**: Service Key required

| Request Body | Type | Required | Description |
|---|---|---|---|
| `topic` | string | Yes | FCM topic name |
| `payload` | object | Yes | Push payload (see [Push Payload](../push/admin-sdk#push-payload)) |

```json
{
  "topic": "news",
  "payload": {
    "title": "Breaking News",
    "body": "Something important happened"
  }
}
```

**Response** `200`

```json
{
  "success": true
}
```

| Error | Status | Description |
|---|---|---|
| Missing Service Key | `403` | `X-EdgeBase-Service-Key` header not provided |
| Invalid Service Key | `401` | Service Key does not match |
| Missing fields | `400` | `topic` or `payload` not provided |
| Push not configured | `503` | FCM credentials not configured |

---

### Broadcast Push to All Devices

`POST /api/push/broadcast`

Broadcast a push notification to all registered devices via the FCM `all` topic. Every device is auto-subscribed to the `all` topic on registration.

**Auth**: Service Key required

| Request Body | Type | Required | Description |
|---|---|---|---|
| `payload` | object | Yes | Push payload (see [Push Payload](../push/admin-sdk#push-payload)) |

```json
{
  "payload": {
    "title": "System Announcement",
    "body": "Scheduled maintenance tonight at 2 AM"
  }
}
```

**Response** `200`

```json
{
  "success": true
}
```

| Error | Status | Description |
|---|---|---|
| Missing Service Key | `403` | `X-EdgeBase-Service-Key` header not provided |
| Invalid Service Key | `401` | Service Key does not match |
| Missing payload | `400` | `payload` not provided |
| Push not configured | `503` | FCM credentials not configured |

---

### Update Device Token Metadata

`PATCH /api/push/tokens`

Update metadata for a specific device token. Useful for attaching custom attributes (e.g., locale, preferences) to a device.

**Auth**: Service Key required

| Request Body | Type | Required | Description |
|---|---|---|---|
| `userId` | string | Yes | The user who owns the device |
| `deviceId` | string | Yes | The device ID to update |
| `metadata` | object | Yes | Custom metadata object to attach |

```json
{
  "userId": "user_123",
  "deviceId": "device_01J...",
  "metadata": {
    "locale": "ko",
    "notifyMarketing": true
  }
}
```

**Response** `200`

```json
{ "ok": true }
```

| Error | Status | Description |
|---|---|---|
| Missing Service Key | `403` | `X-EdgeBase-Service-Key` header not provided |
| Invalid Service Key | `401` | Service Key does not match |
| Missing fields | `400` | `userId`, `deviceId`, or `metadata` not provided |
| Device not found | `404` | No matching device for the user |

---

### List User's Device Tokens

`GET /api/push/tokens?userId=:userId`

Retrieve all registered device tokens for a specific user.

**Auth**: Service Key required

| Query Parameter | Type | Required | Description |
|---|---|---|---|
| `userId` | string | Yes | The user ID to look up |

```bash
curl "https://your-project.edgebase.fun/api/push/tokens?userId=user_123" \
  -H "X-EdgeBase-Service-Key: <serviceKey>"
```

**Response** `200`

```json
{
  "tokens": [
    {
      "id": "device_01J...",
      "token": "dGVzdC10b2tlbi1hYmMxMjM...",
      "platform": "android",
      "createdAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "id": "device_01K...",
      "token": "d2ViLXRva2VuLXh5ejc4OQ...",
      "platform": "web",
      "createdAt": "2026-01-15T00:00:00.000Z"
    }
  ]
}
```

---

### Query Push Notification Logs

`GET /api/push/logs`

Query push notification delivery logs. Logs are retained for 24 hours and include delivery status and error details for debugging.

**Auth**: Service Key required

| Query Parameter | Type | Required | Description |
|---|---|---|---|
| `userId` | string | No | Filter logs by user ID |
| `limit` | number | No | Maximum number of log entries to return (default: 50) |

```bash
curl "https://your-project.edgebase.fun/api/push/logs?userId=user_123&limit=20" \
  -H "X-EdgeBase-Service-Key: <serviceKey>"
```

**Response** `200`

```json
{
  "logs": [
    {
      "id": "log_01J...",
      "userId": "user_123",
      "status": "sent",
      "platform": "android",
      "title": "New message",
      "body": "You have a new message from Jane",
      "timestamp": "2026-01-20T12:30:00.000Z",
      "error": null
    },
    {
      "id": "log_01K...",
      "userId": "user_123",
      "status": "failed",
      "platform": "ios",
      "title": "New message",
      "body": "You have a new message from Jane",
      "timestamp": "2026-01-20T12:30:00.000Z",
      "error": "InvalidRegistration"
    }
  ]
}
```

| Log Status | Description |
|---|---|
| `sent` | Notification delivered successfully to FCM |
| `failed` | Delivery failed (see `error` field for details) |
| `removed` | Device token was invalid and has been automatically removed |

---

## Error Format

All Push API errors follow the standard EdgeBase error format:

```json
{
  "code": 400,
  "message": "Validation failed.",
  "data": {
    "platform": { "code": "invalid_value", "message": "Must be 'android', 'ios', or 'web'." }
  }
}
```

| HTTP Status | Meaning |
|---|---|
| `400` | Bad request or validation failure |
| `401` | Authentication required (missing token or Service Key) |
| `403` | Access denied (invalid Service Key) |
| `404` | User or resource not found |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
