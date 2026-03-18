#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIRS=(
    "$ROOT_DIR/.wrangler/state"
    "$ROOT_DIR/packages/server/.wrangler/state"
)

# ── Colors ──
BOLD='\033[1m'
CYAN='\033[36m'
YELLOW='\033[33m'
GREEN='\033[32m'
RED='\033[31m'
RESET='\033[0m'
ADMIN_PORT="${EDGEBASE_ADMIN_PORT:-5180}"
DEFAULT_SERVER_PORT="${EDGEBASE_SERVER_PORT:-8787}"

find_available_port() {
    local port="$1"
    while lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do
        port=$((port + 1))
    done
    echo "$port"
}

SERVER_PORT="$(find_available_port "$DEFAULT_SERVER_PORT")"

echo -e "${BOLD}${CYAN}EdgeBase Dev${RESET}"
echo ""

# ── Check for existing data ──
DB_COUNT=0
for STATE_DIR in "${STATE_DIRS[@]}"; do
    [ -d "$STATE_DIR" ] || continue
    FOUND_COUNT=$(find "$STATE_DIR" -name "*.sqlite" 2>/dev/null | wc -l | tr -d ' ')
    DB_COUNT=$((DB_COUNT + FOUND_COUNT))
done

if [ "$DB_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}Found existing local data${RESET} ($DB_COUNT database files)"
    echo ""
    echo "  1) Keep existing data"
    echo "  2) Reset all data (fresh start)"
    echo "  3) Reset admin account only (re-register)"
    echo ""
    read -r -p "Choose [1/2/3] (default: 1): " choice

    case "${choice:-1}" in
        2)
            echo ""
            echo -e "${RED}Resetting all local data...${RESET}"
            for STATE_DIR in "${STATE_DIRS[@]}"; do
                rm -rf "$STATE_DIR"
            done
            echo -e "${GREEN}Done.${RESET} All data cleared."
            ;;
        3)
            echo ""
            echo -e "${YELLOW}Resetting admin account...${RESET}"
            for STATE_DIR in "${STATE_DIRS[@]}"; do
                for db in "$STATE_DIR"/v3/d1/miniflare-D1DatabaseObject/*.sqlite; do
                    [ -f "$db" ] || continue
                    # Check if this DB has admin tables
                    if sqlite3 "$db" ".tables" 2>/dev/null | grep -q "_admins"; then
                        sqlite3 "$db" "DELETE FROM _admins; DELETE FROM _admin_sessions;" 2>/dev/null || true
                    fi
                done
            done
            echo -e "${GREEN}Done.${RESET} Admin account cleared — you'll see the setup screen."
            ;;
        *)
            echo ""
            echo -e "${GREEN}Keeping existing data.${RESET}"
            ;;
    esac
    echo ""
fi

# ── Start dev servers ──
echo -e "${BOLD}Starting servers...${RESET}"
echo -e "  Server  → ${CYAN}http://localhost:${SERVER_PORT}${RESET}"
echo -e "  Admin   → ${CYAN}http://localhost:${ADMIN_PORT}/admin${RESET}"
echo ""

cd "$ROOT_DIR"

# Keep the default local workflow on stable ports for the admin dashboard.
# Route the server through the EdgeBase CLI so dev-only temp wrangler bindings
# stay aligned with edgebase.config.ts (for example, single-instance D1 namespaces).
# Use `pnpm dev:turbo` when you want every workspace watcher.

DASH_PID=""
SERVER_PID=""

cleanup() {
    if [ -n "$DASH_PID" ] && kill -0 "$DASH_PID" 2>/dev/null; then
        kill "$DASH_PID" 2>/dev/null || true
    fi
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
    fi
}

trap cleanup EXIT INT TERM

EDGEBASE_ADMIN_PORT="$ADMIN_PORT" EDGEBASE_SERVER_PORT="$SERVER_PORT" pnpm --filter @edge-base/dashboard run dev &
DASH_PID=$!

pnpm exec tsx packages/cli/src/index.ts dev --port "$SERVER_PORT" --no-open &
SERVER_PID=$!

wait "$SERVER_PID"
EXIT_CODE=$?

cleanup
wait "$DASH_PID" "$SERVER_PID" 2>/dev/null || true

exit "$EXIT_CODE"
