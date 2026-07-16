import { spawn, type ChildProcess, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_MANAGED_SCHEDULE_ENTRIES } from '@edge-base/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveTsxCommand } from '../src/lib/node-tools.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testRequire = createRequire(import.meta.url);
const tsxCommand = resolveTsxCommand();
const tsxExecOptions = /\.cmd$/i.test(tsxCommand.command) ? { shell: true as const } : {};
const tempDirs: string[] = [];
const appDataDirs: string[] = [];
const CLEANUP_RETRY_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 20,
  retryDelay: 250,
} as const;

interface BufferedProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runBufferedProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio = {},
): Promise<BufferedProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}

function createTempProject(name: string): string {
  const dir = join(tmpdir(), `edgebase-pack-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function cleanupTemporaryDirectory(dir: string): void {
  rmSync(dir, CLEANUP_RETRY_OPTIONS);
}

function findSentinelInSmallPackedFiles(root: string, sentinel: string): string[] {
  const matches: string[] = [];
  const pending = [root];
  const needle = Buffer.from(sentinel);
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) pending.push(path);
      else if (stats.isFile() && stats.size <= 2 * 1024 * 1024) {
        if (readFileSync(path).includes(needle)) matches.push(path);
      }
    }
  }
  return matches;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not resolve a free launcher test port.'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePromise(address.port);
      });
    });
  });
}

async function canBindPort(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once('error', () => resolvePromise(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolvePromise(true));
    });
  });
}

async function waitForHttpStatus(url: string, status: number, timeoutMs = 30_000): Promise<Response> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(1_000),
      });
      if (response.status === status) return response;
      lastError = new Error(`Expected HTTP ${status}, received ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for ${url}.`, { cause: lastError });
}

async function waitForSuccessfulScheduleState(filePath: string, timeoutMs = 30_000): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  let lastObservation = 'state file not created';
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as {
          schemaVersion?: unknown;
          targets?: unknown;
        };
        if (
          parsed.schemaVersion === 2
          && typeof parsed.targets === 'object'
          && parsed.targets !== null
          && !Array.isArray(parsed.targets)
        ) {
          const targets = Object.values(parsed.targets as Record<string, unknown>);
          const bounded = targets.length <= MAX_MANAGED_SCHEDULE_ENTRIES;
          const successful = bounded && targets.some((entry) => (
            typeof entry === 'object'
            && entry !== null
            && Number.isSafeInteger((entry as { lastSuccessfulBoundary?: unknown }).lastSuccessfulBoundary)
            && Number((entry as { lastSuccessfulBoundary: number }).lastSuccessfulBoundary) >= 0
          ));
          lastObservation = `schemaVersion=2 targets=${targets.length} successful=${String(successful)}`;
          if (successful) return parsed as Record<string, unknown>;
        } else {
          lastObservation = `schemaVersion=${String(parsed.schemaVersion)} targets=invalid`;
        }
      } catch (error) {
        lastObservation = `state read failed: ${error instanceof Error ? error.message : String(error)}`
          .slice(0, 2_048);
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(
    `Timed out waiting for a successful schedule state at ${filePath}. Last observation: ${lastObservation}`,
  );
}

async function waitForFile(filePath: string, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(filePath)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`Timed out waiting for launcher file: ${filePath}`);
}

// The packed launcher owns a 10-second shutdown deadline. Leave an outer-test
// margin for its final SIGKILL/process-group reap and Node's child `exit` event,
// especially on loaded ARM CI hosts.
async function stopChild(child: ChildProcess, timeoutMs = 15_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Timed out stopping packed launcher.'));
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolvePromise();
    });
    child.kill('SIGTERM');
  });
}

async function waitForChildExit(child: ChildProcess, timeoutMs = 15_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Timed out waiting for the packed launcher to exit.'));
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolvePromise();
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function runPack(projectDir: string, outputDirName: string, options?: { format?: 'dir' | 'portable' | 'archive'; appName?: string }) {
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
  args.push(
    '--output',
    outputDirName,
  );

  return runBufferedProcess(
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
  for (const dir of tempDirs.splice(0)) {
    cleanupTemporaryDirectory(dir);
  }
  for (const dir of appDataDirs.splice(0)) {
    cleanupTemporaryDirectory(dir);
  }
}, 120_000);

beforeEach(async () => {
  // Let Vitest deliver its task-status RPC before each expensive pack operation.
  await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
});

function resolveAppDataRoot(appDataDirName: string): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', appDataDirName);
  }
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), appDataDirName);
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), appDataDirName);
}

function hasBundledPnpmPackage(runtimeNodeModulesDir: string, entryPrefix: string, packagePath: string[]): boolean {
  const pnpmDir = join(runtimeNodeModulesDir, '.pnpm');
  if (!existsSync(pnpmDir)) return false;

  return readdirSync(pnpmDir).some((entry) => (
    entry.startsWith(entryPrefix)
    && existsSync(join(pnpmDir, entry, 'node_modules', ...packagePath, 'package.json'))
  ));
}

function readBundledPackageVersion(runtimeNodeModulesDir: string, packageName: string): string | null {
  try {
    return JSON.parse(
      readFileSync(join(runtimeNodeModulesDir, ...packageName.split('/'), 'package.json'), 'utf-8'),
    ).version as string;
  } catch {
    return null;
  }
}

function resolveBundledWranglerMiniflareVersion(runtimeNodeModulesDir: string): string {
  const wranglerManifest = join(runtimeNodeModulesDir, 'wrangler', 'package.json');
  const wranglerRequire = createRequire(wranglerManifest);
  const miniflareManifest = wranglerRequire.resolve('miniflare/package.json');
  return JSON.parse(readFileSync(miniflareManifest, 'utf-8')).version as string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function resolveExpectedPortableMiniflareVersion(): string {
  const wranglerManifest = testRequire.resolve('wrangler/package.json', { paths: [packageDir] });
  const wranglerRequire = createRequire(wranglerManifest);
  const miniflareManifest = wranglerRequire.resolve('miniflare/package.json');
  return JSON.parse(readFileSync(miniflareManifest, 'utf-8')).version as string;
}

function resolveInstalledPackageVersion(packageName: string): string {
  let current = dirname(testRequire.resolve(packageName, { paths: [packageDir] }));

  while (true) {
    const manifestPath = join(current, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { name?: string; version?: string };
      if (manifest.name === packageName && typeof manifest.version === 'string') {
        return manifest.version;
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Could not resolve installed package version for ${packageName}.`);
    }
    current = parent;
  }
}

describe('pack command', () => {
  it('creates a backend-only directory artifact from a self-contained app bundle', { timeout: 90_000 }, async () => {
    const projectDir = createTempProject('backend');
    const packSecretSentinel = 'pack-release-secret-sentinel-52a0c6d1';
    mkdirSync(join(projectDir, 'functions'), { recursive: true });
    mkdirSync(join(projectDir, 'config'), { recursive: true });

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
    writeFileSync(
      join(projectDir, 'functions', 'health.ts'),
      `export async function GET() {
  return Response.json({ ok: true });
}
`,
    );
    writeFileSync(join(projectDir, 'config', 'rate-limits.ts'), 'export const DEFAULT_RATE_LIMITS = {};\n');
    writeFileSync(join(projectDir, '.env.release'), `SERVICE_KEY=${packSecretSentinel}\n`);
    writeFileSync(
      join(projectDir, 'wrangler.toml'),
      [
        'name = "pack-worker"',
        '',
        '[[d1_databases]]',
        'binding = "DB_D1_SHARED"',
        'database_name = "shared"',
        'database_id = "local"',
        '',
        '[assets]',
        'directory = ".edgebase/runtime/server/admin-build"',
        'binding = "ASSETS"',
      ].join('\n'),
    );

    const result = await runPack(projectDir, 'packed');

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toBe('');

    const payload = JSON.parse(result.stdout) as {
      status: string;
      outputDir: string;
      manifest: {
        format: string;
        frontend: { enabled: boolean };
        functions: { count: number };
        config: { module: string };
      };
    };

    expect(payload).toMatchObject({
      status: 'success',
      outputDir: join(realpathSync(projectDir), 'packed'),
      manifest: {
        format: 'dir',
        frontend: { enabled: false },
        functions: { count: 1 },
        config: {
          module: '.edgebase/runtime/server/bundle/config/edgebase.config.bundle.js',
        },
      },
    });

    const manifestPath = join(projectDir, 'packed', 'edgebase-pack.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      frontend: { enabled: boolean };
      runtime: { registry: string; bundleDir: string };
      schedules: { digest: string; crons: string[] };
      selfHost: {
        schemaVersion: number;
        generation: string;
        gateway: { path: string; digest: string; bytes: number };
        scheduleSupervisor: { path: string; digest: string; bytes: number };
        dockerEntrypoint: { path: string; digest: string; bytes: number };
      };
      launcher: {
        entry: string;
        unix: string;
        windows: string;
        defaultOpenPath: string;
        defaultPort: number;
        defaultHost: string;
        defaultDataDir: string;
        appDataDirName: string;
        stateDir: string;
        runtimeDir: string;
        singleInstance: boolean;
        portSearchLimit: number;
      };
    };

    expect(manifest.frontend.enabled).toBe(false);
    expect(manifest.runtime.registry).toBe('.edgebase/runtime/server/src/_functions-registry.ts');
    expect(manifest.runtime.bundleDir).toBe('.edgebase/runtime/server/bundle');
    const appManifest = JSON.parse(
      readFileSync(join(projectDir, 'packed', 'edgebase-app.json'), 'utf-8'),
    ) as {
      schedules: { digest: string };
      selfHost: {
        schemaVersion: number;
        generation: string;
        gateway: { path: string; digest: string; bytes: number };
        scheduleSupervisor: { path: string; digest: string; bytes: number };
        dockerEntrypoint: { path: string; digest: string; bytes: number };
      };
    };
    expect(manifest.schedules.digest).toBe(appManifest.schedules.digest);
    expect(manifest.schedules.crons).toContain('0 3 * * *');
    expect(manifest.selfHost).toEqual(appManifest.selfHost);
    expect(manifest.selfHost).toMatchObject({
      schemaVersion: 1,
      generation: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      gateway: { path: '.edgebase/self-host/self-host-gateway.mjs' },
      scheduleSupervisor: { path: '.edgebase/self-host/self-host-schedule-supervisor.mjs' },
      dockerEntrypoint: { path: '.edgebase/self-host/self-host-docker-entrypoint.mjs' },
    });
    expect(manifest.launcher).toMatchObject({
      entry: 'launcher.mjs',
      unix: 'run.sh',
      windows: 'run.cmd',
      defaultOpenPath: '/admin',
      defaultPort: expect.any(Number),
      defaultHost: '127.0.0.1',
      defaultDataDir: 'os-app-data',
      appDataDirName: expect.stringContaining('edgebase-'),
      stateDir: 'state',
      runtimeDir: 'runtime',
      singleInstance: true,
      portSearchLimit: 20,
    });
    expect(manifest.launcher.defaultPort).toBeGreaterThanOrEqual(47600);
    expect(manifest.launcher.defaultPort).toBeLessThan(49600);
    const appDataRoot = resolveAppDataRoot(manifest.launcher.appDataDirName);
    appDataDirs.push(appDataRoot);
    expect(existsSync(join(projectDir, 'packed', 'edgebase-app.json'))).toBe(true);
    expect(existsSync(join(projectDir, 'packed', 'launcher.mjs'))).toBe(true);
    expect(existsSync(join(projectDir, 'packed', manifest.selfHost.gateway.path))).toBe(true);
    expect(existsSync(join(projectDir, 'packed', manifest.selfHost.scheduleSupervisor.path))).toBe(true);
    expect(existsSync(join(projectDir, 'packed', manifest.selfHost.dockerEntrypoint.path))).toBe(true);
    expect(existsSync(join(projectDir, 'packed', 'run.sh'))).toBe(true);
    expect(existsSync(join(projectDir, 'packed', 'run.cmd'))).toBe(true);
    expect(existsSync(join(projectDir, 'packed', 'edgebase.config.ts'))).toBe(false);
    expect(existsSync(join(projectDir, 'packed', 'functions', 'health.ts'))).toBe(false);
    expect(existsSync(join(projectDir, 'packed', 'config', 'rate-limits.ts'))).toBe(false);
    expect(existsSync(join(projectDir, 'packed', '.edgebase', 'runtime', 'server', 'src', 'index.ts'))).toBe(true);
    expect(existsSync(join(projectDir, 'packed', '.edgebase', 'runtime', 'server', 'src', '_functions-registry.ts'))).toBe(true);
    expect(existsSync(join(projectDir, 'packed', '.edgebase', 'runtime', 'server', 'bundle', 'config', 'edgebase.config.bundle.js'))).toBe(true);
    expect(existsSync(join(projectDir, 'packed', '.edgebase', 'runtime', 'server', 'bundle', 'functions', 'health.js'))).toBe(true);
    const runtimeNodeModulesDir = join(projectDir, 'packed', '.edgebase', 'runtime', 'server', 'node_modules');
    const expectedPortableMiniflareVersion = resolveExpectedPortableMiniflareVersion();
    const bundledPortableMiniflareEntries = readdirSync(join(runtimeNodeModulesDir, '.pnpm')).filter((entry) =>
      entry.startsWith('miniflare@'),
    );
    expect(readBundledPackageVersion(runtimeNodeModulesDir, 'hono')).toBe(
      resolveInstalledPackageVersion('hono'),
    );
    expect(readBundledPackageVersion(runtimeNodeModulesDir, '@asteasolutions/zod-to-openapi')).toBe(
      resolveInstalledPackageVersion('@asteasolutions/zod-to-openapi'),
    );
    expect(readBundledPackageVersion(runtimeNodeModulesDir, 'pg-protocol')).toBe(
      resolveInstalledPackageVersion('pg-protocol'),
    );
    expect(readBundledPackageVersion(runtimeNodeModulesDir, 'wrangler')).toBe(
      resolveInstalledPackageVersion('wrangler'),
    );
    expect(readBundledPackageVersion(runtimeNodeModulesDir, 'miniflare')).toBe(expectedPortableMiniflareVersion);
    expect(resolveBundledWranglerMiniflareVersion(runtimeNodeModulesDir)).toBe(expectedPortableMiniflareVersion);
    expect(bundledPortableMiniflareEntries).toEqual(
      bundledPortableMiniflareEntries.map((entry) => (
        expect.stringMatching(new RegExp(`^miniflare@${escapeRegExp(expectedPortableMiniflareVersion)}`))
      )),
    );
    expect(readBundledPackageVersion(runtimeNodeModulesDir, 'esbuild')).not.toBeNull();
    expect(readBundledPackageVersion(runtimeNodeModulesDir, 'unenv')).toBe(
      resolveInstalledPackageVersion('unenv'),
    );
    expect(readBundledPackageVersion(runtimeNodeModulesDir, 'vitest')).toBeNull();
    expect(existsSync(join(runtimeNodeModulesDir, '@edge-base', 'core', 'package.json'))).toBe(true);
    expect(lstatSync(runtimeNodeModulesDir).isSymbolicLink()).toBe(false);
    expect(existsSync(join(projectDir, 'packed', '.edgebase', 'runtime', 'server', 'app-assets', 'admin', 'index.html'))).toBe(true);
    expect(existsSync(join(projectDir, 'packed', '.edgebase', 'runtime', 'server', 'app-assets', 'index.html'))).toBe(false);
    expect(existsSync(join(projectDir, 'packed', 'wrangler.toml'))).toBe(true);
    expect(existsSync(join(projectDir, 'packed', '.dev.vars'))).toBe(false);
    expect(readFileSync(join(projectDir, 'packed', 'wrangler.toml'), 'utf-8')).toContain('binding = "DB_D1_SHARED"');
    expect(readFileSync(join(projectDir, 'packed', 'wrangler.toml'), 'utf-8')).toContain('directory = ".edgebase/runtime/server/app-assets"');
    expect(readFileSync(join(projectDir, 'packed', 'wrangler.toml'), 'utf-8')).not.toContain('directory = ".edgebase/runtime/server/admin-build"');
    expect(readFileSync(join(projectDir, 'packed', 'wrangler.toml'), 'utf-8')).toContain('EDGEBASE_RUNTIME_MODE = "self-hosted"');
    expect(readFileSync(join(projectDir, 'packed', 'wrangler.toml'), 'utf-8')).toContain(
      'main = ".edgebase/runtime/server/src/index.ts"',
    );
    expect(readFileSync(join(projectDir, 'packed', 'wrangler.toml'), 'utf-8')).toContain(
      'compatibility_date = "2025-02-10"',
    );
    expect(readFileSync(join(projectDir, 'packed', 'wrangler.toml'), 'utf-8')).toContain(
      'compatibility_flags = ["nodejs_compat", "nodejs_compat_populate_process_env"]',
    );
    expect(existsSync(join(projectDir, 'packed', '.env.release'))).toBe(false);
    const launcherSource = readFileSync(join(projectDir, 'packed', 'launcher.mjs'), 'utf-8');
    expect(launcherSource).toContain('verifySelfHostAssets(appManifestPath, artifactRoot)');
    expect(launcherSource).toContain("'/__edgebase/internal/self-host/ready'");
    expect(launcherSource).not.toContain('/cdn-cgi/handler/scheduled');
    expect(launcherSource).toContain('EDGEBASE_SELF_HOST_GATEWAY_SECRET');
    expect(launcherSource).toContain('workerTrustSecret: gatewaySecret');
    expect(launcherSource).toContain('healthProvider: () => scheduleSupervisor?.getStatus()');
    expect(launcherSource).toContain('admissionGuard: () => (');
    expect(launcherSource).toContain('const childTerminal = new Promise');
    expect(launcherSource).toContain("detached: process.platform !== 'win32'");
    expect(launcherSource).toContain('process.kill(-pid, signal)');
    expect(launcherSource).toContain('signalProcessTree(child.pid, signal)');
    expect(launcherSource).toContain("signalProcessTree(child.pid, 'SIGKILL')");
    const launcherReady = launcherSource.indexOf('await waitForInternalRuntime(');
    const launcherState = launcherSource.indexOf(
      'supervisorModule.readSelfHostScheduleState(scheduleStatePath)',
    );
    const launcherPass = launcherSource.indexOf(
      'const initialReport = await raceChild(',
    );
    const launcherGateway = launcherSource.indexOf('gateway = await raceChild(startSelfHostGateway');
    expect(launcherReady).toBeGreaterThanOrEqual(0);
    expect(launcherReady).toBeLessThan(launcherState);
    expect(launcherState).toBeLessThan(launcherPass);
    expect(launcherPass).toBeLessThan(launcherGateway);
    for (const artifactPath of [
      join(projectDir, 'packed', '.edgebase', 'runtime', 'server', 'src', 'generated-config.ts'),
      join(projectDir, 'packed', '.edgebase', 'runtime', 'server', 'bundle', 'config', 'edgebase.config.bundle.js'),
      join(projectDir, 'packed', 'edgebase-app.json'),
      join(projectDir, 'packed', 'edgebase-pack.json'),
      join(projectDir, 'packed', 'launcher.mjs'),
      join(projectDir, 'packed', 'wrangler.toml'),
    ]) {
      expect(readFileSync(artifactPath, 'utf-8')).not.toContain(packSecretSentinel);
    }
    expect(findSentinelInSmallPackedFiles(
      join(projectDir, 'packed'),
      packSecretSentinel,
    )).toEqual([]);

    const runtimeEnvPath = join(projectDir, 'pack-runtime.env');
    writeFileSync(runtimeEnvPath, 'EXPLICIT_APP_SECRET=synthetic-explicit-value\n');
    const liveDataRoot = join(projectDir, 'launcher-live-data');
    const liveWorkDir = join(liveDataRoot, manifest.launcher.runtimeDir);
    const liveDevVarsPath = join(liveWorkDir, '.dev.vars');
    mkdirSync(liveWorkDir, { recursive: true });
    writeFileSync(liveDevVarsPath, 'STALE_SECRET=must-be-replaced\n');
    if (process.platform !== 'win32') {
      chmodSync(liveDevVarsPath, 0o644);
    }
    const liveGatewayPort = await findFreePort();
    let liveInternalPort = 0;
    const launcher = spawn(
      process.execPath,
      [
        join(projectDir, 'packed', 'launcher.mjs'),
        '--host',
        '127.0.0.1',
        '--port',
        String(liveGatewayPort),
        '--data-dir',
        liveDataRoot,
        '--persist-to',
        join(liveDataRoot, 'state'),
        '--env-file',
        runtimeEnvPath,
      ],
      {
        cwd: join(projectDir, 'packed'),
        env: {
          ...process.env,
          EDGEBASE_RUNTIME_ENV_ALLOWLIST: 'CUSTOM_APP_API_KEY,PACK_DOLLAR_SECRET',
          CUSTOM_APP_API_KEY: 'synthetic-process-value',
          PACK_DOLLAR_SECRET: 'prefix-$UNSET-suffix',
          UNRELATED_SHELL_SECRET: 'must-not-reach-worker',
          NPM_TOKEN: 'must-not-reach-worker',
          GITHUB_TOKEN: 'must-not-reach-worker',
          CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
        },
        stdio: 'ignore',
      },
    );
    try {
      await waitForFile(liveDevVarsPath);
      // The lock is published only after the launcher installs its shutdown
      // handlers, so it is the readiness signal for exercising cleanup.
      const liveLockPath = join(liveDataRoot, 'launcher-lock.json');
      await waitForFile(liveLockPath, 30_000);
      const liveLock = JSON.parse(readFileSync(liveLockPath, 'utf-8')) as {
        externalHost: string;
        externalPort: number;
        internalHost: string;
        internalPort: number;
        gatewayProtocol: string;
        gatewayUpstream: string;
        supervisorRuntimeOrigin: string;
        appManifestPath: string;
        scheduleStatePath: string;
      };
      liveInternalPort = liveLock.internalPort;
      expect(liveLock).toMatchObject({
        externalHost: '127.0.0.1',
        externalPort: liveGatewayPort,
        internalHost: '127.0.0.1',
        gatewayProtocol: 'http',
        appManifestPath: realpathSync(join(projectDir, 'packed', 'edgebase-app.json')),
        scheduleStatePath: join(liveDataRoot, 'self-host-schedule-state.json'),
      });
      expect(liveLock.internalPort).not.toBe(liveGatewayPort);
      expect(liveLock.gatewayUpstream).toBe(`http://127.0.0.1:${liveLock.internalPort}`);
      expect(liveLock.supervisorRuntimeOrigin).toBe(liveLock.gatewayUpstream);

      const blockedControl = await fetch(
        `http://127.0.0.1:${liveGatewayPort}/cdn-cgi/handler/scheduled?time=0&cron=*`,
      );
      expect(blockedControl.status).toBe(404);
      const gatewayHealth = await fetch(
        `http://127.0.0.1:${liveGatewayPort}/__edgebase/health`,
      );
      expect(gatewayHealth.status).toBe(200);
      await expect(gatewayHealth.json()).resolves.toMatchObject({
        schemaVersion: 1,
        outcome: 'ok',
        product: 'proxy-ready',
        scheduler: {
          state: 'ready',
          structuralReady: true,
        },
      });
      try {
        await expect(waitForHttpStatus(
          `http://127.0.0.1:${liveGatewayPort}/api/health`,
          200,
        )).resolves.toBeInstanceOf(Response);
      } catch (error) {
        const launcherLogPath = join(liveDataRoot, 'launcher.log');
        throw new Error(
          existsSync(launcherLogPath) ? readFileSync(launcherLogPath, 'utf-8') : 'launcher log missing',
          { cause: error },
        );
      }
      const scheduleState = await waitForSuccessfulScheduleState(liveLock.scheduleStatePath);
      expect(scheduleState.manifestDigest).toBe(appManifest.schedules.digest);
      if (process.platform !== 'win32') {
        expect(statSync(liveLock.scheduleStatePath).mode & 0o777).toBe(0o600);
      }
      const liveDevVars = readFileSync(liveDevVarsPath, 'utf-8');
      const liveEnvKeys = new Set(
        liveDevVars
          .split(/\r?\n/)
          .filter((line) => line && !line.startsWith('#') && line.includes('='))
          .map((line) => line.slice(0, line.indexOf('='))),
      );
      expect(liveDevVars.includes('CUSTOM_APP_API_KEY=synthetic-process-value')).toBe(true);
      expect(liveDevVars.includes('EDGEBASE_RUNTIME_MODE=self-hosted')).toBe(true);
      expect(liveDevVars.includes('EXPLICIT_APP_SECRET=synthetic-explicit-value')).toBe(true);
      expect(liveDevVars.includes('PACK_DOLLAR_SECRET="prefix-\\$UNSET-suffix"')).toBe(true);
      for (const ambientKey of [
        'CLOUDFLARE_INCLUDE_PROCESS_ENV',
        'EDGEBASE_RUNTIME_ENV_ALLOWLIST',
        'GITHUB_TOKEN',
        'HOME',
        'NPM_TOKEN',
        'PATH',
        'SHELL',
        'SSH_AUTH_SOCK',
        'UNRELATED_SHELL_SECRET',
        'USER',
      ]) {
        expect(liveEnvKeys.has(ambientKey)).toBe(false);
      }
      expect(liveEnvKeys.has('STALE_SECRET')).toBe(false);
      if (process.platform !== 'win32') {
        expect(statSync(liveDevVarsPath).mode & 0o777).toBe(0o600);
      }
      expect(readdirSync(liveWorkDir).filter((entry) => entry.startsWith('.dev.vars.'))).toEqual([]);
    } finally {
      await stopChild(launcher);
    }
    expect(existsSync(liveDevVarsPath)).toBe(false);
    expect(existsSync(join(liveDataRoot, 'launcher-lock.json'))).toBe(false);
    await expect(canBindPort(liveGatewayPort)).resolves.toBe(true);
    await expect(canBindPort(liveInternalPort)).resolves.toBe(true);
    expect(readdirSync(liveWorkDir).filter((entry) => entry.startsWith('.dev.vars.'))).toEqual([]);

    const childDeathDataRoot = join(projectDir, 'launcher-child-death-data');
    const childDeathGatewayPort = await findFreePort();
    const childDeathLauncher = spawn(
      process.execPath,
      [
        join(projectDir, 'packed', 'launcher.mjs'),
        '--host',
        '127.0.0.1',
        '--port',
        String(childDeathGatewayPort),
        '--data-dir',
        childDeathDataRoot,
      ],
      {
        cwd: join(projectDir, 'packed'),
        env: { ...process.env, EDGEBASE_OPEN: '0' },
        stdio: 'ignore',
      },
    );
    const childDeathLockPath = join(childDeathDataRoot, 'launcher-lock.json');
    await waitForFile(childDeathLockPath, 30_000);
    const childDeathLock = JSON.parse(readFileSync(childDeathLockPath, 'utf-8')) as {
      childPid: number;
      internalPort: number;
    };
    const childDeathExit = waitForChildExit(childDeathLauncher);
    process.kill(childDeathLock.childPid, 'SIGTERM');
    await childDeathExit;
    expect(existsSync(childDeathLockPath)).toBe(false);
    await expect(canBindPort(childDeathGatewayPort)).resolves.toBe(true);
    await expect(canBindPort(childDeathLock.internalPort)).resolves.toBe(true);

    const expectedWorkDir = join(appDataRoot, manifest.launcher.runtimeDir);
    mkdirSync(expectedWorkDir, { recursive: true });
    writeFileSync(join(expectedWorkDir, '.dev.vars'), 'STALE_SECRET=must-be-replaced\n');
    if (process.platform !== 'win32') {
      chmodSync(join(expectedWorkDir, '.dev.vars'), 0o644);
    }

    const dryRun = await runBufferedProcess(
      process.execPath,
      [
        join(projectDir, 'packed', 'launcher.mjs'),
        '--dry-run',
        '--json',
        '--env-file',
        runtimeEnvPath,
      ],
      {
        cwd: join(projectDir, 'packed'),
        encoding: 'utf-8',
        env: {
          ...process.env,
          NO_COLOR: '1',
          EDGEBASE_RUNTIME_ENV_ALLOWLIST: 'CUSTOM_APP_API_KEY',
          CUSTOM_APP_API_KEY: 'synthetic-process-value',
          NPM_TOKEN: 'must-not-reach-worker',
          GITHUB_TOKEN: 'must-not-reach-worker',
          CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
        },
      },
    );

    expect(dryRun.status).toBe(0);
    const launchPlan = JSON.parse(dryRun.stdout) as {
      artifactRoot: string;
      host: string;
      port: number;
      persistDir: string;
      devVarsPath: string;
      devVarsMode: number | null;
      openUrl: string;
      wranglerBin: string;
      wranglerArgs: string[];
      protocol: string;
      externalHost: string;
      externalPort: number;
      internalHost: string;
      internalPort: number;
      gatewayUpstream: string;
      supervisorRuntimeOrigin: string;
      appManifestPath: string;
      scheduleStatePath: string;
    };

    expect(launchPlan.artifactRoot).toBe(realpathSync(join(projectDir, 'packed')));
    expect(launchPlan.host).toBe('127.0.0.1');
    expect(launchPlan.port).toBe(manifest.launcher.defaultPort);
    expect(launchPlan.protocol).toBe('http');
    expect(launchPlan.externalHost).toBe('127.0.0.1');
    expect(launchPlan.externalPort).toBe(manifest.launcher.defaultPort);
    expect(launchPlan.internalHost).toBe('127.0.0.1');
    expect(launchPlan.internalPort).not.toBe(launchPlan.externalPort);
    expect(launchPlan.gatewayUpstream).toBe(`http://127.0.0.1:${launchPlan.internalPort}`);
    expect(launchPlan.supervisorRuntimeOrigin).toBe(launchPlan.gatewayUpstream);
    expect(launchPlan.appManifestPath).toBe(realpathSync(join(projectDir, 'packed', 'edgebase-app.json')));
    expect(launchPlan.scheduleStatePath).toBe(join(appDataRoot, 'self-host-schedule-state.json'));
    expect(launchPlan.dataRoot).toBe(appDataRoot);
    expect(launchPlan.workDir).toBe(join(appDataRoot, manifest.launcher.runtimeDir));
    expect(launchPlan.persistDir).toBe(join(appDataRoot, manifest.launcher.stateDir));
    expect(launchPlan.devVarsPath).toBe(join(appDataRoot, manifest.launcher.runtimeDir, '.dev.vars'));
    expect(launchPlan.statePath).toBe(join(appDataRoot, 'launcher-state.json'));
    expect(launchPlan.lockPath).toBe(join(appDataRoot, 'launcher-lock.json'));
    expect(launchPlan.existingInstance).toBe(false);
    expect(launchPlan.openUrl).toBe(`http://127.0.0.1:${manifest.launcher.defaultPort}/admin`);
    expect(launchPlan.wranglerBin).toContain('wrangler');
    expect(launchPlan.wranglerArgs).toEqual(expect.arrayContaining([
      'dev',
      '--config',
      realpathSync(join(projectDir, 'packed', 'wrangler.toml')),
      '--env-file',
      join(appDataRoot, manifest.launcher.runtimeDir, '.dev.vars'),
      '--persist-to',
      join(appDataRoot, manifest.launcher.stateDir),
      '--port',
      String(launchPlan.internalPort),
      '--ip',
      '127.0.0.1',
    ]));
    expect(launchPlan.wranglerArgs).not.toContain(String(launchPlan.externalPort));
    if (process.platform !== 'win32') {
      expect(launchPlan.devVarsMode).toBe(0o600);
    }
    expect(existsSync(join(appDataRoot, manifest.launcher.runtimeDir, '.dev.vars'))).toBe(false);
    expect(
      readdirSync(join(appDataRoot, manifest.launcher.runtimeDir))
        .filter((entry) => entry.startsWith('.dev.vars.')),
    ).toEqual([]);

    const failureDataRoot = join(projectDir, 'launcher-failure-data');
    const failedLaunch = await runBufferedProcess(
      process.execPath,
      [
        join(projectDir, 'packed', 'launcher.mjs'),
        '--host',
        '127.0.0.1',
        '--port',
        '70000',
        '--data-dir',
        failureDataRoot,
        '--persist-to',
        join(failureDataRoot, 'state'),
      ],
      {
        cwd: join(projectDir, 'packed'),
        encoding: 'utf-8',
        env: {
          ...process.env,
          CUSTOM_APP_API_KEY: 'synthetic-process-value',
        },
        timeout: 30_000,
      },
    );
    expect(failedLaunch.status).not.toBe(0);
    expect(existsSync(join(failureDataRoot, manifest.launcher.runtimeDir, '.dev.vars'))).toBe(false);
    expect(
      readdirSync(join(failureDataRoot, manifest.launcher.runtimeDir))
        .filter((entry) => entry.startsWith('.dev.vars.')),
    ).toEqual([]);

    const occupiedGateway = createServer();
    const occupiedPort = await new Promise<number>((resolvePort, reject) => {
      occupiedGateway.once('error', reject);
      occupiedGateway.listen(0, '127.0.0.1', () => {
        const address = occupiedGateway.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Could not resolve occupied gateway test port.'));
          return;
        }
        resolvePort(address.port);
      });
    });
    const collisionDataRoot = join(projectDir, 'launcher-collision-data');
    try {
      const collidedLaunch = await runBufferedProcess(
        process.execPath,
        [
          join(projectDir, 'packed', 'launcher.mjs'),
          '--host',
          '127.0.0.1',
          '--port',
          String(occupiedPort),
          '--data-dir',
          collisionDataRoot,
        ],
        {
          cwd: join(projectDir, 'packed'),
          encoding: 'utf-8',
          timeout: 30_000,
        },
      );
      expect(collidedLaunch.status).not.toBe(0);
      expect(collidedLaunch.stderr).toContain(
        `Explicit gateway port ${occupiedPort} is not available on 127.0.0.1.`,
      );
      expect(existsSync(join(collisionDataRoot, 'launcher-lock.json'))).toBe(false);
      expect(existsSync(join(
        collisionDataRoot,
        manifest.launcher.runtimeDir,
        '.dev.vars',
      ))).toBe(false);
    } finally {
      await new Promise<void>((resolveClose) => occupiedGateway.close(() => resolveClose()));
    }
  });

  it('includes configured frontend assets in the packed runtime scaffold', { timeout: 90_000 }, async () => {
    const projectDir = createTempProject('frontend');
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
    headers: {
      'Content-Security-Policy': "default-src 'self'",
      'X-Frame-Options': 'DENY',
    },
  },
});
`,
    );
    writeFileSync(join(projectDir, 'functions', 'health.ts'), 'export default async () => new Response("ok");\n');
    writeFileSync(join(projectDir, 'web', 'dist', 'index.html'), '<!doctype html><html><body>frontend</body></html>\n');
    writeFileSync(join(projectDir, 'web', 'dist', 'assets', 'main.12345678.js'), 'console.log("frontend");\n');

    const result = await runPack(projectDir, 'artifact');

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toBe('');

    const payload = JSON.parse(result.stdout) as {
      status: string;
      manifest: {
        frontend: {
          enabled: boolean;
          mountPath?: string;
          spaFallback?: boolean;
          headers?: Record<string, string>;
        };
      };
    };

    expect(payload).toMatchObject({
      status: 'success',
      manifest: {
        frontend: {
          enabled: true,
          mountPath: '/app',
          spaFallback: true,
          headers: {
            'Content-Security-Policy': "default-src 'self'",
            'X-Frame-Options': 'DENY',
          },
        },
      },
    });

    expect(existsSync(join(projectDir, 'artifact', 'web', 'dist', 'index.html'))).toBe(false);
    expect(existsSync(join(projectDir, 'artifact', 'edgebase-app.json'))).toBe(true);
    expect(existsSync(join(projectDir, 'artifact', '.edgebase', 'runtime', 'server', 'app-assets', 'admin', 'index.html'))).toBe(true);
    expect(existsSync(join(projectDir, 'artifact', '.edgebase', 'runtime', 'server', 'app-assets', 'app', 'index.html'))).toBe(true);
    expect(existsSync(join(projectDir, 'artifact', '.edgebase', 'runtime', 'server', 'app-assets', 'app', 'assets', 'main.12345678.js'))).toBe(true);
    expect(existsSync(join(projectDir, 'artifact', '.edgebase', 'runtime', 'server', 'bundle', 'config', 'edgebase.config.bundle.js'))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(projectDir, 'artifact', 'edgebase-pack.json'), 'utf-8')) as {
      launcher: { defaultOpenPath: string; defaultPort: number; appDataDirName: string; stateDir: string; runtimeDir: string };
    };
    expect(manifest.launcher.defaultOpenPath).toBe('/app');
    appDataDirs.push(resolveAppDataRoot(manifest.launcher.appDataDirName));

    const dryRun = await runBufferedProcess(
      process.execPath,
      [join(projectDir, 'artifact', 'launcher.mjs'), '--dry-run', '--json'],
      {
        cwd: join(projectDir, 'artifact'),
        encoding: 'utf-8',
      },
    );

    expect(dryRun.status).toBe(0);
    const launchPlan = JSON.parse(dryRun.stdout) as { openUrl: string; port: number };
    expect(launchPlan.port).toBeGreaterThanOrEqual(manifest.launcher.defaultPort);
    expect(launchPlan.port).toBeLessThan(manifest.launcher.defaultPort + manifest.launcher.portSearchLimit);
    expect(launchPlan.openUrl).toBe(`http://127.0.0.1:${launchPlan.port}/app`);
  });

  it('reuses an existing launcher instance when a live lock file is present', { timeout: 90_000 }, async () => {
    const projectDir = createTempProject('single-instance');
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

    const result = await runPack(projectDir, 'packed');

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toBe('');

    const manifest = JSON.parse(readFileSync(join(projectDir, 'packed', 'edgebase-pack.json'), 'utf-8')) as {
      launcher: { appDataDirName: string };
    };
    const appDataRoot = resolveAppDataRoot(manifest.launcher.appDataDirName);
    appDataDirs.push(appDataRoot);
    mkdirSync(appDataRoot, { recursive: true });
    writeFileSync(
      join(appDataRoot, 'launcher-lock.json'),
      JSON.stringify({
        pid: process.pid,
        host: '127.0.0.1',
        port: 49091,
        externalHost: '127.0.0.1',
        externalPort: 49091,
        internalHost: '127.0.0.1',
        internalPort: 49191,
        gatewayProtocol: 'http',
        gatewayUpstream: 'http://127.0.0.1:49191',
        supervisorRuntimeOrigin: 'http://127.0.0.1:49191',
        createdAt: new Date().toISOString(),
      }, null, 2) + '\n',
    );

    const dryRun = await runBufferedProcess(
      process.execPath,
      [join(projectDir, 'packed', 'launcher.mjs'), '--dry-run', '--json'],
      {
        cwd: join(projectDir, 'packed'),
        encoding: 'utf-8',
      },
    );

    expect(dryRun.status).toBe(0);
    const launchPlan = JSON.parse(dryRun.stdout) as {
      port: number;
      existingInstance: boolean;
      openUrl: string;
      statePath: string;
      externalPort: number;
      internalPort: number;
      gatewayUpstream: string;
      supervisorRuntimeOrigin: string;
    };
    expect(launchPlan.port).toBe(49091);
    expect(launchPlan.existingInstance).toBe(true);
    expect(launchPlan.openUrl).toBe('http://127.0.0.1:49091/admin');
    expect(launchPlan.externalPort).toBe(49091);
    expect(launchPlan.internalPort).toBe(49191);
    expect(launchPlan.gatewayUpstream).toBe('http://127.0.0.1:49191');
    expect(launchPlan.supervisorRuntimeOrigin).toBe(launchPlan.gatewayUpstream);

    const savedState = JSON.parse(readFileSync(launchPlan.statePath, 'utf-8')) as {
      host: string;
      port: number;
    };
    expect(savedState).toMatchObject({
      host: '127.0.0.1',
      port: 49091,
    });
  });
});
