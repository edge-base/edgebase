---
sidebar_position: 6
---

# Pricing

:::caution Alpha
This feature is in **alpha**. APIs and behavior may change without notice. Not recommended for production use.
:::

EdgeBase Push Notification infrastructure costs are minimal — token storage uses KV, and delivery goes through FCM which is free.

## Edge (Cloudflare)

| Resource | Used For | Cost |
|----------|----------|------|
| KV reads | Token lookup on send | $0.50 / million reads (10M/mo included) |
| KV writes | Token registration | $5.00 / million writes (1M/mo included) |
| KV storage | Token + topic data | $0.50 / GB (1 GB included) |
| Workers requests | API endpoint handling | $0.30 / million (10M/mo included) |

### Example: 50K Users, 10 Pushes/Day

| Resource | Usage | Cost |
|----------|-------|------|
| KV reads | ~15M / month | $2.50 |
| KV writes | ~50K / month | $0 (included) |
| Workers requests | ~15M / month | $1.50 |
| **Total** | | **~$4/mo** |

## FCM (Firebase Cloud Messaging)

FCM delivery is **free** with no per-message charge. You need a Firebase project for FCM credentials, but there is no cost for the messaging service itself.

## Self-Hosting

On Docker, KV is emulated as local file storage. Push API endpoints run in the same process with no external KV charges. FCM delivery still requires internet access and FCM credentials.

:::info Pricing source
KV pricing reflects Cloudflare's published rates as of February 2026. FCM is free as per Google's Firebase pricing.
:::
