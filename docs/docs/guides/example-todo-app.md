---
title: "Tutorial: Real-Time Todo App"
description: Build a full-stack todo app with authentication, access rules, and real-time updates.
sidebar_position: 8
---

# Tutorial: Real-Time Todo App

Build a complete todo app with user authentication, per-user data isolation, and real-time updates -- all in a single EdgeBase project. No framework required; just vanilla HTML and JavaScript.

By the end of this guide you will have:

- An EdgeBase project with a `todos` table
- Email/password sign-up and sign-in
- Access rules so users can only see and modify their own todos
- A frontend that updates instantly when data changes (DB Live Query)
- A production deploy on Cloudflare

## 1. Create the Project

```bash
npm create edgebase@latest todo-app
cd todo-app
```

The dev server starts automatically. Open the Admin Dashboard at `http://localhost:8787/admin`.

## 2. Define the Schema

Open `edgebase.config.ts` and replace the contents with:

```typescript
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  databases: {
    app: {
      tables: {
        todos: {
          schema: {
            title: { type: 'string', required: true, min: 1, max: 300 },
            completed: { type: 'boolean', default: false },
            userId: { type: 'string', required: true },
          },
          indexes: [{ fields: ['userId', 'createdAt'] }],
          access: {
            read(auth, row) {
              return auth !== null && auth.id === row.userId;
            },
            insert(auth) {
              return auth !== null;
            },
            update(auth, row) {
              return auth !== null && auth.id === row.userId;
            },
            delete(auth, row) {
              return auth !== null && auth.id === row.userId;
            },
          },
          handlers: {
            hooks: {
              beforeInsert: async (auth, data) => {
                // Always stamp the authenticated user's ID
                data.userId = auth.id;
                return data;
              },
            },
          },
        },
      },
    },
  },

  auth: {
    emailAuth: true,
  },

  cors: {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
  },
});
```

Save the file. The dev server picks up config changes automatically.

### What is happening here?

| Section | Purpose |
|---------|---------|
| `databases.app.tables.todos` | Defines a `todos` table inside the `app` DB block (single shared database) |
| `schema` | Three fields: `title` (required string), `completed` (boolean, defaults to `false`), `userId` (required string) |
| `indexes` | Composite index on `userId + createdAt` for fast per-user queries |
| `access` | Users can only read, update, and delete rows where `userId` matches their own `auth.id` |
| `handlers.hooks.beforeInsert` | Overwrites `userId` with the authenticated user's ID server-side, preventing spoofing |
| `auth.emailAuth` | Enables email/password sign-up and sign-in |

:::tip Auto-generated fields
Every record automatically gets `id` (UUID v7), `createdAt`, and `updatedAt`. You do not need to define them in the schema.
:::

## 3. Install the SDK

In a separate terminal, create a frontend directory and install the JavaScript SDK:

```bash
mkdir -p frontend
cd frontend
npm init -y
npm install @edge-base/web
```

## 4. Build the Frontend

Create `frontend/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>EdgeBase Todo App</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 40px auto; padding: 0 16px; }
    h1 { margin-bottom: 24px; }
    .auth-form, .todo-app { margin-bottom: 24px; }
    input[type="email"], input[type="password"], input[type="text"] {
      width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid #ccc; border-radius: 4px;
    }
    button { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; background: #2563eb; color: #fff; }
    button:hover { background: #1d4ed8; }
    button.secondary { background: #6b7280; }
    button.danger { background: #ef4444; font-size: 12px; padding: 4px 8px; }
    .todo-item { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid #eee; }
    .todo-item label { flex: 1; cursor: pointer; }
    .todo-item.completed label { text-decoration: line-through; color: #9ca3af; }
    .status { padding: 8px; margin-bottom: 16px; border-radius: 4px; font-size: 14px; }
    .status.error { background: #fef2f2; color: #dc2626; }
    .status.success { background: #f0fdf4; color: #16a34a; }
    .hidden { display: none; }
    #user-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  </style>
</head>
<body>
  <h1>Todo App</h1>

  <!-- Status messages -->
  <div id="status" class="status hidden"></div>

  <!-- Auth section (visible when logged out) -->
  <div id="auth-section">
    <div class="auth-form">
      <h2 id="auth-title">Sign Up</h2>
      <input type="email" id="email" placeholder="Email" />
      <input type="password" id="password" placeholder="Password" />
      <button id="auth-submit">Sign Up</button>
      <p style="margin-top: 8px; font-size: 14px;">
        <a href="#" id="toggle-auth">Already have an account? Sign In</a>
      </p>
    </div>
  </div>

  <!-- Todo section (visible when logged in) -->
  <div id="todo-section" class="hidden">
    <div id="user-bar">
      <span id="user-email"></span>
      <button class="secondary" id="sign-out-btn">Sign Out</button>
    </div>
    <div class="todo-app">
      <form id="add-form" style="display:flex; gap:8px; margin-bottom:16px;">
        <input type="text" id="new-todo" placeholder="What needs to be done?" style="margin:0;" />
        <button type="submit">Add</button>
      </form>
      <div id="todo-list"></div>
    </div>
  </div>

  <script type="module">
    import { createClient } from '@edge-base/web';

    const client = createClient('http://localhost:8787');
    const todos = client.db('app').table('todos');

    // DOM elements
    const authSection = document.getElementById('auth-section');
    const todoSection = document.getElementById('todo-section');
    const statusEl = document.getElementById('status');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const authSubmit = document.getElementById('auth-submit');
    const authTitle = document.getElementById('auth-title');
    const toggleAuth = document.getElementById('toggle-auth');
    const userEmail = document.getElementById('user-email');
    const signOutBtn = document.getElementById('sign-out-btn');
    const addForm = document.getElementById('add-form');
    const newTodoInput = document.getElementById('new-todo');
    const todoList = document.getElementById('todo-list');

    let isSignUp = true;
    let unsubscribe = null;

    // --- Helpers ---
    function showStatus(msg, type = 'error') {
      statusEl.textContent = msg;
      statusEl.className = `status ${type}`;
      statusEl.classList.remove('hidden');
      setTimeout(() => statusEl.classList.add('hidden'), 4000);
    }

    function showTodoApp(user) {
      authSection.classList.add('hidden');
      todoSection.classList.remove('hidden');
      userEmail.textContent = user.email;
      subscribeTodos();
    }

    function showAuthForm() {
      todoSection.classList.add('hidden');
      authSection.classList.remove('hidden');
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    }

    // --- Auth ---
    toggleAuth.addEventListener('click', (e) => {
      e.preventDefault();
      isSignUp = !isSignUp;
      authTitle.textContent = isSignUp ? 'Sign Up' : 'Sign In';
      authSubmit.textContent = isSignUp ? 'Sign Up' : 'Sign In';
      toggleAuth.textContent = isSignUp
        ? 'Already have an account? Sign In'
        : "Don't have an account? Sign Up";
    });

    authSubmit.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      if (!email || !password) return showStatus('Email and password are required.');
      try {
        if (isSignUp) {
          await client.auth.signUp({ email, password });
          showStatus('Account created!', 'success');
        } else {
          await client.auth.signIn({ email, password });
        }
        const user = client.auth.currentUser;
        if (user) showTodoApp(user);
      } catch (err) {
        showStatus(err.message);
      }
    });

    signOutBtn.addEventListener('click', async () => {
      await client.auth.signOut();
      showAuthForm();
    });

    // --- Todos ---
    function renderTodos(items) {
      todoList.innerHTML = '';
      items.forEach((todo) => {
        const div = document.createElement('div');
        div.className = `todo-item${todo.completed ? ' completed' : ''}`;
        div.innerHTML = `
          <input type="checkbox" ${todo.completed ? 'checked' : ''} />
          <label>${todo.title}</label>
          <button class="danger">Delete</button>
        `;
        div.querySelector('input[type="checkbox"]').addEventListener('change', () => {
          todos.update(todo.id, { completed: !todo.completed });
        });
        div.querySelector('button.danger').addEventListener('click', () => {
          todos.delete(todo.id);
        });
        todoList.appendChild(div);
      });
    }

    function subscribeTodos() {
      if (unsubscribe) unsubscribe();

      // Initial load
      todos
        .where('userId', '==', client.auth.currentUser.id)
        .orderBy('createdAt', 'desc')
        .getList()
        .then(renderTodos);

      // Real-time updates via DB Live Query
      unsubscribe = todos.onSnapshot((event) => {
        // Re-fetch the full list on any change for simplicity
        todos
          .where('userId', '==', client.auth.currentUser.id)
          .orderBy('createdAt', 'desc')
          .getList()
          .then(renderTodos);
      });
    }

    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = newTodoInput.value.trim();
      if (!title) return;
      await todos.insert({ title });
      newTodoInput.value = '';
    });

    // --- Auto-restore session ---
    client.auth.onAuthStateChange((user) => {
      if (user) {
        showTodoApp(user);
      } else {
        showAuthForm();
      }
    });
  </script>
</body>
</html>
```

### Serve it locally

Any static file server works. For example:

```bash
cd frontend
npx serve .
```

Open `http://localhost:3000` (or whatever port your server uses).

## 5. Walk Through the Code

### Authentication

```javascript
// Sign up
await client.auth.signUp({ email, password });

// Sign in
await client.auth.signIn({ email, password });

// Sign out
await client.auth.signOut();

// Listen for auth state changes (also restores sessions on page load)
client.auth.onAuthStateChange((user) => { /* ... */ });
```

The SDK stores tokens in memory and handles refresh automatically. `onAuthStateChange` fires on initial load if a valid session exists, so the user stays logged in across page refreshes.

### CRUD Operations

```javascript
const todos = client.db('app').table('todos');

// Insert -- userId is set server-side by the beforeInsert hook
await todos.insert({ title: 'Buy groceries' });

// Query -- filtered by userId, ordered by creation time
const items = await todos
  .where('userId', '==', currentUser.id)
  .orderBy('createdAt', 'desc')
  .getList();

// Update
await todos.update(todoId, { completed: true });

// Delete
await todos.delete(todoId);
```

:::note Access rules are enforced server-side
Even though the client sends `where('userId', '==', currentUser.id)`, the server independently evaluates `access.read(auth, row)` for every returned row. A malicious client cannot read another user's todos by changing the query.
:::

### Real-Time Updates

```javascript
const unsubscribe = todos.onSnapshot((event) => {
  // event.type is 'added', 'modified', or 'removed'
  // event.data contains the full document (or null for 'removed')
  refreshUI();
});

// Stop listening when done
unsubscribe();
```

`onSnapshot` opens a WebSocket connection to the server. When any client inserts, updates, or deletes a todo, all subscribed clients receive the change event instantly. The subscription respects the table's `read` access rule -- a user only receives events for rows they are authorized to read.

## 6. Test It

1. Open `http://localhost:3000` in two browser windows.
2. Sign up with two different email addresses (one per window).
3. Add todos in one window. They appear instantly (real-time).
4. Confirm that each user only sees their own todos.
5. Toggle a todo's completed state or delete it -- the change propagates in real time.

## 7. Add a beforeInsert Hook (Already Done)

The config above already includes a `beforeInsert` hook that stamps `userId`:

```typescript
handlers: {
  hooks: {
    beforeInsert: async (auth, data) => {
      data.userId = auth.id;
      return data;
    },
  },
},
```

This ensures that even if a client sends a different `userId` in the request body, the server overwrites it with the authenticated user's ID. Combined with the access rules, this guarantees complete per-user isolation in a shared `app` database.

## 8. Deploy to Cloudflare

When you are ready for production:

```bash
npx edgebase deploy
```

This builds and deploys your EdgeBase project to Cloudflare Workers. The CLI outputs your production URL (e.g., `https://todo-app.your-subdomain.workers.dev`).

Update the client URL in your frontend:

```javascript
const client = createClient('https://todo-app.your-subdomain.workers.dev');
```

And update `cors.origin` in your config to include your production frontend domain:

```typescript
cors: {
  origin: [
    'https://your-frontend.com',
    'http://localhost:3000',
  ],
  credentials: true,
},
```

Then redeploy:

```bash
npx edgebase deploy
```

:::tip Release mode
Before deploying to production, set `release: true` at the top of your config. This enforces deny-by-default -- any table or bucket without explicit access rules will reject all requests.

```typescript
export default defineConfig({
  release: true,
  // ...
});
```
:::

## 9. Next Steps

You now have a working full-stack app with auth, access control, and real-time. Here are some ideas to extend it:

- **Add due dates** -- Add a `dueDate: { type: 'datetime' }` field to the schema and sort by it.
- **Full-text search** -- Add `fts: ['title']` to the table config and use `.search('groceries')` on the client.
- **Categories or tags** -- Add a `category` field with `enum: ['work', 'personal', 'shopping']`.
- **Per-user database** -- Move todos to a `user` DB block for physical per-user isolation. Change `client.db('app')` to `client.db('user', userId)` and remove the `userId` field entirely -- each user has their own database.
- **Push notifications** -- Send a reminder when a todo is due using [Push Notifications](/docs/push).
- **File attachments** -- Let users attach images to todos using [Storage](/docs/storage/upload-download).

## See Also

- [Configuration](/docs/getting-started/configuration) -- Full config reference
- [Database Client SDK](/docs/database/client-sdk) -- All CRUD operations
- [Database Subscriptions](/docs/database/subscriptions) -- Real-time change feeds
- [Access Rules](/docs/server/access-rules) -- How access control works
- [Table Hooks](/docs/database/hooks) -- Intercept and transform operations
