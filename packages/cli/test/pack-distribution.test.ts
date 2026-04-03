import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createArchiveFromPortableArtifact } from '../src/lib/pack.js';
import { resolveTsxCommand } from '../src/lib/node-tools.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsxCommand = resolveTsxCommand();
const tsxExecOptions = /\.cmd$/i.test(tsxCommand.command) ? { shell: true as const } : {};
const tempDirs: string[] = [];
const appDataDirs: string[] = [];

function createTempProject(name: string): string {
  const dir = join(tmpdir(), `edgebase-pack-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function runPack(projectDir: string, outputDirName: string, options?: { format?: 'portable'; appName?: string }) {
  const args = [
    ...tsxCommand.argsPrefix,
    resolve(packageDir, 'src', 'index.ts'),
    '--json',
    'pack',
  ];
  if (options?.format) {
    args.push('--format', options.format);
  }
  if (options?.appName) {
    args.push('--app-name', options.appName);
  }
  args.push('--output', outputDirName);

  return spawnSync(
    tsxCommand.command,
    args,
    {
      cwd: projectDir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        NO_COLOR: '1',
      },
      stdio: 'pipe',
      ...tsxExecOptions,
    },
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of appDataDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);

function resolveAppDataRoot(appDataDirName: string): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', appDataDirName);
  }
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), appDataDirName);
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), appDataDirName);
}

function createFakePortableArtifact(projectDir: string): string {
  if (process.platform === 'darwin') {
    const appRoot = join(projectDir, 'Portable-Test.app');
    mkdirSync(join(appRoot, 'Contents', 'MacOS'), { recursive: true });
    mkdirSync(join(appRoot, 'Contents', 'Resources', 'app'), { recursive: true });
    writeFileSync(join(appRoot, 'Contents', 'MacOS', 'Portable-Test'), '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(join(appRoot, 'Contents', 'Resources', 'app', 'edgebase-pack.json'), '{}\n');
    return appRoot;
  }

  const portableRoot = join(projectDir, 'portable-test');
  mkdirSync(join(portableRoot, 'app'), { recursive: true });
  writeFileSync(join(portableRoot, process.platform === 'win32' ? 'run.cmd' : 'run.sh'), 'echo ok\n');
  writeFileSync(join(portableRoot, 'app', 'edgebase-pack.json'), '{}\n');
  return portableRoot;
}

describe('pack distribution formats', () => {
  it('creates a current-platform portable artifact with an embedded launcher', { timeout: 120_000 }, () => {
    const projectDir = createTempProject('portable');
    mkdirSync(join(projectDir, 'functions'), { recursive: true });

    writeFileSync(
      join(projectDir, 'edgebase.config.ts'),
      `import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  databases: {
    shared: {
      tables: {},
    },
  },
});
`,
    );
    writeFileSync(join(projectDir, 'functions', 'health.ts'), 'export default async () => new Response("ok");\n');

    const outputName = process.platform === 'darwin' ? 'Portable Test.app' : 'portable-test';
    const result = runPack(projectDir, outputName, {
      format: 'portable',
      appName: 'Portable Test',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const payload = JSON.parse(result.stdout) as {
      status: string;
      format: 'portable';
      outputPath: string;
      launcherPath: string;
      bundledAppDir: string;
      manifest: {
        artifactKind: 'macos-app' | 'portable-dir';
        embeddedNodePath: string;
      };
      packManifest: {
        launcher: {
          defaultOpenPath: string;
          defaultPort: number;
          appDataDirName: string;
          stateDir: string;
          runtimeDir: string;
        };
      };
    };

    expect(payload.status).toBe('success');
    expect(payload.format).toBe('portable');
    expect(payload.packManifest.launcher.defaultOpenPath).toBe('/admin');
    const appDataRoot = resolveAppDataRoot(payload.packManifest.launcher.appDataDirName);
    appDataDirs.push(appDataRoot);

    if (process.platform === 'darwin') {
      const appRoot = realpathSync(join(projectDir, 'Portable Test.app'));
      expect(payload.outputPath).toBe(appRoot);
      expect(payload.manifest.artifactKind).toBe('macos-app');
      expect(existsSync(join(appRoot, 'Contents', 'Info.plist'))).toBe(true);
      expect(existsSync(join(appRoot, 'Contents', 'MacOS', 'Portable-Test'))).toBe(true);
      expect(existsSync(join(appRoot, 'Contents', 'MacOS', 'node'))).toBe(true);
      expect(existsSync(join(appRoot, 'Contents', 'Resources', 'app', 'edgebase-pack.json'))).toBe(true);

      const dryRun = spawnSync(
        join(appRoot, 'Contents', 'MacOS', 'Portable-Test'),
        ['--dry-run', '--json'],
        {
          cwd: appRoot,
          encoding: 'utf-8',
        },
      );

      expect(dryRun.status).toBe(0);
      const launchPlan = JSON.parse(dryRun.stdout) as { openUrl: string; persistDir: string; wranglerArgs: string[] };
      expect(launchPlan.openUrl).toBe(`http://127.0.0.1:${payload.packManifest.launcher.defaultPort}/admin`);
      expect(launchPlan.persistDir).toBe(join(appDataRoot, payload.packManifest.launcher.stateDir));
      expect(launchPlan.wranglerArgs).toEqual(expect.arrayContaining([
        '--config',
        realpathSync(join(appRoot, 'Contents', 'Resources', 'app', 'wrangler.toml')),
      ]));
      return;
    }

    const portableRoot = realpathSync(join(projectDir, outputName));
    expect(payload.outputPath).toBe(portableRoot);
    expect(payload.manifest.artifactKind).toBe('portable-dir');
    expect(existsSync(join(portableRoot, 'bin'))).toBe(true);
    expect(existsSync(join(portableRoot, 'app', 'edgebase-pack.json'))).toBe(true);
  });

  it('creates a current-platform archive artifact for single-file distribution', { timeout: 120_000 }, () => {
    const projectDir = createTempProject('archive');
    const outputName = process.platform === 'linux' ? 'portable-test.tar.gz' : 'portable-test.zip';
    const portableArtifactPath = createFakePortableArtifact(projectDir);
    const requestedArchivePath = join(projectDir, outputName);
    const archiveType = createArchiveFromPortableArtifact(portableArtifactPath, requestedArchivePath);
    const archivePath = realpathSync(requestedArchivePath);

    const extractDir = createTempProject('archive-extract');
    if (process.platform === 'darwin') {
      expect(archiveType).toBe('zip');
      execFileSync('ditto', ['-x', '-k', archivePath, extractDir], { stdio: 'pipe' });
      const appRoot = realpathSync(join(extractDir, 'Portable-Test.app'));
      expect(existsSync(join(appRoot, 'Contents', 'MacOS', 'Portable-Test'))).toBe(true);
      expect(existsSync(join(appRoot, 'Contents', 'Resources', 'app', 'edgebase-pack.json'))).toBe(true);
      return;
    }

    if (process.platform === 'linux') {
      expect(archiveType).toBe('tar.gz');
      execFileSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'pipe' });
      expect(existsSync(join(extractDir, 'portable-test', 'app', 'edgebase-pack.json'))).toBe(true);
      return;
    }

    expect(archiveType).toBe('zip');
    expect(existsSync(archivePath)).toBe(true);
  });
});
