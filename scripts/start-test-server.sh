#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${EDGEBASE_TEST_PORT:-8688}"
LOG_PATH="${EDGEBASE_TEST_LOG_PATH:-${ROOT_DIR}/.tmp/edgebase-test-server.log}"
PID_PATH="${EDGEBASE_TEST_PID_PATH:-${ROOT_DIR}/.tmp/edgebase-test-server.pid}"
SHARED_DIST_PATH="${ROOT_DIR}/packages/shared/dist/index.js"

mkdir -p "$(dirname "$LOG_PATH")" "$(dirname "$PID_PATH")"
rm -f "$PID_PATH"

cd "$ROOT_DIR"

if [[ ! -f "$SHARED_DIST_PATH" ]]; then
  echo "Shared package build not found. Building packages/shared..."
  pnpm --dir packages/shared build
fi

nohup env \
  TMPDIR="${TMPDIR:-/tmp}" \
  XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-/tmp}" \
  pnpm --dir packages/server exec wrangler dev --config wrangler.test.toml --port "$PORT" \
  >"$LOG_PATH" 2>&1 &

SERVER_PID=$!
echo "$SERVER_PID" > "$PID_PATH"

echo "Started EdgeBase test server on port ${PORT}"
echo "PID: ${SERVER_PID}"
echo "Log: ${LOG_PATH}"
