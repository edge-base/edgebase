---
sidebar_position: 6
---

# Pricing

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

EdgeBase Room runs entirely inside a Durable Object's in-memory state. There is no per-message billing — only DO duration charges while the room is active.

## Edge (Cloudflare)

| Resource | Included (Workers Paid $5/mo) | Overage |
|----------|-------------------------------|---------|
| DO requests | 1M / month | $0.15 / million |
| DO duration | 400K GB-s / month | $12.50 / million GB-s |
| DO storage | 1 GB | $0.20 / GB |

### Why So Cheap?

- **No per-message billing** — state updates are broadcast via WebSocket handles inside a single DO
- **Hibernation** — empty rooms hibernate at $0 duration cost
- **No external database** — Room state is in-memory with periodic DO Storage persistence

### Example: Casual Mini-Game

10K DAU, 3 rounds/day, 4 players/room, 5 state updates/sec/player, average 5 min/game:

| Platform | Approach | Monthly Cost |
|----------|----------|------|
| Firebase | Database writes + reads | ~$2,700 |
| Supabase | Per-recipient messages | ~$13,500 |
| **EdgeBase** | DO duration only (~250 concurrent rooms) | **~$10** |

### Example: 100 Concurrent Rooms

| Resource | Usage | Cost |
|----------|-------|------|
| DO requests | ~5M | $0.60 |
| DO duration (5 MB avg × 8h/day) | ~44K GB-s | $0 (included) |
| DO storage (state persistence) | < 1 GB | $0 (included) |
| **Total** | | **~$1/mo** |

## Self-Hosting

On Docker, Room has no per-message or per-connection cost. All Room DOs run in the same process with in-memory state.

:::info No competing BaaS offers this
No competing BaaS platform offers ephemeral server-authoritative rooms as a built-in feature. The comparison costs assume equivalent functionality built on their database or messaging primitives.
:::
