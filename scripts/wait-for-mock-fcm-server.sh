#!/usr/bin/env bash

set -euo pipefail

PORT="${MOCK_FCM_PORT:-9099}"
BASE_URL="${MOCK_FCM_BASE_URL:-http://localhost:${PORT}}"
TIMEOUT_SECONDS="${MOCK_FCM_STARTUP_TIMEOUT_SECONDS:-30}"
LOG_PATH="${MOCK_FCM_LOG_PATH:-}"
START_TIME=$SECONDS

until curl -fsS "${BASE_URL}/health" | grep -Fq '"service":"sdk-mock-fcm-server"'; do
  if (( SECONDS - START_TIME >= TIMEOUT_SECONDS )); then
    echo "Timed out waiting for mock FCM server at ${BASE_URL}"
    if [[ -n "$LOG_PATH" && -f "$LOG_PATH" ]]; then
      echo "--- mock fcm log tail ---"
      tail -n 200 "$LOG_PATH" || true
      echo "--- end mock fcm log tail ---"
    fi
    exit 1
  fi
  sleep 1
done

echo "Mock FCM server is healthy at ${BASE_URL}"
