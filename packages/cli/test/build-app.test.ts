import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { constants as osConstants, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppBundle, syncAppBundle, syncAppBundleFunctions } from '../src/lib/app-bundle.js';
import { resolveTsxCommand } from '../src/lib/node-tools.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testRequire = createRequire(import.meta.url);
const tsxCommand = resolveTsxCommand();
const tsxExecOptions = /\.cmd$/i.test(tsxCommand.command) ? { shell: true as const } : {};
const tempDirs: string[] = [];
const CLEANUP_RETRY_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 20,
  retryDelay: 250,
} as const;

interface BufferedProcessResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function runBufferedProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio = {},
): Promise<BufferedProcessResult> {
  return new Promise((resolve, reject) => {
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
    child.once('close', (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function createTempProject(name: string): string {
  const dir = join(tmpdir(), `edgebase-build-app-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function cleanupTemporaryDirectory(dir: string): void {
  rmSync(dir, CLEANUP_RETRY_OPTIONS);
}

function runBuildApp(projectDir: string, outputDirName: string) {
  return runBufferedProcess(
    tsxCommand.command,
    [
      ...tsxCommand.argsPrefix,
      resolve(packageDir, 'src', 'index.ts'),
      '--json',
      'build-app',
      '--output',
      outputDirName,
    ],
    {
      cwd: projectDir,
      env: {
        ...process.env,
        NO_COLOR: '1',
      },
      ...tsxExecOptions,
    },
  );
}

async function inspectBundledModules(configPath: string, functionPath: string): Promise<{
  metaTag?: string;
  hasGet: boolean;
  responseText?: string;
}> {
  // Vite's SSR loader only resolves modules inside its configured filesystem
  // roots. App-bundle fixtures intentionally live in the OS temp directory,
  // so probe their generated ESM in a plain Node child process.
  const result = await runBufferedProcess(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      [
        'const [configUrl, functionUrl] = process.argv.slice(1);',
        'const configModule = await import(configUrl);',
        'const functionModule = await import(functionUrl);',
        'const config = configModule.default ?? configModule;',
        'const response = typeof functionModule.GET === "function" ? await functionModule.GET() : null;',
        'console.log(JSON.stringify({',
        '  metaTag: config.metaTag,',
        '  hasGet: typeof functionModule.GET === "function",',
        '  responseText: response ? await response.text() : undefined,',
        '}));',
      ].join('\n'),
      pathToFileURL(configPath).href,
      pathToFileURL(functionPath).href,
    ],
    {},
  );
  if (result.status !== 0) {
    throw new Error(`Native app-bundle probe failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout) as {
    metaTag?: string;
    hasGet: boolean;
    responseText?: string;
  };
}

async function inspectBundledSupervisor(supervisorPath: string): Promise<string> {
  const result = await runBufferedProcess(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      'const module = await import(process.argv[1]); console.log(typeof module.createSelfHostScheduleSupervisor);',
      pathToFileURL(supervisorPath).href,
    ],
  );
  if (result.status !== 0) {
    throw new Error(`Standalone supervisor probe failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

async function validateBundledSelfHostManifest(
  supervisorPath: string,
  manifestPath: string,
): Promise<void> {
  const result = await runBufferedProcess(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      'const module = await import(process.argv[1]); await module.readSelfHostAppManifest(process.argv[2]);',
      pathToFileURL(supervisorPath).href,
      manifestPath,
    ],
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Self-host manifest validation failed.');
  }
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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    cleanupTemporaryDirectory(dir);
  }
}, 120_000);

beforeEach(async () => {
  // Vitest starts an asynchronous task-status RPC immediately before each test.
  // Yield once so a sequence of expensive synchronous bundle copies cannot starve it.
  await new Promise<void>((resolve) => setImmediate(resolve));
});

describe('build-app command', () => {
  it('rejects protected compile selectors while copying the source Wrangler config', () => {
    const projectDir = createTempProject('protected-wrangler-selector');
    writeFileSync(
      join(projectDir, 'edgebase.config.ts'),
      `export default { release: true, databases: { shared: { tables: {} } } };\n`,
    );
    writeFileSync(
      join(projectDir, 'wrangler.toml'),
      'name = "unsafe-worker"\nenv = { production = { define = { "EDGEBASE_LOCAL_DEV_BUILD" = "true" } } }\n',
    );

    expect(() => createAppBundle(projectDir, {
      outputDir: 'unsafe-selector-bundle',
      overwrite: true,
    })).toThrow(/EDGEBASE_LOCAL_DEV_BUILD/i);
  });

  it('refuses to emit a release bundle containing an inline CAPTCHA secret', () => {
    const projectDir = createTempProject('captcha-secret');
    writeFileSync(
      join(projectDir, 'edgebase.config.ts'),
      `export default {
  release: true,
  baseUrl: 'https://api.example.test',
  captcha: {
    siteKey: 'synthetic-site-key',
    secretKey: 'must-not-enter-artifact',
    hostnames: ['api.example.test'],
  },
};\n`,
    );

    expect(() => createAppBundle(projectDir, {
      outputDir: 'unsafe-bundle',
      overwrite: true,
    })).toThrow(/cannot bundle captcha\.secretKey/i);
  });

  it('emits one deterministic managed schedule manifest for filesystem, plugin, extra, and system sources', async () => {
    const projectDir = createTempProject('managed-schedules');
    mkdirSync(join(projectDir, 'functions'), { recursive: true });
    writeFileSync(
      join(projectDir, 'edgebase.config.ts'),
      `import { defineConfig, defineFunction } from '@edge-base/shared';

export default defineConfig({
  databases: { shared: { tables: {} } },
  plugins: [{
    name: 'synthetic-plugin',
    pluginApiVersion: 1,
    config: {},
    functions: {
      cleanup: defineFunction({
        trigger: { type: 'schedule', cron: '0 2 * * *' },
        handler: async () => undefined,
      }),
    },
  }],
  cloudflare: { extraCrons: ['15 * * * *', ' 15  * * * * '] },
});
`,
    );
    writeFileSync(
      join(projectDir, 'functions', 'nightly.ts'),
      `import { defineFunction } from '@edge-base/shared';
export default defineFunction({
  trigger: { type: 'schedule', cron: '0 2 * * *' },
  handler: async () => undefined,
});
export const quarterHour = defineFunction({
  trigger: { type: 'schedule', cron: '15 * * * *' },
  handler: async () => undefined,
});
`,
    );

    const first = createAppBundle(projectDir, { outputDir: 'first', overwrite: true });
    const second = createAppBundle(projectDir, { outputDir: 'second', overwrite: true });
    const onDisk = JSON.parse(readFileSync(first.manifestPath, 'utf-8')) as typeof first.manifest;
    const gatewaySourcePath = join(
      packageDir,
      'src',
      'templates',
      'self-host',
      'self-host-gateway.mjs',
    );
    const firstSelfHostDir = join(first.outputDir, '.edgebase', 'self-host');
    const secondSelfHostDir = join(second.outputDir, '.edgebase', 'self-host');
    const firstGatewayPath = join(firstSelfHostDir, 'self-host-gateway.mjs');
    const firstSupervisorPath = join(firstSelfHostDir, 'self-host-schedule-supervisor.mjs');
    const firstDockerEntrypointPath = join(firstSelfHostDir, 'self-host-docker-entrypoint.mjs');

    expect(onDisk.schedules).toEqual(first.manifest.schedules);
    expect(onDisk.selfHost).toEqual(first.manifest.selfHost);
    expect(readdirSync(firstSelfHostDir).sort()).toEqual([
      'self-host-docker-entrypoint.mjs',
      'self-host-gateway.mjs',
      'self-host-schedule-supervisor.mjs',
    ]);
    for (const asset of [
      onDisk.selfHost.gateway,
      onDisk.selfHost.scheduleSupervisor,
      onDisk.selfHost.dockerEntrypoint,
    ]) {
      const content = readFileSync(join(first.outputDir, asset.path));
      expect(asset.bytes).toBe(content.byteLength);
      expect(asset.digest).toBe(`sha256:${createHash('sha256').update(content).digest('hex')}`);
    }
    expect(readFileSync(firstGatewayPath)).toEqual(readFileSync(gatewaySourcePath));
    expect(readFileSync(firstGatewayPath)).toEqual(
      readFileSync(join(secondSelfHostDir, 'self-host-gateway.mjs')),
    );
    expect(readFileSync(firstSupervisorPath)).toEqual(
      readFileSync(join(secondSelfHostDir, 'self-host-schedule-supervisor.mjs')),
    );
    expect(readFileSync(firstDockerEntrypointPath)).toEqual(
      readFileSync(join(secondSelfHostDir, 'self-host-docker-entrypoint.mjs')),
    );
    await expect(inspectBundledSupervisor(firstSupervisorPath)).resolves.toBe('function');
    await expect(validateBundledSelfHostManifest(
      firstSupervisorPath,
      first.manifestPath,
    )).resolves.toBeUndefined();
    const gatewayBeforeTamper = readFileSync(firstGatewayPath);
    writeFileSync(firstGatewayPath, Buffer.concat([gatewayBeforeTamper, Buffer.from('\n// tamper\n')]));
    await expect(validateBundledSelfHostManifest(
      firstSupervisorPath,
      first.manifestPath,
    )).rejects.toThrow(/byte length|digest/i);
    writeFileSync(firstGatewayPath, gatewayBeforeTamper);
    expect(second.manifest.schedules.digest).toBe(first.manifest.schedules.digest);
    expect(second.manifest.selfHost).toEqual(first.manifest.selfHost);
    expect(first.manifest.schedules.entries.map((entry) => entry.id)).toEqual([
      'app-function:nightly#default',
      'app-function:nightly#quarterHour',
      'extra-cron:15 * * * *',
      'plugin-function:synthetic-plugin/cleanup',
      'system:maintenance',
    ]);
    expect(first.manifest.schedules.crons).toEqual(['0 2 * * *', '0 3 * * *', '15 * * * *']);

    writeFileSync(
      join(projectDir, 'functions', 'future.ts'),
      `import { defineFunction } from '@edge-base/shared';
export default defineFunction({
  trigger: { type: 'schedule', cron: '5 6 * * *' },
  handler: async () => undefined,
});
`,
    );
    writeFileSync(join(firstSelfHostDir, 'stale-asset.mjs'), 'throw new Error("stale");\n');
    const refreshed = syncAppBundle(projectDir, first.outputDir);
    expect(readdirSync(firstSelfHostDir).sort()).toEqual([
      'self-host-docker-entrypoint.mjs',
      'self-host-gateway.mjs',
      'self-host-schedule-supervisor.mjs',
    ]);
    expect(readFileSync(firstGatewayPath)).toEqual(readFileSync(gatewaySourcePath));
    expect(readFileSync(firstSupervisorPath)).toEqual(
      readFileSync(join(secondSelfHostDir, 'self-host-schedule-supervisor.mjs')),
    );
    expect(
      readdirSync(join(first.outputDir, '.edgebase'))
        .filter((entry) => entry.startsWith('.self-host.')),
    ).toEqual([]);
    expect(
      readdirSync(first.outputDir)
        .filter((entry) => entry.startsWith('edgebase-app.json.sync-')
          || entry.startsWith('edgebase-app.json.previous-')),
    ).toEqual([]);
    expect(refreshed.manifest.schedules.entries.map((entry) => entry.id))
      .toContain('app-function:future#default');
    expect(refreshed.manifest.schedules.digest).not.toBe(first.manifest.schedules.digest);
  });

  it.each(['after-self-host-assets', 'after-previous-rename', 'after-generation-rename'] as const)(
    'keeps a coherent generation after a %s publication fault',
    (faultPoint) => {
      const projectDir = createTempProject(`atomic-${faultPoint}`);
      writeFileSync(
        join(projectDir, 'edgebase.config.ts'),
        'export default { databases: { shared: { tables: {} } } };\n',
      );
      const initial = createAppBundle(projectDir, { outputDir: 'live', overwrite: true });
      if (faultPoint === 'after-previous-rename') {
        const currentGeneration = realpathSync(initial.outputDir);
        rmSync(initial.outputDir, { force: true });
        renameSync(currentGeneration, initial.outputDir);
        expect(lstatSync(initial.outputDir).isDirectory()).toBe(true);
      }
      const manifestBefore = readFileSync(initial.manifestPath);
      const assetsBefore = Object.fromEntries(
        Object.entries(initial.manifest.selfHost)
          .filter((entry): entry is [string, { path: string }] => (
            typeof entry[1] === 'object' && entry[1] !== null && 'path' in entry[1]
          ))
          .map(([name, asset]) => [name, readFileSync(join(initial.outputDir, asset.path))]),
      );
      writeFileSync(
        join(projectDir, 'edgebase.config.ts'),
        'export default { databases: { shared: { tables: {} } }, cloudflare: { extraCrons: ["5 6 * * *"] } };\n',
      );

      expect(() => syncAppBundle(projectDir, initial.outputDir, {
        publicationFaultInjector(point) {
          if (point === faultPoint) throw new Error(`synthetic ${faultPoint}`);
        },
      })).toThrow(`synthetic ${faultPoint}`);

      const manifestAfter = readFileSync(initial.manifestPath);
      if (faultPoint === 'after-generation-rename') {
        expect(manifestAfter).not.toEqual(manifestBefore);
        expect(JSON.parse(manifestAfter.toString('utf8'))).toMatchObject({
          schedules: { crons: expect.arrayContaining(['5 6 * * *']) },
        });
      } else {
        expect(manifestAfter).toEqual(manifestBefore);
      }
      for (const [name, content] of Object.entries(assetsBefore)) {
        const asset = initial.manifest.selfHost[name as keyof typeof initial.manifest.selfHost];
        if (typeof asset === 'object' && asset !== null && 'path' in asset) {
          expect(readFileSync(join(initial.outputDir, asset.path))).toEqual(content);
        }
      }
      expect(readdirSync(projectDir).filter((name) => (
        name.startsWith('.live.sync-') || name.startsWith('.live.previous-')
      ))).toEqual([]);
    },
  );

  it.each([
    'after-manifest-write',
    'after-generation-fsync',
    'before-current-pointer-rename',
    'after-generation-rename',
  ] as const)(
    'keeps a complete current generation after a real SIGKILL at %s',
    { timeout: 180_000 },
    async (faultPoint) => {
      if (process.platform === 'win32') return;
      const projectDir = createTempProject(`hard-crash-${faultPoint}`);
      writeFileSync(
        join(projectDir, 'edgebase.config.ts'),
        'export default { databases: { shared: { tables: {} } } };\n',
      );
      const initial = createAppBundle(projectDir, { outputDir: 'live', overwrite: true });
      expect(lstatSync(initial.outputDir).isSymbolicLink()).toBe(true);
      const initialGeneration = initial.manifest.generation;
      writeFileSync(
        join(projectDir, 'edgebase.config.ts'),
        'export default { databases: { shared: { tables: {} } }, cloudflare: { extraCrons: ["5 6 * * *"] } };\n',
      );
      const crashScript = join(projectDir, 'crash-publication.mts');
      const appBundleModule = pathToFileURL(
        resolve(packageDir, 'src', 'lib', 'app-bundle.ts'),
      ).href;
      writeFileSync(crashScript, [
        `import { syncAppBundle } from ${JSON.stringify(appBundleModule)};`,
        'const [projectDir, outputDir, faultPoint] = process.argv.slice(2);',
        'syncAppBundle(projectDir, outputDir, {',
        '  publicationFaultInjector(point) {',
        "    if (point === faultPoint) process.kill(process.pid, 'SIGKILL');",
        '  },',
        '});',
      ].join('\n'));

      const crashed = await runBufferedProcess(
        tsxCommand.command,
        [
          ...tsxCommand.argsPrefix,
          crashScript,
          projectDir,
          initial.outputDir,
          faultPoint,
        ],
        { ...tsxExecOptions },
      );
      const killedBySigkill = (
        (crashed.status === null && crashed.signal === 'SIGKILL')
        || (
          crashed.signal === null
          && crashed.status === 128 + osConstants.signals.SIGKILL
        )
      );
      expect(
        killedBySigkill,
        `hard-crash child status=${String(crashed.status)} signal=${String(crashed.signal)}; `
          + `stderr (first 2048 characters): ${crashed.stderr.slice(0, 2_048)}`,
      ).toBe(true);
      expect(existsSync(initial.outputDir)).toBe(true);
      expect(lstatSync(initial.outputDir).isSymbolicLink()).toBe(true);
      const currentManifest = JSON.parse(readFileSync(initial.manifestPath, 'utf-8')) as {
        generation: string;
        schedules: { crons: string[] };
        selfHost: { scheduleSupervisor: { path: string } };
      };
      if (faultPoint === 'after-generation-rename') {
        expect(currentManifest.schedules.crons).toContain('5 6 * * *');
        expect(currentManifest.generation).not.toBe(initialGeneration);
      } else {
        expect(currentManifest.schedules.crons).not.toContain('5 6 * * *');
        expect(currentManifest.generation).toBe(initialGeneration);
      }
      await expect(validateBundledSelfHostManifest(
        join(initial.outputDir, currentManifest.selfHost.scheduleSupervisor.path),
        initial.manifestPath,
      )).resolves.toBeUndefined();

      const recovered = syncAppBundle(projectDir, initial.outputDir);
      expect(recovered.manifest.schedules.crons).toContain('5 6 * * *');
      expect(
        readdirSync(projectDir).filter((name) => (
          name.startsWith('.live.sync-') || name.startsWith('.live.current-')
        )),
      ).toEqual([]);
      expect(
        readdirSync(join(projectDir, '.live.generations'), { withFileTypes: true })
          .filter((entry) => entry.isDirectory()),
      ).toHaveLength(2);
    },
  );

  it('builds a self-contained app bundle that does not rely on project config or function source files', async () => {
    const projectDir = createTempProject('self-contained');
    mkdirSync(join(projectDir, 'functions'), { recursive: true });
    mkdirSync(join(projectDir, 'config'), { recursive: true });
    mkdirSync(join(projectDir, 'lib'), { recursive: true });

    writeFileSync(
      join(projectDir, 'edgebase.config.ts'),
      `import { defineConfig } from '@edge-base/shared';
import { META_TAG } from './config/meta';

export default defineConfig({
  databases: {
    shared: {
      tables: {},
    },
  },
  metaTag: META_TAG,
});
`,
    );
    writeFileSync(
      join(projectDir, 'edgebase.test.config.ts'),
      `export default {
  metaTag: 'bundle-test',
};
`,
    );
    writeFileSync(
      join(projectDir, 'wrangler.toml'),
      [
        'name = "bundle-worker"',
        'account_id = "acct-123"',
        '',
        '[assets]',
        'directory = ".edgebase/runtime/server/admin-build"',
        'binding = "ASSETS"',
      ].join('\n'),
    );
    writeFileSync(join(projectDir, 'config', 'meta.ts'), `export const META_TAG = 'bundle-ok';\n`);
    writeFileSync(join(projectDir, 'lib', 'message.ts'), `export const MESSAGE = 'hello bundle';\n`);
    writeFileSync(
      join(projectDir, 'functions', 'health.ts'),
      `import { MESSAGE } from '../lib/message';

export async function GET() {
  return new Response(MESSAGE);
}
`,
    );

    const result = await runBuildApp(projectDir, 'app-bundle');

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toBe('');

    const payload = JSON.parse(result.stdout) as {
      status: string;
      outputDir: string;
      manifest: {
        format: string;
        functions: { count: number };
        config: { module: string; testModule?: string };
      };
    };

    expect(payload).toMatchObject({
      status: 'success',
      manifest: {
        format: 'app-bundle',
        functions: { count: 1 },
        config: {
          module: '.edgebase/runtime/server/bundle/config/edgebase.config.bundle.js',
          testModule: '.edgebase/runtime/server/bundle/config/edgebase.test.config.bundle.js',
        },
      },
    });

    const outputDir = join(projectDir, 'app-bundle');
    const generatedConfigShim = readFileSync(
      join(outputDir, '.edgebase', 'runtime', 'server', 'src', 'generated-config.ts'),
      'utf-8',
    );
    const runtimeTestShim = readFileSync(
      join(outputDir, '.edgebase', 'runtime', 'server', 'edgebase.test.config.ts'),
      'utf-8',
    );
    const registry = readFileSync(
      join(outputDir, '.edgebase', 'runtime', 'server', 'src', '_functions-registry.ts'),
      'utf-8',
    );

    expect(generatedConfigShim).toContain("import config from '../bundle/config/edgebase.config.bundle.js'");
    expect(runtimeTestShim).toContain("import config from './bundle/config/edgebase.test.config.bundle.js'");
    expect(registry).toContain("../bundle/functions/health.js");

    rmSync(join(projectDir, 'edgebase.config.ts'), { force: true });
    rmSync(join(projectDir, 'edgebase.test.config.ts'), { force: true });
    rmSync(join(projectDir, 'functions'), { recursive: true, force: true });
    rmSync(join(projectDir, 'config'), { recursive: true, force: true });
    rmSync(join(projectDir, 'lib'), { recursive: true, force: true });

    const bundledConfigPath = join(
      outputDir,
      '.edgebase',
      'runtime',
      'server',
      'bundle',
      'config',
      'edgebase.config.bundle.js',
    );
    const bundledFunctionPath = join(
      outputDir,
      '.edgebase',
      'runtime',
      'server',
      'bundle',
      'functions',
      'health.js',
    );
    expect(existsSync(bundledConfigPath)).toBe(true);
    expect(existsSync(bundledFunctionPath)).toBe(true);

    const moduleProbe = await inspectBundledModules(bundledConfigPath, bundledFunctionPath);
    expect(moduleProbe.metaTag).toBe('bundle-ok');
    expect(moduleProbe.hasGet).toBe(true);
    expect(moduleProbe.responseText).toBe('hello bundle');
    expect(existsSync(join(outputDir, 'edgebase-app.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'wrangler.toml'))).toBe(true);
    expect(readFileSync(join(outputDir, 'wrangler.toml'), 'utf-8')).toContain('name = "bundle-worker"');
    expect(readFileSync(join(outputDir, 'wrangler.toml'), 'utf-8')).toContain('directory = ".edgebase/runtime/server/app-assets"');
    expect(readFileSync(join(outputDir, 'wrangler.toml'), 'utf-8')).not.toContain('directory = ".edgebase/runtime/server/admin-build"');
  });

  it('syncs an existing app bundle in place and removes stale bundled modules', () => {
    const projectDir = createTempProject('sync');
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
  },
});
`,
    );
    writeFileSync(
      join(projectDir, 'edgebase.test.config.ts'),
      `export default {
  env: 'initial-test',
};
`,
    );
    writeFileSync(
      join(projectDir, 'functions', 'one.ts'),
      `export async function GET() {
  return new Response('one');
}
`,
    );
    writeFileSync(join(projectDir, 'web', 'dist', 'index.html'), '<!doctype html><title>v1</title>');

    const bundle = createAppBundle(projectDir, {
      outputDir: 'refreshable-bundle',
      overwrite: true,
      injectedEnv: {
        FEATURE_FLAG: 'one',
      },
    });

    expect(existsSync(join(bundle.outputDir, '.dev.vars'))).toBe(false);
    expect(existsSync(join(bundle.outputDir, '.edgebase', 'runtime', 'server', 'bundle', 'functions', 'one.js'))).toBe(true);
    expect(existsSync(join(bundle.outputDir, '.edgebase', 'runtime', 'server', 'bundle', 'config', 'edgebase.test.config.bundle.js'))).toBe(true);
    expect(readFileSync(join(bundle.outputDir, '.edgebase', 'runtime', 'server', 'app-assets', 'index.html'), 'utf-8')).toContain('v1');
    expect(readFileSync(join(bundle.outputDir, '.edgebase', 'runtime', 'server', 'src', 'generated-config.ts'), 'utf-8')).toContain('"FEATURE_FLAG": "one"');

    rmSync(join(projectDir, 'functions', 'one.ts'), { force: true });
    rmSync(join(projectDir, 'edgebase.test.config.ts'), { force: true });
    writeFileSync(
      join(projectDir, 'functions', 'two.ts'),
      `export async function GET() {
  return new Response('two');
}
`,
    );
    writeFileSync(join(projectDir, 'web', 'dist', 'index.html'), '<!doctype html><title>v2</title>');

    const refreshed = syncAppBundle(projectDir, bundle.outputDir, {
      injectedEnv: {
        FEATURE_FLAG: 'two',
      },
    });

    expect(refreshed.manifest.functions.count).toBe(1);
    expect(existsSync(join(bundle.outputDir, '.edgebase', 'runtime', 'server', 'bundle', 'functions', 'one.js'))).toBe(false);
    expect(existsSync(join(bundle.outputDir, '.edgebase', 'runtime', 'server', 'bundle', 'functions', 'two.js'))).toBe(true);
    expect(existsSync(join(bundle.outputDir, '.edgebase', 'runtime', 'server', 'bundle', 'config', 'edgebase.test.config.bundle.js'))).toBe(false);
    expect(readFileSync(join(bundle.outputDir, '.edgebase', 'runtime', 'server', 'app-assets', 'index.html'), 'utf-8')).toContain('v2');
    expect(readFileSync(join(bundle.outputDir, '.edgebase', 'runtime', 'server', 'src', 'generated-config.ts'), 'utf-8')).toContain('"FEATURE_FLAG": "two"');
    expect(
      readFileSync(join(bundle.outputDir, '.edgebase', 'runtime', 'server', 'edgebase.test.config.ts'), 'utf-8'),
    ).toContain("import config from './src/generated-config.ts'");
  });

  it('keeps the live function bundle and registry intact when a refresh compile fails', () => {
    const projectDir = createTempProject('sync-failure');
    mkdirSync(join(projectDir, 'functions'), { recursive: true });
    writeFileSync(
      join(projectDir, 'edgebase.config.ts'),
      `export default {
  databases: {
    shared: {
      tables: {},
    },
  },
};
`,
    );
    writeFileSync(
      join(projectDir, 'functions', 'health.ts'),
      `export async function GET() {
  return new Response('healthy');
}
`,
    );

    const bundle = createAppBundle(projectDir, {
      outputDir: 'refreshable-bundle',
      overwrite: true,
    });
    const functionPath = join(
      bundle.outputDir,
      '.edgebase',
      'runtime',
      'server',
      'bundle',
      'functions',
      'health.js',
    );
    const registryPath = join(
      bundle.outputDir,
      '.edgebase',
      'runtime',
      'server',
      'src',
      '_functions-registry.ts',
    );
    const previousFunction = readFileSync(functionPath, 'utf-8');
    const previousRegistry = readFileSync(registryPath, 'utf-8');

    writeFileSync(join(projectDir, 'functions', 'health.ts'), 'export async function GET( {');

    expect(() => syncAppBundle(projectDir, bundle.outputDir)).toThrow();
    expect(readFileSync(functionPath, 'utf-8')).toBe(previousFunction);
    expect(readFileSync(registryPath, 'utf-8')).toBe(previousRegistry);
  });

  it('refreshes dev functions without replacing the served frontend assets', () => {
    const projectDir = createTempProject('function-only-sync');
    mkdirSync(join(projectDir, 'functions'), { recursive: true });
    mkdirSync(join(projectDir, 'web', 'dist'), { recursive: true });
    writeFileSync(
      join(projectDir, 'edgebase.config.ts'),
      `export default {
  databases: { shared: { tables: {} } },
  frontend: { directory: './web/dist' },
};
`,
    );
    writeFileSync(join(projectDir, 'functions', 'one.ts'), 'export const GET = () => new Response("one");');
    writeFileSync(join(projectDir, 'web', 'dist', 'index.html'), '<title>served-v1</title>');

    const bundle = createAppBundle(projectDir, {
      outputDir: 'refreshable-bundle',
      overwrite: true,
    });
    const servedIndexPath = join(
      bundle.outputDir,
      '.edgebase',
      'runtime',
      'server',
      'app-assets',
      'index.html',
    );

    rmSync(join(projectDir, 'functions', 'one.ts'), { force: true });
    writeFileSync(join(projectDir, 'functions', 'two.ts'), 'export const GET = () => new Response("two");');
    writeFileSync(join(projectDir, 'web', 'dist', 'index.html'), '<title>unserved-v2</title>');

    const functions = syncAppBundleFunctions(projectDir, bundle.outputDir);

    expect(functions.map((fn) => fn.name)).toEqual(['two']);
    expect(readFileSync(servedIndexPath, 'utf-8')).toContain('served-v1');
    expect(readFileSync(servedIndexPath, 'utf-8')).not.toContain('unserved-v2');
    expect(existsSync(join(bundle.outputDir, '.edgebase', 'runtime', 'server', 'bundle', 'functions', 'one.js'))).toBe(false);
    expect(existsSync(join(bundle.outputDir, '.edgebase', 'runtime', 'server', 'bundle', 'functions', 'two.js'))).toBe(true);
  });

  it('supports slimmer copy profiles for portable and docker runtime dependencies', { timeout: process.platform === 'win32' ? 180_000 : 60_000 }, () => {
    const projectDir = createTempProject('dependency-profiles');
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
    writeFileSync(
      join(projectDir, 'functions', 'health.ts'),
      `export async function GET() {
  return new Response('ok');
}
`,
    );

    const portableBundle = createAppBundle(projectDir, {
      outputDir: 'portable-bundle',
      overwrite: true,
      portableDependencies: true,
      dependencyProfile: 'portable',
    });
    const dockerBundle = createAppBundle(projectDir, {
      outputDir: 'docker-bundle',
      overwrite: true,
      portableDependencies: true,
      dependencyProfile: 'docker',
    });

    const portableNodeModules = join(portableBundle.outputDir, '.edgebase', 'runtime', 'server', 'node_modules');
    const dockerNodeModules = join(dockerBundle.outputDir, '.edgebase', 'runtime', 'server', 'node_modules');
    const expectedPortableMiniflareVersion = resolveExpectedPortableMiniflareVersion();
    const bundledPortableMiniflareEntries = readdirSync(join(portableNodeModules, '.pnpm')).filter((entry) =>
      entry.startsWith('miniflare@'),
    );

    expect(readBundledPackageVersion(portableNodeModules, 'wrangler')).toBe(
      resolveInstalledPackageVersion('wrangler'),
    );
    expect(readBundledPackageVersion(portableNodeModules, 'miniflare')).toBe(expectedPortableMiniflareVersion);
    expect(resolveBundledWranglerMiniflareVersion(portableNodeModules)).toBe(expectedPortableMiniflareVersion);
    expect(bundledPortableMiniflareEntries).toEqual(
      bundledPortableMiniflareEntries.map((entry) => (
        expect.stringMatching(new RegExp(`^miniflare@${escapeRegExp(expectedPortableMiniflareVersion)}`))
      )),
    );
    expect(readBundledPackageVersion(portableNodeModules, 'esbuild')).not.toBeNull();
    expect(readBundledPackageVersion(portableNodeModules, 'unenv')).toBe(
      resolveInstalledPackageVersion('unenv'),
    );
    expect(readBundledPackageVersion(portableNodeModules, 'vitest')).toBeNull();
    expect(hasBundledPnpmPackage(dockerNodeModules, 'wrangler@', ['wrangler'])).toBe(false);
    expect(hasBundledPnpmPackage(dockerNodeModules, 'miniflare@', ['miniflare'])).toBe(false);
    expect(hasBundledPnpmPackage(dockerNodeModules, 'vitest@', ['vitest'])).toBe(false);
    expect(hasBundledPnpmPackage(dockerNodeModules, 'typescript@', ['typescript'])).toBe(false);
    expect(readBundledPackageVersion(dockerNodeModules, 'hono')).toBe(
      resolveInstalledPackageVersion('hono'),
    );
    for (const runtimeNodeModules of [portableNodeModules, dockerNodeModules]) {
      const sharedSourceDir = join(runtimeNodeModules, '@edge-base', 'shared', 'src');
      expect(lstatSync(sharedSourceDir).isDirectory()).toBe(true);
      expect(lstatSync(sharedSourceDir).isSymbolicLink()).toBe(false);
      expect(existsSync(join(sharedSourceDir, 'index.ts'))).toBe(true);
    }
  });

  it('keeps runtime source and dependencies aligned with the CLI server graph', () => {
    const projectDir = createTempProject('conflicting-consumer-server');
    const serverDir = join(projectDir, 'node_modules', '@edge-base', 'server');
    const fixtureDependencyDir = join(projectDir, 'node_modules', 'fixture-runtime-dependency');

    mkdirSync(join(projectDir, 'functions'), { recursive: true });
    mkdirSync(join(serverDir, 'src'), { recursive: true });
    mkdirSync(join(serverDir, 'admin-build'), { recursive: true });
    mkdirSync(fixtureDependencyDir, { recursive: true });

    writeFileSync(
      join(projectDir, 'edgebase.config.ts'),
      'export default { databases: { shared: { tables: {} } } };\n',
    );
    writeFileSync(
      join(projectDir, 'functions', 'health.ts'),
      "export async function GET() { return new Response('ok'); }\n",
    );
    writeFileSync(join(serverDir, 'src', 'index.ts'), 'export const consumerRuntime = true;\n');
    writeFileSync(
      join(serverDir, 'admin-build', 'index.html'),
      '<!doctype html><title>consumer admin</title>\n',
    );
    writeFileSync(
      join(serverDir, 'package.json'),
      JSON.stringify({
        name: '@edge-base/server',
        version: '9.9.9-consumer-fixture',
        dependencies: { 'fixture-runtime-dependency': '1.2.3' },
      }),
    );
    writeFileSync(
      join(fixtureDependencyDir, 'package.json'),
      JSON.stringify({ name: 'fixture-runtime-dependency', version: '1.2.3' }),
    );
    writeFileSync(join(fixtureDependencyDir, 'index.js'), 'export const fixture = true;\n');

    const bundle = createAppBundle(projectDir, {
      outputDir: 'docker-bundle',
      overwrite: true,
      portableDependencies: true,
      dependencyProfile: 'docker',
    });
    const runtimeRoot = join(bundle.outputDir, '.edgebase', 'runtime', 'server');

    expect(
      readBundledPackageVersion(join(runtimeRoot, 'node_modules'), 'fixture-runtime-dependency'),
    ).toBeNull();
    expect(readFileSync(join(runtimeRoot, 'src', 'index.ts'), 'utf-8')).not.toContain('consumerRuntime');
    expect(readFileSync(join(runtimeRoot, 'admin-build', 'index.html'), 'utf-8')).not.toContain('consumer admin');
    expect(readBundledPackageVersion(join(runtimeRoot, 'node_modules'), 'hono')).toBe(
      resolveInstalledPackageVersion('hono'),
    );
  });
});
