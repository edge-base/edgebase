import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRootDir = path.resolve(__dirname, '..');
export const ciTempDir = path.join(repoRootDir, '.tmp', 'ci');

export function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

export function resolveCommand(command) {
  if (process.platform !== 'win32') return command;

  if (/\.(cmd|exe|bat)$/i.test(command)) return command;
  if (['pnpm', 'npm', 'npx', 'pnpx', 'yarn'].includes(command)) return `${command}.cmd`;
  return command;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

export function tailText(value, lineCount = 200) {
  return value.split(/\r?\n/).slice(-lineCount).join('\n').trim();
}

export function tailFile(filePath, lineCount = 200) {
  if (!existsSync(filePath)) return '';
  return tailText(readFileSync(filePath, 'utf8'), lineCount);
}

export async function runCommand(command, args, options = {}) {
  const child = spawn(resolveCommand(command), args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdio: options.stdio ?? 'inherit',
    shell: options.shell ?? false,
    detached: options.detached ?? false,
    windowsHide: true,
  });

  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      resolve({ code, signal, child });
    });
  });
}

export function spawnLogged(command, args, options = {}) {
  ensureDir(path.dirname(options.logPath));
  const logStream = createWriteStream(options.logPath, { flags: 'w' });
  const child = spawn(resolveCommand(command), args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: options.shell ?? false,
    detached: options.detached ?? false,
    windowsHide: true,
  });

  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  return { child, logStream };
}

export async function killProcessTree(pid) {
  if (!pid) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }

  const childPids = [];
  const queue = [pid];

  while (queue.length > 0) {
    const currentPid = queue.pop();
    if (!currentPid) continue;

    const result = spawnSync('pgrep', ['-P', String(currentPid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status !== 0 || !result.stdout) continue;

    const directChildren = result.stdout
      .split(/\r?\n/)
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);

    childPids.push(...directChildren);
    queue.push(...directChildren);
  }

  for (const targetPid of childPids.reverse()) {
    try {
      process.kill(targetPid, 'SIGTERM');
    } catch {}
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {}

  await sleep(500);

  for (const targetPid of childPids.reverse()) {
    try {
      process.kill(targetPid, 'SIGKILL');
    } catch {}
  }

  try {
    process.kill(pid, 0);
    process.kill(pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
}

export function defaultTempEnv(prefix) {
  const tempDir = path.join(ciTempDir, prefix);
  ensureDir(tempDir);
  return {
    TMPDIR: tempDir,
    TMP: tempDir,
    TEMP: tempDir,
    XDG_CONFIG_HOME: tempDir,
  };
}

export async function waitForHttp(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const intervalMs = options.intervalMs ?? 1_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (options.child && options.child.exitCode !== null) {
      const logTail = options.logPath ? tailFile(options.logPath) : '';
      throw new Error(
        `${options.name ?? 'service'} exited before becoming healthy.${logTail ? `\n${logTail}` : ''}`,
      );
    }

    try {
      const response = await fetch(url);
      const body = await response.text();
      if (response.ok && (!options.validate || options.validate(body))) {
        return;
      }
    } catch {}

    await sleep(intervalMs);
  }

  const logTail = options.logPath ? tailFile(options.logPath) : '';
  throw new Error(
    `Timed out waiting for ${options.name ?? 'service'} at ${url}.${logTail ? `\n${logTail}` : ''}`,
  );
}

export function formatFailureLog(label, logPath) {
  const logTail = tailFile(logPath);
  if (!logTail) return '';
  return `\n--- ${label} log tail ---\n${logTail}\n--- end ${label} log tail ---`;
}
