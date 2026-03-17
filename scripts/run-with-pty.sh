#!/usr/bin/env bash

set -euo pipefail

TMP_SCRIPT="$(mktemp "${TMPDIR:-/tmp}/edgebase-pty.XXXXXX")"
trap 'rm -f "$TMP_SCRIPT"' EXIT

cat > "$TMP_SCRIPT"
chmod +x "$TMP_SCRIPT"

case "$(uname -s)" in
  Darwin)
    script -q /dev/null bash "$TMP_SCRIPT"
    ;;
  Linux)
    script -qefc "bash '$TMP_SCRIPT'" /dev/null
    ;;
  *)
    bash "$TMP_SCRIPT"
    ;;
esac
