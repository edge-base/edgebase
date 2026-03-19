---
sidebar_position: 4
---

# Room Access Rules

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Rooms use explicit room-level access checks under `rooms[namespace].access`.

## Configuration

```typescript
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  rooms: {
    game: {
      access: {
        metadata: (auth, roomId) => auth !== null,
        join: (auth, roomId) => auth?.custom?.plan === 'pro',
        action: (auth, roomId, actionType) => {
          if (!auth) return false;
          if (actionType === 'BAN_PLAYER') return auth.role === 'admin';
          return true;
        },
      },
      handlers: {
        lifecycle: {
          onJoin(sender, room) {
            room.sendMessage('joined', { userId: sender.userId });
          },
        },
        actions: {
          MOVE(payload, room, sender) {
            room.setPlayerState(sender.userId, (state) => ({
              ...state,
              position: payload,
            }));
          },
        },
      },
    },
  },
});
```

## Release Mode

Rooms are fail-closed in release mode.

- If `public` is not enabled
- and the matching `access.*` function is missing
- then `metadata`, `join`, and `action` are denied

Use `public` only as an explicit opt-in:

```typescript
rooms: {
  lobby: {
    public: {
      metadata: true,
      join: true,
    },
  },
}
```

## `access` vs `handlers`

- `access.metadata`
  - decides whether room metadata can be fetched
- `access.join`
  - decides whether a player can enter the room
- `access.action`
  - decides whether a client action is allowed
- `access.signal`
  - decides whether a signal can be sent
- `access.media.publish`
  - decides whether a track can be published
- `access.media.control`
  - decides whether mute/unmute/device/unpublish is allowed
- `access.media.subscribe`
  - decides whether a member can watch another member's tracks
- `handlers.lifecycle.onJoin`
  - runs after join is accepted
- `handlers.actions`
  - handles accepted action payloads
- `handlers.timers`
  - handles server timers

## Signal Access

Control which signals can be sent inside a room:

```typescript
rooms: {
  game: {
    access: {
      signal: (auth, roomId, event, payload) => {
        if (!auth) return false;
        // Only allow known signal types
        return ['offer', 'answer', 'ice-candidate', 'cursor-move'].includes(event);
      },
    },
  },
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `auth` | `AuthContext \| null` | The sender's identity |
| `roomId` | `string` | The room instance ID |
| `event` | `string` | Signal event name |
| `payload` | `unknown` | Signal payload |

## Media Access *(Alpha)*

Media access rules use a nested structure with three gates:

```typescript
rooms: {
  meeting: {
    access: {
      media: {
        subscribe: (auth, roomId, payload) => auth !== null,
        publish: (auth, roomId, kind, payload) => {
          if (!auth) return false;
          // Only allow screen-share for moderators
          if (kind === 'screen') return auth.role === 'moderator';
          return true;
        },
        control: (auth, roomId, operation, payload) => auth !== null,
      },
    },
  },
}
```

| Gate | Parameters | Purpose |
|------|-----------|---------|
| `subscribe` | `(auth, roomId, payload)` | Watch other members' tracks |
| `publish` | `(auth, roomId, kind, payload)` | Publish audio/video/screen |
| `control` | `(auth, roomId, operation, payload)` | Mute, unmute, device change, unpublish |

`kind` values: `'audio'`, `'video'`, `'screen'`. `operation` values: `'mute'`, `'unmute'`, `'device'`, `'unpublish'`.

In release mode, missing signal and media access rules **deny by default**, matching the same fail-closed behavior as `metadata`, `join`, and `action`.

## Using `auth.meta`

Room access receives the same enriched auth context as HTTP routes.

```typescript
export default defineConfig({
  auth: {
    handlers: {
      hooks: {
        enrich: async (auth) => ({
          workspaceId: await lookupWorkspace(auth.id),
        }),
      },
    },
  },
  rooms: {
    board: {
      access: {
        join: (auth) => Boolean(auth?.meta?.workspaceId),
      },
    },
  },
});
```

## Room Sender

Lifecycle and action handlers receive a `sender` object with:

- `userId`
- `connectionId`
- `role`

Use `auth` inside `access`. Use `sender` inside handlers after the join has been accepted.

## See Also

- [Room Server Guide](/docs/room/server)
- [Authentication Context Hook](/docs/server/enrich-auth)
- [Access Rules](/docs/server/access-rules)
