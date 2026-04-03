FROM node:20-slim

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Install wrangler globally (workerd requires glibc — Alpine not supported)
RUN npm install -g wrangler@4

WORKDIR /app

# The Docker build expects `npx edgebase docker build` to have already created a
# portable app bundle under `.edgebase/targets/docker-app`.
COPY .edgebase/targets/docker-app/ ./

# Create non-root user for security (with home directory for wrangler config)
RUN addgroup --system edgebase && adduser --system --ingroup edgebase --home /home/edgebase edgebase

# Create data directory for persistence
RUN mkdir -p /data /home/edgebase/.config && \
    chown -R edgebase:edgebase /app /data /home/edgebase

# Default environment variables
ENV PORT=8787
ENV HOST=0.0.0.0
ENV PERSIST_DIR=/data
ENV WRANGLER_CONFIG=wrangler.toml

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const http=require('http');const r=http.get('http://localhost:'+process.env.PORT+'/api/health',s=>{process.exit(s.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.setTimeout(3000,()=>process.exit(1));"

USER edgebase

CMD ["sh", "-c", "\
  if [ -n \"$EDGEBASE_CONFIG\" ]; then \
    printf 'const config = %s;\\n\\nexport default config;\\n' \"$EDGEBASE_CONFIG\" > .edgebase/runtime/server/src/generated-config.ts; \
  fi && \
  echo \"# Auto-generated from Docker env vars\" > .dev.vars && \
  [ -n \"$JWT_USER_SECRET\" ] && echo \"JWT_USER_SECRET=$JWT_USER_SECRET\" >> .dev.vars; \
  [ -n \"$JWT_ADMIN_SECRET\" ] && echo \"JWT_ADMIN_SECRET=$JWT_ADMIN_SECRET\" >> .dev.vars; \
  [ -n \"$SERVICE_KEY\" ] && echo \"SERVICE_KEY=$SERVICE_KEY\" >> .dev.vars; \
  [ -n \"$MOCK_FCM_BASE_URL\" ] && echo \"MOCK_FCM_BASE_URL=$MOCK_FCM_BASE_URL\" >> .dev.vars; \
  [ -n \"$EDGEBASE_CONFIG\" ] && echo \"EDGEBASE_CONFIG=$EDGEBASE_CONFIG\" >> .dev.vars; \
  wrangler dev --config ${WRANGLER_CONFIG:-wrangler.toml} --port ${PORT} --ip ${HOST} --persist-to ${PERSIST_DIR} \
"]
