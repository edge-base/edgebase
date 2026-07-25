import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const moduleDir = dirname(fileURLToPath(import.meta.url));

interface WranglerPackageJson {
  bin?: string | Record<string, string>;
  version?: string;
}

export interface PreparedWranglerDevTool {
  command: string;
  argsPrefix: string[];
  runtimeDir: string;
}

const EDGEBASE_DEV_PROXY_ASSET = resolve(
  moduleDir,
  '..',
  'templates',
  'edgebase-dev-proxy-worker.js',
);
const EDGEBASE_DEV_RUNTIME_MARKER = '.edgebase-dev-runtime.json';

function normalizeWranglerArgs(args: string[]): string[] {
  return args[0] === 'wrangler' ? args.slice(1) : args;
}

function findWranglerPackageJsonFrom(baseDir: string): string | null {
  let cursor = resolve(baseDir);

  while (true) {
    const direct = join(cursor, 'node_modules', 'wrangler', 'package.json');
    if (existsSync(direct)) {
      return direct;
    }

    const pnpmDir = join(cursor, 'node_modules', '.pnpm');
    if (existsSync(pnpmDir)) {
      const candidate = readdirSync(pnpmDir)
        .filter((entry) => entry.startsWith('wrangler@'))
        .map((entry) => join(pnpmDir, entry, 'node_modules', 'wrangler', 'package.json'))
        .find((entry) => existsSync(entry));
      if (candidate) {
        return candidate;
      }
    }

    const parent = dirname(cursor);
    if (parent === cursor) {
      return null;
    }
    cursor = parent;
  }
}

function resolveWranglerPackageJson(baseDir = process.cwd()): string | null {
  return findWranglerPackageJsonFrom(baseDir)
    ?? (() => {
      try {
        return require.resolve('wrangler/package.json');
      } catch {
        return findWranglerPackageJsonFrom(moduleDir);
      }
    })();
}

function wranglerBinRelativePath(packageJson: WranglerPackageJson): string {
  const relBin = typeof packageJson.bin === 'string'
    ? packageJson.bin
    : packageJson.bin?.wrangler ?? packageJson.bin?.wrangler2;
  if (!relBin) throw new Error('Could not resolve Wrangler bin entry.');
  return relBin;
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertPathInside(root: string, path: string, label: string): void {
  const rel = relative(root, path);
  if (rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) {
    return;
  }
  throw new Error(`${label} escapes the Wrangler package root.`);
}

function validatePreparedRuntime(
  runtimeDir: string,
  fingerprint: string,
  proxyAssetHash: string,
  relBin: string,
  dependencyRoot: string,
): boolean {
  try {
    const marker = JSON.parse(
      readFileSync(join(runtimeDir, EDGEBASE_DEV_RUNTIME_MARKER), 'utf8'),
    ) as { dependencyRoot?: string; fingerprint?: string };
    return (
      marker.fingerprint === fingerprint
      && marker.dependencyRoot === dependencyRoot
      && existsSync(join(runtimeDir, relBin))
      && realpathSync(join(runtimeDir, 'node_modules')) === dependencyRoot
      && sha256File(join(runtimeDir, 'wrangler-dist', 'ProxyWorker.js')) === proxyAssetHash
    );
  } catch {
    return false;
  }
}

export function prepareWranglerDevTool(
  baseDir = process.cwd(),
  cacheRoot = join(baseDir, '.edgebase', 'dev', 'wrangler-runtime'),
): PreparedWranglerDevTool {
  const packageJsonPath = resolveWranglerPackageJson(baseDir);
  if (!packageJsonPath) {
    throw new Error(
      'Could not locate Wrangler for EdgeBase development. Install dependencies and retry.',
    );
  }
  if (!existsSync(EDGEBASE_DEV_PROXY_ASSET)) {
    throw new Error(`EdgeBase development proxy asset is missing: ${EDGEBASE_DEV_PROXY_ASSET}`);
  }

  const sourcePackageDir = realpathSync(dirname(packageJsonPath));
  const dependencyRoot = realpathSync(dirname(sourcePackageDir));
  const packageJson = JSON.parse(
    readFileSync(join(sourcePackageDir, 'package.json'), 'utf8'),
  ) as WranglerPackageJson;
  const version = packageJson.version ?? 'unknown';
  if (!/^4\./.test(version)) {
    throw new Error(
      `EdgeBase development proxy supports Wrangler 4.x; found ${version}.`,
    );
  }

  const relBin = wranglerBinRelativePath(packageJson);
  const sourceBin = resolve(sourcePackageDir, relBin);
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
  ] as const) {
    assertPathInside(sourcePackageDir, path, label);
    if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  }

  const proxyAssetHash = sha256File(EDGEBASE_DEV_PROXY_ASSET);
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

  if (!existsSync(runtimeDir)) {
    mkdirSync(cacheRoot, { recursive: true });
    const tempDir = mkdtempSync(join(cacheRoot, '.prepare-'));
    try {
      cpSync(sourcePackageDir, tempDir, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      copyFileSync(
        EDGEBASE_DEV_PROXY_ASSET,
        join(tempDir, 'wrangler-dist', 'ProxyWorker.js'),
      );
      rmSync(join(tempDir, 'node_modules'), { recursive: true, force: true });
      symlinkSync(dependencyRoot, join(tempDir, 'node_modules'), 'dir');
      writeFileSync(
        join(tempDir, EDGEBASE_DEV_RUNTIME_MARKER),
        `${JSON.stringify({ dependencyRoot, fingerprint, version })}\n`,
        { mode: 0o600 },
      );
      try {
        renameSync(tempDir, runtimeDir);
      } catch (error) {
        if (!existsSync(runtimeDir)) throw error;
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  if (!validatePreparedRuntime(
    runtimeDir,
    fingerprint,
    proxyAssetHash,
    relBin,
    dependencyRoot,
  )) {
    throw new Error(
      `EdgeBase development Wrangler runtime failed integrity validation: ${runtimeDir}`,
    );
  }

  return {
    command: process.execPath,
    argsPrefix: [join(runtimeDir, relBin)],
    runtimeDir,
  };
}

export function resolveWranglerBinPath(baseDir = process.cwd()): string {
  const packageJsonPath = resolveWranglerPackageJson(baseDir);
  if (!packageJsonPath) {
    throw new Error('Could not locate wrangler/package.json in this workspace.');
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as WranglerPackageJson;
  return resolve(dirname(packageJsonPath), wranglerBinRelativePath(packageJson));
}

export function resolveWranglerTool(
  baseDir = process.cwd(),
): { command: string; argsPrefix: string[] } {
  const packageJsonPath = resolveWranglerPackageJson(baseDir);
  if (!packageJsonPath) {
    return {
      command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
      argsPrefix: ['wrangler'],
    };
  }

  return {
    command: process.execPath,
    argsPrefix: [resolveWranglerBinPath(baseDir)],
  };
}

function resolveWranglerBin(): string {
  return resolveWranglerBinPath(process.cwd());
}

export function wranglerCommand(): string {
  return process.execPath;
}

export function wranglerArgs(args: string[]): string[] {
  return [resolveWranglerBin(), ...normalizeWranglerArgs(args)];
}

export function wranglerHint(args: string[]): string {
  return `${wranglerCommand()} ${wranglerArgs(args).join(' ')}`;
}
