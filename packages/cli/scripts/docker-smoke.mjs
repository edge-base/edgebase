import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, '..');
const repoRoot = resolve(packageDir, '..', '..');
const cliEntry = resolve(packageDir, 'dist', 'index.js');
const dockerfileSource = resolve(repoRoot, 'Dockerfile');
const cleanupTasks = [];

function log(message) {
  process.stdout.write(`${message}\n`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    stdio: options.capture === false ? 'inherit' : 'pipe',
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout ?? 300_000,
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(output || `${command} ${args.join(' ')} failed with status ${result.status ?? 'unknown'}`);
  }

  return result.stdout ?? '';
}

function isDockerResponsive() {
  try {
    execFileSync('docker', ['info', '--format', '{{json .ServerVersion}}'], {
      stdio: 'ignore',
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForHttp(url, predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(3_000),
      });
      if (await predicate(response)) {
        return response;
      }
    } catch {
      // Service still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function allocatePort(start = 48787, attempts = 50) {
  for (let index = 0; index < attempts; index += 1) {
    const candidate = start + index;
    try {
      execFileSync('python3', ['-c', `import socket; s=socket.socket(); s.bind(("127.0.0.1", ${candidate})); s.close()`], {
        stdio: 'ignore',
        timeout: 3_000,
      });
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error('Could not allocate a free localhost port for docker smoke test.');
}

function cleanup() {
  while (cleanupTasks.length > 0) {
    const task = cleanupTasks.pop();
    try {
      task?.();
    } catch {
      // best-effort cleanup
    }
  }
}

function readDockerLogs(containerName) {
  try {
    return execFileSync('docker', ['logs', containerName], {
      encoding: 'utf-8',
      timeout: 20_000,
    }).trim();
  } catch (error) {
    const stdout = typeof error?.stdout === 'string'
      ? error.stdout
      : Buffer.isBuffer(error?.stdout)
        ? error.stdout.toString('utf-8')
        : '';
    const stderr = typeof error?.stderr === 'string'
      ? error.stderr
      : Buffer.isBuffer(error?.stderr)
        ? error.stderr.toString('utf-8')
        : '';
    return [stdout, stderr].filter(Boolean).join('\n').trim();
  }
}

async function main() {
  const skipIfUnavailable = process.argv.includes('--skip-if-unavailable')
    || process.env.EDGEBASE_SKIP_DOCKER_SMOKE_IF_UNAVAILABLE === '1';

  if (!isDockerResponsive()) {
    if (skipIfUnavailable) {
      log('Skipping docker smoke test because the Docker daemon is not responding.');
      return;
    }
    throw new Error('Docker daemon is not responding.');
  }

  const tempRoot = mkdtempSync(join(tmpdir(), 'edgebase-docker-smoke-'));
  cleanupTasks.push(() => rmSync(tempRoot, { recursive: true, force: true }));

  const projectDir = join(tempRoot, 'app');
  mkdirSync(join(projectDir, 'functions'), { recursive: true });
  mkdirSync(join(projectDir, 'web', 'dist'), { recursive: true });

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
    spaFallback: true,
  },
});
`,
    'utf-8',
  );
  writeFileSync(
    join(projectDir, 'functions', 'hello.ts'),
    `export async function GET() {
  return Response.json({ ok: true, source: 'docker-smoke' });
}
`,
    'utf-8',
  );
  writeFileSync(
    join(projectDir, 'web', 'dist', 'index.html'),
    '<!doctype html><html><body>docker smoke frontend</body></html>\n',
    'utf-8',
  );
  cpSync(dockerfileSource, join(projectDir, 'Dockerfile'));

  const tag = `edgebase-docker-smoke:${Date.now()}`;
  const containerName = `edgebase-docker-smoke-${Date.now()}`;
  const persistDir = join(tempRoot, 'data');
  mkdirSync(persistDir, { recursive: true });
  const port = allocatePort();

  cleanupTasks.push(() => {
    try {
      execFileSync('docker', ['rm', '-f', containerName], { stdio: 'ignore', timeout: 20_000 });
    } catch {
      // ignore
    }
  });
  cleanupTasks.push(() => {
    try {
      execFileSync('docker', ['image', 'rm', '-f', tag], { stdio: 'ignore', timeout: 20_000 });
    } catch {
      // ignore
    }
  });

  log('Building Docker image through the CLI...');
  const buildRaw = run(
    process.execPath,
    [cliEntry, '--json', 'docker', 'build', '--tag', tag],
    {
      cwd: projectDir,
      env: {
        ...process.env,
        NO_COLOR: '1',
      },
    },
  );
  const buildResult = JSON.parse(buildRaw.trim());
  ensure(buildResult.status === 'success', 'Docker build did not report success.');

  const contextDir = buildResult.contextDir;
  if (contextDir) {
    const sizeKb = Number.parseInt(
      execFileSync('du', ['-sk', contextDir], { encoding: 'utf-8', timeout: 10_000 }).split(/\s+/)[0] ?? '0',
      10,
    );
    ensure(Number.isFinite(sizeKb) && sizeKb > 0, 'Could not determine Docker build context size.');
    ensure(sizeKb < 100 * 1024, `Docker build context is unexpectedly large: ${(sizeKb / 1024).toFixed(1)} MB`);
    log(`Docker build context size: ${(sizeKb / 1024).toFixed(1)} MB`);
  }

  log('Starting Docker container...');
  run('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    containerName,
    '-p',
    `${port}:8787`,
    '-v',
    `${persistDir}:/data`,
    tag,
  ], {
    capture: true,
    timeout: 60_000,
  });

  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  const frontendUrl = `http://127.0.0.1:${port}/`;

  let frontendResponse;
  try {
    await waitForHttp(healthUrl, async (response) => response.ok);
    frontendResponse = await waitForHttp(frontendUrl, async (response) => {
      if (!response.ok) return false;
      const body = await response.text();
      return body.includes('docker smoke frontend');
    });
  } catch (error) {
    const logs = readDockerLogs(containerName);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Docker smoke failed before the container served traffic.\n${message}${logs ? `\n\nContainer logs:\n${logs}` : ''}`,
    );
  }

  ensure(frontendResponse.ok, 'Frontend route did not return a successful response.');
  log(`Docker smoke passed: ${healthUrl} and ${frontendUrl}`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const skipIfUnavailable = process.argv.includes('--skip-if-unavailable')
    || process.env.EDGEBASE_SKIP_DOCKER_SMOKE_IF_UNAVAILABLE === '1';
  if (skipIfUnavailable && /Cannot connect to the Docker daemon|Docker daemon is not responding/i.test(message)) {
    process.stdout.write('Skipping docker smoke test because the Docker daemon is not responding.\n');
    process.exitCode = 0;
  } else {
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
} finally {
  cleanup();
}
