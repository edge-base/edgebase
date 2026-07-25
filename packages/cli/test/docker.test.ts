/**
 * Tests for CLI docker command — findProjectRoot, argument construction.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _internals, dockerCommand } from '../src/commands/docker.js';
import type {
  CreateAppBundleOptions,
  CreateAppBundleResult,
  EdgeBaseAppManifest,
} from '../src/lib/app-bundle.js';
import {
  createDockerContextGenerationManager,
  type DockerContextGenerationManager,
} from '../src/lib/docker-context-generation.js';
import { buildManagedD1DatabaseName } from '../src/lib/managed-resource-names.js';
import { resolveTsxCommand } from '../src/lib/node-tools.js';

let tmpDir: string;
const cliPackageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dockerfilePath = resolve(cliPackageDir, '..', '..', 'Dockerfile');
const tsxCommand = resolveTsxCommand();
const tsxExecOptions = /\.cmd$/i.test(tsxCommand.command) ? { shell: true as const } : {};

class FakeDockerChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly killedSignals: NodeJS.Signals[] = [];

  kill(signal?: number | NodeJS.Signals): boolean {
    if (typeof signal === 'string') this.killedSignals.push(signal);
    return true;
  }
}

function fakeDockerSpawn(child: FakeDockerChild): typeof spawn {
  return (() => child) as unknown as typeof spawn;
}

function fakeSignalTarget(emitter: EventEmitter): Pick<NodeJS.Process, 'on' | 'off'> {
  return emitter as unknown as Pick<NodeJS.Process, 'on' | 'off'>;
}

type BundleCreator = (
  projectDir: string,
  options?: CreateAppBundleOptions,
) => CreateAppBundleResult;

interface SyntheticBundleObservation {
  outputDir?: string;
  overwrite?: boolean;
  portableDependencies?: boolean;
  dependencyProfile?: string;
  finalizerCalls: string[];
  prepareStaging?: (stagingDir: string) => void;
}

function writeDockerProjectFixture(projectDir: string): void {
  writeFileSync(
    join(projectDir, 'Dockerfile'),
    'FROM node:22\nCOPY .edgebase/targets/docker-app/ /app/\nCMD ["node", "/app/.edgebase/self-host/self-host-docker-entrypoint.mjs"]\n',
  );
  writeFileSync(join(projectDir, '.dockerignore'), 'node_modules\n.edgebase\n');
}

function syntheticBundleCreator(
  marker: string,
  observation: SyntheticBundleObservation = { finalizerCalls: [] },
): BundleCreator {
  return (projectDir, options = {}) => {
    const outputDir = resolve(projectDir, options.outputDir ?? '.edgebase/targets/docker-app');
    const outputParent = dirname(outputDir);
    const outputName = basename(outputDir);
    const generationsDir = join(outputParent, `.${outputName}.generations`);
    const digest = createHash('sha256').update(`${marker}:${outputDir}`).digest('hex');
    const generation = `sha256:${digest}` as const;
    const stagingDir = join(outputParent, `.${outputName}.sync-test`);
    const generationDir = join(generationsDir, `${digest}-${process.pid}-test`);
    const manifest = {
      schemaVersion: 1,
      format: 'app-bundle',
      generation,
      marker,
    } as unknown as EdgeBaseAppManifest;

    observation.outputDir = outputDir;
    observation.overwrite = options.overwrite;
    observation.portableDependencies = options.portableDependencies;
    observation.dependencyProfile = options.dependencyProfile;
    mkdirSync(join(stagingDir, '.edgebase', 'runtime', 'server'), { recursive: true });
    writeFileSync(join(stagingDir, 'edgebase-app.json'), `${JSON.stringify(manifest)}\n`);
    writeFileSync(join(stagingDir, 'marker.txt'), `${marker}\n`);
    writeFileSync(
      join(stagingDir, '.edgebase', 'runtime', 'server', `${marker}.mjs`),
      `export const marker = ${JSON.stringify(marker)};\n`,
    );
    observation.prepareStaging?.(stagingDir);
    if (options.stagedGenerationFinalizer) {
      observation.finalizerCalls.push(stagingDir);
      options.stagedGenerationFinalizer(stagingDir, manifest);
    }
    mkdirSync(generationsDir, { recursive: true });
    renameSync(stagingDir, generationDir);
    symlinkSync(relative(outputParent, generationDir), outputDir, 'dir');

    return {
      format: 'app-bundle',
      projectDir,
      outputDir,
      manifestPath: join(outputDir, 'edgebase-app.json'),
      manifest,
      functions: [],
    };
  };
}

function stateEntries(projectDir: string, name: 'leasesDir' | 'bundleWorkDir' | 'generationsDir'): string[] {
  const path = createDockerContextGenerationManager(projectDir).paths[name];
  return readdirSync(path).sort();
}

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-docker-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('Docker child process lifecycle', () => {
  it.each([false, true])(
    'does not settle on exit and resolves exactly once on close when inheritOutput=%s',
    async (inheritOutput) => {
      const child = new FakeDockerChild();
      const signalTarget = new EventEmitter();
      let settlements = 0;
      const result = _internals.runDockerProcess(['build', '.'], {
        inheritOutput,
        spawnProcess: fakeDockerSpawn(child),
        signalTarget: fakeSignalTarget(signalTarget),
      }).then((value) => {
        settlements += 1;
        return value;
      });

      child.stdout.write(' build output \n');
      child.stderr.write(' warning \n');
      child.emit('exit', 0, null);
      await Promise.resolve();
      expect(settlements).toBe(0);
      expect(signalTarget.listenerCount('SIGINT')).toBe(1);
      expect(signalTarget.listenerCount('SIGTERM')).toBe(1);

      child.emit('close', 0, null);
      await expect(result).resolves.toEqual({
        stdout: inheritOutput ? '' : 'build output',
        stderr: inheritOutput ? '' : 'warning',
      });
      child.emit('close', 7, null);
      await Promise.resolve();
      expect(settlements).toBe(1);
      expect(signalTarget.listenerCount('SIGINT')).toBe(0);
      expect(signalTarget.listenerCount('SIGTERM')).toBe(0);
    },
  );

  it('records a spawn error but rejects only when close settles the child', async () => {
    const child = new FakeDockerChild();
    const signalTarget = new EventEmitter();
    const spawnError = Object.assign(new Error('synthetic spawn failure'), { code: 'ENOENT' });
    let settled = false;
    const result = _internals.runDockerProcess(['build', '.'], {
      inheritOutput: false,
      spawnProcess: fakeDockerSpawn(child),
      signalTarget: fakeSignalTarget(signalTarget),
    }).catch((error: unknown) => {
      settled = true;
      return error;
    });

    child.emit('error', spawnError);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(signalTarget.listenerCount('SIGINT')).toBe(1);
    child.emit('close', null, null);

    const observed = await result as Error & {
      code: string;
      stdout: string;
      stderr: string;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    };
    expect(observed).toBe(spawnError);
    expect(observed).toMatchObject({
      code: 'ENOENT',
      stdout: '',
      stderr: '',
      exitCode: null,
      signal: null,
    });
    expect(signalTarget.listenerCount('SIGINT')).toBe(0);
    expect(signalTarget.listenerCount('SIGTERM')).toBe(0);
  });

  it('reports nonzero exits with captured output, code, and signal state', async () => {
    const child = new FakeDockerChild();
    const result = _internals.runDockerProcess(['build', '.'], {
      inheritOutput: false,
      spawnProcess: fakeDockerSpawn(child),
      signalTarget: fakeSignalTarget(new EventEmitter()),
    }).catch((error: unknown) => error);

    child.stdout.write('partial output');
    child.stderr.write('build rejected');
    child.emit('close', 23, null);

    await expect(result).resolves.toMatchObject({
      message: 'build rejected',
      code: 23,
      signal: null,
      stdout: 'partial output',
      stderr: 'build rejected',
    });
  });

  it('reports signal termination without treating it as success', async () => {
    const child = new FakeDockerChild();
    const result = _internals.runDockerProcess(['build', '.'], {
      inheritOutput: true,
      spawnProcess: fakeDockerSpawn(child),
      signalTarget: fakeSignalTarget(new EventEmitter()),
    }).catch((error: unknown) => error);

    child.emit('close', null, 'SIGTERM');

    await expect(result).resolves.toMatchObject({
      message: 'docker build terminated by SIGTERM.',
      code: null,
      signal: 'SIGTERM',
    });
  });

  it.each([false, true])(
    'forwards signals and restores listeners when inheritOutput=%s',
    async (inheritOutput) => {
      const child = new FakeDockerChild();
      const signalTarget = new EventEmitter();
      const initialSigint = signalTarget.listenerCount('SIGINT');
      const initialSigterm = signalTarget.listenerCount('SIGTERM');
      const result = _internals.runDockerProcess(['build', '.'], {
        inheritOutput,
        spawnProcess: fakeDockerSpawn(child),
        signalTarget: fakeSignalTarget(signalTarget),
      });

      expect(signalTarget.listenerCount('SIGINT')).toBe(initialSigint + 1);
      expect(signalTarget.listenerCount('SIGTERM')).toBe(initialSigterm + 1);
      signalTarget.emit('SIGINT');
      signalTarget.emit('SIGTERM');
      expect(child.killedSignals).toEqual(['SIGINT', 'SIGTERM']);

      child.emit('close', 0, null);
      await expect(result).resolves.toEqual({ stdout: '', stderr: '' });
      expect(signalTarget.listenerCount('SIGINT')).toBe(initialSigint);
      expect(signalTarget.listenerCount('SIGTERM')).toBe(initialSigterm);
    },
  );

  it('does not accumulate signal listeners across repeated calls', async () => {
    const signalTarget = new EventEmitter();

    for (let index = 0; index < 4; index += 1) {
      const child = new FakeDockerChild();
      const result = _internals.runDockerProcess(['build', '.'], {
        inheritOutput: index % 2 === 0,
        spawnProcess: fakeDockerSpawn(child),
        signalTarget: fakeSignalTarget(signalTarget),
      });
      expect(signalTarget.listenerCount('SIGINT')).toBe(1);
      expect(signalTarget.listenerCount('SIGTERM')).toBe(1);
      child.emit('close', 0, null);
      await result;
      expect(signalTarget.listenerCount('SIGINT')).toBe(0);
      expect(signalTarget.listenerCount('SIGTERM')).toBe(0);
    }
  });
});

describe('self-host startup readiness', () => {
  it('keeps one accepted readiness probe in flight while the runtime is still starting', async () => {
    const entrypointSource = readFileSync(
      join(cliPackageDir, 'src', 'templates', 'self-host', 'self-host-docker-entrypoint.mjs'),
      'utf-8',
    );
    const timeoutMatch = entrypointSource.match(/const STARTUP_TIMEOUT_MS = 90_000;/);
    const controlRootMatch = entrypointSource.match(
      /const CONTROL_ROOT = '\/__edgebase\/internal\/self-host';/,
    );
    const remainingStart = entrypointSource.indexOf('function remainingMs(');
    const remainingEnd = entrypointSource.indexOf('\n\nasync function waitUntil(', remainingStart);
    const readinessStart = entrypointSource.indexOf('async function waitForOwnedRuntime(');
    const readinessEnd = entrypointSource.indexOf('\n\nconst { manifest, assets }', readinessStart);
    expect(timeoutMatch).not.toBeNull();
    expect(controlRootMatch).not.toBeNull();
    expect(remainingStart).toBeGreaterThanOrEqual(0);
    expect(remainingEnd).toBeGreaterThan(remainingStart);
    expect(readinessStart).toBeGreaterThanOrEqual(0);
    expect(readinessEnd).toBeGreaterThan(readinessStart);

    const fixtureModulePath = join(tmpDir, 'runtime-readiness-fixture.mjs');
    const fixtureSource = [
      timeoutMatch?.[0],
      controlRootMatch?.[0],
      entrypointSource.slice(remainingStart, remainingEnd),
      entrypointSource.slice(readinessStart, readinessEnd),
      `
const generation = \`sha256:\${'a'.repeat(64)}\`;
const scheduleDigest = \`sha256:\${'b'.repeat(64)}\`;
const serverTimers = new Set();
let serverInFlight = 0;
let maximumServerInFlight = 0;
globalThis.fetch = (_url, init = {}) => new Promise((resolve, reject) => {
  serverInFlight += 1;
  maximumServerInFlight = Math.max(maximumServerInFlight, serverInFlight);
  const timer = setTimeout(() => {
    serverTimers.delete(timer);
    serverInFlight -= 1;
    resolve({
      ok: true,
      json: async () => ({
        outcome: 'ok',
        runtime: 'edgebase-self-host',
        generation,
        scheduleDigest,
      }),
    });
  }, 300);
  serverTimers.add(timer);
  init.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true });
});
let resolved = true;
let error = null;
try {
  await waitForOwnedRuntime(
    'http://127.0.0.1:8788',
    'fixture-secret',
    { generation, scheduleDigest },
    async (operation) => operation,
    new AbortController().signal,
  );
} catch (caught) {
  resolved = false;
  error = String(caught?.message ?? caught);
}
for (const timer of serverTimers) clearTimeout(timer);
console.log(JSON.stringify({ resolved, maximumServerInFlight, error }));
`,
      '',
    ].join('\n\n')
      .replace('const STARTUP_TIMEOUT_MS = 90_000;', 'const STARTUP_TIMEOUT_MS = 450;')
      .replace('AbortSignal.timeout(1_000)', 'AbortSignal.timeout(25)');
    writeFileSync(fixtureModulePath, fixtureSource);
    const fixtureRun = spawnSync(process.execPath, [fixtureModulePath], {
      encoding: 'utf-8',
      timeout: 2_000,
      stdio: 'pipe',
    });
    expect(fixtureRun.status, fixtureRun.stderr || fixtureRun.stdout).toBe(0);
    const observation = JSON.parse(fixtureRun.stdout) as {
      resolved: boolean;
      maximumServerInFlight: number;
      error: string | null;
    };
    expect(observation).toMatchObject({
      resolved: true,
      maximumServerInFlight: 1,
      error: null,
    });
  });

  it('prebuilds one finite worker bundle before launching the long-lived runtime without a bundler', () => {
    const entrypointSource = readFileSync(
      join(cliPackageDir, 'src', 'templates', 'self-host', 'self-host-docker-entrypoint.mjs'),
      'utf-8',
    );
    const timeoutMatch = entrypointSource.match(/const RUNTIME_PREBUILD_TIMEOUT_MS = \d[\d_]*;/);
    const maxBytesMatch = entrypointSource.match(
      /const RUNTIME_PREBUILD_MAX_BYTES = \d+ \* 1024 \* 1024;/,
    );
    const groupShutdownMatch = entrypointSource.match(
      /const RUNTIME_PREBUILD_GROUP_SHUTDOWN_TIMEOUT_MS = \d[\d_]*;/,
    );
    const prebuildStart = entrypointSource.indexOf('function prebuildSelfHostRuntime(');
    const prebuildEnd = entrypointSource.indexOf('\n\nconst { manifest, assets }', prebuildStart);
    expect(timeoutMatch).not.toBeNull();
    expect(maxBytesMatch).not.toBeNull();
    expect(groupShutdownMatch).not.toBeNull();
    expect(prebuildStart).toBeGreaterThanOrEqual(0);
    expect(prebuildEnd).toBeGreaterThan(prebuildStart);
    const groupShutdownTimeoutMs = Number(
      (groupShutdownMatch?.[0].match(/= ([\d_]+);/)?.[1] ?? '0').replaceAll('_', ''),
    );
    expect(groupShutdownTimeoutMs).toBeGreaterThan(0);

    const fakeWranglerPath = join(tmpDir, 'fake-wrangler.sh');
    const argsPath = join(tmpDir, 'wrangler-args.txt');
    const orphanPidPath = join(tmpDir, 'orphan-pid.txt');
    writeFileSync(fakeWranglerPath, `#!/bin/sh
set -eu
printf '%s\\n' "$*" > "$EDGEBASE_FIXTURE_ARGS_PATH"
(sleep 60) &
printf '%s\\n' "$!" > "$EDGEBASE_FIXTURE_ORPHAN_PID_PATH"
outdir=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--outdir' ]; then
    shift
    outdir="$1"
  fi
  shift
done
mkdir -p "$outdir"
printf '%s\\n' 'export default { fetch() { return new Response("ok"); } };' > "$outdir/index.js"
`);
    chmodSync(fakeWranglerPath, 0o755);

    const fixtureModulePath = join(tmpDir, 'runtime-prebuild-fixture.mjs');
    writeFileSync(fixtureModulePath, [
      "import { spawnSync } from 'node:child_process';",
      "import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';",
      "import { join } from 'node:path';",
      timeoutMatch?.[0],
      maxBytesMatch?.[0],
      groupShutdownMatch?.[0],
      entrypointSource.slice(prebuildStart, prebuildEnd),
      `
const bundle = prebuildSelfHostRuntime({
  appRoot: process.cwd(),
  configPath: 'wrangler.toml',
  temporaryRoot: process.env.EDGEBASE_FIXTURE_TEMP_ROOT,
  wranglerCommand: process.env.EDGEBASE_FIXTURE_WRANGLER,
});
const entryPath = bundle.entryPath;
const beforeCleanup = lstatSync(entryPath).isFile();
bundle.cleanup();
let afterCleanup = true;
try {
  lstatSync(entryPath);
} catch {
  afterCleanup = false;
}
console.log(JSON.stringify({ beforeCleanup, afterCleanup, entryPath }));
`,
      '',
    ].join('\n\n'));
    const fixtureRun = spawnSync(process.execPath, [fixtureModulePath], {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: (groupShutdownTimeoutMs * 2) + 2_000,
      stdio: 'pipe',
      env: {
        ...process.env,
        EDGEBASE_FIXTURE_ARGS_PATH: argsPath,
        EDGEBASE_FIXTURE_ORPHAN_PID_PATH: orphanPidPath,
        EDGEBASE_FIXTURE_TEMP_ROOT: tmpDir,
        EDGEBASE_FIXTURE_WRANGLER: fakeWranglerPath,
      },
    });
    expect(fixtureRun.status, fixtureRun.stderr || fixtureRun.stdout).toBe(0);
    const payload = JSON.parse(fixtureRun.stdout.trim()) as {
      beforeCleanup: boolean;
      afterCleanup: boolean;
      entryPath: string;
    };
    expect(payload.beforeCleanup).toBe(true);
    expect(payload.afterCleanup).toBe(false);
    expect(readFileSync(argsPath, 'utf-8')).toMatch(
      /^deploy --dry-run --outdir .+ --config wrangler\.toml\n$/,
    );
    const orphanPid = Number(readFileSync(orphanPidPath, 'utf-8').trim());
    const orphanState = spawnSync('ps', ['-o', 'state=', '-p', String(orphanPid)], {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    const orphanRunning = orphanState.status === 0
      && !orphanState.stdout.trim().startsWith('Z');
    if (orphanRunning) process.kill(orphanPid, 'SIGKILL');
    expect(orphanRunning, 'the finite prebuild must stop its complete process group').toBe(false);

    const runtimeBundle = entrypointSource.indexOf('const runtimeBundle = prebuildSelfHostRuntime(');
    const runtimeArgsStart = entrypointSource.indexOf('const wranglerArgs = [', runtimeBundle);
    const runtimeArgsEnd = entrypointSource.indexOf('];', runtimeArgsStart);
    expect(runtimeBundle).toBeGreaterThanOrEqual(0);
    expect(runtimeArgsStart).toBeGreaterThan(runtimeBundle);
    expect(runtimeArgsEnd).toBeGreaterThan(runtimeArgsStart);
    const runtimeArgs = entrypointSource.slice(runtimeArgsStart, runtimeArgsEnd);
    expect(runtimeArgs).toContain('runtimeBundle.entryPath');
    expect(runtimeArgs).toContain("'--no-bundle'");
  });

  it('launches through an isolated EdgeBase-owned Wrangler proxy runtime', async () => {
    const helperPath = join(
      cliPackageDir,
      'src',
      'templates',
      'self-host',
      'self-host-wrangler-runtime.mjs',
    );
    expect(
      existsSync(helperPath),
      'self-host must package a runtime preparer instead of launching the installed Wrangler directly',
    ).toBe(true);
    if (!existsSync(helperPath)) return;

    const globalRoot = join(tmpDir, 'global');
    const globalNodeModules = join(globalRoot, 'lib', 'node_modules');
    const packageDir = join(globalNodeModules, 'wrangler');
    const dependencyRoot = join(packageDir, 'node_modules');
    const originalProxy = 'export const upstreamFixture = true;\n';
    const ownedProxy = 'export const edgeBaseOwnedFixture = true;\n';
    const fixtureFiles = new Map([
      ['package.json', JSON.stringify({
        name: 'wrangler',
        version: '4.103.0-fixture',
        type: 'module',
        bin: { wrangler: './bin/wrangler.js' },
      })],
      ['bin/wrangler.js', '#!/usr/bin/env node\nimport "../wrangler-dist/cli.js";\n'],
      [
        'wrangler-dist/cli.js',
        'import fixtureDependency from "fixture-dependency";\n'
          + 'console.log(fixtureDependency);\n',
      ],
      ['wrangler-dist/InspectorProxyWorker.js', 'export default {};\n'],
      ['wrangler-dist/ProxyWorker.js', originalProxy],
    ]);
    for (const [relativePath, content] of fixtureFiles) {
      const path = join(packageDir, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    chmodSync(join(packageDir, 'bin', 'wrangler.js'), 0o755);
    const fixtureDependencyDir = join(dependencyRoot, 'fixture-dependency');
    mkdirSync(fixtureDependencyDir, { recursive: true });
    writeFileSync(
      join(fixtureDependencyDir, 'package.json'),
      JSON.stringify({ name: 'fixture-dependency', type: 'module', main: './index.js' }),
    );
    writeFileSync(join(fixtureDependencyDir, 'index.js'), 'export default "fixture-ready";\n');
    const fixtureEsbuildDir = join(dependencyRoot, 'esbuild');
    mkdirSync(fixtureEsbuildDir, { recursive: true });
    writeFileSync(
      join(fixtureEsbuildDir, 'package.json'),
      JSON.stringify({ name: 'esbuild', version: '0.0.0-fixture' }),
    );
    const globalCommand = join(globalRoot, 'bin', 'wrangler');
    mkdirSync(dirname(globalCommand), { recursive: true });
    symlinkSync(join(packageDir, 'bin', 'wrangler.js'), globalCommand, 'file');
    const ownedProxyPath = join(tmpDir, 'edgebase-owned-proxy.js');
    writeFileSync(ownedProxyPath, ownedProxy);

    const helperUrl = pathToFileURL(helperPath);
    helperUrl.searchParams.set('fixture', String(Date.now()));
    const helperModule = await import(helperUrl.href) as {
      prepareSelfHostWranglerTool(options: {
        baseDir: string;
        cacheRoot: string;
        proxyWorkerPath: string;
        wranglerCommand: string;
      }): {
        command: string;
        argsPrefix: string[];
        runtimeDir: string;
      };
    };
    expect(helperModule.prepareSelfHostWranglerTool).toBeTypeOf('function');
    const prepared = helperModule.prepareSelfHostWranglerTool({
      baseDir: tmpDir,
      cacheRoot: join(tmpDir, 'self-host-wrangler-runtime'),
      proxyWorkerPath: ownedProxyPath,
      wranglerCommand: globalCommand,
    });

    expect(prepared.command).toBe(process.execPath);
    expect(prepared.argsPrefix).toEqual([
      join(prepared.runtimeDir, 'bin', 'wrangler.js'),
    ]);
    expect(readFileSync(join(packageDir, 'wrangler-dist', 'ProxyWorker.js'), 'utf8'))
      .toBe(originalProxy);
    expect(readFileSync(join(prepared.runtimeDir, 'wrangler-dist', 'ProxyWorker.js'), 'utf8'))
      .toBe(ownedProxy);
    expect(realpathSync(join(prepared.runtimeDir, 'node_modules'))).toBe(
      realpathSync(dependencyRoot),
    );
    const commandResult = spawnSync(prepared.command, prepared.argsPrefix, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    expect(commandResult.status, commandResult.stderr || commandResult.stdout).toBe(0);
    expect(commandResult.stdout).toContain('fixture-ready');

    const entrypointSource = readFileSync(
      join(cliPackageDir, 'src', 'templates', 'self-host', 'self-host-docker-entrypoint.mjs'),
      'utf8',
    );
    expect(entrypointSource).toContain('assets.wranglerRuntime.path');
    expect(entrypointSource).toContain('assets.proxyWorker.path');
    expect(entrypointSource).toContain('prepareSelfHostWranglerTool');
    expect(entrypointSource).toContain('spawn(wranglerTool.command');
    expect(entrypointSource).toContain('[...wranglerTool.argsPrefix, ...wranglerArgs]');
    expect(entrypointSource).not.toContain("spawn('wrangler', wranglerArgs");
  });
});

// ======================================================================
// 1. Docker build argument construction
// ======================================================================

describe('Docker build argument construction', () => {
  it('forwards arbitrary container environment variables to Wrangler', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf-8');

    expect(dockerfile).toContain('ENV CLOUDFLARE_INCLUDE_PROCESS_ENV=true');
    expect(dockerfile).toContain('ENV EDGEBASE_RUNTIME_MODE=self-hosted');
    expect(dockerfile).toContain('export EDGEBASE_RUNTIME_MODE=self-hosted');
    expect(dockerfile).toContain('rm -f /app/.dev.vars');
    expect(dockerfile).not.toContain('echo "JWT_USER_SECRET=${JWT_USER_SECRET}"');
  });

  it('builds basic docker build command', () => {
    const tag = 'edgebase:latest';
    const args = ['build', '-t', tag];
    args.push('.');

    expect(args).toEqual(['build', '-t', 'edgebase:latest', '.']);
  });

  it('includes --no-cache when cache disabled', () => {
    const tag = 'edgebase:latest';
    const cache = false;
    const args = ['build', '-t', tag];
    if (!cache) {
      args.push('--no-cache');
    }
    args.push('.');

    expect(args).toContain('--no-cache');
  });

  it('excludes --no-cache when cache enabled', () => {
    const tag = 'edgebase:latest';
    const cache = true;
    const args = ['build', '-t', tag];
    if (!cache) {
      args.push('--no-cache');
    }
    args.push('.');

    expect(args).not.toContain('--no-cache');
  });

  it('uses custom tag', () => {
    const tag = 'myorg/edgebase:v1.0';
    const args = ['build', '-t', tag, '.'];
    expect(args[2]).toBe('myorg/edgebase:v1.0');
  });

  it('exposes context-only preparation on the docker build command', () => {
    const buildCommand = dockerCommand.commands.find((command) => command.name() === 'build');

    expect(buildCommand?.options.some((option) => option.long === '--context-only')).toBe(true);
  });

  it('prepares a portable build context without invoking a Docker executable', { timeout: 60_000 }, () => {
    mkdirSync(join(tmpDir, 'functions'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'edgebase.config.ts'),
      'export default { databases: { shared: { tables: {} } } };\n',
    );
    writeFileSync(
      join(tmpDir, 'functions', 'health.ts'),
      "export async function GET() { return new Response('ok'); }\n",
    );
    writeFileSync(
      join(tmpDir, 'Dockerfile'),
      'FROM node:22\nCOPY .edgebase/targets/docker-app/ /app/\nCMD ["node", "/app/.edgebase/self-host/self-host-docker-entrypoint.mjs"]\n',
    );

    const fakeBinDir = join(tmpDir, 'fake-bin');
    const dockerMarker = join(tmpDir, 'docker-was-invoked');
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(
      join(fakeBinDir, 'docker'),
      '#!/bin/sh\ntouch "$DOCKER_CALLED_MARKER"\nexit 97\n',
    );
    chmodSync(join(fakeBinDir, 'docker'), 0o755);

    const result = spawnSync(
      tsxCommand.command,
      [
        ...tsxCommand.argsPrefix,
        resolve(cliPackageDir, 'src', 'index.ts'),
        '--json',
        'docker',
        'build',
        '--context-only',
        '--tag',
        'example/edgebase:test',
      ],
      {
        cwd: tmpDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
          DOCKER_CALLED_MARKER: dockerMarker,
          NO_COLOR: '1',
        },
        stdio: 'pipe',
        ...tsxExecOptions,
      },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      operation: string;
      tag: string;
      projectDir: string;
      bundleDir: string;
      contextDir: string;
    };
    expect(payload).toMatchObject({
      operation: 'build-context',
      tag: 'example/edgebase:test',
    });
    expect(dirname(payload.contextDir)).toBe(join(
      payload.projectDir,
      '.edgebase',
      'targets',
      '.docker-context-state',
      'generations',
    ));
    expect(realpathSync(join(
      payload.projectDir,
      '.edgebase',
      'targets',
      '.docker-context-state',
      'export',
    ))).toBe(realpathSync(payload.contextDir));
    expect(existsSync(dockerMarker)).toBe(false);
    expect(existsSync(join(payload.contextDir, 'Dockerfile'))).toBe(true);
    expect(existsSync(join(
      payload.contextDir,
      '.edgebase',
      'targets',
      'docker-app',
      'edgebase-app.json',
    ))).toBe(true);
    const bundledAppRoot = join(
      payload.contextDir,
      '.edgebase',
      'targets',
      'docker-app',
    );
    const runtimeDependencyPath = join(
      bundledAppRoot,
      '.edgebase',
      'runtime',
      'server',
      'node_modules',
      'hono',
    );
    const dependencyStat = lstatSync(runtimeDependencyPath);
    if (dependencyStat.isSymbolicLink()) {
      expect(isAbsolute(readlinkSync(runtimeDependencyPath))).toBe(false);
    }
    expect(existsSync(runtimeDependencyPath)).toBe(true);
    const dependencyRelativePath = relative(
      realpathSync(bundledAppRoot),
      realpathSync(runtimeDependencyPath),
    );
    expect(dependencyRelativePath).not.toBe('..');
    expect(dependencyRelativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)).toBe(false);
    expect(JSON.parse(readFileSync(join(runtimeDependencyPath, 'package.json'), 'utf-8'))).toMatchObject({
      name: 'hono',
    });
    const appManifest = JSON.parse(readFileSync(join(
      payload.contextDir,
      '.edgebase',
      'targets',
      'docker-app',
      'edgebase-app.json',
    ), 'utf-8')) as { schedules: { digest: string; crons: string[] } };
    expect(appManifest.schedules.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(appManifest.schedules.crons).toContain('0 3 * * *');
    const retainedBundleDir = join(
      payload.contextDir,
      '.edgebase',
      'targets',
      'docker-app',
    );
    expect.soft(payload.bundleDir).toBe(retainedBundleDir);
    expect.soft(existsSync(payload.bundleDir)).toBe(true);
    expect(existsSync(retainedBundleDir)).toBe(true);
    expect(stateEntries(payload.projectDir, 'bundleWorkDir')).toEqual([]);
  });

  it('uses an exact lease-owned bundle generation and finalizes only inside staging', async () => {
    writeDockerProjectFixture(tmpDir);
    mkdirSync(join(tmpDir, 'node_modules'), { recursive: true });
    writeFileSync(join(tmpDir, 'node_modules', 'ignored.txt'), 'ignore me\n');
    mkdirSync(join(tmpDir, 'docker-context', 'scripts'), { recursive: true });
    writeFileSync(join(tmpDir, 'docker-context', 'entrypoint.mjs'), 'export {};\n');
    writeFileSync(join(tmpDir, 'docker-context', 'scripts', 'healthcheck.sh'), '#!/bin/sh\nexit 0\n');
    writeFileSync(join(tmpDir, 'docker-context', 'Dockerfile'), 'FROM malicious\n');
    const observation: SyntheticBundleObservation = { finalizerCalls: [] };
    const finalizerCalls: string[] = [];
    let contextDir = '';
    let retainedBundleDir = '';
    let sourceBundleDir = '';

    const returned = await _internals.withDockerBuildContext(
      tmpDir,
      {
        publication: 'current',
        bundleCreator: syntheticBundleCreator('exact', observation),
        bundleFinalizer(projectDir, stagingDir) {
          expect(projectDir).toBe(tmpDir);
          expect(basename(stagingDir)).toBe('.app.sync-test');
          finalizerCalls.push(stagingDir);
        },
      },
      (context) => {
        contextDir = context.contextDir;
        retainedBundleDir = context.bundleDir;
        sourceBundleDir = realpathSync(observation.outputDir as string);
        const workDir = dirname(dirname(sourceBundleDir));
        expect(basename(observation.outputDir as string)).toBe('app');
        expect(realpathSync(dirname(observation.outputDir as string))).toBe(workDir);
        expect(observation.overwrite).toBe(false);
        expect(observation.portableDependencies).toBe(true);
        expect(observation.dependencyProfile).toBe('docker');
        expect(lstatSync(observation.outputDir as string).isSymbolicLink()).toBe(true);
        expect(dirname(sourceBundleDir)).toBe(join(workDir, '.app.generations'));
        expect(readFileSync(join(sourceBundleDir, 'marker.txt'), 'utf-8')).toBe('exact\n');
        expect(dirname(context.contextDir)).toBe(
          createDockerContextGenerationManager(tmpDir).paths.generationsDir,
        );
        expect(realpathSync(
          createDockerContextGenerationManager(tmpDir).paths.currentPath,
        )).toBe(realpathSync(context.contextDir));
        expect(readFileSync(join(context.contextDir, 'Dockerfile'), 'utf-8')).not.toContain('malicious');
        expect(readFileSync(join(context.contextDir, '.dockerignore'), 'utf-8'))
          .toContain('!.edgebase/targets/docker-app/**');
        expect(readFileSync(join(context.contextDir, 'entrypoint.mjs'), 'utf-8')).toBe('export {};\n');
        expect(readFileSync(join(context.contextDir, 'scripts', 'healthcheck.sh'), 'utf-8'))
          .toContain('exit 0');
        expect(existsSync(join(context.contextDir, 'node_modules'))).toBe(false);
        expect(readFileSync(
          join(retainedBundleDir, 'marker.txt'),
          'utf-8',
        )).toBe('exact\n');
        return 'callback-result';
      },
    );

    expect(returned).toBe('callback-result');
    expect(observation.finalizerCalls).toEqual(finalizerCalls);
    expect(finalizerCalls).toHaveLength(1);
    expect(existsSync(sourceBundleDir)).toBe(false);
    expect(existsSync(retainedBundleDir)).toBe(true);
    expect(existsSync(contextDir)).toBe(true);
    expect(stateEntries(tmpDir, 'bundleWorkDir')).toEqual([]);
  });

  it('runs concurrent A/B generations independently and keeps A readable through B', async () => {
    writeDockerProjectFixture(tmpDir);
    let releaseA!: () => void;
    const holdA = new Promise<void>((resolvePromise) => { releaseA = resolvePromise; });
    let enteredA!: () => void;
    const startedA = new Promise<void>((resolvePromise) => { enteredA = resolvePromise; });
    let contextA = '';
    let bundleA = '';

    const first = _internals.withDockerBuildContext(
      tmpDir,
      {
        publication: 'current',
        bundleCreator: syntheticBundleCreator('A'),
        bundleFinalizer() {},
      },
      async (context) => {
        contextA = context.contextDir;
        bundleA = context.bundleDir;
        enteredA();
        await holdA;
        expect(readFileSync(
          join(context.contextDir, '.edgebase', 'targets', 'docker-app', 'marker.txt'),
          'utf-8',
        )).toBe('A\n');
      },
    );
    await startedA;

    let contextB = '';
    await _internals.withDockerBuildContext(
      tmpDir,
      {
        publication: 'current',
        bundleCreator: syntheticBundleCreator('B'),
        bundleFinalizer() {},
      },
      (context) => {
        contextB = context.contextDir;
        expect(context.contextDir).not.toBe(contextA);
        expect(context.bundleDir).not.toBe(bundleA);
        expect(existsSync(contextA)).toBe(true);
        expect(existsSync(bundleA)).toBe(true);
        expect(readFileSync(
          join(contextA, '.edgebase', 'targets', 'docker-app', 'marker.txt'),
          'utf-8',
        )).toBe('A\n');
        expect(realpathSync(
          createDockerContextGenerationManager(tmpDir).paths.currentPath,
        )).toBe(realpathSync(context.contextDir));
      },
    );

    expect(existsSync(contextA)).toBe(true);
    expect(existsSync(bundleA)).toBe(true);
    releaseA();
    await first;
    expect(existsSync(contextA)).toBe(false);
    expect(existsSync(bundleA)).toBe(false);
    expect(existsSync(contextB)).toBe(true);
  });

  it('repeats held-reader A/B publication while retaining only the declared current root', async () => {
    writeDockerProjectFixture(tmpDir);

    for (let round = 0; round < 4; round += 1) {
      let releaseReader!: () => void;
      const holdReader = new Promise<void>((resolvePromise) => { releaseReader = resolvePromise; });
      let enteredReader!: () => void;
      const readerStarted = new Promise<void>((resolvePromise) => { enteredReader = resolvePromise; });
      let readerContext = '';
      let currentContext = '';
      const readerMarker = `reader-${round}`;
      const currentMarker = `current-${round}`;

      const reader = _internals.withDockerBuildContext(
        tmpDir,
        {
          publication: 'current',
          bundleCreator: syntheticBundleCreator(readerMarker),
          bundleFinalizer() {},
        },
        async (context) => {
          readerContext = context.contextDir;
          enteredReader();
          await holdReader;
          expect(readFileSync(
            join(context.bundleDir, 'marker.txt'),
            'utf-8',
          )).toBe(`${readerMarker}\n`);
        },
      );
      await readerStarted;

      await _internals.withDockerBuildContext(
        tmpDir,
        {
          publication: 'current',
          bundleCreator: syntheticBundleCreator(currentMarker),
          bundleFinalizer() {},
        },
        (context) => {
          currentContext = context.contextDir;
          expect(readFileSync(
            join(readerContext, '.edgebase', 'targets', 'docker-app', 'marker.txt'),
            'utf-8',
          )).toBe(`${readerMarker}\n`);
          expect(readFileSync(join(context.bundleDir, 'marker.txt'), 'utf-8'))
            .toBe(`${currentMarker}\n`);
          expect(stateEntries(tmpDir, 'generationsDir')).toEqual(
            [basename(readerContext), basename(currentContext)].sort(),
          );
        },
      );

      expect(existsSync(readerContext)).toBe(true);
      expect(existsSync(currentContext)).toBe(true);
      releaseReader();
      await reader;
      expect(existsSync(readerContext)).toBe(false);
      expect(existsSync(currentContext)).toBe(true);
      expect(stateEntries(tmpDir, 'generationsDir')).toEqual([basename(currentContext)]);
      const manager = createDockerContextGenerationManager(tmpDir);
      const leaseEntries = stateEntries(tmpDir, 'leasesDir');
      expect(leaseEntries).toHaveLength(1);
      expect(JSON.parse(readFileSync(join(manager.paths.leasesDir, leaseEntries[0]), 'utf-8')))
        .toMatchObject({
          state: 'released',
          generationId: basename(currentContext),
        });
      expect(stateEntries(tmpDir, 'bundleWorkDir')).toEqual([]);
    }
  });

  it('keeps A bound to its bundle when B publishes before A creates its context', async () => {
    writeDockerProjectFixture(tmpDir);
    const observationA: SyntheticBundleObservation = { finalizerCalls: [] };
    const observationB: SyntheticBundleObservation = { finalizerCalls: [] };
    let releaseB!: () => void;
    const holdB = new Promise<void>((resolvePromise) => { releaseB = resolvePromise; });
    let second: Promise<void> | undefined;
    let contextB = '';

    const bundleCreatorA: BundleCreator = (projectDir, options) => {
      const bundleA = syntheticBundleCreator('A', observationA)(projectDir, options);
      second = _internals.withDockerBuildContext(
        tmpDir,
        {
          publication: 'current',
          bundleCreator: syntheticBundleCreator('B', observationB),
          bundleFinalizer() {},
        },
        async (context) => {
          contextB = context.contextDir;
          expect(readFileSync(
            join(context.contextDir, '.edgebase', 'targets', 'docker-app', 'marker.txt'),
            'utf-8',
          )).toBe('B\n');
          await holdB;
        },
      );
      return bundleA;
    };

    let contextA = '';
    await _internals.withDockerBuildContext(
      tmpDir,
      {
        publication: 'current',
        bundleCreator: bundleCreatorA,
        bundleFinalizer() {},
      },
      (context) => {
        contextA = context.contextDir;
        expect(contextB).not.toBe('');
        expect(context.contextDir).not.toBe(contextB);
        expect(observationA.outputDir).not.toBe(observationB.outputDir);
        expect(readFileSync(
          join(context.contextDir, '.edgebase', 'targets', 'docker-app', 'marker.txt'),
          'utf-8',
        )).toBe('A\n');
        expect(readFileSync(
          join(contextB, '.edgebase', 'targets', 'docker-app', 'marker.txt'),
          'utf-8',
        )).toBe('B\n');
      },
    );

    expect(second).toBeDefined();
    expect(existsSync(contextA)).toBe(true);
    expect(existsSync(contextB)).toBe(true);
    releaseB();
    await second;
    expect(existsSync(contextA)).toBe(true);
    expect(existsSync(contextB)).toBe(false);
  });

  it('keeps the lease through Docker child close, not merely exit', async () => {
    writeDockerProjectFixture(tmpDir);
    const child = new FakeDockerChild();
    let entered!: () => void;
    const started = new Promise<void>((resolvePromise) => { entered = resolvePromise; });
    const observation: SyntheticBundleObservation = { finalizerCalls: [] };
    let retainedBundleDir = '';
    let sourceBundleDir = '';
    let contextDir = '';
    let settled = false;
    const build = _internals.withDockerBuildContext(
      tmpDir,
      {
        publication: 'current',
        bundleCreator: syntheticBundleCreator('close', observation),
        bundleFinalizer() {},
      },
      async (context) => {
        retainedBundleDir = context.bundleDir;
        sourceBundleDir = realpathSync(observation.outputDir as string);
        contextDir = context.contextDir;
        entered();
        await _internals.runDockerProcess(['build', '.'], {
          inheritOutput: false,
          spawnProcess: fakeDockerSpawn(child),
          signalTarget: fakeSignalTarget(new EventEmitter()),
        });
      },
    ).then(() => { settled = true; });

    await started;
    child.emit('exit', 0, null);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(existsSync(sourceBundleDir)).toBe(true);
    expect(existsSync(retainedBundleDir)).toBe(true);
    expect(existsSync(contextDir)).toBe(true);
    child.emit('close', 0, null);
    await build;
    expect(existsSync(sourceBundleDir)).toBe(false);
    expect(existsSync(retainedBundleDir)).toBe(true);
    expect(existsSync(contextDir)).toBe(true);
  });

  it('returns the retained in-context bundle path after a fake Docker child closes', async () => {
    writeDockerProjectFixture(tmpDir);
    const child = new FakeDockerChild();
    const observation: SyntheticBundleObservation = { finalizerCalls: [] };
    let entered!: () => void;
    const started = new Promise<void>((resolvePromise) => { entered = resolvePromise; });
    let sourceBundleDir = '';
    const build = _internals.withDockerBuildContext(
      tmpDir,
      {
        publication: 'current',
        bundleCreator: syntheticBundleCreator('reported-normal', observation),
        bundleFinalizer() {},
      },
      async (context) => {
        sourceBundleDir = realpathSync(observation.outputDir as string);
        expect(existsSync(sourceBundleDir)).toBe(true);
        entered();
        await _internals.runDockerProcess(['build', '.'], {
          inheritOutput: false,
          spawnProcess: fakeDockerSpawn(child),
          signalTarget: fakeSignalTarget(new EventEmitter()),
        });
        return context;
      },
    );

    await started;
    child.emit('exit', 0, null);
    await Promise.resolve();
    child.emit('close', 0, null);
    const result = await build;
    const retainedBundleDir = join(
      result.contextDir,
      '.edgebase',
      'targets',
      'docker-app',
    );

    expect.soft(result.bundleDir).toBe(retainedBundleDir);
    expect.soft(result.bundleDir).not.toBe(sourceBundleDir);
    expect(existsSync(sourceBundleDir)).toBe(false);
    expect.soft(existsSync(result.bundleDir)).toBe(true);
    expect(existsSync(retainedBundleDir)).toBe(true);
    expect(existsSync(result.contextDir)).toBe(true);
  });

  it('releases and collects bundle work when the callback rejects', async () => {
    writeDockerProjectFixture(tmpDir);
    const callbackError = new Error('synthetic callback rejection');
    const observation: SyntheticBundleObservation = { finalizerCalls: [] };
    let contextDir = '';
    let retainedBundleDir = '';
    let sourceBundleDir = '';
    const work = _internals.withDockerBuildContext(
      tmpDir,
      {
        publication: 'current',
        bundleCreator: syntheticBundleCreator('reject', observation),
        bundleFinalizer() {},
      },
      (context) => {
        contextDir = context.contextDir;
        retainedBundleDir = context.bundleDir;
        sourceBundleDir = realpathSync(observation.outputDir as string);
        throw callbackError;
      },
    );

    await expect(work).rejects.toBe(callbackError);
    expect(existsSync(sourceBundleDir)).toBe(false);
    expect(existsSync(retainedBundleDir)).toBe(true);
    expect(existsSync(contextDir)).toBe(true);
    expect(stateEntries(tmpDir, 'bundleWorkDir')).toEqual([]);
  });

  it('preserves callback, release, and GC failures in ordered AggregateError evidence', async () => {
    writeDockerProjectFixture(tmpDir);
    const callbackError = new Error('callback failed');
    const releaseError = new Error('release failed');
    const gcError = new Error('gc failed');
    let gcCalls = 0;
    const managerFactory = (projectDir: string): DockerContextGenerationManager => {
      const manager = createDockerContextGenerationManager(projectDir);
      return {
        ...manager,
        markReleased(lease) {
          manager.markReleased(lease);
          throw releaseError;
        },
        collectGarbage() {
          gcCalls += 1;
          if (gcCalls === 2) throw gcError;
          manager.collectGarbage();
        },
      };
    };

    const error = await _internals.withDockerBuildContext(
      tmpDir,
      {
        publication: 'current',
        bundleCreator: syntheticBundleCreator('aggregate'),
        bundleFinalizer() {},
        generationManagerFactory: managerFactory,
      },
      () => { throw callbackError; },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([callbackError, releaseError, gcError]);
    expect(gcCalls).toBe(2);
  });

  it('pins context-only exports independently from a later current generation', async () => {
    writeDockerProjectFixture(tmpDir);
    let exportedContext = '';
    await _internals.withDockerBuildContext(
      tmpDir,
      {
        publication: 'export',
        bundleCreator: syntheticBundleCreator('export'),
        bundleFinalizer() {},
      },
      (context) => { exportedContext = context.contextDir; },
    );
    const paths = createDockerContextGenerationManager(tmpDir).paths;
    expect(realpathSync(paths.exportPath)).toBe(realpathSync(exportedContext));

    let currentContext = '';
    await _internals.withDockerBuildContext(
      tmpDir,
      {
        publication: 'current',
        bundleCreator: syntheticBundleCreator('current'),
        bundleFinalizer() {},
      },
      (context) => { currentContext = context.contextDir; },
    );

    expect(currentContext).not.toBe(exportedContext);
    expect(realpathSync(paths.exportPath)).toBe(realpathSync(exportedContext));
    expect(realpathSync(paths.currentPath)).toBe(realpathSync(currentContext));
    expect(existsSync(exportedContext)).toBe(true);
    expect(existsSync(currentContext)).toBe(true);
  });

  it('recovers a legacy fixed context before creating and publishing a new lease', async () => {
    writeDockerProjectFixture(tmpDir);
    const legacyContext = join(tmpDir, '.edgebase', 'targets', 'docker-context');
    mkdirSync(legacyContext, { recursive: true });
    writeFileSync(join(legacyContext, 'legacy.txt'), 'legacy\n');
    let sawRecoveredLegacy = false;

    await _internals.withDockerBuildContext(
      tmpDir,
      {
        publication: 'current',
        bundleCreator: syntheticBundleCreator('after-legacy'),
        bundleFinalizer() {},
      },
      (context) => {
        const paths = createDockerContextGenerationManager(tmpDir).paths;
        sawRecoveredLegacy = existsSync(join(paths.legacyRecoveryPath, 'legacy.txt'));
        expect(realpathSync(paths.currentPath)).toBe(realpathSync(context.contextDir));
      },
    );

    expect(sawRecoveredLegacy).toBe(true);
    expect(lstatSync(legacyContext).isSymbolicLink()).toBe(true);
  });

  it('replaces a nested-metadata legacy context with two clean sequential generations', async () => {
    writeDockerProjectFixture(tmpDir);
    const legacyContext = join(tmpDir, '.edgebase', 'targets', 'docker-context');
    const metadataPaths = [
      '.DS_Store',
      join('.edgebase', '.DS_Store'),
      join('.edgebase', 'runtime', '.DS_Store'),
      join('.edgebase', 'runtime', 'server', '.DS_Store'),
      join('.edgebase', 'targets', '.DS_Store'),
      join('.edgebase', 'targets', 'docker-app', '.DS_Store'),
    ];
    for (const relativePath of metadataPaths) {
      mkdirSync(dirname(join(legacyContext, relativePath)), { recursive: true });
      writeFileSync(join(legacyContext, relativePath), 'legacy metadata\n');
    }

    const contexts: string[] = [];
    for (const marker of ['first', 'second']) {
      await _internals.withDockerBuildContext(
        tmpDir,
        {
          publication: 'current',
          bundleCreator: syntheticBundleCreator(marker),
          bundleFinalizer() {},
        },
        (context) => {
          contexts.push(context.contextDir);
          expect(readFileSync(join(context.bundleDir, 'marker.txt'), 'utf-8'))
            .toBe(`${marker}\n`);
          if (marker === 'first') {
            const manager = createDockerContextGenerationManager(tmpDir);
            for (const relativePath of metadataPaths) {
              expect(readFileSync(
                join(manager.paths.legacyRecoveryPath, relativePath),
                'utf-8',
              )).toBe('legacy metadata\n');
            }
          }
        },
      );
    }

    const manager = createDockerContextGenerationManager(tmpDir);
    expect(contexts).toHaveLength(2);
    expect(contexts[0]).not.toBe(contexts[1]);
    expect(existsSync(contexts[0] as string)).toBe(false);
    expect(existsSync(contexts[1] as string)).toBe(true);
    expect(realpathSync(manager.paths.currentPath)).toBe(realpathSync(contexts[1] as string));
    expect(readdirSync(manager.paths.stagingDir)).toEqual([]);
    expect(readdirSync(manager.paths.bundleWorkDir)).toEqual([]);
  });

  it('rejects bundle results that are not exact generation symlinks', async () => {
    writeDockerProjectFixture(tmpDir);
    const validCreator = syntheticBundleCreator('invalid-pointer');
    const directoryCreator: BundleCreator = (projectDir, options) => {
      const result = validCreator(projectDir, options);
      rmSync(result.outputDir);
      mkdirSync(result.outputDir);
      return result;
    };

    await expect(_internals.withDockerBuildContext(
      tmpDir,
      {
        publication: 'current',
        bundleCreator: directoryCreator,
        bundleFinalizer() {},
      },
      () => undefined,
    )).rejects.toThrow('must be an immutable generation symlink');
    expect(stateEntries(tmpDir, 'bundleWorkDir')).toEqual([]);
  });

  it('rejects an exact-generation manifest that disagrees with the returned bundle', async () => {
    writeDockerProjectFixture(tmpDir);
    const validCreator = syntheticBundleCreator('manifest-mismatch');
    const mismatchCreator: BundleCreator = (projectDir, options) => {
      const result = validCreator(projectDir, options);
      const exactBundleDir = realpathSync(result.outputDir);
      const manifest = JSON.parse(readFileSync(join(exactBundleDir, 'edgebase-app.json'), 'utf-8')) as {
        generation: string;
      };
      manifest.generation = `sha256:${'f'.repeat(64)}`;
      writeFileSync(join(exactBundleDir, 'edgebase-app.json'), `${JSON.stringify(manifest)}\n`);
      return result;
    };

    await expect(_internals.withDockerBuildContext(
      tmpDir,
      {
        publication: 'current',
        bundleCreator: mismatchCreator,
        bundleFinalizer() {},
      },
      () => undefined,
    )).rejects.toThrow('does not match the returned bundle');
    expect(stateEntries(tmpDir, 'bundleWorkDir')).toEqual([]);
  });

  it('adds managed D1 bindings only through the high-level staged bundle path', async () => {
    writeDockerProjectFixture(tmpDir);
    writeFileSync(join(tmpDir, 'edgebase.config.ts'), 'export default { databases: { app: { tables: {} } } };\n');
    const sourceWrangler = [
      'name = "docker-worker"',
      'main = ".edgebase/runtime/server/src/index.ts"',
      'compatibility_date = "2025-02-10"',
      '',
      '[[d1_databases]]',
      'binding = "AUTH_DB"',
      'database_name = "docker-worker-auth"',
      'database_id = "local"',
    ].join('\n');
    const observation: SyntheticBundleObservation = {
      finalizerCalls: [],
      prepareStaging(stagingDir) {
        writeFileSync(join(stagingDir, 'wrangler.toml'), sourceWrangler);
      },
    };
    let retainedBundleDir = '';

    await _internals.withDockerBuildContext(
      tmpDir,
      {
        publication: 'current',
        bundleCreator: syntheticBundleCreator('staged-wrangler', observation),
      },
      (context) => {
        retainedBundleDir = join(
          context.contextDir,
          '.edgebase',
          'targets',
          'docker-app',
        );
      },
    );

    expect(observation.finalizerCalls).toHaveLength(1);
    expect(existsSync(retainedBundleDir)).toBe(true);
    const wranglerToml = readFileSync(join(retainedBundleDir, 'wrangler.toml'), 'utf-8');
    expect(wranglerToml).toContain('binding = "AUTH_DB"');
    expect(wranglerToml).toContain('binding = "CONTROL_DB"');
    expect(wranglerToml).toContain('binding = "DB_D1_APP"');
    for (const [binding, className] of [
      ['DATABASE', 'DatabaseDO'],
      ['AUTH', 'AuthDO'],
      ['DATABASE_LIVE', 'DatabaseLiveDO'],
      ['ROOMS', 'RoomsDO'],
      ['LOGS', 'LogsDO'],
    ]) {
      expect.soft(wranglerToml).toContain(`name = "${binding}"`);
      expect.soft(wranglerToml).toContain(`class_name = "${className}"`);
    }
    expect.soft(wranglerToml).toContain('binding = "KV"');
    expect.soft(wranglerToml).toContain('binding = "STORAGE"');
    expect(wranglerToml).toContain(
      `database_name = "${buildManagedD1DatabaseName('docker-worker', 'db-app')}"`,
    );
    expect(wranglerToml).toContain('EDGEBASE_RUNTIME_MODE = "self-hosted"');
    expect(wranglerToml).toContain(
      'compatibility_flags = ["nodejs_compat", "nodejs_compat_populate_process_env"]',
    );
  });

  it('keeps the high-level Docker lifetime API without exporting its low-level finalizer', () => {
    expect(typeof _internals.withDockerBuildContext).toBe('function');
    expect(Object.prototype.hasOwnProperty.call(_internals, 'finalizeDockerWrangler')).toBe(false);
  });

  it('detects a responsive docker daemon via docker info', () => {
    const result = _internals.isDockerDaemonResponsive(() => Buffer.from('"27.0.0"\n'));
    expect(result).toBe(true);
  });

  it('treats docker daemon probe failures as unavailable', () => {
    const result = _internals.isDockerDaemonResponsive(() => {
      throw new Error('daemon not responding');
    });
    expect(result).toBe(false);
  });

  it('accepts only final-stage JSON execution that consumes the protected bundle entrypoint', () => {
    expect(() => _internals.assertProtectedDockerfile(readFileSync(dockerfilePath, 'utf-8')))
      .not.toThrow();
    expect(() => _internals.assertProtectedDockerfile([
      'FROM node:22 AS build',
      'COPY .edgebase/targets/docker-app/ /app/',
      'CMD ["wrangler", "dev"]',
      'FROM node:22',
      'COPY --from=build /app /app',
      'ENTRYPOINT ["node", "/app/.edgebase/self-host/self-host-docker-entrypoint.mjs"]',
    ].join('\n'))).not.toThrow();
  });

  it.each([
    [
      'missing command',
      'FROM node:22\nCOPY .edgebase/targets/docker-app/ /app/\n',
    ],
    [
      'raw Wrangler command',
      'FROM node:22\nCOPY .edgebase/targets/docker-app/ /app/\nCMD ["wrangler", "dev"]\n',
    ],
    [
      'shell form',
      'FROM node:22\nCOPY .edgebase/targets/docker-app/ /app/\nCMD /usr/local/bin/edgebase-entrypoint.sh\n',
    ],
    [
      'shadowed command',
      'FROM node:22\nCOPY .edgebase/targets/docker-app/ /app/\nCMD ["/usr/local/bin/edgebase-entrypoint.sh"]\nCMD ["node", "other.mjs"]\n',
    ],
    [
      'unprotected final stage',
      'FROM node:22 AS protected\nCOPY .edgebase/targets/docker-app/ /app/\nCMD ["/usr/local/bin/edgebase-entrypoint.sh"]\nFROM node:22\nCMD ["node", "other.mjs"]\n',
    ],
    [
      'bundle not consumed',
      'FROM node:22\nCMD ["/usr/local/bin/edgebase-entrypoint.sh"]\n',
    ],
  ])('rejects %s Dockerfiles', (_label, dockerfile) => {
    expect(() => _internals.assertProtectedDockerfile(dockerfile)).toThrow();
  });

  it('validates the effective built image execution vector independently of Dockerfile text', () => {
    expect(_internals.consumesProtectedEntrypoint({
      Entrypoint: null,
      Cmd: ['/usr/local/bin/edgebase-entrypoint.sh'],
    })).toBe(true);
    expect(_internals.consumesProtectedEntrypoint({
      Entrypoint: ['node', '/app/.edgebase/self-host/self-host-docker-entrypoint.mjs'],
      Cmd: [],
    })).toBe(true);
    expect(_internals.consumesProtectedEntrypoint({
      Entrypoint: ['/bin/sh', '-c'],
      Cmd: ['/usr/local/bin/edgebase-entrypoint.sh'],
    })).toBe(false);
    expect(_internals.consumesProtectedEntrypoint({
      Entrypoint: null,
      Cmd: ['wrangler', 'dev'],
    })).toBe(false);
  });
});

// ======================================================================
// 2. Docker run argument construction
// ======================================================================

describe('Docker run argument construction', () => {
  it('allows slow NAS and emulated runtimes to complete bounded first startup', () => {
    expect(_internals.DOCKER_RUNTIME_HEALTH_TIMEOUT_MS).toBe(90_000);
    expect(_internals.DOCKER_RUNTIME_HEALTH_PROBE_TIMEOUT_MS).toBe(20_000);
  });

  it('builds basic docker run command', () => {
    const options = { tag: 'edgebase:latest', port: '8787', volume: 'edgebase-data', detach: false, name: 'edgebase' };
    const args = [
      'run',
      '--name', options.name,
      '-p', `${options.port}:8787`,
      '-v', `${options.volume}:/data`,
      '--restart', 'unless-stopped',
    ];
    args.push(options.tag);

    expect(args).toContain('--name');
    expect(args).toContain('edgebase');
    expect(args).toContain('-p');
    expect(args).toContain('8787:8787');
    expect(args).toContain('-v');
    expect(args).toContain('edgebase-data:/data');
    expect(args).toContain('--restart');
    expect(args).toContain('unless-stopped');
    expect(args[args.length - 1]).toBe('edgebase:latest');
  });

  it('includes --env-file when provided', () => {
    const args = [
      'run',
      '--name', 'edgebase',
      '-p', '8787:8787',
      '-v', 'edgebase-data:/data',
      '--restart', 'unless-stopped',
    ];

    const envFile = '.env';
    if (envFile) {
      args.push('--env-file', envFile);
    }

    expect(args).toContain('--env-file');
    expect(args).toContain('.env');
  });

  it('excludes --env-file when not provided', () => {
    const args = [
      'run',
      '--name', 'edgebase',
      '-p', '8787:8787',
      '-v', 'edgebase-data:/data',
      '--restart', 'unless-stopped',
    ];

    const envFile: string | undefined = undefined;
    if (envFile) {
      args.push('--env-file', envFile);
    }

    expect(args).not.toContain('--env-file');
  });

  it('includes -d flag when detach is true', () => {
    const args: string[] = ['run'];
    const detach = true;
    if (detach) {
      args.push('-d');
    }

    expect(args).toContain('-d');
  });

  it('custom port mapping', () => {
    const port = '3000';
    const portMapping = `${port}:8787`;
    expect(portMapping).toBe('3000:8787');
  });

  it('custom volume name', () => {
    const volume = 'my-custom-data';
    const volumeMapping = `${volume}:/data`;
    expect(volumeMapping).toBe('my-custom-data:/data');
  });
});

// ======================================================================
// 3. Dockerfile detection
// ======================================================================

describe('Dockerfile detection', () => {
  it('detects Dockerfile in project directory', () => {
    writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:22');
    expect(existsSync(join(tmpDir, 'Dockerfile'))).toBe(true);
  });

  it('detects missing Dockerfile', () => {
    expect(existsSync(join(tmpDir, 'Dockerfile'))).toBe(false);
  });

  it('bootstraps writable persistence before dropping to the edgebase user', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf-8');
    const runtimeEntrypoint = readFileSync(
      join(cliPackageDir, 'src', 'templates', 'self-host', 'self-host-docker-entrypoint.mjs'),
      'utf-8',
    );

    expect(dockerfile).toContain('edgebase-entrypoint.sh');
    expect(dockerfile).toContain('chown -R edgebase:edgebase "${PERSIST_DIR}" /home/edgebase/.config');
    expect(dockerfile).toContain('exec su -s /bin/sh edgebase -c');
    expect(dockerfile).toContain('exec node /app/.edgebase/self-host/self-host-docker-entrypoint.mjs');
    expect(dockerfile).not.toContain('exec wrangler dev --config "$WRANGLER_CONFIG"');
    expect(dockerfile).toContain('> /usr/local/bin/edgebase-entrypoint.sh && chmod +x');
    expect(dockerfile).toContain('/__edgebase/health');
    expect(dockerfile).toContain('USER root');
    expect(runtimeEntrypoint).toContain("'--ip', '127.0.0.1'");
    expect(runtimeEntrypoint).toContain('x-edgebase-self-host-control');
    expect(runtimeEntrypoint).toContain('EDGEBASE_SELF_HOST_GATEWAY_SECRET');
    expect(runtimeEntrypoint).toContain('EDGEBASE_SELF_HOST_APP_GENERATION');
    expect(runtimeEntrypoint).toContain('workerTrustSecret: gatewaySecret');
    expect(runtimeEntrypoint).toContain('healthProvider: () => supervisor?.getStatus()');
    expect(runtimeEntrypoint).toContain('createFilesystemCapacityAdmissionController');
    expect(runtimeEntrypoint).toContain('path: persistDir');
    expect(runtimeEntrypoint).toContain('storageAdmissionController: filesystemAdmissionController');
    expect.soft(runtimeEntrypoint).toContain('maxConnections: process.env.EDGEBASE_GATEWAY_MAX_CONNECTIONS');
    expect.soft(runtimeEntrypoint).toContain('maxRequestBodyBytes: process.env.EDGEBASE_GATEWAY_MAX_REQUEST_BODY_BYTES');
    expect.soft(runtimeEntrypoint).toContain('headersTimeoutMs: process.env.EDGEBASE_GATEWAY_HEADERS_TIMEOUT_MS');
    expect.soft(runtimeEntrypoint).toContain('requestTimeoutMs: process.env.EDGEBASE_GATEWAY_REQUEST_TIMEOUT_MS');
    expect.soft(runtimeEntrypoint).toContain('idleTimeoutMs: process.env.EDGEBASE_GATEWAY_IDLE_TIMEOUT_MS');
    expect.soft(runtimeEntrypoint).toContain('upstreamTimeoutMs: process.env.EDGEBASE_GATEWAY_UPSTREAM_TIMEOUT_MS');
    expect.soft(runtimeEntrypoint).toContain('onEvent: reportGatewayEvent');
    expect.soft(runtimeEntrypoint).toContain("console.error('[EdgeBase] gateway '");
    expect(runtimeEntrypoint).toContain('createSelfHostScheduleOutcomeLogger');
    expect(runtimeEntrypoint).not.toContain('for (const outcome of report.outcomes)');
    expect(runtimeEntrypoint).not.toContain('for (const outcome of initialReport.outcomes)');
    expect(runtimeEntrypoint).toContain('waitForOwnedProcessGroupExit');
    const ready = runtimeEntrypoint.indexOf('await waitForOwnedRuntime(');
    const state = runtimeEntrypoint.indexOf('supervisorModule.readSelfHostScheduleState(scheduleStatePath)');
    const firstPass = runtimeEntrypoint.indexOf('const initialReport = await raceChild(supervisor.runOnce()');
    const gateway = runtimeEntrypoint.indexOf('gateway = await raceChild(gatewayModule.startSelfHostGateway');
    expect(ready).toBeGreaterThanOrEqual(0);
    expect(ready).toBeLessThan(state);
    expect(state).toBeLessThan(firstPass);
    expect(firstPass).toBeLessThan(gateway);
  });

  it('detects edgebase.config.ts as a project root marker', () => {
    writeFileSync(join(tmpDir, 'edgebase.config.ts'), 'export default {};');
    expect(existsSync(join(tmpDir, 'edgebase.config.ts'))).toBe(true);
  });
});

// ======================================================================
// 4. findProjectRoot traversal logic
// ======================================================================

describe('findProjectRoot traversal logic', () => {
  it('finds Dockerfile in current directory', () => {
    writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:22');
    expect(_internals.findProjectRoot(tmpDir)).toBe(tmpDir);
  });

  it('finds edgebase.config.ts in current directory', () => {
    writeFileSync(join(tmpDir, 'edgebase.config.ts'), 'export default {};');
    expect(_internals.findProjectRoot(tmpDir)).toBe(tmpDir);
  });

  it('finds Dockerfile in parent directory', () => {
    writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:22');
    const childDir = join(tmpDir, 'src', 'commands');
    mkdirSync(childDir, { recursive: true });

    expect(_internals.findProjectRoot(childDir)).toBe(tmpDir);
  });

  it('skips unrelated package.json files and keeps searching for an EdgeBase root', () => {
    writeFileSync(join(tmpDir, 'edgebase.config.ts'), 'export default {};');
    const childDir = join(tmpDir, 'packages', 'feature');
    mkdirSync(childDir, { recursive: true });
    writeFileSync(join(childDir, 'package.json'), '{"name":"feature"}');

    expect(_internals.findProjectRoot(childDir)).toBe(tmpDir);
  });

  it('accepts edgebase CLI scripts as a fallback root marker', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'npx edgebase dev' } }, null, 2),
    );

    expect(_internals.findProjectRoot(tmpDir)).toBe(tmpDir);
  });

  it('Dockerfile takes precedence over other EdgeBase project markers at same level', () => {
    writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:22');
    writeFileSync(join(tmpDir, 'edgebase.config.ts'), 'export default {};');

    const result = _internals.findProjectRoot(tmpDir);
    expect(result).toBe(tmpDir);
  });
});
