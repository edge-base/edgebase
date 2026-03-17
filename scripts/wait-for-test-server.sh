#!/usr/bin/env bash

set -euo pipefail

PORT="${EDGEBASE_TEST_PORT:-8688}"
BASE_URL="${BASE_URL:-http://localhost:${PORT}}"
TIMEOUT_SECONDS="${EDGEBASE_TEST_STARTUP_TIMEOUT_SECONDS:-90}"
LOG_PATH="${EDGEBASE_TEST_LOG_PATH:-}"
START_TIME=$SECONDS

until curl -fsS "${BASE_URL}/api/health" >/dev/null 2>&1; do
  if (( SECONDS - START_TIME >= TIMEOUT_SECONDS )); then
    echo "Timed out waiting for EdgeBase test server at ${BASE_URL}"
    if [[ -n "$LOG_PATH" && -f "$LOG_PATH" ]]; then
      echo "--- server log tail ---"
      tail -n 200 "$LOG_PATH" || true
      echo "--- end server log tail ---"
    fi
    exit 1
  fi
  sleep 2
done

echo "EdgeBase test server is healthy at ${BASE_URL}"
