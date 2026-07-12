#!/bin/bash
# run-integration-shards.sh — 서버 통합 테스트 16-shard 병렬 + 3차 프로세스 레벨 재시도
#
# 1차: 16-shard 병렬 실행 (각 shard = 별도 Miniflare)
# 2차: 실패 파일은 개별 실행하고, 파일 경로가 없는 실패 shard는 shard 전체를
#      fresh Miniflare로 병렬 재실행
# 3차: 2차에서도 실패한 동일 retry target을 fresh Miniflare로 한 번 더 재실행
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
source "$SCRIPT_DIR/lib/owned-process-groups.sh"
owned_process_init "$LOG_DIR/owned-processes" "$SCRIPT_DIR/lib/owned-process-runner.mjs"
OWNED_PROCESS_CHILD_TMPDIR="/tmp"
DEV_VARS_PATH="$SERVER_DIR/.dev.vars"
TEST_DEV_VARS_PATH="$SERVER_DIR/.dev.vars.test"
DEV_VARS_BACKUP_PATH=""
TEMP_CONFIG_FILES=()

TOTAL_SHARDS="${TOTAL_SHARDS:-16}"

# Per-invocation wall-clock cap so a wedged workerd/vitest can never hang the
# whole run. Without it, a single process that fails to exit blocks the `wait`
# loops below until GitHub's 6h job cap (observed in CI under memory pressure).
# Uses coreutils `timeout` (Linux/CI) or `gtimeout` (macOS/brew) when present;
# falls back to no cap on dev machines where the hang does not occur.
SHARD_TIMEOUT="${SHARD_TIMEOUT:-420}"
VITEST_COMMAND=(pnpm exec vitest)
if command -v timeout >/dev/null 2>&1; then
  VITEST_COMMAND=("$(command -v timeout)" -k 30 "$SHARD_TIMEOUT" pnpm exec vitest)
elif command -v gtimeout >/dev/null 2>&1; then
  VITEST_COMMAND=("$(command -v gtimeout)" -k 30 "$SHARD_TIMEOUT" pnpm exec vitest)
fi

RST='\033[0m'; BOLD='\033[1m'; GRN='\033[0;32m'; RED='\033[0;31m'; CYN='\033[0;36m'; YLW='\033[0;33m'

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

cleanup_temp_configs() {
  if [ "${#TEMP_CONFIG_FILES[@]}" -eq 0 ]; then
    return
  fi

  local path
  for path in "${TEMP_CONFIG_FILES[@]}"; do
    rm -f "$path"
  done
  TEMP_CONFIG_FILES=()
}

cleanup_harness() {
  owned_process_cleanup
  cleanup_temp_configs
  restore_dev_vars
}

trap 'cleanup_harness' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
trap 'exit 131' QUIT
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

  local pids=()
  local file_map=()
  local config_map=()
  local log_map=()
  local idx=0

  for f in "${files[@]}"; do
    local safe_base
    safe_base=$(printf '%s' "$(basename "$f" .test.ts)" | tr -c 'A-Za-z0-9._-' '_')
    local retry_log="$LOG_DIR/r${round}-${safe_base}-${idx}.log"
    local retry_config="$SERVER_DIR/.tmp-vitest-integration-r${round}-${safe_base}-$$-${idx}.config.ts"
    TEMP_CONFIG_FILES+=("$retry_config")
    cat > "$retry_config" <<EOF
import base from './vitest.integration.config.ts';
export default {
  ...base,
  test: {
    ...base.test,
    include: ['${f}'],
  },
};
EOF
    owned_process_start "retry-${round}-${safe_base}-${idx}" "$SERVER_DIR" "$retry_log" \
      "${VITEST_COMMAND[@]}" run --passWithNoTests \
      --config "$(basename "$retry_config")"
    pids+=("$OWNED_PROCESS_LAST_PID")
    file_map+=("$f")
    config_map+=("$retry_config")
    log_map+=("$retry_log")
    idx=$((idx + 1))
  done

  STILL_FAILED=()
  local pass=0 fail=0

  for idx in $(seq 0 $((${#pids[@]} - 1))); do
    local f="${file_map[$idx]}"
    local retry_log="${log_map[$idx]}"
    if owned_process_wait "${pids[$idx]}"; then
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
    rm -f "${config_map[$idx]}"
  done

  echo ""
  echo -e "  ${BOLD}[${round}차 결과]${RST} 통과: ${GRN}${pass}${RST}, 실패: ${RED}${fail}${RST} (총 ${#files[@]})"
}

# 실패 로그에 파일 경로가 남지 않은 shard를 fresh Miniflare로 다시 실행한다.
# Workerd/vitest가 teardown에서 timeout되면 모든 테스트가 끝났어도 FAIL/❯ 라인이
# 없을 수 있다. 이 경우 shard를 누락하거나 즉시 최종 실패로 처리하지 않는다.
retry_failed_shards() {
  local round=$1; shift
  local shards=("$@")

  echo ""
  echo -e "${BOLD}${YLW}▶ [${round}차] ${#shards[@]}개 미식별 실패 shard 재실행 (fresh Miniflare)${RST}"
  for shard in "${shards[@]}"; do
    echo -e "  ${YLW}↻ shard ${shard}/${TOTAL_SHARDS}${RST}"
  done

  local pids=()
  local shard_map=()
  local log_map=()
  local idx=0

  for shard in "${shards[@]}"; do
    local retry_log="$LOG_DIR/r${round}-shard-${shard}-${TOTAL_SHARDS}.log"
    owned_process_start "retry-${round}-shard-${shard}-${TOTAL_SHARDS}" "$SERVER_DIR" "$retry_log" \
      "${VITEST_COMMAND[@]}" run --passWithNoTests \
      --config vitest.integration.config.ts \
      "--shard=${shard}/${TOTAL_SHARDS}"
    pids+=("$OWNED_PROCESS_LAST_PID")
    shard_map+=("$shard")
    log_map+=("$retry_log")
    idx=$((idx + 1))
  done

  STILL_FAILED_SHARDS=()
  local pass=0 fail=0

  for idx in $(seq 0 $((${#pids[@]} - 1))); do
    local shard="${shard_map[$idx]}"
    local retry_log="${log_map[$idx]}"
    if owned_process_wait "${pids[$idx]}"; then
      echo -e "  ${GRN}✅ shard ${shard}/${TOTAL_SHARDS} — 통과 (flake/teardown hang)${RST}"
      pass=$((pass + 1))
    else
      echo -e "  ${RED}❌ shard ${shard}/${TOTAL_SHARDS} — 실패${RST}"
      fail=$((fail + 1))
      STILL_FAILED_SHARDS+=("$shard")
      local raw_tests
      raw_tests=$(perl -pe 's/\x1b\[[0-9;]*[mK]//g' "$retry_log" 2>/dev/null | grep -E '^\s+Tests\s+[0-9]+' | head -1) || raw_tests=""
      [ -n "$raw_tests" ] && echo -e "     ${raw_tests}"
    fi
  done

  echo ""
  echo -e "  ${BOLD}[${round}차 미식별 shard 결과]${RST} 통과: ${GRN}${pass}${RST}, 실패: ${RED}${fail}${RST} (총 ${#shards[@]})"
}

# ═══════════════════════════════════════════════════════════════════════════════

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
  owned_process_start "$safe_label" "$SERVER_DIR" "$log_file" \
    "${VITEST_COMMAND[@]}" run --passWithNoTests \
    --config vitest.integration.config.ts \
    "--shard=${i}/${TOTAL_SHARDS}"
  SHARD_PIDS+=("$OWNED_PROCESS_LAST_PID")
done

FAILED_SHARD_IDX=()
for i in $(seq 0 $((TOTAL_SHARDS - 1))); do
  if owned_process_wait "${SHARD_PIDS[$i]}"; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_SHARD_IDX+=("$((i + 1))")  # 1-based shard number
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
UNIDENTIFIED_SHARDS=()
if [ "$FAIL_COUNT" -gt 0 ]; then
  for sidx in "${FAILED_SHARD_IDX[@]}"; do
    log_file="$LOG_DIR/shard-${sidx}-${TOTAL_SHARDS}.log"
    shard_failed_files=()
    while IFS= read -r file; do
      if [ -n "$file" ]; then
        FAILED_FILES+=("$file")
        shard_failed_files+=("$file")
      fi
    done < <(perl -pe 's/\x1b\[[0-9;]*[mK]//g' "$log_file" 2>/dev/null \
      | perl -ne 'print "$1\n" if /(?:FAIL|❯)\s+(test\/integration\/\S+\.test\.ts)/' \
      | sort -u)
    if [ ${#shard_failed_files[@]} -eq 0 ]; then
      UNIDENTIFIED_SHARDS+=("$sidx")
    fi
  done

  if [ ${#FAILED_FILES[@]} -gt 0 ]; then
    FAILED_FILES=($(printf '%s\n' "${FAILED_FILES[@]}" | sort -u))
  fi
fi

# ─── 2차 + 3차 재시도 ────────────────────────────────────────────────────────

FINAL_FAIL=0
STILL_FAILED=()
STILL_FAILED_SHARDS=()

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
fi

if [ ${#UNIDENTIFIED_SHARDS[@]} -gt 0 ]; then
  retry_failed_shards 2 "${UNIDENTIFIED_SHARDS[@]}"

  if [ ${#STILL_FAILED_SHARDS[@]} -gt 0 ]; then
    ROUND2_FAILED_SHARDS=("${STILL_FAILED_SHARDS[@]}")
    retry_failed_shards 3 "${ROUND2_FAILED_SHARDS[@]}"

    if [ ${#STILL_FAILED_SHARDS[@]} -gt 0 ]; then
      echo ""
      echo -e "  ${RED}⚠ 미식별 shard가 3차까지 실패:${RST}"
      for shard in "${STILL_FAILED_SHARDS[@]}"; do
        echo -e "    ${RED}• shard ${shard}/${TOTAL_SHARDS}${RST}"
      done
      FINAL_FAIL=$((FINAL_FAIL + ${#STILL_FAILED_SHARDS[@]}))
    else
      echo -e "  ${GRN}✅ 미식별 shard가 3차에서 전부 통과 → 최종 PASS${RST}"
    fi
  else
    echo -e "  ${GRN}✅ 미식별 shard가 2차에서 전부 통과 → 최종 PASS${RST}"
  fi
fi

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo ""
  echo -e "  ${GRN}✅ 1차에서 전부 통과 — 재시도 불필요${RST}"
fi

# ─── 정리 및 결과 ────────────────────────────────────────────────────────────

owned_process_cleanup

ELAPSED=$(( $(date +%s) - START ))
echo ""
echo -e "${BOLD}${CYN}──────────────────────────────────────────────────────────${RST}"
echo -e "${BOLD}Integration 소요 시간: ${ELAPSED}s | 최종: $( [ $FINAL_FAIL -eq 0 ] && echo "${GRN}PASS" || echo "${RED}FAIL (${FINAL_FAIL} retry targets)" )${RST}"
echo -e "상세 로그: $LOG_DIR"
echo -e "${BOLD}${CYN}──────────────────────────────────────────────────────────${RST}"

if [ "$FINAL_FAIL" -gt 0 ]; then
  exit 1
fi
