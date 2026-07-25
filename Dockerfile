FROM node:22-slim@sha256:53ada149d435c38b14476cb57e4a7da73c15595aba79bd6971b547ceb6d018bf

# workerd requires glibc, so use Debian slim instead of Alpine. Keep npm pinned
# to the audited release used by consumer runtime images. The generated
# self-host entrypoint owns Wrangler, its gateway, and schedule supervisor and
# does not need a package-manager CLI at runtime. Workerd
# uses the system trust store for outbound HTTPS, so keep the public CA bundle
# in the otherwise-minimal image.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    npm install -g npm@12.0.1 && \
    npm install -g wrangler@4.114.0

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
    echo ''; \
    echo 'mkdir -p "${PERSIST_DIR}" /home/edgebase/.config'; \
    echo 'chown -R edgebase:edgebase "${PERSIST_DIR}" /home/edgebase/.config'; \
    echo ''; \
    echo 'if [ -n "${EDGEBASE_CONFIG:-}" ]; then'; \
    echo '  printf "%s\n\n%s\n" "const config = ${EDGEBASE_CONFIG};" "export default config;" > "${GENERATED_CONFIG_PATH}"'; \
    echo '  chown edgebase:edgebase "${GENERATED_CONFIG_PATH}"'; \
    echo 'fi'; \
    echo ''; \
    echo '# A .dev.vars file makes Wrangler ignore the container process environment.'; \
    echo '# Remove any bundled copy and opt in to process-env bindings so application-'; \
    echo '# specific variables are not silently dropped by the generic EdgeBase image.'; \
    echo 'rm -f /app/.dev.vars'; \
    echo 'export CLOUDFLARE_INCLUDE_PROCESS_ENV="${CLOUDFLARE_INCLUDE_PROCESS_ENV:-true}"'; \
    echo '# Docker ingress is self-hosted. Never let an env file relabel client-supplied'; \
    echo '# CF-Connecting-IP as a Cloudflare-authenticated header.'; \
    echo 'export EDGEBASE_RUNTIME_MODE=self-hosted'; \
    echo ''; \
    echo 'cd /app'; \
    echo 'exec su -s /bin/sh edgebase -c '\''exec node /app/.edgebase/self-host/self-host-docker-entrypoint.mjs'\'''; \
  } > /usr/local/bin/edgebase-entrypoint.sh && chmod +x /usr/local/bin/edgebase-entrypoint.sh

# Default environment variables
ENV PORT=8787
ENV HOST=0.0.0.0
ENV PERSIST_DIR=/data
ENV WRANGLER_CONFIG=wrangler.toml
ENV CLOUDFLARE_INCLUDE_PROCESS_ENV=true
ENV EDGEBASE_RUNTIME_MODE=self-hosted

VOLUME ["/data"]

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const s=process.env.LOCAL_PROTOCOL==='https';const p=s?require('https'):require('http');const r=p.get('http'+(s?'s':'')+'://localhost:'+process.env.PORT+'/__edgebase/health',s?{rejectUnauthorized:false}:{},x=>{process.exit(x.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.setTimeout(3000,()=>process.exit(1));"

USER root

CMD ["/usr/local/bin/edgebase-entrypoint.sh"]
