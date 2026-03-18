---
sidebar_position: 7
sidebar_label: Push Hooks
---

# Push Hooks

:::caution Alpha
This feature is in **alpha**. APIs and behavior may change without notice. Not recommended for production use.
:::

Push hooks let you intercept outbound push sends before delivery or observe the delivery result after the send completes.

They are defined under `push.handlers.hooks` in `edgebase.config.ts`.

## Overview

| Hook | Timing | Behavior | Can Modify | Can Reject |
|------|--------|----------|------------|------------|
| `beforeSend` | Before EdgeBase sends to FCM | Blocking | Yes (return new input) | Yes (throw) |
| `afterSend` | After EdgeBase receives the provider result | Non-blocking (`waitUntil`) | No | No |

Push hooks run only for **server-side push sends** such as:

- `admin.push.send(...)`
- `admin.push.sendMany(...)`
- `admin.push.sendToToken(...)`
- `admin.push.sendToTopic(...)`
- `admin.push.broadcast(...)`

Client token registration and unregistration do **not** trigger push hooks.

## Configuration

```typescript
import { defineConfig } from '@edgebase-fun/shared';

export default defineConfig({
  push: {
    access: {
      send(auth) {
        return auth !== null;
      },
    },
    handlers: {
      hooks: {
        beforeSend: async (_auth, input) => {
          return {
            ...input,
            payload: {
              ...input.payload,
              sentAt: new Date().toISOString(),
            },
          };
        },
        afterSend: async (_auth, input, output, ctx) => {
          ctx.waitUntil(
            fetch('https://audit.example.com/push-log', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                kind: input.kind,
                sent: output.sent,
                failed: output.failed,
                removed: output.removed,
              }),
            }).catch(() => {}),
          );
        },
      },
    },
  },
});
```

## beforeSend

Runs before EdgeBase dispatches the push request. Return a modified `PushSendInput` to rewrite the outbound target or payload, or throw to reject the send.

```typescript
beforeSend: async (_auth, input) => {
  if (input.kind === 'topic') {
    return {
      ...input,
      topic: `prod-${input.topic}`,
    };
  }

  return {
    ...input,
    payload: {
      ...input.payload,
      body: `[EdgeBase] ${String(input.payload.body ?? '')}`,
    },
  };
},
```

### Input Shape

```typescript
interface PushSendInput {
  kind: 'user' | 'users' | 'token' | 'topic' | 'broadcast';
  payload: Record<string, unknown>;
  userId?: string;
  userIds?: string[];
  token?: string;
  topic?: string;
  platform?: string;
}
```

If `beforeSend` returns an invalid structure for the selected `kind`, the server rejects the request with `400`.

## afterSend

Runs after the provider call completes. This hook is best-effort and does not change the response already returned to the caller.

```typescript
afterSend: async (_auth, input, output, ctx) => {
  ctx.waitUntil(
    Promise.resolve().then(() => {
      console.log('Push send finished', input.kind, output.sent, output.failed);
    }),
  );
},
```

### Output Shape

```typescript
interface PushSendOutput {
  sent?: number;
  failed?: number;
  removed?: number;
  error?: string;
  raw?: unknown;
}
```

## Hook Context

```typescript
interface PushHookCtx {
  request?: Request;
  waitUntil(promise: Promise<unknown>): void;
}
```

## Common Uses

- Prefix topic names per environment
- Add standard metadata to all payloads
- Enforce last-minute send policies beyond `push.access.send`
- Record provider results in an audit log
- Trigger follow-up work when tokens are removed or delivery fails

## See Also

- [Push Access Rules](/docs/push/access-rules)
- [Push Configuration](/docs/push/configuration)
- [Sending Push Notifications](/docs/push/admin-sdk)
