---
sidebar_position: 5
---

# Limits

:::caution Alpha
This feature is in **alpha**. APIs and behavior may change without notice. Not recommended for production use.
:::

Technical limits for EdgeBase Push Notifications.

## Device Tokens

| Limit | Value | Notes |
|-------|-------|-------|
| Max devices per user | **10** | Oldest token is removed when exceeded |
| Max metadata per token | **1,024 bytes** | Custom metadata attached to device registration |

## Sending

| Limit | Value | Notes |
|-------|-------|-------|
| Token chunk size (multicast) | **500** tokens per batch | Server auto-chunks larger sends internally |
| `send-many` | Multiple user IDs | Each user's tokens are resolved and batched. Maximum 10,000 user IDs per request. |
| `send-to-topic` | All topic subscribers | Topic subscriptions managed by FCM |
| `broadcast` | All registered users | Service Key required |

## Topics

| Feature | Notes |
|---------|-------|
| `subscribe` / `unsubscribe` | JWT-authenticated (client SDK) |
| Topic storage | Managed by FCM directly |

## Authentication

| Endpoint | Auth Required |
|----------|--------------|
| `register` / `unregister` | JWT |
| `subscribe` / `unsubscribe` (topics) | JWT |
| `send` / `send-many` / `send-to-token` | Service Key |
| `send-to-topic` / `broadcast` | Service Key |
| `tokens` / `logs` | Service Key |

Those server-side push endpoints are available across all Admin SDKs.

## Rate Limiting

| Group | Default | Key | Configurable |
|-------|---------|-----|:---:|
| `global` | **10,000,000 req / 60s** | IP | Yes |

Push endpoints use only the `global` rate limit group.

## Platform Requirements

EdgeBase Push requires a Firebase Cloud Messaging (FCM) Service Account for delivery:

| Platform | Push Service | Config |
|----------|-------------|--------|
| Android | FCM | `PUSH_FCM_SERVICE_ACCOUNT` env variable |
| iOS | APNs (via FCM) | FCM project config + APNs key |
| Web | FCM | FCM project config + VAPID key |
