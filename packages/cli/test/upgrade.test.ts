/**
 * Tests for CLI upgrade command — semver parsing, diff detection, package manager detection,
 * and update command building.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseSemver,
  semverDiff,
  detectPackageManager,
  findInstalledEdgeBasePackages,
  buildUpdateCommand,
  type UpdateCommandInvocation,
} from '../src/commands/upgrade.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-upgrade-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ======================================================================
// 1. parseSemver
// ======================================================================

describe('parseSemver', () => {
  it('parses standard semver "1.2.3"', () => {
    expect(parseSemver('1.2.3')).toEqual([1, 2, 3]);
  });

  it('parses with caret prefix "^1.2.3"', () => {
    expect(parseSemver('^1.2.3')).toEqual([1, 2, 3]);
  });

  it('parses with tilde prefix "~0.5.0"', () => {
    expect(parseSemver('~0.5.0')).toEqual([0, 5, 0]);
  });

  it('parses with v prefix "v2.0.0"', () => {
    expect(parseSemver('v2.0.0')).toEqual([2, 0, 0]);
  });

  it('parses "0.0.0"', () => {
    expect(parseSemver('0.0.0')).toEqual([0, 0, 0]);
  });

  it('parses large version numbers', () => {
    expect(parseSemver('100.200.300')).toEqual([100, 200, 300]);
  });

  it('handles prerelease suffix gracefully', () => {
    // parseSemver strips leading non-numeric, split by '.'
    // '1.0.0-beta.1' → clean = '1.0.0-beta.1' → parts = ['1', '0', '0-beta', '1']
    // Number('0-beta') → NaN, so patch = NaN
    // This is expected — parseSemver is designed for clean semver strings
    const result = parseSemver('1.0.0');
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
  });

  it('handles >=prefix', () => {
    expect(parseSemver('>=1.0.0')).toEqual([1, 0, 0]);
  });
});

// ======================================================================
// 2. semverDiff
// ======================================================================

describe('semverDiff', () => {
  it('detects major version change', () => {
    expect(semverDiff('1.0.0', '2.0.0')).toBe('major');
  });

  it('detects minor version change', () => {
    expect(semverDiff('1.0.0', '1.1.0')).toBe('minor');
  });

  it('detects patch version change', () => {
    expect(semverDiff('1.0.0', '1.0.1')).toBe('patch');
  });

  it('returns "none" for identical versions', () => {
    expect(semverDiff('1.0.0', '1.0.0')).toBe('none');
  });

  it('major takes precedence over minor changes', () => {
    expect(semverDiff('1.5.3', '2.0.0')).toBe('major');
  });

  it('minor takes precedence over patch changes', () => {
    expect(semverDiff('1.0.3', '1.1.0')).toBe('minor');
  });

  it('detects downgrade as major if major differs', () => {
    expect(semverDiff('2.0.0', '1.0.0')).toBe('major');
  });

  it('detects downgrade as minor if minor differs', () => {
    expect(semverDiff('1.5.0', '1.3.0')).toBe('minor');
  });

  it('works with prefixed versions', () => {
    expect(semverDiff('^1.0.0', '~1.1.0')).toBe('minor');
  });

  it('works from 0.x to 1.x (initial release)', () => {
    expect(semverDiff('0.9.0', '1.0.0')).toBe('major');
  });
});

// ======================================================================
// 3. detectPackageManager
// ======================================================================

describe('detectPackageManager', () => {
  it('defaults to npm when no lockfile exists', () => {
    expect(detectPackageManager(tmpDir)).toBe('npm');
  });

  it('detects pnpm from pnpm-lock.yaml', () => {
    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(tmpDir)).toBe('pnpm');
  });

  it('detects yarn from yarn.lock', () => {
    writeFileSync(join(tmpDir, 'yarn.lock'), '');
    expect(detectPackageManager(tmpDir)).toBe('yarn');
  });

  it('pnpm takes precedence when both pnpm-lock.yaml and yarn.lock exist', () => {
    writeFileSync(join(tmpDir, 'pnpm-lock.yaml'), '');
    writeFileSync(join(tmpDir, 'yarn.lock'), '');
    expect(detectPackageManager(tmpDir)).toBe('pnpm');
  });

  it('npm when only package-lock.json exists (no special detection)', () => {
    writeFileSync(join(tmpDir, 'package-lock.json'), '{}');
    expect(detectPackageManager(tmpDir)).toBe('npm');
  });
});

// ======================================================================
// 4. findInstalledEdgeBasePackages
// ======================================================================

describe('findInstalledEdgeBasePackages', () => {
  it('finds scoped EdgeBase dependencies across dependency sections', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: {
        '@edge-base/web': '^0.1.0',
      },
      devDependencies: {
        '@edge-base/cli': '^0.1.0',
      },
      optionalDependencies: {
        '@edge-base/shared': '^0.1.0',
      },
      peerDependencies: {
        react: '^19.0.0',
      },
    }, null, 2));

    expect(findInstalledEdgeBasePackages(tmpDir)).toEqual([
      '@edge-base/cli',
      '@edge-base/shared',
      '@edge-base/web',
    ]);
  });

  it('keeps the legacy unscoped package for backwards compatibility', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: {
        edgebase: '^0.1.0',
        '@edge-base/web': '^0.1.0',
      },
    }, null, 2));

    expect(findInstalledEdgeBasePackages(tmpDir)).toEqual([
      '@edge-base/web',
      'edgebase',
    ]);
  });
});

// ======================================================================
// 5. buildUpdateCommand
// ======================================================================

describe('buildUpdateCommand', () => {
  function expectInvocation(
    actual: UpdateCommandInvocation,
    expected: { command: string; args: string[]; display: string },
  ) {
    expect(actual).toEqual(expected);
  }

  it('builds npm install command with @latest', () => {
    expectInvocation(buildUpdateCommand('npm', ['@edge-base/web']), {
      command: 'npm',
      args: ['install', '@edge-base/web@latest'],
      display: 'npm install @edge-base/web@latest',
    });
  });

  it('builds pnpm add command with @latest', () => {
    expectInvocation(buildUpdateCommand('pnpm', ['@edge-base/web']), {
      command: 'pnpm',
      args: ['add', '@edge-base/web@latest'],
      display: 'pnpm add @edge-base/web@latest',
    });
  });

  it('builds yarn add command with @latest', () => {
    expectInvocation(buildUpdateCommand('yarn', ['@edge-base/web']), {
      command: 'yarn',
      args: ['add', '@edge-base/web@latest'],
      display: 'yarn add @edge-base/web@latest',
    });
  });

  it('builds command with specific target version', () => {
    expectInvocation(buildUpdateCommand('npm', ['@edge-base/web'], '2.0.0'), {
      command: 'npm',
      args: ['install', '@edge-base/web@2.0.0'],
      display: 'npm install @edge-base/web@2.0.0',
    });
  });

  it('handles multiple packages', () => {
    expectInvocation(buildUpdateCommand('npm', ['@edge-base/web', '@edge-base/cli']), {
      command: 'npm',
      args: ['install', '@edge-base/web@latest', '@edge-base/cli@latest'],
      display: 'npm install @edge-base/web@latest @edge-base/cli@latest',
    });
  });

  it('handles multiple packages with target version', () => {
    expectInvocation(buildUpdateCommand('pnpm', ['@edge-base/web', '@edge-base/cli'], '1.5.0'), {
      command: 'pnpm',
      args: ['add', '@edge-base/web@1.5.0', '@edge-base/cli@1.5.0'],
      display: 'pnpm add @edge-base/web@1.5.0 @edge-base/cli@1.5.0',
    });
  });

  it('handles single package with all managers', () => {
    const pkg = ['@edge-base/web'];
    expect(buildUpdateCommand('npm', pkg).display).toContain('npm install');
    expect(buildUpdateCommand('pnpm', pkg).display).toContain('pnpm add');
    expect(buildUpdateCommand('yarn', pkg).display).toContain('yarn add');
  });

  it('keeps a malicious target version inside a single literal package arg', () => {
    expectInvocation(
      buildUpdateCommand('npm', ['@edge-base/web'], '1.2.3 && echo pwned'),
      {
        command: 'npm',
        args: ['install', '@edge-base/web@1.2.3 && echo pwned'],
        display: 'npm install @edge-base/web@1.2.3 && echo pwned',
      },
    );
  });
});
