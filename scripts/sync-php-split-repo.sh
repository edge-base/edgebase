#!/usr/bin/env bash
set -euo pipefail

TARGET_NAME="${1:?missing target name}"
TARGET_PREFIX="${2:?missing subtree prefix}"
DEST_REPO="${3:?missing destination repository}"
SYNC_MODE="${4:?missing sync mode}"
REF_NAME="${5:-}"
PUSH_TOKEN="${6:?missing push token}"

ROOT="$(git rev-parse --show-toplevel)"
REMOTE_NAME="split-${TARGET_NAME}"
WORKTREE_DIR=""
TEMP_TAG=""

cleanup() {
  if [[ -n "$WORKTREE_DIR" ]] && [[ -d "$WORKTREE_DIR" ]]; then
    git worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || rm -rf "$WORKTREE_DIR"
  fi
  git remote remove "$REMOTE_NAME" >/dev/null 2>&1 || true
  if [[ -n "$TEMP_TAG" ]]; then
    git tag -d "$TEMP_TAG" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

SPLIT_SHA="$(git subtree split --prefix="$TARGET_PREFIX" HEAD)"
WORKTREE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/edgebase-php-${TARGET_NAME}-XXXXXX")"

git worktree add --detach "$WORKTREE_DIR" "$SPLIT_SHA" >/dev/null
node "$ROOT/scripts/prepare-php-split-package.mjs" \
  --target="$TARGET_NAME" \
  --package-dir="$WORKTREE_DIR" \
  --repo="$DEST_REPO"

if ! git -C "$WORKTREE_DIR" diff --quiet; then
  git -C "$WORKTREE_DIR" add -A
  git -C "$WORKTREE_DIR" commit -m "chore: prepare ${TARGET_NAME} split package" >/dev/null
fi

FINAL_SHA="$(git -C "$WORKTREE_DIR" rev-parse HEAD)"
REMOTE_URL="https://x-access-token:${PUSH_TOKEN}@github.com/${DEST_REPO}.git"

git remote add "$REMOTE_NAME" "$REMOTE_URL"

case "$SYNC_MODE" in
  branch)
    git push --force "$REMOTE_NAME" "${FINAL_SHA}:refs/heads/main"
    ;;
  tag)
    if [[ -z "$REF_NAME" ]]; then
      echo "Tag sync requires a tag name." >&2
      exit 1
    fi
    TEMP_TAG="split-sync-${TARGET_NAME}-${REF_NAME//\//-}"
    git tag -f "$TEMP_TAG" "$FINAL_SHA" >/dev/null
    git push --force "$REMOTE_NAME" "refs/tags/${TEMP_TAG}:refs/tags/${REF_NAME}"
    ;;
  *)
    echo "Unsupported sync mode: $SYNC_MODE" >&2
    exit 1
    ;;
esac
