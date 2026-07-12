import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppBundle, syncAppBundle } from '../src/lib/app-bundle.js';
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
  return spawnSync(
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

function inspectBundledModules(configPath: string, functionPath: string): {
  metaTag?: string;
  hasGet: boolean;
  responseText?: string;
} {
  // Vite's SSR loader only resolves modules inside its configured filesystem
  // roots. App-bundle fixtures intentionally live in the OS temp directory,
  // so probe their generated ESM in a plain Node child process.
  const result = spawnSync(
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
    { encoding: 'utf-8', stdio: 'pipe' },
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

describe('build-app command', () => {
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

    const result = runBuildApp(projectDir, 'app-bundle');

    expect(result.status).toBe(0);
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

    const moduleProbe = inspectBundledModules(bundledConfigPath, bundledFunctionPath);
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
