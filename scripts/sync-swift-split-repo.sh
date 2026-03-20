#!/usr/bin/env bash
set -euo pipefail

TARGET_NAME="${1:?missing target name}"
TARGET_PREFIX="${2:?missing subtree prefix}"
DEST_REPO="${3:?missing destination repository}"
CORE_REPO="${4:?missing core repository}"
SYNC_MODE="${5:?missing sync mode}"
REF_NAME="${6:-}"
PUSH_TOKEN="${7:?missing push token}"
SOURCE_REF="${8:-HEAD}"

ROOT="$(git rev-parse --show-toplevel)"
REMOTE_NAME="swift-split-${TARGET_NAME}"
WORKTREE_DIR=""
TEMP_TAG=""
DISPLAY_VERSION="$(node -p "require('${ROOT}/package.json').version")"

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

SPLIT_SHA="$(git subtree split --prefix="$TARGET_PREFIX" "$SOURCE_REF")"
WORKTREE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/edgebase-swift-${TARGET_NAME}-XXXXXX")"

git worktree add --detach "$WORKTREE_DIR" "$SPLIT_SHA" >/dev/null
node "$ROOT/scripts/prepare-swift-split-package.mjs" \
  --target="$TARGET_NAME" \
  --package-dir="$WORKTREE_DIR" \
  --core-repo="$CORE_REPO" \
  --sync-mode="$SYNC_MODE" \
  --display-version="$DISPLAY_VERSION"

if ! git -C "$WORKTREE_DIR" diff --quiet; then
  git -C "$WORKTREE_DIR" add -A
  git -C "$WORKTREE_DIR" commit -m "chore: prepare ${TARGET_NAME} swift split package" >/dev/null
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
    TEMP_TAG="swift-split-sync-${TARGET_NAME}-${REF_NAME//\//-}"
    git tag -f "$TEMP_TAG" "$FINAL_SHA" >/dev/null
    git push --force "$REMOTE_NAME" "refs/tags/${TEMP_TAG}:refs/tags/${REF_NAME}"
    ;;
  *)
    echo "Unsupported sync mode: $SYNC_MODE" >&2
    exit 1
    ;;
esac
