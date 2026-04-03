import { describe, expect, it } from 'vitest';
import { __runtimeScaffoldTestUtils } from '../src/lib/runtime-scaffold.js';

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
});
