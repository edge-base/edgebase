#!/usr/bin/env bash
set -euo pipefail

TARGET_NAME="${1:?missing target name}"
TARGET_PREFIX="${2:?missing subtree prefix}"
DEST_REPO="${3:?missing destination repository}"
SYNC_MODE="${4:?missing sync mode}"
REF_NAME="${5:-}"
PUSH_TOKEN="${EDGEBASE_SPLIT_PUSH_TOKEN:-}"
SOURCE_REF="${6:-HEAD}"

if [[ -z "$PUSH_TOKEN" ]]; then
  echo "Missing EDGEBASE_SPLIT_PUSH_TOKEN." >&2
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel)"
REMOTE_NAME="split-${TARGET_NAME}"
WORKTREE_DIR=""
ASKPASS_SCRIPT="$ROOT/scripts/release-github-askpass.sh"

cleanup() {
  if [[ -n "$WORKTREE_DIR" ]] && [[ -d "$WORKTREE_DIR" ]]; then
    git worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || rm -rf "$WORKTREE_DIR"
  fi
  git remote remove "$REMOTE_NAME" >/dev/null 2>&1 || true
}

trap cleanup EXIT

git_with_auth() {
  GIT_ASKPASS="$ASKPASS_SCRIPT" \
  GIT_TERMINAL_PROMPT=0 \
    git "$@"
}

if [[ "$SYNC_MODE" == "tag" ]]; then
  if [[ -z "$REF_NAME" ]]; then
    echo "Tag sync requires a tag name." >&2
    exit 1
  fi
  SOURCE_VERSION="$(node -p "require('${ROOT}/package.json').version")"
  EXPECTED_TAG="v${SOURCE_VERSION}"
  if [[ "$REF_NAME" != "$EXPECTED_TAG" ]]; then
    echo "Refusing tag sync: ${REF_NAME} does not match prepared release ${EXPECTED_TAG}." >&2
    exit 1
  fi
  HEAD_SHA="$(git rev-parse HEAD^{commit})"
  SOURCE_SHA="$(git rev-parse "${SOURCE_REF}^{commit}")"
  TAG_SHA="$(git rev-parse --verify "${REF_NAME}^{commit}" 2>/dev/null || true)"
  if [[ -z "$TAG_SHA" ]] || [[ "$TAG_SHA" != "$HEAD_SHA" ]] || [[ "$SOURCE_SHA" != "$HEAD_SHA" ]]; then
    echo "Refusing tag sync: ${REF_NAME}, ${SOURCE_REF}, and HEAD must resolve to the same central release commit." >&2
    exit 1
  fi
fi

SPLIT_SHA="$(git subtree split --prefix="$TARGET_PREFIX" "$SOURCE_REF")"
SOURCE_COMMIT_DATE="$(git show -s --format=%cI "$SPLIT_SHA")"
WORKTREE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/edgebase-php-${TARGET_NAME}-XXXXXX")"

git worktree add --detach "$WORKTREE_DIR" "$SPLIT_SHA" >/dev/null
node "$ROOT/scripts/prepare-php-split-package.mjs" \
  --target="$TARGET_NAME" \
  --package-dir="$WORKTREE_DIR" \
  --repo="$DEST_REPO"

if ! git -C "$WORKTREE_DIR" diff --quiet; then
  git -C "$WORKTREE_DIR" add -A
  GIT_AUTHOR_DATE="$SOURCE_COMMIT_DATE" \
  GIT_COMMITTER_DATE="$SOURCE_COMMIT_DATE" \
    git \
    -c user.name="github-actions[bot]" \
    -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    -C "$WORKTREE_DIR" commit -m "chore: prepare ${TARGET_NAME} split package" >/dev/null
fi

FINAL_SHA="$(git -C "$WORKTREE_DIR" rev-parse HEAD)"
REMOTE_URL="https://github.com/${DEST_REPO}.git"

git remote add "$REMOTE_NAME" "$REMOTE_URL"

case "$SYNC_MODE" in
  branch)
    git_with_auth push --force "$REMOTE_NAME" "${FINAL_SHA}:refs/heads/main"
    ;;
  tag)
    REMOTE_TAGS="$(git_with_auth ls-remote --tags "$REMOTE_NAME" "refs/tags/${REF_NAME}" "refs/tags/${REF_NAME}^{}")"
    REMOTE_DIRECT_SHA="$(awk -v ref="refs/tags/${REF_NAME}" '$2 == ref { print $1 }' <<<"$REMOTE_TAGS")"
    REMOTE_DEREF_SHA="$(awk -v ref="refs/tags/${REF_NAME}^{}" '$2 == ref { print $1 }' <<<"$REMOTE_TAGS")"
    REMOTE_TAG_SHA="${REMOTE_DEREF_SHA:-$REMOTE_DIRECT_SHA}"
    if [[ -z "$REMOTE_TAG_SHA" ]]; then
      git_with_auth push "$REMOTE_NAME" "${FINAL_SHA}:refs/tags/${REF_NAME}"
    elif [[ "$REMOTE_TAG_SHA" == "$FINAL_SHA" ]]; then
      echo "${DEST_REPO} tag ${REF_NAME} already points to ${FINAL_SHA}; skipping."
    else
      echo "Refusing to overwrite ${DEST_REPO} tag ${REF_NAME}: remote ${REMOTE_TAG_SHA}, prepared ${FINAL_SHA}." >&2
      exit 1
    fi
    ;;
  *)
    echo "Unsupported sync mode: $SYNC_MODE" >&2
    exit 1
    ;;
esac
