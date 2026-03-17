#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$SERVER_DIR/../.." && pwd)"

# Default server-package dev to the EdgeBase CLI so local runtime bindings stay
# derived from edgebase.config.ts. Advanced raw wrangler flows still exist via
# `pnpm dev:raw` or an explicit --config flag.
if [[ "${EDGEBASE_USE_RAW_WRANGLER_DEV:-}" == "1" ]]; then
    cd "$SERVER_DIR"
    exec pnpm exec wrangler dev "$@"
fi

for arg in "$@"; do
    if [[ "$arg" == "--config" || "$arg" == --config=* ]]; then
        cd "$SERVER_DIR"
        exec pnpm exec wrangler dev "$@"
    fi
done

if [[ ! -f "$ROOT_DIR/edgebase.config.ts" ]]; then
    echo "edgebase.config.ts not found at repo root; falling back to raw wrangler dev." >&2
    cd "$SERVER_DIR"
    exec pnpm exec wrangler dev "$@"
fi

cd "$ROOT_DIR"
exec pnpm exec tsx packages/cli/src/index.ts dev --no-open "$@"
