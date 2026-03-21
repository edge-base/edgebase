import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveTsxCommand } from '../src/lib/node-tools.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempDirs: string[] = [];
const tsxCommand = resolveTsxCommand();
const tsxExecOptions = /\.cmd$/i.test(tsxCommand.command) ? { shell: true as const } : {};

function createHomeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'edgebase-cli-telemetry-'));
  tempDirs.push(dir);
  return dir;
}

function runCli(homeDir: string, args: string[]): string {
  return execFileSync(tsxCommand.command, [...tsxCommand.argsPrefix, 'src/index.ts', ...args], {
    cwd: packageDir,
    encoding: 'utf-8',
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      NO_COLOR: '1',
    },
    stdio: 'pipe',
    ...tsxExecOptions,
  });
}

function readTelemetry(homeDir: string): {
  enabled: boolean;
  noticeShown?: boolean;
  events: Array<{ command: string; success: boolean; durationMs: number; timestamp: string }>;
} {
  const filePath = join(homeDir, '.edgebase', 'telemetry.json');
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

describe('CLI entrypoint telemetry', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records the full subcommand path for successful commands', () => {
    const homeDir = createHomeDir();

    runCli(homeDir, ['telemetry', 'enable']);
    runCli(homeDir, ['telemetry', 'status']);

    const data = readTelemetry(homeDir);
    expect(data.enabled).toBe(true);
    expect(data.events).toEqual([
      expect.objectContaining({
        command: 'edgebase telemetry enable',
        success: true,
      }),
      expect.objectContaining({
        command: 'edgebase telemetry status',
        success: true,
      }),
    ]);
  });

  it('records failed commands with their requested path', () => {
    const homeDir = createHomeDir();

    runCli(homeDir, ['telemetry', 'enable']);

    const result = spawnSync(
      tsxCommand.command,
      [...tsxCommand.argsPrefix, 'src/index.ts', 'definitely-missing'],
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
        ...tsxExecOptions,
      },
    );

    expect(result.status).toBe(1);

    const data = readTelemetry(homeDir);
    expect(data.events).toEqual([
      expect.objectContaining({
        command: 'edgebase telemetry enable',
        success: true,
      }),
      expect.objectContaining({
        command: 'edgebase definitely-missing',
        success: false,
      }),
    ]);
  });

  it('keeps first-run JSON mode output machine-readable', () => {
    const homeDir = createHomeDir();

    const output = runCli(homeDir, ['--json', 'telemetry', 'status']);

    expect(JSON.parse(output)).toEqual({
      enabled: false,
      eventCount: 0,
    });
  });
});
