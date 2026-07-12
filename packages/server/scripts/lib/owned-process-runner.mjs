#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const SIGNAL_EXIT_CODES = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGQUIT: 131,
  SIGTERM: 143,
};

function parseArgs(argv) {
  let pidFile = '';
  let cwd = '';
  let ownerPid = 0;
  let index = 0;

  while (index < argv.length) {
    const arg = argv[index];
    if (arg === '--') {
      index += 1;
      break;
    }
    if (arg === '--pid-file') {
      pidFile = argv[index + 1] ?? '';
      index += 2;
      continue;
    }
    if (arg === '--cwd') {
      cwd = argv[index + 1] ?? '';
      index += 2;
      continue;
    }
    if (arg === '--owner-pid') {
      ownerPid = Number(argv[index + 1]);
      index += 2;
      continue;
    }
    throw new Error(`Unknown owned-process-runner option: ${arg}`);
  }

  const command = argv[index] ?? '';
  const commandArgs = argv.slice(index + 1);
  if (!pidFile || !cwd || !Number.isSafeInteger(ownerPid) || ownerPid <= 1 || !command) {
    throw new Error('Usage: owned-process-runner --pid-file <path> --cwd <dir> --owner-pid <pid> -- <command> [args...]');
  }
  return { pidFile, cwd, ownerPid, command, commandArgs };
}

const options = parseArgs(process.argv.slice(2));
const termGraceMs = Math.max(50, Number(process.env.OWNED_PROCESS_TERM_GRACE_MS ?? 1000) || 1000);
let child;
let childExitCode = 1;
let shutdownSignal = null;
let forceKillTimer = null;
let ownerCheckTimer = null;
let finalized = false;
let reaping = false;

function removePidFile() {
  for (const path of [options.pidFile, `${options.pidFile}.tmp`]) {
    try {
      rmSync(path, { force: true });
    } catch {
      // Cleanup must not mask the child command's exit status.
    }
  }
}

function groupExists() {
  if (!child?.pid) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalGroup(signal) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group has already exited.
  }
}

function finish(exitCode) {
  if (finalized) return;
  finalized = true;
  if (forceKillTimer) clearTimeout(forceKillTimer);
  if (ownerCheckTimer) clearInterval(ownerCheckTimer);
  removePidFile();
  process.exit(exitCode);
}

function reapRemainingGroup(exitCode) {
  if (finalized || reaping) return;
  reaping = true;
  if (forceKillTimer) clearTimeout(forceKillTimer);
  if (!groupExists()) {
    finish(exitCode);
    return;
  }
  signalGroup('SIGTERM');
  forceKillTimer = setTimeout(() => {
    signalGroup('SIGKILL');
    finish(exitCode);
  }, termGraceMs);
}

function requestShutdown(signal) {
  if (shutdownSignal || finalized) return;
  shutdownSignal = signal;
  signalGroup(signal === 'SIGHUP' ? 'SIGTERM' : signal);
  forceKillTimer = setTimeout(() => {
    signalGroup('SIGKILL');
    finish(SIGNAL_EXIT_CODES[signal] ?? 1);
  }, termGraceMs);
}

for (const signal of ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGTERM']) {
  process.on(signal, () => requestShutdown(signal));
}

process.on('exit', removePidFile);

try {
  child = spawn(options.command, options.commandArgs, {
    cwd: options.cwd,
    detached: true,
    env: process.env,
    stdio: 'inherit',
  });
} catch (error) {
  console.error(`[owned-process-runner] Failed to start '${options.command}':`, error);
  finish(1);
}

if (!child.pid) {
  console.error(`[owned-process-runner] '${options.command}' did not return a child PID.`);
  finish(1);
}

try {
  mkdirSync(dirname(options.pidFile), { recursive: true });
  writeFileSync(
    `${options.pidFile}.tmp`,
    `${options.ownerPid} ${process.pid} ${child.pid}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  renameSync(`${options.pidFile}.tmp`, options.pidFile);
} catch (error) {
  console.error('[owned-process-runner] Failed to record owned process group:', error);
  signalGroup('SIGKILL');
  finish(1);
}

ownerCheckTimer = setInterval(() => {
  try {
    process.kill(options.ownerPid, 0);
  } catch {
    requestShutdown('SIGTERM');
  }
}, 500);

child.on('error', (error) => {
  console.error(`[owned-process-runner] '${options.command}' failed:`, error);
  childExitCode = 1;
  reapRemainingGroup(childExitCode);
});

child.on('exit', (code, signal) => {
  childExitCode = code ?? SIGNAL_EXIT_CODES[signal] ?? SIGNAL_EXIT_CODES[shutdownSignal] ?? 1;
  reapRemainingGroup(childExitCode);
});
