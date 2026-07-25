/* global process */

import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const RUNTIME_MARKER = '.edgebase-self-host-runtime.json';
const MAX_PROXY_ASSET_BYTES = 2 * 1024 * 1024;

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertPathInside(root, path, label) {
  const rel = relative(root, path);
  if (rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) {
    return;
  }
  throw new Error(`${label} escapes the Wrangler package root.`);
}

function assertRegularFile(path, label, maxBytes = Number.MAX_SAFE_INTEGER) {
  const file = lstatSync(path);
  if (
    !file.isFile()
    || file.isSymbolicLink()
    || file.size < 1
    || file.size > maxBytes
  ) {
    throw new Error(`${label} must be a non-empty regular file.`);
  }
}

function ensurePrivateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const directory = lstatSync(path);
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error(`Self-host Wrangler cache must be a directory: ${path}`);
  }
  chmodSync(path, 0o700);
}

function findWranglerPackageFromBase(baseDir) {
  let cursor = resolve(baseDir);
  while (true) {
    const candidate = join(cursor, 'node_modules', 'wrangler', 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

function resolveCommandPath(command) {
  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return existsSync(command) ? realpathSync(command) : null;
  }
  for (const pathEntry of String(process.env.PATH || '').split(delimiter)) {
    if (!pathEntry) continue;
    const candidate = join(pathEntry, command);
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  return null;
}

function findWranglerPackageFromCommand(command) {
  const commandPath = resolveCommandPath(command);
  if (!commandPath) return null;
  let cursor = dirname(commandPath);
  while (true) {
    const packageJsonPath = join(cursor, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        if (packageJson?.name === 'wrangler') return packageJsonPath;
      } catch {
        // Keep walking; a parent may still be the Wrangler package root.
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

function wranglerBinRelativePath(packageJson) {
  const relativeBin = typeof packageJson.bin === 'string'
    ? packageJson.bin
    : packageJson.bin?.wrangler ?? packageJson.bin?.wrangler2;
  if (!relativeBin) throw new Error('Could not resolve Wrangler bin entry.');
  return relativeBin;
}

function resolveWranglerDependencyRoot(sourcePackageDir) {
  let cursor = sourcePackageDir;
  while (true) {
    const dependencyRoot = join(cursor, 'node_modules');
    if (existsSync(join(dependencyRoot, 'esbuild', 'package.json'))) {
      return realpathSync(dependencyRoot);
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      throw new Error('Could not resolve Wrangler dependency root containing esbuild.');
    }
    cursor = parent;
  }
}

function validatePreparedRuntime({
  runtimeDir,
  fingerprint,
  proxyAssetHash,
  relativeBin,
  dependencyRoot,
}) {
  try {
    const marker = JSON.parse(readFileSync(join(runtimeDir, RUNTIME_MARKER), 'utf8'));
    return marker.fingerprint === fingerprint
      && marker.dependencyRoot === dependencyRoot
      && existsSync(join(runtimeDir, relativeBin))
      && realpathSync(join(runtimeDir, 'node_modules')) === dependencyRoot
      && sha256File(join(runtimeDir, 'wrangler-dist', 'ProxyWorker.js')) === proxyAssetHash;
  } catch {
    return false;
  }
}

export function prepareSelfHostWranglerTool({
  baseDir = process.cwd(),
  cacheRoot,
  proxyWorkerPath,
  wranglerCommand = 'wrangler',
} = {}) {
  if (!cacheRoot) throw new Error('Self-host Wrangler cacheRoot is required.');
  if (!proxyWorkerPath) throw new Error('Self-host proxyWorkerPath is required.');
  assertRegularFile(proxyWorkerPath, 'EdgeBase self-host proxy asset', MAX_PROXY_ASSET_BYTES);

  const packageJsonPath = findWranglerPackageFromBase(baseDir)
    ?? findWranglerPackageFromCommand(wranglerCommand);
  if (!packageJsonPath) {
    throw new Error(
      'Could not locate Wrangler for EdgeBase self-hosting. Install Wrangler 4.x and retry.',
    );
  }

  const sourcePackageDir = realpathSync(dirname(packageJsonPath));
  const dependencyRoot = resolveWranglerDependencyRoot(sourcePackageDir);
  const packageJson = JSON.parse(readFileSync(join(sourcePackageDir, 'package.json'), 'utf8'));
  const version = packageJson.version ?? 'unknown';
  if (!/^4\./.test(version)) {
    throw new Error(`EdgeBase self-host proxy supports Wrangler 4.x; found ${version}.`);
  }

  const relativeBin = wranglerBinRelativePath(packageJson);
  const sourceBin = resolve(sourcePackageDir, relativeBin);
  const sourceCli = join(sourcePackageDir, 'wrangler-dist', 'cli.js');
  const sourceInspectorProxy = join(
    sourcePackageDir,
    'wrangler-dist',
    'InspectorProxyWorker.js',
  );
  const sourceProxy = join(sourcePackageDir, 'wrangler-dist', 'ProxyWorker.js');
  for (const [path, label] of [
    [sourceBin, 'Wrangler bin'],
    [sourceCli, 'Wrangler CLI'],
    [sourceInspectorProxy, 'Wrangler inspector proxy'],
    [sourceProxy, 'Wrangler proxy'],
  ]) {
    assertPathInside(sourcePackageDir, path, label);
    assertRegularFile(path, label);
  }

  const proxyAssetHash = sha256File(proxyWorkerPath);
  const fingerprint = createHash('sha256')
    .update(version)
    .update(sha256File(sourceBin))
    .update(sha256File(sourceCli))
    .update(sha256File(sourceInspectorProxy))
    .update(sha256File(sourceProxy))
    .update(proxyAssetHash)
    .update(dependencyRoot)
    .digest('hex');
  const safeVersion = version.replace(/[^A-Za-z0-9._-]/g, '_');
  const runtimeDir = join(cacheRoot, `${safeVersion}-${fingerprint.slice(0, 16)}`);

  ensurePrivateDirectory(cacheRoot);
  if (!existsSync(runtimeDir)) {
    const temporaryDir = mkdtempSync(join(cacheRoot, '.prepare-'));
    try {
      const sourceNodeModules = join(sourcePackageDir, 'node_modules');
      cpSync(sourcePackageDir, temporaryDir, {
        recursive: true,
        force: false,
        errorOnExist: true,
        filter: (source) => source !== sourceNodeModules,
      });
      copyFileSync(proxyWorkerPath, join(temporaryDir, 'wrangler-dist', 'ProxyWorker.js'));
      rmSync(join(temporaryDir, 'node_modules'), { recursive: true, force: true });
      symlinkSync(dependencyRoot, join(temporaryDir, 'node_modules'), 'dir');
      writeFileSync(
        join(temporaryDir, RUNTIME_MARKER),
        `${JSON.stringify({ dependencyRoot, fingerprint, version })}\n`,
        { mode: 0o600 },
      );
      try {
        renameSync(temporaryDir, runtimeDir);
      } catch (error) {
        if (!existsSync(runtimeDir)) throw error;
      }
    } finally {
      rmSync(temporaryDir, { recursive: true, force: true });
    }
  }

  if (!validatePreparedRuntime({
    runtimeDir,
    fingerprint,
    proxyAssetHash,
    relativeBin,
    dependencyRoot,
  })) {
    throw new Error(
      `EdgeBase self-host Wrangler runtime failed integrity validation: ${runtimeDir}`,
    );
  }

  return {
    command: process.execPath,
    argsPrefix: [join(runtimeDir, relativeBin)],
    runtimeDir,
  };
}
