import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { __runtimeScaffoldTestUtils } from '../src/lib/runtime-scaffold.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

describe('runtime scaffold path utilities', () => {
  it('detects Windows-style nested pnpm paths inside a candidate root', () => {
    const candidateRoot = 'C:\\repo\\packages\\server\\node_modules';
    const packagePath = 'C:\\repo\\packages\\server\\node_modules\\.pnpm\\wrangler@4.40.2\\node_modules\\wrangler';

    expect(__runtimeScaffoldTestUtils.findContainingRoot(packagePath, [candidateRoot])).toBe(candidateRoot);
    expect(
      __runtimeScaffoldTestUtils.getRelativePathSegmentsWithinRoot(candidateRoot, packagePath),
    ).toEqual(['.pnpm', 'wrangler@4.40.2', 'node_modules', 'wrangler']);
  });

  it('materializes pnpm package roots correctly for Windows-style paths', () => {
    const sourceRoot = 'C:\\repo\\packages\\server\\node_modules';
    const sourcePath = 'C:\\repo\\packages\\server\\node_modules\\.pnpm\\wrangler@4.40.2\\node_modules\\wrangler';
    const targetRoot = 'D:\\bundle\\node_modules';

    const materialization = __runtimeScaffoldTestUtils.getNodeModulesMaterialization(
      sourcePath,
      sourceRoot,
      targetRoot,
    );

    expect(normalizePath(materialization.sourceRoot)).toBe(
      'C:/repo/packages/server/node_modules/.pnpm/wrangler@4.40.2',
    );
    expect(normalizePath(materialization.targetRoot)).toBe(
      'D:/bundle/node_modules/.pnpm/wrangler@4.40.2',
    );
    expect(normalizePath(materialization.targetPath)).toBe(
      'D:/bundle/node_modules/.pnpm/wrangler@4.40.2/node_modules/wrangler',
    );
  });

  it('uses absolute junction targets for Windows-style materialized links', () => {
    const linkPath = 'D:\\bundle\\node_modules\\.pnpm\\wrangler@4.40.2\\node_modules\\miniflare';
    const destinationPath = 'D:\\bundle\\node_modules\\.pnpm\\miniflare@4.40.2\\node_modules\\miniflare';

    expect(normalizePath(
      __runtimeScaffoldTestUtils.buildDirectoryLinkTarget(linkPath, destinationPath, 'win32'),
    )).toBe('D:/bundle/node_modules/.pnpm/miniflare@4.40.2/node_modules/miniflare');
  });

  it('uses relative symlink targets for POSIX materialized links', () => {
    const linkPath = '/bundle/node_modules/.pnpm/wrangler@4.40.2/node_modules/miniflare';
    const destinationPath = '/bundle/node_modules/.pnpm/miniflare@4.40.2/node_modules/miniflare';

    expect(
      __runtimeScaffoldTestUtils.buildDirectoryLinkTarget(linkPath, destinationPath, 'darwin'),
    ).toBe('../../miniflare@4.40.2/node_modules/miniflare');
  });

  it('resolves package directories from pnpm package stores when no top-level entry exists', () => {
    const candidateRoot = mkdtempSync(join(tmpdir(), 'edgebase-runtime-scaffold-'));
    tempDirs.push(candidateRoot);

    const packageDir = join(
      candidateRoot,
      '.pnpm',
      'unenv@2.0.0-rc.24',
      'node_modules',
      'unenv',
    );
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: 'unenv', version: '2.0.0-rc.24' }),
      'utf-8',
    );

    expect(
      __runtimeScaffoldTestUtils.resolvePackageDirectoryPath('unenv', [candidateRoot]),
    ).toBe(resolve(packageDir));
  });
});
