import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { localCiTimeout } from '../../vitest-local-ci-timeout';

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HARNESS_PATH = join(SERVER_DIR, 'scripts/run-integration-shards.sh');
const PROCESS_LIB_PATH = join(SERVER_DIR, 'scripts/lib/owned-process-groups.sh');
const PROCESS_RUNNER_PATH = join(SERVER_DIR, 'scripts/lib/owned-process-runner.mjs');

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(
  predicate: () => boolean,
  description: string,
  timeoutMs = localCiTimeout(5_000),
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return new Promise((resolvePromise) => {
    child.once('close', (code, signal) => resolvePromise({ code, signal }));
  });
}

function spawnBash(script: string, env: Record<string, string>): {
  child: ChildProcess;
  output: () => string;
} {
  let combinedOutput = '';
  const child = spawn('/bin/bash', ['-c', script], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    combinedOutput += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    combinedOutput += chunk.toString();
  });
  return { child, output: () => combinedOutput };
}

async function forceStop(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(child.pid, 'SIGKILL');
  } catch {
    return;
  }
  await Promise.race([
    waitForExit(child),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000)),
  ]);
}

function writeFixtures(fixtureDir: string): {
  descendantPath: string;
  leaderPath: string;
} {
  const descendantPath = join(fixtureDir, 'uncooperative-descendant.mjs');
  const leaderPath = join(fixtureDir, 'owned-leader.mjs');

  writeFileSync(descendantPath, `
for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
  process.on(signal, () => {});
}
setInterval(() => {}, 1_000);
`);
  writeFileSync(leaderPath, `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const descendant = spawn(process.execPath, [process.argv[2]], { stdio: 'ignore' });
writeFileSync(process.argv[3], String(descendant.pid));
for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
  process.on(signal, () => {});
}
setInterval(() => {}, 1_000);
`);

  return { descendantPath, leaderPath };
}

function readOwnedPids(resultPath: string): {
  runnerPid: number;
  processGroupId: number;
  descendantPid: number;
} {
  const values = readFileSync(resultPath, 'utf8').trim().split(/\s+/).map(Number);
  expect(values).toHaveLength(3);
  expect(values.every((value) => Number.isSafeInteger(value) && value > 1)).toBe(true);
  return {
    runnerPid: values[0],
    processGroupId: values[1],
    descendantPid: values[2],
  };
}

describe.skipIf(process.platform === 'win32')('integration harness process ownership', () => {
  it('contains no process-name-based cleanup and routes every shard through the owned runner', () => {
    const harness = readFileSync(HARNESS_PATH, 'utf8');

    expect(harness).not.toMatch(/\bpkill\b/);
    expect(harness).not.toContain('kill_workerd');
    expect(harness).toContain('owned_process_start');
    expect(harness).toContain('owned_process_wait');
    expect(harness).toContain("trap 'exit 143' TERM");
    expect(harness).toContain("trap 'exit 130' INT");
    expect(harness).toContain('VITEST_COMMAND=(pnpm exec vitest)');
    expect(harness).toMatch(
      /cleanup_temp_configs\(\) \{\n {2}if \[ "\$\{#TEMP_CONFIG_FILES\[@\]\}" -eq 0 \]; then/,
    );
    expect(harness).toContain('retry_failed_shards()');
    expect(harness).toContain('UNIDENTIFIED_SHARDS+=("$sidx")');
    expect(harness).toContain('retry_failed_shards 2 "${UNIDENTIFIED_SHARDS[@]}"');
    expect(harness).toContain('retry_failed_shards 3 "${ROUND2_FAILED_SHARDS[@]}"');
  });

  it('retries a failed shard when its log contains no identifiable test path', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'edgebase-unidentified-shard-'));
    const fakePnpmPath = join(fixtureDir, 'pnpm');
    const invocationCountPath = join(fixtureDir, 'pnpm-count.txt');

    try {
      writeFileSync(fakePnpmPath, `#!/bin/bash
set -uo pipefail
count=0
if [ -f "$FAKE_PNPM_COUNT" ]; then
  count=$(<"$FAKE_PNPM_COUNT")
fi
count=$((count + 1))
printf '%s' "$count" > "$FAKE_PNPM_COUNT"
if [ "$count" -eq 1 ]; then
  echo 'worker teardown timed out without a test path' >&2
  exit 124
fi
echo ' Test Files  1 passed (1)'
echo '      Tests  1 passed (1)'
`);
      chmodSync(fakePnpmPath, 0o755);

      const result = spawnSync('/bin/bash', [HARNESS_PATH], {
        cwd: SERVER_DIR,
        env: {
          ...process.env,
          PATH: `${fixtureDir}:${process.env.PATH ?? ''}`,
          TOTAL_SHARDS: '1',
          SHARD_TIMEOUT: '10',
          FAKE_PNPM_COUNT: invocationCountPath,
        },
        encoding: 'utf8',
        timeout: localCiTimeout(30_000),
      });
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

      expect(result.error, output).toBeUndefined();
      expect(result.status, output).toBe(0);
      expect(readFileSync(invocationCountPath, 'utf8')).toBe('2');
      expect(output).toContain('[2차] 1개 미식별 실패 shard 재실행');
      expect(output).toContain('shard 1/1 — 통과');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }, localCiTimeout(30_000));

  it('reaps only its recorded leader and descendant process group', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'edgebase-owned-process-'));
    const stateDir = join(fixtureDir, 'state');
    const resultPath = join(fixtureDir, 'owned-pids.txt');
    const descendantPidPath = join(fixtureDir, 'descendant.pid');
    const ownedLogPath = join(fixtureDir, 'owned.log');
    const { descendantPath, leaderPath } = writeFixtures(fixtureDir);
    let unrelated: ChildProcess | undefined;
    let shell: ChildProcess | undefined;
    let ownedPids: ReturnType<typeof readOwnedPids> | undefined;

    try {
      unrelated = spawn(process.execPath, [
        descendantPath,
        'workerd',
        'serve',
        '--binary',
        'fixture',
        '--experimental',
      ], { stdio: 'ignore' });
      expect(unrelated.pid).toBeTypeOf('number');
      await waitUntil(() => processExists(unrelated!.pid!), 'unrelated matching process startup');

      const commandLine = spawnSync('ps', ['-o', 'command=', '-p', String(unrelated.pid)], {
        encoding: 'utf8',
      }).stdout;
      expect(commandLine).toMatch(/workerd serve.*--binary.*--experimental/);

      const launched = spawnBash(`
set -uo pipefail
source "$PROCESS_LIB_PATH"
owned_process_init "$STATE_DIR" "$PROCESS_RUNNER_PATH"
OWNED_PROCESS_TERM_GRACE_MS=100
OWNED_PROCESS_CLEANUP_GRACE_SECONDS=0.2
trap 'owned_process_cleanup' EXIT
owned_process_start regression "$FIXTURE_DIR" "$OWNED_LOG_PATH" \
  "$NODE_BIN" "$LEADER_PATH" "$DESCENDANT_PATH" "$DESCENDANT_PID_PATH"
runner_pid="$OWNED_PROCESS_LAST_PID"
pid_file="$OWNED_PROCESS_LAST_PID_FILE"
for _ in {1..100}; do
  [ -s "$pid_file" ] && [ -s "$DESCENDANT_PID_PATH" ] && break
  sleep 0.05
done
[ -s "$pid_file" ] && [ -s "$DESCENDANT_PID_PATH" ] || {
  echo 'owned process fixture failed to become ready' >&2
  exit 1
}
read -r _ recorded_runner process_group_id < "$pid_file"
printf '%s %s %s\n' "$recorded_runner" "$process_group_id" "$(cat "$DESCENDANT_PID_PATH")" > "$RESULT_PATH"
owned_process_cleanup
trap - EXIT
`, {
        PROCESS_LIB_PATH,
        PROCESS_RUNNER_PATH,
        STATE_DIR: stateDir,
        FIXTURE_DIR: fixtureDir,
        OWNED_LOG_PATH: ownedLogPath,
        NODE_BIN: process.execPath,
        LEADER_PATH: leaderPath,
        DESCENDANT_PATH: descendantPath,
        DESCENDANT_PID_PATH: descendantPidPath,
        RESULT_PATH: resultPath,
      });
      shell = launched.child;
      const result = await waitForExit(shell);
      expect(result, launched.output()).toEqual({ code: 0, signal: null });

      ownedPids = readOwnedPids(resultPath);
      await waitUntil(
        () => !processExists(ownedPids!.runnerPid)
          && !processExists(ownedPids!.processGroupId)
          && !processExists(ownedPids!.descendantPid)
          && !processGroupExists(ownedPids!.processGroupId),
        'owned process group cleanup',
      );
      expect(processExists(unrelated.pid!)).toBe(true);
    } finally {
      await forceStop(shell);
      await forceStop(unrelated);
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }, localCiTimeout(10_000));

  it('runs the same ownership-scoped cleanup when the harness receives SIGTERM', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'edgebase-owned-process-signal-'));
    const stateDir = join(fixtureDir, 'state');
    const resultPath = join(fixtureDir, 'owned-pids.txt');
    const descendantPidPath = join(fixtureDir, 'descendant.pid');
    const ownedLogPath = join(fixtureDir, 'owned.log');
    const { descendantPath, leaderPath } = writeFixtures(fixtureDir);
    let unrelated: ChildProcess | undefined;
    let shell: ChildProcess | undefined;
    let ownedPids: ReturnType<typeof readOwnedPids> | undefined;

    try {
      unrelated = spawn(process.execPath, [
        descendantPath,
        'workerd',
        'serve',
        '--binary',
        'signal-fixture',
        '--experimental',
      ], { stdio: 'ignore' });
      await waitUntil(() => processExists(unrelated!.pid!), 'unrelated matching process startup');

      const launched = spawnBash(`
set -uo pipefail
source "$PROCESS_LIB_PATH"
owned_process_init "$STATE_DIR" "$PROCESS_RUNNER_PATH"
OWNED_PROCESS_TERM_GRACE_MS=100
OWNED_PROCESS_CLEANUP_GRACE_SECONDS=0.2
trap 'owned_process_cleanup' EXIT
trap 'exit 143' TERM
owned_process_start signal-regression "$FIXTURE_DIR" "$OWNED_LOG_PATH" \
  "$NODE_BIN" "$LEADER_PATH" "$DESCENDANT_PATH" "$DESCENDANT_PID_PATH"
pid_file="$OWNED_PROCESS_LAST_PID_FILE"
for _ in {1..100}; do
  [ -s "$pid_file" ] && [ -s "$DESCENDANT_PID_PATH" ] && break
  sleep 0.05
done
[ -s "$pid_file" ] && [ -s "$DESCENDANT_PID_PATH" ] || exit 1
read -r _ recorded_runner process_group_id < "$pid_file"
printf '%s %s %s\n' "$recorded_runner" "$process_group_id" "$(cat "$DESCENDANT_PID_PATH")" > "$RESULT_PATH"
while :; do sleep 1; done
`, {
        PROCESS_LIB_PATH,
        PROCESS_RUNNER_PATH,
        STATE_DIR: stateDir,
        FIXTURE_DIR: fixtureDir,
        OWNED_LOG_PATH: ownedLogPath,
        NODE_BIN: process.execPath,
        LEADER_PATH: leaderPath,
        DESCENDANT_PATH: descendantPath,
        DESCENDANT_PID_PATH: descendantPidPath,
        RESULT_PATH: resultPath,
      });
      shell = launched.child;
      await waitUntil(() => {
        try {
          return readFileSync(resultPath, 'utf8').trim().length > 0;
        } catch {
          return false;
        }
      }, 'signal fixture readiness');
      ownedPids = readOwnedPids(resultPath);

      process.kill(shell.pid!, 'SIGTERM');
      const result = await waitForExit(shell);
      expect(result, launched.output()).toEqual({ code: 143, signal: null });
      await waitUntil(
        () => !processExists(ownedPids!.runnerPid)
          && !processExists(ownedPids!.processGroupId)
          && !processExists(ownedPids!.descendantPid)
          && !processGroupExists(ownedPids!.processGroupId),
        'signal-triggered owned process group cleanup',
      );
      expect(processExists(unrelated.pid!)).toBe(true);
    } finally {
      await forceStop(shell);
      await forceStop(unrelated);
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }, localCiTimeout(10_000));
});
