---
sidebar_position: 7
title: Static Frontend Guide
---

# Static Frontend Guide

Use `frontend` when you want EdgeBase to serve a prebuilt static app from the same origin as your API and admin UI.

## What `frontend` Controls

```ts title="edgebase.config.ts"
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  frontend: {
    directory: './web/dist',
    mountPath: '/',
    spaFallback: true,
  },
});
```

| Field | Meaning |
| --- | --- |
| `directory` | Required build output directory to serve |
| `mountPath` | Optional URL prefix for the bundle, default `/` |
| `spaFallback` | Optional SPA navigation fallback to `index.html` for HTML requests |

## Build Responsibility

EdgeBase does not run your frontend build command for you.

Build the bundle first, then run the command you want:

```bash
pnpm --filter web build
npx edgebase dev
```

Or:

```bash
pnpm --filter web build
npx edgebase deploy
```

Or:

```bash
pnpm --filter web build
npx edgebase pack --format portable
```

The same built output can be used with `dev`, `deploy`, `docker build`, and `pack`.

## Request Routing

When `frontend` is configured, route precedence stays fixed:

- `/api/*` stays reserved for the EdgeBase API
- `/admin` and `/admin/*` stay reserved for the admin dashboard
- `/openapi.json` stays reserved for the generated OpenAPI document
- the frontend bundle serves everything else from `mountPath`

This means static frontend serving is layered on top of the EdgeBase runtime surface rather than replacing it.

## SPA Fallback And Asset Requests

With `spaFallback: true`:

- HTML navigation requests without a file extension can fall back to `index.html`
- missing asset requests such as `/assets/app.js` still return `404`

This keeps SPA navigation behavior and static asset behavior distinct.

## PWA Notes

If your frontend bundle already includes a valid `manifest.webmanifest` and service worker, the same-origin setup also works for PWA installs and local testing.

That PWA behavior comes from the frontend bundle itself plus same-origin serving.

## How Other Commands Relate

How these commands use the built bundle:

- `dev` starts a local runtime
- `deploy` publishes a cloud runtime
- `docker build` / `docker run` build and run a containerized runtime
- `pack` creates a portable local artifact

If `frontend` is configured, each of those commands can use the same prebuilt static bundle.

## Related Docs

- [Deployment](/docs/getting-started/deployment)
- [Packaging Guide](/docs/getting-started/packaging)
- [Self-Hosting Guide](/docs/getting-started/self-hosting)
- [CLI Reference](/docs/cli/reference#static-frontend-config)
