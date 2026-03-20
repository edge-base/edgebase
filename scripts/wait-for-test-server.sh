#!/usr/bin/env bash

set -euo pipefail

PORT="${EDGEBASE_TEST_PORT:-8688}"
BASE_URL="${BASE_URL:-http://localhost:${PORT}}"
TIMEOUT_SECONDS="${EDGEBASE_TEST_STARTUP_TIMEOUT_SECONDS:-90}"
LOG_PATH="${EDGEBASE_TEST_LOG_PATH:-}"
PID_PATH="${EDGEBASE_TEST_PID_PATH:-}"
START_TIME=$SECONDS

print_log_tail() {
  if [[ -n "$LOG_PATH" && -f "$LOG_PATH" ]]; then
    echo "--- server log tail ---"
    tail -n 200 "$LOG_PATH" || true
    echo "--- end server log tail ---"
  fi
}

check_server_process() {
  if [[ -z "$PID_PATH" || ! -f "$PID_PATH" ]]; then
    return
  fi

  local pid
  pid="$(cat "$PID_PATH" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
    echo "EdgeBase test server process is not running (pid: ${pid})"
    print_log_tail
    exit 1
  fi
}

until curl -fsS "${BASE_URL}/api/health" >/dev/null 2>&1; do
  check_server_process
  if (( SECONDS - START_TIME >= TIMEOUT_SECONDS )); then
    echo "Timed out waiting for EdgeBase test server at ${BASE_URL}"
    print_log_tail
    exit 1
  fi
  sleep 2
done

check_server_process
echo "EdgeBase test server is healthy at ${BASE_URL}"
