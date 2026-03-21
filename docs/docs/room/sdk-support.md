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

- The unified Room client model groups five core live surfaces (`room.state`, `room.meta`, `room.members`, `room.signals`, `room.media` *(beta)*) plus two companion runtime namespaces (`room.admin`, `room.session`).
- That unified namespace surface is currently implemented in the Web, React Native, Flutter, Kotlin, Java, and Swift iOS client SDKs.
- Room Media transport provider support is currently split like this:
  - Web: `cloudflare_realtimekit` and `p2p`
  - React Native: `cloudflare_realtimekit` and `p2p`
  - Flutter: `cloudflare_realtimekit` and `p2p`
  - Swift iOS: `cloudflare_realtimekit` and `p2p`
  - Kotlin client: Android, iOS, and JS browser ship built-in `cloudflare_realtimekit` and `p2p`; JVM/macOS use explicit `cloudflareRealtimeKit.clientFactory` and `p2p.transportFactory`
  - Java core / Android package: Android ships built-in `cloudflare_realtimekit` and `p2p`; the core artifact uses explicit `cloudflareRealtimeKit.clientFactory` and `p2p.transportFactory`
- Verified smoke builds in the current matrix:
  - React Native: host-app smoke builds succeeded on both iOS simulator and Android debug
  - Flutter: host-app smoke builds succeeded on Web, macOS, Android, and an Apple Silicon iOS simulator via direct Xcode device build
  - Kotlin: JS, iOS simulator, iOS device, macOS, JVM, and Android targets compile successfully; Android unit tests verify provider selection for `cloudflare_realtimekit` and `p2p`, and iOS simulator tests verify built-in factory availability for both providers
- Swift iOS: package tests and iOS simulator build succeeded; P2P now has package-level transport coverage, including injected screen-share source coverage
- Java / Kotlin Android: package/runtime integration is verified through module builds, targeted transport tests, and Android host-app debug builds
- Kotlin currently ships built-in Room Media runtime on Android, iOS, and JS browser, and uses explicit transport injection on JVM/macOS. Java Android now ships built-in `cloudflare_realtimekit` and `p2p`, while the Java core artifact uses the same transport surface through explicit adapter injection. Native live media E2E is still strongest on Web / React Native / Flutter. Other server-only SDKs intentionally do not expose Room Media transport providers.

:::note
The strongest fully-verified Room Media paths today are Web plus the mobile host-build/runtime smoke paths on React Native, Flutter, Swift iOS, Kotlin iOS, and Android-native Java/Kotlin. Kotlin multiplatform still compiles across every target, with built-in Room Media on Android/iOS/JS and explicit adapter injection on JVM/macOS. On Swift iOS, P2P screen share is available through an app-provided `RTKRTCVideoTrack` source rather than built-in ReplayKit capture.
:::

:::tip Android host-app requirement
The current Java/Kotlin Android host-app smoke builds succeeded with **AGP 8.6+** and **compileSdk 35+**. If your app is still on AGP 8.2 / compileSdk 34, RealtimeKit's newer AndroidX metadata may block the media runtime before the app even compiles.
:::
