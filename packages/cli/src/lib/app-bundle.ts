import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { buildBundleWithEsbuild } from './node-tools.js';
import { loadConfigSafe } from './load-config.js';
import type { FrontendConfigLike } from './frontend-config.js';
import {
  buildDefaultWranglerToml,
  deriveProjectSlug,
  ensureRuntimeScaffold,
  getRuntimeRoot,
  getRuntimeServerSrcDir,
  type RuntimeDependencyProfile,
  writeRuntimeConfigShim,
} from './runtime-scaffold.js';
import {
  generateFunctionRegistry,
  scanFunctions,
  validateRouteNames,
  type ScannedFunction,
} from './function-registry.js';
import { normalizeLegacyEdgeBaseAssetsDirectory } from './deploy-shared.js';

const EDGEBASE_CONFIG_FILES = ['edgebase.config.ts', 'edgebase.config.js'];
const EDGEBASE_TEST_CONFIG_FILES = ['edgebase.test.config.ts', 'edgebase.test.config.js'];

export interface EdgeBaseAppManifest {
  schemaVersion: 1;
  format: 'app-bundle';
  createdAt: string;
  projectName: string;
  configFile: string;
  outputDir: string;
  frontend: {
    enabled: boolean;
    directory?: string;
    mountPath?: string;
    spaFallback?: boolean;
  };
  runtime: {
    root: '.edgebase/runtime/server';
    serverEntry: '.edgebase/runtime/server/src/index.ts';
    assetsDir: '.edgebase/runtime/server/app-assets';
    bundleDir: '.edgebase/runtime/server/bundle';
    registry: '.edgebase/runtime/server/src/_functions-registry.ts';
  };
  config: {
    module: '.edgebase/runtime/server/bundle/config/edgebase.config.bundle.js';
    testModule?: '.edgebase/runtime/server/bundle/config/edgebase.test.config.bundle.js';
  };
  functions: {
    count: number;
    root: '.edgebase/runtime/server/bundle/functions';
  };
}

export interface CreateAppBundleOptions {
  outputDir?: string;
  overwrite?: boolean;
  injectedEnv?: Record<string, string>;
  portableDependencies?: boolean;
  dependencyProfile?: RuntimeDependencyProfile;
}

export interface CreateAppBundleResult {
  format: 'app-bundle';
  projectDir: string;
  outputDir: string;
  manifestPath: string;
  manifest: EdgeBaseAppManifest;
}

function hasEdgeBaseConfig(dir: string): boolean {
  return EDGEBASE_CONFIG_FILES.some((name) => existsSync(resolve(dir, name)));
}

function hasEdgeBaseCliScript(script: string): boolean {
  return /(^|\s)(npx\s+)?edgebase\b/.test(script) || script.includes('packages/cli/dist/index.js');
}

function hasEdgeBasePackageMarker(dir: string): boolean {
  const packageJsonPath = resolve(dir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
      scripts?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const scripts = pkg.scripts ?? {};
    const dependencies = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };

    if (Object.values(scripts).some((value) => typeof value === 'string' && hasEdgeBaseCliScript(value))) {
      return true;
    }

    return ['edgebase', '@edge-base/cli', '@edge-base/shared'].some(
      (name) => typeof dependencies[name] === 'string',
    );
  } catch {
    return false;
  }
}

export function findAppProjectRoot(startDir = resolve('.')): string {
  let dir = startDir;
  while (true) {
    if (hasEdgeBaseConfig(dir) || hasEdgeBasePackageMarker(dir)) {
      return dir;
    }

    const parent = resolve(dir, '..');
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return startDir;
}

function resolveConfigFile(projectDir: string): string | null {
  return EDGEBASE_CONFIG_FILES.find((name) => existsSync(join(projectDir, name))) ?? null;
}

function resolveTestConfigFile(projectDir: string): string | null {
  return EDGEBASE_TEST_CONFIG_FILES.find((name) => existsSync(join(projectDir, name))) ?? null;
}

function resolveAppBundleOutputDir(projectDir: string, explicitOutputDir?: string): string {
  if (explicitOutputDir) {
    return resolve(projectDir, explicitOutputDir);
  }

  return join(projectDir, 'dist', 'edgebase-app');
}

function ensureOutputDir(outputDir: string, overwrite = false): void {
  if (existsSync(outputDir)) {
    if (overwrite) {
      rmSync(outputDir, { recursive: true, force: true });
      mkdirSync(outputDir, { recursive: true });
      return;
    }
    const entries = readdirSync(outputDir);
    if (entries.length > 0) {
      throw new Error(
        `Output directory already exists and is not empty: ${outputDir}. Choose a different --output path or empty it first.`,
      );
    }
    return;
  }

  mkdirSync(outputDir, { recursive: true });
}

function ensureExistingOutputDir(outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });
}

function getRuntimeBundleDir(projectDir: string): string {
  return join(getRuntimeRoot(projectDir), 'bundle');
}

function getBundledConfigModulePath(projectDir: string): string {
  return join(getRuntimeBundleDir(projectDir), 'config', 'edgebase.config.bundle.js');
}

function getBundledTestConfigModulePath(projectDir: string): string {
  return join(getRuntimeBundleDir(projectDir), 'config', 'edgebase.test.config.bundle.js');
}

function getBundledFunctionsDir(projectDir: string): string {
  return join(getRuntimeBundleDir(projectDir), 'functions');
}

function ensureOutputWranglerToml(outputDir: string, projectSlug: string): void {
  writeFileSync(join(outputDir, 'wrangler.toml'), buildDefaultWranglerToml(undefined, projectSlug), 'utf-8');
}

function copyProjectWranglerToml(projectDir: string, outputDir: string): boolean {
  const sourceWranglerPath = join(projectDir, 'wrangler.toml');
  if (!existsSync(sourceWranglerPath)) {
    return false;
  }

  const sourceWranglerToml = readFileSync(sourceWranglerPath, 'utf-8');
  const { normalized } = normalizeLegacyEdgeBaseAssetsDirectory(sourceWranglerToml);
  writeFileSync(join(outputDir, 'wrangler.toml'), normalized, 'utf-8');
  return true;
}

function bundleConfigModule(projectDir: string, outputDir: string, configFile: string): void {
  const outputPath = getBundledConfigModulePath(outputDir);
  mkdirSync(dirname(outputPath), { recursive: true });
  buildBundleWithEsbuild(join(projectDir, configFile), outputPath, projectDir);
}

function bundleTestConfigModule(projectDir: string, outputDir: string, testConfigFile: string | null): boolean {
  if (!testConfigFile) {
    return false;
  }

  const outputPath = getBundledTestConfigModulePath(outputDir);
  mkdirSync(dirname(outputPath), { recursive: true });
  buildBundleWithEsbuild(join(projectDir, testConfigFile), outputPath, projectDir);
  return true;
}

function replaceBundledConfigModules(
  projectDir: string,
  outputDir: string,
  configFile: string,
  testConfigFile: string | null,
): boolean {
  rmSync(join(getRuntimeBundleDir(outputDir), 'config'), { recursive: true, force: true });
  bundleConfigModule(projectDir, outputDir, configFile);
  return bundleTestConfigModule(projectDir, outputDir, testConfigFile);
}

function bundleFunctionModules(projectDir: string, outputDir: string): ScannedFunction[] {
  const projectFunctionsDir = join(projectDir, 'functions');
  if (!existsSync(projectFunctionsDir)) {
    return [];
  }

  const functions = scanFunctions(projectFunctionsDir);
  validateRouteNames(functions);

  const bundledFunctionsDir = getBundledFunctionsDir(outputDir);
  mkdirSync(bundledFunctionsDir, { recursive: true });

  for (const fn of functions) {
    const sourcePath = join(projectFunctionsDir, fn.relativePath);
    const outputPath = join(
      bundledFunctionsDir,
      fn.relativePath.replace(/\.ts$/, '.js'),
    );
    mkdirSync(dirname(outputPath), { recursive: true });
    buildBundleWithEsbuild(sourcePath, outputPath, projectDir, {
      external: ['node:*', 'cloudflare:*'],
    });
  }

  return functions;
}

function replaceBundledFunctionModules(projectDir: string, outputDir: string): ScannedFunction[] {
  rmSync(getBundledFunctionsDir(outputDir), { recursive: true, force: true });
  return bundleFunctionModules(projectDir, outputDir);
}

function writeBundledFunctionRegistry(outputDir: string, functions: ScannedFunction[]): void {
  const registryPath = join(getRuntimeServerSrcDir(outputDir), '_functions-registry.ts');
  const bundledFunctionsDir = getBundledFunctionsDir(outputDir);

  generateFunctionRegistry(functions, registryPath, {
    configImportPath: './generated-config.js',
    functionsImportBasePath: relative(dirname(registryPath), bundledFunctionsDir).replace(/\\/g, '/'),
    resolveFunctionImportPath: (fn, baseImportPath) => `${baseImportPath}/${fn.relativePath.replace(/\.ts$/, '.js')}`,
  });
}

function buildAppManifest(
  projectDir: string,
  outputDir: string,
  configFile: string,
  frontend: FrontendConfigLike | undefined,
  functions: ScannedFunction[],
  hasTestConfigModule: boolean,
): EdgeBaseAppManifest {
  return {
    schemaVersion: 1,
    format: 'app-bundle',
    createdAt: new Date().toISOString(),
    projectName: deriveProjectSlug(projectDir),
    configFile,
    outputDir,
    frontend: frontend
      ? {
        enabled: true,
        directory: frontend.directory,
        ...(frontend.mountPath ? { mountPath: frontend.mountPath } : {}),
        ...(typeof frontend.spaFallback === 'boolean' ? { spaFallback: frontend.spaFallback } : {}),
      }
      : { enabled: false },
    runtime: {
      root: '.edgebase/runtime/server',
      serverEntry: '.edgebase/runtime/server/src/index.ts',
      assetsDir: '.edgebase/runtime/server/app-assets',
      bundleDir: '.edgebase/runtime/server/bundle',
      registry: '.edgebase/runtime/server/src/_functions-registry.ts',
    },
    config: {
      module: '.edgebase/runtime/server/bundle/config/edgebase.config.bundle.js',
      ...(hasTestConfigModule
        ? { testModule: '.edgebase/runtime/server/bundle/config/edgebase.test.config.bundle.js' as const }
        : {}),
    },
    functions: {
      count: functions.length,
      root: '.edgebase/runtime/server/bundle/functions',
    },
  };
}

export function createAppBundle(
  projectDir: string,
  options: CreateAppBundleOptions = {},
): CreateAppBundleResult {
  const outputDir = resolveAppBundleOutputDir(projectDir, options.outputDir);
  ensureOutputDir(outputDir, options.overwrite === true);
  return syncAppBundle(projectDir, outputDir, options);
}

export function syncAppBundle(
  projectDir: string,
  outputDir: string,
  options: Omit<CreateAppBundleOptions, 'outputDir' | 'overwrite'> = {},
): CreateAppBundleResult {
  const configFile = resolveConfigFile(projectDir);
  if (!configFile) {
    throw new Error(`No EdgeBase config file found in ${projectDir}. Expected one of: ${EDGEBASE_CONFIG_FILES.join(', ')}.`);
  }

  ensureExistingOutputDir(outputDir);

  const config = loadConfigSafe(configFile, projectDir, { allowRegexFallback: false }) as {
    frontend?: FrontendConfigLike;
  };
  const testConfigFile = resolveTestConfigFile(projectDir);
  const hasTestConfigModule = Boolean(testConfigFile);

  ensureRuntimeScaffold(outputDir, {
    frontend: config.frontend ?? undefined,
    frontendProjectDir: projectDir,
    configImportPath: '../bundle/config/edgebase.config.bundle.js',
    testConfigImportPath: hasTestConfigModule
      ? './bundle/config/edgebase.test.config.bundle.js'
      : './src/generated-config.ts',
    dependencyMode: options.portableDependencies ? 'copy' : 'symlink',
    dependencyProfile: options.portableDependencies
      ? (options.dependencyProfile ?? 'portable')
      : undefined,
  });
  if (options.injectedEnv && Object.keys(options.injectedEnv).length > 0) {
    writeRuntimeConfigShim(outputDir, options.injectedEnv, {
      importPath: '../bundle/config/edgebase.config.bundle.js',
    });
  }

  const hasBundledTestConfigModule = replaceBundledConfigModules(
    projectDir,
    outputDir,
    configFile,
    testConfigFile,
  );
  const functions = replaceBundledFunctionModules(projectDir, outputDir);
  writeBundledFunctionRegistry(outputDir, functions);
  if (!copyProjectWranglerToml(projectDir, outputDir)) {
    ensureOutputWranglerToml(outputDir, deriveProjectSlug(projectDir));
  }

  const manifest = buildAppManifest(
    projectDir,
    outputDir,
    configFile,
    config.frontend,
    functions,
    hasBundledTestConfigModule,
  );
  const manifestPath = join(outputDir, 'edgebase-app.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

  return {
    format: 'app-bundle',
    projectDir,
    outputDir,
    manifestPath,
    manifest,
  };
}
