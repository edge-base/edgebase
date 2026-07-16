import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import {
  assertNoProtectedWranglerRuntimeSelectors,
  normalizeLegacyEdgeBaseAssetsDirectory,
} from './deploy-shared.js';
import {
  buildManagedScheduleManifest,
  type ManagedScheduleManifest,
} from './managed-schedules.js';

const EDGEBASE_CONFIG_FILES = ['edgebase.config.ts', 'edgebase.config.js'];
const EDGEBASE_TEST_CONFIG_FILES = ['edgebase.test.config.ts', 'edgebase.test.config.js'];
const SELF_HOST_ASSET_ROOT = '.edgebase/self-host';
const SELF_HOST_GATEWAY_ASSET = `${SELF_HOST_ASSET_ROOT}/self-host-gateway.mjs` as const;
const SELF_HOST_SCHEDULE_SUPERVISOR_ASSET = `${SELF_HOST_ASSET_ROOT}/self-host-schedule-supervisor.mjs` as const;
const SELF_HOST_DOCKER_ENTRYPOINT_ASSET = `${SELF_HOST_ASSET_ROOT}/self-host-docker-entrypoint.mjs` as const;

export interface EdgeBaseSelfHostAssetManifest<Path extends string = string> {
  path: Path;
  digest: `sha256:${string}`;
  bytes: number;
}

export interface EdgeBaseSelfHostManifest {
  schemaVersion: 1;
  generation: `sha256:${string}`;
  gateway: EdgeBaseSelfHostAssetManifest<typeof SELF_HOST_GATEWAY_ASSET>;
  scheduleSupervisor: EdgeBaseSelfHostAssetManifest<typeof SELF_HOST_SCHEDULE_SUPERVISOR_ASSET>;
  dockerEntrypoint: EdgeBaseSelfHostAssetManifest<typeof SELF_HOST_DOCKER_ENTRYPOINT_ASSET>;
}

export interface EdgeBaseAppManifest {
  schemaVersion: 1;
  format: 'app-bundle';
  /** Digest of the complete immutable bundle generation. */
  generation: `sha256:${string}`;
  createdAt: string;
  projectName: string;
  configFile: string;
  outputDir: string;
  frontend: {
    enabled: boolean;
    directory?: string;
    mountPath?: string;
    spaFallback?: boolean;
    headers?: Record<string, string>;
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
  schedules: ManagedScheduleManifest;
  selfHost: EdgeBaseSelfHostManifest;
}

export interface CreateAppBundleOptions {
  outputDir?: string;
  overwrite?: boolean;
  injectedEnv?: Record<string, string>;
  /** Exact environment used only while evaluating config metadata. */
  configEvaluationEnv?: NodeJS.ProcessEnv;
  portableDependencies?: boolean;
  dependencyProfile?: RuntimeDependencyProfile;
  /** Test-only fault hook for coherent publication boundary coverage. */
  publicationFaultInjector?: (point: AppBundlePublicationPoint) => void;
  /** @internal Add pack/Docker-owned files before the immutable generation is published. */
  stagedGenerationFinalizer?: (
    stagingDir: string,
    preliminaryManifest: EdgeBaseAppManifest,
  ) => void;
}

export type AppBundlePublicationPoint =
  | 'after-runtime-scaffold'
  | 'after-self-host-assets'
  | 'after-manifest-write'
  | 'after-generation-fsync'
  | 'before-current-pointer-rename'
  | 'after-previous-rename'
  | 'after-generation-rename';

export interface CreateAppBundleResult {
  format: 'app-bundle';
  projectDir: string;
  outputDir: string;
  manifestPath: string;
  manifest: EdgeBaseAppManifest;
  /** The exact filesystem registry scan used for bundling and manifest generation. */
  functions: ScannedFunction[];
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

function ensureExistingOutputDir(outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });
}

function writeFileAtomic(path: string, content: string): void {
  const stagingPath = `${path}.sync-${process.pid}-${randomBytes(6).toString('hex')}`;
  const previousPath = `${path}.previous-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    writeFileSync(stagingPath, content, 'utf-8');
    try {
      renameSync(stagingPath, path);
    } catch (error) {
      if (process.platform !== 'win32' || !existsSync(path)) throw error;
      renameSync(path, previousPath);
      try {
        renameSync(stagingPath, path);
      } catch (replacementError) {
        renameSync(previousPath, path);
        throw replacementError;
      }
      rmSync(previousPath, { force: true });
    }
  } finally {
    rmSync(stagingPath, { force: true });
    rmSync(previousPath, { force: true });
  }
}

function resolveSelfHostGatewaySource(): string {
  return fileURLToPath(new URL('../templates/self-host/self-host-gateway.mjs', import.meta.url));
}

function resolveSelfHostScheduleSupervisorSource(): string {
  const compiledPath = fileURLToPath(new URL('./self-host-schedule-supervisor.js', import.meta.url));
  if (existsSync(compiledPath)) return compiledPath;

  const sourcePath = fileURLToPath(new URL('./self-host-schedule-supervisor.ts', import.meta.url));
  if (existsSync(sourcePath)) return sourcePath;

  throw new Error('Could not resolve the self-host schedule supervisor source.');
}

function resolveSelfHostDockerEntrypointSource(): string {
  return fileURLToPath(new URL('../templates/self-host/self-host-docker-entrypoint.mjs', import.meta.url));
}

function selfHostAssetManifest<Path extends string>(
  path: Path,
  content: Buffer,
): EdgeBaseSelfHostAssetManifest<Path> {
  return {
    path,
    digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    bytes: content.byteLength,
  };
}

function replaceSelfHostRuntimeAssets(outputDir: string): EdgeBaseSelfHostManifest {
  const edgebaseDir = join(outputDir, '.edgebase');
  const liveDir = join(outputDir, SELF_HOST_ASSET_ROOT);
  const nonce = `${process.pid}-${randomBytes(6).toString('hex')}`;
  const stagingDir = join(edgebaseDir, `.self-host.sync-${nonce}`);
  const previousDir = join(edgebaseDir, `.self-host.previous-${nonce}`);
  let previousMoved = false;
  let replacementInstalled = false;

  mkdirSync(stagingDir, { recursive: true });
  try {
    writeFileSync(
      join(stagingDir, 'self-host-gateway.mjs'),
      readFileSync(resolveSelfHostGatewaySource()),
    );
    buildBundleWithEsbuild(
      resolveSelfHostScheduleSupervisorSource(),
      join(stagingDir, 'self-host-schedule-supervisor.mjs'),
      dirname(resolveSelfHostScheduleSupervisorSource()),
    );
    writeFileSync(
      join(stagingDir, 'self-host-docker-entrypoint.mjs'),
      readFileSync(resolveSelfHostDockerEntrypointSource()),
    );

    const gatewayContent = readFileSync(join(stagingDir, 'self-host-gateway.mjs'));
    const supervisorContent = readFileSync(join(stagingDir, 'self-host-schedule-supervisor.mjs'));
    const dockerEntrypointContent = readFileSync(join(stagingDir, 'self-host-docker-entrypoint.mjs'));
    const assets = {
      gateway: selfHostAssetManifest(SELF_HOST_GATEWAY_ASSET, gatewayContent),
      scheduleSupervisor: selfHostAssetManifest(
        SELF_HOST_SCHEDULE_SUPERVISOR_ASSET,
        supervisorContent,
      ),
      dockerEntrypoint: selfHostAssetManifest(
        SELF_HOST_DOCKER_ENTRYPOINT_ASSET,
        dockerEntrypointContent,
      ),
    };
    const generation = `sha256:${createHash('sha256').update(JSON.stringify({
      schemaVersion: 1,
      assets,
    })).digest('hex')}` as const;

    if (existsSync(liveDir)) {
      renameSync(liveDir, previousDir);
      previousMoved = true;
    }

    try {
      renameSync(stagingDir, liveDir);
      replacementInstalled = true;
    } catch (error) {
      if (previousMoved) renameSync(previousDir, liveDir);
      throw error;
    }

    if (previousMoved) rmSync(previousDir, { recursive: true, force: true });
    return { schemaVersion: 1, generation, ...assets };
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
    if (replacementInstalled) rmSync(previousDir, { recursive: true, force: true });
  }
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
  assertNoProtectedWranglerRuntimeSelectors(sourceWranglerToml);
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

function bundleFunctionModules(
  projectDir: string,
  outputDir: string,
  bundledFunctionsDir = getBundledFunctionsDir(outputDir),
): ScannedFunction[] {
  const projectFunctionsDir = join(projectDir, 'functions');
  if (!existsSync(projectFunctionsDir)) {
    return [];
  }

  const functions = scanFunctions(projectFunctionsDir);
  validateRouteNames(functions);

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
  const bundledFunctionsDir = getBundledFunctionsDir(outputDir);
  const stagingDir = `${bundledFunctionsDir}.sync-${process.pid}-${randomBytes(6).toString('hex')}`;

  try {
    // Build the complete replacement away from Wrangler's live import paths.
    // A failed compile must leave every currently-served function in place.
    const functions = bundleFunctionModules(projectDir, outputDir, stagingDir);
    mkdirSync(bundledFunctionsDir, { recursive: true });

    // Each completed module replaces its live twin in one filesystem rename.
    // New routes remain unused until the registry swap below; removed routes
    // remain available to the old registry until pruning after that swap.
    for (const fn of functions) {
      const relativeOutputPath = fn.relativePath.replace(/\.ts$/, '.js');
      const stagedPath = join(stagingDir, relativeOutputPath);
      const livePath = join(bundledFunctionsDir, relativeOutputPath);
      mkdirSync(dirname(livePath), { recursive: true });
      renameSync(stagedPath, livePath);
    }

    return functions;
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

function writeBundledFunctionRegistry(outputDir: string, functions: ScannedFunction[]): void {
  const registryPath = join(getRuntimeServerSrcDir(outputDir), '_functions-registry.ts');
  const stagingPath = `${registryPath}.sync-${process.pid}-${randomBytes(6).toString('hex')}.ts`;
  const bundledFunctionsDir = getBundledFunctionsDir(outputDir);

  try {
    generateFunctionRegistry(functions, stagingPath, {
      configImportPath: './generated-config.js',
      functionsImportBasePath: relative(dirname(registryPath), bundledFunctionsDir).replace(/\\/g, '/'),
      resolveFunctionImportPath: (fn, baseImportPath) => `${baseImportPath}/${fn.relativePath.replace(/\.ts$/, '.js')}`,
    });
    renameSync(stagingPath, registryPath);
  } finally {
    rmSync(stagingPath, { force: true });
  }
}

function pruneBundledFunctionModules(outputDir: string, functions: ScannedFunction[]): void {
  const bundledFunctionsDir = getBundledFunctionsDir(outputDir);
  if (!existsSync(bundledFunctionsDir)) return;
  const expected = new Set(functions.map((fn) => fn.relativePath.replace(/\.ts$/, '.js')));

  const prune = (dir: string): boolean => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (prune(path)) rmSync(path, { recursive: true, force: true });
        continue;
      }
      const relativePath = relative(bundledFunctionsDir, path).replace(/\\/g, '/');
      if (!expected.has(relativePath)) rmSync(path, { force: true });
    }
    return readdirSync(dir).length === 0;
  };

  prune(bundledFunctionsDir);
}

/**
 * Refresh only user function modules and their registry for a live dev bundle.
 * Function-source saves must not recopy the runtime scaffold or frontend
 * assets: Wrangler can keep serving the current SPA while the staged function
 * build completes and swaps into place.
 */
export function syncAppBundleFunctions(
  projectDir: string,
  outputDir: string,
): ScannedFunction[] {
  ensureExistingOutputDir(outputDir);
  const functions = replaceBundledFunctionModules(projectDir, outputDir);
  writeBundledFunctionRegistry(outputDir, functions);
  pruneBundledFunctionModules(outputDir, functions);
  return functions;
}

function buildAppManifest(
  projectDir: string,
  outputDir: string,
  configFile: string,
  config: Record<string, unknown> & { frontend?: FrontendConfigLike },
  functions: ScannedFunction[],
  hasTestConfigModule: boolean,
  schedules: ManagedScheduleManifest,
  selfHost: EdgeBaseSelfHostManifest,
  generation: `sha256:${string}`,
): EdgeBaseAppManifest {
  return {
    schemaVersion: 1,
    format: 'app-bundle',
    generation,
    createdAt: new Date().toISOString(),
    projectName: deriveProjectSlug(projectDir),
    configFile,
    outputDir,
    frontend: config.frontend
      ? {
        enabled: true,
        directory: config.frontend.directory,
        ...(config.frontend.mountPath ? { mountPath: config.frontend.mountPath } : {}),
        ...(typeof config.frontend.spaFallback === 'boolean' ? { spaFallback: config.frontend.spaFallback } : {}),
        ...(config.frontend.headers ? { headers: config.frontend.headers } : {}),
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
    schedules,
    selfHost,
  };
}

function hashAppBundleTree(root: string): `sha256:${string}` {
  const hash = createHash('sha256');
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const relativePath = relative(root, path).replace(/\\/g, '/');
      if (relativePath === 'edgebase-app.json') continue;
      const info = lstatSync(path);
      if (info.isSymbolicLink()) {
        hash.update(`L\0${relativePath}\0${readlinkSync(path)}\0`);
      } else if (info.isDirectory()) {
        hash.update(`D\0${relativePath}\0`);
        visit(path);
      } else if (info.isFile()) {
        hash.update(`F\0${relativePath}\0${info.size}\0`);
        hash.update(readFileSync(path));
        hash.update('\0');
      } else {
        throw new Error(`App bundle contains an unsupported filesystem entry: ${path}`);
      }
    }
  };
  visit(root);
  return `sha256:${hash.digest('hex')}`;
}

function syncFileOrDirectory(path: string): void {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, 'r');
    fsyncSync(descriptor);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function syncGenerationTree(root: string): void {
  const directories: string[] = [];
  const visit = (directory: string): void => {
    directories.push(directory);
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const info = lstatSync(path);
      if (info.isDirectory()) visit(path);
      else if (info.isFile()) syncFileOrDirectory(path);
    }
  };
  visit(root);
  for (const directory of directories.reverse()) syncFileOrDirectory(directory);
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function prepareAppBundlePublication(outputDir: string): void {
  const parent = dirname(outputDir);
  const outputName = basename(outputDir);
  const generationsDir = join(parent, `.${outputName}.generations`);
  const removeDeadOwnerEntries = (prefix: string): void => {
    for (const entry of readdirSync(parent)) {
      if (!entry.startsWith(prefix)) continue;
      const pid = Number(entry.slice(prefix.length).split('-', 1)[0]);
      if (pid === process.pid || processIsAlive(pid)) continue;
      rmSync(join(parent, entry), { recursive: true, force: true });
    }
  };
  removeDeadOwnerEntries(`.${outputName}.sync-`);
  removeDeadOwnerEntries(`.${outputName}.current-`);

  if (existsSync(outputDir) || !existsSync(generationsDir)) return;
  const legacy = readdirSync(generationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('legacy-'))
    .map((entry) => join(generationsDir, entry.name))
    .filter((path) => existsSync(join(path, 'edgebase-app.json')))
    .sort((left, right) => lstatSync(right).mtimeMs - lstatSync(left).mtimeMs)[0];
  if (!legacy) return;

  const recoveryPointer = join(
    parent,
    `.${outputName}.current-${process.pid}-${randomBytes(6).toString('hex')}`,
  );
  symlinkSync(relative(parent, legacy), recoveryPointer, 'dir');
  renameSync(recoveryPointer, outputDir);
  syncFileOrDirectory(parent);
}

function computeAppBundleGeneration(
  outputDir: string,
  scheduleDigest: `sha256:${string}`,
  selfHostGeneration: `sha256:${string}`,
): `sha256:${string}` {
  const tree = hashAppBundleTree(outputDir);
  return `sha256:${createHash('sha256').update(JSON.stringify({
    schemaVersion: 1,
    tree,
    scheduleDigest,
    selfHostGeneration,
  })).digest('hex')}`;
}

function buildAppBundleGeneration(
  projectDir: string,
  outputDir: string,
  publishedOutputDir: string,
  options: Omit<CreateAppBundleOptions, 'outputDir' | 'overwrite'> = {},
): CreateAppBundleResult {
  const configFile = resolveConfigFile(projectDir);
  if (!configFile) {
    throw new Error(`No EdgeBase config file found in ${projectDir}. Expected one of: ${EDGEBASE_CONFIG_FILES.join(', ')}.`);
  }

  ensureExistingOutputDir(outputDir);

  const config = loadConfigSafe(configFile, projectDir, {
    allowRegexFallback: false,
    ...(options.configEvaluationEnv ? { env: options.configEvaluationEnv } : {}),
  }) as Record<string, unknown> & {
    frontend?: FrontendConfigLike;
    release?: boolean;
    captcha?: unknown;
  };
  if (
    config.release === true
    && config.captcha
    && typeof config.captcha === 'object'
    && !Array.isArray(config.captcha)
    && Object.prototype.hasOwnProperty.call(config.captcha, 'secretKey')
  ) {
    throw new Error(
      'Release CAPTCHA cannot bundle captcha.secretKey. Remove it from '
      + 'edgebase.config.ts and provide TURNSTILE_SECRET as a runtime secret.',
    );
  }
  const testConfigFile = resolveTestConfigFile(projectDir);
  const hasTestConfigModule = Boolean(testConfigFile);

  ensureRuntimeScaffold(outputDir, {
    frontend: config.frontend ?? undefined,
    frontendProjectDir: projectDir,
    dependencyProjectDir: projectDir,
    configImportPath: '../bundle/config/edgebase.config.bundle.js',
    testConfigImportPath: hasTestConfigModule
      ? './bundle/config/edgebase.test.config.bundle.js'
      : './src/generated-config.ts',
    dependencyMode: options.portableDependencies ? 'copy' : 'symlink',
    dependencyProfile: options.portableDependencies
      ? (options.dependencyProfile ?? 'portable')
      : undefined,
  });
  options.publicationFaultInjector?.('after-runtime-scaffold');
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
  const functions = syncAppBundleFunctions(projectDir, outputDir);
  if (!copyProjectWranglerToml(projectDir, outputDir)) {
    ensureOutputWranglerToml(outputDir, deriveProjectSlug(projectDir));
  }

  const selfHost = replaceSelfHostRuntimeAssets(outputDir);
  options.publicationFaultInjector?.('after-self-host-assets');
  const schedules = buildManagedScheduleManifest(functions, config);
  const preliminaryGeneration = computeAppBundleGeneration(
    outputDir,
    schedules.digest,
    selfHost.generation,
  );
  let manifest = buildAppManifest(
    projectDir,
    publishedOutputDir,
    configFile,
    config,
    functions,
    hasBundledTestConfigModule,
    schedules,
    selfHost,
    preliminaryGeneration,
  );
  const manifestPath = join(outputDir, 'edgebase-app.json');
  writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  options.stagedGenerationFinalizer?.(outputDir, manifest);
  const generation = computeAppBundleGeneration(
    outputDir,
    schedules.digest,
    selfHost.generation,
  );
  if (generation !== preliminaryGeneration) {
    manifest = buildAppManifest(
      projectDir,
      publishedOutputDir,
      configFile,
      config,
      functions,
      hasBundledTestConfigModule,
      schedules,
      selfHost,
      generation,
    );
    writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  options.publicationFaultInjector?.('after-manifest-write');

  return {
    format: 'app-bundle',
    projectDir,
    outputDir: publishedOutputDir,
    manifestPath: join(publishedOutputDir, 'edgebase-app.json'),
    manifest,
    functions,
  };
}

function publishAppBundleGeneration(
  outputDir: string,
  stagingDir: string,
  faultInjector?: (point: AppBundlePublicationPoint) => void,
): void {
  const parent = dirname(outputDir);
  const outputName = basename(outputDir);
  const generationsDir = join(parent, `.${outputName}.generations`);
  const manifest = JSON.parse(readFileSync(join(stagingDir, 'edgebase-app.json'), 'utf8')) as {
    generation?: unknown;
  };
  if (typeof manifest.generation !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(manifest.generation)) {
    throw new Error('Staged app bundle is missing its immutable generation digest.');
  }
  const generationDir = join(
    generationsDir,
    `${manifest.generation.slice('sha256:'.length)}-${process.pid}-${randomBytes(4).toString('hex')}`,
  );
  const pointerPath = join(
    parent,
    `.${outputName}.current-${process.pid}-${randomBytes(6).toString('hex')}`,
  );
  const legacyDir = join(
    generationsDir,
    `legacy-${process.pid}-${randomBytes(6).toString('hex')}`,
  );
  let generationMoved = false;
  let pointerPublished = false;
  let previousCurrentTarget: string | null = (
    existsSync(outputDir) && lstatSync(outputDir).isSymbolicLink()
  ) ? realpathSync(outputDir) : null;
  try {
    mkdirSync(generationsDir, { recursive: true });
    renameSync(stagingDir, generationDir);
    generationMoved = true;
    syncGenerationTree(generationDir);
    syncFileOrDirectory(generationsDir);
    faultInjector?.('after-generation-fsync');

    symlinkSync(relative(parent, generationDir), pointerPath, 'dir');
    syncFileOrDirectory(parent);
    faultInjector?.('before-current-pointer-rename');

    if (existsSync(outputDir) && !lstatSync(outputDir).isSymbolicLink()) {
      // One-time migration from the legacy directory publisher. Its complete
      // generation is retained for deterministic recovery if the process dies
      // before the current pointer rename below.
      renameSync(outputDir, legacyDir);
      previousCurrentTarget = realpathSync(legacyDir);
      syncFileOrDirectory(generationsDir);
      faultInjector?.('after-previous-rename');
    }
    renameSync(pointerPath, outputDir);
    pointerPublished = true;
    syncFileOrDirectory(parent);
    faultInjector?.('after-generation-rename');

    // Keep the current and one prior generation so readers that resolved the
    // old pointer before publication cannot lose files mid-read. Interrupted
    // cleanup is harmless because no generation is mutable after publication.
    const currentTarget = realpathSync(outputDir);
    const retainedSet = new Set([
      currentTarget,
      ...(previousCurrentTarget ? [previousCurrentTarget] : []),
    ]);
    for (const entry of readdirSync(generationsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(generationsDir, entry.name);
      if (!retainedSet.has(realpathSync(path))) rmSync(path, { recursive: true, force: true });
    }
  } finally {
    rmSync(pointerPath, { force: true });
    if (!generationMoved) rmSync(stagingDir, { recursive: true, force: true });
    if (generationMoved && !pointerPublished && !existsSync(outputDir)) {
      // Legacy migration can be interrupted only by a catchable test fault.
      // Real process death leaves both complete directories for the next run.
      if (existsSync(legacyDir)) {
        renameSync(legacyDir, outputDir);
        syncFileOrDirectory(parent);
      }
    }
  }
}

function stageAndPublishAppBundle(
  projectDir: string,
  outputDir: string,
  options: Omit<CreateAppBundleOptions, 'outputDir' | 'overwrite'>,
): CreateAppBundleResult {
  const parent = dirname(outputDir);
  mkdirSync(parent, { recursive: true });
  prepareAppBundlePublication(outputDir);
  const stagingDir = join(
    parent,
    `.${basename(outputDir)}.sync-${process.pid}-${randomBytes(6).toString('hex')}`,
  );
  mkdirSync(stagingDir, { recursive: true });
  try {
    const result = buildAppBundleGeneration(projectDir, stagingDir, outputDir, options);
    publishAppBundleGeneration(outputDir, stagingDir, options.publicationFaultInjector);
    return result;
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

export function createAppBundle(
  projectDir: string,
  options: CreateAppBundleOptions = {},
): CreateAppBundleResult {
  const outputDir = resolveAppBundleOutputDir(projectDir, options.outputDir);
  if (existsSync(outputDir) && !options.overwrite && readdirSync(outputDir).length > 0) {
    throw new Error(
      `Output directory already exists and is not empty: ${outputDir}. Choose a different --output path or empty it first.`,
    );
  }
  return stageAndPublishAppBundle(projectDir, outputDir, options);
}

export function syncAppBundle(
  projectDir: string,
  outputDir: string,
  options: Omit<CreateAppBundleOptions, 'outputDir' | 'overwrite'> = {},
): CreateAppBundleResult {
  return stageAndPublishAppBundle(projectDir, outputDir, options);
}
