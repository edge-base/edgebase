import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

  it('follows a parent package resolution when multiple pnpm store versions exist', () => {
    const candidateRoot = mkdtempSync(join(tmpdir(), 'edgebase-runtime-scaffold-'));
    tempDirs.push(candidateRoot);

    const wranglerDir = join(
      candidateRoot,
      '.pnpm',
      'wrangler@4.70.0',
      'node_modules',
      'wrangler',
    );
    const miniflarePreferredDir = join(
      candidateRoot,
      '.pnpm',
      'miniflare@4.20260301.1',
      'node_modules',
      'miniflare',
    );
    const miniflareStaleDir = join(
      candidateRoot,
      '.pnpm',
      'miniflare@4.20250906.0',
      'node_modules',
      'miniflare',
    );
    const zodDir = join(candidateRoot, '.pnpm', 'zod@4.3.6', 'node_modules', 'zod');

    mkdirSync(join(wranglerDir, 'node_modules'), { recursive: true });
    mkdirSync(miniflarePreferredDir, { recursive: true });
    mkdirSync(miniflareStaleDir, { recursive: true });
    mkdirSync(zodDir, { recursive: true });

    writeFileSync(
      join(wranglerDir, 'package.json'),
      JSON.stringify({ name: 'wrangler', version: '4.70.0', dependencies: { miniflare: '4.20260301.1' } }),
      'utf-8',
    );
    writeFileSync(
      join(miniflarePreferredDir, 'package.json'),
      JSON.stringify({ name: 'miniflare', version: '4.20260301.1' }),
      'utf-8',
    );
    writeFileSync(
      join(miniflareStaleDir, 'package.json'),
      JSON.stringify({ name: 'miniflare', version: '4.20250906.0', dependencies: { zod: '3.22.3' } }),
      'utf-8',
    );
    writeFileSync(
      join(zodDir, 'package.json'),
      JSON.stringify({ name: 'zod', version: '4.3.6' }),
      'utf-8',
    );

    symlinkSync(resolve(wranglerDir), join(candidateRoot, 'wrangler'), 'dir');
    symlinkSync(resolve(zodDir), join(candidateRoot, 'zod'), 'dir');
    symlinkSync(resolve(miniflarePreferredDir), join(wranglerDir, 'node_modules', 'miniflare'), 'dir');

    const selections = __runtimeScaffoldTestUtils.resolveRuntimePackageSelections(
      ['wrangler', 'zod'],
      [candidateRoot],
    );
    const miniflareSelection = selections.find((selection) => selection.packageName === 'miniflare');

    expect(miniflareSelection?.packageDir).toBe(realpathSync(miniflarePreferredDir));
  });

  it('preserves the CLI wrangler dependency graph when an older server wrangler also exists', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'edgebase-runtime-scaffold-'));
    tempDirs.push(fixtureRoot);

    const serverRoot = join(fixtureRoot, 'server-node_modules');
    const cliRoot = join(fixtureRoot, 'cli-node_modules');
    const serverWranglerDir = join(serverRoot, '.pnpm', 'wrangler@4.70.0-server', 'node_modules', 'wrangler');
    const cliWranglerDir = join(cliRoot, '.pnpm', 'wrangler@4.70.0-cli', 'node_modules', 'wrangler');
    const serverMiniflareDir = join(serverRoot, '.pnpm', 'miniflare@4.20250906.0', 'node_modules', 'miniflare');
    const cliMiniflareDir = join(cliRoot, '.pnpm', 'miniflare@4.20260301.1', 'node_modules', 'miniflare');

    mkdirSync(join(dirname(serverWranglerDir), 'wrangler'), { recursive: true });
    mkdirSync(join(dirname(cliWranglerDir), 'wrangler'), { recursive: true });
    mkdirSync(serverMiniflareDir, { recursive: true });
    mkdirSync(cliMiniflareDir, { recursive: true });

    writeFileSync(
      join(serverWranglerDir, 'package.json'),
      JSON.stringify({ name: 'wrangler', version: '4.70.0', dependencies: { miniflare: '4.20250906.0' } }),
      'utf-8',
    );
    writeFileSync(
      join(cliWranglerDir, 'package.json'),
      JSON.stringify({ name: 'wrangler', version: '4.70.0', dependencies: { miniflare: '4.20260301.1' } }),
      'utf-8',
    );
    writeFileSync(
      join(serverMiniflareDir, 'package.json'),
      JSON.stringify({ name: 'miniflare', version: '4.20250906.0' }),
      'utf-8',
    );
    writeFileSync(
      join(cliMiniflareDir, 'package.json'),
      JSON.stringify({ name: 'miniflare', version: '4.20260301.1' }),
      'utf-8',
    );

    symlinkSync(resolve(serverWranglerDir), join(serverRoot, 'wrangler'), 'dir');
    symlinkSync(resolve(cliWranglerDir), join(cliRoot, 'wrangler'), 'dir');
    symlinkSync(resolve(serverMiniflareDir), join(dirname(serverWranglerDir), 'miniflare'), 'dir');
    symlinkSync(resolve(cliMiniflareDir), join(dirname(cliWranglerDir), 'miniflare'), 'dir');

    const wranglerSelection = __runtimeScaffoldTestUtils.resolvePackageSelectionFromManifestCandidates(
      'wrangler',
      [join(cliWranglerDir, 'package.json'), join(serverWranglerDir, 'package.json')],
    );
    expect(wranglerSelection?.packageDir).toBe(realpathSync(cliWranglerDir));

    const selections = __runtimeScaffoldTestUtils.resolveRuntimePackageSelectionsFromInitialSelections(
      [wranglerSelection!],
      [serverRoot, cliRoot],
    );
    const miniflareSelection = selections.find((selection) => selection.packageName === 'miniflare');

    expect(miniflareSelection?.packageDir).toBe(realpathSync(cliMiniflareDir));
  });

  it('realpaths symlink manifest candidates before resolving portable wrangler dependencies', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'edgebase-runtime-scaffold-'));
    tempDirs.push(fixtureRoot);

    const cliRoot = join(fixtureRoot, 'cli-node_modules');
    const cliWranglerDir = join(cliRoot, '.pnpm', 'wrangler@4.70.0-cli', 'node_modules', 'wrangler');
    const cliMiniflareDir = join(cliRoot, '.pnpm', 'miniflare@4.20260301.1', 'node_modules', 'miniflare');

    mkdirSync(cliWranglerDir, { recursive: true });
    mkdirSync(cliMiniflareDir, { recursive: true });

    writeFileSync(
      join(cliWranglerDir, 'package.json'),
      JSON.stringify({ name: 'wrangler', version: '4.70.0', dependencies: { miniflare: '4.20260301.1' } }),
      'utf-8',
    );
    writeFileSync(
      join(cliMiniflareDir, 'package.json'),
      JSON.stringify({ name: 'miniflare', version: '4.20260301.1' }),
      'utf-8',
    );

    symlinkSync(resolve(cliWranglerDir), join(cliRoot, 'wrangler'), 'dir');
    symlinkSync(resolve(cliMiniflareDir), join(dirname(cliWranglerDir), 'miniflare'), 'dir');

    const wranglerSelection = __runtimeScaffoldTestUtils.resolvePackageSelectionFromManifestCandidates(
      'wrangler',
      [join(cliRoot, 'wrangler', 'package.json')],
    );

    expect(wranglerSelection?.manifestPath).toBe(realpathSync(join(cliWranglerDir, 'package.json')));
    expect(wranglerSelection?.packageDir).toBe(realpathSync(cliWranglerDir));

    const selections = __runtimeScaffoldTestUtils.resolveRuntimePackageSelectionsFromInitialSelections(
      [wranglerSelection!],
      [cliRoot],
    );
    const miniflareSelection = selections.find((selection) => selection.packageName === 'miniflare');

    expect(miniflareSelection?.manifestPath).toBe(realpathSync(join(cliMiniflareDir, 'package.json')));
    expect(miniflareSelection?.packageDir).toBe(realpathSync(cliMiniflareDir));
  });
});
