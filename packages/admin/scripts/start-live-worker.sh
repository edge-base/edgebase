#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
API_PORT="${EDGEBASE_LIVE_API_PORT:-8788}"
ISOLATION_LABEL="${EDGEBASE_LIVE_ISOLATION_LABEL:-live}"
STATE_ROOT="$ROOT_DIR/.edgebase/dev/$ISOLATION_LABEL"

rm -rf "$STATE_ROOT"

cd "$ROOT_DIR"

exec pnpm exec tsx packages/cli/src/index.ts dev \
	--port "$API_PORT" \
	--host 127.0.0.1 \
	--isolated "$ISOLATION_LABEL" \
	--no-open
