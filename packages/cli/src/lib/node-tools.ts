import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { npxCommand } from './npx.js';

const require = createRequire(import.meta.url);

interface ResolvedToolCommand {
  command: string;
  argsPrefix: string[];
}

export function resolveTsxCommand(): ResolvedToolCommand {
  try {
    const entry = require.resolve('tsx/cli');
    return { command: process.execPath, argsPrefix: [entry] };
  } catch {
    return { command: npxCommand(), argsPrefix: ['tsx'] };
  }
}

export function execTsxSync(
  args: string[],
  options: ExecFileSyncOptionsWithStringEncoding,
): string {
  const resolved = resolveTsxCommand();
  return execFileSync(
    resolved.command,
    [...resolved.argsPrefix, ...args],
    options,
  );
}

export function buildBundleWithEsbuild(
  entryPoint: string,
  outfile: string,
  cwd: string,
  options?: { external?: string[] },
): void {
  buildSync({
    absWorkingDir: cwd,
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'esnext',
    external: options?.external ?? ['node:*'],
    logLevel: 'silent',
  });
}
