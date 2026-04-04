---
sidebar_position: 6
---

# Packaging Guide

Use `pack` when you want a **local distributable artifact** instead of a cloud deploy or a Docker image.

`pack` builds from the same self-contained app bundle used by `deploy`, `docker build`, and `dev`, then wraps that bundle for local handoff.

## When To Use `pack`

Use `pack` when you want to:

- hand a runnable build to QA or a teammate
- create a local demo artifact without requiring Node.js setup
- package the same-origin API + frontend bundle into a portable launcher
- generate a single archive for download or offline sharing

Do **not** use `pack` when you want:

- a Cloudflare production deployment — use `npx edgebase deploy`
- a containerized self-hosted runtime — use `npx edgebase docker build`
- an editable local development session — use `npx edgebase dev`

## Formats

```bash
npx edgebase pack --format dir
npx edgebase pack --format portable
npx edgebase pack --format archive
```

| Format | Best for | Output |
|---|---|---|
| `dir` | Inspectable runtime bundle, debugging, custom wrapping | Runnable directory |
| `portable` | Local handoff on the current platform | macOS `.app`, or portable directory on Linux/Windows |
| `archive` | Single-file distribution | `.zip` on macOS/Windows, `.tar.gz` on Linux |

If you omit `--format`, EdgeBase uses the default pack format for the current CLI behavior.

## Basic Flow

### Backend-only app

```bash
npx edgebase pack --format portable
```

### App with a frontend bundle

Build your frontend first, then pack:

```bash
pnpm --filter web build
npx edgebase pack --format portable
```

If `frontend.directory` is configured, the packed artifact includes that prebuilt static bundle and serves it on the same origin as:

- `/api/*`
- `/admin` and `/admin/*`
- `/openapi.json`

Everything else is served from your configured frontend `mountPath`.

## Output Layout

`pack` starts from the same app bundle shape produced by `build-app`, then adds launcher entrypoints and any platform wrapper needed for the selected format.

Common generated pieces include:

- the bundled runtime and config
- the packaged static frontend, when configured
- `launcher.mjs`
- `run.sh` on Unix-like systems
- `run.cmd` on Windows

For `portable` and `archive`, EdgeBase also embeds the current-platform Node runtime.

## Runtime Behavior

Packed launchers default to a local-friendly runtime model:

- bind to `127.0.0.1`
- use a stable high localhost port derived from the app name
- reuse that port across restarts unless overridden
- persist data in an app-specific OS data directory by default
- support explicit overrides such as `--port`, `--data-dir`, and `--persist-to`

Default app-data locations:

- macOS: `~/Library/Application Support/<app>`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/<app>`
- Windows: `%LOCALAPPDATA%\\<app>`

## Frontend Notes

If your frontend already ships a valid `manifest.webmanifest` and service worker, the packed launcher keeps the same-origin setup needed for local PWA-style installs and testing.

When `spaFallback: true` is enabled, only HTML navigation requests fall back to `index.html`. Missing static assets still return `404`.

## Current Limits

- `portable` and `archive` are built for the **current platform**
- archive mode is the current single-file distribution path
- native `.exe` and `AppImage` launcher binaries are still future work

## Related Docs

- [Deployment](/docs/getting-started/deployment)
- [Self-Hosting](/docs/getting-started/self-hosting)
- [CLI Reference](/docs/cli/reference)
