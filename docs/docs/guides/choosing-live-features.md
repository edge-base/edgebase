---
title: Choosing Live Features
description: Decide between database subscriptions, room, and push notifications.
sidebar_position: 1
---

# Choosing Between Database Subscriptions, Room, and Push

These three features can look similar at first because they all deliver updates quickly. They solve different problems.

## Short Version

| If you need... | Use |
|---|---|
| Database changes to appear automatically in the UI | [Database Subscriptions](/docs/database/subscriptions) |
| Server-authoritative real-time state with metadata, presence, signals, media, and deltas | [Room](/docs/room) |
| Notifications to registered devices, even outside the active app session | [Push Notifications](/docs/push) |

## Comparison

| Feature | Mental model | Source of truth | Who sends updates? | Reaches only active socket clients? | Best for |
|---|---|---|---|---|---|
| **Database Subscriptions** | "The database changed." | Database rows/documents | Database writes trigger events automatically | Yes | Live feeds, dashboards, document viewers |
| **Room** | "The server owns the live session." | Room state + meta + members + signals + media | Clients send actions; server mutates state. Members track presence. Signals relay custom events. | Yes | Multiplayer games, collaboration, conferencing, auctions, voting, online indicators, chat events |
| **Push** | "Notify this device." | Registered device tokens in KV + FCM delivery | Server only | No | Mobile/web notifications, re-engagement, background delivery |

## How to Think About Each One

### Database Subscriptions

Use Database Subscriptions when the thing you care about is already stored in the database. The database is the source of truth, and the subscription layer simply delivers change events to clients.

- Think: "show the latest posts, comments, orders, or metrics without polling"
- Good fit: `onSnapshot()` on a table, query, or document
- Not a fit: arbitrary chat events that are not backed by a row change

### Room

Use Room when clients need coordinated real-time interaction beyond simple database change feeds. Room provides five core live surfaces:

- **`room.state`** — clients send actions, the server validates and mutates state, and all clients receive deltas
- **`room.meta`** — lobby-safe metadata before join, such as mode, capacity, or public labels
- **`room.members`** — built-in presence tracking (who is online, typing indicators, cursor positions)
- **`room.signals`** — lightweight pub/sub for custom events (chat messages, WebRTC signaling, collaboration cursors)
- **`room.media`** *(beta)* — audio/video/screen publish, mute, and device state for conferencing UIs

And two operational namespaces round out the client experience:

- **`room.admin`** — moderation controls like kick, mute, and role changes
- **`room.session`** — connection lifecycle, reconnect, kicked, and error events

Think:
- "the game server decides" → use Room state + actions
- "show a room card before join" → use `room.meta`
- "who is online right now" → use `room.members`
- "send a chat message to everyone" → use `room.signals`
- "track who has their mic on" → use `room.media`
- "moderate the room from a host client" → use `room.admin`

Good fit: multiplayer, voting, auctions, collaboration, conferencing, online indicators, chat
Not a fit: simple "show latest database rows" — use Database Subscriptions instead

### Push Notifications

Use Push when you need delivery to a device, not just to an active socket connection.

- Think: "notify the user even if the app is backgrounded or not currently open"
- Good fit: mentions, order status alerts, reminders, marketing notifications
- Not a fit: low-latency in-app collaboration events between currently connected users

Push is server-initiated and routes through FCM. It is not a WebSocket channel.

## Common Confusions

### "Is Database Subscriptions really a database feature?"

Yes. It is delivered through WebSocket, but conceptually it is a database change feed. The source of truth is the database.

### "Can Room replace Database Subscriptions?"

No. Database Subscriptions deliver changes from database writes automatically. Room is for interactive state that the server manages. If you want to show the latest database rows, use `onSnapshot()`.

### "Is Room the same as a chat library?"

No. Room provides the low-level primitives (`state`, `meta`, `members`, `signals`, `media`, plus `admin` / `session`) that you can use to build chat, but it is not a pre-built chat UI.

### "Is Push just another kind of Room signal?"

No. Push targets registered devices through FCM and can reach users outside the current active session. Room signals only reach currently connected WebSocket clients.

## Typical Combinations

### Chat App

- [Database Subscriptions](/docs/database/subscriptions): message list backed by the database
- Room `members`: online and typing indicators
- Room `signals`: transient typing or read-receipt events
- [Push Notifications](/docs/push): new message alerts when the app is not active

### Multiplayer Game

- Room `state`: authoritative match state and actions
- Room `members`: lobby-level online indicators
- [Push Notifications](/docs/push): match invites or turn reminders outside the live session

### Video Conferencing UI

- Room `media`: track audio/video/screen publish and mute state
- Room `signals`: WebRTC signaling (offer/answer/ICE candidates)
- Room `members`: participant list and online status

## Decision Checklist

Ask these questions in order:

1. Is the source of truth already in the database? Use [Database Subscriptions](/docs/database/subscriptions).
2. Do you need server-owned interactive state, presence, or custom real-time events? Use [Room](/docs/room).
3. Must the update reach a device even when the app is not actively connected? Use [Push Notifications](/docs/push).
