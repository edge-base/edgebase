#!/bin/bash

# Ownership-safe process-group lifecycle helpers for integration test harnesses.
# Requires Bash 3.2+ and Node.js. Every command is spawned by
# owned-process-runner.mjs in its own process group; cleanup only targets PGIDs
# recorded for runners that this shell started.

OWNED_PROCESS_RUNNER_PIDS=()
OWNED_PROCESS_PID_FILES=()
OWNED_PROCESS_LAST_PID=""
OWNED_PROCESS_LAST_PID_FILE=""

owned_process_init() {
  OWNED_PROCESS_STATE_DIR="$1"
  OWNED_PROCESS_RUNNER_SCRIPT="$2"
  OWNED_PROCESS_NODE_BIN="${OWNED_PROCESS_NODE_BIN:-node}"
  mkdir -p "$OWNED_PROCESS_STATE_DIR"
}

owned_process_is_positive_integer() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) [ "$1" -gt 1 ] ;;
  esac
}

owned_process_start() {
  local label="$1"
  local workdir="$2"
  local log_file="$3"
  shift 3

  local index="${#OWNED_PROCESS_RUNNER_PIDS[@]}"
  local safe_label
  safe_label=$(printf '%s' "$label" | tr -c 'A-Za-z0-9._-' '_')
  local pid_file="$OWNED_PROCESS_STATE_DIR/${safe_label}.$$.$index.pid"

  TMPDIR="${OWNED_PROCESS_CHILD_TMPDIR:-${TMPDIR:-/tmp}}" \
  OWNED_PROCESS_TERM_GRACE_MS="${OWNED_PROCESS_TERM_GRACE_MS:-1000}" \
    "$OWNED_PROCESS_NODE_BIN" "$OWNED_PROCESS_RUNNER_SCRIPT" \
      --pid-file "$pid_file" \
      --cwd "$workdir" \
      --owner-pid "$$" \
      -- "$@" > "$log_file" 2>&1 &

  local runner_pid=$!
  OWNED_PROCESS_RUNNER_PIDS+=("$runner_pid")
  OWNED_PROCESS_PID_FILES+=("$pid_file")
  OWNED_PROCESS_LAST_PID="$runner_pid"
  OWNED_PROCESS_LAST_PID_FILE="$pid_file"
}

owned_process_forget() {
  local target_pid="$1"
  local index
  for index in "${!OWNED_PROCESS_RUNNER_PIDS[@]}"; do
    if [ "${OWNED_PROCESS_RUNNER_PIDS[$index]}" != "$target_pid" ]; then
      continue
    fi
    rm -f "${OWNED_PROCESS_PID_FILES[$index]}" "${OWNED_PROCESS_PID_FILES[$index]}.tmp"
    unset "OWNED_PROCESS_RUNNER_PIDS[$index]"
    unset "OWNED_PROCESS_PID_FILES[$index]"
    return
  done
}

owned_process_wait() {
  local runner_pid="$1"
  local status=0
  wait "$runner_pid" || status=$?
  owned_process_forget "$runner_pid"
  return "$status"
}

owned_process_read_group() {
  local expected_runner_pid="$1"
  local pid_file="$2"
  local owner_pid recorded_runner_pid process_group_id

  [ -s "$pid_file" ] || return 1
  read -r owner_pid recorded_runner_pid process_group_id < "$pid_file" || return 1
  owned_process_is_positive_integer "$owner_pid" || return 1
  owned_process_is_positive_integer "$recorded_runner_pid" || return 1
  owned_process_is_positive_integer "$process_group_id" || return 1
  [ "$owner_pid" = "$$" ] || return 1
  [ "$recorded_runner_pid" = "$expected_runner_pid" ] || return 1

  local harness_group_id
  harness_group_id=$(ps -o pgid= -p "$$" 2>/dev/null | tr -d '[:space:]')
  [ -n "$harness_group_id" ] || return 1
  [ "$process_group_id" != "$harness_group_id" ] || return 1

  OWNED_PROCESS_READ_GROUP_ID="$process_group_id"
}

owned_process_signal_group() {
  local signal="$1"
  local process_group_id="$2"
  kill -"$signal" -- "-$process_group_id" 2>/dev/null || true
}

owned_process_cleanup() {
  if [ "${#OWNED_PROCESS_RUNNER_PIDS[@]}" -eq 0 ]; then
    return
  fi

  local process_group_ids=()
  local index runner_pid pid_file

  for index in "${!OWNED_PROCESS_RUNNER_PIDS[@]}"; do
    runner_pid="${OWNED_PROCESS_RUNNER_PIDS[$index]}"
    pid_file="${OWNED_PROCESS_PID_FILES[$index]}"
    if owned_process_read_group "$runner_pid" "$pid_file"; then
      process_group_ids+=("$OWNED_PROCESS_READ_GROUP_ID")
      owned_process_signal_group TERM "$OWNED_PROCESS_READ_GROUP_ID"
    fi
    kill -TERM "$runner_pid" 2>/dev/null || true
  done

  # Give Vitest/Miniflare a short graceful window, then force-reap only the
  # process groups recorded above. Unrelated workerd processes are never
  # searched for or signaled.
  sleep "${OWNED_PROCESS_CLEANUP_GRACE_SECONDS:-1}"

  local process_group_id
  # A runner can be signaled in the narrow window after it creates its child
  # group but before its pidfile is visible. Re-read every owned pidfile after
  # the grace window so that group is still force-reaped without ever scanning
  # or matching unrelated system processes.
  for index in "${!OWNED_PROCESS_RUNNER_PIDS[@]}"; do
    runner_pid="${OWNED_PROCESS_RUNNER_PIDS[$index]}"
    pid_file="${OWNED_PROCESS_PID_FILES[$index]}"
    if owned_process_read_group "$runner_pid" "$pid_file"; then
      process_group_ids+=("$OWNED_PROCESS_READ_GROUP_ID")
    fi
  done

  for process_group_id in "${process_group_ids[@]}"; do
    owned_process_signal_group KILL "$process_group_id"
  done
  for index in "${!OWNED_PROCESS_RUNNER_PIDS[@]}"; do
    runner_pid="${OWNED_PROCESS_RUNNER_PIDS[$index]}"
    kill -KILL "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
    rm -f "${OWNED_PROCESS_PID_FILES[$index]}" "${OWNED_PROCESS_PID_FILES[$index]}.tmp"
  done

  OWNED_PROCESS_RUNNER_PIDS=()
  OWNED_PROCESS_PID_FILES=()
  OWNED_PROCESS_LAST_PID=""
  OWNED_PROCESS_LAST_PID_FILE=""
}
