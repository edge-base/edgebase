import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { pnpmCommand } from '../src/lib/pnpm.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempDirs: string[] = [];

function createHomeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'edgebase-cli-agent-mode-'));
  tempDirs.push(dir);
  return dir;
}

describe('CLI entrypoint agent mode', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns structured needs_input JSON for export when --table is missing', () => {
    const homeDir = createHomeDir();

    const result = spawnSync(
      pnpmCommand(),
      [
        'exec',
        'tsx',
        'src/index.ts',
        '--json',
        '--non-interactive',
        'export',
        '--url',
        'http://localhost:8787',
        '--service-key',
        'test-service-key',
      ],
      {
        cwd: packageDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          HOME: homeDir,
          USERPROFILE: homeDir,
          NO_COLOR: '1',
        },
        stdio: 'pipe',
      },
    );

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        status: 'needs_input',
        code: 'input_required',
        field: 'table',
      }),
    );
    expect(result.stderr).toBe('');
  });

  it('returns structured needs_input JSON for backup restore when --yes is missing', () => {
    const homeDir = createHomeDir();
    const backupPath = join(homeDir, 'backup.json');

    writeFileSync(
      backupPath,
      JSON.stringify({
        version: '1.1',
        timestamp: '2026-03-17T00:00:00Z',
        source: 'local',
        control: { d1: {} },
        auth: { d1: {}, shards: {} },
        databases: {},
      }),
    );

    const result = spawnSync(
      pnpmCommand(),
      [
        'exec',
        'tsx',
        'src/index.ts',
        '--json',
        '--non-interactive',
        'backup',
        'restore',
        '--from',
        backupPath,
        '--url',
        'http://localhost:8787',
        '--service-key',
        'test-service-key',
      ],
      {
        cwd: packageDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          HOME: homeDir,
          USERPROFILE: homeDir,
          NO_COLOR: '1',
        },
        stdio: 'pipe',
      },
    );

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        status: 'needs_input',
        code: 'backup_restore_confirmation_required',
        field: 'yes',
      }),
    );
    expect(result.stderr).toBe('');
  });
});
