---
sidebar_position: 2
---

# Access Rules

:::caution Alpha
This feature is in **alpha**. APIs and behavior may change without notice. Not recommended for production use.
:::

Push notification dispatch is a **server-side operation** — only the Admin SDK and App Functions can send notifications. Client SDKs can only register and unregister device tokens.

That server-side push surface is available across all Admin SDKs.

## Access Model

| Operation | Who Can Call | Authentication |
|-----------|-------------|----------------|
| `register` / `unregister` | Client SDK | JWT (logged-in user) |
| `send` / `sendMany` / `broadcast` | Admin SDK, App Functions | Service Key |
| `sendToToken` / `sendToTopic` | Admin SDK, App Functions | Service Key |
| `getTokens` / `getLogs` | Admin SDK | Service Key |

:::info Why Server-Only?
Push notifications are inherently a server-initiated action. Allowing clients to send arbitrary notifications would be a security risk. The server decides when and what to push — clients simply register their devices.
:::

## Send Rule

For fine-grained control over who (or which Service Key) can send notifications, declare a `send` rule in your config:

```typescript
// edgebase.config.ts
export default defineConfig({
  push: {
    fcm: {
      projectId: 'my-firebase-project',
    },
    access: {
      send(auth, target) {
        return auth !== null
      },
    },
  },
});
```

### Function Arguments

| Argument | Type | Description |
|----------|------|-------------|
| `auth` | `AuthContext \| null` | The caller's identity (from Service Key or App Function context) |
| `target` | `{ userId: string }` | The target user receiving the notification |

### Examples

#### Allow all authenticated senders

```typescript
access: {
  send(auth, target) {
    return auth !== null
  },
},
```

#### Restrict to admin role only

```typescript
access: {
  send(auth, target) {
    return auth !== null && auth.role === 'admin'
  },
},
```

#### Prevent sending to specific users

```typescript
access: {
  send(auth, target) {
    // Block notifications to users who opted out (check via custom claims)
    return auth !== null && !target.optedOut
  },
},
```

## Service Key Scopes

Push operations use these [Service Key](/docs/server/service-keys) scopes:

| Scope | Operations |
|-------|-----------|
| `push:notification:*:send` | `send`, `sendMany`, `sendToToken`, `sendToTopic`, `broadcast` |
| `push:token:*:read` | `getTokens` |
| `push:token:*:write` | Update token metadata |
| `push:log:*:read` | `getLogs` |

### Scoped Key Example

```typescript
// A key that can only send notifications, not read tokens/logs
{
  kid: 'notifier',
  tier: 'scoped',
  scopes: ['push:notification:*:send'],
  secretSource: 'dashboard',
  secretRef: 'SERVICE_KEY_NOTIFIER',
}
```

## Client SDK — Token Registration

Client SDKs only interact with push for device token registration. This requires a valid JWT (logged-in user):

```typescript
// Register the device for push notifications
// The SDK handles permission, token acquisition, and platform detection automatically
await client.push.register();

// Unregister (automatically called on signOut)
await client.push.unregister();
```

Token registration does not go through the `send` rule — it is always allowed for authenticated users.

---

:::info See Also
- [Push Configuration](/docs/push/configuration) — FCM setup and config options
- [Push Client SDK](/docs/push/client-sdk) — Device token registration
- [Push Admin SDK](/docs/push/admin-sdk) — Sending notifications from the server
- [Push Hooks](/docs/push/hooks) — Transform outbound sends or observe delivery results
- [Service Keys](/docs/server/service-keys) — Scoped keys for push operations
- [Access Rules Reference](/docs/server/access-rules) — Overview of all access rules
:::
