---
title: Headless Collaboration Surface
description: Product positioning and system boundary for room.collab, a headless real-time collaboration layer built on EdgeBase Room.
unlisted: true
---

# Headless Collaboration Surface

:::info Draft
This is a positioning and boundary document for the proposed `room.collab` surface tracked by [issue #59](https://github.com/edge-base/edgebase/issues/59). It explains what the product is, what it is not, and how it should relate to both EdgeBase Room and Inkline.
:::

## Why this document exists

EdgeBase already has a strong real-time primitive in [Room](/docs/room). But there is still a recurring product question:

- Is EdgeBase trying to become a collaborative editor framework?
- Is this just hosted Yjs?
- Is this a fifth Room primitive?
- How does this relate to Inkline?

This document answers those questions and defines the intended product boundary.

## Positioning

The clearest product position is:

> EdgeBase is a backend platform for collaborative applications.
> `room.collab` is its headless real-time collaboration surface.
> Inkline is a dogfood application that proves the model.

This is intentionally different from narrower framings:

- **Not just “a real-time co-editing product”**
  That is too narrow and makes the platform sound editor-specific.
- **Not just “hosted Yjs”**
  That is too low-level and does not capture auth, access gating, replay, persistence hooks, or permission downgrade.
- **Not “a Notion framework”**
  EdgeBase should not own block schemas, document semantics, or application UX.

The right framing is:

> EdgeBase helps teams build collaborative apps, and `room.collab` is the reusable live collaboration layer inside that platform.

## Relationship to Room

`room.collab` should be described as a **higher-level collaboration surface built on top of Room**, not as a new unrelated product.

Room remains the underlying real-time primitive:

- **`room.state`** — server-authoritative synchronized state
- **`room.meta`** — safe pre-join room metadata
- **`room.members`** — presence and ephemeral member state
- **`room.signals`** — transient event delivery
- **`room.session`** — connection lifecycle and reconnect semantics

`room.collab` uses those capabilities to provide a more opinionated collaboration lane:

- CRDT update relay
- awareness / presence
- cursor / selection / typing state
- follow mode
- reconnect / replay
- read-only downgrade on permission change
- snapshot / compaction hooks

So the correct mental model is:

- **Room** = the core real-time primitive
- **`room.collab`** = a headless collaboration layer built on Room

It is **not** best described as “Room’s fifth primitive.” It is better understood as a productized layer on top of the existing Room foundations.

## Relationship to Inkline

Inkline should use `room.collab`, not be replaced by it.

The division of responsibility should look like this:

### Inkline owns

- page and database semantics
- block/document schema
- editor UI
- comments UX
- template UX
- view/renderer semantics
- share/public/product behavior
- workspace-level product decisions

### `room.collab` owns

- live room join and auth gating
- CRDT transport
- awareness
- follow mode transport
- reconnect lifecycle
- update replay
- snapshot loading hooks
- compaction hooks
- permission downgrade to read-only

Inkline is therefore the **dogfood application** that proves EdgeBase can power a Notion-like collaborative app without EdgeBase itself becoming a Notion-specific framework.

## System boundary

The clean architecture has three planes:

### Durable plane

Authoritative long-lived data:

- database rows
- pages
- permissions
- templates
- files
- comments
- exported/searchable projections
- audit/history records

In Inkline, this stays in EdgeBase database, functions, storage, and workers.

### Live plane

Short-lived collaboration state:

- active sessions
- CRDT deltas
- awareness
- cursors
- selections
- typing state
- follow relationships
- connection status
- immediate read-only downgrade

This is where `room.collab` belongs.

### App plane

Product semantics and UI:

- editor experience
- block menus
- slash commands
- database renderers
- anchored comment UX
- share dialogs
- page shell

This remains application-owned.

## Durable truth vs live sync

One rule matters more than anything else:

> `room.collab` is not the canonical durable truth of the application.

It is the live collaboration transport and coordination layer.

The authoritative durable record still lives in the app’s persistence model:

- `pageDocs`
- `pageDocUpdates`
- exported/searchable snapshots
- audit history
- permission model

That means `room.collab` can:

- relay CRDT updates
- keep collaborators in sync
- expose sync state
- help replay or compact updates

But it should **not** become the only place where application truth exists.

## Why a Yjs-first v1 makes sense

A Yjs-first v1 is a good product decision because it lets EdgeBase provide immediate value without pretending to solve every CRDT format at once.

Reasons:

- Yjs already matches the document collaboration use case well
- Inkline can dogfood it immediately
- it gives a concrete SDK and room contract
- it keeps the first version opinionated enough to ship

But the product boundary should still be described carefully:

- **Yjs-first**
- **not Yjs-only forever**
- **headless**
- **not an editor toolkit**

## Capability breadth vs API surface

One important design rule should be explicit:

> `room.collab` can have a broad responsibility surface without exposing a broad public SDK surface.

Those are not the same thing.

It is healthy for the product to own many collaboration concerns:

- room join auth
- CRDT relay
- awareness
- reconnect
- replay
- snapshot hooks
- compaction hooks
- capability fingerprint changes
- read-only downgrade

But it is usually a mistake to expose every one of those concerns as a first-class client API method.

The safer shape is:

- **broad product responsibility**
- **small public client API**
- **richer server hook surface**
- **even richer internal runtime**

This keeps the platform reusable without turning the SDK into a giant Inkline-shaped API.

## API layering

`room.collab` should be thought of as three layers, not one flat API.

### 1. Public client API

This should stay intentionally small.

Recommended v1 client surface:

```ts
const collab = room.collab({ format: 'yjs', key: 'body' });

await collab.join();
collab.bind(doc);
await collab.sync();

collab.onStatusChange((status) => {});
collab.onModeChange((mode) => {});
collab.onCapabilityFingerprintChange((fingerprint) => {});

collab.awareness.setLocalState({
  cursor: null,
  selection: null,
  typing: false,
});

collab.awareness.onChange((peers) => {});

await collab.destroy();
```

The point is not that this is the exact final syntax. The point is that the public client API should stay focused on:

- join / leave
- bind
- sync
- sync status
- editable vs read-only mode
- capability fingerprint changes
- awareness

An implementation-specific convenience alias like `room.collab.yjs({ key: 'body' })` can still exist, but it should be treated as sugar, not the canonical public product shape.

### 2. Server hook API

The server-side hook surface can be richer than the client SDK because it sits closer to persistence and authorization.

Examples:

```ts
room.collab.register({
  format: 'yjs',
  key: 'body',

  async resolveAccess(ctx) {},
  async loadSnapshot(ctx) {},
  async appendUpdate(ctx, update) {},
  async compact(ctx) {},
});
```

This is where replay, persistence integration, and downgrade policy belong.

### 3. Internal runtime responsibilities

Some collaboration responsibilities should remain internal and not become public SDK methods at all.

Examples:

- reconnect state machine
- update replay internals
- compaction scheduling
- downgrade propagation
- missed-update recovery
- transport batching
- stale-session cleanup
- follow-mode plumbing details

The client should benefit from those behaviors without having to control each one directly.

## Why this matters

If `room.collab` exposes too many client-facing knobs:

- the SDK becomes hard to learn
- Inkline-specific needs leak into the public product surface
- every advanced behavior starts looking like a first-class API promise
- the product becomes harder to reuse across other app categories

If the API stays small while the runtime stays capable:

- Inkline can move quickly
- other apps can adopt it without inheriting Inkline semantics
- EdgeBase can evolve replay, compaction, and downgrade behavior internally
- the product feels more like a platform and less like an app-specific wrapper

## Proposed product boundary

| Area | EdgeBase / `room.collab` | App |
|------|--------------------------|-----|
| Room join auth | Owns | Uses |
| Live transport | Owns | Uses |
| CRDT relay | Owns | Uses |
| Awareness / presence | Owns | Uses |
| Cursor / selection transport | Owns | Uses |
| Reconnect / replay | Owns | Uses |
| Snapshot / compaction hooks | Owns | Provides callbacks / consumes |
| Permission downgrade | Owns | Reacts in UI |
| Editor rendering | Does not own | Owns |
| Block schema | Does not own | Owns |
| Comments UX | Does not own | Owns |
| Database semantics | Does not own | Owns |
| Product-specific permissions | Partially gates room access | Owns higher-level semantics |

## Inkline integration model

Inkline should integrate with `room.collab` in this order:

1. Load durable page snapshot through EdgeBase functions.
2. Join a page room through `room.collab`.
3. Bind the local Yjs document to the room lane for the page body.
4. Use awareness for presence, cursor, selection, typing, and follow state.
5. Persist or compact back into the durable plane through hooks and workers.
6. Re-run secure snapshot queries when capability fingerprints change.

That makes Inkline a proof that:

- EdgeBase can host live collaborative editing
- without embedding application-specific editor semantics into the platform

## Reuse beyond Inkline

If `room.collab` is shaped correctly, it should make many other products easier to build:

- collaborative document editors
- knowledge bases and wikis
- markdown editors
- CMS entry editors
- workflow builders
- whiteboards and structured canvases
- internal tools with synchronized editing surfaces

What becomes reusable is **the collaboration infrastructure**, not the entire product.

Applications still need to own:

- their own schema
- their own UX
- their own permissions model above the room gate
- their own presentation semantics

## What `room.collab` is not

To avoid product drift, the non-goals should be explicit.

`room.collab` is not:

- a Notion clone framework
- a generic editor UI kit
- the canonical source of long-term application truth
- an all-purpose document schema
- a replacement for app-level authorization semantics
- a promise to support every CRDT format in v1

## V1 scope

The first version should stay focused.

Recommended v1 scope:

- `room.collab({ format: 'yjs', key })`
- room join auth and capability fingerprint
- editable vs read-only mode
- update relay
- awareness
- cursor / selection / typing transport
- follow mode baseline
- reconnect and replay
- snapshot load hook
- update-log append hook
- compaction hook
- sync status surface in SDKs

Recommended non-goals for v1:

- editor UI components
- block rendering kit
- comment renderer
- schema-specific collaboration logic
- full cross-format abstraction layer
- a large client SDK that mirrors every internal collaboration responsibility

## Suggested messaging

### One-line product position

EdgeBase is a backend platform for collaborative apps, and `room.collab` is its headless real-time collaboration layer.

### Slightly longer homepage version

Build collaborative applications on EdgeBase with auth, data, storage, and server-authoritative rooms — plus a headless collaboration surface for live editing, presence, replay, and permission-aware sync.

### Inkline-specific framing

Inkline proves that EdgeBase can power a Notion-like collaborative product without forcing EdgeBase itself to become a Notion-specific framework.

## Success criteria

This positioning is working if:

- EdgeBase users understand that `room.collab` is reusable beyond Inkline
- Inkline can use it without leaking Notion-specific assumptions into the platform
- the product is seen as more than hosted Yjs
- the platform boundary stays clean as richer collaboration features ship

## Open questions

These are still valid design questions, but they should not block the product position itself:

- how much of replay / compaction should be automatic vs hook-driven
- whether v1 ships only Yjs or adds a lower-level provider API alongside it
- how much cursor / awareness structure should be standardized
- what the capability fingerprint contract looks like across SDKs

The key is that these are **implementation questions inside a clear product frame**, not product identity questions.
