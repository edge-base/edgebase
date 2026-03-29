---
sidebar_position: 5
---

# Limits

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Technical limits for EdgeBase Room (server-authoritative multiplayer state channels).

## Room Capacity

| Limit | Default | Configurable | Notes |
|-------|---------|:---:|-------|
| Max players per room | **100** | Yes | `rooms.*.maxPlayers` (max 32,768) |
| Max state size | **1 MB** | Yes | `rooms.*.maxStateSize` (min 1 KB) — shared + all player states combined |
| Max dot-path depth | **5** levels | No | e.g. `a.b.c.d.e` for nested state operations (enforced in tests; not yet validated at runtime) |

## Timing

| Limit | Default | Configurable | Notes |
|-------|---------|:---:|-------|
| Auth timeout | **5,000 ms** | No | Connection closed if no auth message |
| Action handler timeout | **5,000 ms** | No | Per `handlers.actions` execution |
| Reconnect grace period | **30,000 ms** (30s) | Yes | `rooms.*.reconnectTimeout` (0 = immediate `onLeave`) |
| Delta batch window | **50 ms** | No | State changes are buffered before broadcast |
| Room idle timeout | **300 seconds** | No | Empty room hibernation delay |

## State Persistence

| Limit | Default | Configurable | Notes |
|-------|---------|:---:|-------|
| State save interval | **60 seconds** | Yes | `rooms.*.stateSaveInterval` |
| State TTL | **24 hours** | Yes | `rooms.*.stateTTL` — safety net for orphaned storage |

## Rate Limiting

| Limit | Default | Configurable | Notes |
|-------|---------|:---:|-------|
| Action rate limit | **10 actions/sec** | Yes | `rooms.*.rateLimit.actions` (token bucket, min 1) |
| Signal/admin rate limit | **falls back to actions** | Yes | `rooms.*.rateLimit.signals`, `admin` override their own room WebSocket buckets |
| Pending connections per IP | **5** | No | WebSocket DDoS gate |
| Pending connection TTL | **60 seconds** | No | Auto-expires; no cleanup needed |

## Messaging

| Feature | Limit | Notes |
|---------|-------|-------|
| `sendMessage` | Broadcast to all | `options.exclude` to skip specific users |
| `sendMessageTo` | Unicast to one user | |
| Named timers | Alarm multiplexer | Persisted to DO Storage; survives hibernation |

## Lifecycle

| Hook | Behavior | Notes |
|------|----------|-------|
| `onJoin` | Can `throw` to reject | |
| `onLeave` | `reason`: `'leave'` / `'disconnect'` / `'kicked'` | |
| `onDestroy` | Stored state immediately deleted | |
| `handlers.actions` | 5s timeout, try/catch protected | |

:::tip Room config validation
`maxPlayers` must be between 1 and 32,768. `maxStateSize` minimum is 1 KB. `reconnectTimeout` must be non-negative. `rateLimit.actions` must be at least 1. Additional `rateLimit.signals` and `rateLimit.admin` values fall back to `actions` when omitted. Invalid values cause a config validation error at deploy time.
:::
