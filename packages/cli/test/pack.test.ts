import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveTsxCommand } from '../src/lib/node-tools.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testRequire = createRequire(import.meta.url);
const tsxCommand = resolveTsxCommand();
const tsxExecOptions = /\.cmd$/i.test(tsxCommand.command) ? { shell: true as const } : {};
const tempDirs: string[] = [];
const appDataDirs: string[] = [];

function createTempProject(name: string): string {
  const dir = join(tmpdir(), `edgebase-pack-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
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
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of appDataDirs.splice(0)) {
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

function hasBundledPnpmPackage(runtimeNodeModulesDir: string, entryPrefix: string, packagePath: string[]): boolean {
  const pnpmDir = join(runtimeNodeModulesDir, '.pnpm');
  if (!existsSync(pnpmDir)) return false;

  return readdirSync(pnpmDir).some((entry) => (
    entry.startsWith(entryPrefix)
    && existsSync(join(pnpmDir, entry, 'node_modules', ...packagePath, 'package.json'))
  ));
}

function resolveExpectedPortableMiniflareVersion(): string {
  const wranglerManifest = testRequire.resolve('wrangler/package.json', { paths: [packageDir] });
  const wranglerRequire = createRequire(wranglerManifest);
  const miniflareManifest = wranglerRequire.resolve('miniflare/package.json');
  return JSON.parse(readFileSync(miniflareManifest, 'utf-8')).version as string;
}

describe('pack command', () => {
  it('creates a backend-only directory artifact from a self-contained app bundle', { timeout: 90_000 }, () => {
    const projectDir = createTempProject('backend');
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
    writeFileSync(join(projectDir, '.env.release'), 'SERVICE_KEY=super-secret\n');

    const result = runPack(projectDir, 'packed');

    expect(result.status).toBe(0);
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
      outputDir: realpathSync(join(projectDir, 'packed')),
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
    expect(hasBundledPnpmPackage(runtimeNodeModulesDir, 'hono@', ['hono'])).toBe(true);
    expect(hasBundledPnpmPackage(runtimeNodeModulesDir, '@asteasolutions+zod-to-openapi@', ['@asteasolutions', 'zod-to-openapi'])).toBe(true);
    expect(hasBundledPnpmPackage(runtimeNodeModulesDir, 'pg-protocol@', ['pg-protocol'])).toBe(true);
    expect(hasBundledPnpmPackage(runtimeNodeModulesDir, 'wrangler@', ['wrangler'])).toBe(true);
    expect(
      hasBundledPnpmPackage(
        runtimeNodeModulesDir,
        `miniflare@${expectedPortableMiniflareVersion}`,
        ['miniflare'],
      ),
    ).toBe(true);
    expect(bundledPortableMiniflareEntries).toEqual([
      expect.stringMatching(new RegExp(`^miniflare@${expectedPortableMiniflareVersion.replace(/\./g, '\\.')}`)),
    ]);
    expect(hasBundledPnpmPackage(runtimeNodeModulesDir, 'esbuild@', ['esbuild'])).toBe(true);
    expect(hasBundledPnpmPackage(runtimeNodeModulesDir, 'unenv@', ['unenv'])).toBe(true);
    expect(existsSync(join(runtimeNodeModulesDir, 'unenv', 'package.json'))).toBe(true);
    expect(hasBundledPnpmPackage(runtimeNodeModulesDir, 'vitest@', ['vitest'])).toBe(false);
    expect(existsSync(join(runtimeNodeModulesDir, '@edge-base', 'core', 'package.json'))).toBe(true);
    expect(lstatSync(runtimeNodeModulesDir).isSymbolicLink()).toBe(false);
    expect(existsSync(join(projectDir, 'packed', '.edgebase', 'runtime', 'server', 'app-assets', 'admin', 'index.html'))).toBe(true);
    expect(existsSync(join(projectDir, 'packed', '.edgebase', 'runtime', 'server', 'app-assets', 'index.html'))).toBe(false);
    expect(existsSync(join(projectDir, 'packed', 'wrangler.toml'))).toBe(true);
    expect(readFileSync(join(projectDir, 'packed', 'wrangler.toml'), 'utf-8')).toContain('binding = "DB_D1_SHARED"');
    expect(existsSync(join(projectDir, 'packed', '.env.release'))).toBe(false);

    const dryRun = spawnSync(
      process.execPath,
      [join(projectDir, 'packed', 'launcher.mjs'), '--dry-run', '--json'],
      {
        cwd: join(projectDir, 'packed'),
        encoding: 'utf-8',
        env: {
          ...process.env,
          NO_COLOR: '1',
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
      openUrl: string;
      wranglerBin: string;
      wranglerArgs: string[];
    };

    expect(launchPlan.artifactRoot).toBe(realpathSync(join(projectDir, 'packed')));
    expect(launchPlan.host).toBe('127.0.0.1');
    expect(launchPlan.port).toBe(manifest.launcher.defaultPort);
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
      '--persist-to',
      join(appDataRoot, manifest.launcher.stateDir),
    ]));
    expect(existsSync(join(appDataRoot, manifest.launcher.runtimeDir, '.dev.vars'))).toBe(true);
  });

  it('includes configured frontend assets in the packed runtime scaffold', { timeout: 90_000 }, () => {
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
  },
});
`,
    );
    writeFileSync(join(projectDir, 'functions', 'health.ts'), 'export default async () => new Response("ok");\n');
    writeFileSync(join(projectDir, 'web', 'dist', 'index.html'), '<!doctype html><html><body>frontend</body></html>\n');
    writeFileSync(join(projectDir, 'web', 'dist', 'assets', 'main.12345678.js'), 'console.log("frontend");\n');

    const result = runPack(projectDir, 'artifact');

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const payload = JSON.parse(result.stdout) as {
      status: string;
      manifest: {
        frontend: {
          enabled: boolean;
          mountPath?: string;
          spaFallback?: boolean;
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

    const dryRun = spawnSync(
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

  it('reuses an existing launcher instance when a live lock file is present', { timeout: 90_000 }, () => {
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

    const result = runPack(projectDir, 'packed');

    expect(result.status).toBe(0);
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
        createdAt: new Date().toISOString(),
      }, null, 2) + '\n',
    );

    const dryRun = spawnSync(
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
    };
    expect(launchPlan.port).toBe(49091);
    expect(launchPlan.existingInstance).toBe(true);
    expect(launchPlan.openUrl).toBe('http://127.0.0.1:49091/admin');

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
