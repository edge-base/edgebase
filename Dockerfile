FROM node:20-slim

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Install wrangler globally (workerd requires glibc — Alpine not supported).
# Pinned to the repo's known-good version (matches packages/server and packages/cli
# devDependencies) so image builds are reproducible instead of tracking the 4.x tip.
RUN npm install -g wrangler@4.70.0

WORKDIR /app

# The Docker build expects `npx edgebase docker build` to have already created a
# portable app bundle under `.edgebase/targets/docker-app`.
COPY .edgebase/targets/docker-app/ ./

# Create non-root user for security (with home directory for wrangler config)
RUN addgroup --system edgebase && adduser --system --ingroup edgebase --home /home/edgebase edgebase

# Create data directory for persistence
RUN mkdir -p /data /home/edgebase/.config && \
    chown -R edgebase:edgebase /app /data /home/edgebase

RUN { \
    echo '#!/bin/sh'; \
    echo 'set -eu'; \
    echo ''; \
    echo 'PERSIST_DIR="${PERSIST_DIR:-/data}"'; \
    echo 'HOST="${HOST:-0.0.0.0}"'; \
    echo 'PORT="${PORT:-8787}"'; \
    echo 'WRANGLER_CONFIG="${WRANGLER_CONFIG:-wrangler.toml}"'; \
    echo 'GENERATED_CONFIG_PATH="/app/.edgebase/runtime/server/src/generated-config.ts"'; \
    echo 'ENV_FILE_PATH="/app/.dev.vars"'; \
    echo ''; \
    echo '# The container runs as the non-root `edgebase` user (see USER below), and'; \
    echo '# /app, /data and /home/edgebase are already owned by edgebase from the image'; \
    echo '# build, so the entrypoint no longer needs (and cannot) chown at runtime.'; \
    echo 'mkdir -p "${PERSIST_DIR}" /home/edgebase/.config'; \
    echo ''; \
    echo '# NOTE: EDGEBASE_CONFIG is a JS object literal produced by `npx edgebase docker'; \
    echo '# build`; it is interpolated verbatim into generated-config.ts. Treat it as trusted'; \
    echo '# build output, not untrusted user input. Server owners: harden if this ever'; \
    echo '# becomes attacker-controlled.'; \
    echo 'if [ -n "${EDGEBASE_CONFIG:-}" ]; then'; \
    echo '  printf "%s\n\n%s\n" "const config = ${EDGEBASE_CONFIG};" "export default config;" > "${GENERATED_CONFIG_PATH}"'; \
    echo 'fi'; \
    echo ''; \
    echo '# Secrets are written to a plaintext .dev.vars file because `wrangler dev`'; \
    echo '# (the runtime, see below) reads local vars from that file. This is a documented'; \
    echo '# self-hosting tradeoff (see docs/getting-started/self-hosting.md); the file lives'; \
    echo '# inside the container and is owned by the non-root edgebase user.'; \
    echo 'echo "# Auto-generated from Docker env vars" > "${ENV_FILE_PATH}"'; \
    echo '[ -n "${JWT_USER_SECRET:-}" ] && echo "JWT_USER_SECRET=${JWT_USER_SECRET}" >> "${ENV_FILE_PATH}"'; \
    echo '[ -n "${JWT_ADMIN_SECRET:-}" ] && echo "JWT_ADMIN_SECRET=${JWT_ADMIN_SECRET}" >> "${ENV_FILE_PATH}"'; \
    echo '[ -n "${SERVICE_KEY:-}" ] && echo "SERVICE_KEY=${SERVICE_KEY}" >> "${ENV_FILE_PATH}"'; \
    echo '[ -n "${MOCK_FCM_BASE_URL:-}" ] && echo "MOCK_FCM_BASE_URL=${MOCK_FCM_BASE_URL}" >> "${ENV_FILE_PATH}"'; \
    echo '[ -n "${EDGEBASE_CONFIG:-}" ] && echo "EDGEBASE_CONFIG=${EDGEBASE_CONFIG}" >> "${ENV_FILE_PATH}"'; \
    echo ''; \
    echo 'cd /app'; \
    echo '# `wrangler dev` is intentionally used as the long-lived self-hosted server here'; \
    echo '# (documented design choice, see docs/getting-started/self-hosting.md). The process'; \
    echo '# already runs as the non-root edgebase user via the USER directive below.'; \
    echo 'exec wrangler dev --config "$WRANGLER_CONFIG" --port "$PORT" --ip "$HOST" --persist-to "$PERSIST_DIR" --show-interactive-dev-session=false'; \
  } > /usr/local/bin/edgebase-entrypoint.sh && chmod +x /usr/local/bin/edgebase-entrypoint.sh

# Default environment variables
ENV PORT=8787
ENV HOST=0.0.0.0
ENV PERSIST_DIR=/data
ENV WRANGLER_CONFIG=wrangler.toml
# Ensure wrangler finds its config/cache under the edgebase user's home (Docker's
# USER directive does not set HOME on its own).
ENV HOME=/home/edgebase

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const http=require('http');const r=http.get('http://localhost:'+process.env.PORT+'/api/health',s=>{process.exit(s.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.setTimeout(3000,()=>process.exit(1));"

# Run the entrypoint, healthcheck, and server process as the non-root edgebase user.
USER edgebase

CMD ["/usr/local/bin/edgebase-entrypoint.sh"]
