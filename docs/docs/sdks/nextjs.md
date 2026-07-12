---
sidebar_position: 5
---

# Next.js Integration

Use EdgeBase as the backend for your Next.js app with full SSR support.

## Installation

```bash
npm install @edge-base/web @edge-base/ssr
```

## Environment Variables

```bash
# .env.local
EDGEBASE_URL=https://your-project.edgebase.fun
EDGEBASE_SERVICE_KEY=your-service-key
NEXT_PUBLIC_EDGEBASE_URL=https://your-project.edgebase.fun
```

## Client Setup

### Browser Client

For client-side components (`'use client'`), use `@edge-base/web`:

```typescript
// lib/edgebase-client.ts
'use client';

import { createClient } from '@edge-base/web';

export const client = createClient(process.env.NEXT_PUBLIC_EDGEBASE_URL!, {
  refreshTokenTransport: 'httpOnlyCookie',
});
```

Enable `auth.session.cookie` on the EdgeBase server. Cross-origin deployments
also require the exact Next.js origin in `cors.origin`,
`cors.credentials: true`, and a cookie `sameSite` mode compatible with the
topology; same-origin deployment is more reliable.

### SSR Client (App Router)

For Server Components and Route Handlers, use `@edge-base/ssr`:

```typescript
// lib/edgebase-server.ts
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
          // set() throws in Server Components (read-only context)
        }
      },
      delete: (name) => {
        try {
          cookieStore.delete(name);
        } catch {
          // delete() throws in Server Components
        }
      },
    },
  });
}
```

### Admin Client (Server-Only)

For admin operations that don't need user context:

The same `EDGEBASE_SERVICE_KEY` can be used from any Admin SDK.

```typescript
// lib/edgebase-admin.ts
import { createAdminClient } from '@edge-base/admin';

export const admin = createAdminClient(process.env.EDGEBASE_URL!, {
  serviceKey: process.env.EDGEBASE_SERVICE_KEY,
});
```

## Server Components

Read data on the server with the authenticated user's context:

```tsx
// app/dashboard/page.tsx
import { createEdgeBaseServer } from '@/lib/edgebase-server';

export default async function DashboardPage() {
  const client = await createEdgeBaseServer();
  const user = client.getUser();

  if (!user) {
    return <p>Please sign in.</p>;
  }

  // Query runs with the user's auth context — access rules apply
  const { items: posts } = await client.db('app').table('posts')
    .where('authorId', '==', user.id)
    .orderBy('createdAt', 'desc')
    .limit(20)
    .getList();

  return (
    <div>
      <h1>Welcome, {user.displayName ?? user.email}</h1>
      {posts.map((post) => (
        <article key={post.id}>
          <h2>{post.title}</h2>
        </article>
      ))}
    </div>
  );
}
```

## Client Components

Interactive components use the browser client:

```tsx
// components/LikeButton.tsx
'use client';

import { client } from '@/lib/edgebase-client';
import { increment } from '@edge-base/core';

export function LikeButton({ postId }: { postId: string }) {
  const handleLike = async () => {
    await client.db('app').table('posts').doc(postId).update({
      likes: increment(1),
    });
  };

  return <button onClick={handleLike}>Like</button>;
}
```

## Authentication

### Auth Provider

```tsx
// components/AuthProvider.tsx
'use client';

import { client } from '@/lib/edgebase-client';
import { createContext, useContext, useEffect, useState } from 'react';

type User = typeof client.auth.currentUser;
const AuthContext = createContext<User>(null);

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);

  useEffect(() => {
    return client.auth.onAuthStateChange((user) => {
      setUser(user);
    });
  }, []);

  return <AuthContext.Provider value={user}>{children}</AuthContext.Provider>;
}
```

### Sign In / Sign Up

```tsx
// app/login/page.tsx
'use client';

import { client } from '@/lib/edgebase-client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    await client.auth.signIn({ email, password });
    router.push('/dashboard');
  };

  return (
    <form onSubmit={handleSignIn}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit">Sign In</button>
    </form>
  );
}
```

### OAuth Callback (Client Component)

EdgeBase returns app-callback fields in the URL fragment. Browsers never send a
fragment to a Next.js Route Handler, middleware, Server Component, or server
log, so those server surfaces cannot complete the callback. Start and finish
OAuth with the browser SDK:

```tsx
// Example login action
client.auth.signInWithOAuth('google', {
  redirectUrl: `${window.location.origin}/auth/callback`,
});
```

```tsx
// app/auth/callback/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { client } from '@/lib/edgebase-client';

export default function OAuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    let active = true;

    void client.auth.handleOAuthCallback().then((result) => {
      if (!active) return;
      router.replace(result ? '/dashboard' : '/login?error=oauth_failed');
    });

    return () => {
      active = false;
    };
  }, [router]);

  return <p>Completing sign-in…</p>;
}
```

With `refreshTokenTransport: 'httpOnlyCookie'`, EdgeBase stores and rotates the
refresh credential on the EdgeBase origin and the callback fragment contains
only a five-minute `oauth_exchange_ticket`, transport marker, and SDK binding
nonce. The handler removes those fields, consumes the nonce, and atomically
posts the ticket to `/api/auth/oauth/exchange`; that response establishes the
server-managed cookie and returns the access token. Do not copy bearer values
from a query string into application cookies—no bearer value belongs in this
callback URL at all.

## Middleware

Protect routes and refresh tokens in Next.js middleware:

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@edge-base/ssr';

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  const client = createServerClient(process.env.EDGEBASE_URL!, {
    cookies: {
      get: (name) => request.cookies.get(name)?.value,
      set: (name, value, options) => {
        response.cookies.set(name, value, options);
      },
      delete: (name) => {
        response.cookies.delete(name);
      },
    },
  });

  const user = client.getUser();

  // Redirect unauthenticated users to login
  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/dashboard/:path*', '/settings/:path*'],
};
```

## Subscriptions

Use `useEffect` for subscription lifecycle management in React components:

### DB Subscriptions

```tsx
'use client';
import { useEffect, useState } from 'react';
import { client } from '@/lib/edgebase';
import type { Post } from '@/edgebase.d.ts';

export function LivePosts() {
  const [posts, setPosts] = useState<Post[]>([]);

  useEffect(() => {
    const unsub = client.db('app').table<Post>('posts').onSnapshot((snapshot) => {
      setPosts(snapshot.items);
    });

    return unsub; // Cleanup on unmount
  }, []);

  return (
    <ul>
      {posts.map(post => <li key={post.id}>{post.title}</li>)}
    </ul>
  );
}
```

### Presence (via Room)

Presence tracking is now part of the Room API. Use `client.room()` to create a room connection and `room.members` for presence:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { client } from '@/lib/edgebase';

export function OnlineUsers() {
  const [users, setUsers] = useState<Array<{ id: string; state: Record<string, unknown> }>>([]);

  useEffect(() => {
    const room = client.room('presence', 'online-users');

    room.connect().then(() => {
      room.members.setState({ name: 'Jane', status: 'active' });
    });

    const sub = room.members.onSync((allMembers) => {
      setUsers(allMembers);
    });

    return () => {
      sub.unsubscribe();
      room.leave();
    };
  }, []);

  return <div>{users.length} online</div>;
}
```

:::note
Database subscriptions are **client-side only** — they use WebSocket connections that require a browser environment. Do not use them in Server Components.
:::

## Pages Router

For the Pages Router, create a cookie wrapper for `getServerSideProps`:

```typescript
// lib/edgebase-pages.ts
import { createServerClient } from '@edge-base/ssr';
import type { GetServerSidePropsContext } from 'next';
import { serialize, parse } from 'cookie';

export function createEdgeBasePages(context: GetServerSidePropsContext) {
  const cookies = parse(context.req.headers.cookie ?? '');

  return createServerClient(process.env.EDGEBASE_URL!, {
    cookies: {
      get: (name) => cookies[name],
      set: (name, value, options) => {
        context.res.appendHeader(
          'Set-Cookie',
          serialize(name, value, {
            httpOnly: options?.httpOnly,
            secure: options?.secure,
            sameSite: options?.sameSite as 'strict' | 'lax' | 'none',
            maxAge: options?.maxAge,
            path: options?.path ?? '/',
          }),
        );
      },
      delete: (name) => {
        context.res.appendHeader(
          'Set-Cookie',
          serialize(name, '', { maxAge: 0, path: '/' }),
        );
      },
    },
  });
}
```

```tsx
// pages/dashboard.tsx
import { createEdgeBasePages } from '@/lib/edgebase-pages';
import type { GetServerSidePropsContext } from 'next';

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const client = createEdgeBasePages(context);
  const user = client.getUser();

  if (!user) {
    return { redirect: { destination: '/login', permanent: false } };
  }

  const { items: posts } = await client.db('app').table('posts')
    .where('authorId', '==', user.id)
    .getList();

  return { props: { user, posts } };
}

export default function DashboardPage({ user, posts }) {
  return (
    <div>
      <h1>Welcome, {user.displayName}</h1>
      {posts.map((post) => (
        <article key={post.id}>{post.title}</article>
      ))}
    </div>
  );
}
```
