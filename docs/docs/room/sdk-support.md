---
sidebar_position: 7
title: SDK Support
sidebar_label: SDK Support
description: Room client and admin surface comparison.
---

# SDK Support

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Room is the main exception in the product lineup: it has a **first-class client SDK surface**, but **no standalone Admin SDK room surface**. The server half of Room lives in `rooms.*.handlers`.

:::info Scope
This table compares the Room capability split across the Client SDK and the Admin SDK. For exact runtime availability, see [SDK Layer Matrix](/docs/sdks/layer-matrix).
:::

| Capability | Client SDK | Admin SDK | Notes |
| --- | --- | --- | --- |
| Join and leave rooms | Yes | No | Room connections are client-facing realtime sessions. |
| Send actions and receive results | Yes | No | Clients call `room.send(...)`; the server validates in `handlers.actions`. |
| Subscribe to shared and player state deltas | Yes | No | Delta sync is part of the client Room SDK. |
| Server-authoritative lifecycle hooks, actions, and timers | No | No | These are defined in [`rooms.*.handlers`](/docs/room/server), not exposed as an SDK surface. |
| Privileged persistence and backend access from room logic | No | No | Use `ctx.admin.*` inside Room server handlers rather than a separate Admin SDK room API. |

:::note
If you are looking for the "server side" of Room, the correct destination is [Server Hooks and Actions](/docs/room/server), not an Admin SDK page.
:::

## Use Client SDK When

- users need to join a room and stay synchronized
- the app must send actions and receive room state deltas
- you need reconnect and room session handling in the client

## Use Room Server Code When

- the server must validate actions and own the state
- you need lifecycle hooks, timers, or persistence
- room logic must call privileged services through `ctx.admin.*`

## Related Docs

- [Client SDK](/docs/room/client-sdk)
- [Server Hooks and Actions](/docs/room/server)
- [Access Rules](/docs/room/access-rules)

## Unified Surface Rollout

- The unified Room client model groups five core live surfaces (`room.state`, `room.meta`, `room.members`, `room.signals`, `room.media` *(alpha)*) plus two companion runtime namespaces (`room.admin`, `room.session`).
- That unified namespace surface is currently implemented in the Web, React Native, Flutter, Kotlin, Java, Swift iOS, C#, and C++ client SDKs.
- Room Media transport provider support is currently split like this:
  - Web: `cloudflare_realtimekit` and `p2p`
  - React Native: `cloudflare_realtimekit` and `p2p`
  - Flutter: `cloudflare_realtimekit` and `p2p`
  - Swift iOS: `cloudflare_realtimekit`
  - Kotlin client: Android runtime currently supports `cloudflare_realtimekit`; other KMP targets keep the API surface but currently return transport-unavailable
  - Java core / Android package: Android runtime currently supports `cloudflare_realtimekit`
  - C#/Unity and C++/Unreal: matching placeholder entry points that redirect to [Room Media](/docs/room/media)
- Verified smoke builds in the current matrix:
  - React Native: iOS simulator build succeeded; Android integration reached app compile and is currently blocked by external Gradle artifact TLS fetches in this environment
  - Flutter: Web, macOS, and Android host apps built successfully; iOS is still blocked by an upstream RealtimeKit iOS linker issue in current toolchains
  - Kotlin: JS, iOS simulator, macOS, and Android targets compile successfully
- `p2p` is still pending on Swift, Kotlin, and Java. Other server-only SDKs intentionally do not expose Room Media transport providers.
