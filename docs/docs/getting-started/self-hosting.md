---
sidebar_position: 4
---

# Self-Hosting Guide

Self-host EdgeBase using Docker containers or direct Node.js execution.

## Why Self-Hosting is Still Fast

EdgeBase runs on [workerd](https://github.com/cloudflare/workerd), an open-source JavaScript runtime built on the V8 engine. The **exact same code** that runs on the cloud edge also runs in Docker/Node.js.

| | Traditional BaaS | EdgeBase (Self-Hosted) |
|---|---|---|
| **DB Access** | Network round-trip (ms) | In-process SQLite (μs) |
| **JS Performance** | Node.js (V8) | workerd (V8) — same engine |
| **Cold Start** | Container boot (seconds) | Always running (0ms) |
| **WebSocket** | Per-connection memory | Hibernation API — $0 idle memory |

SQLite runs in the same thread as the application, so single-query latency is significantly lower than BaaS platforms using network databases. Self-hosting doesn't come with a performance penalty — it can even be faster due to zero network hops.

## Deployment Methods

| | **Cloud Edge** | **Docker** | **Direct** |
|---|---|---|---|
| **Command** | `npx edgebase deploy` | `npx edgebase docker run` | `npx edgebase dev` |
| **Requires** | Cloudflare account | Docker | Node.js 20.19+ (24.x recommended) |
| **Pros** | Global edge, auto-scale, no server management | Single container, data sovereignty | Simplest, run on any VPS |
| **Cons** | Cloud account required | Docker required | Process management needed for production |
| **Cost** | ~$5/mo | VPS only (~$5/mo) | VPS only |
| **Data Location** | Edge data centers | Local server | Local server |

---

## 1. Running with Docker

### Quick Start

```bash
# Build image
npx edgebase docker build

# Run container (background) — auto-generates .env.release with JWT secrets
npx edgebase docker run -d

# Or use docker directly
docker build -t edgebase .
docker run -d -p 8787:8787 -v edgebase-data:/data --env-file .env.release --name edgebase edgebase
```

On first run, `npx edgebase docker run` automatically creates `.env.release` with secure random `JWT_USER_SECRET` and `JWT_ADMIN_SECRET` values. See the [Environment Variables](#environment-variables) section below for details.

If your project defines `frontend.directory` in `edgebase.config.ts`, `npx edgebase docker build` also copies that prebuilt static bundle into the container image and serves it on the same origin as the API. Build the frontend before you run the Docker build so the bundle exists on disk.

### Docker Compose

```bash
# Start
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

### Environment Variables

Workers Secrets are mapped to environment variables in Docker:

```yaml
# docker-compose.yml
services:
  edgebase:
    environment:
      - JWT_USER_SECRET=your-secure-jwt-secret
      - SERVICE_KEY=your-service-key
      - JWT_ADMIN_SECRET=your-admin-jwt-secret
```

Or use an `.env.release` file (recommended — same file used by `npx edgebase deploy`):

```bash
# .env.release
JWT_USER_SECRET=your-secure-jwt-secret
SERVICE_KEY=your-service-key
JWT_ADMIN_SECRET=your-admin-jwt-secret
```

```bash
docker run --env-file .env.release -p 8787:8787 -v edgebase-data:/data edgebase
```

That `SERVICE_KEY` is the same credential consumed by all Admin SDKs.

:::tip
For local Docker development, use `.env.development` instead:
```bash
docker run --env-file .env.development -p 8787:8787 -v edgebase-data:/data edgebase
```
:::

### Data Persistence

All data is stored in the `/data` volume:

| Data | Path | Description |
|---|---|---|
| DO SQLite | `/data/v3/do/` | Database DO state (isolated namespaces, Room/DatabaseLive support data) |
| D1 Auth (`AUTH_DB`) | `/data/v3/d1/` | Auth control plane (users, sessions, OAuth, MFA, admin data) |
| D1 Control (`CONTROL_DB`) | `/data/v3/d1/` | Internal operational metadata (plugin versions, cleanup/backup metadata) |
| R2 Files | `/data/v3/r2/` | Uploaded files |
| KV Data | `/data/v3/kv/` | OAuth state, membership cache |

`AUTH_DB` and `CONTROL_DB` are separate internal D1 databases that share the same persisted base directory. Keeping plugin/control-plane metadata in `CONTROL_DB` avoids mixing operational state into the auth hot path.

---

## 2. Direct workerd Execution

Run directly through the EdgeBase CLI (which starts `wrangler dev`) on a machine with Node.js:

```bash
# Clone or initialize a EdgeBase project
npm create edgebase@latest my-project
cd my-project

# Start the local workerd runtime
npx edgebase dev --port 8787

# Advanced/manual: only when you provide a complete Wrangler config yourself
npx wrangler dev --config ./wrangler.toml --port 8787 --persist-to ./data
```

`npx edgebase dev` is the recommended path. It evaluates `edgebase.config.ts` and injects the managed bindings needed for local development before starting Wrangler.

Use raw `wrangler dev` only for explicit manual setups, such as a dedicated test config, or when your `wrangler.toml` already includes every binding your project needs.

If `frontend` is configured, the local runtime can also serve that prebuilt bundle.

For `mountPath`, `spaFallback`, and route behavior, see [Static Frontend Guide](/docs/getting-started/static-frontend).

### Process Management (PM2 Recommended)

```bash
# Install PM2
npm install -g pm2

# Start EdgeBase
pm2 start "npx edgebase dev --port 8787" --name edgebase

# Configure auto-restart
pm2 startup
pm2 save
```

---

## 3. HTTPS Reverse Proxy

HTTPS is required for production. Use Caddy or Nginx as a reverse proxy.

:::danger Security: Reverse Proxy Required
EdgeBase uses the client IP address for **rate limiting** and **brute-force protection**. On Cloudflare Edge, it trusts `CF-Connecting-IP`. In self-hosted environments (Docker / Direct), it only trusts `X-Forwarded-For` when you set `trustSelfHostedProxy: true` in `edgebase.config.ts`.

**If EdgeBase is exposed directly to the internet without a reverse proxy**, leave `trustSelfHostedProxy: false` so spoofed `X-Forwarded-For` headers are ignored. **If you do run behind Nginx or Caddy**, enable `trustSelfHostedProxy: true` and make sure the proxy overwrites `X-Forwarded-For`.

Without `trustSelfHostedProxy: true`, self-hosted deployments will treat requests as coming from the proxy itself for IP-based features. That is safer by default, but less precise operationally.
:::

```typescript title="edgebase.config.ts"
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  trustSelfHostedProxy: true,
});
```

### Caddy (Recommended — Auto HTTPS)

```bash
# Install Caddy
sudo apt install -y caddy
```

Caddyfile configuration:

```
your-domain.com {
    reverse_proxy localhost:8787 {
        # EdgeBase reads X-Forwarded-For only when trustSelfHostedProxy: true.
        # Overwrite the header with the real client IP.
        header_up X-Forwarded-For {remote_host}
    }
}
```

```bash
sudo systemctl reload caddy
```

> Caddy automatically configures Let's Encrypt. No manual SSL certificate management needed. When `trustSelfHostedProxy: true` is enabled, EdgeBase uses the overwritten `X-Forwarded-For` value for IP-based features.

### Nginx + Let's Encrypt

```bash
# Install Nginx + Certbot
sudo apt install -y nginx certbot python3-certbot-nginx
```

Nginx configuration (`/etc/nginx/sites-available/edgebase`):

```nginx
server {
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # IMPORTANT: Use $remote_addr (not $proxy_add_x_forwarded_for) to prevent
        # clients from injecting fake IPs. This overwrites any client-sent header.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Enable site + SSL
sudo ln -s /etc/nginx/sites-available/edgebase /etc/nginx/sites-enabled/
sudo certbot --nginx -d your-domain.com
sudo systemctl reload nginx
```

:::warning
The `Upgrade` header configuration is required for WebSocket support.
:::

If you enable Service Key `ipCidr` constraints or rely on per-client rate limiting while self-hosting, `trustSelfHostedProxy: true` plus a correctly configured reverse proxy is required.

---

## 4. Backups

EdgeBase provides two backup methods:

| Method | Use Case | Speed |
|------|------|------|
| **Volume Copy** | Restore within the same environment (Docker→Docker, Direct→Direct) | Fast |
| **CLI Portable Backup** | Cross-environment migration (Edge↔Docker↔Direct) | Moderate |

### 4.1 Volume Backup (Same Environment)

The fastest method — directly copy Docker volumes or the `.wrangler/state/` directory.

#### Docker Volume Backup

```bash
# Backup volume (tar archive)
docker run --rm -v edgebase-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/edgebase-backup-$(date +%Y%m%d).tar.gz /data

# Restore volume
docker run --rm -v edgebase-data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/edgebase-backup-20260213.tar.gz -C /
```

#### Direct Execution Backup

```bash
# Backup the .wrangler/state/ directory
tar czf edgebase-backup-$(date +%Y%m%d).tar.gz .wrangler/state/

# Restore
tar xzf edgebase-backup-20260213.tar.gz
```

:::warning
Volume copies only work within the same environment (Docker→Docker, Direct→Direct). For cross-environment migration (e.g., Docker→Edge), use the CLI portable backup below.
:::

### 4.2 CLI Portable Backup (Cross-Environment)

```bash
# DB only (default, fast)
npx edgebase backup create --url <URL> --service-key <KEY>

# DB + secrets (for environment migration — preserves existing JWTs)
npx edgebase backup create --include-secrets

# DB + R2 files (large, slow)
npx edgebase backup create --include-storage

# Full backup (complete migration)
npx edgebase backup create --include-secrets --include-storage

# Backup from Edge environment (enumerates DOs via CF API)
npx edgebase backup create --account-id <CF_ACCOUNT_ID> --api-token <CF_API_TOKEN>
```

Restore:

```bash
# Restore (Wipe & Restore — replaces all existing data)
npx edgebase backup restore --from backup.json --url <target-URL> --service-key <KEY>

# Restore to Edge target
npx edgebase backup restore --from backup.json --account-id <ID> --api-token <TOKEN>
```

:::warning
When using `--include-secrets`, the backup file contains sensitive information. File permissions are automatically set to 600.
:::

### 4.3 Automated Backup (Cron)

```bash
# Daily backup at 3 AM (Docker Volume)
echo "0 3 * * * docker run --rm -v edgebase-data:/data -v /backups:/backup alpine tar czf /backup/edgebase-\$(date +\\%Y\\%m\\%d).tar.gz /data" | crontab -
```

---

## 5. Monitoring

### Health Check

```bash
curl http://localhost:8787/api/health
# → {"status":"ok","version":"0.1.0","timestamp":"2026-03-17T12:00:00.000Z"}
```

### Docker Logs

```bash
# Real-time logs
docker logs -f edgebase

# Last 100 lines
docker logs --tail 100 edgebase
```

### Admin Dashboard

The Admin Dashboard is built into self-hosted deployments:

```
http://your-domain.com/admin
```

Production-style self-hosted deployments do not expose a public first-admin form. Bootstrap the first admin from your project directory instead:

```bash
npx edgebase admin bootstrap --url http://localhost:8787 --service-key <service-key>
```

`npx edgebase docker run` guides you through this automatically for first-time setups. If you lose an admin password later, recover it with `npx edgebase admin reset-password` using the same root Service Key. Admin recovery is CLI-based rather than email-based.

---

## 6. Troubleshooting

| Problem | Solution |
|------|------|
| Port conflict | Use `--port` to specify a different port |
| Data loss | Verify volume mount: `-v edgebase-data:/data` |
| WebSocket disconnects | Check reverse proxy Upgrade header configuration |
| Container not auto-restarting | Verify `--restart unless-stopped` flag |
| Out of memory | Set memory limit with `--memory 512m` |
