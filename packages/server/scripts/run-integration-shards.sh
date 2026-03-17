#!/bin/bash
# run-integration-shards.sh — 서버 통합 테스트 16-shard 병렬 + 3차 프로세스 레벨 재시도
#
# 1차: 16-shard 병렬 실행 (각 shard = 별도 Miniflare)
# 2차: 실패 파일을 개별 fresh Miniflare로 병렬 재실행
# 3차: 2차에서도 실패한 파일을 한 번 더 개별 fresh Miniflare로 재실행
#
# DO invalidation으로 오염된 Miniflare에서는 in-process retry가 무의미하므로
# 프로세스 자체를 새로 띄워서 깨끗한 Miniflare에서 재시도한다.
# 3차까지 통과 못하면 진짜 버그로 간주하여 최종 실패.
#
# 사용법:
#   ./scripts/run-integration-shards.sh           # packages/server/ 에서 실행
#   TOTAL_SHARDS=8 ./scripts/run-integration-shards.sh  # shard 수 조절

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="/tmp/integration-shard-logs-$$"
mkdir -p "$LOG_DIR"
DEV_VARS_PATH="$SERVER_DIR/.dev.vars"
TEST_DEV_VARS_PATH="$SERVER_DIR/.dev.vars.test"
DEV_VARS_BACKUP_PATH=""

TOTAL_SHARDS="${TOTAL_SHARDS:-16}"

RST='\033[0m'; BOLD='\033[1m'; GRN='\033[0;32m'; RED='\033[0;31m'; CYN='\033[0;36m'; YLW='\033[0;33m'

kill_workerd() {
  pkill -f "workerd serve.*--binary.*--experimental" 2>/dev/null || true
  sleep 1
}

activate_test_dev_vars() {
  if [ ! -f "$TEST_DEV_VARS_PATH" ]; then
    return
  fi

  if [ -f "$DEV_VARS_PATH" ]; then
    DEV_VARS_BACKUP_PATH="$(mktemp /tmp/edgebase-dev-vars.XXXXXX)"
    cp "$DEV_VARS_PATH" "$DEV_VARS_BACKUP_PATH"
  fi

  cp "$TEST_DEV_VARS_PATH" "$DEV_VARS_PATH"
}

restore_dev_vars() {
  if [ -n "$DEV_VARS_BACKUP_PATH" ] && [ -f "$DEV_VARS_BACKUP_PATH" ]; then
    mv "$DEV_VARS_BACKUP_PATH" "$DEV_VARS_PATH"
    DEV_VARS_BACKUP_PATH=""
    return
  fi

  if [ -f "$DEV_VARS_PATH" ] && [ -f "$TEST_DEV_VARS_PATH" ]; then
    cmp -s "$DEV_VARS_PATH" "$TEST_DEV_VARS_PATH" && rm -f "$DEV_VARS_PATH"
  fi
}

trap 'restore_dev_vars; kill_workerd' EXIT
activate_test_dev_vars

# 실패 파일을 개별 프로세스로 병렬 재실행하는 함수
# 인자: round_num file1 file2 ...
# 출력: 여전히 실패한 파일을 STILL_FAILED 배열에 저장
retry_failed_files() {
  local round=$1; shift
  local files=("$@")

  echo ""
  echo -e "${BOLD}${YLW}▶ [${round}차] ${#files[@]}개 실패 파일 재실행 (fresh Miniflare)${RST}"
  for f in "${files[@]}"; do
    echo -e "  ${YLW}↻ ${f}${RST}"
  done

  kill_workerd

  local pids=()
  local file_map=()

  for f in "${files[@]}"; do
    local retry_log="$LOG_DIR/r${round}-$(basename "$f" .test.ts).log"
    (
      cd "$SERVER_DIR"
      TMPDIR=/tmp pnpm exec vitest run --passWithNoTests \
        --config vitest.integration.config.ts \
        "$f"
    ) > "$retry_log" 2>&1 &
    pids+=($!)
    file_map+=("$f")
  done

  STILL_FAILED=()
  local pass=0 fail=0

  for idx in $(seq 0 $((${#pids[@]} - 1))); do
    local f="${file_map[$idx]}"
    local retry_log="$LOG_DIR/r${round}-$(basename "$f" .test.ts).log"
    if wait "${pids[$idx]}"; then
      echo -e "  ${GRN}✅ ${f} — 통과 (flake)${RST}"
      pass=$((pass + 1))
    else
      echo -e "  ${RED}❌ ${f} — 실패${RST}"
      fail=$((fail + 1))
      STILL_FAILED+=("$f")
      local raw_tests
      raw_tests=$(perl -pe 's/\x1b\[[0-9;]*[mK]//g' "$retry_log" 2>/dev/null | grep -E '^\s+Tests\s+[0-9]+' | head -1) || raw_tests=""
      [ -n "$raw_tests" ] && echo -e "     ${raw_tests}"
    fi
  done

  echo ""
  echo -e "  ${BOLD}[${round}차 결과]${RST} 통과: ${GRN}${pass}${RST}, 실패: ${RED}${fail}${RST} (총 ${#files[@]})"
}

# ═══════════════════════════════════════════════════════════════════════════════

kill_workerd
START=$(date +%s)

# ─── 1차: 16-shard 병렬 실행 ─────────────────────────────────────────────────

echo ""
echo -e "${BOLD}${CYN}▶ [1차] Integration Tests — ${TOTAL_SHARDS} shards 병렬 실행${RST}"

SHARD_PIDS=()
PASS_COUNT=0
FAIL_COUNT=0

for i in $(seq 1 "$TOTAL_SHARDS"); do
  safe_label="shard-${i}-${TOTAL_SHARDS}"
  log_file="$LOG_DIR/${safe_label}.log"
  (
    cd "$SERVER_DIR"
    TMPDIR=/tmp pnpm exec vitest run --passWithNoTests \
      --config vitest.integration.config.ts \
      "--shard=${i}/${TOTAL_SHARDS}"
  ) > "$log_file" 2>&1 &
  SHARD_PIDS+=($!)
done

for i in $(seq 0 $((TOTAL_SHARDS - 1))); do
  if wait "${SHARD_PIDS[$i]}"; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

# shard 통계 출력
echo ""
for i in $(seq 1 "$TOTAL_SHARDS"); do
  safe_label="shard-${i}-${TOTAL_SHARDS}"
  log_file="$LOG_DIR/${safe_label}.log"
  raw_files=$(perl -pe 's/\x1b\[[0-9;]*[mK]//g' "$log_file" 2>/dev/null | grep -E '^ Test Files\s+' | head -1) || raw_files=""
  [ -n "$raw_files" ] && echo -e "  ${BOLD}[shard ${i}/${TOTAL_SHARDS}]${RST} ${raw_files}"
done

# ─── 실패 파일 수집 ──────────────────────────────────────────────────────────

FAILED_FILES=()
if [ "$FAIL_COUNT" -gt 0 ]; then
  for i in $(seq 1 "$TOTAL_SHARDS"); do
    safe_label="shard-${i}-${TOTAL_SHARDS}"
    log_file="$LOG_DIR/${safe_label}.log"
    while IFS= read -r file; do
      [ -n "$file" ] && FAILED_FILES+=("$file")
    done < <(perl -pe 's/\x1b\[[0-9;]*[mK]//g' "$log_file" 2>/dev/null \
      | perl -ne 'print "$1\n" if /FAIL\s+(test\/integration\/\S+\.test\.ts)/' \
      | sort -u)
  done
fi

# ─── 2차 + 3차 재시도 ────────────────────────────────────────────────────────

FINAL_FAIL=0

if [ ${#FAILED_FILES[@]} -gt 0 ]; then
  UNIQUE_FILES=($(printf '%s\n' "${FAILED_FILES[@]}" | sort -u))

  # 2차
  retry_failed_files 2 "${UNIQUE_FILES[@]}"

  if [ ${#STILL_FAILED[@]} -gt 0 ]; then
    # 3차
    ROUND2_FAILED=("${STILL_FAILED[@]}")
    retry_failed_files 3 "${ROUND2_FAILED[@]}"

    if [ ${#STILL_FAILED[@]} -gt 0 ]; then
      echo ""
      echo -e "  ${RED}⚠ 3차까지 실패 — 진짜 버그 가능성:${RST}"
      for f in "${STILL_FAILED[@]}"; do
        echo -e "    ${RED}• ${f}${RST}"
      done
      FINAL_FAIL=${#STILL_FAILED[@]}
    else
      echo -e "  ${GRN}✅ 3차에서 전부 통과 → 최종 PASS${RST}"
    fi
  else
    echo -e "  ${GRN}✅ 2차에서 전부 통과 → 최종 PASS${RST}"
  fi
else
  echo ""
  echo -e "  ${GRN}✅ 1차에서 전부 통과 — 재시도 불필요${RST}"
fi

# ─── 정리 및 결과 ────────────────────────────────────────────────────────────

kill_workerd

ELAPSED=$(( $(date +%s) - START ))
echo ""
echo -e "${BOLD}${CYN}──────────────────────────────────────────────────────────${RST}"
echo -e "${BOLD}Integration 소요 시간: ${ELAPSED}s | 최종: $( [ $FINAL_FAIL -eq 0 ] && echo "${GRN}PASS" || echo "${RED}FAIL (${FINAL_FAIL} files)" )${RST}"
echo -e "상세 로그: $LOG_DIR"
echo -e "${BOLD}${CYN}──────────────────────────────────────────────────────────${RST}"

if [ "$FINAL_FAIL" -gt 0 ]; then
  exit 1
fi
