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

If `frontend` is configured, `pack` includes that separately configured prebuilt bundle in the output artifact.

`pack` does not define frontend behavior by itself. It only copies whatever the independent frontend config points to. See [Static Frontend Guide](/docs/getting-started/static-frontend).

## Output Layout

`pack` starts from the same app bundle shape produced by `build-app`, then adds launcher entrypoints and any platform wrapper needed for the selected format.

Common generated pieces include:

- the bundled runtime and config
- the referenced prebuilt frontend bundle, when separately configured
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

Frontend behavior such as route precedence, `mountPath`, `spaFallback`, and PWA/service worker handling belongs to the separate static frontend configuration, not to packaging itself.

## Current Limits

- `portable` and `archive` are built for the **current platform**
- archive mode is the current single-file distribution path
- native `.exe` and `AppImage` launcher binaries are still future work

## Related Docs

- [Static Frontend Guide](/docs/getting-started/static-frontend)
- [Deployment](/docs/getting-started/deployment)
- [Self-Hosting](/docs/getting-started/self-hosting)
- [CLI Reference](/docs/cli/reference)
