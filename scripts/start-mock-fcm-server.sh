#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${MOCK_FCM_PORT:-9099}"
LOG_PATH="${MOCK_FCM_LOG_PATH:-${ROOT_DIR}/.tmp/mock-fcm-server.log}"
PID_PATH="${MOCK_FCM_PID_PATH:-${ROOT_DIR}/.tmp/mock-fcm-server.pid}"

mkdir -p "$(dirname "$LOG_PATH")" "$(dirname "$PID_PATH")"
rm -f "$PID_PATH"

cd "$ROOT_DIR"

nohup env \
  MOCK_FCM_PORT="$PORT" \
  pnpm --dir packages/cli exec tsx "$ROOT_DIR/scripts/mock-fcm-server.ts" \
  >"$LOG_PATH" 2>&1 &

SERVER_PID=$!
echo "$SERVER_PID" > "$PID_PATH"

echo "Started mock FCM server on port ${PORT}"
echo "PID: ${SERVER_PID}"
echo "Log: ${LOG_PATH}"
