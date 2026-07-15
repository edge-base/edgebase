import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import { describe, expect, it } from 'vitest';
import { npmCommand } from '../src/lib/npm.js';
import { pnpmCommand } from '../src/lib/pnpm.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);
const packageManagerExecOptions = process.platform === 'win32' ? { shell: true as const } : {};
const packagingTestTimeout = process.env.LOCAL_CI === '1' ? 180_000 : 60_000;

interface PackedFile {
  path: string;
}

interface PackResult {
  files: PackedFile[];
}

async function getPackedPaths(): Promise<string[]> {
  await execFileAsync(pnpmCommand(), ['run', 'build'], {
    cwd: packageDir,
    encoding: 'utf-8',
    stdio: 'pipe',
    ...packageManagerExecOptions,
  });

  const { stdout } = await execFileAsync(
    npmCommand(),
    ['pack', '--json', '--dry-run', '--ignore-scripts'],
    {
      cwd: packageDir,
      encoding: 'utf-8',
      stdio: 'pipe',
      ...packageManagerExecOptions,
    },
  );

  const [packResult] = JSON.parse(stdout) as PackResult[];
  return packResult.files.map((file) => file.path);
}

async function buildCli(): Promise<void> {
  await execFileAsync(pnpmCommand(), ['run', 'build'], {
    cwd: packageDir,
    encoding: 'utf-8',
    stdio: 'pipe',
    ...packageManagerExecOptions,
  });
}

describe('cli package tarball', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ships runtime assets without source or test files', async () => {
    const paths = await getPackedPaths();

    expect(paths).toContain('dist/index.js');
    expect(paths).toContain('dist/templates/plugin/README.md.tmpl');
    expect(paths).toContain('dist/templates/plugin/server/src/index.ts.tmpl');
    expect(paths.some((path) => path.startsWith('src/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('test/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('.turbo/'))).toBe(false);
  }, packagingTestTimeout);

  it('runs create-plugin successfully from the built dist entrypoint', async () => {
    await buildCli();

    const workDir = mkdtempSync(join(tmpdir(), 'edgebase-cli-dist-'));
    const homeDir = mkdtempSync(join(tmpdir(), 'edgebase-cli-home-'));
    tempDirs.push(workDir, homeDir);

    await execFileAsync(
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
