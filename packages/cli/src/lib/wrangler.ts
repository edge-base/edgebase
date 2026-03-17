import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const moduleDir = dirname(fileURLToPath(import.meta.url));

interface WranglerPackageJson {
  bin?: string | Record<string, string>;
}

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

export function resolveWranglerBinPath(baseDir = process.cwd()): string {
  const packageJsonPath = resolveWranglerPackageJson(baseDir);
  if (!packageJsonPath) {
    throw new Error('Could not locate wrangler/package.json in this workspace.');
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as WranglerPackageJson;
  const relBin = typeof packageJson.bin === 'string'
    ? packageJson.bin
    : packageJson.bin?.wrangler ?? packageJson.bin?.wrangler2;

  if (!relBin) {
    throw new Error('Could not resolve Wrangler bin entry.');
  }

  return resolve(dirname(packageJsonPath), relBin);
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
