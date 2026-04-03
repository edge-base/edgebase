---
sidebar_position: 3
---

# Deployment

EdgeBase supports three deployment modes. The same code runs identically in all environments.

## Cloud Edge

Global serverless deployment on 300+ edge locations.

```bash
npx edgebase deploy
```

On first deploy, EdgeBase automatically handles Cloudflare authentication:
1. Checks if you're logged in via `wrangler whoami`
2. Opens browser login if needed (no manual `wrangler login` required)
3. Detects your account ID and configures `wrangler.toml` automatically

For `release: true` deployments, the CLI also asks for a bootstrap admin email. If the deployed instance does not have any admin accounts yet, the CLI prompts for the first admin password and creates that account through a Service Key protected admin path instead of exposing a public browser setup form.

| Feature | Detail |
|---------|--------|
| Cold start | ~0ms |
| Scaling | Automatic, global |
| Cost | Free to start (paid plan $5/mo for higher limits) |
| Storage egress | $0 |
| Backup | 30-day PITR |

**Requirements:** Cloudflare account. Core EdgeBase services can start on the Cloudflare Free plan. For higher resource limits, upgrade to the Workers Paid plan ($5/month, account-level — covers all projects).

:::info R2 Storage
<div className="docs-badge-row">
  <span className="docs-badge docs-badge--free">Free Plan</span>
  <span className="docs-badge docs-badge--setup">Billing Setup</span>
</div>

If your app uses `storage` in `edgebase.config.ts`, you must enable R2 in the Cloudflare Dashboard first: **R2 Object Storage → Get Started**. R2 includes 10 GB of free usage, but Cloudflare still requires a one-time R2 subscription / billing activation before first use.
:::

:::tip CI/CD
For non-interactive environments, set `CLOUDFLARE_API_TOKEN` as an environment variable instead.
:::

## Docker

Container-based self-hosting. Runs the same runtime as edge deployment — identical behavior, full data sovereignty.

```bash
npx edgebase docker build
npx edgebase docker run
```

`docker run` automatically creates `.env.release` with secure random JWT secrets and a root `SERVICE_KEY` if the file doesn't exist yet. It also asks for the bootstrap admin email before starting the container, then creates the first admin account over the protected admin API if none exist yet. To customize secrets or use an existing file:

```bash
npx edgebase docker run --env-file .env.release
```

### `.env.release` Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_USER_SECRET` | Yes | Signs user authentication tokens (auto-generated) |
| `JWT_ADMIN_SECRET` | Yes | Signs admin dashboard tokens (auto-generated) |
| `SERVICE_KEY` | Yes | Root server-side API key used for admin bootstrap, recovery, and [Admin SDKs](/docs/admin-sdk/reference) |
| `DB_POSTGRES_*_URL` | Optional | PostgreSQL connection string (used by DB blocks or auth configured with `provider: 'postgres'`; legacy `provider: 'neon'` configs still work) |

:::tip
`JWT_USER_SECRET`, `JWT_ADMIN_SECRET`, and `SERVICE_KEY` are auto-generated when you first run `npx edgebase docker run`. You only need to set them manually if you want to keep existing tokens valid or preserve an existing Service Key across re-deployments.
:::

Or run the equivalent container command yourself:

```bash
docker run -v edgebase-data:/data -p 8787:8787 --env-file .env.release edgebase
```

Or with Docker Compose:

```yaml
version: '3.8'
services:
  edgebase:
    image: edgebase
    ports:
      - '8787:8787'
    volumes:
      - edgebase-data:/data
    environment:
      - JWT_USER_SECRET=your-secret-key
      - JWT_ADMIN_SECRET=your-admin-secret-key
      - SERVICE_KEY=your-service-key
    healthcheck:
      test: ['CMD', 'wget', '-q', '--spider', 'http://localhost:8787/api/health']
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  edgebase-data:
```

The same `SERVICE_KEY` is what all Admin SDKs use for server-side access.

| Feature | Detail |
|---------|--------|
| Cold start | N/A (always running) |
| Scaling | Manual (container orchestration) |
| Cost | VPS cost only (~$5–20/month) |
| Data | Local SQLite files in Docker volume |

**Requirements:** Docker installed.

## Direct Run

Run directly with Node.js — no Docker, no cloud account needed.

```bash
npx edgebase dev
```

| Feature | Detail |
|---------|--------|
| Best for | Development, testing, lightweight production |
| Data | Local filesystem |
| Requirements | Node.js 20.19+ (24.x recommended) |

## Static Frontend Bundles

EdgeBase can serve a prebuilt static frontend bundle on the same origin as your API and admin UI. Add a `frontend` block to `edgebase.config.ts` and point it at a build output directory such as `dist`, `build`, or `.vercel/output/static`.

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

`npx edgebase dev`, `npx edgebase deploy`, `npx edgebase docker build`, and `npx edgebase pack` all consume the same prebuilt bundle. EdgeBase does not run your frontend build for you, so build that directory before you start the runtime, build the container image, or create a packed artifact.

Route precedence stays fixed:

- `/api/*` stays reserved for the EdgeBase API
- `/admin` and `/admin/*` stay reserved for the admin dashboard
- `/openapi.json` stays reserved for the generated OpenAPI document
- the frontend bundle serves everything else from `mountPath` (default `/`)

With `spaFallback: true`, only HTML navigation requests without a file extension fall back to `index.html`. Explicit asset requests such as `/assets/app.js` still return `404` when missing instead of silently loading the app shell.

If your frontend already includes a valid web app manifest and service worker, this same-origin model also keeps the app installable as a PWA across cloud deploys, Docker, direct local dev, and packed local launchers. Packed launchers use a stable high localhost port derived from the app name, then reuse that port across restarts unless you override it. For single-file handoff, `npx edgebase pack --format archive` wraps the current-platform portable launcher into a `.zip` on macOS/Windows or `.tar.gz` on Linux.

## Comparison

| | Edge | Docker | Direct |
|---|---|---|---|
| **Command** | `npx edgebase deploy` | `npx edgebase docker run` | `npx edgebase dev` |
| **Requires** | Cloudflare account | Docker | Node.js only |
| **Scaling** | Auto global | Manual | Single instance |
| **Best for** | Production | Self-hosted prod | Dev / lightweight |
| **Cost** | ~$5–30/month | VPS cost | Free |

## Environment Variables

EdgeBase uses separate files for development and production secrets:

| File | Purpose | Used by |
|------|---------|---------|
| `.env.development` | Local dev secrets | `npx edgebase dev` |
| `.env.release` | Production secrets | `npx edgebase deploy` |

### Edge (Cloudflare Workers)

The simplest approach — put your production secrets in `.env.release` and deploy:

```bash
# Copy the example template and fill in your production keys
cp .env.release.example .env.release

# Deploy — secrets are auto-uploaded to Cloudflare
npx edgebase deploy
```

Or set secrets manually one at a time:

```bash
npx edgebase secret set JWT_USER_SECRET
npx edgebase secret set JWT_ADMIN_SECRET
```

:::info
`SERVICE_KEY` is auto-generated on first deploy — you don't need to set it manually. The deploy command uses that same key to create the first admin account if the project does not already have one.
:::

### Docker / Direct

```bash
# Use the env file directly
npx edgebase docker run --env-file .env.release

# Or pass variables inline
JWT_USER_SECRET=your-secret npx edgebase dev
```
