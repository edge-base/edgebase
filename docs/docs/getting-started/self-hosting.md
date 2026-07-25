---
sidebar_position: 4
---

# Self-Hosting Guide

Self-host EdgeBase using the protected Docker or pack launcher. `edgebase dev`
and the server package's `dev:raw` command are local-development tools, not
production self-host launchers.

## Why Self-Hosting is Still Fast

EdgeBase runs on [workerd](https://github.com/cloudflare/workerd), an open-source JavaScript runtime built on the V8 engine. The **exact same code** that runs on the cloud edge also runs in Docker/Node.js.

|                    | Traditional BaaS         | EdgeBase (Self-Hosted)           |
| ------------------ | ------------------------ | -------------------------------- |
| **DB Access**      | Network round-trip (ms)  | In-process SQLite (μs)           |
| **JS Performance** | Node.js (V8)             | workerd (V8) — same engine       |
| **Cold Start**     | Container boot (seconds) | Always running (0ms)             |
| **WebSocket**      | Per-connection memory    | Hibernation API — $0 idle memory |

SQLite runs in the same thread as the application, so single-query latency is significantly lower than BaaS platforms using network databases. Self-hosting doesn't come with a performance penalty — it can even be faster due to zero network hops.

## Deployment Methods

|                   | **Cloud Edge**                                | **Docker**                         | **Pack artifact**                         |
| ----------------- | --------------------------------------------- | ---------------------------------- | ----------------------------------------- |
| **Command**       | `npx edgebase deploy`                         | `npx edgebase docker run`          | `npx edgebase pack --format portable`     |
| **Requires**      | Cloudflare account                            | Docker                             | Target-platform host                      |
| **Pros**          | Global edge, auto-scale, no server management | Single container, data sovereignty | Protected launcher without a container    |
| **Cons**          | Cloud account required                        | Docker required                    | Build separately for each target platform |
| **Cost**          | ~$5/mo                                        | VPS only (~$5/mo)                  | VPS only                                  |
| **Data Location** | Edge data centers                             | Local server                       | Local server                              |

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

For extra files referenced by the project Dockerfile, such as an entrypoint or
health-check script, put them in a project-level `docker-context/` directory.
EdgeBase copies those files into its synthetic build context. The generated
`Dockerfile`, `.dockerignore`, and `.edgebase/` bundle are reserved and cannot be
overridden from that directory.

If you provide a custom Dockerfile, its final stage must still execute the
generated protected entrypoint. The CLI rejects shell-form or shadowed final
commands, verifies the built image's effective JSON `Entrypoint`/`Cmd`, and
checks that the referenced bundle files exist inside the image. Bypassing
`.edgebase/self-host/self-host-docker-entrypoint.mjs` is not a supported
production configuration.

### Docker Compose

The Compose file uses `build: .`, and the `Dockerfile` copies the portable app
bundle from `.edgebase/targets/docker-app/`. That directory only exists after you
prepare the Docker context, so generate it first or `docker compose up` will fail
with a `COPY` error. `--context-only` performs this preparation without building
an image or requiring a local Docker daemon.

```bash
# Prerequisite: generate the portable app bundle and Docker build context
npx edgebase docker build --context-only

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
The container forwards the complete process environment to Wrangler, so custom
application variables in the same env file are available to functions and
runtime config as well. The entrypoint removes any bundled `.dev.vars` file;
otherwise Wrangler would ignore the container process environment.

:::tip
For local Docker development, use `.env.development` instead:

```bash
docker run --env-file .env.development -p 8787:8787 -v edgebase-data:/data edgebase
```

:::

### Gateway Resource Bounds

Generated Docker and pack launchers put the public gateway in front of the
loopback Wrangler process. The defaults are finite and can only be replaced by
validated integer environment variables; an invalid value stops startup before
the public port opens.

| Variable | Default | Allowed range |
| --- | ---: | ---: |
| `EDGEBASE_GATEWAY_MAX_CONNECTIONS` | 512 | 1–65,535 |
| `EDGEBASE_GATEWAY_MAX_REQUEST_BODY_BYTES` | 5 GiB | 1 byte–5 GiB |
| `EDGEBASE_GATEWAY_HEADERS_TIMEOUT_MS` | 15 seconds | 1–300,000 ms |
| `EDGEBASE_GATEWAY_REQUEST_TIMEOUT_MS` | 15 minutes | 1–86,400,000 ms |
| `EDGEBASE_GATEWAY_IDLE_TIMEOUT_MS` | 30 seconds | 1–3,600,000 ms |
| `EDGEBASE_GATEWAY_KEEP_ALIVE_TIMEOUT_MS` | 5 seconds | 1–300,000 ms |
| `EDGEBASE_GATEWAY_UPSTREAM_TIMEOUT_MS` | 5 minutes | 1–3,600,000 ms |
| `EDGEBASE_GATEWAY_EVENT_COALESCE_WINDOW_MS` | 5 seconds | 1–60,000 ms |
| `EDGEBASE_GATEWAY_MIN_FREE_BYTES` | 512 MiB | Nonnegative safe integer bytes |
| `EDGEBASE_GATEWAY_RECOVERY_FREE_BYTES` | minimum + 128 MiB | Safe integer bytes greater than the minimum |

The request limit is counted while streaming and rejects a declared or chunked
request before any byte beyond the cap reaches Wrangler. Five GiB preserves the
public maximum multipart-part contract; the standard JavaScript SDK uses 5 MiB
parts. Established WebSocket connections are exempt from HTTP idle and upstream
timeouts, while the connection admission cap still bounds the listening socket.

Gateway-generated warnings and errors contain only controlled event metadata,
such as the event class, reason, status, count, and a sanitized error code. They
never include a request URL, query, headers, body, credentials, or client
identity. The first event in a class is written immediately; repeats within the
collection window are summarized by the next event or during shutdown.

The gateway samples the persistence filesystem at a shared 250 ms cadence. It
stops admitting new HTTP, HEAD, and WebSocket work with `507 Insufficient
Storage` before free space crosses the configured reserve, reports blocked
health, and resumes only after the recovery watermark is reached. Existing
admitted work drains normally. A filesystem probe failure stays closed with a
retryable `503`; neither response exposes filesystem paths or request data.
These values reserve operating headroom only and do not impose an application
storage quota.

### Data Persistence

All data is stored in the `/data` volume:

| Data                      | Path           | Description                                                              |
| ------------------------- | -------------- | ------------------------------------------------------------------------ |
| DO SQLite                 | `/data/v3/do/` | Database/room state plus key-sharded atomic OAuth callback state         |
| D1 Auth (`AUTH_DB`)       | `/data/v3/d1/` | Auth control plane (users, sessions, OAuth, MFA, admin data)             |
| D1 Control (`CONTROL_DB`) | `/data/v3/d1/` | Internal operational metadata (plugin versions, cleanup/backup metadata) |
| R2 Files                  | `/data/v3/r2/` | Uploaded files                                                           |
| KV Data                   | `/data/v3/kv/` | Ephemeral caches and best-effort legacy OAuth migration mirror           |

`AUTH_DB` and `CONTROL_DB` are separate internal D1 databases that share the same persisted base directory. Keeping plugin/control-plane metadata in `CONTROL_DB` avoids mixing operational state into the auth hot path.

---

## 2. Packed Host Execution

Build a protected directory or portable artifact for the target host:

```bash
# Clone or initialize an EdgeBase project
npm create edgebase@latest my-project
cd my-project

# Directory artifact (requires Node.js on the target host)
npx edgebase pack --format dir --output ./dist/my-app
node ./dist/my-app/launcher.mjs

# Or a target-platform artifact with an embedded runtime
npx edgebase pack --format portable --output ./dist/my-app
```

The generated launcher verifies one immutable app generation, starts Wrangler
only on loopback, authenticates the exact runtime generation and schedule
digest, validates durable schedule state, completes the first supervisor pass,
and opens the public gateway last. It owns the complete child process group and
removes temporary runtime-secret files on normal startup failure or shutdown.
It uses the same gateway resource variables and metadata-only operational
events described above.

Schedule state is a rebuildable launcher cursor; the runtime's separate durable
delivery keys remain the execution authority. If a regular state file is
truncated, oversized, or belongs to an incompatible schema, the launcher moves
its exact bytes to one fixed `.corrupt` sibling, logs that path, and regenerates
state from the signed manifest. A later incident replaces that one sidecar, so
quarantine history cannot grow without bound. Permission failures, non-regular
paths, and a sidecar that cannot be replaced still fail startup closed.

Do not replace the launcher with raw `wrangler dev`. Raw Wrangler, `edgebase
dev`, and `dev:raw` omit production gateway admission, durable managed-schedule
supervision, and bounded process-group shutdown. They remain useful for local
development and dedicated tests only.

If `frontend` is configured, the local runtime can also serve that prebuilt bundle.

For `mountPath`, `spaFallback`, and route behavior, see [Static Frontend Guide](/docs/getting-started/static-frontend).

### Process Management

```bash
# Install PM2
npm install -g pm2

# Start the generated launcher
pm2 start ./dist/my-app/launcher.mjs --interpreter node --name edgebase

# Configure auto-restart
pm2 startup
pm2 save
```

---

## 3. HTTPS Reverse Proxy

HTTPS is required for production. Use Caddy or Nginx as a reverse proxy.

:::danger Security: Name Every Trusted Proxy Peer
EdgeBase uses a verified user ID for ordinary authenticated API limits, and the
client IP address for anonymous/auth/custom-Bearer limits, brute-force
protection, and service-key network constraints. Generated Docker and pack
gateways discard client-supplied
forwarding headers and write their own values. They preserve an upstream
`X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host` set only when the
immediate peer matches `EDGEBASE_TRUSTED_PROXY_CIDRS`.

Set that variable to the exact Caddy/Nginx peer addresses or CIDRs. Do not use
a broad private network when other workloads can connect from it. The gateway
adds a fresh internal proof before forwarding to the Worker, and strips any
client copy of that proof first. A matching public header alone therefore
cannot establish proxy authority.
:::

```bash title=".env.release"
# Example only: use the actual immediate proxy peers for your topology.
EDGEBASE_TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128
```

For direct TLS at the generated gateway, set `LOCAL_PROTOCOL=https` together
with both `HTTPS_CERT_PATH` and `HTTPS_KEY_PATH`. The production launcher does
not generate or silently fall back to a self-signed certificate.

### Caddy (Recommended — Auto HTTPS)

```bash
# Install Caddy
sudo apt install -y caddy
```

Caddyfile configuration:

```
your-domain.com {
    reverse_proxy localhost:8787 {
        # EdgeBase preserves this set only when Caddy's peer address is listed
        # in EDGEBASE_TRUSTED_PROXY_CIDRS.
        header_up X-Forwarded-For {remote_host}
    }
}
```

```bash
sudo systemctl reload caddy
```

> Caddy automatically configures Let's Encrypt. No manual SSL certificate
> management is needed. Add Caddy's immediate peer address to
> `EDGEBASE_TRUSTED_PROXY_CIDRS`; the generated gateway then preserves Caddy's
> overwritten forwarding set and proves that gateway hop to the Worker.

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

If you enable Service Key `ipCidr` constraints or rely on per-client rate
limiting behind a reverse proxy, exact `EDGEBASE_TRUSTED_PROXY_CIDRS` peer
configuration plus overwritten forwarding headers is required.

---

## 4. Backups

EdgeBase provides two backup methods:

| Method                  | Use Case                                                           | Speed    |
| ----------------------- | ------------------------------------------------------------------ | -------- |
| **Volume/data copy**    | Restore within the same environment (Docker→Docker, pack→pack) | Fast     |
| **CLI Portable Backup** | Cross-environment migration (Edge↔Docker↔pack)                | Moderate |

### 4.1 Volume Backup (Same Environment)

The fastest method is to stop the launcher and copy its Docker volume or pack
data directory as one coherent unit.

#### Docker Volume Backup

```bash
# Backup volume (tar archive)
docker run --rm -v edgebase-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/edgebase-backup-$(date +%Y%m%d).tar.gz /data

# Restore volume
docker run --rm -v edgebase-data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/edgebase-backup-20260213.tar.gz -C /
```

#### Pack Launcher Data Backup

```bash
# Launch with an explicit, easy-to-back-up data root
node ./dist/my-app/launcher.mjs --data-dir ./edgebase-data

# After stopping the launcher, back up that complete directory
tar czf edgebase-backup-$(date +%Y%m%d).tar.gz edgebase-data/

# Restore
tar xzf edgebase-backup-20260213.tar.gz
```

:::warning
Filesystem copies only work within the same runtime/storage environment. For
cross-environment migration (for example Docker→Edge or pack→Docker), use the
CLI portable backup below.
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
curl http://localhost:8787/__edgebase/health
# → {"schemaVersion":1,"outcome":"ok","product":"proxy-ready","scheduler":{...}}

# Check the EdgeBase application runtime separately.
curl http://localhost:8787/api/health
# → {"status":"ok","version":"0.5.0"}
```

The endpoint returns `200` for structurally ready `ready`, `running`, or
`degraded` scheduler states, and `503` with `outcome: "blocked"` before
admission, after a structural failure, or during shutdown. A degraded item
remains visible in the scheduler payload without hiding the healthy product
surface. Use a real application route as a separate functional check.

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

| Problem                       | Solution                                         |
| ----------------------------- | ------------------------------------------------ |
| Port conflict                 | Use `--port` to specify a different port         |
| Data loss                     | Verify volume mount: `-v edgebase-data:/data`    |
| WebSocket disconnects         | Check reverse proxy Upgrade header configuration |
| Container not auto-restarting | Verify `--restart unless-stopped` flag           |
| Out of memory                 | Set memory limit with `--memory 512m`            |
