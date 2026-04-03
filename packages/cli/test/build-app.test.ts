import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppBundle, syncAppBundle } from '../src/lib/app-bundle.js';
import { resolveTsxCommand } from '../src/lib/node-tools.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsxCommand = resolveTsxCommand();
const tsxExecOptions = /\.cmd$/i.test(tsxCommand.command) ? { shell: true as const } : {};
const tempDirs: string[] = [];

function createTempProject(name: string): string {
  const dir = join(tmpdir(), `edgebase-build-app-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
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

function hasBundledPnpmPackage(runtimeNodeModulesDir: string, entryPrefix: string, packagePath: string[]): boolean {
  const pnpmDir = join(runtimeNodeModulesDir, '.pnpm');
  if (!existsSync(pnpmDir)) return false;

  return readdirSync(pnpmDir).some((entry) => (
    entry.startsWith(entryPrefix)
    && existsSync(join(pnpmDir, entry, 'node_modules', ...packagePath, 'package.json'))
  ));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('build-app command', () => {
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
    writeFileSync(join(projectDir, 'wrangler.toml'), 'name = "bundle-worker"\naccount_id = "acct-123"\n');
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

    const bundledConfigModule = await import(
      pathToFileURL(
        join(outputDir, '.edgebase', 'runtime', 'server', 'bundle', 'config', 'edgebase.config.bundle.js'),
      ).href
    ) as { default?: { metaTag?: string } };
    const bundledFunctionModule = await import(
      pathToFileURL(
        join(outputDir, '.edgebase', 'runtime', 'server', 'bundle', 'functions', 'health.js'),
      ).href
    ) as { GET?: () => Promise<Response> };

    expect((bundledConfigModule.default ?? bundledConfigModule).metaTag).toBe('bundle-ok');
    expect(typeof bundledFunctionModule.GET).toBe('function');

    const response = await bundledFunctionModule.GET?.();
    expect(await response?.text()).toBe('hello bundle');
    expect(existsSync(join(outputDir, 'edgebase-app.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'wrangler.toml'))).toBe(true);
    expect(readFileSync(join(outputDir, 'wrangler.toml'), 'utf-8')).toContain('name = "bundle-worker"');
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

  it('supports slimmer copy profiles for portable and docker runtime dependencies', { timeout: 60_000 }, () => {
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

    expect(hasBundledPnpmPackage(portableNodeModules, 'wrangler@', ['wrangler'])).toBe(true);
    expect(hasBundledPnpmPackage(portableNodeModules, 'esbuild@', ['esbuild'])).toBe(true);
    expect(hasBundledPnpmPackage(portableNodeModules, 'unenv@', ['unenv'])).toBe(true);
    expect(existsSync(join(portableNodeModules, 'unenv', 'package.json'))).toBe(true);
    expect(hasBundledPnpmPackage(portableNodeModules, 'vitest@', ['vitest'])).toBe(false);
    expect(hasBundledPnpmPackage(dockerNodeModules, 'wrangler@', ['wrangler'])).toBe(false);
    expect(hasBundledPnpmPackage(dockerNodeModules, 'vitest@', ['vitest'])).toBe(false);
    expect(hasBundledPnpmPackage(dockerNodeModules, 'hono@', ['hono'])).toBe(true);
  });
});
