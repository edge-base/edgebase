---
sidebar_position: 8
title: SDK Support
sidebar_label: SDK Support
description: Push client and admin surface comparison.
---

# SDK Support

:::caution Alpha
This feature is in **alpha**. APIs and behavior may change without notice. Not recommended for production use.
:::

Push is intentionally split: **device-side registration** happens in the Client SDK, while **delivery and inspection** happen in the Admin SDK.

:::info Scope
This table compares **push capabilities by SDK role**. For package and runtime availability, see [SDK Layer Matrix](/docs/sdks/layer-matrix). For the latest cross-runtime admin certification, see [SDK Verification Matrix](/docs/sdks/verification-matrix).
:::

| Capability | Client SDK | Admin SDK | Notes |
| --- | --- | --- | --- |
| Device token registration and unregister | Yes | No | Client SDKs manage token lifecycle and unregister on sign out. |
| Foreground and opened-app message handlers | Yes | No | These are device-side integration points. |
| Topic subscribe and unsubscribe | Partial | Yes | Client topic APIs exist, but C++ currently does not expose topic subscription. |
| Send to user, token, topic, or broadcast | No | Yes | Delivery is a backend-only push surface. |
| Delivery logs and token inspection | No | Yes | Use the Admin SDK for push logs and backend token operations. |

:::note
App Functions can also send push notifications, but this page focuses only on the Client SDK and the Admin SDK surfaces.
:::

## Use Client SDK When

- the device needs to register or unregister its push token
- your app needs foreground or opened-app message callbacks
- users subscribe themselves to topics from the app

## Use Admin SDK When

- your backend sends notifications
- you need topic or broadcast delivery with Service Key authority
- you need logs, token inspection, or delivery debugging

## Related Docs

- [Client SDK](/docs/push/client-sdk)
- [Admin SDK](/docs/push/admin-sdk)
- [Access Rules](/docs/push/access-rules)
