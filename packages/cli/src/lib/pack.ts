import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  createAppBundle,
  findAppProjectRoot,
  type CreateAppBundleOptions,
  type EdgeBaseAppManifest,
} from './app-bundle.js';
import { loadConfigSafe } from './load-config.js';
import { generateTempWranglerToml } from './deploy-shared.js';
import { resolveLocalDevBindings } from './project-runtime.js';

const EDGEBASE_CONFIG_FILES = ['edgebase.config.ts', 'edgebase.config.js'];

export interface EdgeBasePackManifest {
  schemaVersion: 1;
  format: 'dir';
  createdAt: string;
  projectName: string;
  outputDir: string;
  appManifest: 'edgebase-app.json';
  frontend: EdgeBaseAppManifest['frontend'];
  runtime: EdgeBaseAppManifest['runtime'];
  config: EdgeBaseAppManifest['config'];
  functions: EdgeBaseAppManifest['functions'];
  launcher: {
    entry: 'launcher.mjs';
    unix: 'run.sh';
    windows: 'run.cmd';
    defaultOpenPath: string;
    defaultPort: number;
    defaultHost: '127.0.0.1';
    defaultDataDir: 'os-app-data';
    appDataDirName: string;
    stateDir: 'state';
    runtimeDir: 'runtime';
    singleInstance: true;
    portSearchLimit: 20;
  };
}

export interface EdgeBasePortableManifest {
  schemaVersion: 1;
  format: 'portable';
  createdAt: string;
  projectName: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  artifactKind: 'macos-app' | 'portable-dir';
  outputPath: string;
  bundledAppDir: string;
  launcherPath: string;
  embeddedNodePath: string;
  appManifest: string;
  packManifest: string;
}

export interface EdgeBaseArchiveManifest {
  schemaVersion: 1;
  format: 'archive';
  createdAt: string;
  projectName: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  archiveType: 'zip' | 'tar.gz';
  outputPath: string;
  sourcePortablePath: string;
  launcherPath: string;
  embeddedNodePath: string;
  appManifest: string;
  packManifest: string;
}

export interface CreateDirPackArtifactOptions extends CreateAppBundleOptions {}

export interface CreatePortablePackArtifactOptions extends CreateAppBundleOptions {
  appName?: string;
}

export interface CreateDirPackArtifactResult {
  format: 'dir';
  projectDir: string;
  outputDir: string;
  manifestPath: string;
  manifest: EdgeBasePackManifest;
  appManifestPath: string;
  appManifest: EdgeBaseAppManifest;
}

export interface CreatePortablePackArtifactResult {
  format: 'portable';
  projectDir: string;
  outputPath: string;
  manifestPath: string;
  manifest: EdgeBasePortableManifest;
  launcherPath: string;
  bundledAppDir: string;
  appManifestPath: string;
  packManifestPath: string;
  appManifest: EdgeBaseAppManifest;
  packManifest: EdgeBasePackManifest;
}

export interface CreateArchivePackArtifactResult {
  format: 'archive';
  projectDir: string;
  outputPath: string;
  manifest: EdgeBaseArchiveManifest;
  sourcePortablePath: string;
  launcherPath: string;
  bundledAppDir: string;
  appManifestPath: string;
  packManifestPath: string;
  appManifest: EdgeBaseAppManifest;
  packManifest: EdgeBasePackManifest;
}

export function findPackProjectRoot(startDir?: string): string {
  return findAppProjectRoot(startDir);
}

function buildPackManifest(
  outputDir: string,
  appManifest: EdgeBaseAppManifest,
): EdgeBasePackManifest {
  const defaultOpenPath = appManifest.frontend.enabled
    ? appManifest.frontend.mountPath ?? '/'
    : '/admin';

  return {
    schemaVersion: 1,
    format: 'dir',
    createdAt: new Date().toISOString(),
    projectName: appManifest.projectName,
    outputDir,
    appManifest: 'edgebase-app.json',
    frontend: appManifest.frontend,
    runtime: appManifest.runtime,
    config: appManifest.config,
    functions: appManifest.functions,
    launcher: {
      entry: 'launcher.mjs',
      unix: 'run.sh',
      windows: 'run.cmd',
      defaultOpenPath,
      defaultPort: deriveLauncherPort(appManifest.projectName),
      defaultHost: '127.0.0.1',
      defaultDataDir: 'os-app-data',
      appDataDirName: buildAppDataDirectoryName(appManifest.projectName),
      stateDir: 'state',
      runtimeDir: 'runtime',
      singleInstance: true,
      portSearchLimit: 20,
    },
  };
}

function deriveLauncherPort(projectName: string): number {
  const normalized = sanitizeExecutableName(projectName).toLowerCase();
  let hash = 0;
  for (const char of normalized) {
    hash = (hash * 31 + char.charCodeAt(0)) % 2000;
  }
  return 47600 + hash;
}

function buildAppDataDirectoryName(projectName: string): string {
  return `edgebase-${sanitizeExecutableName(projectName).toLowerCase()}`;
}

function buildPortableManifest(options: {
  outputPath: string;
  bundledAppDir: string;
  launcherPath: string;
  embeddedNodePath: string;
  appManifestPath: string;
  packManifestPath: string;
  projectName: string;
  artifactKind: EdgeBasePortableManifest['artifactKind'];
}): EdgeBasePortableManifest {
  return {
    schemaVersion: 1,
    format: 'portable',
    createdAt: new Date().toISOString(),
    projectName: options.projectName,
    platform: process.platform,
    arch: process.arch,
    artifactKind: options.artifactKind,
    outputPath: options.outputPath,
    bundledAppDir: options.bundledAppDir,
    launcherPath: options.launcherPath,
    embeddedNodePath: options.embeddedNodePath,
    appManifest: options.appManifestPath,
    packManifest: options.packManifestPath,
  };
}

function buildArchiveManifest(options: {
  outputPath: string;
  sourcePortablePath: string;
  launcherPath: string;
  embeddedNodePath: string;
  appManifestPath: string;
  packManifestPath: string;
  projectName: string;
  archiveType: EdgeBaseArchiveManifest['archiveType'];
}): EdgeBaseArchiveManifest {
  return {
    schemaVersion: 1,
    format: 'archive',
    createdAt: new Date().toISOString(),
    projectName: options.projectName,
    platform: process.platform,
    arch: process.arch,
    archiveType: options.archiveType,
    outputPath: options.outputPath,
    sourcePortablePath: options.sourcePortablePath,
    launcherPath: options.launcherPath,
    embeddedNodePath: options.embeddedNodePath,
    appManifest: options.appManifestPath,
    packManifest: options.packManifestPath,
  };
}

function resolvePortableOutputPath(
  projectDir: string,
  projectName: string,
  explicitOutput?: string,
): string {
  if (explicitOutput) {
    return resolve(projectDir, explicitOutput);
  }

  if (process.platform === 'darwin') {
    return join(projectDir, 'dist', `${projectName}.app`);
  }

  return join(projectDir, 'dist', `${projectName}-${process.platform}-${process.arch}-portable`);
}

function resolveArchiveOutputPath(
  projectDir: string,
  projectName: string,
  explicitOutput?: string,
): string {
  if (explicitOutput) {
    return resolve(projectDir, explicitOutput);
  }

  const archiveExtension = process.platform === 'linux' ? '.tar.gz' : '.zip';
  return join(projectDir, 'dist', `${projectName}-${process.platform}-${process.arch}${archiveExtension}`);
}

function sanitizeExecutableName(appName: string): string {
  const normalized = appName
    .replace(/\.app$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'edgebase-app';
}

export function createArchiveFromPortableArtifact(sourcePath: string, archivePath: string): EdgeBaseArchiveManifest['archiveType'] {
  rmSync(archivePath, { force: true, recursive: true });
  mkdirSync(dirname(archivePath), { recursive: true });

  if (process.platform === 'darwin') {
    execFileSync('ditto', ['-c', '-k', '--keepParent', basename(sourcePath), archivePath], {
      cwd: dirname(sourcePath),
      stdio: 'pipe',
    });
    return 'zip';
  }

  if (process.platform === 'win32') {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${sourcePath.replace(/'/g, "''")}' -DestinationPath '${archivePath.replace(/'/g, "''")}' -Force`,
    ], {
      stdio: 'pipe',
    });
    return 'zip';
  }

  execFileSync('tar', ['-czf', archivePath, '-C', dirname(sourcePath), basename(sourcePath)], {
    stdio: 'pipe',
  });
  return 'tar.gz';
}

function finalizePackWrangler(projectDir: string, outputDir: string): void {
  const configFile = EDGEBASE_CONFIG_FILES
    .map((name) => join(projectDir, name))
    .find((path) => existsSync(path));
  if (!configFile) {
    throw new Error(`No EdgeBase config file found in ${projectDir}.`);
  }

  const config = loadConfigSafe(configFile, projectDir, {
    allowRegexFallback: false,
  }) as Record<string, unknown>;
  const wranglerPath = join(outputDir, 'wrangler.toml');
  const generatedPath = generateTempWranglerToml(wranglerPath, {
    bindings: resolveLocalDevBindings(config),
    triggerMode: 'preserve',
  });

  if (!generatedPath) return;

  writeFileSync(wranglerPath, readFileSync(generatedPath, 'utf-8'), 'utf-8');
  rmSync(generatedPath, { force: true });
}

function buildLauncherSource(manifest: EdgeBasePackManifest): string {
  return `#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_HOST = ${JSON.stringify(manifest.launcher.defaultHost)};
const DEFAULT_PORT = ${manifest.launcher.defaultPort};
const DEFAULT_OPEN_PATH = ${JSON.stringify(manifest.launcher.defaultOpenPath)};
const APP_DATA_DIR_NAME = ${JSON.stringify(manifest.launcher.appDataDirName)};
const DEFAULT_STATE_DIR = ${JSON.stringify(manifest.launcher.stateDir)};
const DEFAULT_RUNTIME_DIR = ${JSON.stringify(manifest.launcher.runtimeDir)};
const SINGLE_INSTANCE = ${manifest.launcher.singleInstance ? 'true' : 'false'};
const PORT_SEARCH_LIMIT = ${manifest.launcher.portSearchLimit};

function parseArgs(argv) {
  const options = {
    host: process.env.HOST || process.env.EDGEBASE_HOST || DEFAULT_HOST,
    port: process.env.PORT || process.env.EDGEBASE_PORT || '',
    dataDir: process.env.EDGEBASE_DATA_DIR || '',
    persistTo: process.env.PERSIST_DIR || '',
    open: process.env.EDGEBASE_OPEN === '1' || process.env.EDGEBASE_OPEN === 'true',
    dryRun: false,
    json: false,
    envFile: process.env.EDGEBASE_ENV_FILE || '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--host' && next) {
      options.host = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--host=')) {
      options.host = arg.slice('--host='.length);
      continue;
    }
    if (arg === '--port' && next) {
      options.port = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--port=')) {
      options.port = arg.slice('--port='.length);
      continue;
    }
    if (arg === '--persist-to' && next) {
      options.persistTo = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--persist-to=')) {
      options.persistTo = arg.slice('--persist-to='.length);
      continue;
    }
    if (arg === '--data-dir' && next) {
      options.dataDir = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--data-dir=')) {
      options.dataDir = arg.slice('--data-dir='.length);
      continue;
    }
    if (arg === '--env-file' && next) {
      options.envFile = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--env-file=')) {
      options.envFile = arg.slice('--env-file='.length);
      continue;
    }
    if (arg === '--open') {
      options.open = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
  }

  return options;
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function parseEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) return {};
  const content = readFileSync(filePath, 'utf-8');
  const values = {};

  for (const rawLine of content.split(/\\r?\\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith(\"'\") && value.endsWith(\"'\"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function serializeEnvValue(value) {
  return /^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : JSON.stringify(value);
}

function saveJson(filePath, payload) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\\n', 'utf-8');
}

function removeFileIfExists(filePath) {
  try {
    rmSync(filePath, { force: true });
  } catch {
    // best-effort cleanup only
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveDataRoot(dataDir) {
  if (dataDir) {
    return resolve(process.cwd(), dataDir);
  }

  if (process.platform === 'darwin') {
    return resolve(homedir(), 'Library', 'Application Support', APP_DATA_DIR_NAME);
  }

  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    return resolve(base, APP_DATA_DIR_NAME);
  }

  const base = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return resolve(base, APP_DATA_DIR_NAME);
}

async function probePort(port, host) {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once('error', () => resolvePromise(false));
    server.once('listening', () => {
      server.close(() => resolvePromise(true));
    });
    server.listen({ port, host, exclusive: true });
  });
}

async function resolveSelectedPort(host, explicitPort, statePath) {
  if (explicitPort) {
    return {
      port: Number.parseInt(String(explicitPort), 10),
      source: 'explicit',
    };
  }

  const savedState = readJson(statePath);
  const preferredPort = typeof savedState?.port === 'number'
    ? savedState.port
    : DEFAULT_PORT;

  for (let offset = 0; offset < PORT_SEARCH_LIMIT; offset += 1) {
    const candidate = preferredPort + offset;
    if (await probePort(candidate, host)) {
      return {
        port: candidate,
        source: candidate === preferredPort
          ? (typeof savedState?.port === 'number' ? 'saved' : 'default')
          : 'fallback',
      };
    }
  }

  throw new Error(
    \`Could not find an available port in the range \${preferredPort}-\${preferredPort + PORT_SEARCH_LIMIT - 1}.\`,
  );
}

function readActiveInstance(lockPath, host) {
  if (!SINGLE_INSTANCE) return null;

  const lock = readJson(lockPath);
  if (!lock || typeof lock.port !== 'number' || typeof lock.pid !== 'number') {
    removeFileIfExists(lockPath);
    return null;
  }

  if (typeof lock.host !== 'string' || lock.host !== host) {
    return null;
  }

  if (!isProcessAlive(lock.pid)) {
    removeFileIfExists(lockPath);
    return null;
  }

  return lock;
}

function findWranglerPackageJson(runtimeNodeModules) {
  const direct = join(runtimeNodeModules, 'wrangler', 'package.json');
  if (existsSync(direct)) return direct;

  const pnpmDir = join(runtimeNodeModules, '.pnpm');
  if (existsSync(pnpmDir)) {
    const candidate = readdirSync(pnpmDir)
      .filter((entry) => entry.startsWith('wrangler@'))
      .map((entry) => join(pnpmDir, entry, 'node_modules', 'wrangler', 'package.json'))
      .find((entry) => existsSync(entry));
    if (candidate) return candidate;
  }

  throw new Error('Could not find wrangler/package.json inside the packed runtime.');
}

function resolveWranglerBin(runtimeNodeModules) {
  const packageJsonPath = findWranglerPackageJson(runtimeNodeModules);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const relBin = typeof packageJson.bin === 'string'
    ? packageJson.bin
    : packageJson.bin?.wrangler ?? packageJson.bin?.wrangler2;
  if (!relBin) {
    throw new Error('Could not resolve the packed Wrangler binary.');
  }
  return resolve(dirname(packageJsonPath), relBin);
}

function openBrowser(url) {
  if (process.platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    return;
  }
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    return;
  }
  spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
}

const artifactRoot = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = join(artifactRoot, '.edgebase', 'runtime', 'server');
const runtimeNodeModules = join(runtimeRoot, 'node_modules');
const options = parseArgs(process.argv.slice(2));
const dataRoot = resolveDataRoot(options.dataDir);
const workDir = join(dataRoot, DEFAULT_RUNTIME_DIR);
const persistDir = options.persistTo
  ? resolve(process.cwd(), options.persistTo)
  : join(dataRoot, DEFAULT_STATE_DIR);
const statePath = join(dataRoot, 'launcher-state.json');
const lockPath = join(dataRoot, 'launcher-lock.json');
mkdirSync(dataRoot, { recursive: true });
mkdirSync(workDir, { recursive: true });
mkdirSync(persistDir, { recursive: true });

const envFileCandidates = [
  join(process.cwd(), '.env'),
  join(process.cwd(), '.env.local'),
  join(artifactRoot, '.env'),
  join(artifactRoot, '.env.local'),
  options.envFile ? resolve(process.cwd(), options.envFile) : '',
].filter(Boolean);
const mergedEnv = Object.assign(
  {},
  ...envFileCandidates.map((filePath) => parseEnvFile(filePath)),
  Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string')),
);

const devVarsPath = join(workDir, '.dev.vars');
writeFileSync(
  devVarsPath,
  Object.keys(mergedEnv)
    .sort()
    .map((key) => \`\${key}=\${serializeEnvValue(String(mergedEnv[key]))}\`)
    .join('\\n') + '\\n',
  'utf-8',
);

const wranglerBin = resolveWranglerBin(runtimeNodeModules);
const existingInstance = readActiveInstance(lockPath, options.host);
const selectedPort = existingInstance && !options.port
  ? { port: existingInstance.port, source: 'existing' }
  : await resolveSelectedPort(options.host, options.port, statePath);
saveJson(statePath, {
  host: options.host,
  port: selectedPort.port,
  updatedAt: new Date().toISOString(),
});
const wranglerArgs = [
  wranglerBin,
  'dev',
  '--config',
  join(artifactRoot, 'wrangler.toml'),
  '--port',
  String(selectedPort.port),
  '--ip',
  options.host,
  '--persist-to',
  persistDir,
];
const openUrl = \`http://\${options.host}:\${selectedPort.port}\${DEFAULT_OPEN_PATH}\`;

if (options.dryRun) {
  const payload = {
    status: 'success',
    artifactRoot,
    runtimeRoot,
    dataRoot,
    workDir,
    wranglerCommand: process.execPath,
    wranglerBin,
    wranglerArgs,
    host: options.host,
    port: selectedPort.port,
    persistDir,
    devVarsPath,
    statePath,
    lockPath,
    existingInstance: Boolean(existingInstance && !options.port),
    openUrl,
  };
  process.stdout.write(options.json ? JSON.stringify(payload, null, 2) + '\\n' : JSON.stringify(payload) + '\\n');
  process.exit(0);
}

if (existingInstance && !options.port) {
  openBrowser(openUrl);
  process.exit(0);
}

saveJson(lockPath, {
  pid: process.pid,
  host: options.host,
  port: selectedPort.port,
  createdAt: new Date().toISOString(),
});

const child = spawn(process.execPath, wranglerArgs, {
  cwd: workDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    ...mergedEnv,
  },
  detached: process.platform !== 'win32',
});

const cleanupLock = () => {
  const current = readJson(lockPath);
  if (current?.pid === process.pid) {
    removeFileIfExists(lockPath);
  }
};

process.on('exit', cleanupLock);

if (options.open) {
  setTimeout(() => openBrowser(openUrl), 1500);
}

const forward = (signal) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
};

process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));

child.on('exit', (code, signal) => {
  cleanupLock();
  if (signal) {
    process.exit(1);
    return;
  }
  process.exit(code ?? 0);
});
`;
}

function writeLauncherFiles(outputDir: string, manifest: EdgeBasePackManifest): void {
  const launcherPath = join(outputDir, manifest.launcher.entry);
  const runShPath = join(outputDir, manifest.launcher.unix);
  const runCmdPath = join(outputDir, manifest.launcher.windows);

  writeFileSync(launcherPath, buildLauncherSource(manifest), 'utf-8');
  writeFileSync(
    runShPath,
    `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
exec node "$SCRIPT_DIR/${manifest.launcher.entry}" "$@"
`,
    'utf-8',
  );
  writeFileSync(
    runCmdPath,
    `@echo off
set SCRIPT_DIR=%~dp0
node "%SCRIPT_DIR%\\${manifest.launcher.entry}" %*
`,
    'utf-8',
  );

  chmodSync(launcherPath, 0o755);
  chmodSync(runShPath, 0o755);
}

function createMacPortableArtifact(
  outputPath: string,
  appName: string,
  dirArtifact: CreateDirPackArtifactResult,
): CreatePortablePackArtifactResult {
  const executableName = sanitizeExecutableName(appName);
  const contentsDir = join(outputPath, 'Contents');
  const macOsDir = join(contentsDir, 'MacOS');
  const resourcesDir = join(contentsDir, 'Resources');
  const bundledAppDir = join(resourcesDir, 'app');
  const embeddedNodePath = join(macOsDir, 'node');
  const launcherPath = join(macOsDir, executableName);

  rmSync(outputPath, { recursive: true, force: true });
  mkdirSync(macOsDir, { recursive: true });
  mkdirSync(resourcesDir, { recursive: true });
  cpSync(dirArtifact.outputDir, bundledAppDir, {
    recursive: true,
    force: true,
    dereference: false,
    verbatimSymlinks: true,
  });
  copyFileSync(realpathSync(process.execPath), embeddedNodePath);
  chmodSync(embeddedNodePath, 0o755);

  writeFileSync(
    launcherPath,
    `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/../Resources/app" && pwd)"
exec "$SCRIPT_DIR/node" "$APP_DIR/launcher.mjs" "$@"
`,
    'utf-8',
  );
  chmodSync(launcherPath, 0o755);

  writeFileSync(
    join(contentsDir, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>${appName.replace(/\.app$/i, '')}</string>
    <key>CFBundleExecutable</key>
    <string>${executableName}</string>
    <key>CFBundleIdentifier</key>
    <string>fun.edgebase.${sanitizeExecutableName(dirArtifact.manifest.projectName)}</string>
    <key>CFBundleName</key>
    <string>${appName.replace(/\.app$/i, '')}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
  </dict>
</plist>
`,
    'utf-8',
  );

  const manifest = buildPortableManifest({
    outputPath,
    bundledAppDir,
    launcherPath,
    embeddedNodePath,
    appManifestPath: join(bundledAppDir, 'edgebase-app.json'),
    packManifestPath: join(bundledAppDir, 'edgebase-pack.json'),
    projectName: dirArtifact.manifest.projectName,
    artifactKind: 'macos-app',
  });
  const manifestPath = join(resourcesDir, 'edgebase-portable.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

  return {
    format: 'portable',
    projectDir: dirArtifact.projectDir,
    outputPath,
    manifestPath,
    manifest,
    launcherPath,
    bundledAppDir,
    appManifestPath: join(bundledAppDir, 'edgebase-app.json'),
    packManifestPath: join(bundledAppDir, 'edgebase-pack.json'),
    appManifest: dirArtifact.appManifest,
    packManifest: dirArtifact.manifest,
  };
}

function createPortableDirectoryArtifact(
  outputPath: string,
  dirArtifact: CreateDirPackArtifactResult,
): CreatePortablePackArtifactResult {
  const bundledAppDir = join(outputPath, 'app');
  const binDir = join(outputPath, 'bin');
  const embeddedNodeName = process.platform === 'win32' ? 'node.exe' : 'node';
  const embeddedNodePath = join(binDir, embeddedNodeName);
  const launcherName = process.platform === 'win32' ? 'run.cmd' : 'run.sh';
  const launcherPath = join(outputPath, launcherName);

  rmSync(outputPath, { recursive: true, force: true });
  mkdirSync(binDir, { recursive: true });
  cpSync(dirArtifact.outputDir, bundledAppDir, {
    recursive: true,
    force: true,
    dereference: false,
    verbatimSymlinks: true,
  });
  copyFileSync(realpathSync(process.execPath), embeddedNodePath);
  chmodSync(embeddedNodePath, 0o755);

  if (process.platform === 'win32') {
    writeFileSync(
      launcherPath,
      `@echo off
set SCRIPT_DIR=%~dp0
"%SCRIPT_DIR%bin\\node.exe" "%SCRIPT_DIR%app\\launcher.mjs" %*
`,
      'utf-8',
    );
  } else {
    writeFileSync(
      launcherPath,
      `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
exec "$SCRIPT_DIR/bin/${embeddedNodeName}" "$SCRIPT_DIR/app/launcher.mjs" "$@"
`,
      'utf-8',
    );
    chmodSync(launcherPath, 0o755);
  }

  const manifest = buildPortableManifest({
    outputPath,
    bundledAppDir,
    launcherPath,
    embeddedNodePath,
    appManifestPath: join(bundledAppDir, 'edgebase-app.json'),
    packManifestPath: join(bundledAppDir, 'edgebase-pack.json'),
    projectName: dirArtifact.manifest.projectName,
    artifactKind: 'portable-dir',
  });
  const manifestPath = join(outputPath, 'edgebase-portable.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

  return {
    format: 'portable',
    projectDir: dirArtifact.projectDir,
    outputPath,
    manifestPath,
    manifest,
    launcherPath,
    bundledAppDir,
    appManifestPath: join(bundledAppDir, 'edgebase-app.json'),
    packManifestPath: join(bundledAppDir, 'edgebase-pack.json'),
    appManifest: dirArtifact.appManifest,
    packManifest: dirArtifact.manifest,
  };
}

export function createDirPackArtifact(
  projectDir: string,
  options: CreateDirPackArtifactOptions = {},
): CreateDirPackArtifactResult {
  const appBundle = createAppBundle(projectDir, {
    ...options,
    portableDependencies: true,
    dependencyProfile: 'portable',
  });
  finalizePackWrangler(projectDir, appBundle.outputDir);
  const manifest = buildPackManifest(appBundle.outputDir, appBundle.manifest);
  const manifestPath = join(appBundle.outputDir, 'edgebase-pack.json');
  writePackManifest(manifestPath, manifest);
  writeLauncherFiles(appBundle.outputDir, manifest);

  return {
    format: 'dir',
    projectDir: appBundle.projectDir,
    outputDir: appBundle.outputDir,
    manifestPath,
    manifest,
    appManifestPath: appBundle.manifestPath,
    appManifest: appBundle.manifest,
  };
}

export function createPortablePackArtifact(
  projectDir: string,
  options: CreatePortablePackArtifactOptions = {},
): CreatePortablePackArtifactResult {
  const dirArtifact = createDirPackArtifact(projectDir, {
    outputDir: join('.edgebase', 'targets', 'portable-pack-source'),
    overwrite: true,
    portableDependencies: true,
  });
  const outputPath = resolvePortableOutputPath(
    projectDir,
    dirArtifact.manifest.projectName,
    options.outputDir,
  );
  const appName = options.appName ?? basename(outputPath);

  if (process.platform === 'darwin') {
    return createMacPortableArtifact(outputPath, appName, dirArtifact);
  }

  return createPortableDirectoryArtifact(outputPath, dirArtifact);
}

export function createArchivePackArtifact(
  projectDir: string,
  options: CreatePortablePackArtifactOptions = {},
): CreateArchivePackArtifactResult {
  const archiveSourceName = process.platform === 'darwin'
    ? `${sanitizeExecutableName(options.appName ?? basename(projectDir))}.app`
    : `${sanitizeExecutableName(options.appName ?? basename(projectDir))}-${process.platform}-${process.arch}-portable`;
  const sourcePortablePath = resolvePortableOutputPath(
    projectDir,
    sanitizeExecutableName(options.appName ?? basename(projectDir)),
    join('.edgebase', 'targets', archiveSourceName),
  );
  const portableArtifact = createPortablePackArtifact(projectDir, {
    outputDir: sourcePortablePath,
    appName: options.appName,
  });
  const outputPath = resolveArchiveOutputPath(
    projectDir,
    portableArtifact.packManifest.projectName,
    options.outputDir,
  );
  const archiveType = createArchiveFromPortableArtifact(portableArtifact.outputPath, outputPath);
  const manifest = buildArchiveManifest({
    outputPath,
    sourcePortablePath: portableArtifact.outputPath,
    launcherPath: portableArtifact.launcherPath,
    embeddedNodePath: portableArtifact.manifest.embeddedNodePath,
    appManifestPath: portableArtifact.appManifestPath,
    packManifestPath: portableArtifact.packManifestPath,
    projectName: portableArtifact.packManifest.projectName,
    archiveType,
  });

  return {
    format: 'archive',
    projectDir: portableArtifact.projectDir,
    outputPath,
    manifest,
    sourcePortablePath: portableArtifact.outputPath,
    launcherPath: portableArtifact.launcherPath,
    bundledAppDir: portableArtifact.bundledAppDir,
    appManifestPath: portableArtifact.appManifestPath,
    packManifestPath: portableArtifact.packManifestPath,
    appManifest: portableArtifact.appManifest,
    packManifest: portableArtifact.packManifest,
  };
}

function writePackManifest(path: string, manifest: EdgeBasePackManifest): void {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}
