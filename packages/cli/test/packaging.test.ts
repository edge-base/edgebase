import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import { describe, expect, it } from 'vitest';
import { npmCommand } from '../src/lib/npm.js';
import { pnpmCommand } from '../src/lib/pnpm.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempDirs: string[] = [];

interface PackedFile {
  path: string;
}

interface PackResult {
  files: PackedFile[];
}

function getPackedPaths(): string[] {
  execFileSync(pnpmCommand(), ['run', 'build'], {
    cwd: packageDir,
    encoding: 'utf-8',
    stdio: 'pipe',
  });

  const output = execFileSync(npmCommand(), ['pack', '--json', '--dry-run', '--ignore-scripts'], {
    cwd: packageDir,
    encoding: 'utf-8',
    stdio: 'pipe',
  });

  const [packResult] = JSON.parse(output) as PackResult[];
  return packResult.files.map((file) => file.path);
}

function buildCli(): void {
  execFileSync(pnpmCommand(), ['run', 'build'], {
    cwd: packageDir,
    encoding: 'utf-8',
    stdio: 'pipe',
  });
}

describe('cli package tarball', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ships runtime assets without source or test files', () => {
    const paths = getPackedPaths();

    expect(paths).toContain('dist/index.js');
    expect(paths).toContain('dist/templates/plugin/README.md.tmpl');
    expect(paths).toContain('dist/templates/plugin/server/src/index.ts.tmpl');
    expect(paths.some((path) => path.startsWith('src/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('test/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('.turbo/'))).toBe(false);
  }, 60000);

  it('runs create-plugin successfully from the built dist entrypoint', () => {
    buildCli();

    const workDir = mkdtempSync(join(tmpdir(), 'edgebase-cli-dist-'));
    const homeDir = mkdtempSync(join(tmpdir(), 'edgebase-cli-home-'));
    tempDirs.push(workDir, homeDir);

    execFileSync(
      process.execPath,
      [
        resolve(packageDir, 'dist', 'index.js'),
        'create-plugin',
        'demo-plugin',
        '--with-client',
        'js',
      ],
      {
        cwd: workDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          CI: '1',
          HOME: homeDir,
          USERPROFILE: homeDir,
          NO_COLOR: '1',
        },
        stdio: 'pipe',
      },
    );

    const pluginDir = join(workDir, 'demo-plugin');
    const serverPackagePath = join(pluginDir, 'server', 'package.json');
    const clientPackagePath = join(pluginDir, 'client', 'js', 'package.json');
    const readmePath = join(pluginDir, 'README.md');

    expect(existsSync(serverPackagePath)).toBe(true);
    expect(existsSync(clientPackagePath)).toBe(true);
    expect(existsSync(readmePath)).toBe(true);

    expect(readFileSync(serverPackagePath, 'utf-8')).toContain('"name": "demo-plugin"');
    expect(readFileSync(clientPackagePath, 'utf-8')).toContain('"name": "demo-plugin-client"');
    expect(readFileSync(readmePath, 'utf-8')).toContain('# demo-plugin');
  });
});
