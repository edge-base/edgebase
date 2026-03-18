# ── Stage 1: Build ──
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace metadata and sources needed for the build.
# Some workspace packages live below nested paths (for example packages/plugins/*),
# so install must see the full packages tree to link dependencies correctly.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY scripts/ ./scripts/
COPY packages/ packages/

# The public monorepo does not commit a project-local edgebase.config.ts or
# root functions/ tree. Package the framework with empty placeholders and let
# runtime callers inject EDGEBASE_CONFIG or mount their own project files.
RUN mkdir -p functions && \
    printf 'const config = {};\n\nexport default config;\n' > edgebase.config.ts

# Docker self-hosting should use generated-config or EDGEBASE_CONFIG, not local
# Wrangler state or the repository's test-only config shim.
RUN rm -rf packages/server/.wrangler && \
    rm -f packages/server/edgebase.test.config.ts

RUN pnpm install --frozen-lockfile

# Docker runtime only needs built shared artifacts. The Worker itself runs from
# source via wrangler dev, and admin static assets are copied from the checked-in
# packages/admin/build directory in the build context.
RUN pnpm --filter @edgebase/shared build

# ── Stage 2: Runtime ──
FROM node:20-slim

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Install wrangler globally (workerd requires glibc — Alpine not supported)
RUN npm install -g wrangler@4

WORKDIR /app

# Copy built artifacts (production dependencies only)
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/functions ./functions
COPY --from=builder /app/edgebase.config.ts ./edgebase.config.ts
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/turbo.json ./turbo.json
COPY --from=builder /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=builder /app/scripts ./scripts
RUN pnpm install --frozen-lockfile --prod && \
    mkdir -p /app/node_modules/@edgebase && \
    ln -sfn ../../packages/shared /app/node_modules/@edgebase/shared

# Create non-root user for security (with home directory for wrangler config)
RUN addgroup --system edgebase && adduser --system --ingroup edgebase --home /home/edgebase edgebase

# Create data directory for persistence
# Grant write to: /data (persistence), server dir (.dev.vars), node_modules/.mf (miniflare cache)
RUN mkdir -p /data /home/edgebase/.config && \
    chown -R edgebase:edgebase /data /home/edgebase && \
    chown -R edgebase:edgebase /app/packages/server

# Default environment variables
ENV PORT=8787
ENV HOST=0.0.0.0
ENV PERSIST_DIR=/data
ENV WRANGLER_CONFIG=wrangler.toml

# Expose port
EXPOSE 8787

# Health check (use curl instead of wget — Debian slim has neither by default)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const http=require('http');const r=http.get('http://localhost:'+process.env.PORT+'/api/health',s=>{process.exit(s.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.setTimeout(3000,()=>process.exit(1));"

# Switch to non-root user
USER edgebase

# Start EdgeBase via wrangler dev (Miniflare)
# Docker env vars → .dev.vars (wrangler reads secrets from this file)
# Also materialize EDGEBASE_CONFIG into generated-config.ts before startup so
# Docker self-hosting never depends on runtime module-resolution quirks.
WORKDIR /app/packages/server
CMD ["sh", "-c", "\
  if [ ! -f edgebase.test.config.ts ]; then \
    printf 'const config = {};\\n\\nexport default config;\\n' > edgebase.test.config.ts; \
  fi && \
  if [ -n \"$EDGEBASE_CONFIG\" ]; then \
    printf 'const config = %s;\\n\\nexport default config;\\n' \"$EDGEBASE_CONFIG\" > src/generated-config.ts; \
  else \
    printf 'const config = {};\\n\\nexport default config;\\n' > src/generated-config.ts; \
  fi && \
  echo \"# Auto-generated from Docker env vars\" > .dev.vars && \
  [ -n \"$JWT_USER_SECRET\" ] && echo \"JWT_USER_SECRET=$JWT_USER_SECRET\" >> .dev.vars; \
  [ -n \"$JWT_ADMIN_SECRET\" ] && echo \"JWT_ADMIN_SECRET=$JWT_ADMIN_SECRET\" >> .dev.vars; \
  [ -n \"$SERVICE_KEY\" ] && echo \"SERVICE_KEY=$SERVICE_KEY\" >> .dev.vars; \
  [ -n \"$MOCK_FCM_BASE_URL\" ] && echo \"MOCK_FCM_BASE_URL=$MOCK_FCM_BASE_URL\" >> .dev.vars; \
  [ -n \"$EDGEBASE_CONFIG\" ] && echo \"EDGEBASE_CONFIG=$EDGEBASE_CONFIG\" >> .dev.vars; \
  wrangler dev --config ${WRANGLER_CONFIG:-wrangler.toml} --port ${PORT} --ip ${HOST} --persist-to ${PERSIST_DIR}"]
