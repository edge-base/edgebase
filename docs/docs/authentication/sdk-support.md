---
sidebar_position: 25
title: SDK Support
sidebar_label: SDK Support
description: Authentication client and admin surface comparison.
---

# SDK Support

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Authentication has two distinct SDK surfaces: **end-user auth flows** in the Client SDK and **privileged user management** in the Admin SDK.

:::info Scope
This table compares **auth product surface** by SDK role. For package and runtime availability, see [SDK Layer Matrix](/docs/sdks/layer-matrix). For the latest cross-runtime admin certification, see [SDK Verification Matrix](/docs/sdks/verification-matrix).
:::

| Capability | Client SDK | Admin SDK | Notes |
| --- | --- | --- | --- |
| End-user sign up, sign in, sign out, token refresh | Yes | No | User session flows live on the client-auth surface. |
| OAuth, magic link, email OTP, phone auth, passkeys | Yes | No | Some methods depend on browser or native host capabilities, but they remain client-facing auth flows. |
| Current-user session listing and revoke | Yes | No | Use the signed-in user's client-authenticated session APIs. |
| Admin user management, custom claims, bans, disables | No | Yes | Backend-only management surface for users and sessions. |
| Bulk user import and migration | No | Yes | Use [User Import](/docs/authentication/user-import) for privileged migration flows. |
| Global session revocation and backend moderation | No | Yes | Use Service Key-backed admin auth flows. |

:::note
Authentication Triggers, Access Rules, and Delivery Hooks are **server/config surfaces**, not SDK surfaces. Use this page to decide whether a capability belongs to the app-facing auth client or the backend management client.
:::

## Use Client SDK When

- you are authenticating end users
- you need current-user session management
- you are integrating browser or native auth flows such as OAuth or passkeys

## Use Admin SDK When

- you are managing users from your backend
- you need custom claims, bans, disables, or admin moderation
- you are importing or revoking users and sessions at scale

## Related Docs

- [Sessions](/docs/authentication/sessions)
- [Admin Users](/docs/authentication/admin-users)
- [User Import](/docs/authentication/user-import)
