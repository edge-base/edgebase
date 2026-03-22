#!/usr/bin/env bash
set -euo pipefail

DEST_REPO="${1:?missing destination repository}"
SYNC_MODE="${2:?missing sync mode}"
REF_NAME="${3:-}"
PUSH_TOKEN="${4:?missing push token}"
PUBLIC_REPO="${5:-$DEST_REPO}"

ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/edgebase-agent-skills-XXXXXX")"
TEMP_TAG=""

cleanup() {
  rm -rf "$WORKTREE_DIR"
}

trap cleanup EXIT

node "$ROOT/tools/agent-skill-gen/export.mjs" --out-dir="$WORKTREE_DIR" --public-repo="$PUBLIC_REPO"
node "$ROOT/tools/agent-skill-gen/verify-export.mjs" --dir="$WORKTREE_DIR" --public-repo="$PUBLIC_REPO"

git -C "$WORKTREE_DIR" init --initial-branch=main >/dev/null
git -C "$WORKTREE_DIR" config user.name "github-actions[bot]"
git -C "$WORKTREE_DIR" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git -C "$WORKTREE_DIR" add -A
git -C "$WORKTREE_DIR" commit -m "chore: sync edgebase agent skills" >/dev/null

REMOTE_URL="https://x-access-token:${PUSH_TOKEN}@github.com/${DEST_REPO}.git"
git -C "$WORKTREE_DIR" remote add origin "$REMOTE_URL"

case "$SYNC_MODE" in
  branch)
    git -C "$WORKTREE_DIR" push --force origin HEAD:refs/heads/main
    ;;
  tag)
    if [[ -z "$REF_NAME" ]]; then
      echo "Tag sync requires a tag name." >&2
      exit 1
    fi
    TEMP_TAG="agent-skills-sync-${REF_NAME//\//-}"
    git -C "$WORKTREE_DIR" tag -f "$TEMP_TAG" >/dev/null
    git -C "$WORKTREE_DIR" push --force origin "refs/tags/${TEMP_TAG}:refs/tags/${REF_NAME}"
    ;;
  *)
    echo "Unsupported sync mode: $SYNC_MODE" >&2
    exit 1
    ;;
esac
