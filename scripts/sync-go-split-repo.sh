#!/usr/bin/env bash
set -euo pipefail

DEST_REPO="${1:?missing destination repository}"
SYNC_MODE="${2:?missing sync mode}"
REF_NAME="${3:-}"
SOURCE_REF="${4:-HEAD}"
PUSH_TOKEN="${EDGEBASE_SPLIT_PUSH_TOKEN:-}"

if [[ -z "$PUSH_TOKEN" ]]; then
  echo "Missing EDGEBASE_SPLIT_PUSH_TOKEN." >&2
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel)"
REMOTE_NAME="go-split-release"
ASKPASS_SCRIPT="$ROOT/scripts/release-github-askpass.sh"
TARGET_PREFIX="packages/sdk/go"

cleanup() {
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
REMOTE_URL="https://github.com/${DEST_REPO}.git"
git remote add "$REMOTE_NAME" "$REMOTE_URL"

case "$SYNC_MODE" in
  branch)
    git_with_auth push --force "$REMOTE_NAME" "${SPLIT_SHA}:refs/heads/main"
    ;;
  tag)
    REMOTE_TAGS="$(git_with_auth ls-remote --tags "$REMOTE_NAME" "refs/tags/${REF_NAME}" "refs/tags/${REF_NAME}^{}")"
    REMOTE_DIRECT_SHA="$(awk -v ref="refs/tags/${REF_NAME}" '$2 == ref { print $1 }' <<<"$REMOTE_TAGS")"
    REMOTE_DEREF_SHA="$(awk -v ref="refs/tags/${REF_NAME}^{}" '$2 == ref { print $1 }' <<<"$REMOTE_TAGS")"
    REMOTE_TAG_SHA="${REMOTE_DEREF_SHA:-$REMOTE_DIRECT_SHA}"
    if [[ -z "$REMOTE_TAG_SHA" ]]; then
      git_with_auth push "$REMOTE_NAME" "${SPLIT_SHA}:refs/tags/${REF_NAME}"
    elif [[ "$REMOTE_TAG_SHA" == "$SPLIT_SHA" ]]; then
      echo "${DEST_REPO} tag ${REF_NAME} already points to ${SPLIT_SHA}; skipping."
    else
      echo "Refusing to overwrite ${DEST_REPO} tag ${REF_NAME}: remote ${REMOTE_TAG_SHA}, prepared ${SPLIT_SHA}." >&2
      exit 1
    fi
    ;;
  *)
    echo "Unsupported sync mode: $SYNC_MODE" >&2
    exit 1
    ;;
esac
