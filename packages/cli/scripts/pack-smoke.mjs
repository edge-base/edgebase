import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, '..');
const cliEntry = resolve(packageDir, 'dist', 'index.js');
const cleanupTasks = [];
const childProcesses = [];
const keepTemp = process.env.EDGEBASE_PACK_SMOKE_KEEP_TEMP === '1';

function log(message) {
  process.stdout.write(`${message}\n`);
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    stdio: options.capture === false ? 'inherit' : 'pipe',
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout ?? 300_000,
    maxBuffer: 32 * 1024 * 1024,
    shell: options.shell ?? false,
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(output || `${command} ${args.join(' ')} failed with status ${result.status ?? 'unknown'}`);
  }

  return result.stdout ?? '';
}

async function waitForHttp(url, predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(3_000),
      });
      const body = await response.text();
      if (response.ok && predicate(body)) {
        return body;
      }
      lastError = new Error(`Unexpected response ${response.status} for ${url}: ${body.slice(0, 200)}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out waiting for ${url}`);
}

async function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to reserve an ephemeral port.')));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}

function resolveAppDataRoot(appDataDirName) {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', appDataDirName);
  }
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), appDataDirName);
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), appDataDirName);
}

function killProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // best effort
  }
}

function spawnPortableLauncher(launcherPath, args, cwd, env) {
  if (process.platform === 'win32') {
    const launcherEntryPath = join(dirname(launcherPath), 'launcher.mjs');
    // Launch the Node entrypoint directly so shutdown signals reach the launcher on Windows CI.
    const canLaunchNodeDirectly = existsSync(launcherEntryPath);
    const command = canLaunchNodeDirectly ? process.execPath : 'cmd.exe';
    const commandArgs = canLaunchNodeDirectly
      ? [launcherEntryPath, ...args]
      : ['/d', '/s', '/c', launcherPath, ...args];

    return spawn(command, commandArgs, {
      cwd,
      env,
      stdio: 'pipe',
    });
  }

  return spawn(launcherPath, args, {
    cwd,
    env,
    stdio: 'pipe',
  });
}

function readLauncherLog(dataDir) {
  const logPath = join(dataDir, 'launcher.log');
  if (!existsSync(logPath)) {
    return '';
  }

  try {
    return readFileSync(logPath, 'utf-8');
  } catch {
    return '';
  }
}

async function stopPortableLauncher(child, stderr) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    killProcessTree(child.pid);
  } else {
    child.kill('SIGTERM');
  }
  await new Promise((resolveExit, reject) => {
    const onExit = () => {
      clearTimeout(timeout);
      child.off('error', onError);
      resolveExit();
    };
    const onError = (error) => {
      clearTimeout(timeout);
      child.off('exit', onExit);
      reject(error);
    };
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      child.off('error', onError);
      if (child.pid) {
        killProcessTree(child.pid);
      }
      reject(new Error(`Portable launcher did not exit cleanly.\n${stderr()}`));
    }, 15_000);

    child.once('exit', onExit);
    child.once('error', onError);
  });
}

function cleanup() {
  if (keepTemp) {
    return;
  }

  while (childProcesses.length > 0) {
    const child = childProcesses.pop();
    if (!child || child.pid == null || child.exitCode !== null || child.signalCode !== null) continue;
    try {
      killProcessTree(child.pid);
    } catch {
      // best effort
    }
  }

  while (cleanupTasks.length > 0) {
    const task = cleanupTasks.pop();
    try {
      task?.();
    } catch {
      // best effort
    }
  }
}

async function main() {
  const tempRoot = mkdtempSync(join(tmpdir(), 'edgebase-pack-smoke-'));
  log(`Pack smoke temp root: ${tempRoot}`);
  cleanupTasks.push(() => rmSync(tempRoot, { recursive: true, force: true }));

  const projectDir = join(tempRoot, 'app');
  const outputPath = process.platform === 'darwin'
    ? join(projectDir, 'Portable Smoke.app')
    : join(projectDir, `portable-smoke-${process.platform}`);
  const appDataRoot = resolveAppDataRoot('edgebase-portable-smoke');
  const dataDir = join(tempRoot, 'data');
  const port = await reservePort();

  cleanupTasks.push(() => rmSync(appDataRoot, { recursive: true, force: true }));

  mkdirSync(join(projectDir, 'functions'), { recursive: true });
  mkdirSync(join(projectDir, 'web', 'dist', 'assets'), { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  writeFileSync(
    join(projectDir, 'edgebase.config.ts'),
    `import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  databases: {
    shared: {
      tables: {},
    },
  },
  frontend: {
    directory: './web/dist',
    mountPath: '/app',
    spaFallback: true,
  },
});
`,
    'utf-8',
  );

  writeFileSync(
    join(projectDir, 'functions', 'hello.ts'),
    `export async function GET() {
  return Response.json({ ok: true, source: 'pack-smoke' });
}
`,
    'utf-8',
  );

  writeFileSync(
    join(projectDir, 'web', 'dist', 'index.html'),
    '<!doctype html><html><body>pack smoke frontend</body></html>\n',
    'utf-8',
  );
  writeFileSync(
    join(projectDir, 'web', 'dist', 'assets', 'main.12345678.js'),
    'console.log("pack smoke frontend");\n',
    'utf-8',
  );

  log('Building portable artifact through the CLI...');
  const packRaw = run(
    process.execPath,
    [cliEntry, '--json', 'pack', '--format', 'portable', '--app-name', 'Portable Smoke', '--output', outputPath],
    {
      cwd: projectDir,
      env: {
        ...process.env,
        NO_COLOR: '1',
      },
    },
  );
  const packResult = JSON.parse(packRaw.trim());
  ensure(packResult.status === 'success', 'Pack command did not report success.');
  ensure(packResult.format === 'portable', 'Pack command did not return a portable artifact.');
  ensure(existsSync(packResult.outputPath), `Portable artifact was not created: ${packResult.outputPath}`);
  ensure(existsSync(packResult.launcherPath), `Portable launcher is missing: ${packResult.launcherPath}`);

  if (process.platform === 'darwin') {
    log('Verifying macOS codesign integrity...');
    run('codesign', ['--verify', '--deep', '--strict', packResult.outputPath], {
      timeout: 120_000,
    });
  }

  log('Starting portable artifact...');
  const child = spawnPortableLauncher(
    packResult.launcherPath,
    ['--port', String(port), '--data-dir', dataDir],
    process.platform === 'darwin' ? packResult.outputPath : dirname(packResult.launcherPath),
    {
      ...process.env,
      EDGEBASE_OPEN: '0',
      NO_COLOR: '1',
    },
  );
  childProcesses.push(child);

  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const httpTimeout = process.platform === 'win32' ? 240_000 : 120_000;

  try {
    const frontendHtml = await waitForHttp(
      `http://127.0.0.1:${port}/app`,
      (body) => body.includes('pack smoke frontend'),
      httpTimeout,
    );
    const frontendAsset = await waitForHttp(
      `http://127.0.0.1:${port}/app/assets/main.12345678.js`,
      (body) => body.includes('pack smoke frontend'),
      httpTimeout,
    );
    const healthText = await waitForHttp(
      `http://127.0.0.1:${port}/api/health`,
      (body) => body.includes('"status":"ok"'),
      httpTimeout,
    );

    ensure(frontendHtml.includes('pack smoke frontend'), 'Portable artifact frontend route did not return the expected HTML.');
    ensure(frontendAsset.includes('pack smoke frontend'), 'Portable artifact frontend asset route did not return the expected JavaScript.');
    ensure(healthText.includes('"status":"ok"'), 'Portable artifact API route did not return the expected health payload.');
  } catch (error) {
    throw new Error(
      `Portable artifact failed smoke verification.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}\nLAUNCHER LOG:\n${readLauncherLog(dataDir)}`,
      { cause: error },
    );
  }

  await stopPortableLauncher(child, () => stderr);

  log(`Pack smoke passed: http://127.0.0.1:${port}/app, http://127.0.0.1:${port}/app/assets/main.12345678.js, and http://127.0.0.1:${port}/api/health`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
} finally {
  cleanup();
}
