#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  *Username*)
    printf '%s\n' 'x-access-token'
    ;;
  *Password*)
    printf '%s\n' "${EDGEBASE_SPLIT_PUSH_TOKEN:?missing EDGEBASE_SPLIT_PUSH_TOKEN}"
    ;;
  *)
    exit 1
    ;;
esac
