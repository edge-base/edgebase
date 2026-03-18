<h1 align="center">@edge-base/web</h1>

<p align="center">
  <b>Browser SDK for EdgeBase</b><br>
  Auth, database, realtime, storage, functions, analytics, and rooms for modern web apps
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@edge-base/web"><img src="https://img.shields.io/npm/v/%40edge-base%2Fweb?color=brightgreen" alt="npm"></a>&nbsp;
  <a href="https://edgebase.fun/docs/database/client-sdk"><img src="https://img.shields.io/badge/docs-client_sdk-blue" alt="Docs"></a>&nbsp;
  <a href="https://github.com/edge-base/edgebase/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  React · Next.js · Vite · Vanilla TS · PWAs
</p>

<p align="center">
  <a href="https://edgebase.fun/docs/getting-started/quickstart"><b>Quickstart</b></a> ·
  <a href="https://edgebase.fun/docs/database/client-sdk"><b>Client SDK Docs</b></a> ·
  <a href="https://edgebase.fun/docs/database/subscriptions"><b>Database Live</b></a> ·
  <a href="https://edgebase.fun/docs/room/client-sdk"><b>Room Docs</b></a>
</p>

---

`@edge-base/web` is the main client SDK for browser environments.

It is designed for apps that need:

- user authentication with session persistence
- direct database access from the client through access rules
- live updates with `onSnapshot()`
- multiplayer and presence flows with rooms
- storage uploads and file URLs
- client-side function calls, analytics, and web push

If you need privileged or server-only access, use [`@edge-base/admin`](https://www.npmjs.com/package/@edge-base/admin) instead.

> Beta: the package is already usable, but some APIs may still evolve before general availability.

## Documentation Map

Use this README for the fast overview, then jump into the docs when you need depth:

- [Quickstart](https://edgebase.fun/docs/getting-started/quickstart)
  Create a project and run EdgeBase locally
- [Client SDK](https://edgebase.fun/docs/database/client-sdk)
  Full browser SDK reference and query patterns
- [Database Subscriptions](https://edgebase.fun/docs/database/subscriptions)
  Live queries and `onSnapshot()` patterns
- [Authentication](https://edgebase.fun/docs/authentication)
  Email/password, OAuth, MFA, sessions, passkeys
- [Room Client SDK](https://edgebase.fun/docs/room/client-sdk)
  Presence, state, members, signals, and media
- [Functions Client SDK](https://edgebase.fun/docs/functions/client-sdk)
  Calling EdgeBase functions from the browser
- [Analytics Client SDK](https://edgebase.fun/docs/analytics/client-sdk)
  Event tracking from web clients
- [Push Client SDK](https://edgebase.fun/docs/push/client-sdk)
  Web push registration and client-side handling

## For AI Coding Assistants

This package ships with an `llms.txt` file for AI-assisted development.

Use it when you want an agent or code assistant to:

- avoid common API mistakes
- use the correct method signatures
- choose the right database and auth patterns
- prefer the documented EdgeBase flow instead of guessing

You can find it:

- in this package after install: `node_modules/@edge-base/web/llms.txt`
- in the repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/js/packages/web/llms.txt)

For deeper behavioral details, pair `llms.txt` with the docs linked above.

## Why This Package

Most browser SDKs stop at auth + CRUD.

`@edge-base/web` is meant to be the single browser entry point for the whole EdgeBase app surface:

| Capability | Included |
|---|---|
| Auth | Email/password, OAuth, sessions, auth state |
| Database | Query, insert, update, delete |
| Database Live | `onSnapshot()` subscriptions |
| Rooms | Presence, room state, signals, media-ready client surface |
| Storage | Uploads, bucket access, file URLs |
| Functions | Call EdgeBase functions from the browser |
| Analytics | Client-side analytics helpers |
| Push | Web push registration and message handling |

## Installation

```bash
npm install @edge-base/web
```

Starting a brand new project?

```bash
npm create edgebase@latest my-app
```

That scaffold creates a full EdgeBase app and wires in the local CLI for development and deployment.

Read more: [Quickstart](https://edgebase.fun/docs/getting-started/quickstart)

## Recommended Project Layout

If you already have a frontend app, a good default is to create EdgeBase inside that project as a dedicated subdirectory:

```bash
cd your-frontend-project
npm create edgebase@latest edgebase
```

That gives you a layout like:

```text
your-frontend-project/
  src/
  app/
  package.json
  edgebase/
    edgebase.config.ts
    functions/
    package.json
```

This is only a recommendation, not a requirement.

You can also:

- create EdgeBase as a completely separate project
- keep frontend and backend in different repos
- use a different subdirectory name if that fits your monorepo better

The main thing we recommend is avoiding scaffolding directly into an existing app root unless that is intentionally how you want to organize the repo.

## Quick Start

```ts
import { createClient } from '@edge-base/web';

const client = createClient('https://your-project.edgebase.fun');

await client.auth.signIn({
  email: 'june@example.com',
  password: 'pass1234',
});

const posts = await client
  .db('app')
  .table('posts')
  .where('published', '==', true)
  .orderBy('createdAt', 'desc')
  .limit(10)
  .getList();

const health = await client.functions.get('health');

console.log(posts.items, health);
```

`app` in the example above is your database block name from `edgebase.config.ts`.

For instance databases, pass both a namespace and an id:

```ts
client.db('workspace', 'ws-123');
client.db('user', 'user-123');
```

Read more: [Client SDK](https://edgebase.fun/docs/database/client-sdk)

## Core API

Once you create a client, these are the main surfaces you will use:

- `client.auth`
  Sign up, sign in, sign out, OAuth, MFA flows, and auth state listeners
- `client.db(namespace, id?)`
  Query tables, mutate records, and subscribe to live changes
- `client.storage`
  Upload files and resolve bucket URLs
- `client.functions`
  Call app functions from the browser
- `client.room(namespace, roomId)`
  Join realtime rooms for presence, state sync, and signals
- `client.analytics`
  Send analytics data from the client
- `client.push`
  Register and manage web push flows

## Auth

### Email and password

```ts
await client.auth.signUp({
  email: 'june@example.com',
  password: 'pass1234',
  data: {
    displayName: 'June',
  },
});

await client.auth.signIn({
  email: 'june@example.com',
  password: 'pass1234',
});

client.auth.onAuthStateChange((user) => {
  console.log('auth changed:', user);
});
```

### OAuth

```ts
await client.auth.signInWithOAuth('google');

const result = await client.auth.handleOAuthCallback();
if (result) {
  console.log('signed in with OAuth:', result.user);
}
```

By default, the browser SDK uses `/auth/callback` on the current origin as the redirect target.

Read more: [Authentication Docs](https://edgebase.fun/docs/authentication)

## Database Queries

```ts
type Post = {
  id: string;
  title: string;
  published: boolean;
  createdAt: string;
};

const posts = client.db('app').table<Post>('posts');

const latest = await posts
  .where('published', '==', true)
  .orderBy('createdAt', 'desc')
  .limit(20)
  .getList();

await posts.insert({
  title: 'Hello EdgeBase',
  published: true,
});
```

Read more: [Database Client SDK](https://edgebase.fun/docs/database/client-sdk)

## Database Live

```ts
const unsubscribe = client
  .db('app')
  .table('posts')
  .onSnapshot((change) => {
    console.log(change.changeType, change.data);
  });

// later
unsubscribe();
```

Use this for feeds, counters, collaborative UIs, moderation dashboards, or any UI that should react instantly to server-side changes.

Read more: [Database Subscriptions](https://edgebase.fun/docs/database/subscriptions)

## Storage

```ts
const bucket = client.storage.bucket('avatars');

await bucket.upload('me.jpg', file);

const publicUrl = bucket.getUrl('me.jpg');
console.log(publicUrl);
```

Read more: [Storage Docs](https://edgebase.fun/docs/storage)

## Functions

```ts
const result = await client.functions.post('contact/send', {
  email: 'june@example.com',
  message: 'Hello from the web SDK',
});

console.log(result);
```

Read more: [Functions Client SDK](https://edgebase.fun/docs/functions/client-sdk)

## Rooms

```ts
const room = client.room('game', 'lobby-1');

await room.join();

room.leave();
```

Use rooms when you need:

- presence
- room state
- peer signals
- multiplayer coordination
- media/session-style realtime flows

Read more: [Room Client SDK](https://edgebase.fun/docs/room/client-sdk)

## Which EdgeBase Package Should You Use?

| Package | Use it when |
|---|---|
| `@edge-base/web` | You are in the browser or another untrusted client runtime |
| `@edge-base/admin` | You need trusted server/admin access |
| `@edge-base/ssr` | You want cookie-based SSR helpers for frameworks like Next.js |
| `@edge-base/auth-ui-react` | You want headless React auth UI built on top of the web SDK |
| `@edge-base/react-native` | You are building a React Native app |

## Docs

- [Quickstart](https://edgebase.fun/docs/getting-started/quickstart)
- [Client SDK](https://edgebase.fun/docs/database/client-sdk)
- [Database Live](https://edgebase.fun/docs/database/subscriptions)
- [Room Client SDK](https://edgebase.fun/docs/room/client-sdk)
- [Authentication Docs](https://edgebase.fun/docs/authentication)
- [Functions Client SDK](https://edgebase.fun/docs/functions/client-sdk)
- [Analytics Client SDK](https://edgebase.fun/docs/analytics/client-sdk)
- [Push Client SDK](https://edgebase.fun/docs/push/client-sdk)

## License

MIT
