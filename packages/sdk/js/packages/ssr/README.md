<h1 align="center">@edge-base/ssr</h1>

<p align="center">
  <b>Server-side auth and data helpers for EdgeBase</b><br>
  Cookie-based session handling for SSR frameworks like Next.js, Remix, Nuxt, and SvelteKit
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@edge-base/ssr"><img src="https://img.shields.io/npm/v/%40edge-base%2Fssr?color=brightgreen" alt="npm"></a>&nbsp;
  <a href="https://edgebase.fun/docs/sdks/nextjs"><img src="https://img.shields.io/badge/docs-ssr-blue" alt="Docs"></a>&nbsp;
  <a href="https://github.com/edge-base/edgebase/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  Next.js · Remix · Nuxt · SvelteKit · Hono SSR
</p>

<p align="center">
  <a href="https://edgebase.fun/docs/sdks/nextjs"><b>Next.js Guide</b></a> ·
  <a href="https://edgebase.fun/docs/sdks/client-vs-server"><b>Client vs Server</b></a> ·
  <a href="https://edgebase.fun/docs/authentication"><b>Authentication</b></a>
</p>

---

`@edge-base/ssr` is the package you use when server-side code should run as the current signed-in user via cookies.

It is built for:

- Server Components
- Route Handlers
- loaders and actions
- SSR middleware and request handlers
- cookie-based session transfer between server and browser code

If you are writing browser code, use [`@edge-base/web`](https://www.npmjs.com/package/@edge-base/web). If you need privileged admin access from the server, use [`@edge-base/admin`](https://www.npmjs.com/package/@edge-base/admin).

EdgeBase is an open-source edge-native BaaS that runs on Edge, Docker, and Node.js. If you want the full platform, CLI, docs, and the rest of the public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

> Beta: the package is already usable, but some APIs may still evolve before general availability.

## Documentation Map

- [Next.js Integration](https://edgebase.fun/docs/sdks/nextjs)
  End-to-end SSR and client setup
- [Client vs Server SDKs](https://edgebase.fun/docs/sdks/client-vs-server)
  Pick the right package for each runtime
- [Authentication](https://edgebase.fun/docs/authentication)
  Session, OAuth, MFA, and cookie-backed auth concepts
- [Database Client SDK](https://edgebase.fun/docs/database/client-sdk)
  Query patterns that also apply to SSR DB access

## For AI Coding Assistants

This package ships with an `llms.txt` file for AI-assisted SSR integration.

You can find it:

- after install: `node_modules/@edge-base/ssr/llms.txt`
- in the repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/js/packages/ssr/llms.txt)

Use it when you want an agent to:

- set up a cookie adapter correctly
- keep browser auth code out of server components
- avoid mixing `ssr`, `web`, and `admin`
- use `getUser()`, `getSession()`, `setSession()`, and `clearSession()` correctly

## Installation

```bash
npm install @edge-base/ssr
```

Most SSR apps also use the browser SDK alongside it:

```bash
npm install @edge-base/web @edge-base/ssr
```

## Quick Start

```ts
import { createServerClient } from '@edge-base/ssr';
import { cookies } from 'next/headers';

export async function createEdgeBaseServer() {
  const cookieStore = await cookies();

  return createServerClient(process.env.EDGEBASE_URL!, {
    cookies: {
      get: (name) => cookieStore.get(name)?.value,
      set: (name, value, options) => {
        try {
          cookieStore.set(name, value, options);
        } catch {
          // read-only contexts such as some Server Components
        }
      },
      delete: (name) => {
        try {
          cookieStore.delete(name);
        } catch {
          // read-only contexts such as some Server Components
        }
      },
    },
  });
}
```

Then use it inside a server-side request flow:

```ts
const client = await createEdgeBaseServer();
const user = client.getUser();

if (user) {
  const posts = await client.db('app').table('posts').getList();
  console.log(posts.items);
}
```

## What This Package Includes

| Surface | Included |
| --- | --- |
| Cookie-backed session tokens | Yes |
| Request-bound user context | Yes |
| `db(namespace, id?)` | Yes |
| `storage` and `functions` | Yes |
| Client-side sign-in UI | No |
| Database live subscriptions | No |
| Rooms / push / browser auth flows | No |
| Service Key admin user management | No |

## Cookie Store Contract

`createServerClient()` expects a cookie adapter with:

- `get(name)`
- `set(name, value, options?)`
- `delete(name)`

That makes it easy to adapt to framework-specific cookie stores while keeping one EdgeBase interface.

## OAuth And Session Transfer

On the server, `@edge-base/ssr` is especially useful for:

- reading the current session from cookies
- writing tokens after a server-side OAuth callback
- clearing session cookies during server-side sign out

Example:

```ts
client.setSession({
  accessToken,
  refreshToken,
});

const session = client.getSession();
console.log(session.accessToken);
```

## Choose The Right Package

| Package | Use it for |
| --- | --- |
| `@edge-base/web` | Browser components and client-side auth flows |
| `@edge-base/ssr` | Server-side code acting as the current signed-in user via cookies |
| `@edge-base/admin` | Trusted server-side code with Service Key access |

## License

MIT
