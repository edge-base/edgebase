import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createArchiveFromPortableArtifact } from '../src/lib/pack.js';
import { resolveTsxCommand } from '../src/lib/node-tools.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsxCommand = resolveTsxCommand();
const tsxExecOptions = /\.cmd$/i.test(tsxCommand.command) ? { shell: true as const } : {};
const tempDirs: string[] = [];
const appDataDirs: string[] = [];
const childProcesses: ChildProcessWithoutNullStreams[] = [];

function readLauncherPid(dataDir: string): number | null {
  const lockPath = join(dataDir, 'launcher-lock.json');
  if (!existsSync(lockPath)) {
    return null;
  }

  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as { pid?: number };
    return typeof lock.pid === 'number' ? lock.pid : null;
  } catch {
    return null;
  }
}

function terminateLauncherPid(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
    return;
  } catch {
    // fall through
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // best-effort cleanup
  }
}

function createTempProject(name: string): string {
  const dir = join(tmpdir(), `edgebase-pack-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function runPack(projectDir: string, outputDirName: string, options?: { format?: 'portable'; appName?: string }) {
  const args = [
    ...tsxCommand.argsPrefix,
    resolve(packageDir, 'src', 'index.ts'),
    '--json',
    'pack',
  ];
  if (options?.format) {
    args.push('--format', options.format);
  }
  if (options?.appName) {
    args.push('--app-name', options.appName);
  }
  args.push('--output', outputDirName);

  return spawnSync(
    tsxCommand.command,
    args,
    {
      cwd: projectDir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        NO_COLOR: '1',
      },
      stdio: 'pipe',
      ...tsxExecOptions,
    },
  );
}

afterEach(() => {
  for (const child of childProcesses.splice(0)) {
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  }
  for (const dir of tempDirs.splice(0)) {
    const launcherPid = readLauncherPid(dir);
    if (launcherPid) {
      terminateLauncherPid(launcherPid);
    }
    rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of appDataDirs.splice(0)) {
    const launcherPid = readLauncherPid(dir);
    if (launcherPid) {
      terminateLauncherPid(launcherPid);
    }
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);

function resolveAppDataRoot(appDataDirName: string): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', appDataDirName);
  }
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), appDataDirName);
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), appDataDirName);
}

function createFakePortableArtifact(projectDir: string): string {
  if (process.platform === 'darwin') {
    const appRoot = join(projectDir, 'Portable-Test.app');
    mkdirSync(join(appRoot, 'Contents', 'MacOS'), { recursive: true });
    mkdirSync(join(appRoot, 'Contents', 'Resources', 'app'), { recursive: true });
    writeFileSync(join(appRoot, 'Contents', 'MacOS', 'Portable-Test'), '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(join(appRoot, 'Contents', 'Resources', 'app', 'edgebase-pack.json'), '{}\n');
    return appRoot;
  }

  const portableRoot = join(projectDir, 'portable-test');
  mkdirSync(join(portableRoot, 'app'), { recursive: true });
  writeFileSync(join(portableRoot, process.platform === 'win32' ? 'run.cmd' : 'run.sh'), 'echo ok\n');
  writeFileSync(join(portableRoot, 'app', 'edgebase-pack.json'), '{}\n');
  return portableRoot;
}

async function reservePort(): Promise<number> {
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
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function waitForHttp(
  url: string,
  predicate: (text: string) => boolean,
  timeoutMs = 45_000,
): Promise<string> {
  let lastError: unknown = null;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const text = await response.text();
      if (response.ok && predicate(text)) {
        return text;
      }
      lastError = new Error(`Unexpected response ${response.status} for ${url}: ${text.slice(0, 200)}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out waiting for ${url}`);
}

async function waitForText(
  readValue: () => string,
  predicate: (text: string) => boolean,
  timeoutMs = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = readValue();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }

  throw new Error('Timed out waiting for expected launcher output.');
}

function spawnPortableLauncher(
  launcherPath: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): ChildProcessWithoutNullStreams {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/s', '/c', launcherPath, ...args], {
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

describe('pack distribution formats', () => {
  it('creates a current-platform portable artifact with an embedded launcher', { timeout: 120_000 }, () => {
    const projectDir = createTempProject('portable');
    mkdirSync(join(projectDir, 'functions'), { recursive: true });

    writeFileSync(
      join(projectDir, 'edgebase.config.ts'),
      `import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  databases: {
    shared: {
      tables: {},
    },
  },
});
`,
    );
    writeFileSync(join(projectDir, 'functions', 'health.ts'), 'export default async () => new Response("ok");\n');

    const outputName = process.platform === 'darwin' ? 'Portable Test.app' : 'portable-test';
    const result = runPack(projectDir, outputName, {
      format: 'portable',
      appName: 'Portable Test',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const payload = JSON.parse(result.stdout) as {
      status: string;
      format: 'portable';
      outputPath: string;
      launcherPath: string;
      bundledAppDir: string;
      manifest: {
        artifactKind: 'macos-app' | 'portable-dir';
        embeddedNodePath: string;
      };
      packManifest: {
        launcher: {
          defaultOpenPath: string;
          defaultPort: number;
          appDataDirName: string;
          stateDir: string;
          runtimeDir: string;
        };
      };
    };

    expect(payload.status).toBe('success');
    expect(payload.format).toBe('portable');
    expect(payload.packManifest.launcher.defaultOpenPath).toBe('/admin');
    const appDataRoot = resolveAppDataRoot(payload.packManifest.launcher.appDataDirName);
    appDataDirs.push(appDataRoot);

    if (process.platform === 'darwin') {
      const appRoot = realpathSync(join(projectDir, 'Portable Test.app'));
      expect(payload.outputPath).toBe(appRoot);
      expect(payload.manifest.artifactKind).toBe('macos-app');
      expect(existsSync(join(appRoot, 'Contents', 'Info.plist'))).toBe(true);
      expect(existsSync(join(appRoot, 'Contents', 'MacOS', 'Portable-Test'))).toBe(true);
      expect(existsSync(join(appRoot, 'Contents', 'MacOS', 'node'))).toBe(true);
      expect(existsSync(join(appRoot, 'Contents', 'Resources', 'app', 'edgebase-pack.json'))).toBe(true);

      const codesignVerify = spawnSync(
        'codesign',
        ['--verify', '--deep', '--strict', appRoot],
        {
          cwd: projectDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        },
      );

      expect(codesignVerify.status).toBe(0);
      expect(codesignVerify.stderr).toBe('');

      const dryRun = spawnSync(
        join(appRoot, 'Contents', 'MacOS', 'Portable-Test'),
        ['--dry-run', '--json'],
        {
          cwd: appRoot,
          encoding: 'utf-8',
        },
      );

      expect(dryRun.status).toBe(0);
      const launchPlan = JSON.parse(dryRun.stdout) as { openUrl: string; persistDir: string; wranglerArgs: string[] };
      expect(launchPlan.openUrl).toBe(`http://127.0.0.1:${payload.packManifest.launcher.defaultPort}/admin`);
      expect(launchPlan.persistDir).toBe(join(appDataRoot, payload.packManifest.launcher.stateDir));
      expect(launchPlan.wranglerArgs).toEqual(expect.arrayContaining([
        '--config',
        realpathSync(join(appRoot, 'Contents', 'Resources', 'app', 'wrangler.toml')),
      ]));
      return;
    }

    const portableRoot = realpathSync(join(projectDir, outputName));
    expect(payload.outputPath).toBe(portableRoot);
    expect(payload.manifest.artifactKind).toBe('portable-dir');
    expect(existsSync(join(portableRoot, 'bin'))).toBe(true);
    expect(existsSync(join(portableRoot, 'app', 'edgebase-pack.json'))).toBe(true);
  });

  it('creates a current-platform archive artifact for single-file distribution', { timeout: 120_000 }, () => {
    const projectDir = createTempProject('archive');
    const outputName = process.platform === 'linux' ? 'portable-test.tar.gz' : 'portable-test.zip';
    const portableArtifactPath = createFakePortableArtifact(projectDir);
    const requestedArchivePath = join(projectDir, outputName);
    const archiveType = createArchiveFromPortableArtifact(portableArtifactPath, requestedArchivePath);
    const archivePath = realpathSync(requestedArchivePath);

    const extractDir = createTempProject('archive-extract');
    if (process.platform === 'darwin') {
      expect(archiveType).toBe('zip');
      execFileSync('ditto', ['-x', '-k', archivePath, extractDir], { stdio: 'pipe' });
      const appRoot = realpathSync(join(extractDir, 'Portable-Test.app'));
      expect(existsSync(join(appRoot, 'Contents', 'MacOS', 'Portable-Test'))).toBe(true);
      expect(existsSync(join(appRoot, 'Contents', 'Resources', 'app', 'edgebase-pack.json'))).toBe(true);
      return;
    }

    if (process.platform === 'linux') {
      expect(archiveType).toBe('tar.gz');
      execFileSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'pipe' });
      expect(existsSync(join(extractDir, 'portable-test', 'app', 'edgebase-pack.json'))).toBe(true);
      return;
    }

    expect(archiveType).toBe('zip');
    expect(existsSync(archivePath)).toBe(true);
  });

  it.skipIf(process.platform !== 'darwin')(
    'launches a portable macOS app via open and starts the bundled launcher',
    async () => {
      const projectDir = createTempProject('portable-open');
      mkdirSync(join(projectDir, 'functions'), { recursive: true });
      mkdirSync(join(projectDir, 'web', 'dist', 'assets'), { recursive: true });

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
      );
      writeFileSync(join(projectDir, 'functions', 'hello.ts'), 'export async function GET() { return Response.json({ ok: true, route: \"hello\" }); }\n');
      writeFileSync(join(projectDir, 'web', 'dist', 'index.html'), '<!doctype html><html><body>portable-open-frontend</body></html>\n');
      writeFileSync(join(projectDir, 'web', 'dist', 'assets', 'main.12345678.js'), 'console.log("portable-open-frontend");\n');

      const result = runPack(projectDir, 'Portable Open.app', {
        format: 'portable',
        appName: 'Portable Open',
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');

      const payload = JSON.parse(result.stdout) as {
        outputPath: string;
      };
      const launchPort = await reservePort();
      const dataDir = createTempProject('portable-open-data');
      const opened = spawn('open', [
        '-n',
        '-W',
        payload.outputPath,
        '--args',
        '--port',
        String(launchPort),
        '--data-dir',
        dataDir,
      ], {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      childProcesses.push(opened);

      let openStderr = '';
      opened.stderr.on('data', (chunk) => {
        openStderr += chunk.toString();
      });

      let pid: number | null = null;

      try {
        for (let attempt = 0; attempt < 80; attempt += 1) {
          const lockPid = readLauncherPid(dataDir);
          if (lockPid) {
            pid = lockPid;
            break;
          }
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
        }

        const readLauncherLog = () => {
          const launcherLogPath = join(dataDir, 'launcher.log');
          return existsSync(launcherLogPath) ? readFileSync(launcherLogPath, 'utf-8') : '';
        };

        expect(pid).not.toBeNull();
        expect(await waitForText(readLauncherLog, (text) => text.includes('wrangler'))).toContain('wrangler');
      } finally {
        if (pid) {
          terminateLauncherPid(pid);
        }
        await new Promise<void>((resolveExit) => {
          if (opened.exitCode !== null || opened.killed) {
            resolveExit();
            return;
          }

          const timeout = setTimeout(() => {
            if (!opened.killed) {
              opened.kill('SIGKILL');
            }
            resolveExit();
          }, 15_000);

          opened.once('exit', () => {
            clearTimeout(timeout);
            resolveExit();
          });
        });
      }

      expect(openStderr).toBe('');
    },
    120_000,
  );

  it('boots a portable artifact and serves both frontend and API traffic', async () => {
    const projectDir = createTempProject('portable-runtime');
    mkdirSync(join(projectDir, 'functions'), { recursive: true });
    mkdirSync(join(projectDir, 'web', 'dist', 'assets'), { recursive: true });

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
    );
    writeFileSync(join(projectDir, 'functions', 'hello.ts'), 'export async function GET() { return Response.json({ ok: true, route: \"hello\" }); }\n');
    writeFileSync(join(projectDir, 'web', 'dist', 'index.html'), '<!doctype html><html><body>portable-frontend</body></html>\n');
    writeFileSync(join(projectDir, 'web', 'dist', 'assets', 'main.12345678.js'), 'console.log("portable-frontend");\n');

    const outputName = process.platform === 'darwin' ? 'Portable Runtime.app' : 'portable-runtime';
    const result = runPack(projectDir, outputName, {
      format: 'portable',
      appName: 'Portable Runtime',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const payload = JSON.parse(result.stdout) as {
      launcherPath: string;
      outputPath: string;
      packManifest: {
        launcher: {
          appDataDirName: string;
        };
      };
    };

    const launchPort = await reservePort();
    const dataDir = createTempProject('portable-runtime-data');
    const appDataRoot = resolveAppDataRoot(payload.packManifest.launcher.appDataDirName);
    appDataDirs.push(appDataRoot);
    const launcherCwd = process.platform === 'darwin'
      ? payload.outputPath
      : payload.outputPath;
    const child = spawnPortableLauncher(
      payload.launcherPath,
      ['--port', String(launchPort), '--data-dir', dataDir],
      launcherCwd,
      {
        ...process.env,
        EDGEBASE_OPEN: '0',
        NO_COLOR: '1',
      },
    );
    childProcesses.push(child);

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    let frontendHtml: string;
    try {
      frontendHtml = await waitForHttp(`http://127.0.0.1:${launchPort}/app`, (text) => text.includes('portable-frontend'));
    } catch (error) {
      throw new Error(
        `Portable launcher failed before serving the frontend.\n${stderr}`,
        { cause: error },
      );
    }
    expect(frontendHtml).toContain('portable-frontend');

    let healthText: string;
    try {
      healthText = await waitForHttp(`http://127.0.0.1:${launchPort}/api/health`, (text) => text.includes('"status":"ok"'));
    } catch (error) {
      throw new Error(
        `Portable launcher failed before serving the API.\n${stderr}`,
        { cause: error },
      );
    }
    expect(healthText).toContain('"status":"ok"');

    child.kill('SIGTERM');
    await new Promise<void>((resolveExit, reject) => {
      child.once('exit', () => resolveExit());
      child.once('error', reject);
      setTimeout(() => reject(new Error(`Portable launcher did not exit cleanly.\n${stderr}`)), 15_000);
    });
  }, 120_000);
});
