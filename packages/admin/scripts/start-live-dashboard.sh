#!/usr/bin/env bash
set -euo pipefail

PACKAGES_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_PORT="${EDGEBASE_LIVE_APP_PORT:-4174}"
API_PORT="${EDGEBASE_LIVE_API_PORT:-8788}"

cd "$PACKAGES_DIR/admin"

export EDGEBASE_ADMIN_PORT="$APP_PORT"
export EDGEBASE_SERVER_PORT="$API_PORT"

exec pnpm exec vite dev --host 127.0.0.1 --port "$APP_PORT"
